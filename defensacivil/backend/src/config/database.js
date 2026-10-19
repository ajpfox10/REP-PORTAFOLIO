const mysql  = require('mysql2/promise');
const config = require('./env');
const logger = require('./logger');

// Hora Argentina (sin horario de verano). Se fija en la sesión de MySQL para que
// CURRENT_TIMESTAMP, NOW() y CURDATE() usen la misma zona que el driver.
const TIMEZONE = '-03:00';

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
  timezone:          TIMEZONE,
  decimalNumbers:    true,
});

pool.pool.on('connection', conn => {
  conn.query(`SET time_zone = '${TIMEZONE}'`);
});

async function query(sql, params = [], conn = pool) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = [], conn = pool) {
  const rows = await query(sql, params, conn);
  return rows[0] || null;
}

// Para INSERT/UPDATE/DELETE: devuelve { insertId, affectedRows }
async function execute(sql, params = [], conn = pool) {
  const [result] = await conn.execute(sql, params);
  return result;
}

// Ejecuta fn dentro de una transacción: si algo falla, no queda nada a medias.
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function testConnection() {
  const conn = await pool.getConnection();
  await conn.query('SELECT 1');
  conn.release();
  logger.info(`Base de datos conectada: ${config.db.name} @ ${config.db.host}:${config.db.port}`);
}

module.exports = { pool, query, queryOne, execute, transaction, testConnection };
