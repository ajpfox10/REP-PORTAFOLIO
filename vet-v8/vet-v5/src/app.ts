import express from "express";
import helmet from "helmet";
import cors from "cors";

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
import { buildMetricsRouter, metricsMiddleware } from "./infra/metrics/metrics.js";
import { buildPlanLimits } from "./infra/plan-limits/planLimits.js";
import { buildFeatureFlags } from "./infra/feature-flags/featureFlags.js";
import { buildKmsEnvelope } from "./security/encryption/kmsEnvelope.js";
import { buildFilesRouter } from "./modules/files/filesRouter.js";

// Core routers
import { coreRouter } from "./modules/core/coreRouter.js";
import { buildDynamicCrudRouter } from "./modules/dynamic-crud/dynamicCrudRouter.js";
import { internalRouter } from "./modules/internal/internalRouter.js";
import { billingRouter } from "./billing/billingRouter.js";
import { buildAuthRouter } from "./modules/auth/authRouter.js";
import { buildPasswordResetRouter } from "./modules/auth/passwordResetRouter.js";
import { buildClinicalRouter } from "./modules/clinical/clinicalRouter.js";
import { buildAgendaRouter } from "./modules/agenda/agendaRouter.js";
import { buildAuthzRouter } from "./modules/authz/authzRouter.js";
import { buildInventoryRouter } from "./modules/inventory/inventoryRouter.js";
import { buildComplianceRouter } from "./modules/compliance/complianceRouter.js";

// v5 new modules
import { buildTurnosRouter } from "./modules/turnos/turnosRouter.js";
import { buildPropietariosRouter } from "./modules/propietarios/propietariosRouter.js";
import { buildVacunasRouter } from "./modules/vacunas/vacunasRouter.js";
import {
  buildPrescripcionesRouter,
  buildInternacionesRouter,
  buildSucursalesRouter,
  buildVeterinariosRouter,
} from "./modules/clinical/domainRouters.js";
import { buildFacturacionRouter } from "./modules/facturacion/facturacionRouter.js";
import { buildDashboardRouter } from "./modules/dashboard/dashboardRouter.js";
import { buildPortalRouter } from "./modules/portal/portalRouter.js";
import { buildPdfRouter } from "./modules/pdf/pdfRouter.js";
import { buildWhatsAppRouter } from "./infra/whatsapp/whatsappRouter.js";
import { buildSalesRouter } from "./modules/inventory/salesRouter.js";
import { startScheduler } from "./infra/scheduler/scheduler.js";

