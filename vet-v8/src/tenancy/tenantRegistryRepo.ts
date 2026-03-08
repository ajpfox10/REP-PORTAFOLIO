import { type Pool } from "mysql2/promise";

export async function ensureMasterSchema(masterPool: Pool) {
  await masterPool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id VARCHAR(64) PRIMARY KEY,
      subdomain VARCHAR(128) UNIQUE,
      db_name VARCHAR(128),
      status VARCHAR(32) DEFAULT 'active',
      plan VARCHAR(32) DEFAULT 'basic',
      region VARCHAR(16) DEFAULT 'AR',
      default_locale VARCHAR(8) DEFAULT 'es'
    )
  `);
  await masterPool.query(`
    CREATE TABLE IF NOT EXISTS tenant_plugins (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      tenant_id VARCHAR(64),
      plugin_key VARCHAR(128),
      enabled TINYINT DEFAULT 1,
      UNIQUE KEY uq_tenant_plugin (tenant_id, plugin_key)
    )
  `);

  // Feature flags per tenant
  await masterPool.query(`
    CREATE TABLE IF NOT EXISTS tenant_features (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      tenant_id VARCHAR(64) NOT NULL,
      feature_key VARCHAR(128) NOT NULL,
      enabled TINYINT DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_tenant_feature (tenant_id, feature_key),
      INDEX idx_tenant (tenant_id)
    )
  `);

  // Optional plan overrides (quota / limits)
  await masterPool.query(`
    CREATE TABLE IF NOT EXISTS tenant_plan_overrides (
      tenant_id VARCHAR(64) PRIMARY KEY,
      overrides_json JSON NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}
export async function findTenantBySubdomain(masterPool: Pool, subdomain: string) {
  const [rows] = await masterPool.query<any[]>("SELECT tenant_id, db_name, status, plan, region, default_locale FROM tenants WHERE subdomain=? LIMIT 1", [subdomain]);
  return rows?.[0] ?? null;
}
