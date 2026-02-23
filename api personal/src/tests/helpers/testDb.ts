// src/tests/helpers/testDb.ts
import { Sequelize } from 'sequelize';

export function createTestSequelize(): Sequelize {
  return new Sequelize(
    process.env.DB_NAME_TEST || 'personalv5_test',
    process.env.DB_USER_TEST || 'root',
    process.env.DB_PASSWORD_TEST || 'root',
    {
      host: process.env.DB_HOST_TEST || '127.0.0.1',
      port: Number(process.env.DB_PORT_TEST) || 3306,
      dialect: 'mysql',
      logging: false,
      pool: { max: 2, min: 0, acquire: 10000, idle: 5000 },
    }
  );
}
