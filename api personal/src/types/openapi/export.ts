// src/types/openapi/export.ts
import fs from "node:fs";
import path from "node:path";

import { createSequelize } from "../../db/sequelize";
import { schemaBootstrap } from "../../bootstrap/schemaBootstrap";
import { env } from "../../config/env";
import { logger } from "../../logging/logger";

import { buildOpenApiFromSchema } from "./build";

/**
 * Exporta OpenAPI a JSON en disco.
 * Usalo en scripts/CI o cuando quieras regenerar docs.
 */
export async function exportOpenApiJson(outFile?: string) {
  const sequelize = createSequelize();

  try {
    // Asegura snapshot/cache (según tu bootstrap)
    const snapshot = await schemaBootstrap(sequelize);

    const doc = buildOpenApiFromSchema(snapshot as any);

    const dest =
      outFile ||
      path.resolve(process.cwd(), "openapi.generated.json");

    fs.writeFileSync(dest, JSON.stringify(doc, null, 2), "utf8");
    logger.info({ msg: "OpenAPI exported", dest });
    return dest;
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

/**
 * Si lo querés usar como script directo:
 * node dist/types/openapi/export.js
 */
if (require.main === module) {
  const outArg = process.argv.find((x) => x.startsWith("--out="))?.split("=")[1];
  exportOpenApiJson(outArg).catch((err) => {
    logger.error({ msg: "OpenAPI export failed", err: String(err?.stack || err) });
    process.exitCode = 1;
  });
}
