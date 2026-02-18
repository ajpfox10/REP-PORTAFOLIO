// src/server.ts
import { createApp } from "./app";
import { QueryTypes } from "sequelize";
import { env } from "./config/env";
import { assertProdEnvOrThrow } from "./config/env";
import { logger } from "./logging/logger";
import { createSequelize } from "./db/sequelize";
import { schemaBootstrap } from "./bootstrap/schemaBootstrap";
import { buildModels } from "./db/dynamic/modelFactory";
import { mountRoutes } from "./routes";
import { runMigrations } from "./db/migrations/runMigrations";
import { auditAllApi } from "./middlewares/auditAllApi";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import YAML from "yaml";
import { buildOpenApiFromSchema } from "./types/openapi/build";
import { getRedisClient, closeRedisClient } from "./infra/redis";
import { initSocketServer } from "./socket";
import { startWebhookWorker } from "./webhooks/worker";

// ─── Manejo global de errores no capturados ───────────────────────────────────
process.on("unhandledRejection", (e) => {
  logger.error({ msg: "UNHANDLED_REJECTION", err: e instanceof Error ? e.stack : String(e) });
});
process.on("uncaughtException", (e) => {
  logger.error({ msg: "UNCAUGHT_EXCEPTION", err: e instanceof Error ? e.stack : String(e) });
});

// ─── Helper: aplica timeouts al server ───────────────────────────────────────
function applyServerTimeouts(server: http.Server | https.Server) {
  try {
    server.setTimeout(env.REQUEST_TIMEOUT_MS);
    (server as any).headersTimeout = Math.max(env.SERVER_HEADERS_TIMEOUT_MS, env.REQUEST_TIMEOUT_MS + 1000);
    (server as any).requestTimeout = env.REQUEST_TIMEOUT_MS;
    (server as any).keepAliveTimeout = env.SERVER_KEEPALIVE_TIMEOUT_MS;
  } catch {
    // no romper por compat con versiones antiguas de Node
  }
}

