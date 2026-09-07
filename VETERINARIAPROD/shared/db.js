'use strict';

const mysql = require('mysql2/promise');
const { getSecret } = require('./secrets');

// Slow-query threshold (ms). Override via SLOW_QUERY_MS env var.
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || '500');

let pool;
let readPool;
let _logger; // lazy-loaded to avoid circular deps
let _primaryInitPromise = null;
let _readInitPromise    = null;

function getLogger() {
  if (!_logger) {
    try { _logger = require('./logger').createLogger('db'); } catch { _logger = console; }
  }
  return _logger;
}

function createPoolFromEnv(prefix = 'MYSQL') {
  return mysql.createPool({
    host:               process.env[`${prefix}_HOST`]     || 'localhost',
    port:               parseInt(process.env[`${prefix}_PORT`] || '3306'),
    database:           process.env[`${prefix}_DATABASE`] || 'vetmanager',
    user:               process.env[`${prefix}_USER`]     || 'vetapp',
    password:           getSecret(`${prefix}_PASSWORD`, { defaultValue: '' }) || '',
    waitForConnections: true,
    connectionLimit:    parseInt(process.env[`${prefix}_POOL_MAX`] || process.env.MYSQL_POOL_MAX || '20'),  // OT-081
    queueLimit:         parseInt(process.env[`${prefix}_QUEUE_LIMIT`] || process.env.MYSQL_QUEUE_LIMIT || '200'),  // OT-079
    timezone:           'Z',
    charset:            'utf8mb4',
    namedPlaceholders:  true,
    enableKeepAlive:    true,   // OT-082: prevent silent connection drops on long-lived pools
    keepAliveInitialDelay: 10000,
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function warmPool(targetPool, label) {
  const retries = Math.max(1, parseInt(process.env.DB_INIT_RETRIES || '3'));
  const baseMs  = Math.max(100, parseInt(process.env.DB_INIT_RETRY_MS || '500'));
  let lastErr;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await targetPool.execute('SELECT 1');
      return targetPool;
    } catch (err) {
      lastErr = err;
      getLogger().warn('DB warm-up failed', {
        pool: label,
        attempt,
        retries,
        message: err.message,
      });
      if (attempt < retries) await sleep(baseMs * attempt);
    }
  }

  throw lastErr;
}

function getPool() {
  if (!pool) pool = createPoolFromEnv('MYSQL');
  if (!_primaryInitPromise) {
    _primaryInitPromise = warmPool(pool, 'primary').catch((err) => {
      _primaryInitPromise = null;
      throw err;
    });
  }
  return pool;
}

function getReadPool() {
  const hasReplica = Boolean(process.env.MYSQL_READ_HOST);
  if (!hasReplica) return getPool();

  if (!readPool) readPool = createPoolFromEnv('MYSQL_READ');
  if (!_readInitPromise) {
    _readInitPromise = warmPool(readPool, 'read-replica').catch((err) => {
      getLogger().warn('Read replica unavailable, falling back to primary pool', {
        message: err.message,
      });
      _readInitPromise = null;
      if (readPool) {
        readPool.end().catch(() => {});
        readPool = null;
      }
      return getPool();
    });
  }
  return readPool;
}

/**
 * Execute a query and return rows.
 * For SELECT → returns RowDataPacket[] (array of rows).
 * For INSERT/UPDATE/DELETE → mysql2 returns a ResultSetHeader (plain object,
 * not an array). We wrap it in [ResultSetHeader] so callers can always do:
 *   const [result] = await db.query('INSERT ...')
 *   result.insertId  // ✅ works correctly
 *
 * @param {string} sql
 * @param {object|Array} params
 */
async function query(sql, params) {
  const t0 = Date.now();
  const [rows] = await getPool().query(sql, params);
  const ms = Date.now() - t0;

  if (ms >= SLOW_QUERY_MS) {
    getLogger().warn('Slow query detected', {
      sql:      sql.replace(/\s+/g, ' ').slice(0, 200),
      duration: ms,
    });
  }

  // ResultSetHeader (INSERT/UPDATE/DELETE) is a plain object, not an array.
  // Wrap it so the callers' destructuring pattern always works.
  if (!Array.isArray(rows)) return [rows];
  return rows;
}

async function queryRead(sql, params) {
  const t0 = Date.now();
  const [rows] = await getReadPool().query(sql, params);
  const ms = Date.now() - t0;

  if (ms >= SLOW_QUERY_MS) {
    getLogger().warn('Slow read query detected', {
      sql:      sql.replace(/\s+/g, ' ').slice(0, 200),
      duration: ms,
    });
  }

  if (!Array.isArray(rows)) return [rows];
  return rows;
}

/**
 * Execute query returning only the first row (or null).
 */
async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

async function queryOneRead(sql, params) {
  const rows = await queryRead(sql, params);
  return rows[0] ?? null;
}

/**
 * Call a stored procedure.
 * @param {string} name  e.g. 'sp_login_attempt'  — must match /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/
 * @param {Array}  args
 */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
async function callProc(name, args = []) {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`callProc: invalid procedure name '${name}'`);
  }
  const placeholders = args.map(() => '?').join(',');
  const [results] = await getPool().execute(`CALL ${name}(${placeholders})`, args);
  return results;
}

