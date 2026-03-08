/**
 * validateEnv — Fails at startup if critical environment variables are
 * missing or are obviously unsafe defaults.
 *
 * Call this BEFORE anything else in index.ts.
 */

export type EnvRule = {
  key: string;
  required?: boolean;
  minLength?: number;
  notValues?: string[];
  message?: string;
};

const RULES: EnvRule[] = [
  // Auth
  { key: "JWT_SECRET", required: true, minLength: 32, notValues: ["CHANGE_ME", "secret", "changeme", "dev-secret"], message: "JWT_SECRET debe tener al menos 32 chars y no ser un valor por defecto" },
  { key: "JWT_REFRESH_SECRET", required: true, minLength: 32, notValues: ["CHANGE_ME", "secret", "changeme"], message: "JWT_REFRESH_SECRET inseguro" },

  // DB
  { key: "MASTER_DB_HOST", required: true },
  { key: "MASTER_DB_USER", required: true },
  { key: "MASTER_DB_PASSWORD", required: true, minLength: 8, notValues: ["password", "root", "1234", "CHANGE_ME"] },
  { key: "MASTER_DB_NAME", required: true },

  // Redis
  { key: "REDIS_URL", required: true },

  // Encryption
  { key: "ENCRYPTION_MASTER_SECRET", required: true, minLength: 32, notValues: ["CHANGE_ME", "dev-master-secret-32chars-padding"] },

  // Optional but warn if insecure
  { key: "INTERNAL_API_SHARED_SECRET", minLength: 24, notValues: ["CHANGE_ME", "internal-secret"] },
];

export function validateEnv(env: Record<string, string | undefined> = process.env): void {
  const errors: string[] = [];

  for (const rule of RULES) {
    const value = env[rule.key];

    if (rule.required && !value) {
      errors.push(`[ENV] Variable requerida faltante: ${rule.key}`);
      continue;
    }

    if (!value) continue; // optional and absent — skip

    if (rule.minLength && value.length < rule.minLength) {
      errors.push(`[ENV] ${rule.key} demasiado corta (${value.length} chars, mínimo ${rule.minLength}). ${rule.message ?? ""}`);
    }

    if (rule.notValues && rule.notValues.map(v => v.toLowerCase()).includes(value.toLowerCase())) {
      errors.push(`[ENV] ${rule.key} usa un valor inseguro por defecto. ${rule.message ?? "Cambialo antes de producción."}`);
    }
  }

  // Warn on production about optional missing configs
  if ((env.NODE_ENV ?? "development") === "production") {
    const prodRecommended = ["STRIPE_SECRET_KEY", "AWS_S3_BUCKET", "SES_FROM_EMAIL"];
    for (const key of prodRecommended) {
      if (!env[key]) {
        console.warn(`[ENV WARN] ${key} no está configurado (recomendado en producción)`);
      }
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
