import "dotenv/config";
import bcrypt from "bcryptjs";
import { Sequelize } from "sequelize";

const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = Number(process.env.DB_PORT || 3306);

if (!DB_NAME || !DB_USER) {
  console.error("Faltan variables DB_NAME o DB_USER en .env");
  process.exit(1);
}

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD || "", {
  host: DB_HOST,
  port: DB_PORT,
  dialect: "mysql",
  logging: false,
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

const PERMS = [
  "api:access",
  "docs:read",
  "documents:read",
  "crud:*:*",
];

async function run() {
  await sequelize.authenticate();

  // 1) rol admin
  await sequelize.query(
    `INSERT IGNORE INTO roles (nombre, descripcion) VALUES ('admin', 'Administrador')`
  );

  // obtener id del rol admin
  const [roleRows] = await sequelize.query(
    `SELECT id FROM roles WHERE nombre='admin' AND deleted_at IS NULL LIMIT 1`
  );
  const roleId = Number((roleRows?.[0] || {}).id || 0);
  if (!roleId) throw new Error("No se pudo obtener roleId del rol admin");

  // 2) permisos base
  for (const p of PERMS) {
    await sequelize.query(`INSERT IGNORE INTO permisos (clave) VALUES (:p)`, { replacements: { p } });
  }

  // asignar permisos al rol admin
  const [permRows] = await sequelize.query(
    `SELECT id, clave FROM permisos WHERE deleted_at IS NULL AND clave IN (:list)`,
    { replacements: { list: PERMS } }
  );

  for (const pr of permRows || []) {
    await sequelize.query(
      `
      INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
      VALUES (:rol_id, :permiso_id)
      `,
      { replacements: { rol_id: roleId, permiso_id: Number(pr.id) } }
    );
  }

  // 3) usuario admin
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await sequelize.query(
    `
    INSERT IGNORE INTO usuarios (email, nombre, password, estado, creado_en)
    VALUES (:email, 'Administrador', :password, 'activo', NOW())
    `,
    { replacements: { email: ADMIN_EMAIL, password: hash } }
  );

  // obtener id del admin
  const [userRows] = await sequelize.query(
    `SELECT id FROM usuarios WHERE email=:email AND deleted_at IS NULL LIMIT 1`,
    { replacements: { email: ADMIN_EMAIL } }
  );
  const userId = Number((userRows?.[0] || {}).id || 0);
  if (!userId) throw new Error("No se pudo obtener userId del admin");

  // asignar rol admin al usuario
  await sequelize.query(
    `
    INSERT IGNORE INTO usuarios_roles (usuario_id, rol_id)
    VALUES (:usuario_id, :rol_id)
    `,
    { replacements: { usuario_id: userId, rol_id: roleId } }
  );

  console.log("RBAC seed OK");
  console.log("admin email:", ADMIN_EMAIL);
  console.log("admin password:", ADMIN_PASSWORD);

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
