import { Express, Request, Response, NextFunction } from "express";
import { Sequelize } from "sequelize";
import { SchemaSnapshot } from "../db/schema/types";
import { buildHealthRouter } from "./health.routes";
import { buildCrudRouter } from "./crud.routes";
import { env } from "../config/env";
import { buildEventosRouter } from "./eventos.routes";
import { buildAuthRouter } from "./auth.routes";
import { authContext } from "../middlewares/authContext";
import { buildDocsRouter } from "./docs.routes";
import { buildDocumentsRouter } from "./documents.routes";
import { buildPersonalRouter } from "./personal.routes";
import { buildAgentesFotoRouter } from "./agentesFoto.routes";
import { buildCertificadosRouter } from "./certificados.routes";
import { mountAutoRoutes } from "./auto";
import { idempotencyMiddleware } from '../middlewares/idempotency';
import { buildDocumentsUploadRouter } from './documents.upload.routes';
import { softDeleteMiddleware } from '../middlewares/softDelete';
import { buildApiKeysRouter } from './apiKeys.routes';
import { docsAuth } from '../middlewares/docsAuth';
import { buildWebhooksRouter } from './webhooks.routes';
import { metricsHandler } from "../metrics/metricsHandler";
import { requirePermission } from "../middlewares/rbacCrud";
import { initWebhookEmitter } from '../webhooks/emitters'; // ✅ AGREGADO

function metricsAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.METRICS_PROTECT) return next();
  const header = req.headers["x-metrics-token"];
  const tokenFromHeader = Array.isArray(header) ? header[0] : header;
  const token = tokenFromHeader || "";
  if (!token || token !== env.METRICS_TOKEN) {
    return res.status(401).json({ ok: false, error: "No autorizado (metrics)" });
  }
  return next();
}

export const mountRoutes = (app: Express, sequelize: Sequelize, schema: SchemaSnapshot) => {
  // system/health (público)
  app.use(buildHealthRouter(sequelize));

  // ✅ DOCS (OpenAPI)
  if (env.DOCS_ENABLE) {
    const docsPath = env.DOCS_PATH || "/docs";
    app.use(
      docsPath,
      authContext(sequelize),
      docsAuth,
      buildDocsRouter()
    );
  }

  // ✅ Métricas
  if (env.METRICS_ENABLE) {
    app.get(
      env.METRICS_PATH,
      authContext(sequelize),
      metricsAuth,
      metricsHandler
    );
  }

  // ✅ AUTH
  app.use("/api/v1/auth", buildAuthRouter(sequelize));

  // ✅ IDEMPOTENCY MIDDLEWARE
  app.use('/api/v1', idempotencyMiddleware(sequelize));

  // ✅ Certificados
  app.use(
    "/api/v1/certificados",
    authContext(sequelize),
    requirePermission("api:access"),
    buildCertificadosRouter(sequelize)
  );

  // ✅ Eventos
  app.use(
    "/api/v1/eventos",
    authContext(sequelize),
    requirePermission("api:access"),
    buildEventosRouter(sequelize)
  );

  // ✅ Documents (GET /documents, GET /documents/:id/file)
  app.use(
    "/api/v1/documents",
    authContext(sequelize),
    requirePermission("api:access"),
    buildDocumentsRouter(sequelize)
  );

  // ✅ Upload de documentos (mismo prefijo, router separado)
  app.use(
    '/api/v1/documents',
    authContext(sequelize),
    requirePermission('api:access'),
    buildDocumentsUploadRouter(sequelize)
  );

  // ✅ Foto credencial
  app.use(
    "/api/v1/agentes",
    authContext(sequelize),
    requirePermission("api:access"),
    buildAgentesFotoRouter()
  );

  // ✅ Personal search
  app.use(
    "/api/v1/personal",
    authContext(sequelize),
    requirePermission("api:access"),
    buildPersonalRouter(sequelize)
  );

  // ✅ Health endpoints (legacy)
  app.get("/api/v1/health", (_req, res) => res.redirect(307, "/health"));
  app.get("/api/v1/ready", (_req, res) => res.redirect(307, "/ready"));

  // ✅ SOFT DELETE MIDDLEWARE
  app.use('/api/v1', softDeleteMiddleware(sequelize));

  // ✅ API Keys Management
  app.use(
    '/api/v1/api-keys',
    authContext(sequelize),
    requirePermission('api:access'),
    buildApiKeysRouter(sequelize)
  );

  // ✅ Webhooks Management
  app.use(
    '/api/v1/webhooks',
    authContext(sequelize),
    requirePermission('api:access'),
    buildWebhooksRouter(sequelize)
  );

  // ✅ CRUD protegido
  app.use(
    "/api/v1",
    authContext(sequelize),
    requirePermission("api:access"),
    buildCrudRouter(sequelize, schema)
  );

  // ✅ Inicializar emisor de webhooks
  initWebhookEmitter(sequelize);

  // ✅ AUTO ROUTES
  mountAutoRoutes(app, sequelize, schema);
};