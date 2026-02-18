// src/routes/index.ts
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
import { buildSwaggerRouter } from "./swagger.routes";
import { buildDocumentsRouter } from "./documents.routes";
import { buildPersonalRouter } from "./personal.routes";
import { buildAgentesFotoRouter } from "./agentesFoto.routes";
import { buildCertificadosRouter } from "./certificados.routes";
import { mountAutoRoutes } from "./auto";
import { idempotencyMiddleware } from '../middlewares/idempotency';
import { buildDocumentsUploadRouter } from './documents.upload.routes';
import { buildApiKeysRouter } from './apiKeys.routes';
import { docsAuth } from '../middlewares/docsAuth';
import { buildWebhooksRouter } from './webhooks.routes';
import { metricsHandler } from "../metrics/metricsHandler";
import { metricsAuth } from "../middlewares/metricsAuth";
import { requirePermission } from "../middlewares/rbacCrud";
import { initWebhookEmitter } from '../webhooks/emitters';
import { auditReadMiddleware } from '../middlewares/auditRead';

export const mountRoutes = (app: Express, sequelize: Sequelize, schema: SchemaSnapshot) => {
  // ── Health (público) ─────────────────────────────────────────────────────────
  app.use(buildHealthRouter(sequelize));

  // ── Docs (OpenAPI + Swagger UI) ──────────────────────────────────────────────
  if (env.DOCS_ENABLE) {
    const docsPath = env.DOCS_PATH || "/docs";

    // Swagger UI (interfaz gráfica)
    app.use(docsPath, authContext(sequelize), docsAuth, buildSwaggerRouter());

    // Docs YAML/JSON
    app.use(docsPath, authContext(sequelize), docsAuth, buildDocsRouter());
  }

  // ── Métricas ─────────────────────────────────────────────────────────────────
  if (env.METRICS_ENABLE) {
    app.get(env.METRICS_PATH, authContext(sequelize), metricsAuth, metricsHandler);
  }

  // ── Auth (sin authContext: son los endpoints para obtener token) ─────────────
  app.use("/api/v1/auth", buildAuthRouter(sequelize));

  // ── Idempotency (para todo /api/v1) ─────────────────────────────────────────
  app.use('/api/v1', idempotencyMiddleware(sequelize));

  // ── Certificados ─────────────────────────────────────────────────────────────
  app.use(
    "/api/v1/certificados",
    authContext(sequelize),
    requirePermission("api:access"),
    buildCertificadosRouter(sequelize)
  );

  // ── Eventos ──────────────────────────────────────────────────────────────────
  app.use(
    "/api/v1/eventos",
    authContext(sequelize),
    requirePermission("api:access"),
    buildEventosRouter(sequelize)
  );

  // ── Documentos ───────────────────────────────────────────────────────────────
  app.use(
    "/api/v1/documents",
    authContext(sequelize),
    requirePermission("api:access"),
    buildDocumentsRouter(sequelize)
  );

  app.use(
    '/api/v1/documents',
    authContext(sequelize),
    requirePermission('api:access'),
    buildDocumentsUploadRouter(sequelize)
  );

  // ── Fotos de agentes ─────────────────────────────────────────────────────────
  app.use(
    "/api/v1/agentes",
    authContext(sequelize),
    requirePermission("api:access"),
    buildAgentesFotoRouter()
  );

  // ── Personal ─────────────────────────────────────────────────────────────────
  app.use(
    "/api/v1/personal",
    authContext(sequelize),
    requirePermission("api:access"),
    buildPersonalRouter(sequelize)
  );

  // ── Health (legacy redirect) ─────────────────────────────────────────────────
  app.get("/api/v1/health", (_req, res) => res.redirect(307, "/health"));
  app.get("/api/v1/ready", (_req, res) => res.redirect(307, "/ready"));

  // ── API Keys ─────────────────────────────────────────────────────────────────
  app.use(
    '/api/v1/api-keys',
    authContext(sequelize),
    requirePermission('api:access'),
    buildApiKeysRouter(sequelize)
  );

  // ── Webhooks ─────────────────────────────────────────────────────────────────
  app.use(
    '/api/v1/webhooks',
    authContext(sequelize),
    requirePermission('api:access'),
    buildWebhooksRouter(sequelize)
  );

  // ── Audit reads ──────────────────────────────────────────────────────────────
  app.use('/api/v1', authContext(sequelize), auditReadMiddleware(sequelize));

  // ── CRUD dinámico (protegido) ─────────────────────────────────────────────────
  app.use(
    "/api/v1",
    authContext(sequelize),
    requirePermission("api:access"),
    buildCrudRouter(sequelize, schema)
  );

  // ── Webhook emitter ───────────────────────────────────────────────────────────
  initWebhookEmitter(sequelize);

  // ── Auto routes ───────────────────────────────────────────────────────────────
  mountAutoRoutes(app, sequelize, schema);
};
