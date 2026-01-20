import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./logging/logger";
import { createSequelize } from "./db/sequelize";
import { schemaBootstrap } from "./bootstrap/schemaBootstrap";
import { buildModels } from "./db/dynamic/modelFactory";
import { mountRoutes } from "./routes";
import { runMigrations } from "./db/migrations/runMigrations";
import { auditAllApi } from "./middlewares/auditAllApi";

process.on("unhandledRejection", (e) => console.error("UNHANDLED_REJECTION:", e));
process.on("uncaughtException", (e) => console.error("UNCAUGHT_EXCEPTION:", e));

async function main() {
  const openapiPathArg = process.argv.find((a) => a.startsWith("--openapi="))?.split("=")[1];

  const sequelize = createSequelize();
  await sequelize.authenticate();
  logger.info({ msg: "DB connected", db: env.DB_NAME, host: env.DB_HOST });

  await runMigrations(sequelize);

  const schema = await schemaBootstrap(sequelize);
  buildModels(sequelize, schema);

  const app = createApp(openapiPathArg || undefined, (appInstance) => {
    // auditoría global (no rompe si falla)
    appInstance.use(auditAllApi(sequelize));

    // rutas
    mountRoutes(appInstance, sequelize, schema);
  });

  const port = env.PORT;

  const server = app.listen(port, () => {
    logger.info({
      msg: "API listening",
      port,
      nodeEnv: env.NODE_ENV,
      openapi: openapiPathArg || env.OPENAPI_PATH,
    });
    logger.info({
      msg: "Try",
      endpoints: ["/health", "/ready", "/api/v1/tables", "/api/v1/<table>?page=1&limit=50"],
    });
  });

  // Timeouts de server (protege de requests colgadas)
  try {
    server.setTimeout(env.REQUEST_TIMEOUT_MS);
    // @ts-ignore - propiedades de Node http.Server
    server.headersTimeout = Math.max(env.REQUEST_TIMEOUT_MS, 60000);
    // @ts-ignore
    server.requestTimeout = env.REQUEST_TIMEOUT_MS;
  } catch {
    // no romper por compat
  }
}

main().catch((err) => {
  console.error(err);
  logger.error({
    msg: "❌ Fatal bootstrap error",
    err: err instanceof Error ? err.stack : String(err),
  });
  process.exit(1);
});
