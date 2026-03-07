// tests/integration/schemaCache.test.ts
import fs from "fs";
import path from "path";

// Cargar .env ANTES de requerir módulos que leen env (Sequelize/env config)
//require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const RUN = process.env.TEST_INTEGRATION === "1";

(RUN ? describe : describe.skip)("integration (DB) - schema cache", () => {
  jest.setTimeout(60_000);

  it("bootstrap crea/actualiza el cache de schema (SCHEMA_CACHE_PATH)", async () => {
    const cachePath = path.resolve(
      process.cwd(),
      ".cache",
      "schema.integration.test.json"
    );

    // Setear ANTES de importar schemaBootstrap/env
    process.env.SCHEMA_CACHE_PATH = cachePath;

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);

    const { createSequelize } = require("../../src/db/sequelize");
    const { schemaBootstrap } = require("../../src/bootstrap/schemaBootstrap");

    const sequelize = createSequelize();

    try {
      await sequelize.authenticate();
      await schemaBootstrap(sequelize);
    } catch (e: any) {
      throw new Error(
        `No se pudo conectar a MySQL para tests de integración.\n` +
          `Revisá DB_HOST/DB_USER/DB_PASSWORD/DB_NAME en tu .env.\n` +
          `Error: ${e?.name || "Unknown"} ${e?.message || e}`
      );
    } finally {
      await sequelize.close();
    }

    expect(fs.existsSync(cachePath)).toBe(true);

    const raw = fs.readFileSync(cachePath, "utf-8");
    const json = JSON.parse(raw);

    expect(json).toHaveProperty("tables");
    expect(typeof json.tables).toBe("object");
    expect(Object.keys(json.tables).length).toBeGreaterThan(0);
  });
});
