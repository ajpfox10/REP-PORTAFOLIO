// src/routes/vacacionesAdelantadas.routes.ts
// Vacaciones adelantadas (mig 092 vacaciones_adelantadas). Página Herramientas → Vacaciones adelantadas.
//
// Al cargar se guarda la foto del destino del agente (tramo vigente, servicio abierto y la
// dependencia de ese servicio vía reparticiones), así la búsqueda por servicio/dependencia
// sigue mostrando el adelanto aunque después lo cambien de lugar.
// Auditoría en la misma fila: created_by / updated_by / deleted_by (borrado lógico).
//
//   GET    /vacaciones-adelantadas      → búsqueda: dni, q (apellido/nombre/DNI), servicio_id,
//                                         dependencia_id, anio, desde, hasta, borradas=1
//   POST   /vacaciones-adelantadas      → alta
//   PATCH  /vacaciones-adelantadas/:id  → edición
//   DELETE /vacaciones-adelantadas/:id  → borrado lógico

import { Router, Request, Response, NextFunction } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { z } from 'zod';
import { can } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');

const altaSchema = z.object({
  dni:           z.coerce.number().int().positive(),
  fecha_desde:   isoDate,
  fecha_hasta:   isoDate,
  dias:          z.coerce.number().int().positive('Los días tienen que ser mayores a 0').max(365),
  anio_imputado: z.coerce.number().int().min(2000).max(2100),
  observaciones: z.string().max(2000).optional().nullable(),
}).strict();

const editSchema = z.object({
  fecha_desde:   isoDate.optional(),
  fecha_hasta:   isoDate.optional(),
  dias:          z.coerce.number().int().positive('Los días tienen que ser mayores a 0').max(365).optional(),
  anio_imputado: z.coerce.number().int().min(2000).max(2100).optional(),
  observaciones: z.string().max(2000).optional().nullable(),
}).strict();

const SELECT_VA = `
  SELECT v.id, v.dni, p.apellido, p.nombre, v.agente_id,
         DATE_FORMAT(v.fecha_desde, '%Y-%m-%d') AS fecha_desde,
         DATE_FORMAT(v.fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
         v.dias, v.anio_imputado,
         v.servicio_id,    srv.nombre AS servicio,
         v.dependencia_id, dep.nombre AS dependencia,
         v.observaciones,
         DATE_FORMAT(v.created_at, '%Y-%m-%d %H:%i') AS created_at,
         DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i') AS updated_at,
         DATE_FORMAT(v.deleted_at, '%Y-%m-%d %H:%i') AS deleted_at,
         COALESCE(uc.nombre, uc.email) AS creado_por,
         COALESCE(uu.nombre, uu.email) AS editado_por,
         COALESCE(ud.nombre, ud.email) AS borrado_por
    FROM vacaciones_adelantadas v
    JOIN personal p           ON p.dni = v.dni
    LEFT JOIN servicios srv    ON srv.id = v.servicio_id
    LEFT JOIN dependencias dep ON dep.id = v.dependencia_id
    LEFT JOIN usuarios uc      ON uc.id = v.created_by
    LEFT JOIN usuarios uu      ON uu.id = v.updated_by
    LEFT JOIN usuarios ud      ON ud.id = v.deleted_by`;

