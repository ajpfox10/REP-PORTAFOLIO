// src/routes/comisiones.routes.ts
// Pases a comisión (mig 073 agentes_comisiones). Usado por Gestión (modal al elegir
// COMISION) y por la página Herramientas → Comisiones.
//
// El pase NO es editar el estado: es un hito de carrera.
//   - Pase:    cierra el tramo ACTIVO (estado COMISION, fecha_egreso = fecha_desde) y el
//              servicio/sector abiertos con esa misma fecha; guarda acto + destino.
//   - Regreso: abre un tramo ACTIVO nuevo (clon de los datos laborales del cerrado) desde
//              la fecha de regreso, en el servicio/sector que se elija.
//
//   GET   /comisiones                 → todas + tramos COMISION viejos sin datos (pendientes)
//   GET   /comisiones/agente/:dni     → las del agente
//   POST  /comisiones                 → pase (o completar un tramo COMISION viejo: agente_id)
//   POST  /comisiones/:id/regreso     → regreso
//   PATCH /comisiones/:id             → corrige acto / destino / vencimiento / observaciones

import { Router, Request, Response, NextFunction } from 'express';
import { Sequelize, QueryTypes, Transaction } from 'sequelize';
import { z } from 'zod';
import { can } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { invalidate, personalTags, agenteTags } from '../infra/invalidateOnWrite';
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
const TIPOS_ACTO = ['RESOLUCION', 'DISPOSICION', 'DECRETO', 'NOTA', 'OTRO'] as const;

const paseSchema = z.object({
  dni:           z.coerce.number().int().positive(),
  /** Solo para completar un tramo COMISION viejo (cargado sin acto/destino). */
  agente_id:     z.coerce.number().int().positive().optional(),
  tipo_acto:     z.enum(TIPOS_ACTO).optional().nullable(),
  numero_acto:   z.string().trim().min(1, 'Falta el número de acto').max(80),
  destino:       z.string().trim().min(1, 'Falta el destino').max(255),
  fecha_desde:   isoDate,
  fecha_hasta:   isoDate.optional().nullable(),
  observaciones: z.string().max(2000).optional().nullable(),
}).strict();

const regresoSchema = z.object({
  fecha_regreso: isoDate,
  servicio_id:   z.coerce.number().int().positive({ message: 'Elegí el servicio' }),
  sector_id:     z.coerce.number().int().positive().optional().nullable(),
  observaciones: z.string().max(2000).optional().nullable(),
}).strict();

const editSchema = z.object({
  tipo_acto:     z.enum(TIPOS_ACTO).optional().nullable(),
  numero_acto:   z.string().trim().min(1).max(80).optional(),
  destino:       z.string().trim().min(1).max(255).optional(),
  fecha_hasta:   isoDate.optional().nullable(),
  observaciones: z.string().max(2000).optional().nullable(),
}).strict();

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

const SELECT_COMISION = `
  SELECT c.id, c.dni, p.apellido, p.nombre, c.agente_id,
         c.tipo_acto, c.numero_acto, c.destino,
         DATE_FORMAT(c.fecha_desde,   '%Y-%m-%d') AS fecha_desde,
         DATE_FORMAT(c.fecha_hasta,   '%Y-%m-%d') AS fecha_hasta,
         DATE_FORMAT(c.fecha_regreso, '%Y-%m-%d') AS fecha_regreso,
         c.servicio_origen_id,  so.nombre  AS servicio_origen,
         c.sector_origen_id,    sco.nombre AS sector_origen,
         c.servicio_regreso_id, sr.nombre  AS servicio_regreso,
         c.sector_regreso_id,   scr.nombre AS sector_regreso,
         c.observaciones,
         DATEDIFF(COALESCE(c.fecha_regreso, CURDATE()), c.fecha_desde) AS dias,
         CASE
           WHEN c.fecha_regreso IS NOT NULL THEN 'FINALIZADA'
           WHEN c.fecha_hasta IS NOT NULL AND c.fecha_hasta < CURDATE() THEN 'VENCIDA'
           WHEN c.fecha_hasta IS NOT NULL AND c.fecha_hasta <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'POR_VENCER'
           ELSE 'VIGENTE'
         END AS estado,
         DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i') AS created_at
    FROM agentes_comisiones c
    JOIN personal p        ON p.dni = c.dni
    LEFT JOIN servicios so ON so.id = c.servicio_origen_id
    LEFT JOIN sectores sco ON sco.id = c.sector_origen_id
    LEFT JOIN servicios sr ON sr.id = c.servicio_regreso_id
    LEFT JOIN sectores scr ON scr.id = c.sector_regreso_id
   WHERE c.deleted_at IS NULL`;

