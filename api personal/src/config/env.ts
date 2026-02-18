// src/config/env.ts
// ------------------------------------------------------------
// Config central del backend.
// - Carga variables desde .env
// - Valida y tipa con Zod (evita strings sueltos / configs rotas)
// - Normaliza booleanos, enteros y listas
// - Permite override automático de DB para NODE_ENV=test usando DB_*_TEST
// - En production aplica validaciones estrictas (fail-fast) para evitar
//   levantar el servicio con una config peligrosa o incompleta.
// ------------------------------------------------------------

import path from "path";
import dotenv from "dotenv";
import { z } from "zod";
import fs from "fs";

// Cargamos .env desde la raíz del proyecto.
// Mantengo ambos dotenv.config como lo tenías para compatibilidad con distintos layouts.
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * boolish:
 * Convierte strings típicos de env a boolean real.
 * Soporta variaciones en español/inglés.
 *
 * true:  "1", "true", "yes", "y", "si", "sí", "on"
 * false: "0", "false", "no", "n", "off"
 *
 * Si viene vacío, devuelve undefined y luego el schema aplica defaults.
 */
const boolish = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const s = String(v).trim().toLowerCase();
    if (["1", "true", "yes", "y", "si", "sí", "on"].includes(s)) return true;
    if (["0", "false", "no", "n", "off"].includes(s)) return false;
    return v; // si es algo raro, que Zod falle y lo veamos temprano
  },
  z.boolean()
);

/**
 * intish(def):
 * Intenta parsear a número entero.
 * Si viene vacío o inválido, cae al default.
 */
const intish = (def: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return def;
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    },
    z.number().int()
  );

/**
 * strish(def):
 * Normaliza strings. Evita null/undefined y trimea.
 */
const strish = (def = "") =>
  z.preprocess((v) => (v === undefined || v === null ? def : String(v).trim()), z.string());

/**
 * listish(def):
 * Convierte env tipo "a,b,c" en array ["a","b","c"].
 * Si viene vacío usa el default.
 */
const listish = (def: string[] = []) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return def;
    return String(v)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }, z.array(z.string()));

