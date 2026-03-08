export type AbacContext = { userId?: string; sucursalId?: string; veterinarioId?: string; roles?: string[] };

/**
 * FIX: ABAC now enforces sucursal_id and veterinario_id isolation.
 * Previously only checked owner_user_id on reads. Now applies to all ops.
 * Admins bypass all ABAC checks.
 */
export function checkAbac(ctx: AbacContext, row: any): boolean {
  const roles = ctx.roles ?? [];
  if (roles.includes("admin")) return true;
  if (ctx.userId && row?.owner_user_id && String(row.owner_user_id) !== String(ctx.userId)) return false;
  if (ctx.sucursalId && row?.sucursal_id && String(row.sucursal_id) !== String(ctx.sucursalId)) return false;
  if (roles.includes("vet") && ctx.veterinarioId && row?.veterinario_id && String(row.veterinario_id) !== String(ctx.veterinarioId)) return false;
  return true;
}
