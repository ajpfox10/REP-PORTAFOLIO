import type { Express } from "express";
import type { Sequelize } from "sequelize";
import type { SchemaSnapshot } from "../../db/schema/types";
import { env } from "../../config/env";
import { logger } from "../../logging/logger";
import { manifest as autoRoutes } from "./auto.manifest";

/**
 * Auto-mount de rutas (DX):
 * - Cada archivo en src/routes/auto/**\/*.routes.ts exporta:
 *   - basePath: string
 *   - buildRouter(ctx): Router
 *
 * Esto NO toca endpoints existentes: solo agrega nuevos mounts.
 */
export async function mountAutoRoutes(app: Express, sequelize: Sequelize, schema: SchemaSnapshot) {
  const ctx = { sequelize, schema, env };

  for (const entry of autoRoutes) {
    const mod: any = await entry.load();

    if (!mod?.basePath || typeof mod.basePath !== "string") {
      logger.warn({
        msg: "[autoRoutes] warning",
        detail: "[autoRoutes] módulo sin basePath, se ignora",
      });
      continue;
    }
    if (typeof mod.buildRouter !== "function") {
      logger.warn({
        msg: "[autoRoutes] warning",
        detail: `[autoRoutes] ${mod.basePath}: falta buildRouter(ctx), se ignora`,
      });
      continue;
    }

    const router = mod.buildRouter(ctx);
    if (!router) {
      logger.warn({
        msg: "[autoRoutes] warning",
        detail: `[autoRoutes] ${mod.basePath}: buildRouter devolvió vacío`,
      });
      continue;
    }
    app.use(mod.basePath, router);
  }
}
