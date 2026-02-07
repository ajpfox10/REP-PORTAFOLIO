import type { Express } from "express";
import type { Sequelize } from "sequelize";
import type { SchemaSnapshot } from "../../db/schema/types";
import { env } from "../../config/env";
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
      // eslint-disable-next-line no-console
      console.warn("[autoRoutes] módulo sin basePath, se ignora");
      continue;
    }
    if (typeof mod.buildRouter !== "function") {
      // eslint-disable-next-line no-console
      console.warn(`[autoRoutes] ${mod.basePath}: falta buildRouter(ctx), se ignora`);
      continue;
    }

    const router = mod.buildRouter(ctx);
    if (!router) {
      // eslint-disable-next-line no-console
      console.warn(`[autoRoutes] ${mod.basePath}: buildRouter devolvió vacío`);
      continue;
    }
    app.use(mod.basePath, router);
  }
}
