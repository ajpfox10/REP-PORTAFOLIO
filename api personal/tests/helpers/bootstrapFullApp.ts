import { createSequelize } from "../../src/db/sequelize";
import { schemaBootstrap } from "../../src/bootstrap/schemaBootstrap";
import { buildModelsFromSchema } from "../../src/db/dynamic/modelFactory";
import { createApp } from "../../src/app";
import { mountRoutes } from "../../src/routes";

import type { Sequelize } from "sequelize";
import type { Express } from "express";
import type { SchemaSnapshot } from "../../src/db/schema/types";

export async function bootstrapFullApp(openapiPath?: string): Promise<{
  app: Express;
  sequelize: Sequelize;
  schema: SchemaSnapshot;
  models: Record<string, any>;
}> {
  const sequelize = createSequelize();

  await sequelize.authenticate();

  const schema = await schemaBootstrap(sequelize);

  const models = buildModelsFromSchema(sequelize, schema);

  const app = createApp(openapiPath);

  mountRoutes(app, {
    sequelize,
    schema,
    models,
  });

  return { app, sequelize, schema, models };
}
