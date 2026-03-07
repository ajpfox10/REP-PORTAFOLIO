// tests/globalSetup.ts
import path from 'path';

export default async function globalSetup() {
  console.log('\n🌍 [GLOBAL SETUP - UNA SOLA VEZ] Inicializando recursos...');
  console.time('⏱️ Global setup');

  // Cargar .env
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

  // ✅ Variables de test
  process.env.NODE_ENV = 'test';
  process.env.PORT = process.env.PORT || '3001';

  // ✅ Apagar métricas (doble seguro, además de jest.env.ts)
  process.env.METRICS_ENABLE = '0';
  process.env.METRICS_PROTECT = '0';

  // Configurar DB de test
  process.env.DB_HOST = process.env.DB_HOST_TEST || '127.0.0.1';
  process.env.DB_PORT = process.env.DB_PORT_TEST || '3306';
  process.env.DB_NAME = process.env.DB_NAME_TEST || 'personalv5_test';
  process.env.DB_USER = process.env.DB_USER_TEST || 'root';
  process.env.DB_PASSWORD = process.env.DB_PASSWORD_TEST || 'Cuernos2503';

  // ✅ Imports tardíos (ya con env seteado)
  const { createSequelize } = await import('../src/db/sequelize');
  const { schemaBootstrap } = await import('../src/bootstrap/schemaBootstrap');
  const { buildModels } = await import('../src/db/dynamic/modelFactory');

  const sequelize = createSequelize();
  await sequelize.authenticate();
  console.log('  ✅ DB conectada');

  const schema = await schemaBootstrap(sequelize);
  console.log('  ✅ Schema cargado');

  buildModels(sequelize, schema);
  console.log('  ✅ Modelos construidos');

  (global as any).__TEST_SEQUELIZE__ = sequelize;
  (global as any).__TEST_SCHEMA__ = schema;

  console.timeEnd('⏱️ Global setup');
  console.log('✅ [GLOBAL SETUP] Completado\n');
}
