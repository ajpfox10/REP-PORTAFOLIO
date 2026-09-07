import mysql from "mysql2/promise";
import { env } from "../config/env.js";

// Pool unico de MySQL para reutilizar conexiones entre requests.
export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  namedPlaceholders: true,
  timezone: "Z",
});

// Ejecuta consultas tipadas de forma centralizada.
export async function query<T = unknown>(sql: string, params: Record<string, unknown> = {}) {
  const [rows] = await pool.execute(sql, params as any);
  return rows as T;
}
