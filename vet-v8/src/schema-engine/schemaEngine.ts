import { LRUCache } from "lru-cache";
import type Redis from "ioredis";
import { type Pool } from "mysql2/promise";
import { type AppConfig } from "../config/types.js";
import { introspectSchema, readSchemaVersion } from "./introspector.js";
import { type SchemaGraph } from "./types.js";

export function buildSchemaEngine(opts: { config: AppConfig; redis: Redis }) {
  const mem = new LRUCache<string, SchemaGraph>({ max: 500, ttl: opts.config.schemaCacheTtlSeconds * 1000 });

  return {
    async getSchema(tenantId: string, pool: Pool): Promise<SchemaGraph> {
      const version = await readSchemaVersion(pool);
      const key = `${tenantId}:${version}`;

      const m = mem.get(key);
      if (m) return m;

      const rKey = `schema:${key}`;
      const cached = await opts.redis.get(rKey);
      if (cached) {
        const g = JSON.parse(cached) as SchemaGraph;
        mem.set(key, g);
        return g;
      }

      const graph = await introspectSchema(pool, version);
      await opts.redis.set(rKey, JSON.stringify(graph), "EX", opts.config.schemaCacheTtlSeconds);
      mem.set(key, graph);
      return graph;
    }
  };
}
