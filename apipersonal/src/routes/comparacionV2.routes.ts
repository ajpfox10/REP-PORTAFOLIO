// src/routes/comparacionV2.routes.ts
// Comparador SIAPE vs Ministerio 2.0: la pantalla lee las TABLAS (no recalcula contra los Excel)
// y los botones lanzan los robots 2.0 por run_robot.py (quedan en la página Robots y respetan turnos).
//
// GET  /comparacion-v2/ultima              → última corrida (comparacion_corridas) + sus filas
//                                            (comparacion_novedades) con la forma del comparador viejo,
//                                            + estado de carga de cada fila (novedades_carga_intranet).
// POST /comparacion-v2/comparar            → corre el Comparador 2.0 (espera a que termine).
// GET  /comparacion-v2/resultado?dep=[&todas=1] → resultado de la carga en la Intranet (novedades_carga_intranet),
//                                            novedades + ausentes de esa dependencia; por defecto solo la
//                                            última corrida (todas=1 suma las filas de corridas anteriores).
// POST /comparacion-v2/lanzar              → { tipo: novedades|ausentes|art26, dependencia } corre ese robot.
// POST /comparacion-v2/reintentar          → { dependencia, ids } vuelve a PENDIENTE esas filas con error
//                                            y lanza los robots que correspondan (reemplaza "segunda pasada").
//
// Reemplaza a GET /comparacion-siape y a /intranet/{resultado,cargar-novedades,cargar-ausentes,
// segunda-pasada,exportar-pendientes} (versión vieja, Excel), que quedan SIN USO.

import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { ejecutarAhora, resolverScriptsDir } from '../services/robotsTareasWindows';
import { logger } from '../logging/logger';

const PERM = 'crud:*:*';
const DEPENDENCIAS = ['HOSPITAL', 'UPA 4', 'UPA 18'] as const;
const SUFIJO: Record<string, string> = { 'HOSPITAL': 'hospital', 'UPA 4': 'upa4', 'UPA 18': 'upa18' };
const AUSENTE = 'AUSENTE SIN AVISO';
const ROBOT_COMPARAR = 'comparacion_siape_ministerio_v2';

function normalizarDependencia(raw: any): string | null {
  const d = String(raw ?? '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/^UPA(\d)/, 'UPA $1');
  return (DEPENDENCIAS as readonly string[]).includes(d) ? d : null;
}

function robotDe(tipo: string, dep: string): string | null {
  if (!['novedades', 'ausentes', 'art26'].includes(tipo)) return null;
  return `intranet_carga_${tipo}_v2_${SUFIJO[dep]}`;
}

function correrComparacion(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('python', ['run_robot.py', ROBOT_COMPARAR],
      { cwd: resolverScriptsDir(), timeout: 10 * 60 * 1000, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, _out, stderr) => err ? reject(new Error(String(stderr || err.message).slice(-500))) : resolve());
  });
}

