import { Express } from "express";
import { Sequelize } from "sequelize";
import { SchemaSnapshot } from "../db/schema/types";
import { healthRouter } from "./health.routes";
import { buildCrudRouter } from "./crud.routes";
import { env } from "../config/env";
import { metricsHandler } from "../metrics/metrics";

export const mountRoutes = (app: Express, sequelize: Sequelize, schema: SchemaSnapshot) => {
  app.use(healthRouter);

  if (env.METRICS_ENABLE) {
    app.get(env.METRICS_PATH, metricsHandler);
  }

  app.use("/api/v1", buildCrudRouter(sequelize, schema));
};
