/**
 * Typed request context — eliminates `(req as any).ctx` everywhere.
 *
 * Usage in handlers:
 *   const ctx = getCtx(req);
 *   ctx.tenantId, ctx.userId, ctx.roles, ctx.tenantPool, ctx.plan, ...
 */

import type { Request } from "express";
import type { Pool } from "mysql2/promise";

export type TenantCtx = {
  tenantId: string;
  userId?: string;
  sessionId?: string;
  roles: string[];
  plan: string;
  region: string;
  locale: string;
  sucursalId?: number | null;
  veterinarioId?: number | null;
  propietarioId?: number | null;
  tenantPool: Pool;
  /** True when the request comes from the owner portal */
  isPortal?: boolean;
};

export function getCtx(req: Request): TenantCtx {
  return (req as any).ctx as TenantCtx;
}

/** Returns the requestId attached by pino-http */
export function getRequestId(req: Request): string {
  return (req as any).id ?? "";
}

/** Check roles inline — throws FORBIDDEN if insufficient */
export function requireRole(ctx: TenantCtx, ...allowed: string[]): void {
  if (!allowed.some(r => ctx.roles.includes(r))) {
    const { AppError } = require("../core/errors/appError.js");
    throw new AppError("FORBIDDEN", `Rol insuficiente. Requiere uno de: ${allowed.join(", ")}`);
  }
}

/** Build standard JSON response shape */
export function ok(data: unknown, meta?: Record<string, unknown>) {
  return { data, meta: { ...meta }, errors: [] };
}
