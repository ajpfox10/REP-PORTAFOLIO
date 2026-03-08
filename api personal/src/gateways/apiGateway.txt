/**
 * @file gateways/apiGateway.ts
 * @description API Gateway central.
 *
 * --- Para quien no sabe de sistemas ---
 * El API Gateway es como la recepcion de un edificio de oficinas.
 * Toda visita entra por ahi primero: la recepcion verifica quien es,
 * registra la entrada, aplica reglas de seguridad y despues la manda
 * al piso correcto. Nadie llega directo a las oficinas sin pasar por recepcion.
 *
 * --- Tecnicamente ---
 * Centraliza en un solo lugar:
 *   - Versionado de rutas (/api/v1, /api/v2)
 *   - Rate limiting por endpoint
 *   - Request ID unico por llamada (trazabilidad)
 *   - Logging de entrada/salida
 *   - Manejo uniforme de errores
 *   - CORS y seguridad HTTP
 *   - Autenticacion (authContext antes de cualquier ruta protegida)
 *
 * Patron: todas las rutas de negocio se montan VIA este gateway,
 * nunca directamente en app.ts.
 */

import { Express, Request, Response, NextFunction } from 'express';
import { Sequelize } from 'sequelize';
import { SchemaSnapshot } from '../db/schema/types';
import { authContext } from '../middlewares/authContext';
import { requirePermission } from '../middlewares/rbacCrud';
import { buildHealthRouter } from '../routes/health.routes';
import { buildAuthRouter } from '../routes/auth.routes';
import { buildCrudRouter } from '../routes/crud.routes';
import { buildDocumentsRouter } from '../routes/documents.routes';
import { buildDocumentsUploadRouter } from '../routes/documents.upload.routes';
import { buildPersonalRouter } from '../routes/personal.routes';
import { buildAgentesFotoRouter } from '../routes/agentesFoto.routes';
import { buildCertificadosRouter } from '../routes/certificados.routes';
import { buildEventosRouter } from '../routes/eventos.routes';
import { buildApiKeysRouter } from '../routes/apiKeys.routes';
import { buildWebhooksRouter } from '../routes/webhooks.routes';
import { buildAsistenciaRouter } from '../routes/asistencia.routes';
import { buildUsuariosRouter } from '../routes/usuarios.routes';
import { buildSwaggerRouter } from '../routes/swagger.routes';
import { buildDocsRouter } from '../routes/docs.routes';
import { idempotencyMiddleware } from '../middlewares/idempotency';
import { docsAuth } from '../middlewares/docsAuth';
import { metricsHandler } from '../metrics/metricsHandler';
import { metricsAuth } from '../middlewares/metricsAuth';
import { initWebhookEmitter } from '../webhooks/emitters';
import { auditReadMiddleware } from '../middlewares/auditRead';
import { mountAutoRoutes } from '../routes/auto';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { pluginRegistry, PluginContext } from '../core/plugin';

export interface GatewayOptions {
  sequelize: Sequelize;
  schema: SchemaSnapshot;
  apiVersion?: string;
}

/**
 * Monta todas las rutas en la app Express a traves del gateway.
 * Este es el unico lugar donde se registran rutas - ningun otro archivo
 * debe llamar app.use() directamente.
 */
