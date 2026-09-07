import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
try {
  const [rows] = await c.execute(
    `SELECT u.id, u.username, u.email, u.nombre, r.nombre AS rol, u.activo
     FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id ORDER BY u.id`
  );
  console.table(rows);
} finally {
  await c.end();
}