export function buildComparacionV2Router(sequelize: Sequelize) {
  const router = Router();

  router.get('/ultima', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      const [corrida] = await sequelize.query<any>(
        `SELECT * FROM comparacion_corridas ORDER BY id DESC LIMIT 1`, { type: QueryTypes.SELECT });
      if (!corrida) return res.json({ ok: true, corrida: null, resultado: [] });
      // la tabla de carga puede no existir todavía (nunca corrió un robot de carga 2.0)
      const [tablaCarga] = await sequelize.query<any>(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'novedades_carga_intranet'`,
        { type: QueryTypes.SELECT });
      const conCarga = Number(tablaCarga?.n) > 0;
      const filas = await sequelize.query<any>(`
        SELECT c.estado, c.motivo, c.dependencia, c.ley, c.legajo, c.dni, c.nombre,
               c.novedad_ministerio,
               COALESCE(DATE_FORMAT(c.desde_ministerio, '%Y-%m-%d'), '') AS fecha_desde_min,
               COALESCE(DATE_FORMAT(c.hasta_ministerio, '%Y-%m-%d'), '') AS fecha_hasta_min,
               c.novedad_siap,
               COALESCE(DATE_FORMAT(c.desde_siap, '%Y-%m-%d'), '') AS fecha_desde_siap,
               COALESCE(DATE_FORMAT(c.hasta_siap, '%Y-%m-%d'), '') AS fecha_hasta_siap,
               c.justificado_siap,
               ${conCarga ? 'n.estado' : 'NULL'} AS carga_estado,
               ${conCarga ? 'n.detalle' : 'NULL'} AS carga_detalle
          FROM comparacion_novedades c
          ${conCarga ? `LEFT JOIN novedades_carga_intranet n
                 ON c.estado = 'SOLO_SIAP' AND n.dni = c.dni AND n.novedad_siap = c.novedad_siap
                AND n.desde = c.desde_siap AND n.hasta = COALESCE(c.hasta_siap, c.desde_siap)` : ''}
         WHERE c.corrida_id = ?
         ORDER BY c.dependencia, c.nombre, c.desde_siap, c.desde_ministerio`,
        { type: QueryTypes.SELECT, replacements: [corrida.id] });
      return res.json({
        ok: true,
        corrida: {
          id: corrida.id,
          creado_en: corrida.creado_en,
          archivo_ministerio: corrida.archivo_ministerio,
          archivo_siape: corrida.archivo_siape,
          ministerio_modificado: corrida.ministerio_modificado,
          siape_modificado: corrida.siape_modificado,
        },
        resultado: filas,
      });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/ultima', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/comparar', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      await correrComparacion();
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/comparar', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.get('/resultado', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const dep = normalizarDependencia(req.query.dep ?? 'HOSPITAL');
      if (!dep) return res.status(400).json({ ok: false, error: 'Dependencia inválida' });
      const todas = String(req.query.todas ?? '') === '1';
      const [ultima] = await sequelize.query<any>(
        `SELECT MAX(id) AS id FROM comparacion_corridas`, { type: QueryTypes.SELECT });
      const filas = await sequelize.query<any>(`
        SELECT id, nombre, dni, novedad_siap AS novedad, COALESCE(label_intranet, '') AS label,
               DATE_FORMAT(desde, '%Y-%m-%d') AS desde, DATE_FORMAT(hasta, '%Y-%m-%d') AS hasta,
               estado, COALESCE(detalle, '') AS detalle, intentos, corrida_id,
               DATE_FORMAT(actualizado_en, '%Y-%m-%d %H:%i') AS actualizado
          FROM novedades_carga_intranet
         WHERE dependencia = ? ${todas ? '' : 'AND corrida_id = ?'}
         ORDER BY (estado = 'OK'), nombre, desde`,
        { type: QueryTypes.SELECT, replacements: todas ? [dep] : [dep, ultima?.id ?? 0] });
      return res.json({ ok: true, corrida_actual: ultima?.id ?? null, filas });
    } catch (err: any) {
      if (/doesn't exist/i.test(String(err?.message))) return res.json({ ok: true, corrida_actual: null, filas: [] });
      logger.error({ msg: 'comparacion-v2/resultado', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/lanzar', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const dep = normalizarDependencia(req.body?.dependencia);
      const script = dep ? robotDe(String(req.body?.tipo ?? ''), dep) : null;
      if (!script) return res.status(400).json({ ok: false, error: 'Tipo o dependencia inválidos' });
      const como = await ejecutarAhora(script);
      return res.json({ ok: true, script, como, msg: `Robot ${script} lanzado (queda en la página Robots)` });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/lanzar', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  router.post('/reintentar', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const dep = normalizarDependencia(req.body?.dependencia);
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0);
      if (!dep || !ids.length) return res.status(400).json({ ok: false, error: 'Dependencia o filas inválidas' });

      const filas = await sequelize.query<any>(`
        SELECT id, novedad_siap, corrida_id FROM novedades_carga_intranet
         WHERE id IN (:ids) AND dependencia = :dep AND estado <> 'OK'`,
        { type: QueryTypes.SELECT, replacements: { ids, dep } });
      if (!filas.length) return res.json({ ok: true, msg: 'No hay filas con error para reintentar' });
      await sequelize.query(
        `UPDATE novedades_carga_intranet SET estado = 'PENDIENTE' WHERE id IN (:ids)`,
        { replacements: { ids: filas.map(f => f.id) } });

      const [ultima] = await sequelize.query<any>(
        `SELECT MAX(id) AS id FROM comparacion_corridas`, { type: QueryTypes.SELECT });
      const fueraDeCorrida = filas.filter(f => f.corrida_id !== ultima?.id).length;
      const tipos = new Set<string>(filas.map(f => (f.novedad_siap === AUSENTE ? 'ausentes' : 'novedades')));
      const lanzados: string[] = [];
      for (const tipo of ['novedades', 'ausentes']) {
        if (!tipos.has(tipo)) continue;
        const script = robotDe(tipo, dep)!;
        await ejecutarAhora(script);
        lanzados.push(script);
      }
      return res.json({
        ok: true, filas: filas.length, lanzados, fuera_de_corrida: fueraDeCorrida,
        msg: `${filas.length} fila(s) vuelven a PENDIENTE · lanzado: ${lanzados.join(', ')}`
          + (fueraDeCorrida ? ` · ${fueraDeCorrida} no están en la última comparación (no se reintentan hasta que vuelvan a salir)` : ''),
      });
    } catch (err: any) {
      logger.error({ msg: 'comparacion-v2/reintentar', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  return router;
}
