import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./logging/logger";
import { createSequelize } from "./db/sequelize";
import { schemaBootstrap } from "./bootstrap/schemaBootstrap";
import { buildModels } from "./db/dynamic/modelFactory";
import { mountRoutes } from "./routes";

const getArg = (name: string): string | null => {
  const p = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!p) return null;
  return p.split("=").slice(1).join("=") || null;
};

async function main() {
  const openapiPathArg = getArg("openapi");

  const sequelize = createSequelize();
  await sequelize.authenticate();
  logger.info({ msg: "DB connected", db: env.DB_NAME, host: env.DB_HOST });

  const schema = await schemaBootstrap(sequelize);
  buildModels(sequelize, schema);

  const app = createApp(openapiPathArg || undefined);
  mountRoutes(app, sequelize, schema);

  const port = env.PORT;
  app.listen(port, () => {
    logger.info({ msg: "API listening", port, nodeEnv: env.NODE_ENV, openapi: openapiPathArg || env.OPENAPI_PATH });
    logger.info({ msg: "Try", endpoints: ["/health", "/ready", "/api/v1/tables", "/api/v1/<table>?page=1&limit=50"] });
  });
}

main().catch((err) => {
  logger.error({ msg: "❌ Fatal bootstrap error", err });
  process.exit(1);
});
