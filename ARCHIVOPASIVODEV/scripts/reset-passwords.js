import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const NEW_PASSWORD = process.argv[2];
if (!NEW_PASSWORD) throw new Error("Uso: node scripts/reset-passwords.js <password>");

const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
const hash = await bcrypt.hash(NEW_PASSWORD, rounds);

const c = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
try {
  const [res] = await c.execute(
    `UPDATE usuarios
       SET password_hash = ?, token_version = token_version + 1, activo = 1
     WHERE username IN ('admin', 'legales', 'archivo')`,
    [hash]
  );
  console.log(`Usuarios actualizados: ${res.affectedRows}`);
} finally {
  await c.end();
}