/**
 * Decorate a raw mysql2 PoolConnection with the same helpers as the module
 * (query/queryOne/savepoint) so transaction callbacks can call them with
 * named placeholders just like the top-level functions.
 *
 * @param {mysql.PoolConnection} conn
 * @returns {mysql.PoolConnection & { query, queryOne, savepoint, releaseSavepoint, rollbackToSavepoint }}
 */
function decorateConn(conn) {
  const rawQuery = typeof conn.query === 'function'
    ? conn.query.bind(conn)
    : conn.execute.bind(conn);
  conn.query = async function(sql, params) {
    const [rows] = await rawQuery(sql, params);
    if (!Array.isArray(rows)) return [rows];
    return rows;
  };

  conn.queryOne = async function(sql, params) {
    const rows = await conn.query(sql, params);
    return rows[0] ?? null;
  };

  conn.savepoint = async function(name) {
    if (!SAFE_IDENTIFIER.test(name)) throw new Error(`savepoint: invalid name '${name}'`);
    await conn.execute(`SAVEPOINT ${name}`);
  };

  conn.releaseSavepoint = async function(name) {
    if (!SAFE_IDENTIFIER.test(name)) throw new Error(`releaseSavepoint: invalid name '${name}'`);
    await conn.execute(`RELEASE SAVEPOINT ${name}`);
  };

  conn.rollbackToSavepoint = async function(name) {
    if (!SAFE_IDENTIFIER.test(name)) throw new Error(`rollbackToSavepoint: invalid name '${name}'`);
    await conn.execute(`ROLLBACK TO SAVEPOINT ${name}`);
  };

  return conn;
}

/**
 * Run a block inside a transaction with automatic commit/rollback.
 *
 * The callback receives a decorated connection that exposes:
 *   conn.query(sql, params)          — same semantics as db.query()
 *   conn.queryOne(sql, params)       — first row or null
 *   conn.savepoint(name)             — create a savepoint
 *   conn.rollbackToSavepoint(name)   — partial rollback
 *   conn.releaseSavepoint(name)      — release savepoint on success
 *   conn.execute(sql, params)        — raw mysql2 execute
 *
 * Savepoint example (multi-table, partial rollback):
 *   await db.transaction(async (conn) => {
 *     await conn.query('INSERT INTO a ...', ...);
 *     await conn.savepoint('sp1');
 *     try {
 *       await conn.query('INSERT INTO b ...', ...);
 *     } catch (e) {
 *       await conn.rollbackToSavepoint('sp1');  // only b rolls back
 *     }
 *   });
 *
 * @param {(conn: DecoratedConnection) => Promise<any>} fn
 */
