// src/config/env.ts
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

// carga robusta .env (en root y en src/config)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const boolish = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const s = String(v).trim().toLowerCase();
    if (["1", "true", "yes", "y", "si", "sí", "on"].includes(s)) return true;
    if (["0", "false", "no", "n", "off"].includes(s)) return false;
    return v;
  },
  z.boolean()
);

const intish = (def: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return def;
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    },
    z.number().int()
  );

const strish = (def = "") =>
  z.preprocess((v) => (v === undefined || v === null ? def : String(v)), z.string());

const listish = (def: string[] = []) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return def;
    return String(v)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }, z.array(z.string()));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: intish(3000),

  TRUST_PROXY: boolish.default(false),

  // DB
  DB_HOST: z.string().min(1),
  DB_PORT: intish(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: strish(""),

  // Pool/timeout
  DB_POOL_MAX: intish(10),
  DB_POOL_MIN: intish(0),
  DB_POOL_ACQUIRE_MS: intish(30000),
  DB_POOL_IDLE_MS: intish(10000),
  DB_QUERY_TIMEOUT_MS: intish(30000),

  // Migrations / schema cache
  MIGRATIONS_ENABLE: boolish.default(false),
  MIGRATIONS_DIR: strish("scripts/migrations"),
  SCHEMA_CACHE_PATH: strish("./.cache/schema.json"),

  // Logs
  LOG_DIR: strish("./logs"),
  LOG_LEVEL: strish("info"),
  LOG_RETENTION_DAYS: intish(30),

  // OpenAPI
  ENABLE_OPENAPI_VALIDATION: boolish.default(false),
  OPENAPI_PATH: strish("docs/openapi.yaml"),
  OPENAPI_AUTO_GENERATE: boolish.default(true),
  OPENAPI_AUTO_OUTPUT: strish("docs/openapi.generated.yaml"),

  // Middlewares
  ENABLE_HARDENING: boolish.default(false),
  ENABLE_COMPRESSION: boolish.default(false),
  ENABLE_REQUEST_BODY_LIMITS: boolish.default(false),

  // CORS
  CORS_ALLOW_ALL: boolish.default(true),
  CORS_ALLOWLIST: strish(""),
  CORS_DENYLIST: strish(""),

  // IP allow/black
  IP_GUARD_ENABLE: boolish.default(false),
  IP_ALLOWLIST: strish(""),
  IP_BLACKLIST: strish(""),

  // Docs
  DOCS_ENABLE: boolish.default(true),
  DOCS_PATH: strish("/docs"),
  DOCS_PROTECT: boolish.default(true),

  // Rate limit (global)
  RATE_LIMIT_WINDOW_MS: intish(900000),
  RATE_LIMIT_MAX: intish(300),

  // ✅ Rate limit fino (auth)
  AUTH_RATE_LIMIT_WINDOW_MS: intish(10 * 60_000),
  AUTH_LOGIN_RATE_LIMIT_MAX: intish(20),
  AUTH_REFRESH_RATE_LIMIT_MAX: intish(60),

  // Metrics
  METRICS_ENABLE: boolish.default(false),
  METRICS_PATH: strish("/metrics"),
  METRICS_PROTECT: boolish.default(false),
  METRICS_TOKEN: strish(""),

  // CRUD
  CRUD_STRICT_ALLOWLIST: boolish.default(false),
  CRUD_TABLE_ALLOWLIST: strish(""),
  CRUD_TABLE_DENYLIST: strish(""),
  CRUD_READONLY: boolish.default(false),

  // Auth / RBAC
  AUTH_ENABLE: boolish.default(true),
  RBAC_ENABLE: boolish.default(true),
  AUTH_ALLOW_DEV_USER_ID_HEADER: boolish.default(true),
  AUTH_BEARER_MODE: z.enum(["auto", "jwt", "api_key"]).default("auto"),

  // JWT
  JWT_ACCESS_SECRET: strish(""),
  JWT_REFRESH_SECRET: strish(""),
  JWT_ACCESS_TTL_SECONDS: intish(3600),
  JWT_REFRESH_TTL_DAYS: intish(7),

  // Documents
  DOCUMENTS_BASE_DIR: z.string().min(3),

  // ✅ Allowlist de MIME (para fileSecurity.ts)
  DOCUMENTS_ALLOWED_MIME: listish([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  DOCUMENTS_MAX_BYTES: intish(25 * 1024 * 1024), // 25MB default


    // Antivirus
  DOCUMENTS_SCAN_ENABLE: boolish.default(false),
  DOCUMENTS_SCAN_MODE: z.enum(["clamd", "clamscan", "cli"]).default("clamscan"),
  DOCUMENTS_CLAMD_HOST: strish("127.0.0.1"),
  DOCUMENTS_CLAMD_PORT: intish(3310),
  DOCUMENTS_CLAMSCAN_PATH: strish("clamscan"),
  DOCUMENTS_SCAN_TIMEOUT_MS: intish(30000),
  DOCUMENTS_SCAN_FAIL_CLOSED: boolish.default(true), 

  // Fotos
  PHOTOS_BASE_DIR: strish(""),

  // Server timeout
  REQUEST_TIMEOUT_MS: intish(60000),

  // 7B: límites / prod hardening
  REQUEST_BODY_LIMIT_KB: intish(200),
  GRACEFUL_SHUTDOWN_MS: intish(15000),
  SERVER_HEADERS_TIMEOUT_MS: intish(65000),
  SERVER_KEEPALIVE_TIMEOUT_MS: intish(61000),

  PROD_FAIL_FAST: boolish.default(true),
  PROD_REQUIRE_DOCS_PROTECT: boolish.default(true),
  PROD_REQUIRE_METRICS_PROTECT: boolish.default(true),
  PROD_DISALLOW_CORS_ALLOW_ALL: boolish.default(true),
});

const raw = schema.parse(process.env);

export const env = {
  ...raw,
  PHOTOS_BASE_DIR: raw.PHOTOS_BASE_DIR?.trim() ? raw.PHOTOS_BASE_DIR : raw.DOCUMENTS_BASE_DIR,
  CORS_ALLOWLIST: String(raw.CORS_ALLOWLIST || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  CORS_DENYLIST: String(raw.CORS_DENYLIST || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;

export function assertProdEnvOrThrow() {
  if (env.NODE_ENV !== "production") return;
  if (!env.PROD_FAIL_FAST) return;

  const errors: string[] = [];

  if (env.AUTH_ENABLE) {
    if (!env.JWT_ACCESS_SECRET?.trim()) errors.push("JWT_ACCESS_SECRET requerido en production");
    if (!env.JWT_REFRESH_SECRET?.trim()) errors.push("JWT_REFRESH_SECRET requerido en production");
  }

  if (env.DOCS_ENABLE && env.PROD_REQUIRE_DOCS_PROTECT && !env.DOCS_PROTECT) {
    errors.push("DOCS_PROTECT debe ser true en production (o deshabilitar DOCS_ENABLE)");
  }

  if (env.METRICS_ENABLE && env.PROD_REQUIRE_METRICS_PROTECT && !env.METRICS_PROTECT) {
    errors.push("METRICS_PROTECT debe ser true en production (o deshabilitar METRICS_ENABLE)");
  }
  if (env.METRICS_ENABLE && env.METRICS_PROTECT && !env.METRICS_TOKEN?.trim()) {
    errors.push("METRICS_TOKEN requerido si METRICS_PROTECT=true");
  }

  if (env.PROD_DISALLOW_CORS_ALLOW_ALL && env.CORS_ALLOW_ALL && env.CORS_ALLOWLIST.length === 0) {
    errors.push("En production: setear CORS_ALLOWLIST (y/o CORS_ALLOW_ALL=false)");
  }

  if (!env.TRUST_PROXY) {
    errors.push("Recomendado en production: TRUST_PROXY=true (si hay reverse proxy)");
  }

  if (errors.length) {
    throw new Error(
      "❌ Config inválida para production:\n" + errors.map((e) => `- ${e}`).join("\n")
    );
  }
}
