import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { rbacDenyTotal } from "../metrics/domain";

type CrudAction = "read" | "create" | "update" | "delete";

const normalize = (s: string) => String(s || "").trim().toLowerCase();

type AuditDenyParams = {
  reason: "missing_auth" | "missing_permission";
  wanted: string[]; // permisos requeridos (normalizados)
  mode: "any" | "all" | "single" | "crud";
  table?: string | null;
  action?: string | null;
};

const setAuditDeny = (req: Request, res: Response, p: AuditDenyParams) => {
  // Auditoría minimalista (sin request body para evitar filtrar datos sensibles)
  (res.locals as any).audit = {
    usuario_id: null, // auditAllApi hace fallback a req.auth.principalId si aplica
    action: "rbac_deny",
    table_name: p.table ?? null,
    record_pk: null,
    before_json: null,
    after_json: null,
    entity_table: p.table ?? null,
    entity_pk: null,
    request_json: {
      reason: p.reason,
      mode: p.mode,
      wanted: p.wanted,
      route: req.originalUrl,
      method: req.method,
      requestId: (req as any)?.requestId ?? null,
      principalType: (req as any)?.auth?.principalType ?? null,
    },
    response_json: {
      status: 403,
      error: "No autorizado",
    },
  };

  // 📊 MÉTRICA RBAC (sin romper request)
  try {
    rbacDenyTotal.labels(p.reason).inc(1);
  } catch {
    // nunca romper request por métricas
  }
};

const hasPermission = (permissions: string[], wanted: string) => {
  const w = normalize(wanted);
  if (!w) return false;

  const set = new Set((permissions || []).map(normalize));

  if (set.has(w)) return true;

  const wantedParts = w.split(":");
  for (const p of set) {
    if (!p.includes("*")) continue;
    if (p === "*") return true;

    const parts = p.split(":");
    if (parts.length === wantedParts.length) {
      const ok = parts.every((seg, i) => seg === "*" || seg === wantedParts[i]);
      if (ok) return true;
      continue;
    }

    if (parts.length < wantedParts.length) {
      const ok = parts.every((seg, i) => seg === "*" || seg === wantedParts[i]);
      if (ok) return true;
    }
  }

  return false;
};

/**
 * Permisos CRUD con wildcard:
 * - crud:tabla:accion
 * - crud:tabla:*
 * - crud:*:accion
 * - crud:*:*
 */
export const can = (permissions: string[], table: string, action: CrudAction) => {
  const t = normalize(table);
  const a = normalize(action);

  const wanted = [`crud:${t}:${a}`, `crud:${t}:*`, `crud:*:${a}`, `crud:*:*`];

  const set = new Set((permissions || []).map(normalize));
  return wanted.some((k) => set.has(k));
};

const getAuth = (req: Request) => (req as any).auth;

/**
 * Requiere permisos CRUD para la tabla del param :table
 */
export const requireCrud =
  (action: CrudAction) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next();

    const auth = getAuth(req);
    if (!auth) {
      setAuditDeny(req, res, {
        reason: "missing_auth",
        wanted: [`crud:*:${normalize(action)}`],
        mode: "crud",
        table: String(req.params.table || "") || null,
        action,
      });
      return res.status(401).json({ ok: false, error: "No autenticado" });
    }

    const table = String(req.params.table || "");
    if (!table) return res.status(400).json({ ok: false, error: "Tabla requerida" });

    if (!can(auth.permissions || [], table, action)) {
      setAuditDeny(req, res, {
        reason: "missing_permission",
        wanted: [`crud:${normalize(table)}:${normalize(action)}`],
        mode: "crud",
        table,
        action,
      });
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    return next();
  };

/**
 * Para endpoints meta como /tables
 * Requiere mínimo: crud:*:read o crud:*:*
 */
export const requireMetaRead = (req: Request, res: Response, next: NextFunction) => {
  if (!env.RBAC_ENABLE) return next();
  if (!env.AUTH_ENABLE) return next();

  const auth = getAuth(req);
  if (!auth) {
    setAuditDeny(req, res, {
      reason: "missing_auth",
      wanted: ["crud:*:read"],
      mode: "single",
    });
    return res.status(401).json({ ok: false, error: "No autenticado" });
  }

  const allowed =
    can(auth.permissions || [], "*", "read") ||
    (auth.permissions || []).map(normalize).includes("crud:*:*");

  if (!allowed) {
    setAuditDeny(req, res, {
      reason: "missing_permission",
      wanted: ["crud:*:read"],
      mode: "single",
    });
    return res.status(403).json({ ok: false, error: "No autorizado" });
  }

  return next();
};

/**
 * Requiere un permiso específico (no-CRUD).
 */
export const requirePermission =
  (perm: string) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next();

    const auth = getAuth(req);
    if (!auth) {
      setAuditDeny(req, res, { reason: "missing_auth", wanted: [normalize(perm)], mode: "single" });
      return res.status(401).json({ ok: false, error: "No autenticado" });
    }

    const wanted = normalize(perm);
    const ok = hasPermission(auth.permissions || [], wanted);

    if (!ok) {
      setAuditDeny(req, res, { reason: "missing_permission", wanted: [wanted], mode: "single" });
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    return next();
  };

/**
 * Requiere al menos uno de los permisos.
 */
export const requireAny =
  (perms: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next();

    const auth = getAuth(req);
    if (!auth) {
      setAuditDeny(req, res, {
        reason: "missing_auth",
        wanted: (perms || []).map(normalize),
        mode: "any",
      });
      return res.status(401).json({ ok: false, error: "No autenticado" });
    }

    const wanted = (perms || []).map(normalize).filter(Boolean);
    const ok = wanted.some((p) => hasPermission(auth.permissions || [], p));

    if (!ok) {
      setAuditDeny(req, res, { reason: "missing_permission", wanted, mode: "any" });
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    return next();
  };

/**
 * Requiere todos los permisos listados.
 */
export const requireAll =
  (perms: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next();

    const auth = getAuth(req);
    if (!auth) {
      setAuditDeny(req, res, {
        reason: "missing_auth",
        wanted: (perms || []).map(normalize),
        mode: "all",
      });
      return res.status(401).json({ ok: false, error: "No autenticado" });
    }

    const wanted = (perms || []).map(normalize).filter(Boolean);
    const ok = wanted.every((p) => hasPermission(auth.permissions || [], p));

    if (!ok) {
      setAuditDeny(req, res, { reason: "missing_permission", wanted, mode: "all" });
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    return next();
  };
