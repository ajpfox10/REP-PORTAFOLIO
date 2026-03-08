import mysql, { type Pool } from "mysql2/promise";
import { type AppConfig } from "../config/types.js";

export function buildMasterPool(config: AppConfig): Pool {
  return mysql.createPool({
    host: config.masterDb.host,
    port: config.masterDb.port,
    user: config.masterDb.user,
    password: config.masterDb.password,
    database: config.masterDb.name,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true
  });
}

/**
 * FIX: Pool leak prevention — reuse pools per dbName.
 * Original code created a new Pool on every factory call,
 * causing connection exhaustion after cache TTL expiry.
 */
export function buildTenantPoolFactory(config: AppConfig) {
  const pools = new Map<string, Pool>();

  return (dbName: string): Pool => {
    const existing = pools.get(dbName);
    if (existing) return existing;

    const pool = mysql.createPool({
      host: config.tenantDb.host,
      port: config.tenantDb.port,
      user: config.tenantDb.user,
      password: config.tenantDb.password,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true
    });

    pools.set(dbName, pool);
    return pool;
  };
}
