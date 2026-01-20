// src/db/sequelize.ts
import { Sequelize } from "sequelize";
import { env } from "../config/env";

let _sequelize: Sequelize | null = null;

/**
 * Singleton: crea o devuelve la instancia única de Sequelize.
 */
export function createSequelize(): Sequelize {
  if (_sequelize) return _sequelize;

  _sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
    host: env.DB_HOST,
    port: env.DB_PORT,
    dialect: "mysql",
    logging: false,
    pool: {
      max: env.DB_POOL_MAX,
      min: env.DB_POOL_MIN,
      acquire: env.DB_POOL_ACQUIRE_MS,
      idle: env.DB_POOL_IDLE_MS
    },
    dialectOptions: {
      connectTimeout: env.DB_QUERY_TIMEOUT_MS
    }
  });

  return _sequelize;
}

/**
 * Export “directo” para imports existentes: `import { sequelize } from "../db/sequelize"`
 * OJO: se inicializa lazy (cuando alguien lo usa por primera vez).
 */
export const sequelize: Sequelize = (null as any) as Sequelize;

// Proxy simple: cuando alguien use `sequelize`, lo resolvemos al singleton real.
Object.defineProperty(exports, "sequelize", {
  enumerable: true,
  get: () => createSequelize()
});
