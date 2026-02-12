import { createSequelize } from "../../src/db/sequelize";
import { schemaBootstrap } from "../../src/bootstrap/schemaBootstrap";
import { buildModels } from "../../src/db/dynamic/modelFactory";
import { createApp } from "../../src/app";
import { mountRoutes } from "../../src/routes";
import { runMigrations } from "../../src/db/migrations/runMigrations";

import type { Sequelize } from "sequelize";
import type { Express } from "express";
import type { SchemaSnapshot } from "../../src/db/schema/types";
import type { Model } from "sequelize";

export async function bootstrapFullApp(openapiPath?: string): Promise<{
  app: Express;
  sequelize: Sequelize;
  schema: SchemaSnapshot;
  models: Record<string, typeof Model>;
}> {
  const sequelize = createSequelize();
  await sequelize.authenticate();

  // ✅ Migraciones antes de introspectar (tests coherentes con DB)
  await runMigrations(sequelize);

  const schema = await schemaBootstrap(sequelize);

  // registra sequelize.models
  const models = buildModels(sequelize, schema);

  const app = createApp(openapiPath);

  // mountRoutes usa sequelize.models
  mountRoutes(app, sequelize, schema);

  return { app, sequelize, schema, models };
}
