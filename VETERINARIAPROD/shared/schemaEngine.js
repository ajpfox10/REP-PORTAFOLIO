'use strict';
/**
 * Schema Engine — lee el schema de MySQL y genera tipos TypeScript y Zod.
 * Solo expone tablas permitidas (excluye tablas sensibles de auth).
 * Cache Redis 1 hora.
 */
const db     = require('./db');
const cache  = require('./cache');
const logger = require('./logger');

const SCHEMA_CACHE_TTL = 3600; // 1 hora

// Tablas PERMITIDAS para exposición via API (excluye tablas de auth/seguridad/auditoría).
// SEC: se eliminaron las siguientes tablas que contenían información sensible:
//   - security_alerts: expone incidentes de seguridad que podrían usarse para enumerar vectores
//   - business_rules:  puede revelar reglas de negocio internas (condiciones de bypass, horarios, etc.)
//   - data_retention_policies: revela ventanas de tiempo de retención útiles para timing attacks
const ALLOWED_TABLES = new Set([
  'patients', 'clients', 'patient_owners', 'species', 'breeds',
  'appointments', 'medical_records', 'diagnoses', 'prescriptions',
  'prescription_items', 'lab_orders', 'lab_order_items', 'lab_results',
  'imaging_studies', 'surgeries', 'hospitalizations', 'vaccinations',
  'invoices', 'invoice_items', 'payments', 'products', 'stock_movements',
  'branches', 'org_plugins',
]);

// Mapeo MySQL type → TypeScript type
const MYSQL_TO_TS = {
  int:        'number',
  bigint:     'number',
  smallint:   'number',
  tinyint:    'number',
  mediumint:  'number',
  float:      'number',
  double:     'number',
  decimal:    'number',
  varchar:    'string',
  char:       'string',
  text:       'string',
  mediumtext: 'string',
  longtext:   'string',
  enum:       'string',
  set:        'string',
  date:       'string',
  datetime:   'string',
  timestamp:  'string',
  time:       'string',
  year:       'number',
  boolean:    'boolean',
  bool:       'boolean',
  json:       'Record<string, unknown>',
  blob:       'Buffer',
};

