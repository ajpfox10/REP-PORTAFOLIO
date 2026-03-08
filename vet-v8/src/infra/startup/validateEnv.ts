/**
 * validateEnv — Fails at startup if critical environment variables are
 * missing or are obviously unsafe defaults.
 */

export type EnvRule = {
  key: string;
  required?: boolean;
  minLength?: number;
  notValues?: string[];
  message?: string;
};

const RULES: EnvRule[] = [
  { key: "JWT_SECRET", required: true, minLength: 32, notValues: ["CHANGE_ME", "secret", "changeme", "dev-secret"], message: "JWT_SECRET debe tener al menos 32 chars y no ser un valor por defecto" },
  { key: "JWT_REFRESH_SECRET", required: true, minLength: 32, notValues: ["CHANGE_ME", "secret", "changeme"], message: "JWT_REFRESH_SECRET inseguro" },
  { key: "MASTER_DB_HOST", required: true },
  { key: "MASTER_DB_USER", required: true },
  { key: "MASTER_DB_PASSWORD", required: true, minLength: 8, notValues: ["password", "root", "1234", "CHANGE_ME", "secret"] },
  { key: "MASTER_DB_NAME", required: true },
  { key: "REDIS_URL", required: true },
  { key: "ENCRYPTION_MASTER_SECRET", required: true, minLength: 32, notValues: ["CHANGE_ME", "dev-master-secret-32chars-padding", "secret"] },
  { key: "INTERNAL_API_SHARED_SECRET", minLength: 32, notValues: ["CHANGE_ME", "internal-secret", "secret"] },
  { key: "METRICS_AUTH_TOKEN", minLength: 32, notValues: ["CHANGE_ME", "metrics", "secret"] },
];

function requiredInProd(env: Record<string, string | undefined>, key: string, errors: string[], msg?: string) {
  if ((env.NODE_ENV ?? "development") !== "production") return;
  if (!env[key]) errors.push(`[ENV] ${key} es obligatorio en producción${msg ? `: ${msg}` : ""}`);
}

export function validateEnv(env: Record<string, string | undefined> = process.env): void {
  const errors: string[] = [];

  for (const rule of RULES) {
    const value = env[rule.key];
    if (rule.required && !value) {
      errors.push(`[ENV] Variable requerida faltante: ${rule.key}`);
      continue;
    }
    if (!value) continue;
    if (rule.minLength && value.length < rule.minLength) {
      errors.push(`[ENV] ${rule.key} demasiado corta (${value.length} chars, mínimo ${rule.minLength}). ${rule.message ?? ""}`);
    }
    if (rule.notValues && rule.notValues.map(v => v.toLowerCase()).includes(value.toLowerCase())) {
      errors.push(`[ENV] ${rule.key} usa un valor inseguro por defecto. ${rule.message ?? "Cambialo antes de producción."}`);
    }
  }

  requiredInProd(env, "CORS_BASE_DOMAIN", errors, "sin dominio canónico no se inicia");
  requiredInProd(env, "CORS_ALLOWED_ORIGINS", errors, "definí origins explícitos");
  requiredInProd(env, "METRICS_AUTH_TOKEN", errors, "protege /metrics con token dedicado");
  requiredInProd(env, "INTERNAL_API_SHARED_SECRET", errors, "necesario para firma HMAC interna");
  requiredInProd(env, "S3_BUCKET", errors, "necesario para adjuntos");
  requiredInProd(env, "SES_FROM_EMAIL", errors, "necesario para recuperación de contraseña");

  if ((env.NODE_ENV ?? "development") === "production") {
    if ((env.METRICS_PROTECT ?? "true").toLowerCase() !== "true") {
      errors.push("[ENV] METRICS_PROTECT debe ser true en producción");
    }
    if ((env.REQUIRE_CANONICAL_TENANT_HOST ?? "true").toLowerCase() !== "true") {
      errors.push("[ENV] REQUIRE_CANONICAL_TENANT_HOST debe ser true en producción");
    }
    if ((env.INTERNAL_API_REQUIRE_NONCE ?? "true").toLowerCase() !== "true") {
      errors.push("[ENV] INTERNAL_API_REQUIRE_NONCE debe ser true en producción");
    }
    if ((env.INTERNAL_API_REQUIRE_PRIVATE_NETWORK ?? "true").toLowerCase() !== "true") {
      errors.push("[ENV] INTERNAL_API_REQUIRE_PRIVATE_NETWORK debe ser true en producción");
    }
    if ((env.AUTH_REQUIRE_STATEFUL_ACCESS_SESSION ?? "true").toLowerCase() !== "true") {
      errors.push("[ENV] AUTH_REQUIRE_STATEFUL_ACCESS_SESSION debe ser true en producción");
    }
    if ((env.FILES_REQUIRE_SHA256 ?? "true").toLowerCase() !== "true") {
      errors.push("[ENV] FILES_REQUIRE_SHA256 debe ser true en producción");
    }
    const pwMin = Number(env.AUTH_PASSWORD_MIN_LENGTH ?? 0);
    if (!Number.isFinite(pwMin) || pwMin < 12) {
      errors.push("[ENV] AUTH_PASSWORD_MIN_LENGTH debe ser >= 12 en producción");
    }
  }

  if (errors.length) {
    console.error("\n🚨 Errores de configuración de entorno:\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error("\nEl servidor no puede iniciar con configuración insegura.\n");
    process.exit(1);
  }

  console.info("[ENV] ✓ Variables de entorno validadas correctamente");
}
