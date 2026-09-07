import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

// Crea o actualiza el usuario administrador inicial desde variables de entorno.
const required = ["DB_HOST", "DB_NAME", "DB_USER", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Falta variable ${key}`);
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [roles] = await connection.execute("SELECT id FROM roles WHERE nombre = 'ADMIN' LIMIT 1");
  const adminRole = roles[0];
  if (!adminRole) throw new Error("No existe rol ADMIN. Ejecutar migraciones primero.");

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, rounds);
  await connection.execute(
    `INSERT INTO usuarios (username, email, nombre, password_hash, rol_id, activo)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       nombre = VALUES(nombre),
       password_hash = VALUES(password_hash),
       rol_id = VALUES(rol_id),
       activo = 1,
       token_version = token_version + 1`,
    [process.env.ADMIN_USERNAME || "admin", process.env.ADMIN_EMAIL.toLowerCase(), process.env.ADMIN_NAME || "Administrador", passwordHash, adminRole.id]
  );
  console.log(`Admin listo: ${process.env.ADMIN_EMAIL}`);
} finally {
  await connection.end();
}
