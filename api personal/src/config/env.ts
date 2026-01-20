// src/config/env.ts
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

// carga robusta .env (en root y en src/config)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const boolish = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "si", "sí", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return v;
}, z.boolean());

const intish = (def: number) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }, z.number().int());

const strish = (def = "") =>
  z.preprocess((v) => (v === undefined || v === null ? def : String(v)), z.string());

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

  // Middlewares
  ENABLE_HARDENING: boolish.default(false),
  ENABLE_COMPRESSION: boolish.default(false),
  ENABLE_REQUEST_BODY_LIMITS: boolish.default(false),

  // CORS
  // Default seguro: en LAN/produccion pon tu origin del front y deja esto en false.
  CORS_ALLOW_ALL: boolish.default(false),
  CORS_ALLOWLIST: strish(""),
  CORS_DENYLIST: strish(""),


  // IP allow/black
  IP_GUARD_ENABLE: boolish.default(false),
  IP_ALLOWLIST: strish(""),
  IP_BLACKLIST: strish(""),

  // Docs (OpenAPI file)
  DOCS_ENABLE: boolish.default(true),
  DOCS_PATH: strish("/docs"),
  DOCS_PROTECT: boolish.default(true),

  // Rate limit
  RATE_LIMIT_WINDOW_MS: intish(900000),
  RATE_LIMIT_MAX: intish(300),

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

  // Auth cookies (CIA mode)
  AUTH_REFRESH_COOKIE: boolish.default(true),
  COOKIE_SECURE: boolish.default(false),
  COOKIE_DOMAIN: strish(""),

  // JWT
  JWT_ACCESS_SECRET: strish(""),
  JWT_REFRESH_SECRET: strish(""),
  JWT_ACCESS_TTL_SECONDS: intish(3600),
  JWT_REFRESH_TTL_DAYS: intish(14),



  // Server timeout
  REQUEST_TIMEOUT_MS: intish(60000),
  
  // foto agente, documentos
  DOCUMENTS_BASE_DIR: z.string().min(3).default("D:/G/DOCU"),

});

const raw = schema.parse(process.env);

export const env = {
  ...raw,
  CORS_ALLOWLIST: raw.CORS_ALLOWLIST.split(",").map((x: string) => x.trim()).filter(Boolean),
  CORS_DENYLIST: raw.CORS_DENYLIST.split(",").map((x: string) => x.trim()).filter(Boolean),
} as const;

export type Env = typeof env;
