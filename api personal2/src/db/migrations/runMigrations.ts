import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Sequelize, QueryTypes } from "sequelize";
import { env } from "../../config/env";
import { logger } from "../../logging/logger";

type MigrationRow = {
  id: number;
  filename: string;
  checksum: string;
  applied_at: string;
};

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function listSqlFiles(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));
}

export async function runMigrations(sequelize: Sequelize) {
  if (!env.MIGRATIONS_ENABLE) {
    logger.info({ msg: "Migrations disabled (MIGRATIONS_ENABLE=false)" });
    return { applied: 0, skipped: 0 };
  }

  const dir = path.resolve(process.cwd(), env.MIGRATIONS_DIR);
  const files = listSqlFiles(dir);

  logger.info({ msg: "Migrations scan", dir, count: files.length });

  await sequelize.query(
    `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_filename (filename)
    ) ENGINE=InnoDB;
    `
  );

  const applied = await sequelize.query<MigrationRow>(
    `SELECT id, filename, checksum, applied_at FROM schema_migrations ORDER BY id ASC`,
    { type: QueryTypes.SELECT }
  );

  const appliedByName = new Map(applied.map((r) => [r.filename, r]));

  let appliedCount = 0;
  let skippedCount = 0;

  for (const filename of files) {
    const full = path.join(dir, filename);
    const sql = fs.readFileSync(full, "utf-8");
    const checksum = sha256(sql);

    const already = appliedByName.get(filename);

    if (already) {
      // Si cambiaste un SQL ya aplicado: cortamos. Esto te evita “cambios fantasmas”.
      if (already.checksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch: ${filename}. ` +
            `Applied=${already.checksum} Current=${checksum}. ` +
            `No se puede continuar: creá una migración nueva en vez de editar una aplicada.`
        );
      }
      skippedCount++;
      continue;
    }

    logger.info({ msg: "Applying migration", filename });

    // Ejecuta el SQL tal cual
    await sequelize.query(sql);

    await sequelize.query(
      `INSERT INTO schema_migrations (filename, checksum) VALUES (:filename, :checksum)`,
      { replacements: { filename, checksum } }
    );

    appliedCount++;
  }

  logger.info({ msg: "Migrations done", applied: appliedCount, skipped: skippedCount });
  return { applied: appliedCount, skipped: skippedCount };
}
