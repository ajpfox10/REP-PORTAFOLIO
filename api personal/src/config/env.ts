// src/config/env.ts
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";
import fs from "fs";

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
  z.preprocess((v) => (v === undefined || v === null ? def : String(v).trim()), z.string());

const listish = (def: string[] = []) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return def;
    return String(v)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }, z.array(z.string()));

const schema = z.object({
  // Core tables configuration
  CORE_TABLES: strish(''),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: intish(3000),

  TRUST_PROXY: boolish.default(false),

  // DB - Production/Development
  DB_HOST: z.string().min(1),
  DB_PORT: intish(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: strish(""),

  // 🔥 AGREGADO: DB - Test Environment
  DB_HOST_TEST: strish(""),
  DB_PORT_TEST: intish(3306),
  DB_NAME_TEST: strish(""),
  DB_USER_TEST: strish(""),
  DB_PASSWORD_TEST: strish(""),

  DB_POOL_MAX: intish(10),
  DB_POOL_MIN: intish(0),
  DB_POOL_ACQUIRE_MS: intish(30000),
  DB_POOL_IDLE_MS: intish(10000),
  DB_QUERY_TIMEOUT_MS: intish(30000),

  MIGRATIONS_ENABLE: boolish.default(false),
  MIGRATIONS_DIR: strish("scripts/migrations"),
  SCHEMA_CACHE_PATH: strish("./.cache/schema.json"),

  LOG_DIR: strish("./logs"),
  LOG_LEVEL: strish("info"),
  LOG_RETENTION_DAYS: intish(30),

  ENABLE_OPENAPI_VALIDATION: boolish.default(false),
  OPENAPI_PATH: strish("docs/openapi.yaml"),
  OPENAPI_AUTO_GENERATE: boolish.default(true),
  OPENAPI_AUTO_OUTPUT: strish("docs/openapi.generated.yaml"),

  ENABLE_HARDENING: boolish.default(false),
  ENABLE_COMPRESSION: boolish.default(false),
  ENABLE_REQUEST_BODY_LIMITS: boolish.default(false),

  CORS_ALLOW_ALL: boolish.default(true),
  CORS_ALLOWLIST: strish(""),
  CORS_DENYLIST: strish(""),

  IP_GUARD_ENABLE: boolish.default(false),
  IP_ALLOWLIST: strish(""),
  IP_BLACKLIST: strish(""),

  DOCS_ENABLE: boolish.default(true),
  DOCS_PATH: strish("/docs"),
  DOCS_PROTECT: z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return true;
      if (v === "true" || v === "1" || v === "yes" || v === "y") return true;
      if (v === "false" || v === "0" || v === "no" || v === "n") return false;
      return Boolean(v);
    },
    z.boolean()
  ).default(true),

  // ✅ NUEVO: Rate limit por usuario
  RATE_LIMIT_BY_USER: boolish.default(false),

  RATE_LIMIT_ENABLE: boolish.default(true),
  RATE_LIMIT_WINDOW_MS: intish(900000),
  RATE_LIMIT_MAX: intish(300),

  RATE_LIMIT_USE_REDIS: boolish.default(false),
  REDIS_URL: strish(""),
  REDIS_CONNECT_TIMEOUT_MS: intish(5000),

  AUTH_RATE_LIMIT_WINDOW_MS: intish(10 * 60_000),
  AUTH_LOGIN_RATE_LIMIT_MAX: intish(20),
  AUTH_REFRESH_RATE_LIMIT_MAX: intish(60),

  METRICS_ENABLE: boolish.default(false),
  METRICS_PATH: strish("/metrics"),
  METRICS_PROTECT: boolish.default(false),
  METRICS_TOKEN: strish(""),

  CRUD_STRICT_ALLOWLIST: boolish.default(false),
  CRUD_TABLE_ALLOWLIST: strish(""),
  CRUD_TABLE_DENYLIST: strish(""),
  CRUD_READONLY: boolish.default(false),

  AUTH_ENABLE: boolish.default(true),
  RBAC_ENABLE: boolish.default(true),
  AUTH_ALLOW_DEV_USER_ID_HEADER: boolish.default(true),
  AUTH_BEARER_MODE: z.enum(["auto", "jwt", "api_key"]).default("auto"),

  JWT_ACCESS_SECRET: strish(""),
  JWT_REFRESH_SECRET: strish(""),
  JWT_ACCESS_TTL_SECONDS: intish(3600),
  JWT_REFRESH_TTL_DAYS: intish(7),

  // Email configuration
  EMAIL_ENABLE: boolish.default(false),
  EMAIL_HOST: strish(""),
  EMAIL_PORT: intish(587),
  EMAIL_SECURE: boolish.default(false),
  EMAIL_USER: strish(""),
  EMAIL_PASSWORD: strish(""),
  EMAIL_FROM: strish(""),

  // Password reset
  PASSWORD_RESET_TOKEN_TTL_HOURS: intish(1),
  PASSWORD_RESET_URL_BASE: strish(""),

  // 2FA configuration
  ENABLE_2FA: boolish.default(false),
  TWO_FA_CODE_TTL_MINUTES: intish(10),
  TWO_FA_CODE_LENGTH: intish(6),

  DOCUMENTS_BASE_DIR: z.string().min(3),

  DOCUMENTS_ALLOWED_MIME: listish([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  DOCUMENTS_MAX_BYTES: intish(25 * 1024 * 1024),

  DOCUMENTS_SCAN_ENABLE: boolish.default(false),
  DOCUMENTS_SCAN_MODE: z.enum(["clamd", "clamscan", "cli"]).default("clamscan"),
  DOCUMENTS_CLAMD_HOST: strish("127.0.0.1"),
  DOCUMENTS_CLAMD_PORT: intish(3310),
  DOCUMENTS_CLAMSCAN_PATH: strish("clamscan"),
  DOCUMENTS_SCAN_TIMEOUT_MS: intish(30000),
  DOCUMENTS_SCAN_FAIL_CLOSED: boolish.default(true), 

  PHOTOS_BASE_DIR: strish(""),

  REQUEST_TIMEOUT_MS: intish(60000),

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

// 🔥 AGREGADO: Si estamos en test y hay variables _TEST, usarlas
const isTestEnv = raw.NODE_ENV === 'test';
const dbConfig = isTestEnv && raw.DB_HOST_TEST ? {
  DB_HOST: raw.DB_HOST_TEST || raw.DB_HOST,
  DB_PORT: raw.DB_PORT_TEST || raw.DB_PORT,
  DB_NAME: raw.DB_NAME_TEST || raw.DB_NAME,
  DB_USER: raw.DB_USER_TEST || raw.DB_USER,
  DB_PASSWORD: raw.DB_PASSWORD_TEST || raw.DB_PASSWORD,
} : {
  DB_HOST: raw.DB_HOST,
  DB_PORT: raw.DB_PORT,
  DB_NAME: raw.DB_NAME,
  DB_USER: raw.DB_USER,
  DB_PASSWORD: raw.DB_PASSWORD,
};

export const env = {
  ...raw,
  ...dbConfig, // 🔥 Override con las variables de test si estamos en NODE_ENV=test
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
    if (env.JWT_ACCESS_SECRET?.length < 32) errors.push("JWT_ACCESS_SECRET debería tener al menos 32 caracteres");
    if (env.JWT_REFRESH_SECRET?.length < 32) errors.push("JWT_REFRESH_SECRET debería tener al menos 32 caracteres");
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
  if (env.METRICS_TOKEN && env.METRICS_TOKEN.length < 16) {
    errors.push("METRICS_TOKEN debería tener al menos 16 caracteres");
  }

  if (env.PROD_DISALLOW_CORS_ALLOW_ALL && env.CORS_ALLOW_ALL && env.CORS_ALLOWLIST.length === 0) {
    errors.push("En production: setear CORS_ALLOWLIST (y/o CORS_ALLOW_ALL=false)");
  }

  if (!env.TRUST_PROXY) {
    errors.push("Recomendado en production: TRUST_PROXY=true (si hay reverse proxy)");
  }

  if (!env.DOCUMENTS_BASE_DIR?.trim()) {
    errors.push("DOCUMENTS_BASE_DIR requerido en production");
  } else {
    try {
      const baseDir = env.DOCUMENTS_BASE_DIR;
      if (!fs.existsSync(baseDir)) {
        errors.push(`DOCUMENTS_BASE_DIR no existe: ${baseDir}`);
      } else {
        const stats = fs.statSync(baseDir);
        if (!stats.isDirectory()) {
          errors.push(`DOCUMENTS_BASE_DIR no es un directorio: ${baseDir}`);
        }
        try {
          fs.accessSync(baseDir, fs.constants.R_OK);
        } catch {
          errors.push(`DOCUMENTS_BASE_DIR sin permiso de lectura: ${baseDir}`);
        }
      }
    } catch (e: any) {
      errors.push(`Error validando DOCUMENTS_BASE_DIR: ${e?.message || e}`);
    }
  }

  if (env.PHOTOS_BASE_DIR?.trim()) {
    try {
      const photosDir = env.PHOTOS_BASE_DIR;
      if (photosDir !== env.DOCUMENTS_BASE_DIR) {
        if (!fs.existsSync(photosDir)) {
          errors.push(`PHOTOS_BASE_DIR no existe: ${photosDir}`);
        }
      }
    } catch (e: any) {
      errors.push(`Error validando PHOTOS_BASE_DIR: ${e?.message || e}`);
    }
  }

  if (env.RATE_LIMIT_USE_REDIS) {
    if (!env.REDIS_URL?.trim()) {
      errors.push("REDIS_URL requerido cuando RATE_LIMIT_USE_REDIS=true");
    }
    if (!env.REDIS_CONNECT_TIMEOUT_MS || env.REDIS_CONNECT_TIMEOUT_MS < 1000) {
      errors.push("REDIS_CONNECT_TIMEOUT_MS debe ser al menos 1000ms");
    }
  }

  if (env.RATE_LIMIT_ENABLE) {
    if (env.RATE_LIMIT_WINDOW_MS < 1000) {
      errors.push("RATE_LIMIT_WINDOW_MS debe ser al menos 1000ms");
    }
    if (env.RATE_LIMIT_MAX < 1) {
      errors.push("RATE_LIMIT_MAX debe ser al menos 1");
    }
  }

  if (!env.DB_HOST?.trim()) errors.push("DB_HOST requerido");
  if (!env.DB_NAME?.trim()) errors.push("DB_NAME requerido");
  if (!env.DB_USER?.trim()) errors.push("DB_USER requerido");

  if (env.ENABLE_OPENAPI_VALIDATION) {
    if (!env.OPENAPI_PATH?.trim()) {
      errors.push("OPENAPI_PATH requerido cuando ENABLE_OPENAPI_VALIDATION=true");
    }
  }

  if (!env.CORE_TABLES?.trim()) {
    errors.push("CORE_TABLES vacío - se usará el default hardcodeado");
  }

  if (errors.length) {
    throw new Error(
      "❌ Config inválida para production:\n" + 
      errors.map((e) => `  - ${e}`).join("\n")
    );
  }
}
