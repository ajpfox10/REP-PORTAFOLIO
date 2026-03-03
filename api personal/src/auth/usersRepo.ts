import { Sequelize } from "sequelize";

export type DbUser = {
  id: number;
  email: string;
  nombre: string | null;
  passwordHash: string;
  active: boolean;
  roleId: number | null;
};

export async function findUserByEmail(sequelize: Sequelize, email: string): Promise<DbUser | null> {
  const [rows] = await sequelize.query(
    `
    SELECT
      u.id AS id,
      u.email AS email,
      u.nombre AS nombre,
      u.password AS passwordHash,
      (u.estado = 'activo') AS active,
      ur.rol_id AS roleId
    FROM usuarios u
    LEFT JOIN usuarios_roles ur
      ON ur.usuario_id = u.id
     AND ur.deleted_at IS NULL
    WHERE u.email = :email
      AND u.deleted_at IS NULL
    ORDER BY ur.created_at DESC
    LIMIT 1
    `,
    { replacements: { email } }
  );

  const list = rows as any[];
  if (!list.length) return null;

  const r = list[0];
  return {
    id: Number(r.id),
    email: String(r.email),
    nombre: r.nombre ?? null,
    passwordHash: String(r.passwordHash),
    active: Boolean(r.active),
    roleId: r.roleId === null || r.roleId === undefined ? null : Number(r.roleId),
  };
}

export async function findUserById(sequelize: Sequelize, userId: number): Promise<Omit<DbUser, "passwordHash"> | null> {
  const [rows] = await sequelize.query(
    `
    SELECT
      u.id AS id,
      u.email AS email,
      u.nombre AS nombre,
      (u.estado = 'activo') AS active,
      ur.rol_id AS roleId
    FROM usuarios u
    LEFT JOIN usuarios_roles ur
      ON ur.usuario_id = u.id
     AND ur.deleted_at IS NULL
    WHERE u.id = :userId
      AND u.deleted_at IS NULL
    ORDER BY ur.created_at DESC
    LIMIT 1
    `,
    { replacements: { userId } }
  );

  const list = rows as any[];
  if (!list.length) return null;

  const r = list[0];
  return {
    id: Number(r.id),
    email: String(r.email),
    nombre: r.nombre ?? null,
    active: Boolean(r.active),
    roleId: r.roleId === null || r.roleId === undefined ? null : Number(r.roleId),
  };
}