export function buildVacacionesAdelantadasRouter(sequelize: Sequelize): Router {
  const router = Router();
  const sel = <T = any>(sql: string, replacements: Record<string, any> = {}): Promise<T[]> =>
    sequelize.query(sql, { replacements, type: QueryTypes.SELECT }) as unknown as Promise<T[]>;
  const actorOf = (req: Request) => (req as any).auth?.principalId ?? null;

  const fail = (res: Response, err: any, msg: string) => {
    const status = err?.status ?? 500;
    if (status >= 500) logger.error({ msg, err: err?.message });
    return res.status(status).json({ ok: false, error: err?.message || 'Error' });
  };

  // ── Búsqueda ──────────────────────────────────────────────────────────────
  router.get('/', requireCrudFor('personal', 'read'), async (req, res) => {
    const where: string[] = [];
    const r: Record<string, any> = {};
    const num = (v: any) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) && n > 0 ? n : null; };
    const str = (v: any) => String(v ?? '').trim();

    if (str(req.query.borradas) !== '1') where.push('v.deleted_at IS NULL');
    const dni = num(req.query.dni);
    if (dni) { where.push('v.dni = :dni'); r.dni = dni; }
    const q = str(req.query.q);
    if (q) {
      if (/^\d+$/.test(q)) { where.push('CAST(v.dni AS CHAR) LIKE :qdni'); r.qdni = `${q}%`; }
      else { where.push("CONCAT_WS(' ', p.apellido, p.nombre) LIKE :q"); r.q = `%${q}%`; }
    }
    const servicioId = num(req.query.servicio_id);
    if (servicioId) { where.push('v.servicio_id = :servicioId'); r.servicioId = servicioId; }
    const dependenciaId = num(req.query.dependencia_id);
    if (dependenciaId) { where.push('v.dependencia_id = :dependenciaId'); r.dependenciaId = dependenciaId; }
    const anio = num(req.query.anio);
    if (anio) { where.push('v.anio_imputado = :anio'); r.anio = anio; }
    // Período: adelantos que se superponen con [desde, hasta].
    if (/^\d{4}-\d{2}-\d{2}$/.test(str(req.query.desde))) { where.push('v.fecha_hasta >= :desde'); r.desde = str(req.query.desde); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str(req.query.hasta))) { where.push('v.fecha_desde <= :hasta'); r.hasta = str(req.query.hasta); }

    try {
      const data = await sel(
        `${SELECT_VA} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY v.fecha_desde DESC, v.id DESC LIMIT 5000`, r);
      return res.json({ ok: true, data });
    } catch (err: any) { return fail(res, err, '[vacaciones-adelantadas] búsqueda'); }
  });

  // ── Alta ──────────────────────────────────────────────────────────────────
  router.post('/', requireCrudFor('personal', 'update'), async (req, res) => {
    const parsed = altaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Datos inválidos' });
    }
    const d = parsed.data;
    if (d.fecha_hasta < d.fecha_desde) {
      return res.status(400).json({ ok: false, error: 'La fecha hasta no puede ser anterior a la fecha desde' });
    }
    const actor = actorOf(req);
    try {
      const [persona] = await sel(`SELECT dni FROM personal WHERE dni = :dni`, { dni: d.dni });
      if (!persona) return res.status(404).json({ ok: false, error: `No existe el DNI ${d.dni}` });

      // Foto del destino actual: tramo vigente (o el último), servicio abierto y su dependencia.
      const [agente] = await sel<any>(
        `SELECT id FROM agentes WHERE dni = :dni AND deleted_at IS NULL
          ORDER BY (estado_empleo = 'ACTIVO' AND fecha_egreso IS NULL) DESC, id DESC LIMIT 1`, { dni: d.dni });
      const [destino] = await sel<any>(
        `SELECT ags.servicio_id, rep.dependencia_id
           FROM agentes_servicios ags
           LEFT JOIN servicios srv     ON srv.id = ags.servicio_id
           LEFT JOIN reparticiones rep ON rep.id = srv.reparticion_id
          WHERE ags.dni = :dni AND ags.deleted_at IS NULL
          ORDER BY ags.fecha_hasta IS NULL DESC, ags.fecha_hasta DESC, ags.id DESC LIMIT 1`, { dni: d.dni });

      const [insRes]: any = await sequelize.query(
        `INSERT INTO vacaciones_adelantadas
           (dni, agente_id, fecha_desde, fecha_hasta, dias, anio_imputado,
            servicio_id, dependencia_id, observaciones, created_by, updated_by)
         VALUES (:dni, :agente_id, :fecha_desde, :fecha_hasta, :dias, :anio_imputado,
                 :servicio_id, :dependencia_id, :obs, :actor, :actor)`,
        { replacements: {
            dni: d.dni, agente_id: agente?.id ?? null,
            fecha_desde: d.fecha_desde, fecha_hasta: d.fecha_hasta, dias: d.dias, anio_imputado: d.anio_imputado,
            servicio_id: destino?.servicio_id ?? null, dependencia_id: destino?.dependencia_id ?? null,
            obs: d.observaciones?.trim() || null, actor,
          } });
      const id = insRes?.insertId ?? insRes;
      (res.locals as any).audit = { action: 'vacaciones_adelantadas_alta', table_name: 'vacaciones_adelantadas', record_pk: id, request_json: d };
      logger.info({ msg: 'Vacaciones adelantadas: alta', id, dni: d.dni, actor });
      return res.json({ ok: true, id, message: 'Vacaciones adelantadas cargadas' });
    } catch (err: any) { return fail(res, err, '[vacaciones-adelantadas] alta'); }
  });

  // ── Edición ───────────────────────────────────────────────────────────────
  router.patch('/:id', requireCrudFor('personal', 'update'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Id inválido' });
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Datos inválidos' });
    const d = { ...parsed.data, ...(parsed.data.observaciones !== undefined ? { observaciones: parsed.data.observaciones?.trim() || null } : {}) };
    const cols = Object.keys(d);
    if (!cols.length) return res.status(400).json({ ok: false, error: 'Sin cambios' });
    try {
      const [v] = await sel<any>(
        `SELECT DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS fecha_desde, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS fecha_hasta
           FROM vacaciones_adelantadas WHERE id = :id AND deleted_at IS NULL`, { id });
      if (!v) return res.status(404).json({ ok: false, error: 'Registro no encontrado' });
      if ((d.fecha_hasta ?? v.fecha_hasta) < (d.fecha_desde ?? v.fecha_desde)) {
        return res.status(400).json({ ok: false, error: 'La fecha hasta no puede ser anterior a la fecha desde' });
      }
      await sequelize.query(
        `UPDATE vacaciones_adelantadas SET ${cols.map(k => `${k} = :${k}`).join(', ')}, updated_by = :actor, updated_at = NOW()
          WHERE id = :id`,
        { replacements: { ...d, actor: actorOf(req), id } });
      (res.locals as any).audit = { action: 'vacaciones_adelantadas_edicion', table_name: 'vacaciones_adelantadas', record_pk: id, request_json: d };
      return res.json({ ok: true, message: 'Cambios guardados' });
    } catch (err: any) { return fail(res, err, '[vacaciones-adelantadas] edición'); }
  });

  // ── Borrado lógico ────────────────────────────────────────────────────────
  router.delete('/:id', requireCrudFor('personal', 'update'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Id inválido' });
    try {
      const actor = actorOf(req);
      const [v] = await sel(`SELECT id FROM vacaciones_adelantadas WHERE id = :id AND deleted_at IS NULL`, { id });
      if (!v) return res.status(404).json({ ok: false, error: 'Registro no encontrado o ya borrado' });
      await sequelize.query(
        `UPDATE vacaciones_adelantadas SET deleted_at = NOW(), deleted_by = :actor
          WHERE id = :id AND deleted_at IS NULL`,
        { replacements: { actor, id } });
      (res.locals as any).audit = { action: 'vacaciones_adelantadas_borrado', table_name: 'vacaciones_adelantadas', record_pk: id };
      logger.info({ msg: 'Vacaciones adelantadas: borrado', id, actor });
      return res.json({ ok: true, message: 'Registro borrado' });
    } catch (err: any) { return fail(res, err, '[vacaciones-adelantadas] borrado'); }
  });

  return router;
}
