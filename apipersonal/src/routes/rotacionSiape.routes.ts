// src/routes/rotacionSiape.routes.ts
// Rotaciones de residentes → SiAPe como FRANCO COMPENSATORIO (COMUNICACIONES), un día por fila.
//   GET  /api/v1/rotacion-siape/control     → resumen por rotación + días (tabla rotacion_carga_siape)
//   POST /api/v1/rotacion-siape/generar     → regenera la cola (después de alta/edición/borrado)
//   POST /api/v1/rotacion-siape/lanzar      → corre el robot (página Robots: siape_carga_rotaciones)
//   POST /api/v1/rotacion-siape/reintentar  → { ids? } vuelve a PENDIENTE los días con error y lanza
//
// El robot y el armado de la cola viven en scripts/cargar_rotaciones_siape.py (una sola regla de
// qué días se cargan: los del campo "Días" de la rotación o, si no tiene, los de HORARIOS.xlsx).

import { Router, Request, Response, NextFunction } from 'express';
import { execFile } from 'child_process';
import { Sequelize, QueryTypes } from 'sequelize';
import { can } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { ejecutarAhora, resolverScriptsDir } from '../services/robotsTareasWindows';

const SCRIPT = 'siape_carga_rotaciones';
const TABLA = 'rotacion_carga_siape';
const TABLA_GEN = 'rotacion_siape_generacion';

const permiso = (action: 'read' | 'create') => (req: Request, res: Response, next: NextFunction) => {
  if (!env.RBAC_ENABLE || !env.AUTH_ENABLE) return next();
  const auth = (req as any).auth;
  if (!auth) return res.status(401).json({ ok: false, error: 'No autenticado' });
  if (!can(auth.permissions || [], 'residentes_rotacion', action)) return res.status(403).json({ ok: false, error: 'No autorizado' });
  return next();
};

function correrGenerar(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('python', ['cargar_rotaciones_siape.py', '--solo-generar'],
      { cwd: resolverScriptsDir(), timeout: 2 * 60 * 1000, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, out, stderr) => err ? reject(new Error(String(stderr || err.message).slice(-500))) : resolve(String(out).trim()));
  });
}

async function ensureRobot(sequelize: Sequelize) {
  await sequelize.query(
    `INSERT IGNORE INTO robots_config (script, descripcion, grupo, orden, comando, reporta_solo, notas)
     VALUES (:s, 'Carga de rotaciones de residentes (FC) en SIAPE', 'SIAPE', 24,
             'python cargar_rotaciones_siape.py', 0,
             'Carga como FRANCO COMPENSATORIO (COMUNICACIONES) los días de rotación vencidos (tabla rotacion_carga_siape). Robot JAB; necesita la sesión de Windows abierta.')`,
    { replacements: { s: SCRIPT } });
}

async function tablasExisten(sequelize: Sequelize): Promise<boolean> {
  const r = await sequelize.query<any>(
    `SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (:t)`,
    { type: QueryTypes.SELECT, replacements: { t: [TABLA, TABLA_GEN] } });
  return Number(r[0]?.n) === 2;
}

export function buildRotacionSiapeRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/control', permiso('read'), async (_req: Request, res: Response) => {
    try {
      if (!(await tablasExisten(sequelize))) await correrGenerar();
      const porRotacion = await sequelize.query<any>(
        `SELECT g.rotacion_id, g.origen_dias, g.dias_semana, g.aviso,
                COUNT(c.id) AS total,
                COALESCE(SUM(c.fecha <= CURDATE()), 0) AS vencidos,
                COALESCE(SUM(c.estado = 'OK'), 0) AS ok,
                COALESCE(SUM(c.estado = 'YA_EXISTIA'), 0) AS ya_existia,
                COALESCE(SUM(c.estado = 'ERROR'), 0) AS error,
                COALESCE(SUM(c.estado = 'SOBRA'), 0) AS sobra,
                COALESCE(SUM(c.estado = 'PENDIENTE' AND c.fecha <= CURDATE()), 0) AS pendiente,
                COALESCE(SUM(c.estado = 'PENDIENTE' AND c.fecha > CURDATE()), 0) AS futuro
           FROM ${TABLA_GEN} g
           LEFT JOIN ${TABLA} c ON c.rotacion_id = g.rotacion_id
          GROUP BY g.rotacion_id, g.origen_dias, g.dias_semana, g.aviso`,
        { type: QueryTypes.SELECT });
      // días SOBRA de rotaciones eliminadas (ya no tienen fila de generación)
      const huerfanos = await sequelize.query<any>(
        `SELECT c.rotacion_id, COUNT(*) AS sobra FROM ${TABLA} c
           LEFT JOIN ${TABLA_GEN} g ON g.rotacion_id = c.rotacion_id
          WHERE g.rotacion_id IS NULL AND c.estado = 'SOBRA' GROUP BY c.rotacion_id`,
        { type: QueryTypes.SELECT });
      const dias = await sequelize.query<any>(
        `SELECT id, rotacion_id, dni, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, estado, detalle, intentos,
                cargado_en, fecha > CURDATE() AS futuro
           FROM ${TABLA} ORDER BY dni, fecha`,
        { type: QueryTypes.SELECT });
      const [ultima] = await sequelize.query<any>(
        `SELECT estado, motivo, actualizado_at FROM script_runs WHERE script = :s ORDER BY id DESC LIMIT 1`,
        { type: QueryTypes.SELECT, replacements: { s: SCRIPT } }).catch(() => [] as any[]);
      return res.json({ ok: true, porRotacion, huerfanos, dias, ultimaCorrida: ultima || null });
    } catch (err: any) {
      logger.error({ msg: '[rotacion-siape] control', err: err?.message });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/generar', permiso('create'), async (_req: Request, res: Response) => {
    try {
      const msg = await correrGenerar();
      return res.json({ ok: true, msg });
    } catch (err: any) {
      logger.error({ msg: '[rotacion-siape] generar', err: err?.message });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/lanzar', permiso('create'), async (_req: Request, res: Response) => {
    try {
      await ensureRobot(sequelize);
      await correrGenerar();
      const como = await ejecutarAhora(SCRIPT);
      return res.json({ ok: true, como, msg: 'Robot lanzado: carga en SIAPE los días de rotación vencidos (queda en la página Robots)' });
    } catch (err: any) {
      logger.error({ msg: '[rotacion-siape] lanzar', err: err?.message });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/reintentar', permiso('create'), async (req: Request, res: Response) => {
    try {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0);
      const [, meta]: any = await sequelize.query(
        `UPDATE ${TABLA} SET estado = 'PENDIENTE', intentos = 0
          WHERE estado = 'ERROR' ${ids.length ? 'AND id IN (:ids)' : ''}`,
        { replacements: { ids } });
      const n = Number(meta?.affectedRows ?? meta ?? 0);
      if (!n) return res.json({ ok: true, msg: 'No hay días con error para reintentar' });
      await ensureRobot(sequelize);
      await ejecutarAhora(SCRIPT);
      return res.json({ ok: true, filas: n, msg: `${n} día(s) vuelven a PENDIENTE · robot lanzado` });
    } catch (err: any) {
      logger.error({ msg: '[rotacion-siape] reintentar', err: err?.message });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  return router;
}
