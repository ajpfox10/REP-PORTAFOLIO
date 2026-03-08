import { type Request } from "express";
import { LRUCache } from "lru-cache";
import { type Pool } from "mysql2/promise";
import type Redis from "ioredis";
import { type AppConfig } from "../config/types.js";
import { AppError } from "../core/errors/appError.js";
import { type TenantContext } from "./types.js";
import { ensureMasterSchema, findTenantBySubdomain } from "./tenantRegistryRepo.js";

export function buildTenantResolver(opts: {
  config: AppConfig;
  masterPool: Pool;
  tenantPoolFactory: (dbName: string) => Pool;
  redis: Redis;
}) {
  const cache = new LRUCache<string, Omit<TenantContext, "userId" | "roles" | "sucursalId" | "veterinarioId">>({
    max: 500,
    ttl: opts.config.tenantConnCacheTtlSeconds * 1000
  });

  return {
    async resolve(req: Request): Promise<TenantContext> {
      const isInternal = (req.path ?? "").startsWith("/api/internal");
      const host = (req.headers.host ?? "").toLowerCase();
      const subdomain = parseSubdomain(host);
      const headerTenant = String(req.headers["x-internal-tenant"] ?? "").trim();
      const chosen = (isInternal && headerTenant) ? headerTenant : subdomain;

      if (!chosen) throw new AppError("TENANT_NOT_FOUND", "Tenant subdomain not found", { host });

      const cached = cache.get(chosen);
      if (cached) {
        // Return base context; auth middleware will enrich userId/roles
        return { ...cached };
      }

      await ensureMasterSchema(opts.masterPool);
      const t = await findTenantBySubdomain(opts.masterPool, chosen);
      if (!t) throw new AppError("TENANT_NOT_FOUND", "Tenant not registered", { subdomain: chosen });
      if (String(t.status) !== "active") throw new AppError("TENANT_DISABLED", "Tenant disabled");

      const base = {
        tenantId: String(t.tenant_id),
        dbName: String(t.db_name),
        tenantPool: opts.tenantPoolFactory(String(t.db_name)),
        plan: String(t.plan),
        region: String(t.region),
        locale: String(t.default_locale),
      };

      cache.set(chosen, base);
      return { ...base };
    }
  };
}

function parseSubdomain(host: string): string | null {
  const h = host.split(":")[0];
  const parts = h.split(".");
  if (parts.length < 2) return null;
  return parts[0] || null;
}
