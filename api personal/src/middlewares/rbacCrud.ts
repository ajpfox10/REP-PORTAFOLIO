import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

type CrudAction = "read" | "create" | "update" | "delete";

const normalize = (s: string) => String(s || "").trim().toLowerCase();

export const can = (permissions: string[], table: string, action: CrudAction) => {
  const t = normalize(table);
  const a = normalize(action);

  const wanted = [
    `crud:${t}:${a}`,
    `crud:${t}:*`,
    `crud:*:${a}`,
    `crud:*:*`,
  ];

  const set = new Set((permissions || []).map(normalize));
  return wanted.some((k) => set.has(k));
};

export const requireCrud =
  (action: CrudAction) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next(); // si auth apagado, no bloqueamos

    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: "No autenticado" });

    const table = String(req.params.table || "");
    if (!table) return res.status(400).json({ ok: false, error: "Tabla requerida" });

    if (!can(auth.permissions || [], table, action)) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    return next();
  };

// Para endpoints meta como /tables
export const requireMetaRead =
  (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE) return next();
    if (!env.AUTH_ENABLE) return next();

    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: "No autenticado" });

    // Permiso mínimo para “ver tablas”
    const allowed =
      can(auth.permissions || [], "*", "read") ||
      (auth.permissions || []).map(normalize).includes("crud:*:*");

    if (!allowed) return res.status(403).json({ ok: false, error: "No autorizado" });
    return next();
  };
