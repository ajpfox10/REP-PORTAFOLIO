/**
 * App bootstrap — v11
 *
 * Nuevos módulos vs v10:
 *   P01/P02: Tests seguridad + auth (src/tests/)
 *   P03: pacientesRouter          — CRUD completo + historial + ficha
 *   P04: agendaRouter             — semanal/mensual/disponibilidad/conflictos
 *   P05: notificationsService     — recordatorios vacunas + turnos vía BullMQ
 *   P06: portalPropietarioRouter  — portal mejorado
 *   P07: stockRouter              — lotes FEFO, alertas, orden de compra
 *   P08: dashboardRouter          — KPIs completos
 *   P09: pdfRouter                — ficha, receta, certificado vacunación
 *   P10: telemetry                — OpenTelemetry traces + métricas
 *   P11: openApiRouter            — OpenAPI 3.1 + Swagger UI + ReDoc
 *   P12: i18nMiddleware           — es-AR / en-US / pt-BR
 */

import express from "express";
import cors from "cors";

// P10: OpenTelemetry — debe inicializarse primero
import { initTelemetry, telemetryMiddleware } from "./infra/telemetry/telemetry.js";

import { buildSecurityHeaders } from "./security/headers/securityHeaders.js";
import { type AppConfig } from "./config/types.js";
import { pinoHttpMiddleware } from "./core/logging/pinoHttp.js";
import { errorHandler } from "./core/errors/errorHandler.js";

import { buildRedis } from "./infra/redis/redisClient.js";
import { buildRateLimiter } from "./infra/rate-limit/rateLimiter.js";
import { buildIdempotencyMiddleware } from "./infra/idempotency/idempotencyMiddleware.js";
import { buildQueue } from "./infra/queue/queueClient.js";
import { buildMasterPool, buildTenantPoolFactory } from "./db/pools.js";

import { buildTenantResolver } from "./tenancy/tenantResolver.js";
import { buildSchemaEngine } from "./schema-engine/schemaEngine.js";
import { buildPolicyEngine } from "./security/policy-engine/index.js";
import { buildJwtService } from "./security/auth/jwtService.js";
import { buildAuthMiddleware } from "./security/auth/authMiddleware.js";
import { buildJwksRouter } from "./security/auth/jwksRouter.js";
import { buildHealthRouter } from "./infra/health/healthRouter.js";
import { buildMetricsRouter, metricsMiddleware } from "./infra/metrics/metrics.js";
import { buildPlanLimits } from "./infra/plan-limits/planLimits.js";
import { buildFeatureFlags } from "./infra/feature-flags/featureFlags.js";
import { buildKmsEnvelope } from "./security/encryption/kmsEnvelope.js";
import { buildFilesRouter } from "./modules/files/filesRouter.js";
import { registerScheduledJobs } from "./infra/scheduler/scheduler.js";

import { buildAuditMiddleware } from "./security/audit/auditService.js";
import { validateSriRegistry } from "./security/headers/sri.js";

// P11
import { buildOpenApiRouter } from "./infra/openapi/openApiSpec.js";
// P12
import { i18nMiddleware } from "./infra/i18n/i18n.js";

// Routers existentes
import { coreRouter } from "./modules/core/coreRouter.js";
import { buildDynamicCrudRouter } from "./modules/dynamic-crud/dynamicCrudRouter.js";
import { internalRouter } from "./modules/internal/internalRouter.js";
import { billingRouter } from "./billing/billingRouter.js";
import { buildAuthRouter } from "./modules/auth/authRouter.js";
import { buildPasswordResetRouter } from "./modules/auth/passwordResetRouter.js";
import { buildClinicalRouter } from "./modules/clinical/clinicalRouter.js";
import { buildAuthzRouter } from "./modules/authz/authzRouter.js";
import { buildInventoryRouter } from "./modules/inventory/inventoryRouter.js";
import { buildComplianceRouter } from "./modules/compliance/complianceRouter.js";
import { buildTurnosRouter } from "./modules/turnos/turnosRouter.js";
import { buildPropietariosRouter } from "./modules/propietarios/propietariosRouter.js";
import { buildVacunasRouter } from "./modules/vacunas/vacunasRouter.js";
import {
  buildPrescripcionesRouter, buildInternacionesRouter,
  buildSucursalesRouter, buildVeterinariosRouter,
} from "./modules/clinical/domainRouters.js";
import { buildFacturacionRouter } from "./modules/facturacion/facturacionRouter.js";
import { buildPortalRouter } from "./modules/portal/portalRouter.js";
import { buildWhatsAppRouter } from "./infra/whatsapp/whatsappRouter.js";
import { buildSalesRouter } from "./modules/inventory/salesRouter.js";
import { isAllowedCorsOrigin } from "./security/network/requestSecurity.js";

