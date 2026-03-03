/**
 * Verifica si la base de datos existe y la crea si no existe.
 * Ejecutar antes de conectar con Sequelize.
 */
import mysql2 from 'mysql2/promise';
import { env } from '../config/env';
import { logger } from '../logging/logger';

export async function ensureDatabase(): Promise<void> {
  const dbName = env.DB_NAME;
  if (!dbName) {
    logger.warn({ msg: 'DB_NAME no configurado — skip ensureDatabase' });
    return;
  }

  let conn: mysql2.Connection | null = null;
  try {
    conn = await mysql2.createConnection({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      // Sin database — para poder crearla
      connectTimeout: 10000,
    });

    const [rows] = await conn.query(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [dbName]
    );

    if ((rows as any[]).length === 0) {
      logger.info({ msg: `Base de datos "${dbName}" no encontrada — creando…` });
      await conn.query(
        `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
      );
      logger.info({ msg: `Base de datos "${dbName}" creada exitosamente` });
    } else {
      logger.info({ msg: `Base de datos "${dbName}" verificada — existe` });
    }
  } catch (err: any) {
    logger.error({ msg: 'Error al verificar/crear base de datos', error: err?.message });
    // No lanzar error — dejar que Sequelize falle con mensaje claro si no puede conectar
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}
