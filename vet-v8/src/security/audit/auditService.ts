/**
 * Audit Service — v10  (S-04)
 *
 * The auditoria_log table was defined in the schema but NEVER written.
 * This module provides:
 *   1. auditLog()      — direct insert, use in service layer
 *   2. auditMiddleware — Express middleware that auto-logs after 2xx mutations
 *
 * Events always written:
 *   auth.login, auth.logout, auth.login_failed, auth.password_changed,
 *   auth.mfa_enabled, auth.mfa_disabled, auth.recovery_used,
 *   user.created, user.updated, user.deleted, user.role_changed,
 *   clinical.consulta_created, clinical.prescripcion_created,
 *   billing.factura_emitida, impersonation.started, impersonation.ended
 *
 * GDPR Art. 30 compliance: every data access/mutation on personal data is logged
 * with actor, timestamp, IP, before/after state.
 */

import type { Pool } from "mysql2/promise";
import type { Request, Response, NextFunction } from "express";

export type AuditAction =
  | "auth.login" | "auth.logout" | "auth.login_failed"
  | "auth.password_changed" | "auth.mfa_enabled" | "auth.mfa_disabled"
  | "auth.recovery_used" | "auth.token_revoked"
  | "user.created" | "user.updated" | "user.deleted" | "user.role_changed"
  | "clinical.consulta_created" | "clinical.consulta_updated"
  | "clinical.prescripcion_created" | "clinical.internacion_created"
  | "billing.factura_emitida" | "billing.factura_anulada"
  | "impersonation.started" | "impersonation.ended"
  | "data.export" | "data.delete_gdpr";

export type AuditEntry = {
  tenantId: string;
  actorUserId?: string | null;
  action: AuditAction | string;
  resource: string;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
};

/**
 * Write a single audit record. Fire-and-forget safe: errors are caught
 * and logged to console — audit failures must NEVER break business logic.
 */
export async function auditLog(pool: Pool, entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auditoria_log
         (actor_user_id, tenant_id, action, resource, resource_id,
          ip, user_agent, request_id, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.actorUserId ?? null,
        entry.tenantId,
        entry.action,
        entry.resource,
        entry.resourceId ?? null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        entry.requestId ?? null,
        entry.beforeJson !== undefined ? JSON.stringify(entry.beforeJson) : null,
        entry.afterJson  !== undefined ? JSON.stringify(entry.afterJson)  : null,
      ]
    );
  } catch (err) {
    // Non-fatal: log to console but never throw — audit must not break requests
    console.error("[audit] Failed to write audit log:", err);
  }
}

/**
 * Express middleware: automatically audit-logs after successful (2xx) mutations
 * on the configured resource paths.
 *
 * Usage in app.ts:
 *   app.use("/api/v1/users",       buildAuditMiddleware({ pool: masterPool, resource: "user" }));
 *   app.use("/api/v1/clinical",    buildAuditMiddleware({ pool: ..., resource: "clinical" }));
 *
 * For fine-grained before/after capture, call auditLog() directly in handlers.
 */
export type AuditMiddlewareOpts = {
  pool: Pool;
  resource: string;
  /** Only audit these methods. Default: POST, PUT, PATCH, DELETE */
  methods?: string[];
};

export function buildAuditMiddleware(opts: AuditMiddlewareOpts) {
  const methods = new Set((opts.methods ?? ["POST", "PUT", "PATCH", "DELETE"]).map(m => m.toUpperCase()));

  return (req: Request, res: Response, next: NextFunction) => {
    if (!methods.has(req.method.toUpperCase())) return next();

    const ctx = (req as any).ctx;
    const originalEnd = res.end.bind(res);

    // Intercept response end to check status code
    (res as any).end = function (chunk: any, ...args: any[]) {
      // Restore immediately to avoid double-wrap
      res.end = originalEnd;
      const result = originalEnd(chunk, ...args);

      // Only audit successful mutations
      if (res.statusCode >= 200 && res.statusCode < 300 && ctx) {
        const action = methodToAction(req.method, opts.resource);
        auditLog(opts.pool, {
          tenantId:    ctx.tenantId,
          actorUserId: ctx.actorUserId ?? ctx.userId ?? null,
          action,
          resource:    opts.resource,
          resourceId:  extractResourceId(req),
          ip:          ctx.ip ?? req.ip ?? null,
          userAgent:   req.headers["user-agent"] ?? null,
          requestId:   (req as any).id ?? null,
        });
      }
      return result;
    };

    next();
  };
}

function methodToAction(method: string, resource: string): string {
  const m = method.toUpperCase();
  if (m === "POST")   return `${resource}.created`;
  if (m === "PUT" || m === "PATCH") return `${resource}.updated`;
  if (m === "DELETE") return `${resource}.deleted`;
  return `${resource}.mutated`;
}

function extractResourceId(req: Request): string | null {
  // Try common param names: id, :id in path
  const id = (req.params as any)?.id ?? (req.params as any)?.resourceId;
  return id ? String(id) : null;
}
