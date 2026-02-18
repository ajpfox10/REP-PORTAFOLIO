// tests/helpers/createTestApp.ts
import { Express } from 'express';
import { Sequelize } from 'sequelize';
import { createApp } from '../../src/app';
import { mountRoutes } from '../../src/routes';
import { auditAllApi } from '../../src/middlewares/auditAllApi';
import { SchemaSnapshot } from '../../src/db/schema/types';

export interface TestAppContext {
  app: Express;
  sequelize: Sequelize;  // 👈 Agregamos sequelize
  schema: SchemaSnapshot; // 👈 Agregamos schema
}

// Cache de la app
let cachedApp: Express | null = null;

export async function createTestApp(): Promise<TestAppContext> {
  console.log('  🚀 createTestApp - usando recursos globales');
  
  const sequelize = global.__TEST_SEQUELIZE__;
  const schema = global.__TEST_SCHEMA__;
  
  if (!sequelize || !schema) {
    throw new Error('❌ Recursos globales no inicializados');
  }
  
  if (!cachedApp) {
    console.log('    🆕 Creando nueva app');
    cachedApp = createApp(undefined, (appInstance) => {
      appInstance.use(auditAllApi(sequelize));
      mountRoutes(appInstance, sequelize, schema);
    });
  }
  
  return { 
    app: cachedApp,
    sequelize, // 👈 Devolvemos sequelize
    schema     // 👈 Devolvemos schema
  };
}

export async function cleanupTestApp(): Promise<void> {
  console.log('  🧹 cleanupTestApp - sin acción necesaria');
}