async function transaction(fn) {
  const conn = decorateConn(await getPool().getConnection());
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      getLogger().error('Transaction rollback failed', {
        error: rollbackErr.message,
        originalError: err.message,
      });
      err.rollbackError = rollbackErr;
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Fetch rows keyed by a column — used to resolve N+1 by batch-loading related records.
 *
 * Example (load owners for a list of patients):
 *   const ownersByPatient = await db.queryGrouped(
 *     `SELECT po.patient_id, cl.* FROM patient_owners po JOIN clients cl ON po.client_id = cl.id
 *      WHERE po.patient_id IN (${db.placeholders(ids)})`,
 *     ids,
 *     'patient_id'
 *   );
 *   // ownersByPatient = { 1: [...], 2: [...] }
 *
 * @param {string}   sql        — query with positional ? for ids
 * @param {Array}    ids        — array of id values
 * @param {string}   groupByCol — column to group results by (e.g. 'patient_id')
 * @returns {Promise<Record<string, any[]>>}
 */
async function queryGrouped(sql, ids, groupByCol) {
  if (!ids.length) return {};
  const rows = await query(sql, ids);
  const map = {};
  for (const row of rows) {
    const key = row[groupByCol];
    if (!map[key]) map[key] = [];
    map[key].push(row);
  }
  return map;
}

/**
 * Build a comma-separated list of ? placeholders for an IN clause.
 * @param {Array} arr
 * @returns {string}  e.g. "?,?,?"
 */
function placeholders(arr) {
  return arr.map(() => '?').join(',');
}

/**
 * Ejecuta una query con SELECT ... FOR UPDATE dentro de una transacción.
 * Úsalo en operaciones críticas concurrentes para evitar race conditions.
 *
 * Ejemplo — debitar saldo (evita doble débito):
 *   await db.withLock(async (conn) => {
 *     const account = await conn.lockQuery(
 *       'SELECT * FROM accounts WHERE id = :id FOR UPDATE',
 *       { id: accountId }
 *     );
 *     if (account.balance < amount) throw new AppError('Saldo insuficiente', 422);
 *     await conn.query('UPDATE accounts SET balance = balance - :amount WHERE id = :id', { amount, id: accountId });
 *   });
 *
 * @param {(conn: DecoratedConnection) => Promise<any>} fn
 */
async function withLock(fn) {
  return transaction(fn);
}

/**
 * Shorthand: SELECT ... FOR UPDATE de una sola fila dentro de una transacción.
 * Devuelve la fila bloqueada o null si no existe.
 * La transacción se gestiona automáticamente.
 *
 * @param {string} sql    — debe incluir FOR UPDATE al final
 * @param {object} params
 */
async function lockQuery(sql, params) {
  return transaction(async (conn) => conn.queryOne(sql, params));
}

/**
 * OT-083: Verify that critical search indexes exist. Logs warnings if missing.
 * Non-destructive — reads only from INFORMATION_SCHEMA.
 * Call once at startup (from serviceBase or individual service index).
 */
const CRITICAL_INDEXES = [
  { table: 'users',  columns: ['email'],     keyName: 'idx_users_email' },
  { table: 'users',  columns: ['org_id'],    keyName: 'idx_users_org_id' },
  { table: 'clients', columns: ['email'],    keyName: 'idx_clients_email' },
  { table: 'clients', columns: ['branch_id'], keyName: 'idx_clients_branch_id' },
  { table: 'patients', columns: ['branch_id'], keyName: 'idx_patients_branch_id' },
  { table: 'appointments', columns: ['branch_id', 'scheduled_date'], keyName: 'idx_appointments_branch_date' },
];

async function verifyIndexes() {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const rows = await query(
      `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('users','clients','patients','appointments')`,
      {}
    );
    const existing = new Set(rows.map((r) => `${r.TABLE_NAME}.${r.INDEX_NAME}`));

    for (const idx of CRITICAL_INDEXES) {
      const key = `${idx.table}.${idx.keyName}`;
      if (!existing.has(key)) {
        getLogger().warn('Missing critical DB index — search performance may be degraded', {
          table:   idx.table,
          columns: idx.columns.join(', '),
          keyName: idx.keyName,
          suggestion: `CREATE INDEX ${idx.keyName} ON ${idx.table} (${idx.columns.join(', ')});`,
        });
      }
    }
  } catch (err) {
    // Non-critical — log only
    getLogger().warn('verifyIndexes check failed', { message: err.message });
  }
}

module.exports = {
  getPool,
  getReadPool,
  query,
  queryRead,
  queryOne,
  queryOneRead,
  callProc,
  transaction,
  queryGrouped,
  placeholders,
  withLock,
  lockQuery,
  verifyIndexes,  // OT-083
};
