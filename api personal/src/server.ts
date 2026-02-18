// src/server.ts
import { createApp } from "./app";
import { QueryTypes } from "sequelize";
import { env } from "./config/env";
import { logger } from "./logging/logger";
import { createSequelize } from "./db/sequelize";
import { schemaBootstrap } from "./bootstrap/schemaBootstrap";
import { buildModels } from "./db/dynamic/modelFactory";
import { mountRoutes } from "./routes";
import { runMigrations } from "./db/migrations/runMigrations";
import { auditAllApi } from "./middlewares/auditAllApi";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { buildOpenApiFromSchema } from "./types/openapi/build";
import { getRedisClient, closeRedisClient } from "./infra/redis";
import { initSocketServer } from './socket';
import { startWebhookWorker } from './webhooks/worker';

// ✅ Hard-fail logging: no usamos console.* para que quede en el logger central
process.on("unhandledRejection", (e) => {
  logger.error({ msg: "UNHANDLED_REJECTION", err: e instanceof Error ? e.stack : String(e) });
});
process.on("uncaughtException", (e) => {
  logger.error({ msg: "UNCAUGHT_EXCEPTION", err: e instanceof Error ? e.stack : String(e) });
});

async function main() {
  const openapiPathArg = process.argv.find((a) => a.startsWith("--openapi="))?.split("=")[1];

  const parseList = (v: string) =>
    String(v || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  const sequelize = createSequelize();
  await sequelize.authenticate();
  logger.info({ msg: "DB connected", db: env.DB_NAME, host: env.DB_HOST });

  // ✅ Preflight Redis si se usa rate limit distribuido
  if (env.RATE_LIMIT_USE_REDIS) {
    try {
      await getRedisClient();
    } catch (e) {
      if (env.NODE_ENV === "production" && env.PROD_FAIL_FAST) throw e;
      logger.warn({ msg: "Redis no disponible, se usará rate limit en memoria", err: e instanceof Error ? e.message : String(e) });
    }
  }

  await runMigrations(sequelize);

  const schema = await schemaBootstrap(sequelize);
  buildModels(sequelize, schema);

  let openapiPathForValidator = openapiPathArg || env.OPENAPI_PATH;

  if (env.ENABLE_OPENAPI_VALIDATION && env.OPENAPI_AUTO_GENERATE) {
    const allow = new Set(parseList(env.CRUD_TABLE_ALLOWLIST));
    const deny = new Set(parseList(env.CRUD_TABLE_DENYLIST));
    const strict = env.CRUD_STRICT_ALLOWLIST;

    const isAllowed = (table: string) => {
      if (deny.has(table)) return false;
      if (allow.size) return allow.has(table);
      if (strict) return false;
      return true;
    };

    const allowedTables = new Set(Object.keys((schema as any).tables || {}).filter(isAllowed));

    const viewRows = await sequelize.query<{ TABLE_NAME: string }>(
      `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = :db
        AND TABLE_TYPE = 'VIEW'
      `,
      { type: QueryTypes.SELECT, replacements: { db: env.DB_NAME } }
    );

    const views = new Set((viewRows || []).map((r: any) => String(r.TABLE_NAME)));

    const doc = buildOpenApiFromSchema(schema as any, {
      allowedTables,
      views,
      readonly: env.CRUD_READONLY,
    });

    const outAbs = path.resolve(process.cwd(), env.OPENAPI_AUTO_OUTPUT);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, YAML.stringify(doc), "utf8");
    openapiPathForValidator = outAbs;

    logger.info({ msg: "OpenAPI auto-generated", outAbs });
  }

  const app = createApp(openapiPathForValidator, (appInstance) => {
    appInstance.use(auditAllApi(sequelize));
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

  const io = initSocketServer(server);
  app.locals.io = io;

  // ✅ Graceful shutdown - VERSIÓN COMPLETA CON OCR
  const shutdown = async (signal: string) => {
    try {
      logger.warn({ msg: "Shutdown signal received", signal });

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      try {
        await sequelize.close();
      } catch (e) {
        logger.warn({ msg: "Sequelize close failed", err: e instanceof Error ? e.stack : String(e) });
      }

      try {
        await closeRedisClient();
      } catch (e) {
        logger.warn({ msg: "Redis close failed", err: e instanceof Error ? e.message : String(e) });
      }

      // ✅ Liberar recursos de OCR
      try {
        const { terminateOcrWorker } = await import('./services/ocr.service');
        await terminateOcrWorker();
        logger.info({ msg: "OCR worker terminated" });
      } catch (e) {
        logger.warn({ msg: "OCR worker termination failed", err: e instanceof Error ? e.message : String(e) });
      }

      logger.info({ msg: "Shutdown complete", signal });
      process.exit(0);
    } catch (e) {
      logger.error({ msg: "Shutdown failed", signal, err: e instanceof Error ? e.stack : String(e) });
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  // ✅ Iniciar worker de webhooks
  if (env.NODE_ENV === 'production') {
    startWebhookWorker(sequelize, 5000);
  } else {
    startWebhookWorker(sequelize, 10000);
  }

  try {
    server.setTimeout(env.REQUEST_TIMEOUT_MS);
    (server as any).headersTimeout = Math.max(env.REQUEST_TIMEOUT_MS, 60000);
    (server as any).requestTimeout = env.REQUEST_TIMEOUT_MS;
  } catch {
    // no romper por compat
  }
}

main().catch((err) => {
  logger.error({
    msg: "❌ Fatal bootstrap error",
    err: err instanceof Error ? err.stack : String(err),
  });
  process.exit(1);
});