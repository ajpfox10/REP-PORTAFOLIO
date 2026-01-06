import fs from "fs";
import path from "path";
import YAML from "yaml";
import { createSequelize } from "../db/sequelize";
import { schemaBootstrap } from "../bootstrap/schemaBootstrap";
import { buildOpenApi } from "./build";
import { env } from "../config/env";
import { logger } from "../logging/logger";

const writeFile = (p: string, content: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
};

(async () => {
  const sequelize = createSequelize();
  await sequelize.authenticate();

  const schema = await schemaBootstrap(sequelize);
  const doc = buildOpenApi(schema);

  const outPath = path.resolve(process.cwd(), env.OPENAPI_PATH);
  writeFile(outPath, YAML.stringify(doc));
  logger.info({ msg: "OpenAPI exported", outPath });

  await sequelize.close();
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("❌ openapi:export failed:", err);
  process.exit(1);
});
