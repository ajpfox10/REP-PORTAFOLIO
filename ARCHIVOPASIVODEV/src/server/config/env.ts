import "dotenv/config";
import { z } from "zod";

// Convierte texto de entorno en booleano de forma predecible.
const boolish = z
  .string()
  .optional()
  .transform((value) => String(value ?? "false").toLowerCase() === "true");

// Define y valida toda la configuracion que usa la aplicacion.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("Archivo Pasivo"),
  APP_HOST: z.string().default("0.0.0.0"),
  APP_PORT: z.coerce.number().int().positive().default(4300),
  PUBLIC_URL: z.string().url().default("http://localhost:4300"),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default("archivo_pasivo"),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  LOGIN_GUARD_ENABLE: boolish,
  LOGIN_GUARD_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_GUARD_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  TWO_FACTOR_ENABLE: boolish,
  TWO_FACTOR_ISSUER: z.string().default("Archivo Pasivo"),
  CORS_ALLOWLIST: z.string().default("http://localhost:5174,http://localhost:4300"),
  TRUST_PROXY: boolish,
});

// Se exporta un objeto unico para evitar lecturas directas y dispersas de process.env.
export const env = envSchema.parse(process.env);

// Normaliza la lista de origenes permitidos para CORS.
export const corsAllowlist = env.CORS_ALLOWLIST.split(",")
  .map((item) => item.trim())
  .filter(Boolean);