export function buildComisionesRouter(sequelize: Sequelize): Router {
  const router = Router();
  const sel = <T = any>(sql: string, replacements: Record<string, any> = {}, transaction?: Transaction): Promise<T[]> =>
    sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction }) as unknown as Promise<T[]>;
  const actorOf = (req: Request) => (req as any).auth?.principalId ?? null;

  const fail = (res: Response, err: any, msg: string) => {
    const status = err?.status ?? 500;
    if (status >= 500) logger.error({ msg, err: err?.message });
    return res.status(status).json({ ok: false, error: err?.message || 'Error' });
  };

  // ── Listado completo (página Comisiones) ──────────────────────────────────
  router.get('/', requireCrudFor('personal', 'read'), async (_req, res) => {
    try {
      const data = await sel(`${SELECT_COMISION} ORDER BY c.fecha_regreso IS NULL DESC, c.fecha_desde DESC, c.id DESC`);
      // Tramos en COMISION cargados antes de esta tabla (sin acto/destino/fecha) que
      // siguen siendo el último tramo del agente: quedan para completar.
      const pendientes = await sel(`
        SELECT a.id AS agente_id, a.dni, p.apellido, p.nombre,
               DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
               DATE_FORMAT(a.fecha_egreso,  '%Y-%m-%d') AS fecha_egreso
          FROM agentes a
          JOIN personal p ON p.dni = a.dni
         WHERE a.estado_empleo = 'COMISION' AND a.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM agentes_comisiones c WHERE c.agente_id = a.id AND c.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM agentes b WHERE b.dni = a.dni AND b.deleted_at IS NULL AND b.id > a.id)
         ORDER BY p.apellido, p.nombre`);
      return res.json({ ok: true, data, pendientes });
    } catch (err: any) { return fail(res, err, '[comisiones] listado'); }
  });

  // ── Comisiones de un agente (Gestión) ─────────────────────────────────────
  router.get('/agente/:dni', requireCrudFor('personal', 'read'), async (req, res) => {
    const dni = parseInt(req.params.dni, 10);
    if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
    try {
      const data = await sel(`${SELECT_COMISION} AND c.dni = :dni ORDER BY c.fecha_desde DESC, c.id DESC`, { dni });
      const vigente = data.find((c: any) => !c.fecha_regreso) ?? null;
      // Servicio a proponer para el regreso: el de origen de la vigente, o el último que tuvo.
      const [ultimo] = await sel<any>(`
        SELECT ags.servicio_id, srv.nombre AS servicio
          FROM agentes_servicios ags JOIN servicios srv ON srv.id = ags.servicio_id
         WHERE ags.dni = :dni AND ags.deleted_at IS NULL
         ORDER BY ags.fecha_hasta IS NULL DESC, ags.fecha_hasta DESC, ags.id DESC LIMIT 1`, { dni });
      return res.json({ ok: true, data, vigente, ultimo_servicio: ultimo ?? null });
    } catch (err: any) { return fail(res, err, '[comisiones] agente'); }
  });

  // ── Pase a comisión ───────────────────────────────────────────────────────
  router.post('/', requireCrudFor('personal', 'update'), async (req, res) => {
    const parsed = paseSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({ ok: false, error: first?.message || 'Datos inválidos', details: parsed.error.flatten() });
    }
    const d = parsed.data;
    if (d.fecha_hasta && d.fecha_hasta < d.fecha_desde) {
      return res.status(400).json({ ok: false, error: 'El vencimiento no puede ser anterior al inicio de la comisión' });
    }
    const actor = actorOf(req);
    const t = await sequelize.transaction();
    try {
      let agenteId: number;
      let servicioOrigen: number | null = null;
      let sectorOrigen: number | null = null;

      if (d.agente_id) {
        // Completar un tramo COMISION viejo: no se toca servicio/sector (ya no están abiertos).
        const [tramo] = await sel<any>(
          `SELECT id, dni, estado_empleo, DATE_FORMAT(fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso, fecha_egreso
             FROM agentes WHERE id = :id AND deleted_at IS NULL FOR UPDATE`, { id: d.agente_id }, t);
        if (!tramo || Number(tramo.dni) !== d.dni || tramo.estado_empleo !== 'COMISION') {
          throw httpError(409, 'Ese tramo no es una comisión del agente');
        }
        const [ya] = await sel(`SELECT id FROM agentes_comisiones WHERE agente_id = :id AND deleted_at IS NULL`, { id: d.agente_id }, t);
        if (ya) throw httpError(409, 'Esa comisión ya tiene sus datos cargados');
        if (tramo.fecha_ingreso && d.fecha_desde < tramo.fecha_ingreso) {
          throw httpError(400, `La comisión no puede empezar antes del ingreso del tramo (${tramo.fecha_ingreso})`);
        }
        if (!tramo.fecha_egreso) {
          await sequelize.query(
            `UPDATE agentes SET fecha_egreso = :fd, updated_by = :actor, updated_at = NOW() WHERE id = :id`,
            { replacements: { fd: d.fecha_desde, actor, id: tramo.id }, transaction: t });
        }
        const [prev] = await sel<any>(
          `SELECT servicio_id FROM agentes_servicios WHERE dni = :dni AND deleted_at IS NULL
            ORDER BY fecha_hasta IS NULL DESC, fecha_hasta DESC, id DESC LIMIT 1`, { dni: d.dni }, t);
        servicioOrigen = prev?.servicio_id ?? null;
        agenteId = tramo.id;
      } else {
        const [vigente] = await sel<any>(
          `SELECT id, DATE_FORMAT(fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso FROM agentes
            WHERE dni = :dni AND deleted_at IS NULL AND estado_empleo = 'ACTIVO' AND fecha_egreso IS NULL
            ORDER BY id DESC LIMIT 1 FOR UPDATE`, { dni: d.dni }, t);
        if (!vigente) throw httpError(409, `El DNI ${d.dni} no tiene una vinculación activa para pasar a comisión`);
        if (vigente.fecha_ingreso && d.fecha_desde < vigente.fecha_ingreso) {
          throw httpError(400, `La comisión no puede empezar antes del ingreso (${vigente.fecha_ingreso})`);
        }
        const [srv] = await sel<any>(
          `SELECT servicio_id FROM agentes_servicios WHERE dni = :dni AND fecha_hasta IS NULL AND deleted_at IS NULL
            ORDER BY id DESC LIMIT 1`, { dni: d.dni }, t);
        const [sec] = await sel<any>(
          `SELECT sector_id FROM agentes_sectores WHERE dni = :dni AND fecha_hasta IS NULL AND deleted_at IS NULL
            ORDER BY id DESC LIMIT 1`, { dni: d.dni }, t);
        servicioOrigen = srv?.servicio_id ?? null;
        sectorOrigen = sec?.sector_id ?? null;

        // Cierra el tramo laboral y el destino con la fecha de la comisión.
        await sequelize.query(
          `UPDATE agentes SET estado_empleo = 'COMISION', fecha_egreso = :fd, updated_by = :actor, updated_at = NOW()
            WHERE id = :id`,
          { replacements: { fd: d.fecha_desde, actor, id: vigente.id }, transaction: t });
        await sequelize.query(
          `UPDATE agentes_servicios SET fecha_hasta = :fd, motivo = COALESCE(motivo, 'Pase a comisión'), updated_at = NOW()
            WHERE dni = :dni AND fecha_hasta IS NULL AND deleted_at IS NULL`,
          { replacements: { fd: d.fecha_desde, dni: d.dni }, transaction: t });
        await sequelize.query(
          `UPDATE agentes_sectores SET fecha_hasta = :fd, updated_at = NOW()
            WHERE dni = :dni AND fecha_hasta IS NULL AND deleted_at IS NULL`,
          { replacements: { fd: d.fecha_desde, dni: d.dni }, transaction: t });
        agenteId = vigente.id;
      }

      const [insRes]: any = await sequelize.query(
        `INSERT INTO agentes_comisiones
           (dni, agente_id, tipo_acto, numero_acto, destino, fecha_desde, fecha_hasta,
            servicio_origen_id, sector_origen_id, observaciones, created_by, updated_by)
         VALUES (:dni, :agente_id, :tipo_acto, :numero_acto, :destino, :fecha_desde, :fecha_hasta,
                 :srv, :sec, :obs, :actor, :actor)`,
        { replacements: {
            dni: d.dni, agente_id: agenteId, tipo_acto: d.tipo_acto ?? null,
            numero_acto: d.numero_acto, destino: d.destino,
            fecha_desde: d.fecha_desde, fecha_hasta: d.fecha_hasta ?? null,
            srv: servicioOrigen, sec: sectorOrigen, obs: d.observaciones ?? null, actor,
          }, transaction: t });
      const ins = insRes?.insertId ?? insRes;

      await t.commit();
      await invalidate([...personalTags.all(String(d.dni)), ...agenteTags.all(String(d.dni))], 'comisiones.pase').catch(() => {});
      (res.locals as any).audit = { action: 'comision_pase', table_name: 'agentes_comisiones', record_pk: ins, request_json: d };
      logger.info({ msg: 'Pase a comisión', dni: d.dni, agenteId, completar: !!d.agente_id, actor });
      return res.json({ ok: true, id: ins, message: d.agente_id ? 'Datos de la comisión cargados' : 'Agente pasado a comisión' });
    } catch (err: any) {
      await t.rollback().catch(() => {});
      return fail(res, err, '[comisiones] pase');
    }
  });

  // ── Regreso de comisión ───────────────────────────────────────────────────
  router.post('/:id/regreso', requireCrudFor('personal', 'update'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = regresoSchema.safeParse(req.body);
    if (!id) return res.status(400).json({ ok: false, error: 'Id inválido' });
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Datos inválidos' });
    }
    const d = parsed.data;
    const actor = actorOf(req);
    const t = await sequelize.transaction();
    try {
      const [c] = await sel<any>(
        `SELECT id, dni, agente_id, DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS fecha_desde, fecha_regreso
           FROM agentes_comisiones WHERE id = :id AND deleted_at IS NULL FOR UPDATE`, { id }, t);
      if (!c) throw httpError(404, 'Comisión no encontrada');
      if (c.fecha_regreso) throw httpError(409, 'Esa comisión ya tiene registrado el regreso');
      if (d.fecha_regreso <= c.fecha_desde) {
        throw httpError(400, `El regreso tiene que ser posterior al inicio de la comisión (${c.fecha_desde})`);
      }
      const [activo] = await sel(
        `SELECT id FROM agentes WHERE dni = :dni AND deleted_at IS NULL AND estado_empleo = 'ACTIVO' AND fecha_egreso IS NULL LIMIT 1`,
        { dni: c.dni }, t);
      if (activo) throw httpError(409, 'El agente ya tiene una vinculación activa');

      const [srv] = await sel<any>(`SELECT id FROM servicios WHERE id = :id AND deleted_at IS NULL`, { id: d.servicio_id }, t);
      if (!srv) throw httpError(400, 'El servicio elegido no existe');
      if (d.sector_id) {
        const [sec] = await sel<any>(`SELECT id, servicio_id FROM sectores WHERE id = :id AND deleted_at IS NULL`, { id: d.sector_id }, t);
        if (!sec) throw httpError(400, 'El sector elegido no existe');
        if (sec.servicio_id && Number(sec.servicio_id) !== d.servicio_id) throw httpError(400, 'El sector no pertenece a ese servicio');
      }

      // Tramo a clonar: el cerrado por la comisión (o el último del agente si no quedó ligado).
      const [origen] = await sel<any>(
        c.agente_id
          ? `SELECT id FROM agentes WHERE id = :aid AND deleted_at IS NULL`
          : `SELECT id FROM agentes WHERE dni = :dni AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
        { aid: c.agente_id, dni: c.dni }, t);
      if (!origen) throw httpError(409, 'No se encontró el tramo laboral del agente para reabrir');

      const [nuevoRes]: any = await sequelize.query(
        `INSERT INTO agentes
           (dni, planta_id, categoria_id, ocupacion_id, regimen_horario_id, ley_id, jefatura_id,
            fecha_ingreso, fecha_egreso, fecha_de_nombramiento, fecha_de_tituralizacion,
            estado_empleo, salario_mensual, legajo, funcion_id, decreto_designacion,
            created_by, created_at, updated_at)
         SELECT dni, planta_id, categoria_id, ocupacion_id, regimen_horario_id, ley_id, jefatura_id,
                :fr, NULL, fecha_de_nombramiento, fecha_de_tituralizacion,
                'ACTIVO', salario_mensual, legajo, funcion_id, decreto_designacion,
                :actor, NOW(), NOW()
           FROM agentes WHERE id = :oid`,
        { replacements: { fr: d.fecha_regreso, actor, oid: origen.id }, transaction: t });
      const nuevoId = nuevoRes?.insertId ?? nuevoRes;

      // Destino nuevo (por las dudas, cierra lo que hubiera quedado abierto).
      await sequelize.query(
        `UPDATE agentes_servicios SET fecha_hasta = :fr, updated_at = NOW()
          WHERE dni = :dni AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        { replacements: { dni: c.dni, fr: d.fecha_regreso }, transaction: t });
      await sequelize.query(
        `UPDATE agentes_sectores SET fecha_hasta = :fr, updated_at = NOW()
          WHERE dni = :dni AND fecha_hasta IS NULL AND deleted_at IS NULL`,
        { replacements: { dni: c.dni, fr: d.fecha_regreso }, transaction: t });
      await sequelize.query(
        `INSERT INTO agentes_servicios (dni, servicio_id, fecha_desde, motivo, created_by, created_at, updated_at)
         VALUES (:dni, :srv, :fr, 'Regreso de comisión', :actor, NOW(), NOW())`,
        { replacements: { dni: c.dni, srv: d.servicio_id, fr: d.fecha_regreso, actor }, transaction: t });
      if (d.sector_id) {
        await sequelize.query(
          `INSERT INTO agentes_sectores (dni, sector_id, servicio_id, fecha_desde, motivo, created_by, created_at, updated_at)
           VALUES (:dni, :sec, :srv, :fr, 'Regreso de comisión', :actor, NOW(), NOW())`,
          { replacements: { dni: c.dni, sec: d.sector_id, srv: d.servicio_id, fr: d.fecha_regreso, actor }, transaction: t });
      }

      await sequelize.query(
        `UPDATE agentes_comisiones
            SET fecha_regreso = :fr, servicio_regreso_id = :srv, sector_regreso_id = :sec,
                agente_regreso_id = :nid,
                observaciones = CASE WHEN :obs IS NULL OR :obs = '' THEN observaciones
                                     ELSE CONCAT_WS('\n', NULLIF(observaciones, ''), :obs) END,
                updated_by = :actor, updated_at = NOW()
          WHERE id = :id`,
        { replacements: { fr: d.fecha_regreso, srv: d.servicio_id, sec: d.sector_id ?? null,
            nid: nuevoId, obs: d.observaciones ?? null, actor, id }, transaction: t });

      await t.commit();
      await invalidate([...personalTags.all(String(c.dni)), ...agenteTags.all(String(c.dni))], 'comisiones.regreso').catch(() => {});
      (res.locals as any).audit = { action: 'comision_regreso', table_name: 'agentes_comisiones', record_pk: id, request_json: d };
      logger.info({ msg: 'Regreso de comisión', dni: c.dni, comision: id, agenteNuevo: nuevoId, actor });
      return res.json({ ok: true, agente_id: nuevoId, message: 'Regreso registrado: el agente vuelve a estar ACTIVO' });
    } catch (err: any) {
      await t.rollback().catch(() => {});
      return fail(res, err, '[comisiones] regreso');
    }
  });

  // ── Corrección de datos ───────────────────────────────────────────────────
  router.patch('/:id', requireCrudFor('personal', 'update'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = editSchema.safeParse(req.body);
    if (!id) return res.status(400).json({ ok: false, error: 'Id inválido' });
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || 'Datos inválidos' });
    const d = parsed.data;
    const cols = Object.keys(d);
    if (!cols.length) return res.status(400).json({ ok: false, error: 'Sin cambios' });
    try {
      const [c] = await sel<any>(`SELECT DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS fecha_desde FROM agentes_comisiones WHERE id = :id AND deleted_at IS NULL`, { id });
      if (!c) return res.status(404).json({ ok: false, error: 'Comisión no encontrada' });
      if (d.fecha_hasta && d.fecha_hasta < c.fecha_desde) {
        return res.status(400).json({ ok: false, error: 'El vencimiento no puede ser anterior al inicio de la comisión' });
      }
      await sequelize.query(
        `UPDATE agentes_comisiones SET ${cols.map(k => `${k} = :${k}`).join(', ')}, updated_by = :actor, updated_at = NOW()
          WHERE id = :id`,
        { replacements: { ...d, actor: actorOf(req), id } });
      return res.json({ ok: true });
    } catch (err: any) { return fail(res, err, '[comisiones] edición'); }
  });

  return router;
}
