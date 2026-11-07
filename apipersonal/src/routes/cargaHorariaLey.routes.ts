// src/routes/cargaHorariaLey.routes.ts
// Herramientas → Carga horaria por ley (mig 114). Define las horas semanales que salen en
// los certificados según la ley, la insalubridad de la ocupación y los servicios de
// agotamiento prematuro. La regla está en services/cargaHoraria.ts.
//
//   GET    /carga-horaria-ley                         → leyes + config + cómo quedan los activos
//   PUT    /carga-horaria-ley/:leyId                  → guarda horas (vacío = sin dato)
//   GET    /carga-horaria-ley/ocupaciones?ley_id=X    → ocupaciones de los activos de la ley (insalubre sí/no)
//   PUT    /carga-horaria-ley/ocupaciones/:id         → { insalubre } lista propia de horas (mig 115)
//   GET    /carga-horaria-ley/sectores                → sectores insalubres (mig 116)
//   POST   /carga-horaria-ley/sectores                → { sector_id }
//   DELETE /carga-horaria-ley/sectores/:sectorId
//   GET    /carga-horaria-ley/agotamiento             → servicios marcados como agotamiento prematuro
//   POST   /carga-horaria-ley/agotamiento             → { servicio_id }
//   DELETE /carga-horaria-ley/agotamiento/:servicioId

import { Router, Request, Response, NextFunction } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { z } from 'zod';
import { can } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { elegirHoras, SQL_FACTORES_HORAS, SQL_JOINS_HORAS } from '../services/cargaHoraria';

function requireCrudFor(table: string, action: 'read' | 'create' | 'update' | 'delete') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE || !env.AUTH_ENABLE) return next();
    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (!can(auth.permissions || [], table, action)) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }
    return next();
  };
}

const horas = z.union([z.coerce.number().int().min(1).max(80), z.literal(''), z.null()])
  .optional().transform((v) => (v === '' || v == null ? null : v));

const putSchema = z.object({
  horas_base:        horas,
  horas_insalubre:   horas,
  horas_agotamiento: horas,
  observaciones:     z.string().max(500).optional().nullable(),
}).strict();

