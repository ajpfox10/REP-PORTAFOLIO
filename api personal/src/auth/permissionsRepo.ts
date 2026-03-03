import { Sequelize } from "sequelize";

export async function loadPermissionsByRoleId(sequelize: Sequelize, roleId: number | null) {
  if (!roleId) return [];

  const [rows] = await sequelize.query(
    `
    SELECT p.clave AS perm
    FROM roles_permisos rp
    JOIN permisos p ON p.id = rp.permiso_id AND p.deleted_at IS NULL
    WHERE rp.rol_id = :roleId
      AND rp.deleted_at IS NULL
    `,
    { replacements: { roleId } }
  );

  const list = rows as any[];
  return Array.from(
    new Set(list.map((r) => r.perm).filter((x) => typeof x === "string" && x.length > 0))
  );
}
