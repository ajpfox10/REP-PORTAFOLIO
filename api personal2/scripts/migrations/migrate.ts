import { createSequelize } from "../../src/db/sequelize";
import { runMigrations } from "../../src/db/migrations/runMigrations";
import { logger } from "../../src/logging/logger";

async function main() {
  const sequelize = createSequelize();

  await sequelize.authenticate();

  const result = await runMigrations(sequelize);

  logger.info({
    msg: "Migrations finished",
    applied: result.applied,
    skipped: result.skipped
  });

  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
