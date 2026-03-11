import mysql from "mysql2/promise"

console.log("[mysql env]", {
  MYSQL_HOST: process.env.MYSQL_HOST,
  MYSQL_PORT: process.env.MYSQL_PORT,
  MYSQL_DB: process.env.MYSQL_DB,
  MYSQL_USER: process.env.MYSQL_USER,
  MYSQL_PASSWORD_SET: !!process.env.MYSQL_PASSWORD,
})

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10
})