// ─── Bootstrap principal ──────────────────────────────────────────────────────
async function main() {
  // Fail-fast en producción antes de conectar nada
  assertProdEnvOrThrow();

  const openapiPathArg = process.argv.find((a) => a.startsWith("--openapi="))?.split("=")[1];

  const parseList = (v: string) =>
    String(v || "").split(",").map((x) => x.trim()).filter(Boolean);

  // ── DB ──────────────────────────────────────────────────────────────────────
  const sequelize = createSequelize();
  await sequelize.authenticate();
  logger.info({ msg: "DB connected", db: env.DB_NAME, host: env.DB_HOST });

  // ── Redis (rate limit) ──────────────────────────────────────────────────────
  if (env.RATE_LIMIT_USE_REDIS || env.CACHE_USE_REDIS) {
    try {
      await getRedisClient();
      logger.info({ msg: "Redis connected" });
    } catch (e) {
      if (env.NODE_ENV === "production" && env.PROD_FAIL_FAST) throw e;
      logger.warn({
        msg: "Redis no disponible, se usará fallback en memoria",
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── Migraciones ─────────────────────────────────────────────────────────────
  await runMigrations(sequelize);

  // ── Schema ──────────────────────────────────────────────────────────────────
  const schema = await schemaBootstrap(sequelize);
  buildModels(sequelize, schema);

  // ── OpenAPI autogenerado ─────────────────────────────────────────────────────
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

    const allowedTables = new Set(
      Object.keys((schema as any).tables || {}).filter(isAllowed)
    );

    const viewRows = await sequelize.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = :db AND TABLE_TYPE = 'VIEW'`,
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

  // ── App Express ─────────────────────────────────────────────────────────────
  const app = createApp(openapiPathForValidator, (appInstance) => {
    appInstance.use(auditAllApi(sequelize));
    mountRoutes(appInstance, sequelize, schema);
  });

  // ── Crear servidor HTTP o HTTPS ─────────────────────────────────────────────
  let mainServer: http.Server | https.Server;
  let protocol: "http" | "https";
  let port: number;

  if (env.HTTPS_ENABLE) {
    // ── HTTPS nativo ─────────────────────────────────────────────────────────
    if (!env.HTTPS_CERT_PATH || !env.HTTPS_KEY_PATH) {
      throw new Error("HTTPS_ENABLE=true requiere HTTPS_CERT_PATH y HTTPS_KEY_PATH");
    }

    const tlsOptions: https.ServerOptions = {
      cert: fs.readFileSync(path.resolve(env.HTTPS_CERT_PATH)),
      key: fs.readFileSync(path.resolve(env.HTTPS_KEY_PATH)),
    };
    if (env.HTTPS_CA_PATH?.trim()) {
      tlsOptions.ca = fs.readFileSync(path.resolve(env.HTTPS_CA_PATH));
    }

    mainServer = https.createServer(tlsOptions, app);
    protocol = "https";
    port = env.HTTPS_PORT;

    // ── Redirect HTTP → HTTPS en puerto secundario ────────────────────────────
    if (env.HTTP_REDIRECT_PORT > 0) {
      const redirectApp = http.createServer((req, res) => {
        const host = req.headers.host?.split(":")[0] ?? "localhost";
        const httpsPort = port === 443 ? "" : `:${port}`;
        res.writeHead(301, { Location: `https://${host}${httpsPort}${req.url}` });
        res.end();
      });
      redirectApp.listen(env.HTTP_REDIRECT_PORT, () => {
        logger.info({
          msg: `HTTP→HTTPS redirect listening`,
          httpPort: env.HTTP_REDIRECT_PORT,
          redirectTo: `https://*:${port}`,
        });
      });
    }
  } else {
    // ── HTTP plano (o TLS terminado en Nginx/ALB) ────────────────────────────
    mainServer = http.createServer(app);
    protocol = "http";
    port = env.PORT;
  }

  // ── Levantar servidor principal ──────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    mainServer.listen(port, () => resolve());
  });

  logger.info({
    msg: "API listening",
    protocol,
    port,
    nodeEnv: env.NODE_ENV,
    https: env.HTTPS_ENABLE,
    openapi: openapiPathArg || env.OPENAPI_PATH,
  });

  // ── Socket.IO (pasa el mismo servidor HTTP/HTTPS) ────────────────────────────
  const io = initSocketServer(mainServer as http.Server);
  app.locals.io = io;

  // ── Timeouts ─────────────────────────────────────────────────────────────────
  applyServerTimeouts(mainServer);

  // ── Webhook worker ───────────────────────────────────────────────────────────
  startWebhookWorker(sequelize, env.NODE_ENV === "production" ? 5000 : 10000);

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.warn({ msg: "Shutdown signal received", signal });

    try {
      // Dejar de aceptar conexiones nuevas
      await new Promise<void>((resolve, reject) => {
        mainServer.close((err) => (err ? reject(err) : resolve()));
      });

      await sequelize.close().catch((e) =>
        logger.warn({ msg: "Sequelize close failed", err: String(e) })
      );

      await closeRedisClient().catch((e) =>
        logger.warn({ msg: "Redis close failed", err: String(e) })
      );

      // Liberar worker de OCR si existe
      try {
        const { terminateOcrWorker } = await import("./services/ocr.service");
        await terminateOcrWorker();
        logger.info({ msg: "OCR worker terminated" });
      } catch {
        // OCR es opcional, no fallar shutdown por esto
      }

      logger.info({ msg: "Shutdown complete", signal });
      process.exit(0);
    } catch (e) {
      logger.error({ msg: "Shutdown failed", signal, err: String(e) });
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({
    msg: "❌ Fatal bootstrap error",
    err: err instanceof Error ? err.stack : String(err),
  });
  process.exit(1);
});
