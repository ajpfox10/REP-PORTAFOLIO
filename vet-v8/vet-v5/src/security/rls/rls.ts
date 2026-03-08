export type RlsContext = { table: string; tenantId: string; userId?: string; sucursalId?: string };

export function buildRlsFilter(opts: RlsContext) {
  const clauses = ["`tenant_id` = ?"];
  const params: any[] = [opts.tenantId];
  if (opts.userId) {
    clauses.push("(`owner_user_id` IS NULL OR `owner_user_id` = ?)");
    params.push(opts.userId);
  }
  return { whereSql: clauses.join(" AND "), params };
}

/**
 * Stricter RLS for UPDATE/DELETE — also enforces sucursal_id isolation.
 * FIX: The original update handler was missing RLS entirely.
 */
export function buildRlsFilterStrict(opts: RlsContext) {
  const clauses = ["`tenant_id` = ?"];
  const params: any[] = [opts.tenantId];
  if (opts.userId) {
    clauses.push("(`owner_user_id` IS NULL OR `owner_user_id` = ?)");
    params.push(opts.userId);
  }
  if (opts.sucursalId) {
    clauses.push("(`sucursal_id` IS NULL OR `sucursal_id` = ?)");
    params.push(opts.sucursalId);
  }
  return { whereSql: clauses.join(" AND "), params };
}
