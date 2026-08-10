import path from 'path';
import { spawn } from 'child_process';
import { QueryTypes, Sequelize } from 'sequelize';
import { logger } from '../logging/logger';

const TRIGGER_NAME = 'trg_art_alta_queue_agentes_ai';
let workerStarted = false;
let workerBusy = false;

function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'on'].includes(String(raw).trim().toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function ensureArtAltaQueue(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS art_alta_queue (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      agente_id INT NOT NULL,
      dni INT NOT NULL,
      fecha_ingreso_db DATE NULL,
      estado_empleo VARCHAR(30) NULL,
      status ENUM('PENDING','PROCESSING','DONE','ERROR','SKIPPED') NOT NULL DEFAULT 'PENDING',
      attempts INT NOT NULL DEFAULT 0,
      locked_at DATETIME NULL,
      started_at DATETIME NULL,
      finished_at DATETIME NULL,
      last_error TEXT NULL,
      resultado_art TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_art_alta_queue_agente (agente_id),
      KEY idx_art_alta_queue_status (status, attempts, created_at),
      KEY idx_art_alta_queue_dni (dni)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const existing = await sequelize.query<{ TRIGGER_NAME: string }>(
    `SELECT TRIGGER_NAME
       FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME = :triggerName
      LIMIT 1`,
    { replacements: { triggerName: TRIGGER_NAME }, type: QueryTypes.SELECT }
  );

  if (existing.length > 0) return;

  await sequelize.query(`
    CREATE TRIGGER ${TRIGGER_NAME}
    AFTER INSERT ON agentes
    FOR EACH ROW
    INSERT IGNORE INTO art_alta_queue
      (agente_id, dni, fecha_ingreso_db, estado_empleo, status, created_at, updated_at)
    VALUES
      (NEW.id, NEW.dni, NEW.fecha_ingreso, NEW.estado_empleo, 'PENDING', NOW(), NOW())
  `);

  logger.info({ msg: '[artAltaQueue] trigger creado', trigger: TRIGGER_NAME });
}

async function takeNextQueueItem(sequelize: Sequelize, maxAttempts: number): Promise<number | null> {
  const rows = await sequelize.query<{ id: number }>(
    `SELECT id
       FROM art_alta_queue
      WHERE status IN ('PENDING','ERROR')
        AND attempts < :maxAttempts
        AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
      ORDER BY created_at ASC
      LIMIT 1`,
    { replacements: { maxAttempts }, type: QueryTypes.SELECT }
  );

  const id = rows[0]?.id;
  if (!id) return null;

  const [meta]: any = await sequelize.query(
    `UPDATE art_alta_queue
        SET status = 'PROCESSING',
            attempts = attempts + 1,
            locked_at = NOW(),
            started_at = COALESCE(started_at, NOW()),
            last_error = NULL
      WHERE id = :id
        AND status IN ('PENDING','ERROR')`,
    { replacements: { id } }
  );

  return meta?.affectedRows ? id : null;
}

function runScript(queueId: number): Promise<void> {
  const scriptPath = path.resolve(process.cwd(), process.env.ART_SCRIPT_PATH || 'scripts/provincia_art_alta_trabajador.mjs');
  const child = spawn(process.execPath, [scriptPath, '--queue-id', String(queueId)], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        if (stdout.trim()) logger.info({ msg: '[artAltaQueue] script OK', queueId, output: stdout.trim().slice(-1000) });
        resolve();
      } else {
        reject(new Error((stderr || stdout || `Script ART finalizo con codigo ${code}`).trim().slice(-2000)));
      }
    });
  });
}

async function processOnce(sequelize: Sequelize): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const maxAttempts = envInt('ART_QUEUE_MAX_ATTEMPTS', 3);
    const queueId = await takeNextQueueItem(sequelize, maxAttempts);
    if (!queueId) return;
    await runScript(queueId);
  } catch (err: any) {
    logger.error({ msg: '[artAltaQueue] worker error', err: err?.message || String(err) });
  } finally {
    workerBusy = false;
  }
}

export async function startArtAltaWorker(sequelize: Sequelize): Promise<void> {
  if (workerStarted) return;
  if (!envFlag('ART_ALTA_QUEUE_ENABLED', true)) {
    logger.info({ msg: '[artAltaQueue] cola deshabilitada por ART_ALTA_QUEUE_ENABLED' });
    return;
  }

  await ensureArtAltaQueue(sequelize);

  if (!envFlag('ART_AUTO_ALTA_ENABLED', false)) {
    logger.info({ msg: '[artAltaQueue] worker deshabilitado por ART_AUTO_ALTA_ENABLED' });
    return;
  }

  workerStarted = true;
  const intervalMs = envInt('ART_QUEUE_POLL_MS', 60000);
  logger.info({ msg: '[artAltaQueue] worker iniciado', intervalMs });

  setTimeout(() => processOnce(sequelize), 5000).unref();
  setInterval(() => processOnce(sequelize), intervalMs).unref();
}
