import "dotenv/config";
import { z } from "zod";
import { type AppConfig } from "./types.js";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  TRUST_PROXY: z.coerce.number().default(0),

  MASTER_DB_HOST: z.string().default("127.0.0.1"),
  MASTER_DB_PORT: z.coerce.number().default(3307),
  MASTER_DB_USER: z.string().default("root"),
  MASTER_DB_PASSWORD: z.string().default("secret"),
  MASTER_DB_NAME: z.string().default("veterinaria_master"),

  TENANT_DB_HOST: z.string().default("127.0.0.1"),
  TENANT_DB_PORT: z.coerce.number().default(3306),
  TENANT_DB_USER: z.string().default("root"),
  TENANT_DB_PASSWORD: z.string().default("secret"),

  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),

  SCHEMA_CACHE_TTL_SECONDS: z.coerce.number().default(120),
  TENANT_CONN_CACHE_TTL_SECONDS: z.coerce.number().default(60),

  CRUD_STRICT_ALLOWLIST: z.coerce.boolean().default(true),
  CRUD_TABLE_ALLOWLIST: z.string().optional().default(""),
  CRUD_TABLE_DENYLIST: z.string().optional().default(""),

  OPENAPI_OUTPUT: z.string().default("docs/openapi.generated.yaml"),

  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),

  // Auth
  JWT_ALGORITHM: z.enum(["HS256", "RS256"]).default("HS256"),
  JWT_KEY_ID: z.string().default("dev-1"),
  // HS256 fallback (dev)
  JWT_SECRET: z.string().default("CHANGE_ME_use_openssl_rand_base64_48_min_32_chars_AAAAAAAAAAAA"),
  JWT_REFRESH_SECRET: z.string().default("CHANGE_ME_different_secret_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
  // RS256 (prod)
  JWT_PRIVATE_KEY_PEM: z.string().optional().default(""),
  // JSON string with an array of JWK public keys (rotation)
  JWKS_PUBLIC_KEYS_JSON: z.string().optional().default(""),

  // Observability
  METRICS_ENABLE: z.coerce.boolean().default(true),
  METRICS_PROTECT: z.coerce.boolean().default(false),

  // Storage
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),

  // Notifications
  SES_FROM_EMAIL: z.string().optional().default(""),
  SNS_REGION: z.string().optional().default("us-east-1"),
  SNS_SENDER_ID: z.string().optional().default(""),

  // Encryption
  KMS_KEY_ID: z.string().optional().default(""),
  ENCRYPTION_MASTER_SECRET: z.string().optional().default(""),

  INTERNAL_API_IP_ALLOWLIST: z.string().optional().default(""),
  INTERNAL_API_SHARED_SECRET: z.string().optional().default(""),
  INTERNAL_API_NONCE_TTL_SECONDS: z.coerce.number().default(300),
  INTERNAL_API_REQUIRE_NONCE: z.coerce.boolean().default(true),
  INTERNAL_API_REQUIRE_PRIVATE_NETWORK: z.coerce.boolean().default(true),

  METRICS_AUTH_TOKEN: z.string().optional().default(""),
  METRICS_IP_ALLOWLIST: z.string().optional().default("127.0.0.1,::1"),

  CORS_BASE_DOMAIN: z.string().optional().default(""),
  CORS_ALLOWED_ORIGINS: z.string().optional().default("http://localhost:3000,http://localhost:5173"),
  REQUIRE_CANONICAL_TENANT_HOST: z.coerce.boolean().default(true),

  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().default(12),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().default(5),
  AUTH_LOCKOUT_SECONDS: z.coerce.number().default(900),
  AUTH_REQUIRE_MFA_ON_RESET: z.coerce.boolean().default(true),
  AUTH_REQUIRE_STATEFUL_ACCESS_SESSION: z.coerce.boolean().default(true),
  AUTH_ENFORCE_SESSION_FINGERPRINT: z.coerce.boolean().default(true),

  FILES_ALLOWED_MIME_TYPES: z.string().optional().default("application/pdf,image/jpeg,image/png,image/webp"),
  FILES_ALLOWED_PURPOSES: z.string().optional().default("general,clinical,lab,invoice,profile"),
  FILES_MAX_UPLOAD_BYTES: z.coerce.number().default(10485760),
  FILES_REQUIRE_SHA256: z.coerce.boolean().default(true),

  RLS_ALLOW_SHARED_ROWS: z.coerce.boolean().default(false),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),

  FF_ENABLE_BILLING: z.coerce.boolean().default(true),
  FF_ENABLE_PLUGINS: z.coerce.boolean().default(true),
  FF_ENABLE_FEATURE_FLAGS: z.coerce.boolean().default(true),
  FF_ENABLE_PLAN_LIMITS: z.coerce.boolean().default(true),
  FF_ENABLE_FILES: z.coerce.boolean().default(true)
});

