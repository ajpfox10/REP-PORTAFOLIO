import type Redis from "ioredis";
import { type Pool } from "mysql2/promise";

export type FeatureFlagKey = string;

export function buildFeatureFlags(opts: { masterPool: Pool; redis: Redis; ttlSeconds?: number }) {
  const ttl = opts.ttlSeconds ?? 60;

  async function isEnabled(tenantId: string, key: FeatureFlagKey, fallback = false): Promise<boolean> {
    const cacheKey = `ff:${tenantId}:${key}`;
    const cached = await opts.redis.get(cacheKey);
    if (cached !== null) return cached === "1";

    const [rows] = await opts.masterPool.query<any[]>(
      "SELECT enabled FROM tenant_features WHERE tenant_id=? AND feature_key=? LIMIT 1",
      [tenantId, key]
    );
    const enabled = rows?.length ? Boolean(rows[0].enabled) : fallback;
    await opts.redis.set(cacheKey, enabled ? "1" : "0", "EX", ttl);
    return enabled;
  }

  async function setFlag(tenantId: string, key: FeatureFlagKey, enabled: boolean) {
    await opts.masterPool.query(
      "INSERT INTO tenant_features (tenant_id, feature_key, enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)",
      [tenantId, key, enabled ? 1 : 0]
    );
    await opts.redis.del(`ff:${tenantId}:${key}`);
  }

  return { isEnabled, setFlag };
}

export type FeatureFlags = ReturnType<typeof buildFeatureFlags>;
