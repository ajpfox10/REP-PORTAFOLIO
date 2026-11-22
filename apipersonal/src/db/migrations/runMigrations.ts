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
  // Nunca corta el arranque de la API: los problemas se avisan en el banner rojo del dashboard
  // (script_runs 'migraciones', mismo circuito que los robots fallidos).
  const problemas: string[] = [];

  for (const filename of files) {
    const full = path.join(dir, filename);
    const sql = fs.readFileSync(full, "utf-8");
    const checksum = sha256(sql);

    const already = appliedByName.get(filename);

    if (already) {
      // Archivo ya aplicado que alguien editó: no se re-aplica; se avisa para que se haga una migración nueva.
      if (already.checksum !== checksum) {
        logger.error({ msg: "Migration checksum mismatch (se saltea)", filename });
        problemas.push(`${filename}: se modificó después de aplicada (no se vuelve a correr; hacé una migración nueva y no edites las aplicadas).`);
      }
      skippedCount++;
      continue;
    }

    logger.info({ msg: "Applying migration", filename });

    try {
      // Ejecuta el SQL tal cual
      await sequelize.query(sql);
      await sequelize.query(
        `INSERT INTO schema_migrations (filename, checksum) VALUES (:filename, :checksum)`,
        { replacements: { filename, checksum } }
      );
      appliedCount++;
    } catch (err: any) {
      // Se corta acá: las siguientes pueden depender de esta. La API arranca igual.
      const detalle = String(err?.original?.sqlMessage || err?.message || err).slice(0, 400);
      logger.error({ msg: "Migration FAILED (la API sigue arrancando)", filename, error: detalle });
      const pendientes = files.filter((f) => f > filename && !appliedByName.has(f)).length;
      problemas.push(`${filename} falló: ${detalle}` + (pendientes ? ` · ${pendientes} posterior(es) sin aplicar` : ""));
      break;
    }
  }

  await avisarResultado(sequelize, problemas, appliedCount);

  logger.info({ msg: "Migrations done", applied: appliedCount, skipped: skippedCount });
  return { applied: appliedCount, skipped: skippedCount, problemas };
}

const SCRIPT_AVISO = "migraciones";

/**
 * Deja el resultado en script_runs para el banner de robots fallidos del dashboard.
 * Error → fila 'error' con el detalle. Todo bien → fila 'ok' solo si la última fue error
 * (para que el banner se vaya sin llenar el historial en cada arranque) o si aplicó algo.
 */
async function avisarResultado(sequelize: Sequelize, problemas: string[], aplicadas: number) {
  try {
    await sequelize.query(
      `INSERT IGNORE INTO robots_config (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias, lo_leen, notas, activo)
       VALUES (:s, 'Migraciones de la base (al arrancar la API)', 'Sistema', 999, NULL, 1, 0, '',
               'Banner de robots fallidos (dashboard)',
               'No es un robot: la API corre scripts/migrations al arrancar (MIGRATIONS_ENABLE). Si una falla la API arranca igual y queda acá el error; se arregla con una migración nueva y reiniciando la API.', 1)`,
      { replacements: { s: SCRIPT_AVISO } }
    );
    const [ultima] = await sequelize.query<{ estado: string }>(
      `SELECT estado FROM script_runs WHERE script = :s ORDER BY id DESC LIMIT 1`,
      { replacements: { s: SCRIPT_AVISO }, type: QueryTypes.SELECT }
    );
    let estado: string | null = null;
    let motivo = "";
    if (problemas.length) {
      estado = "error";
      motivo = problemas.join(" | ").slice(0, 1000);
    } else if (aplicadas > 0 || ultima?.estado === "error") {
      estado = "ok";
      motivo = aplicadas > 0 ? `${aplicadas} migración(es) aplicada(s)` : "Sin problemas";
    }
    if (!estado) return;
    await sequelize.query(
      `INSERT INTO script_runs (script, descripcion, estado, motivo, filas, duracion_seg)
       VALUES (:s, 'Migraciones de la base (al arrancar la API)', :estado, :motivo, :filas, 0)`,
      { replacements: { s: SCRIPT_AVISO, estado, motivo, filas: aplicadas } }
    );
  } catch (err: any) {
    logger.error({ msg: "No se pudo registrar el aviso de migraciones", error: err?.message });
  }
}
