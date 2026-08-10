import { Router } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { requireAny } from '../middlewares/rbacCrud';

export interface DashboardAlertBehavior {
  enabled: boolean;
  delayMs: number;
  durationMs: number;
  refreshMs: number;
}

const ALERT_KEYS = [
  'embarazadas',
  'guarderia',
  'fichero',
  'examenIngreso',
  'accidentesPunzo',
  'jefaturas',
  'concursos',
  'alertasAgente',
  'cumpleanos',
] as const;

type DashboardAlertKey = typeof ALERT_KEYS[number];
type PartialBehavior = Partial<DashboardAlertBehavior>;
type DashboardAlertsMap = Record<DashboardAlertKey, DashboardAlertBehavior>;
const initializedDatabases = new WeakSet<Sequelize>();

async function ensureRuntimeConfigTable(sequelize: Sequelize) {
  if (initializedDatabases.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_runtime_config (
      config_key VARCHAR(100) NOT NULL,
      config_json JSON NOT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (config_key),
      KEY idx_app_runtime_config_updated_by (updated_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  initializedDatabases.add(sequelize);
}

function safeMilliseconds(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(Math.trunc(parsed), 86_400_000));
}

function safeRefreshMilliseconds(value: unknown, fallback: number): number {
  const parsed = safeMilliseconds(value, fallback);
  return parsed === 0 ? 0 : Math.max(parsed, 5_000);
}

function mergeBehavior(base: DashboardAlertBehavior, input: unknown): DashboardAlertBehavior {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const value = input as PartialBehavior;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : base.enabled,
    delayMs: safeMilliseconds(value.delayMs, base.delayMs),
    durationMs: safeMilliseconds(value.durationMs, base.durationMs),
    refreshMs: safeRefreshMilliseconds(value.refreshMs, base.refreshMs),
  };
}

function getEnvConfig() {
  const defaults: DashboardAlertBehavior = {
    enabled: env.DASHBOARD_ALERTS_ENABLED,
    delayMs: safeMilliseconds(env.DASHBOARD_ALERTS_DELAY_MS, 0),
    durationMs: safeMilliseconds(env.DASHBOARD_ALERTS_DURATION_MS, 0),
    refreshMs: safeRefreshMilliseconds(env.DASHBOARD_ALERTS_REFRESH_MS, 0),
  };

  let overrides: Record<string, unknown> = {};
  if (env.DASHBOARD_ALERTS_CONFIG_JSON) {
    try {
      const parsed = JSON.parse(env.DASHBOARD_ALERTS_CONFIG_JSON);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) overrides = parsed;
    } catch (err) {
      logger.warn({ msg: 'DASHBOARD_ALERTS_CONFIG_JSON invalido; se usan defaults', err });
    }
  }

  const alerts = Object.fromEntries(
    ALERT_KEYS.map((key) => [key, mergeBehavior(defaults, overrides[key])]),
  ) as DashboardAlertsMap;

  return { defaults, alerts };
}

function normalizeAlerts(input: unknown, fallback: DashboardAlertsMap): DashboardAlertsMap {
  const value = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return Object.fromEntries(
    ALERT_KEYS.map((key) => [key, mergeBehavior(fallback[key], value[key])]),
  ) as DashboardAlertsMap;
}

export async function getDashboardAlertsConfig(sequelize: Sequelize) {
  const envConfig = getEnvConfig();
  try {
    await ensureRuntimeConfigTable(sequelize);
    const rows = await sequelize.query<{ config_json: string | object; updated_at: string; updated_by: number | null }>(
      `SELECT config_json, updated_at, updated_by
       FROM app_runtime_config
       WHERE config_key = 'dashboard_alerts'
       LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!rows.length) return { ...envConfig, source: 'env' as const, dbAvailable: true };

    const raw = typeof rows[0].config_json === 'string'
      ? JSON.parse(rows[0].config_json)
      : rows[0].config_json;
    return {
      defaults: envConfig.defaults,
      alerts: normalizeAlerts(raw, envConfig.alerts),
      source: 'database' as const,
      dbAvailable: true,
      updatedAt: rows[0].updated_at,
      updatedBy: rows[0].updated_by,
    };
  } catch (err: any) {
    logger.warn({ msg: 'No se pudo leer app_runtime_config; se usa env', error: err?.message });
    return { ...envConfig, source: 'env' as const, dbAvailable: false };
  }
}

export function buildDashboardAlertsRouter(sequelize: Sequelize) {
  const router = Router();
  const adminWrite = requireAny(['admin:write', 'usuarios:write', 'crud:*:*']);

  router.get('/config', async (_req, res) => {
    res.json({ ok: true, data: await getDashboardAlertsConfig(sequelize) });
  });

  router.put('/config', adminWrite, async (req, res) => {
    const envConfig = getEnvConfig();
    const alerts = normalizeAlerts(req.body?.alerts, envConfig.alerts);
    const updatedBy = req.auth?.principalType === 'user' ? req.auth.principalId : null;
    try {
      await ensureRuntimeConfigTable(sequelize);
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES ('dashboard_alerts', :configJson, :updatedBy, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { configJson: JSON.stringify(alerts), updatedBy } },
      );
      (res.locals as any).audit = {
        action: 'dashboard_alerts_config_update',
        table_name: 'app_runtime_config',
        record_pk: 'dashboard_alerts',
        request_json: { alerts },
      };
      res.json({ ok: true, data: await getDashboardAlertsConfig(sequelize) });
    } catch (err: any) {
      logger.error({ msg: 'Error guardando configuracion de banners', err });
      res.status(500).json({ ok: false, error: 'No se pudo guardar. Verifique la migracion 028__app_runtime_config.sql.' });
    }
  });

  router.delete('/config', adminWrite, async (_req, res) => {
    try {
      await ensureRuntimeConfigTable(sequelize);
      await sequelize.query(`DELETE FROM app_runtime_config WHERE config_key = 'dashboard_alerts'`);
      (res.locals as any).audit = {
        action: 'dashboard_alerts_config_reset',
        table_name: 'app_runtime_config',
        record_pk: 'dashboard_alerts',
      };
      res.json({ ok: true, data: await getDashboardAlertsConfig(sequelize) });
    } catch (err: any) {
      logger.error({ msg: 'Error restaurando configuracion de banners', err });
      res.status(500).json({ ok: false, error: 'No se pudo restaurar la configuracion.' });
    }
  });

  return router;
}
