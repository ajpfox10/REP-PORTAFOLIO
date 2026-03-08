/**
 * DB Connection Pools — v10  (S-10)
 *
 * Added TLS support for MySQL connections.
 * In production (DB_SSL_ENABLED=true):
 *   - ssl.rejectUnauthorized = true  → rejects self-signed or invalid certs
 *   - ssl.ca = DB_SSL_CA             → PEM string of the CA cert (RDS, CloudSQL, etc.)
 *
 * In development (DB_SSL_ENABLED=false or unset):
 *   - TLS not required (local Docker MySQL without cert)
 *
 * validateEnv() enforces that NODE_ENV=production implies DB_SSL_ENABLED=true.
 *
 * Setup for AWS RDS:
 *   DB_SSL_ENABLED=true
 *   DB_SSL_CA=$(cat rds-ca-2019-root.pem)   # or mount as secret
 */

import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import { type AppConfig } from "../config/types.js";

function sslOptions(config: AppConfig): PoolOptions["ssl"] {
  if (!config.dbSslEnabled) return undefined;
  return {
    rejectUnauthorized: true,
    ...(config.dbSslCa ? { ca: config.dbSslCa } : {}),
  };
}

export function buildMasterPool(config: AppConfig): Pool {
  return mysql.createPool({
    host:               config.masterDb.host,
    port:               config.masterDb.port,
    user:               config.masterDb.user,
    password:           config.masterDb.password,
    database:           config.masterDb.name,
    waitForConnections: true,
    connectionLimit:    10,
    enableKeepAlive:    true,
    ssl:                sslOptions(config),   // S-10
  });
}

export function buildTenantPoolFactory(config: AppConfig) {
  const pools = new Map<string, Pool>();

  return (dbName: string): Pool => {
    const existing = pools.get(dbName);
    if (existing) return existing;

    const pool = mysql.createPool({
      host:               config.tenantDb.host,
      port:               config.tenantDb.port,
      user:               config.tenantDb.user,
      password:           config.tenantDb.password,
      database:           dbName,
      waitForConnections: true,
      connectionLimit:    10,
      enableKeepAlive:    true,
      ssl:                sslOptions(config),  // S-10
    });

    pools.set(dbName, pool);
    return pool;
  };
}