export function loadConfig(): AppConfig {
  const env = Env.parse(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    trustProxy: env.TRUST_PROXY,

    masterDb: { host: env.MASTER_DB_HOST, port: env.MASTER_DB_PORT, user: env.MASTER_DB_USER, password: env.MASTER_DB_PASSWORD, name: env.MASTER_DB_NAME },
    tenantDb: { host: env.TENANT_DB_HOST, port: env.TENANT_DB_PORT, user: env.TENANT_DB_USER, password: env.TENANT_DB_PASSWORD },

    redisUrl: env.REDIS_URL,

    schemaCacheTtlSeconds: env.SCHEMA_CACHE_TTL_SECONDS,
    tenantConnCacheTtlSeconds: env.TENANT_CONN_CACHE_TTL_SECONDS,

    crudStrictAllowlist: env.CRUD_STRICT_ALLOWLIST,
    crudTableAllowlist: split(env.CRUD_TABLE_ALLOWLIST),
    crudTableDenylist: split(env.CRUD_TABLE_DENYLIST),

    openApiOutput: env.OPENAPI_OUTPUT,

    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,

    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    jwtAlgorithm: env.JWT_ALGORITHM,
    jwtKeyId: env.JWT_KEY_ID,
    jwtPrivateKeyPem: env.JWT_PRIVATE_KEY_PEM ?? "",
    jwksPublicKeysJson: env.JWKS_PUBLIC_KEYS_JSON ?? "",

    metricsEnable: env.METRICS_ENABLE,
    metricsProtect: env.METRICS_PROTECT,
    metricsAuthToken: env.METRICS_AUTH_TOKEN ?? "",
    metricsIpAllowlist: split(env.METRICS_IP_ALLOWLIST),

    corsAllowedOrigins: split(env.CORS_ALLOWED_ORIGINS),
    requireCanonicalTenantHost: env.REQUIRE_CANONICAL_TENANT_HOST,

    s3Region: env.S3_REGION,
    s3Bucket: env.S3_BUCKET,

    sesFromEmail: env.SES_FROM_EMAIL ?? "",
    snsRegion: env.SNS_REGION ?? "us-east-1",
    snsSenderId: env.SNS_SENDER_ID ?? "",

    kmsKeyId: env.KMS_KEY_ID ?? "",
    encryptionMasterSecret: env.ENCRYPTION_MASTER_SECRET ?? "",

    internalApiIpAllowlist: split(env.INTERNAL_API_IP_ALLOWLIST),
    internalApiSharedSecret: env.INTERNAL_API_SHARED_SECRET ?? "",
    internalApiNonceTtlSeconds: env.INTERNAL_API_NONCE_TTL_SECONDS,
    internalApiRequireNonce: env.INTERNAL_API_REQUIRE_NONCE,
    internalApiRequirePrivateNetwork: env.INTERNAL_API_REQUIRE_PRIVATE_NETWORK,

    authPasswordMinLength: env.AUTH_PASSWORD_MIN_LENGTH,
    authMaxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS,
    authLockoutSeconds: env.AUTH_LOCKOUT_SECONDS,
    authRequireMfaOnReset: env.AUTH_REQUIRE_MFA_ON_RESET,
    authRequireStatefulAccessSession: env.AUTH_REQUIRE_STATEFUL_ACCESS_SESSION,
    authEnforceSessionFingerprint: env.AUTH_ENFORCE_SESSION_FINGERPRINT,

    filesAllowedMimeTypes: split(env.FILES_ALLOWED_MIME_TYPES),
    filesAllowedPurposes: split(env.FILES_ALLOWED_PURPOSES),
    filesMaxUploadBytes: env.FILES_MAX_UPLOAD_BYTES,
    filesRequireSha256: env.FILES_REQUIRE_SHA256,

    rlsAllowSharedRows: env.RLS_ALLOW_SHARED_ROWS,

    whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN ?? "",
    whatsappWebhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
    corsDomain: env.CORS_BASE_DOMAIN ?? "",

    featureFlags: {
      FF_ENABLE_BILLING: env.FF_ENABLE_BILLING,
      FF_ENABLE_PLUGINS: env.FF_ENABLE_PLUGINS,
      FF_ENABLE_FEATURE_FLAGS: env.FF_ENABLE_FEATURE_FLAGS,
      FF_ENABLE_PLAN_LIMITS: env.FF_ENABLE_PLAN_LIMITS,
      FF_ENABLE_FILES: env.FF_ENABLE_FILES
    }
  };
}

function split(v?: string) {
  if (!v) return [];
  return v.split(",").map(s => s.trim()).filter(Boolean);
}
