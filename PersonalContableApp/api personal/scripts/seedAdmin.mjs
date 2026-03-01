import "dotenv/config";
import bcrypt from "bcryptjs";
import { Sequelize } from "sequelize";

// Lee DB_* desde .env
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD; // ✅ coincide con tu .env
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

async function run() {
  await sequelize.authenticate();

  // Rol admin
  await sequelize.query(
    `INSERT IGNORE INTO roles (nombre, descripcion) VALUES ('admin', 'Administrador')`
  );

  // Permisos base
  const permissions = ["crud:*:*", "crud:*:read", "documents:read", "docs:read"];

  for (const p of permissions) {
    await sequelize.query(`INSERT IGNORE INTO permisos (clave) VALUES (:p)`, {
      replacements: { p },
    });
  }

  // Usuario admin (activo)
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await sequelize.query(
    `
    INSERT IGNORE INTO usuarios
      (email, nombre, password, estado, creado_en)
    VALUES
      (:email, 'Administrador', :password, 'activo', NOW())
    `,
    {
      replacements: {
        email: ADMIN_EMAIL,
        password: hash,
      },
    }
  );

  console.log("Admin listo");
  console.log("email:", ADMIN_EMAIL);
  console.log("password:", ADMIN_PASSWORD);

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
