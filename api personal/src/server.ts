/**
 * @file server.ts
 * @description Punto de entrada del servidor.
 *
 * ORDEN DE ARRANQUE (importante - no cambiar):
 *   1. Registrar dominio activo en PluginRegistry
 *   2. Validar .env con assertProdEnvOrThrow()
 *   3. Conectar a BD (auto-crea la BD si no existe)
 *   4. Correr migraciones SQL pendientes
 *   5. Leer estructura de tablas (schema introspection)
 *   6. Construir modelos Sequelize dinamicos
 *   7. Crear app Express con middlewares base (createApp)
 *   8. Montar todas las rutas via API Gateway (mountApiGateway)
 *   9. Agregar 404 y errorHandler al final (addFinalHandlers)  ← CRITICO: debe ser el ultimo paso
 *  10. Arrancar HTTP/HTTPS
 *  11. Graceful shutdown con SIGTERM/SIGINT
 *
 * POR QUE EL ORDEN 7-8-9 IMPORTA:
 *   Express ejecuta middlewares y rutas en el orden que se registran.
 *   Si el handler de 404 se registra ANTES que las rutas del API Gateway,
 *   todas las requests dan 404 porque el 404 handler las intercepta primero.
 *   Por eso createApp() NO incluye el 404/errorHandler - los agrega
 *   addFinalHandlers() DESPUES de que mountApiGateway() ya registro todo.
 */

import { createApp, addFinalHandlers } from './app';
import { env, assertProdEnvOrThrow } from './config/env';
import { logger } from './logging/logger';
import { createSequelize } from './db/sequelize';
import { ensureDatabase } from './db/ensureDatabase';
import { schemaBootstrap } from './bootstrap/schemaBootstrap';
import { buildModels } from './db/dynamic/modelFactory';
import { mountApiGateway } from './gateways/apiGateway';
import { runMigrations } from './db/migrations/runMigrations';
import { auditAllApi } from './middlewares/auditAllApi';
import { pluginRegistry } from './core/plugin';
import { PersonalV5Domain } from './domains/personalv5/domain';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import YAML from 'yaml';
import { buildOpenApiFromSchema } from './types/openapi/build';
import { closeRedisClient } from './infra/redis';
import { initSocketServer } from './socket';
import { startWebhookWorker } from './webhooks/worker';

// ── Manejo global de errores no capturados ────────────────────────────────────
process.on('unhandledRejection', (e) => {
  logger.error({ msg: 'UNHANDLED_REJECTION', err: e instanceof Error ? e.stack : String(e) });
});
process.on('uncaughtException', (e) => {
  logger.error({ msg: 'UNCAUGHT_EXCEPTION', err: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});

// ── Registrar dominio activo ──────────────────────────────────────────────────
// Para cambiar de dominio: cambiar este import y setDomain()
// Ejemplo veterinaria:
//   import { VeterinariaDomail } from './domains/veterinaria/domain';
//   pluginRegistry.setDomain(new VeterinariaDomail());
pluginRegistry.setDomain(new PersonalV5Domain());

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  assertProdEnvOrThrow();

  // ── Base de datos ─────────────────────────────────────────────────────────
  const sequelize = createSequelize();
  await ensureDatabase();
  await sequelize.authenticate();
  logger.info({ msg: 'BD conectada', host: env.DB_HOST, db: env.DB_NAME });

  await runMigrations(sequelize);

  const schema = await schemaBootstrap(sequelize);
  logger.info({ msg: 'Schema cargado', tablas: Object.keys(schema.tables || {}).length });

  buildModels(sequelize, schema);

  // ── Generar OpenAPI automaticamente ──────────────────────────────────────
  if (env.OPENAPI_AUTO_GENERATE) {
    try {
      const spec = buildOpenApiFromSchema(schema);
      const outPath = path.resolve(process.cwd(), env.OPENAPI_AUTO_OUTPUT || 'docs/openapi.generated.yaml');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, YAML.stringify(spec), 'utf-8');
    } catch (e: any) {
      logger.warn({ msg: 'OpenAPI auto-gen fallo (no critico)', err: e?.message });
    }
  }

  // ── Crear app Express (middlewares base, SIN rutas de negocio aun) ────────
  // El callback agrega auditAllApi en /api/* antes del montaje de rutas
  const app = createApp(undefined, (a) => {
    a.use('/api', auditAllApi(sequelize));
  });

  // ── Montar rutas via API Gateway ──────────────────────────────────────────
  // ESTO ES EL PASO CRITICO: las rutas se montan AQUI
  await mountApiGateway(app, { sequelize, schema });

  // ── Handlers finales (404 y errorHandler) ─────────────────────────────────
  // DEBEN ir DESPUES de mountApiGateway. De lo contrario el 404 bloquea todas las rutas.
  addFinalHandlers(app);

  // ── Servidor HTTP / HTTPS ─────────────────────────────────────────────────
  const port = env.PORT || 3000;
  let server: http.Server | https.Server;

  if (env.HTTPS_ENABLE && env.HTTPS_CERT_PATH && env.HTTPS_KEY_PATH) {
    server = https.createServer({
      cert: fs.readFileSync(env.HTTPS_CERT_PATH),
      key:  fs.readFileSync(env.HTTPS_KEY_PATH),
    }, app);
    logger.info({ msg: 'HTTPS habilitado' });
  } else {
    server = http.createServer(app);
  }

  // ── WebSocket + Webhook worker ────────────────────────────────────────────
  initSocketServer(server);
  try { startWebhookWorker(sequelize); } catch (e: any) {
    logger.warn({ msg: 'Webhook worker no inicio', err: e?.message });
  }

  // Timeouts recomendados para produccion con proxy inverso (Nginx, ALB)
  server.headersTimeout   = env.SERVER_HEADERS_TIMEOUT_MS  || 65000;
  server.keepAliveTimeout = env.SERVER_KEEPALIVE_TIMEOUT_MS || 61000;

  // ── Escuchar en el puerto ─────────────────────────────────────────────────
  server.listen(port, () => {
    const d = pluginRegistry.getDomain();
    logger.info({
      msg: '==============================',
      servidor: `http://localhost:${port}`,
      env: env.NODE_ENV,
      dominio: d?.name,
      docs: env.DOCS_ENABLE ? `http://localhost:${port}${env.DOCS_PATH || '/docs'}` : 'deshabilitado',
      health: `http://localhost:${port}/health`,
      ready:  `http://localhost:${port}/ready`,
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (sig: string) => {
    logger.info({ msg: `${sig} recibido, cerrando servidor...` });
    server.close(async () => {
      await pluginRegistry.unmountAll();
      await sequelize.close();
      await closeRedisClient();
      logger.info({ msg: 'Servidor cerrado limpiamente' });
      process.exit(0);
    });
    // Fuerza el cierre si tarda mas de GRACEFUL_SHUTDOWN_MS
    setTimeout(() => {
      logger.error({ msg: 'Shutdown forzado por timeout' });
      process.exit(1);
    }, env.GRACEFUL_SHUTDOWN_MS || 15000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((e) => {
  logger.error({ msg: 'Error fatal al iniciar el servidor', err: e?.stack || String(e) });
  process.exit(1);
});
