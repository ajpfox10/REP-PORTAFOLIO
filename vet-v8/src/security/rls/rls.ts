/**
 * Row-Level Security helpers — v9
 *
 * CHANGES vs v8:
 *  - buildRlsFilter   : unchanged — permissive mode (allows shared rows via env var).
 *  - buildRlsFilterStrict: NEW real implementation — always requires userId AND
 *    sucursalId when provided, never allows shared rows regardless of env config,
 *    and throws if tenantId is missing/empty.
 *
 * Use buildRlsFilterStrict for any sensitive table (medical records, billing,
 * prescriptions). Use buildRlsFilter for read-only list endpoints where
 * shared rows are acceptable.
 */

import { AppError } from "../../core/errors/appError.js";

export type RlsContext = {
  table: string;
  tenantId: string;
  userId?: string;
  sucursalId?: string;
  allowSharedRows?: boolean;
};

function sharedRowsAllowed(opts: RlsContext): boolean {
  return typeof opts.allowSharedRows === "boolean"
    ? opts.allowSharedRows
    : String(process.env.RLS_ALLOW_SHARED_ROWS ?? "false").toLowerCase() === "true";
}

// ── Permissive filter (non-sensitive lists) ──────────────────────────────────

export function buildRlsFilter(opts: RlsContext) {
  const clauses = ["`tenant_id` = ?"];
  const params: unknown[] = [opts.tenantId];

  if (opts.userId) {
    if (sharedRowsAllowed(opts)) clauses.push("(`owner_user_id` IS NULL OR `owner_user_id` = ?)");
    else clauses.push("`owner_user_id` = ?");
    params.push(opts.userId);
  }

  if (opts.sucursalId) {
    if (sharedRowsAllowed(opts)) clauses.push("(`sucursal_id` IS NULL OR `sucursal_id` = ?)");
    else clauses.push("`sucursal_id` = ?");
    params.push(opts.sucursalId);
  }

  return { whereSql: clauses.join(" AND "), params };
}

// ── Strict filter (sensitive tables: consultas, prescripciones, billing) ─────

/**
 * buildRlsFilterStrict — stronger guarantees than buildRlsFilter:
 *
 *  1. tenantId MUST be a non-empty string — throws CONFIG_ERROR otherwise.
 *  2. When userId is provided, rows with NULL owner_user_id are NEVER returned
 *     (no "shared rows" semantics regardless of RLS_ALLOW_SHARED_ROWS).
 *  3. When sucursalId is provided, same rule: NULL sucursal_id rows are excluded.
 *  4. The resulting WHERE clause is always at least as restrictive as the input
 *     context — it cannot be weakened by environment variables.
 *
 * Suitable for: consultas, prescripciones, internaciones, facturacion, sales.
 */
export function buildRlsFilterStrict(opts: RlsContext) {
  if (!opts.tenantId || typeof opts.tenantId !== "string" || !opts.tenantId.trim()) {
    throw new AppError("CONFIG_ERROR", "buildRlsFilterStrict: tenantId is required and must be non-empty");
  }

  const clauses = ["`tenant_id` = ?"];
  const params: unknown[] = [opts.tenantId];

  if (opts.userId) {
    // Strict: never allow NULL owner — must be this exact user
    clauses.push("`owner_user_id` = ?");
    params.push(opts.userId);
  }

  if (opts.sucursalId) {
    // Strict: never allow NULL sucursal — must be this exact branch
    clauses.push("`sucursal_id` = ?");
    params.push(opts.sucursalId);
  }

  return { whereSql: clauses.join(" AND "), params };
}
