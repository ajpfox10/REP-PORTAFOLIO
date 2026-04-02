const mysql  = require('mysql2/promise');
const config = require('./env');
const logger = require('./logger');

const pool = mysql.createPool({
  host:              config.db.host,
  port:              config.db.port,
  user:              config.db.user,
  password:          config.db.password,
  database:          config.db.name,
  charset:           'utf8mb4',
  connectionLimit:   10,
  waitForConnections: true,
  queueLimit:        0,
  timezone:          '-03:00',
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function testConnection() {
  const conn = await pool.getConnection();
  await conn.query('SELECT 1');
  conn.release();
  logger.info(`Base de datos conectada: ${config.db.name} @ ${config.db.host}:${config.db.port}`);
}

module.exports = { pool, query, queryOne, testConnection };
