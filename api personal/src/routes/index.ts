import { Express, Request, Response, NextFunction } from "express";
import { Sequelize } from "sequelize";
import { SchemaSnapshot } from "../db/schema/types";
import { buildHealthRouter } from "./health.routes";
import { buildCrudRouter } from "./crud.routes";
import { env } from "../config/env";
import { buildEventosRouter } from "./eventos.routes";
import { buildAuthRouter } from "./auth.routes";
import { authContext } from "../middlewares/authContext";
import { buildDocsRouter, docsProtect } from "./docs.routes";
import { buildDocumentsRouter } from "./documents.routes";
import { buildPersonalRouter } from "./personal.routes";
import { buildAgentesFotoRouter } from "./agentesFoto.routes";

// ✅ Handler correcto: usa registry (prom.ts) y devuelve formato Prometheus
import { metricsHandler } from "../metrics/metricsHandler";

// ✅ NUEVO: RBAC genérico (no cambia endpoints, solo bloquea)
import { requirePermission } from "../middlewares/rbacCrud";

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

  // ✅ DOCS (OpenAPI YAML) - protegido en production por defecto
  // Ahora además requiere permiso base de acceso a API (si RBAC está habilitado)
  if (env.DOCS_ENABLE) {
    const docsPath = env.DOCS_PATH || "/docs";
    app.use(
      docsPath,
      authContext(sequelize),
      requirePermission("api:access"),
      docsProtect,
      buildDocsRouter()
    );
  }

  // ✅ Endpoint de métricas para Prometheus, protegido por token;
  // expone métricas de la aplicación sin requerir autenticación de usuario.
  if (env.METRICS_ENABLE) {
    app.get(env.METRICS_PATH, metricsAuth, metricsHandler);
  }

  // ✅ AUTH: login/refresh/logout públicos (NO authContext acá)
  app.use("/api/v1/auth", buildAuthRouter(sequelize));

  // ✅ Eventos: antes decía “se protege adentro”.
  // Para deny-by-default global, lo protegemos acá también.
  // (No cambia endpoint. Si adentro ya se protege, esto refuerza.)
  app.use(
    "/api/v1/eventos",
    authContext(sequelize),
    requirePermission("api:access"),
    buildEventosRouter(sequelize)
  );

  // ✅ Documents (tblarchivos -> stream desde DOCUMENTS_BASE_DIR)
  app.use(
    "/api/v1/documents",
    authContext(sequelize),
    requirePermission("api:access"),
    buildDocumentsRouter(sequelize)
  );

  // ✅ Foto credencial por DNI (filesystem) - NO toca el CRUD genérico
  app.use(
    "/api/v1/agentes",
    authContext(sequelize),
    requirePermission("api:access"),
    buildAgentesFotoRouter()
  );

  // ✅ Personal search (dni / apellido / nombre)
  app.use(
    "/api/v1/personal",
    authContext(sequelize),
    requirePermission("api:access"),
    buildPersonalRouter(sequelize)
  );

  // ✅ Health endpoints (legacy + api/v1 aliases)
  app.get("/api/v1/health", (_req, res) => res.redirect(307, "/health"));
  app.get("/api/v1/ready", (_req, res) => res.redirect(307, "/ready"));

  // ✅ CRUD protegido: authContext + permiso base antes del router
  app.use(
    "/api/v1",
    authContext(sequelize),
    requirePermission("api:access"),
    buildCrudRouter(sequelize, schema)
  );
};
