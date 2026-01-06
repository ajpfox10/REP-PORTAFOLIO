import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const boolFromString = (v: string | undefined, def: boolean) => {
  if (v === undefined) return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};


const parseTrustProxy = (v: string | undefined): boolean | number | string => {
  if (v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (["0", "false", "off", "no"].includes(lower)) return false;
  // treat "true" as "1" to avoid permissive trust proxy mode
  if (["true", "1", "on", "yes"].includes(lower)) return 1;
  if (/^\d+$/.test(lower)) return Number(lower);
  return s; // e.g. "loopback"
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.string().optional().default("0"),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().optional().default(""),

  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_POOL_MIN: z.coerce.number().int().nonnegative().default(0),
  DB_POOL_ACQUIRE_MS: z.coerce.number().int().positive().default(30000),
  DB_POOL_IDLE_MS: z.coerce.number().int().positive().default(10000),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  SCHEMA_CACHE_PATH: z.string().default("./.cache/schema.json"),

  IP_ALLOWLIST: z.string().optional().default(""),
  IP_BLACKLIST: z.string().optional().default(""),

  CORS_ALLOW_ALL: z.string().optional(),
  CORS_DENYLIST: z.string().optional().default(""),

  RATE_LIMIT_ENABLE: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  METRICS_ENABLE: z.string().optional(),
  METRICS_PATH: z.string().default("/metrics"),
  METRICS_PROTECT: z.string().optional(),

  LOG_DIR: z.string().default("./logs"),
  LOG_LEVEL: z.string().default("info"),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  ENABLE_COMPRESSION: z.string().optional(),
  ENABLE_REQUEST_BODY_LIMITS: z.string().optional(),
  ENABLE_HARDENING: z.string().optional(),

  ENABLE_OPENAPI_VALIDATION: z.string().optional(),
  OPENAPI_PATH: z.string().optional().default("docs/openapi.yaml")
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ .env inválido:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  TRUST_PROXY: parseTrustProxy(raw.TRUST_PROXY),
  CORS_ALLOW_ALL: boolFromString(raw.CORS_ALLOW_ALL, true),
  RATE_LIMIT_ENABLE: boolFromString(raw.RATE_LIMIT_ENABLE, true),
  METRICS_ENABLE: boolFromString(raw.METRICS_ENABLE, true),
  METRICS_PROTECT: boolFromString(raw.METRICS_PROTECT, false),

  ENABLE_COMPRESSION: boolFromString(raw.ENABLE_COMPRESSION, true),
  ENABLE_REQUEST_BODY_LIMITS: boolFromString(raw.ENABLE_REQUEST_BODY_LIMITS, true),
  ENABLE_HARDENING: boolFromString(raw.ENABLE_HARDENING, true),

  ENABLE_OPENAPI_VALIDATION: boolFromString(raw.ENABLE_OPENAPI_VALIDATION, true)
};
