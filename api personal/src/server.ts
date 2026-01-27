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

process.on("unhandledRejection", (e) => console.error("UNHANDLED_REJECTION:", e));
process.on("uncaughtException", (e) => console.error("UNCAUGHT_EXCEPTION:", e));

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

  await runMigrations(sequelize);

  const schema = await schemaBootstrap(sequelize);
  buildModels(sequelize, schema);

  // ✅ OpenAPI auto generado desde DB (schema ya introspectado)
  let openapiPathForValidator = openapiPathArg || env.OPENAPI_PATH;

  if (env.ENABLE_OPENAPI_VALIDATION && env.OPENAPI_AUTO_GENERATE) {
// allow/deny/strict igual que en crud.routes.ts
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

// detectar vistas desde INFORMATION_SCHEMA.TABLES
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