// Routers v11
import { buildPacientesRouter }         from "./modules/pacientes/pacientesRouter.js";
import { buildAgendaRouter }            from "./modules/agenda/agendaRouter.js";
import { buildNotificationsRouter }     from "./modules/notifications/notificationsService.js";
import { buildPortalPropietarioRouter } from "./modules/portal/portalPropietarioRouter.js";
import { buildStockRouter }             from "./modules/inventory/stockRouter.js";
import { buildDashboardRouter }         from "./modules/dashboard/dashboardRouter.js";
import { buildPdfRouter }               from "./modules/pdf/pdfRouter.js";

export async function buildApp(config: AppConfig) {
  // P10: OpenTelemetry
  initTelemetry({
    serviceName:    "vetpro-api",
    serviceVersion: "11.0.0",
    environment:    config.nodeEnv,
    otlpEndpoint:   (config as any).otlpEndpoint,
    enabled:        config.nodeEnv === "production" || !!(config as any).otlpEndpoint,
  });

  if (config.nodeEnv === "production") validateSriRegistry();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(buildSecurityHeaders({ isDev: config.nodeEnv !== "production" }));

  app.use(cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.nodeEnv !== "production") {
        return callback(null, config.corsAllowedOrigins.includes(origin));
      }
      const ok = isAllowedCorsOrigin(origin, {
        baseDomain: config.corsDomain,
        extraOrigins: config.corsAllowedOrigins,
      });
      if (ok) return callback(null, true);
      callback(new Error(`CORS: origen no permitido: ${origin}`));
    },
  }));

  app.use(express.json({
    limit: "2mb",
    verify: (req: any, _res, buf) => { req.rawBodyBuf = buf; req.rawBody = buf?.toString("utf8") ?? ""; },
  }));

  app.use(pinoHttpMiddleware);
  app.use(telemetryMiddleware());   // P10
  app.use(i18nMiddleware());        // P12

  if (config.metricsEnable) app.use(metricsMiddleware);

  const redis            = buildRedis(config);
  const queue            = buildQueue(config);
  const rateLimiter      = buildRateLimiter({ config, redis });
  const jwtService       = buildJwtService({
    algorithm: config.jwtAlgorithm, keyId: config.jwtKeyId,
    secret: config.jwtSecret, refreshSecret: config.jwtRefreshSecret,
    privateKeyPem: config.jwtPrivateKeyPem, jwksPublicKeysJson: config.jwksPublicKeysJson,
  });

  app.use(rateLimiter.global());

  const masterPool        = buildMasterPool(config);
  const tenantPoolFactory = buildTenantPoolFactory(config);
  const planLimits        = buildPlanLimits({ masterPool });
  const featureFlags      = buildFeatureFlags({ masterPool, redis });
  const kms               = buildKmsEnvelope({
    kmsKeyId: config.kmsKeyId || undefined,
    masterSecret: config.encryptionMasterSecret || undefined,
    redis, masterPool,
  });

  const tenantResolver = buildTenantResolver({ config, masterPool, tenantPoolFactory, redis });
  const schemaEngine   = buildSchemaEngine({ config, redis });
  const policyEngine   = buildPolicyEngine({ config });
  const authMiddleware = buildAuthMiddleware(jwtService, { redis, config });

  if (config.nodeEnv !== "test") {
    registerScheduledJobs({ redis }).catch(err =>
      console.error("[scheduler] failed to register jobs:", err)
    );
  }

  // 1. Tenant resolution
  app.use(async (req, _res, next) => {
    try { (req as any).ctx = await tenantResolver.resolve(req); next(); }
    catch (e) { next(e); }
  });

  // 2. Health + JWKS + Metrics
  app.use(buildHealthRouter({ redis, masterPool, internalToken: config.internalApiToken, version: "11.0.0" }));
  app.use(await buildJwksRouter(config));
  if (config.metricsEnable) app.use(buildMetricsRouter({ internalToken: config.internalApiToken }));

  // 3. P11: OpenAPI — público, antes del auth
  app.use(buildOpenApiRouter());

  // 4. Auth endpoints (públicos)
  app.use("/api/v1/auth",   buildAuthRouter({ jwtService, redis, config, kms }));
  app.use("/api/v1/auth",   buildPasswordResetRouter({ redis, config, kms }));
  app.use("/api/v1/portal", buildPortalRouter({ redis, config, jwtService, featureFlags }));

  // 5. JWT + JTI blocklist
  app.use(authMiddleware);
  app.use(buildIdempotencyMiddleware({ redis, ttlSeconds: 60 * 60 }));

  // 6. Audit middleware
  app.use("/api/v1/users",          buildAuditMiddleware({ pool: masterPool, resource: "user" }));
  app.use("/api/v1/clinical",       buildAuditMiddleware({ pool: masterPool, resource: "clinical" }));
  app.use("/api/v1/prescripciones", buildAuditMiddleware({ pool: masterPool, resource: "prescripcion" }));
  app.use("/api/v1/internaciones",  buildAuditMiddleware({ pool: masterPool, resource: "internacion" }));
  app.use("/api/v1/facturacion",    buildAuditMiddleware({ pool: masterPool, resource: "facturacion" }));
  app.use("/api/v1/authz",          buildAuditMiddleware({ pool: masterPool, resource: "authz" }));
  app.use("/api/v1/pacientes",      buildAuditMiddleware({ pool: masterPool, resource: "paciente" }));

  // 7. Core
  app.use("/api/v1",       coreRouter);
  app.use("/api/v1/authz", buildAuthzRouter({ config }));

  // 8. Plan: basic
  app.use("/api/v1/clinical",       buildClinicalRouter());
  app.use("/api/v1/turnos",         buildTurnosRouter({ redis }));
  app.use("/api/v1/propietarios",   buildPropietariosRouter());
  app.use("/api/v1/vacunas",        buildVacunasRouter());
  app.use("/api/v1/prescripciones", buildPrescripcionesRouter());
  app.use("/api/v1/veterinarios",   buildVeterinariosRouter());
  app.use("/api/v1/inventory",      buildInventoryRouter());
  app.use("/api/v1/sales",          buildSalesRouter());
  app.use("/api/v1/pacientes",      buildPacientesRouter());       // P03
  app.use("/api/v1/agenda",         buildAgendaRouter());          // P04
  app.use("/api/v1/stock",          buildStockRouter());           // P07

  // 9. Plan: pro
  app.use("/api/v1/internaciones",       buildInternacionesRouter());
  app.use("/api/v1/sucursales",          buildSucursalesRouter());
  app.use("/api/v1/facturacion",         buildFacturacionRouter({ featureFlags, redis }));
  app.use("/api/v1/dashboard",           buildDashboardRouter());         // P08
  app.use("/api/v1/pdf",                 buildPdfRouter());               // P09
  app.use("/api/v1/portal-propietario",  buildPortalPropietarioRouter()); // P06
  app.use("/api/v1/notificaciones",      buildNotificationsRouter({ masterPool, queue, config: config as any })); // P05

  // 10. Plan: enterprise
  app.use("/api/v1/whatsapp", buildWhatsAppRouter({ config, featureFlags }));

  // 11. Infra
  app.use("/api/v1/compliance", buildComplianceRouter({ queue }));
  app.use("/api/v1/db",         buildDynamicCrudRouter({ config, schemaEngine, policyEngine, rateLimiter, planLimits }));
  app.use("/api/v1/billing",    billingRouter({ config, redis }));

  if (config.s3Bucket) app.use("/api/v1/files", buildFilesRouter(config));

  app.use("/api/internal", internalRouter({
    config, redis, masterPool, tenantPoolFactory, jwtService, kms, featureFlags, queue,
  }));

  app.use(errorHandler);
  return app;
}