export async function mountApiGateway(app: Express, opts: GatewayOptions): Promise<void> {
  const { sequelize, schema } = opts;
  const apiVersion = opts.apiVersion || env.API_VERSION || 'v1';
  const apiPrefix = `/api/${apiVersion}`;

  logger.info({ msg: 'API Gateway arrancando', apiPrefix, domain: pluginRegistry.getDomain()?.name || 'sin dominio' });

  // ── Health (siempre publico, sin autenticacion) ───────────────────────────
  app.use(buildHealthRouter(sequelize));
  // Aliases bajo /api/v1/ para clientes que los necesiten
  app.get(`${apiPrefix}/health`, (_req, res) => res.json({ ok: true, status: 'up' }));
  app.get(`${apiPrefix}/ready`, async (_req, res) => {
    try {
      await sequelize.query('SELECT 1');
      return res.json({ ok: true, status: 'ready', db: 'up' });
    } catch {
      return res.status(503).json({ ok: false, status: 'not-ready', db: 'down' });
    }
  });

  // ── Swagger / OpenAPI Docs ────────────────────────────────────────────────
  if (env.DOCS_ENABLE) {
    const docsPath = env.DOCS_PATH || '/docs';
    app.use(docsPath, authContext(sequelize), docsAuth, buildSwaggerRouter());
    app.use(docsPath, authContext(sequelize), docsAuth, buildDocsRouter());
  }

  // ── Metricas Prometheus ───────────────────────────────────────────────────
  if (env.METRICS_ENABLE) {
    app.get(env.METRICS_PATH, authContext(sequelize), metricsAuth, metricsHandler);
  }

  // ── Auth (NO requiere token - es el endpoint para obtener el token) ────────
  app.use(`${apiPrefix}/auth`, buildAuthRouter(sequelize));

  // ── Idempotency (evita duplicados por doble-click o reintentos) ────────────
  app.use(apiPrefix, idempotencyMiddleware(sequelize));

  // ── Rutas protegidas (todas requieren token JWT valido) ────────────────────
  const protect = [authContext(sequelize), requirePermission('api:access')];

  app.use(`${apiPrefix}/documents`, ...protect, buildDocumentsRouter(sequelize));
  app.use(`${apiPrefix}/documents`, ...protect, buildDocumentsUploadRouter(sequelize));
  app.use(`${apiPrefix}/personal`,  ...protect, buildPersonalRouter(sequelize));
  app.use(`${apiPrefix}/agentes`,   ...protect, buildAgentesFotoRouter());
  app.use(`${apiPrefix}/certificados`, ...protect, buildCertificadosRouter(sequelize));
  app.use(`${apiPrefix}/eventos`,   ...protect, buildEventosRouter(sequelize));
  app.use(`${apiPrefix}/api-keys`,  ...protect, buildApiKeysRouter(sequelize));
  app.use(`${apiPrefix}/usuarios`,  ...protect, buildUsuariosRouter(sequelize));
  app.use(`${apiPrefix}/webhooks`,  ...protect, buildWebhooksRouter(sequelize));
  app.use(`${apiPrefix}/asistencia`, ...protect, buildAsistenciaRouter());

  // ── Audit reads (registra lecturas sensibles) ─────────────────────────────
  app.use(apiPrefix, authContext(sequelize), auditReadMiddleware(sequelize));

  // ── CRUD dinamico (genera rutas para TODAS las tablas de la BD) ───────────
  app.use(apiPrefix, ...protect, buildCrudRouter(sequelize, schema));

  // ── Auto-routes (DX: rutas definidas en src/routes/auto/) ────────────────
  await mountAutoRoutes(app, sequelize, schema);

  // ── Inicializar emisor de webhooks ────────────────────────────────────────
  initWebhookEmitter(sequelize);

  // ── Montar dominio + plugins registrados ──────────────────────────────────
  const ctx: PluginContext = { app, sequelize, schema, apiVersion, apiPrefix };
  await pluginRegistry.mountAll(ctx);

  logger.info({
    msg: 'API Gateway montado',
    apiPrefix,
    rutas: [
      `${apiPrefix}/auth`,
      `${apiPrefix}/documents`,
      `${apiPrefix}/personal`,
      `${apiPrefix}/agentes`,
      `${apiPrefix}/eventos`,
      `${apiPrefix}/certificados`,
      `${apiPrefix}/api-keys`,
      `${apiPrefix}/webhooks`,
      `${apiPrefix}/usuarios`,
      `${apiPrefix}/:tabla (CRUD dinamico)`,
    ],
  });
}
