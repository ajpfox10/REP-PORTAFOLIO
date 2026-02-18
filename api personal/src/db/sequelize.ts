// src/db/sequelize.ts
import { Sequelize } from "sequelize";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env";

let _sequelize: Sequelize | null = null;

/**
 * Singleton: crea o devuelve la instancia única de Sequelize.
 */
export function createSequelize(): Sequelize {
  if (_sequelize) return _sequelize;

  // Opciones SSL para la conexión a DB (útil en RDS, PlanetScale, etc.)
  let ssl: any = undefined;
  if (env.DB_SSL_ENABLE) {
    ssl = { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED };
    if (env.DB_SSL_CA_PATH?.trim()) {
      ssl.ca = fs.readFileSync(path.resolve(env.DB_SSL_CA_PATH));
    }
  }

  _sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
    host: env.DB_HOST,
    port: env.DB_PORT,
    dialect: "mysql",
    logging: false,
    pool: {
      max: env.DB_POOL_MAX,
      min: env.DB_POOL_MIN,
      acquire: env.DB_POOL_ACQUIRE_MS,
      idle: env.DB_POOL_IDLE_MS,
    },
    dialectOptions: {
      connectTimeout: env.DB_QUERY_TIMEOUT_MS,
      ...(ssl ? { ssl } : {}),
    },
  });

  return _sequelize;
}

/**
 * Export "directo" para imports existentes: `import { sequelize } from "../db/sequelize"`
 * Se inicializa lazy (cuando alguien lo usa por primera vez).
 */
export const sequelize: Sequelize = null as any;

Object.defineProperty(exports, "sequelize", {
  enumerable: true,
  get: () => createSequelize(),
});
