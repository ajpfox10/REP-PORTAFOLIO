'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  decimalNumbers: true,
  timezone: 'Z',
  charset: 'utf8mb4',
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Ejecuta fn dentro de una transacción; hace rollback si algo falla
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const helpers = {
      query: async (sql, params) => (await conn.query(sql, params))[0],
      queryOne: async (sql, params) => (await conn.query(sql, params))[0][0] || null,
    };
    const result = await fn(helpers);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryOne, transaction };