// Mapeo MySQL type → Zod validator
const MYSQL_TO_ZOD = {
  int:        'z.number().int()',
  bigint:     'z.number().int()',
  smallint:   'z.number().int()',
  tinyint:    'z.number().int()',
  mediumint:  'z.number().int()',
  float:      'z.number()',
  double:     'z.number()',
  decimal:    'z.number()',
  varchar:    (col) => `z.string().max(${col.CHARACTER_MAXIMUM_LENGTH || 255})`,
  char:       (col) => `z.string().max(${col.CHARACTER_MAXIMUM_LENGTH || 50})`,
  text:       'z.string()',
  mediumtext: 'z.string()',
  longtext:   'z.string()',
  enum:       (col) => {
    const vals = col.COLUMN_TYPE.match(/enum\((.+)\)/)?.[1]
      ?.split(',').map(v => v.trim().replace(/'/g, '')) || [];
    return vals.length ? `z.enum([${vals.map(v => `'${v}'`).join(', ')}])` : 'z.string()';
  },
  date:       'z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/)',
  datetime:   'z.string().datetime()',
  timestamp:  'z.string().datetime()',
  boolean:    'z.boolean()',
  bool:       'z.boolean()',
  json:       'z.record(z.unknown())',
};

/**
 * Lee las columnas de una tabla desde INFORMATION_SCHEMA.
 * SEC: solo se permiten tablas de la lista ALLOWED_TABLES para evitar exposición
 * de tablas sensibles (sessions, users, security_alerts, etc.) via llamadas directas.
 */
async function getTableColumns(tableName, dbName) {
  // SEC: validar contra la lista blanca incluso en llamadas directas a esta función
  if (!ALLOWED_TABLES.has(tableName)) {
    throw Object.assign(new Error(`Table '${tableName}' is not available`), { http: 404 });
  }
  const dbSchema = dbName || process.env.DB_NAME || 'vetmanager';
  return db.query(
    `SELECT
       COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, COLUMN_KEY, COLUMN_COMMENT
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :dbSchema AND TABLE_NAME = :tableName
     ORDER BY ORDINAL_POSITION`,
    { dbSchema, tableName },
  );
}

/**
 * Lista todas las tablas permitidas.
 */
async function listAllowedTables(dbName) {
  const dbSchema = dbName || process.env.DB_NAME || 'vetmanager';
  const rows = await db.query(
    `SELECT TABLE_NAME, TABLE_ROWS, CREATE_TIME, TABLE_COMMENT
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = :dbSchema AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    { dbSchema },
  );
  return rows.filter(r => ALLOWED_TABLES.has(r.TABLE_NAME));
}

/**
 * Retorna el schema JSON de una tabla (columnas con tipos).
 */
async function getTableSchema(tableName) {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw Object.assign(new Error(`Table '${tableName}' is not available`), { http: 404 });
  }

  const cacheKey = `schema:table:${tableName}`;
  try {
    const rc = await cache.getClient();
    const cached = await rc.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* ignorar */ }

  const columns = await getTableColumns(tableName);
  const schema = {
    table:   tableName,
    columns: columns.map(col => {
      const baseType = col.DATA_TYPE.toLowerCase();
      return {
        name:       col.COLUMN_NAME,
        type:       baseType,
        nullable:   col.IS_NULLABLE === 'YES',
        primaryKey: col.COLUMN_KEY === 'PRI',
        default:    col.COLUMN_DEFAULT,
        maxLength:  col.CHARACTER_MAXIMUM_LENGTH,
        enumValues: baseType === 'enum'
          ? col.COLUMN_TYPE.match(/enum\((.+)\)/)?.[1]?.split(',').map(v => v.trim().replace(/'/g, ''))
          : undefined,
        comment:    col.COLUMN_COMMENT || undefined,
      };
    }),
    generatedAt: new Date().toISOString(),
  };

  try {
    const rc = await cache.getClient();
    await rc.setEx(cacheKey, SCHEMA_CACHE_TTL, JSON.stringify(schema));
  } catch { /* ignorar */ }

  return schema;
}

/**
 * Genera una interfaz TypeScript desde el schema de una tabla.
 */
async function generateTypeScript(tableName) {
  const schema  = await getTableSchema(tableName);
  const iName   = tableName.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('');

  const fields = schema.columns.map(col => {
    const base    = col.DATA_TYPE.toLowerCase();
    let tsType    = MYSQL_TO_TS[base] || 'unknown';
    // tinyint(1) → boolean
    if (base === 'tinyint' && col.maxLength === 1) tsType = 'boolean';
    const optional = col.nullable || col.default != null;
    return `  ${col.name}${optional ? '?' : ''}: ${tsType}${col.nullable ? ' | null' : ''};`;
  });

  return [
    `// Auto-generated by VetManager Schema Engine — ${new Date().toISOString()}`,
    `export interface ${iName} {`,
    ...fields,
    `}`,
  ].join('\n');
}

/**
 * Genera un schema Zod desde el schema de una tabla.
 */
async function generateZodSchema(tableName) {
  const schema = await getTableSchema(tableName);
  const sName  = tableName.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('') + 'Schema';

  const fields = schema.columns.map(col => {
    const base = col.DATA_TYPE.toLowerCase();
    const zodFn = MYSQL_TO_ZOD[base];
    let zodExpr = typeof zodFn === 'function' ? zodFn(col) : (zodFn || 'z.unknown()');
    // tinyint(1) → boolean
    if (base === 'tinyint' && col.maxLength === 1) zodExpr = 'z.boolean()';
    if (col.nullable) zodExpr += '.nullable()';
    if (col.nullable || col.default != null) zodExpr += '.optional()';
    return `  ${col.name}: ${zodExpr},`;
  });

  return [
    `// Auto-generated by VetManager Schema Engine — ${new Date().toISOString()}`,
    `import { z } from 'zod';`,
    ``,
    `export const ${sName} = z.object({`,
    ...fields,
    `});`,
    ``,
    `export type ${sName.replace('Schema', '')} = z.infer<typeof ${sName}>;`,
  ].join('\n');
}

module.exports = { getTableSchema, listAllowedTables, generateTypeScript, generateZodSchema, ALLOWED_TABLES };