export function buildCargaHorariaLeyRouter(sequelize: Sequelize): Router {
  const router = Router();
  const sel = <T = any>(sql: string, replacements: Record<string, any> = {}): Promise<T[]> =>
    sequelize.query(sql, { replacements, type: QueryTypes.SELECT }) as unknown as Promise<T[]>;
  const actorOf = (req: Request) => (req as any).auth?.principalId ?? null;
  const fail = (res: Response, err: any, msg: string) => {
    logger.error({ msg, err: err?.message });
    return res.status(500).json({ ok: false, error: err?.message || 'Error' });
  };

  // ── Leyes + configuración + resultado sobre los activos ──────────────────
  router.get('/', requireCrudFor('personal', 'read'), async (_req, res) => {
    try {
      const leyes = await sel<any>(
        `SELECT l.id, l.nombre, chl.horas_base, chl.horas_insalubre, chl.horas_agotamiento, chl.observaciones,
                DATE_FORMAT(chl.updated_at, '%Y-%m-%d %H:%i') AS updated_at,
                COALESCE(u.nombre, u.email) AS editado_por
           FROM ley l
           LEFT JOIN carga_horaria_ley chl ON chl.ley_id = l.id
           LEFT JOIN usuarios u ON u.id = chl.updated_by
          WHERE l.deleted_at IS NULL
          ORDER BY l.nombre`);
      // Tramos vigentes: cómo quedarían las horas con la configuración actual.
      const activos = await sel<any>(
        `SELECT a.ley_id, ${SQL_FACTORES_HORAS}
           FROM agentes a ${SQL_JOINS_HORAS}
          WHERE a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO' AND a.fecha_egreso IS NULL`);
      const porLey = new Map<number, any>();
      for (const f of activos) {
        const r = porLey.get(f.ley_id) ?? { activos: 0, insalubres: 0, agotamiento: 0, horas: {} as Record<string, number> };
        r.activos++;
        if (Number(f.es_insalubre)) r.insalubres++;
        if (Number(f.es_agotamiento)) r.agotamiento++;
        const h = elegirHoras(f);
        const k = h.horas ? `${h.horas} hs (${h.motivo.toLowerCase()})` : 'sin dato';
        r.horas[k] = (r.horas[k] ?? 0) + 1;
        porLey.set(f.ley_id, r);
      }
      const data = leyes.map((l) => ({
        ...l,
        ...(porLey.get(l.id) ?? { activos: 0, insalubres: 0, agotamiento: 0, horas: {} }),
      }));
      return res.json({ ok: true, data });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] listado'); }
  });

  // ── Ocupaciones de los activos de una ley (para ver quién es insalubre) ──
  router.get('/ocupaciones', requireCrudFor('personal', 'read'), async (req, res) => {
    const leyId = parseInt(String(req.query.ley_id ?? ''), 10);
    if (!Number.isFinite(leyId)) return res.status(400).json({ ok: false, error: 'ley_id requerido' });
    try {
      const data = await sel(
        `SELECT oc.id, oc.nombre, COALESCE(oc.es_insalubre, 0) AS insalubre_jubilacion,
                (chio.id IS NOT NULL) AS insalubre_horas, COUNT(*) AS activos
           FROM agentes a JOIN ocupaciones oc ON oc.id = a.ocupacion_id
           LEFT JOIN carga_horaria_insalubre_ocupaciones chio ON chio.ocupacion_id = oc.id
          WHERE a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO' AND a.fecha_egreso IS NULL
            AND a.ley_id = :leyId
          GROUP BY oc.id, oc.nombre, oc.es_insalubre, chio.id
          ORDER BY activos DESC, oc.nombre`, { leyId });
      return res.json({ ok: true, data });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] ocupaciones'); }
  });

  // Marca / desmarca una ocupación como insalubre para las horas (no toca es_insalubre).
  router.put('/ocupaciones/:ocupacionId', requireCrudFor('ley', 'update'), async (req, res) => {
    const ocupacionId = parseInt(String(req.params.ocupacionId), 10);
    if (!Number.isFinite(ocupacionId)) return res.status(400).json({ ok: false, error: 'ocupación inválida' });
    const insalubre = req.body?.insalubre === true || req.body?.insalubre === 1 || req.body?.insalubre === '1';
    try {
      if (insalubre) {
        await sequelize.query(
          `INSERT IGNORE INTO carga_horaria_insalubre_ocupaciones (ocupacion_id, created_by) VALUES (:ocupacionId, :actor)`,
          { replacements: { ocupacionId, actor: actorOf(req) } });
      } else {
        await sequelize.query(`DELETE FROM carga_horaria_insalubre_ocupaciones WHERE ocupacion_id = :ocupacionId`,
          { replacements: { ocupacionId } });
      }
      return res.json({ ok: true });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] ocupación insalubre'); }
  });

  // ── Sectores insalubres (mig 116) ────────────────────────────────────────
  router.get('/sectores', requireCrudFor('personal', 'read'), async (_req, res) => {
    try {
      const data = await sel(
        `SELECT se.id AS sector_id, se.nombre, sv.nombre AS servicio,
                (SELECT COUNT(DISTINCT asx.dni) FROM agentes_sectores asx
                  WHERE asx.sector_id = se.id AND asx.deleted_at IS NULL
                    AND (asx.fecha_hasta IS NULL OR asx.fecha_hasta >= CURDATE())) AS agentes,
                DATE_FORMAT(chis.created_at, '%Y-%m-%d %H:%i') AS created_at,
                COALESCE(u.nombre, u.email) AS creado_por
           FROM carga_horaria_insalubre_sectores chis
           JOIN sectores se ON se.id = chis.sector_id
           LEFT JOIN servicios sv ON sv.id = se.servicio_id
           LEFT JOIN usuarios u ON u.id = chis.created_by
          ORDER BY se.nombre`);
      return res.json({ ok: true, data });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] sectores'); }
  });

  router.post('/sectores', requireCrudFor('ley', 'update'), async (req, res) => {
    const sectorId = parseInt(String(req.body?.sector_id ?? ''), 10);
    if (!Number.isFinite(sectorId)) return res.status(400).json({ ok: false, error: 'sector_id requerido' });
    try {
      const [s] = await sel(`SELECT id FROM sectores WHERE id = :sectorId AND deleted_at IS NULL`, { sectorId });
      if (!s) return res.status(404).json({ ok: false, error: 'No existe el sector' });
      await sequelize.query(
        `INSERT IGNORE INTO carga_horaria_insalubre_sectores (sector_id, created_by) VALUES (:sectorId, :actor)`,
        { replacements: { sectorId, actor: actorOf(req) } });
      return res.json({ ok: true });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] alta sector'); }
  });

  router.delete('/sectores/:sectorId', requireCrudFor('ley', 'update'), async (req, res) => {
    const sectorId = parseInt(String(req.params.sectorId), 10);
    if (!Number.isFinite(sectorId)) return res.status(400).json({ ok: false, error: 'sector inválido' });
    try {
      await sequelize.query(`DELETE FROM carga_horaria_insalubre_sectores WHERE sector_id = :sectorId`,
        { replacements: { sectorId } });
      return res.json({ ok: true });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] baja sector'); }
  });

  // ── Servicios de agotamiento prematuro ───────────────────────────────────
  router.get('/agotamiento', requireCrudFor('personal', 'read'), async (_req, res) => {
    try {
      const data = await sel(
        `SELECT s.id AS servicio_id, s.nombre,
                (SELECT COUNT(DISTINCT ags.dni) FROM agentes_servicios ags
                  WHERE ags.servicio_id = s.id AND ags.deleted_at IS NULL
                    AND (ags.fecha_hasta IS NULL OR ags.fecha_hasta >= CURDATE())) AS agentes,
                DATE_FORMAT(chas.created_at, '%Y-%m-%d %H:%i') AS created_at,
                COALESCE(u.nombre, u.email) AS creado_por
           FROM carga_horaria_agotamiento_servicios chas
           JOIN servicios s ON s.id = chas.servicio_id
           LEFT JOIN usuarios u ON u.id = chas.created_by
          ORDER BY s.nombre`);
      return res.json({ ok: true, data });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] agotamiento'); }
  });

  router.post('/agotamiento', requireCrudFor('ley', 'update'), async (req, res) => {
    const servicioId = parseInt(String(req.body?.servicio_id ?? ''), 10);
    if (!Number.isFinite(servicioId)) return res.status(400).json({ ok: false, error: 'servicio_id requerido' });
    try {
      const [s] = await sel(`SELECT id FROM servicios WHERE id = :servicioId AND deleted_at IS NULL`, { servicioId });
      if (!s) return res.status(404).json({ ok: false, error: 'No existe el servicio' });
      await sequelize.query(
        `INSERT IGNORE INTO carga_horaria_agotamiento_servicios (servicio_id, created_by) VALUES (:servicioId, :actor)`,
        { replacements: { servicioId, actor: actorOf(req) } });
      return res.json({ ok: true });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] alta agotamiento'); }
  });

  router.delete('/agotamiento/:servicioId', requireCrudFor('ley', 'update'), async (req, res) => {
    const servicioId = parseInt(String(req.params.servicioId), 10);
    if (!Number.isFinite(servicioId)) return res.status(400).json({ ok: false, error: 'servicio inválido' });
    try {
      await sequelize.query(`DELETE FROM carga_horaria_agotamiento_servicios WHERE servicio_id = :servicioId`,
        { replacements: { servicioId } });
      return res.json({ ok: true });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] baja agotamiento'); }
  });

  // ── Guardar horas de una ley ─────────────────────────────────────────────
  router.put('/:leyId', requireCrudFor('ley', 'update'), async (req, res) => {
    const leyId = parseInt(String(req.params.leyId), 10);
    if (!Number.isFinite(leyId)) return res.status(400).json({ ok: false, error: 'ley inválida' });
    const parsed = putSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Datos inválidos' });
    }
    const d = parsed.data;
    try {
      const [l] = await sel(`SELECT id FROM ley WHERE id = :leyId`, { leyId });
      if (!l) return res.status(404).json({ ok: false, error: 'No existe la ley' });
      await sequelize.query(
        `INSERT INTO carga_horaria_ley (ley_id, horas_base, horas_insalubre, horas_agotamiento, observaciones, updated_by)
         VALUES (:leyId, :hb, :hi, :ha, :obs, :actor)
         ON DUPLICATE KEY UPDATE horas_base = VALUES(horas_base), horas_insalubre = VALUES(horas_insalubre),
                                 horas_agotamiento = VALUES(horas_agotamiento), observaciones = VALUES(observaciones),
                                 updated_by = VALUES(updated_by)`,
        { replacements: { leyId, hb: d.horas_base, hi: d.horas_insalubre, ha: d.horas_agotamiento,
                          obs: d.observaciones?.trim() || null, actor: actorOf(req) } });
      return res.json({ ok: true });
    } catch (err: any) { return fail(res, err, '[carga-horaria-ley] guardar'); }
  });

  return router;
}