export async function buildApp(config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(helmet({ contentSecurityPolicy: config.nodeEnv === "production" }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({
    limit: "2mb",
    verify: (req: any, _res, buf) => {
      req.rawBodyBuf = buf;
      req.rawBody = buf?.toString("utf8") ?? "";
    },
  }));
  app.use(pinoHttpMiddleware);

  if (config.metricsEnable) app.use(metricsMiddleware);

  const redis = buildRedis(config);
  const queue = buildQueue(config);
  const rateLimiter = buildRateLimiter({ config, redis });

  const jwtService = buildJwtService({
    algorithm: config.jwtAlgorithm,
    keyId: config.jwtKeyId,
    secret: config.jwtSecret,
    refreshSecret: config.jwtRefreshSecret,
    privateKeyPem: config.jwtPrivateKeyPem,
    jwksPublicKeysJson: config.jwksPublicKeysJson,
  });

  app.use(rateLimiter.global());

  const masterPool = buildMasterPool(config);
  const tenantPoolFactory = buildTenantPoolFactory(config);

  const planLimits = buildPlanLimits({ masterPool });
  const featureFlags = buildFeatureFlags({ masterPool, redis });

  const kms = buildKmsEnvelope({
    kmsKeyId: config.kmsKeyId || undefined,
    masterSecret: config.encryptionMasterSecret || undefined,
    redis,
    masterPool,
  });

  const tenantResolver = buildTenantResolver({ config, masterPool, tenantPoolFactory, redis });
  const schemaEngine = buildSchemaEngine({ config, redis });
  const policyEngine = buildPolicyEngine({ config });
  const authMiddleware = buildAuthMiddleware(jwtService, { redis });

  // ── Start scheduler (cluster-safe via BullMQ repeatable jobs) ─────────────
  if (config.nodeEnv !== "test") {
    startScheduler({
      redis,
      masterPool,
      tenantPoolFactory,
    }).catch(err => console.error("[scheduler] failed to start", err));
  }

  // ── 1. Tenant resolution ──────────────────────────────────────────────────
  app.use(async (req, _res, next) => {
    try {
      (req as any).ctx = await tenantResolver.resolve(req);
      next();
    } catch (e) { next(e); }
  });

  // ── Health (public) ───────────────────────────────────────────────────────
  app.get("/health", async (_req, res) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
    try { const t = Date.now(); await redis.ping(); checks.redis = { ok: true, latencyMs: Date.now() - t }; }
    catch (e: any) { checks.redis = { ok: false, error: String(e?.message) }; }
    try { const t = Date.now(); await masterPool.query("SELECT 1"); checks.masterDb = { ok: true, latencyMs: Date.now() - t }; }
    catch (e: any) { checks.masterDb = { ok: false, error: String(e?.message) }; }
    const allOk = Object.values(checks).every(c => c.ok);
    res.status(allOk ? 200 : 503).json({ ok: allOk, ts: new Date().toISOString(), version: "5.0.0", checks });
  });

  // ── Public: JWKS, metrics ─────────────────────────────────────────────────
  app.use(await buildJwksRouter(config));
  if (config.metricsEnable) app.use(buildMetricsRouter(config));

  // ── Auth (unauthenticated) ────────────────────────────────────────────────
  app.use("/api/v1/auth", buildAuthRouter({ jwtService, redis, config, kms }));
  app.use("/api/v1/auth", buildPasswordResetRouter({ redis, config }));

  // ── Portal login (unauthenticated, plan-gated) ────────────────────────────
  app.post("/api/v1/portal/login", buildPortalRouter({ redis, config, jwtService, featureFlags }).handle?.bind?.(null) as any);

  // ── JWT validation for all protected routes ───────────────────────────────
  app.use(authMiddleware);

  // ── Idempotency ───────────────────────────────────────────────────────────
  app.use(buildIdempotencyMiddleware({ redis, ttlSeconds: 60 * 60 }));

  // ── Core ──────────────────────────────────────────────────────────────────
  app.use("/api/v1", coreRouter);
  app.use("/api/v1/authz", buildAuthzRouter({ config }));

  // ── Clinical — BASIC plan ─────────────────────────────────────────────────
  app.use("/api/v1/clinical", buildClinicalRouter());
  app.use("/api/v1/turnos", buildTurnosRouter());
  app.use("/api/v1/propietarios", buildPropietariosRouter());
  app.use("/api/v1/vacunas", buildVacunasRouter());
  app.use("/api/v1/prescripciones", buildPrescripcionesRouter());
  app.use("/api/v1/veterinarios", buildVeterinariosRouter());

  // ── Agenda — BASIC plan ───────────────────────────────────────────────────
  app.use("/api/v1/agenda", buildAgendaRouter());

  // ── Inventory + Sales — BASIC plan ───────────────────────────────────────
  app.use("/api/v1/inventory", buildInventoryRouter());
  app.use("/api/v1/sales", buildSalesRouter());

  // ── PRO plan modules ──────────────────────────────────────────────────────
  app.use("/api/v1/internaciones", buildInternacionesRouter());         // plan: pro
  app.use("/api/v1/sucursales", buildSucursalesRouter());               // plan: pro (multi_sucursal)
  app.use("/api/v1/facturacion", buildFacturacionRouter({ featureFlags })); // plan: pro
  app.use("/api/v1/dashboard", buildDashboardRouter({ redis, featureFlags })); // plan: pro
  app.use("/api/v1/portal", buildPortalRouter({ redis, config, jwtService, featureFlags })); // plan: pro
  app.use("/api/v1/pdf", buildPdfRouter({ featureFlags }));             // plan: pro

  // ── ENTERPRISE plan modules ───────────────────────────────────────────────
  app.use("/api/v1/whatsapp", buildWhatsAppRouter({ config, featureFlags })); // plan: enterprise

  // ── Dynamic CRUD + compliance + billing ──────────────────────────────────
  app.use("/api/v1/compliance", buildComplianceRouter({ queue }));
  app.use("/api/v1/db", buildDynamicCrudRouter({ config, schemaEngine, policyEngine, rateLimiter, planLimits }));
  app.use("/api/v1/billing", billingRouter({ config, redis }));

  // ── Files ─────────────────────────────────────────────────────────────────
  if (config.s3Bucket) {
    app.use("/api/v1/files", buildFilesRouter(config));
  }

  // ── Internal API ──────────────────────────────────────────────────────────
  app.use("/api/internal", internalRouter({
    config, redis, masterPool, tenantPoolFactory, jwtService, kms, featureFlags, queue,
  }));

  app.use(errorHandler);
  return app;
}
