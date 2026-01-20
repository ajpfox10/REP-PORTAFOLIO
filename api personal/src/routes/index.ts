import { Express, Request, Response, NextFunction } from "express";
import { Sequelize } from "sequelize";
import { SchemaSnapshot } from "../db/schema/types";
import { buildHealthRouter } from "./health.routes";
import { buildCrudRouter } from "./crud.routes";
import { env } from "../config/env";
import { metricsHandler } from "../metrics/metrics";
import { buildEventosRouter } from "./eventos.routes";
import { buildAuthRouter } from "./auth.routes";
import { authContext } from "../middlewares/authContext";
import { buildDocsRouter, docsProtect } from "./docs.routes";
import { buildDocumentsRouter } from "./documents.routes"; // ✅ agregado
import { buildAgentesRouter } from "./agentes.routes";

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
  // system/health
  app.use(buildHealthRouter(sequelize));

  // ✅ DOCS (OpenAPI YAML) - protegido en production por defecto
  if (env.DOCS_ENABLE) {
    const docsPath = env.DOCS_PATH || "/docs";
    app.use(docsPath, authContext(sequelize), docsProtect, buildDocsRouter());
  }

  if (env.METRICS_ENABLE) {
    app.get(env.METRICS_PATH, metricsAuth, metricsHandler);
  }

  // ✅ AUTH: login/refresh/logout públicos (NO authContext acá)
  app.use("/api/v1/auth", buildAuthRouter(sequelize));

  // eventos (ya se protege adentro con authContext + RBAC)
  app.use("/api/v1/eventos", buildEventosRouter(sequelize));

  // ✅ Documents (tblarchivos -> stream desde DOCUMENTS_BASE_DIR)
  app.use("/api/v1/documents", authContext(sequelize), buildDocumentsRouter(sequelize));
  // ✅ Rutas 
  app.use("/api/v1/agentes", authContext(sequelize), buildAgentesRouter(sequelize));

  // ✅ CRUD protegido: authContext antes del router
  app.use("/api/v1", authContext(sequelize), buildCrudRouter(sequelize, schema));



};
