import { query } from "../db/pool.js";

// Carga los permisos finos asociados al rol unico del usuario.
export async function loadPermissionsByRoleId(roleId: number) {
  const rows = await query<Array<{ clave: string }>>(
    `SELECT p.clave
       FROM roles_permisos rp
       JOIN permisos p ON p.id = rp.permiso_id
      WHERE rp.rol_id = :roleId
        AND p.deleted_at IS NULL`,
    { roleId }
  );
  return rows.map((row) => row.clave);
}

// Evalua permisos exactos y comodines controlados como modulo:*.
export function hasPermission(permissions: string[], required: string) {
  if (permissions.includes(required)) return true;
  const [module] = required.split(":");
  return permissions.includes(`${module}:*`) || permissions.includes("*:*");
}
