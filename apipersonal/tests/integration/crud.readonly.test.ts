import path from "path";
import fs from "fs";
import request from "supertest";

const RUN = process.env.TEST_INTEGRATION === "1";

const LOG_PATH = path.resolve(process.cwd(), ".cache", "crud.integration.debug.log");
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOG_PATH, `=== CRUD integration debug ${new Date().toISOString()} ===\n`);

function log(msg: string) {
  fs.appendFileSync(LOG_PATH, msg + "\n");
}

function dumpRes(label: string, res: any) {
  const ct = res?.headers?.["content-type"];
  let bodyStr = "";
  try {
    bodyStr = JSON.stringify(res.body).slice(0, 2000);
  } catch {
    bodyStr = String(res.body).slice(0, 2000);
  }
  const textStr = res?.text ? String(res.text).slice(0, 2000) : "";
  return `[${label}] status=${res.status} content-type=${ct}\nbody=${bodyStr}\ntext=${textStr}`;
}

function pickTables(body: any): string[] {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tables)) return data.tables;
  if (Array.isArray(body?.tables)) return body.tables;
  return [];
}

function pickRows(body: any): any[] {
  const data = body?.data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data)) return data;
  if (Array.isArray(body?.rows)) return body.rows;
  return [];
}

// Captura causas típicas de “Jest en blanco”
const origExit = process.exit.bind(process);
(process as any).exit = (code: number) => {
  const e = new Error(`process.exit(${code}) was called`);
  log(e.stack || String(e));
  throw e;
};

process.on("unhandledRejection", (reason: any) => {
  const e = new Error("unhandledRejection: " + (reason?.stack || String(reason)));
  log(e.stack || String(e));
  throw e;
});

process.on("uncaughtException", (err: any) => {
  log("uncaughtException: " + (err?.stack || String(err)));
  throw err;
});

function applyIntegrationEnv() {
  process.env.ENABLE_OPENAPI_VALIDATION = "false";
  process.env.RATE_LIMIT_ENABLE = "false";
  process.env.METRICS_ENABLE = "false";
}

(RUN ? describe : describe.skip)("integration (DB) - CRUD read-only", () => {
  jest.setTimeout(60_000);

  afterAll(() => {
    (process as any).exit = origExit;
    log("=== done ===");
  });

  it("GET /api/v1/tables, GET list y GET by id (si hay PK simple y hay filas)", async () => {
    process.env.SCHEMA_CACHE_PATH = path.resolve(
      process.cwd(),
      ".cache",
      "schema.integration.test.json"
    );

    applyIntegrationEnv();
    jest.resetModules();

    try {
      const express = require("express");
      const { createSequelize } = require("../../src/db/sequelize");
      const { schemaBootstrap } = require("../../src/bootstrap/schemaBootstrap");
      const { mountRoutes } = require("../../src/routes");

      log(`mountRoutes typeof=${typeof mountRoutes} arity=${mountRoutes?.length}`);

      const sequelize = createSequelize();
      await sequelize.authenticate();
      log("DB: authenticated");

      try {
        const schema = await schemaBootstrap(sequelize);
        log("Schema: bootstrapped");

        const app = express();
        app.use(express.json());

        // Firma real del proyecto: mountRoutes(app, sequelize, schema)
        mountRoutes(app, sequelize, schema);
        log("Routes: mounted");

        const tablesRes = await request(app).get("/api/v1/tables");
        log(dumpRes("GET /api/v1/tables", tablesRes));

        if (tablesRes.status !== 200) {
          throw new Error(`Expected 200 from /api/v1/tables. See log: ${LOG_PATH}`);
        }

        const tables = pickTables(tablesRes.body);
        log(`Tables count=${tables.length}`);

        if (!tables.length) {
          throw new Error(`No tables array detected. See log: ${LOG_PATH}`);
        }

        let chosen: { table: string; pkCol: string; pkVal: any } | null = null;

        for (const t of tables.slice(0, 80)) {
          const meta = schema?.tables?.[t];
          const pk: string[] = meta?.primaryKey || [];
          if (pk.length !== 1) continue;

          const listRes = await request(app).get(
            `/api/v1/${encodeURIComponent(t)}?page=1&limit=1`
          );
          log(dumpRes(`GET list ${t}`, listRes));
          if (listRes.status !== 200) continue;

          const rows = pickRows(listRes.body);
          if (!rows.length) continue;

          const pkCol = pk[0];
          const pkVal = rows[0]?.[pkCol];
          if (pkVal === undefined || pkVal === null) continue;

          chosen = { table: t, pkCol, pkVal };
          log(`Chosen table=${t} pkCol=${pkCol} pkVal=${String(pkVal)}`);
          break;
        }

        if (!chosen) {
          log("No table with PK simple + rows found. OK.");
          return;
        }

        const byIdRes = await request(app).get(
          `/api/v1/${encodeURIComponent(chosen.table)}/${encodeURIComponent(
            String(chosen.pkVal)
          )}`
        );
        log(dumpRes("GET by id", byIdRes));

        if (byIdRes.status !== 200) {
          throw new Error(`Expected 200 from GET by id. See log: ${LOG_PATH}`);
        }
      } finally {
        await sequelize.close();
        log("DB: closed");
      }
    } catch (err: any) {
      log("TEST ERROR: " + (err?.stack || String(err)));
      throw new Error(`CRUD integration failed. Open log: ${LOG_PATH}\n\n${err?.stack || err}`);
    }
  });

  it("GET /api/v1/__nope__ devuelve 404 (si viene JSON, ok=false)", async () => {
    process.env.SCHEMA_CACHE_PATH = path.resolve(
      process.cwd(),
      ".cache",
      "schema.integration.test.json"
    );

    applyIntegrationEnv();
    jest.resetModules();

    try {
      const express = require("express");
      const { createSequelize } = require("../../src/db/sequelize");
      const { schemaBootstrap } = require("../../src/bootstrap/schemaBootstrap");
      const { mountRoutes } = require("../../src/routes");

      const sequelize = createSequelize();
      await sequelize.authenticate();

      try {
        const schema = await schemaBootstrap(sequelize);

        const app = express();
        app.use(express.json());
        mountRoutes(app, sequelize, schema);

        const res = await request(app).get("/api/v1/__nope__");
        log(dumpRes("GET /api/v1/__nope__", res));

        if (res.status !== 404) {
          throw new Error(`Expected 404 from /api/v1/__nope__. See log: ${LOG_PATH}`);
        }

        const ct = String(res.headers?.["content-type"] || "");
        if (ct.includes("application/json")) {
          if (res.body?.ok !== false) {
            throw new Error(`Expected JSON ok=false. See log: ${LOG_PATH}`);
          }
        }
      } finally {
        await sequelize.close();
      }
    } catch (err: any) {
      log("TEST ERROR (404): " + (err?.stack || String(err)));
      throw new Error(`CRUD 404 integration failed. Open log: ${LOG_PATH}\n\n${err?.stack || err}`);
    }
  });
});