// ------------------------------------------------------------
// Schema oficial: acá se define qué variables existen y qué tipo tienen.
// Lo que no esté acá, NO es parte del runtime (aunque exista en .env).
// ------------------------------------------------------------
const schema = z.object({
  // Core tables configuration (si queda vacío, se usa fallback hardcodeado)
  CORE_TABLES: strish(""),

  // Runtime
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: intish(3000),

  // Si hay reverse proxy (Nginx, ALB, Docker), esto ayuda a que Express detecte IP real
  TRUST_PROXY: boolish.default(false),

  // Flag de tooling para correr tests de integración (no afecta runtime normal)
  TEST_INTEGRATION: boolish.default(false),

  // ------------------------------------------------------------
  // DB - Production/Development
  // ------------------------------------------------------------
  DB_HOST: z.string().min(1),
  DB_PORT: intish(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: strish(""),

  // DB - Test Environment (se usan automáticamente si NODE_ENV=test)
  DB_HOST_TEST: strish(""),
  DB_PORT_TEST: intish(3306),
  DB_NAME_TEST: strish(""),
  DB_USER_TEST: strish(""),
  DB_PASSWORD_TEST: strish(""),

  // SSL para conexión a DB (útil en DB cloud como RDS, PlanetScale, etc.)
  DB_SSL_ENABLE: boolish.default(false),
  DB_SSL_REJECT_UNAUTHORIZED: boolish.default(true),
  DB_SSL_CA_PATH: strish(""),   // ruta al CA cert del servidor de DB (opcional)

  // Pool / timeouts DB
  DB_POOL_MAX: intish(10),
  DB_POOL_MIN: intish(0),
  DB_POOL_ACQUIRE_MS: intish(30000),
  DB_POOL_IDLE_MS: intish(10000),
  DB_QUERY_TIMEOUT_MS: intish(30000),

  // Migrations / schema cache
  MIGRATIONS_ENABLE: boolish.default(false),
  MIGRATIONS_DIR: strish("scripts/migrations"),
  SCHEMA_CACHE_PATH: strish("./.cache/schema.json"),

  // Logging
  LOG_DIR: strish("./logs"),
  LOG_LEVEL: strish("info"),
  LOG_RETENTION_DAYS: intish(30),

  // OpenAPI
  // - ENABLE_OPENAPI_VALIDATION: valida requests con el spec (útil si querés contract strict)
  // - OPENAPI_AUTO_GENERATE / OUTPUT: si se autogenera desde schema introspectado
  ENABLE_OPENAPI_VALIDATION: boolish.default(false),
  OPENAPI_PATH: strish("docs/openapi.yaml"),
  OPENAPI_AUTO_GENERATE: boolish.default(true),
  OPENAPI_AUTO_OUTPUT: strish("docs/openapi.generated.yaml"),

  // Hardening
  ENABLE_HARDENING: boolish.default(false),
  ENABLE_COMPRESSION: boolish.default(false),
  ENABLE_REQUEST_BODY_LIMITS: boolish.default(false),

  // CORS
  // - CORS_ALLOW_ALL=true: abre CORS a cualquier origen (NO recomendado en prod)
  // - allow/deny list se procesan como arrays al exportar env final
  CORS_ALLOW_ALL: boolish.default(false),
  CORS_ALLOWLIST: strish(""),
  CORS_DENYLIST: strish(""),

  // IP Guard
  // Permite permitir/denegar tráfico por IP (básico pero efectivo)
  IP_GUARD_ENABLE: boolish.default(false),
  IP_ALLOWLIST: strish(""),
  IP_BLACKLIST: strish(""),

  // Docs (Swagger UI)
  DOCS_ENABLE: boolish.default(true),
  DOCS_PATH: strish("/docs"),

  // DOCS_PROTECT por defecto true si no está definido (seguro por defecto)
  DOCS_PROTECT: z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return true;
      if (v === "true" || v === "1" || v === "yes" || v === "y") return true;
      if (v === "false" || v === "0" || v === "no" || v === "n") return false;
      return Boolean(v);
    },
    z.boolean()
  ).default(true),

  // Rate limit
  // RATE_LIMIT_BY_USER: si true, el limit se calcula por user (cuando hay auth),
  // si false suele ser por IP.
  RATE_LIMIT_BY_USER: boolish.default(false),

  RATE_LIMIT_ENABLE: boolish.default(true),
  RATE_LIMIT_WINDOW_MS: intish(900000),
  RATE_LIMIT_MAX: intish(300),

  // Redis para rate limit distribuido (escala horizontal)
  RATE_LIMIT_USE_REDIS: boolish.default(false),
  // Redis para cache de endpoints (independiente del rate limit)
  CACHE_USE_REDIS: boolish.default(false),
  REDIS_URL: strish(""),
  REDIS_CONNECT_TIMEOUT_MS: intish(5000),

  // Rate limit específico para auth endpoints (login/refresh)
  AUTH_RATE_LIMIT_WINDOW_MS: intish(10 * 60_000),
  AUTH_LOGIN_RATE_LIMIT_MAX: intish(20),
  AUTH_REFRESH_RATE_LIMIT_MAX: intish(60),

  // Metrics (Prometheus)
  METRICS_ENABLE: boolish.default(false),
  METRICS_PATH: strish("/metrics"),
  METRICS_PROTECT: boolish.default(false),
  METRICS_TOKEN: strish(""),

  // CRUD dinámico
  CRUD_STRICT_ALLOWLIST: boolish.default(false),
  CRUD_TABLE_ALLOWLIST: strish(""),
  CRUD_TABLE_DENYLIST: strish(""),
  CRUD_READONLY: boolish.default(false),

  // Auth / RBAC
  AUTH_ENABLE: boolish.default(true),
  RBAC_ENABLE: boolish.default(true),

  // En dev suele ser útil permitir header de user id para tests/local
  // IMPORTANTE: mantener false por defecto; activar explícitamente solo en dev
  AUTH_ALLOW_DEV_USER_ID_HEADER: boolish.default(false),

  // Modo bearer:
  // - auto: decide según config / headers
  // - jwt: fuerza JWT
  // - api_key: fuerza API key (si existiera)
  AUTH_BEARER_MODE: z.enum(["auto", "jwt", "api_key"]).default("auto"),

  // JWT
  JWT_ACCESS_SECRET: strish(""),
  JWT_REFRESH_SECRET: strish(""),
  JWT_ACCESS_TTL_SECONDS: intish(3600),
  JWT_REFRESH_TTL_DAYS: intish(7),

  // Email
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

  // Login guard (bruteforce protection por IP + email, persistido en DB)
  // ENABLE_2FA=false → los endpoints /forgot-password y /reset-password siguen funcionando;
  //   solo se omite el paso de verificación de código en el flujo de login.
  LOGIN_GUARD_ENABLE: boolish.default(true),
  LOGIN_GUARD_MAX_ATTEMPTS: intish(5),      // intentos antes de lockout
  LOGIN_GUARD_LOCK_MINUTES: intish(15),     // minutos de lockout

  // 2FA
  ENABLE_2FA: boolish.default(false),
  TWO_FA_CODE_TTL_MINUTES: intish(10),
  TWO_FA_CODE_LENGTH: intish(6),

  // Documentos
  // DOCUMENTS_BASE_DIR es requerido porque sin ruta base no hay storage seguro.
  DOCUMENTS_BASE_DIR: z.string().min(3),

  DOCUMENTS_ALLOWED_MIME: listish([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  DOCUMENTS_MAX_BYTES: intish(25 * 1024 * 1024),

  // Antivirus/scan
  DOCUMENTS_SCAN_ENABLE: boolish.default(false),
  DOCUMENTS_SCAN_MODE: z.enum(["clamd", "clamscan", "cli"]).default("clamscan"),
  DOCUMENTS_CLAMD_HOST: strish("127.0.0.1"),
  DOCUMENTS_CLAMD_PORT: intish(3310),
  DOCUMENTS_CLAMSCAN_PATH: strish("clamscan"),
  DOCUMENTS_SCAN_TIMEOUT_MS: intish(30000),

  // Fail-closed: si el scan falla, se bloquea el upload (modo más seguro)
  DOCUMENTS_SCAN_FAIL_CLOSED: boolish.default(true),

  // Fotos (si no se define, cae al mismo base dir de documentos)
  PHOTOS_BASE_DIR: strish(""),

  // HTTPS nativo (Node termina TLS directamente, sin Nginx/proxy)
  // Si tenés Nginx/ALB terminando TLS, dejá HTTPS_ENABLE=false y usá TRUST_PROXY=true
  HTTPS_ENABLE: boolish.default(false),
  HTTPS_CERT_PATH: strish(""),  // ruta al .crt / .pem (requerido si HTTPS_ENABLE=true)
  HTTPS_KEY_PATH: strish(""),   // ruta al .key (requerido si HTTPS_ENABLE=true)
  HTTPS_CA_PATH: strish(""),    // ruta al CA bundle (opcional)
  HTTPS_PORT: intish(443),      // puerto HTTPS (default 443)
  // Si HTTPS_ENABLE=true y este puerto > 0, arranca también HTTP→HTTPS redirect
  HTTP_REDIRECT_PORT: intish(80),

  // Timeouts del server
  REQUEST_TIMEOUT_MS: intish(60000),
  REQUEST_BODY_LIMIT_KB: intish(200),
  GRACEFUL_SHUTDOWN_MS: intish(15000),
  SERVER_HEADERS_TIMEOUT_MS: intish(65000),
  SERVER_KEEPALIVE_TIMEOUT_MS: intish(61000),

  // Guardrails de producción (fail-fast)
  PROD_FAIL_FAST: boolish.default(true),
  PROD_REQUIRE_DOCS_PROTECT: boolish.default(true),
  PROD_REQUIRE_METRICS_PROTECT: boolish.default(true),
  PROD_DISALLOW_CORS_ALLOW_ALL: boolish.default(true),
});

const raw = schema.parse(process.env);

// ------------------------------------------------------------
// Override DB para test:
// Si NODE_ENV=test y DB_HOST_TEST está seteado, usamos los *_TEST.
// Esto evita tener que cambiar código o configuraciones manuales
// cuando corremos test de integración.
// ------------------------------------------------------------
const isTestEnv = raw.NODE_ENV === "test";
const dbConfig =
  isTestEnv && raw.DB_HOST_TEST
    ? {
        DB_HOST: raw.DB_HOST_TEST || raw.DB_HOST,
        DB_PORT: raw.DB_PORT_TEST || raw.DB_PORT,
        DB_NAME: raw.DB_NAME_TEST || raw.DB_NAME,
        DB_USER: raw.DB_USER_TEST || raw.DB_USER,
        DB_PASSWORD: raw.DB_PASSWORD_TEST || raw.DB_PASSWORD,
      }
    : {
        DB_HOST: raw.DB_HOST,
        DB_PORT: raw.DB_PORT,
        DB_NAME: raw.DB_NAME,
        DB_USER: raw.DB_USER,
        DB_PASSWORD: raw.DB_PASSWORD,
      };

// ------------------------------------------------------------
// Export final:
// - aplica override DB test si corresponde
// - normaliza allow/deny lists a arrays
// - aplica fallback PHOTOS_BASE_DIR
// ------------------------------------------------------------
export const env = {
  ...raw,
  ...dbConfig, // override DB cuando NODE_ENV=test

  // si PHOTOS_BASE_DIR está vacío, reutilizamos DOCUMENTS_BASE_DIR
  PHOTOS_BASE_DIR: raw.PHOTOS_BASE_DIR?.trim() ? raw.PHOTOS_BASE_DIR : raw.DOCUMENTS_BASE_DIR,

  // normalización de CORS allow/deny list (string → string[])
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

// ------------------------------------------------------------
// Validaciones extra en producción:
// Esto evita arrancar con config insegura o incompleta.
// Si PROD_FAIL_FAST=false, no se corta el arranque (pero no recomendado).
// ------------------------------------------------------------
export function assertProdEnvOrThrow() {
  if (env.NODE_ENV !== "production") return;
  if (!env.PROD_FAIL_FAST) return;

  const errors: string[] = [];

  // Auth: en prod, si auth está encendido, exigimos secretos seguros
  if (env.AUTH_ENABLE) {
    if (!env.JWT_ACCESS_SECRET?.trim()) errors.push("JWT_ACCESS_SECRET requerido en production");
    if (!env.JWT_REFRESH_SECRET?.trim()) errors.push("JWT_REFRESH_SECRET requerido en production");
    if (env.JWT_ACCESS_SECRET?.length < 32) errors.push("JWT_ACCESS_SECRET debería tener al menos 32 caracteres");
    if (env.JWT_REFRESH_SECRET?.length < 32) errors.push("JWT_REFRESH_SECRET debería tener al menos 32 caracteres");
  }

  // Docs: si están habilitadas, deben estar protegidas (según guardrail)
  if (env.DOCS_ENABLE && env.PROD_REQUIRE_DOCS_PROTECT && !env.DOCS_PROTECT) {
    errors.push("DOCS_PROTECT debe ser true en production (o deshabilitar DOCS_ENABLE)");
  }

  // Metrics: si están habilitadas, deben estar protegidas (según guardrail)
  if (env.METRICS_ENABLE && env.PROD_REQUIRE_METRICS_PROTECT && !env.METRICS_PROTECT) {
    errors.push("METRICS_PROTECT debe ser true en production (o deshabilitar METRICS_ENABLE)");
  }
  if (env.METRICS_ENABLE && env.METRICS_PROTECT && !env.METRICS_TOKEN?.trim()) {
    errors.push("METRICS_TOKEN requerido si METRICS_PROTECT=true");
  }
  if (env.METRICS_TOKEN && env.METRICS_TOKEN.length < 16) {
    errors.push("METRICS_TOKEN debería tener al menos 16 caracteres");
  }

  // CORS: en prod no permitimos allow-all sin allowlist (si el guardrail está activo)
  if (env.PROD_DISALLOW_CORS_ALLOW_ALL && env.CORS_ALLOW_ALL && env.CORS_ALLOWLIST.length === 0) {
    errors.push("En production: setear CORS_ALLOWLIST (y/o CORS_ALLOW_ALL=false)");
  }

  // Reverse proxy: recomendación, no hard error (pero lo dejo como warning-error porque ya lo tenías así)
  if (!env.TRUST_PROXY) {
    errors.push("Recomendado en production: TRUST_PROXY=true (si hay reverse proxy)");
  }

  // Document storage: debe existir y ser accesible
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

  // Photos dir si es distinto del base dir, validamos que exista (si fue provisto)
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

  // Redis: si rate limit distribuido está activo, Redis URL debe existir
  if (env.RATE_LIMIT_USE_REDIS) {
    if (!env.REDIS_URL?.trim()) {
      errors.push("REDIS_URL requerido cuando RATE_LIMIT_USE_REDIS=true");
    }
    if (!env.REDIS_CONNECT_TIMEOUT_MS || env.REDIS_CONNECT_TIMEOUT_MS < 1000) {
      errors.push("REDIS_CONNECT_TIMEOUT_MS debe ser al menos 1000ms");
    }
  }

  // Rate limit: sanity checks
  if (env.RATE_LIMIT_ENABLE) {
    if (env.RATE_LIMIT_WINDOW_MS < 1000) {
      errors.push("RATE_LIMIT_WINDOW_MS debe ser al menos 1000ms");
    }
    if (env.RATE_LIMIT_MAX < 1) {
      errors.push("RATE_LIMIT_MAX debe ser al menos 1");
    }
  }

  // DB mínimos
  if (!env.DB_HOST?.trim()) errors.push("DB_HOST requerido");
  if (!env.DB_NAME?.trim()) errors.push("DB_NAME requerido");
  if (!env.DB_USER?.trim()) errors.push("DB_USER requerido");

  // HTTPS nativo: si está habilitado, los certificados deben existir
  if (env.HTTPS_ENABLE) {
    if (!env.HTTPS_CERT_PATH?.trim()) errors.push("HTTPS_CERT_PATH requerido cuando HTTPS_ENABLE=true");
    if (!env.HTTPS_KEY_PATH?.trim()) errors.push("HTTPS_KEY_PATH requerido cuando HTTPS_ENABLE=true");
    if (env.HTTPS_CERT_PATH?.trim()) {
      try {
        if (!fs.existsSync(env.HTTPS_CERT_PATH)) errors.push(`HTTPS_CERT_PATH no existe: ${env.HTTPS_CERT_PATH}`);
      } catch { errors.push("Error validando HTTPS_CERT_PATH"); }
    }
    if (env.HTTPS_KEY_PATH?.trim()) {
      try {
        if (!fs.existsSync(env.HTTPS_KEY_PATH)) errors.push(`HTTPS_KEY_PATH no existe: ${env.HTTPS_KEY_PATH}`);
      } catch { errors.push("Error validando HTTPS_KEY_PATH"); }
    }
  }

  // OpenAPI validation: si está activo, path debe existir (mínimo)
  if (env.ENABLE_OPENAPI_VALIDATION) {
    if (!env.OPENAPI_PATH?.trim()) {
      errors.push("OPENAPI_PATH requerido cuando ENABLE_OPENAPI_VALIDATION=true");
    }
  }

  // CORE_TABLES vacío no lo trato como fatal, pero lo venías reportando
  if (!env.CORE_TABLES?.trim()) {
    errors.push("CORE_TABLES vacío - se usará el default hardcodeado");
  }

  if (errors.length) {
    throw new Error("❌ Config inválida para production:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  }
}
