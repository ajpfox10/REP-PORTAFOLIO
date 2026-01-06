import { Sequelize } from "sequelize";
import { env } from "../config/env";

export const createSequelize = () => {
  const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
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

  return sequelize;
};
