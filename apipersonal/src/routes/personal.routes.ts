/**
 * @file routes/personal.routes.ts
 * @description Rutas del módulo Personal.
 *
 * Endpoints:
 *   GET  /personal/search           Búsqueda por dni / apellido / nombre / q (con JOIN agentes)
 *   GET  /personal/cumpleanos       Cumpleaños por mes / día / rango
 *   GET  /personal/:dni             Perfil completo (personal + agentes + servicios + foto)
 *   PATCH /personal/:dni            Actualización parcial de datos personales
 *   GET  /personal/:dni/documentos  Documentos del agente (paginados)
 *   GET  /personal/:dni/historial   Historial de cambios en audit_log
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { z } from 'zod';
import { can } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { buildPersonalHistorialRouter } from './personal.historial.routes';
import { invalidate, personalTags, agenteTags } from '../infra/invalidateOnWrite';
import { trackAction } from '../logging/track';
import { logger } from '../logging/logger';

// ── RBAC helper ───────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const pickQueryInt = (v: any, def: number, min: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};
const cleanDigits = (s: string) => String(s || '').replace(/\D/g, '');
const normalizeLike = (s: string) => String(s || '').trim();

// ── Schemas Zod ───────────────────────────────────────────────────────────────
const patchPersonalSchema = z.object({
  // ── tabla: personal ──────────────────────────────────────────────────────
  apellido:               z.string().min(1).max(100).trim().optional(),
  nombre:                 z.string().min(1).max(100).trim().optional(),
  cuil:                   z.string().max(15).optional().nullable(),
  fecha_nacimiento:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sexo_id:                z.number().int().positive().optional().nullable(),
  email:                  z.string().max(200).trim().optional().nullable().or(z.literal('')),
  telefono:               z.string().max(50).optional().nullable(),
  domicilio:              z.string().max(200).optional().nullable(),
  numerodomicilio:        z.number().int().optional().nullable(),
  depto:                  z.string().max(50).optional().nullable(),
  piso:                   z.number().int().optional().nullable(),
  observacionesdireccion: z.string().max(50).optional().nullable(),
  cp:                     z.string().max(50).optional().nullable(),
  localidad_id:           z.number().int().positive().optional().nullable(),
  nacionalidad:           z.string().max(50).optional().nullable(),
  observaciones:          z.string().optional().nullable(),
  estado_empleo:          z.enum(['ACTIVO','INACTIVO','BAJA','COMISION','TRAMITE']).optional().nullable(),
  // ── tabla: agentes ───────────────────────────────────────────────────────
  ley_id:                 z.number().int().positive().optional().nullable(),
  planta_id:              z.number().int().positive().optional().nullable(),
  categoria_id:           z.number().int().positive().optional().nullable(),
  funcion_id:             z.number().int().positive().optional().nullable(),
  ocupacion_id:           z.number().int().positive().optional().nullable(),
  regimen_horario_id:     z.number().int().positive().optional().nullable(),
  dependencia_id:         z.number().int().positive().optional().nullable(),
  reparticion_id:         z.number().int().positive().optional().nullable(),
  fecha_ingreso:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  fecha_egreso:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  fecha_baja:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  legajo:                 z.number().int().optional().nullable(),
  salario_mensual:        z.number().optional().nullable(),
  decreto_designacion:    z.string().max(100).optional().nullable(),
}).strict();

export function buildPersonalRouter(sequelize: Sequelize) {
  const router = Router();

  // ── GET /personal/search ──────────────────────────────────────────────────
  /**
   * Búsqueda de personal con datos laborales básicos (JOIN agentes).
   * Retorna: dni, apellido, nombre, cuil, email, telefono,
   *          ley_nombre, planta_nombre, categoria_nombre, servicio_nombre, estado_empleo
   * Query: ?dni= | ?apellido= | ?nombre= | ?q= | ?sector_id= | ?estado_empleo=
   *        + paginado ?page= ?limit=
   * Sin filtros de búsqueda devuelve todos (útil para listar el sector completo).
   */
  router.get(
    '/search',
    requireCrudFor('personal', 'read'),
    async (req: Request, res: Response) => {
      const page   = pickQueryInt(req.query.page, 1, 1);
      const limit  = Math.min(pickQueryInt(req.query.limit, 20, 1), 500);
      const offset = (page - 1) * limit;

      const dni           = cleanDigits(String(req.query.dni || ''));
      const apellido      = normalizeLike(String(req.query.apellido || ''));
      const nombre        = normalizeLike(String(req.query.nombre || ''));
      const qRaw          = normalizeLike(String(req.query.q || ''));
      const qDigits       = cleanDigits(qRaw);
      const sectorId      = req.query.sector_id   ? Number(req.query.sector_id)   : null;
      const servicioId    = req.query.servicio_id  ? Number(req.query.servicio_id)  : null;
      const estadoEmpleo  = String(req.query.estado_empleo || '').trim().toUpperCase() || null;

      const whereParts: string[] = ['p.deleted_at IS NULL'];
      const repl: Record<string, any> = { limit, offset };

      if (dni) {
        whereParts.push('p.dni = :dni');
        repl.dni = Number(dni);
      } else if (apellido || nombre) {
        if (apellido) { whereParts.push('p.apellido LIKE :apellido'); repl.apellido = `%${apellido}%`; }
        if (nombre)   { whereParts.push('p.nombre LIKE :nombre');     repl.nombre = `%${nombre}%`; }
      } else if (qRaw) {
        if (qDigits) {
          whereParts.push('(p.apellido LIKE :qLike OR p.nombre LIKE :qLike OR p.dni = :qDni)');
          repl.qLike = `%${qRaw}%`;
          repl.qDni  = Number(qDigits);
        } else {
          whereParts.push('(p.apellido LIKE :qLike OR p.nombre LIKE :qLike)');
          repl.qLike = `%${qRaw}%`;
        }
      }

      if (sectorId) {
        whereParts.push(`EXISTS (
          SELECT 1 FROM agentes_sectores asec_flt
          WHERE asec_flt.dni = p.dni
            AND asec_flt.sector_id = :sectorId
            AND asec_flt.fecha_hasta IS NULL
            AND asec_flt.deleted_at IS NULL
        )`);
        repl.sectorId = sectorId;
      }

      if (servicioId) {
        whereParts.push(`EXISTS (
          SELECT 1 FROM agentes_servicios ags_flt
          WHERE ags_flt.dni = p.dni
            AND ags_flt.servicio_id = :servicioId
            AND ags_flt.fecha_hasta IS NULL
            AND ags_flt.deleted_at IS NULL
        )`);
        repl.servicioId = servicioId;
      }

      if (estadoEmpleo) {
        whereParts.push('a.estado_empleo = :estadoEmpleo');
        repl.estadoEmpleo = estadoEmpleo;
      }

      const where = `WHERE ${whereParts.join(' AND ')}`;

      try {
      const [rows, countRows] = await Promise.all([
        sequelize.query(`
          SELECT p.dni, p.apellido, p.nombre, p.cuil, p.email, p.telefono, a.estado_empleo,
                 a.id         AS agente_id,
                 a.fecha_ingreso,
                 l.nombre     AS ley_nombre,
                 pl.nombre    AS planta_nombre,
                 cat.nombre   AS categoria_nombre,
                 fn.nombre    AS funcion_nombre,
                 -- agentes_servicios ya tiene campo 'nombre' directo, no necesita JOIN a servicios
                 (SELECT ags_sub.nombre FROM agentes_servicios ags_sub
                  WHERE ags_sub.dni = p.dni AND ags_sub.deleted_at IS NULL
                  ORDER BY ags_sub.fecha_desde DESC LIMIT 1) AS servicio_nombre
          FROM personal p
          LEFT JOIN agentes a         ON a.dni = p.dni        AND a.deleted_at IS NULL
          LEFT JOIN ley     l         ON l.id  = a.ley_id     AND l.deleted_at IS NULL
          LEFT JOIN plantas pl        ON pl.id = a.planta_id  AND pl.deleted_at IS NULL
          LEFT JOIN categorias cat    ON cat.ID = a.categoria_id
          LEFT JOIN funciones fn      ON fn.id = a.funcion_id AND fn.deleted_at IS NULL
          ${where}
          ORDER BY p.apellido ASC, p.nombre ASC
          LIMIT :limit OFFSET :offset
        `, { replacements: repl, type: QueryTypes.SELECT }),
        sequelize.query(`SELECT COUNT(1) AS total FROM personal p LEFT JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL ${where}`,
          { replacements: repl, type: QueryTypes.SELECT }),
      ]);

      const total = Number((countRows as any[])[0]?.total ?? 0);
      return res.json({ ok: true, data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
      } catch (err: any) {
        logger.error({ msg: '[personal] search error', err: err?.message, sql: err?.sql });
        return res.status(500).json({ ok: false, error: err?.message || 'Error en búsqueda' });
      }
    }
  );

  // ── GET /personal/cumpleanos ──────────────────────────────────────────────
  router.get(
    '/cumpleanos',
    requireCrudFor('personal', 'read'),
    async (req: Request, res: Response) => {
      try {
        const mes   = req.query.mes   ? parseInt(String(req.query.mes), 10)   : null;
        const dia   = req.query.dia   ? parseInt(String(req.query.dia), 10)   : null;
        const desde = req.query.desde ? String(req.query.desde) : null;
        const hasta = req.query.hasta ? String(req.query.hasta) : null;
        const limit = Math.min(parseInt(String(req.query.limit ?? '500'), 10) || 500, 2000);

        const repl: any = { limit };
        const where: string[] = ['p.deleted_at IS NULL', 'p.fecha_nacimiento IS NOT NULL'];

        if (mes && dia) {
          where.push('MONTH(p.fecha_nacimiento) = :mes AND DAY(p.fecha_nacimiento) = :dia');
          repl.mes = mes; repl.dia = dia;
        } else if (mes) {
          where.push('MONTH(p.fecha_nacimiento) = :mes');
          repl.mes = mes;
        } else if (desde && hasta) {
          where.push(`(
            (MONTH(p.fecha_nacimiento) * 100 + DAY(p.fecha_nacimiento))
            BETWEEN (MONTH(:desde) * 100 + DAY(:desde))
            AND     (MONTH(:hasta) * 100 + DAY(:hasta))
          )`);
          repl.desde = desde; repl.hasta = hasta;
        } else {
          return res.status(400).json({ ok: false, error: 'Parámetros: mes, dia, o rango desde/hasta' });
        }

        const rows = await sequelize.query(`
          SELECT p.dni, p.apellido, p.nombre, p.fecha_nacimiento,
                 p.email, p.telefono, p.cuil,
                 MONTH(p.fecha_nacimiento) AS mes_cumple,
                 DAY(p.fecha_nacimiento)   AS dia_cumple,
                 TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) AS edad
          FROM personal p
          INNER JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'
          WHERE ${where.join(' AND ')}
          ORDER BY mes_cumple ASC, dia_cumple ASC, p.apellido ASC
          LIMIT :limit
        `, { replacements: repl, type: QueryTypes.SELECT });

        return res.json({ ok: true, data: rows, total: (rows as any[]).length });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message || 'Error' });
      }
    }
  );

  // ── GET /personal/bajas — Panel gestión de personal de baja ─────────────
  router.get(
    '/bajas',
    requireCrudFor('personal', 'read'),
    async (_req: Request, res: Response) => {
      try {
        const [rows, statsRows] = await Promise.all([
          sequelize.query(`
            SELECT
              p.dni, p.apellido, p.nombre,
              p.fecha_nacimiento,
              p.cuil,
              p.sexo_id,
              sx.nombre        AS sexo_nombre,
              a.fecha_ingreso,
              a.fecha_egreso,
              a.legajo,
              a.ley_id,        l.nombre   AS ley_nombre,
              (SELECT srv.nombre FROM agentes_servicios ags JOIN servicios srv ON srv.id = ags.servicio_id WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL ORDER BY ags.id DESC LIMIT 1) AS servicio_nombre,
              (SELECT sec.nombre FROM agentes_sectores asec JOIN sectores sec ON sec.id = asec.sector_id WHERE asec.dni = p.dni AND asec.deleted_at IS NULL AND asec.fecha_hasta IS NULL ORDER BY asec.id DESC LIMIT 1) AS sector_nombre,
              a.planta_id,     pl.nombre  AS planta_nombre,
              a.categoria_id,  cat.nombre AS categoria_nombre,
              a.funcion_id,    fn.nombre  AS funcion_nombre,
              TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) AS edad
            FROM personal p
            JOIN    agentes    a   ON a.dni  = p.dni
            LEFT JOIN sexos    sx  ON sx.id  = p.sexo_id
            LEFT JOIN ley      l   ON l.id   = a.ley_id
            LEFT JOIN plantas   pl  ON pl.id  = a.planta_id
            LEFT JOIN categorias cat ON cat.ID = a.categoria_id
            LEFT JOIN funciones  fn  ON fn.id  = a.funcion_id
            WHERE a.estado_empleo IN ('BAJA','TRAMITE')
              AND p.deleted_at IS NULL
            ORDER BY a.estado_empleo ASC, p.apellido ASC, p.nombre ASC
          `, { type: QueryTypes.SELECT }),

          sequelize.query(`
            SELECT
              COUNT(*)                                                              AS total,
              SUM(CASE WHEN p.sexo_id       IS NULL THEN 1 ELSE 0 END)            AS sin_sexo,
              SUM(CASE WHEN a.ley_id        IS NULL THEN 1 ELSE 0 END)            AS sin_ley,
              SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM agentes_servicios ags WHERE ags.dni = a.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL) THEN 1 ELSE 0 END) AS sin_servicio,
              SUM(CASE WHEN a.fecha_egreso  IS NULL THEN 1 ELSE 0 END)            AS sin_fecha_egreso,
              SUM(CASE WHEN p.fecha_nacimiento IS NULL THEN 1 ELSE 0 END)         AS sin_fecha_nacimiento,
              SUM(CASE WHEN p.cuil          IS NULL OR p.cuil = '' THEN 1 ELSE 0 END) AS sin_cuil
            FROM personal p
            JOIN agentes a ON a.dni = p.dni
            WHERE a.estado_empleo IN ('BAJA','TRAMITE') AND p.deleted_at IS NULL
          `, { type: QueryTypes.SELECT }),
        ]);

        const stats = (statsRows as any[])[0] ?? {};
        return res.json({ ok: true, data: rows, stats });
      } catch (err: any) {
        logger.error({ msg: '[personal] bajas error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message || 'Error' });
      }
    }
  );

  // ── GET /personal/:dni — Perfil completo ──────────────────────────────────
  /**
   * Devuelve el perfil completo de un agente:
   *   - Datos personales (personal)
   *   - Datos laborales (agentes) con nombres de catálogos (ley, planta, categoría, función...)
   *   - Servicios activos (agentes_servicios)
   *   - Foto carnet (si existe)
   *   - Conteo de documentos
   */
  router.get(
    '/:dni',
    requireCrudFor('personal', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) {
        return res.status(400).json({ ok: false, error: 'DNI inválido' });
      }

      try {
        // Perfil principal (personal + agentes + catálogos)
        const profileRows = await sequelize.query(`
          SELECT
            p.dni, p.apellido, p.nombre, p.cuil,
            p.fecha_nacimiento, a.fecha_ingreso, a.estado_empleo, a.legajo,
            p.email, p.telefono, p.domicilio, p.foto_path, p.observaciones,
            p.created_at AS alta_sistema,

            s.id   AS sexo_id,    s.nombre  AS sexo_nombre,
            l.id   AS ley_id,     l.nombre  AS ley_nombre,
            pl.id  AS planta_id,  pl.nombre AS planta_nombre,
            cat.ID AS categoria_id, cat.nombre AS categoria_nombre,
            fn.id  AS funcion_id, fn.nombre AS funcion_nombre,
            oc.id  AS ocupacion_id, oc.nombre AS ocupacion_nombre,
            rh.id  AS regimen_horario_id, rh.nombre AS regimen_horario_nombre,
            dep.id AS dependencia_id, dep.nombre AS dependencia_nombre,
            rep.id AS reparticion_id,  rep.reparticion_nombre,

            (SELECT ags.servicio_id FROM agentes_servicios ags WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL ORDER BY ags.id DESC LIMIT 1) AS servicio_id,
            (SELECT srv.nombre FROM agentes_servicios ags JOIN servicios srv ON srv.id = ags.servicio_id WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL ORDER BY ags.id DESC LIMIT 1) AS servicio_nombre,
            (SELECT asec.sector_id FROM agentes_sectores asec WHERE asec.dni = p.dni AND asec.deleted_at IS NULL AND asec.fecha_hasta IS NULL ORDER BY asec.id DESC LIMIT 1) AS sector_id,
            (SELECT sec.nombre FROM agentes_sectores asec JOIN sectores sec ON sec.id = asec.sector_id WHERE asec.dni = p.dni AND asec.deleted_at IS NULL AND asec.fecha_hasta IS NULL ORDER BY asec.id DESC LIMIT 1) AS sector_nombre,

            a.id             AS agente_id,
            a.fecha_ingreso  AS fecha_ingreso_laboral,
            a.fecha_egreso,
            a.salario_mensual,
            a.estado         AS estado_laboral

          FROM personal p
          LEFT JOIN agentes a               ON a.dni  = p.dni            AND a.deleted_at IS NULL
          LEFT JOIN sexos s                 ON s.id   = p.sexo_id
          LEFT JOIN ley l                   ON l.id   = a.ley_id
          LEFT JOIN plantas pl              ON pl.id  = a.planta_id
          LEFT JOIN categorias cat          ON cat.ID = a.categoria_id
          LEFT JOIN funciones fn            ON fn.id  = a.funcion_id     AND fn.deleted_at IS NULL
          LEFT JOIN ocupaciones oc          ON oc.id  = a.ocupacion_id   AND oc.deleted_at IS NULL
          LEFT JOIN regimenes_horarios rh   ON rh.id  = a.regimen_horario_id AND rh.deleted_at IS NULL
          LEFT JOIN dependencias dep        ON dep.id = a.dependencia_id
          LEFT JOIN reparticiones rep       ON rep.id = a.reparticion_id
          WHERE p.dni = :dni AND p.deleted_at IS NULL
          LIMIT 1
        `, { replacements: { dni }, type: QueryTypes.SELECT });

        if (!(profileRows as any[]).length) {
          return res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });
        }

        const profile = (profileRows as any[])[0];

        // Servicios vigentes
        const servicios = await sequelize.query(`
          SELECT ags.id, ags.servicio_id, srv.nombre AS servicio_nombre,
                 ags.fecha_desde, ags.fecha_hasta, ags.observaciones,
                 rep.id AS dependencia_id, rep.reparticion_nombre AS dependencia_nombre
          FROM agentes_servicios ags
          JOIN servicios srv ON srv.id = ags.servicio_id
          LEFT JOIN reparticiones rep ON rep.id = ags.dependencia_id
          WHERE ags.dni = :dni AND ags.deleted_at IS NULL
          ORDER BY ags.fecha_desde DESC
        `, { replacements: { dni }, type: QueryTypes.SELECT });

        // Conteo de documentos
        const docCountRows = await sequelize.query(
          `SELECT COUNT(1) AS total FROM tblarchivos WHERE dni = :dni AND deleted_at IS NULL`,
          { replacements: { dni }, type: QueryTypes.SELECT }
        );
        const totalDocumentos = Number((docCountRows as any[])[0]?.total ?? 0);

        return res.json({
          ok: true,
          data: {
            ...profile,
            servicios,
            totalDocumentos,
          },
        });
      } catch (err: any) {
        logger.error({ msg: '[personal] get perfil error', dni, err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message || 'Error' });
      }
    }
  );

  // ── PATCH /personal/:dni — Actualización parcial ──────────────────────────
  /**
   * Actualiza campos de personal y/o agentes en una transacción.
   * Solo actualiza los campos enviados (partial update).
   */
  router.patch(
    '/:dni',
    requireCrudFor('personal', 'update'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) {
        return res.status(400).json({ ok: false, error: 'DNI inválido' });
      }

      const parsed = patchPersonalSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.flatten() });
      }

      const data = parsed.data;
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ ok: false, error: 'Sin campos para actualizar' });
      }

      // Separar campos de personal vs agentes
      const personalFields: Record<string, any> = {};
      const agenteFields:   Record<string, any> = {};

      const PERSONAL_COLS = [
        'apellido','nombre','cuil','fecha_nacimiento','sexo_id','email',
        'telefono','domicilio','numerodomicilio','depto','piso',
        'observacionesdireccion','cp','localidad_id','nacionalidad',
        'observaciones',
      ];
      const AGENTE_COLS = [
        'ley_id','planta_id','categoria_id','funcion_id','ocupacion_id',
        'regimen_horario_id','dependencia_id','reparticion_id',
        'fecha_ingreso','fecha_egreso',
        'legajo','salario_mensual','estado_empleo',
        'decreto_designacion',
      ];

      for (const [k, v] of Object.entries(data)) {
        if (PERSONAL_COLS.includes(k)) personalFields[k] = v;
        else if (AGENTE_COLS.includes(k)) agenteFields[k] = v;
        // fecha_baja del form es la fecha_egreso en agentes (no existe columna fecha_baja)
        else if (k === 'fecha_baja') agenteFields['fecha_egreso'] = v;
      }

      let reactivando = false;
      const t = await sequelize.transaction();
      try {
        // Verificar que el agente existe en personal
        const existCheck = await sequelize.query(
          'SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
          { replacements: { dni }, type: QueryTypes.SELECT }
        );
        if (!existCheck.length) {
          await t.rollback();
          return res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });
        }

        if (Object.keys(personalFields).length > 0) {
          const setCols = Object.keys(personalFields).map(k => `${k} = :${k}`).join(', ');
          await sequelize.query(
            `UPDATE personal SET ${setCols}, updated_at = NOW() WHERE dni = :dni`,
            { replacements: { ...personalFields, dni }, transaction: t }
          );
        }

        if (Object.keys(agenteFields).length > 0) {
          // Verificar estado actual del registro de agente activo
          const agenteActual = await sequelize.query(
            `SELECT id, estado_empleo FROM agentes
             WHERE dni = :dni AND deleted_at IS NULL
             ORDER BY id DESC LIMIT 1`,
            { replacements: { dni }, type: QueryTypes.SELECT, transaction: t }
          ) as any[];

          const estadoActual = agenteActual[0]?.estado_empleo ?? null;
          const esBaja = estadoActual === 'BAJA' || estadoActual === 'TRAMITE';
          const nuevoEstado = agenteFields.estado_empleo;
          reactivando = !!(esBaja && nuevoEstado && !['BAJA','TRAMITE'].includes(nuevoEstado));

          if (reactivando) {
            // Soft-delete el registro de baja — queda como historial
            if (agenteActual[0]?.id) {
              await sequelize.query(
                `UPDATE agentes SET deleted_at = NOW() WHERE id = :id`,
                { replacements: { id: agenteActual[0].id }, transaction: t }
              );
            }
            // Nueva vinculación: excluir fecha_egreso (era la fecha de baja anterior)
            const insertFields = { ...agenteFields };
            delete insertFields['fecha_egreso'];
            const newCols = Object.keys(insertFields).join(', ');
            const newVals = Object.keys(insertFields).map(k => `:${k}`).join(', ');
            await sequelize.query(
              `INSERT INTO agentes (dni, ${newCols}, created_at, updated_at)
               VALUES (:dni, ${newVals}, NOW(), NOW())`,
              { replacements: { ...insertFields, dni }, transaction: t }
            );
          } else {
            // Agente activo o edición sin cambio de estado: actualizar registro existente
            const setCols = Object.keys(agenteFields).map(k => `${k} = :${k}`).join(', ');
            await sequelize.query(
              `UPDATE agentes SET ${setCols}, updated_at = NOW()
               WHERE dni = :dni AND deleted_at IS NULL`,
              { replacements: { ...agenteFields, dni }, transaction: t }
            );
          }
        }

        await t.commit();

        // Invalidar cache
        await invalidate([...personalTags.all(String(dni)), ...agenteTags.all(String(dni))], 'personal.patch').catch(() => {});

        // Audit
        (res.locals as any).audit = {
          action: reactivando ? 'personal_reactivacion' : 'personal_update',
          table_name: 'personal',
          record_pk: dni,
          request_json: data,
        };

        trackAction('personal_update', { dni, fields: Object.keys(data), reactivado: reactivando }, { id: (req as any).auth?.principalId ?? undefined });

        return res.json({
          ok: true,
          reactivado: reactivando ?? false,
          message: reactivando
            ? `Agente DNI ${dni} reactivado — nueva vinculación laboral creada`
            : `Agente DNI ${dni} actualizado`,
        });
      } catch (err: any) {
        await t.rollback().catch(() => {});
        const dbError = {
          name: err?.name,
          message: err?.message,
          code: err?.parent?.code ?? err?.original?.code,
          errno: err?.parent?.errno ?? err?.original?.errno,
          sqlState: err?.parent?.sqlState ?? err?.original?.sqlState,
          sqlMessage: err?.parent?.sqlMessage ?? err?.original?.sqlMessage,
          fields: err?.fields,
          errors: Array.isArray(err?.errors)
            ? err.errors.map((e: any) => ({ message: e?.message, path: e?.path, value: e?.value }))
            : undefined,
        };
        logger.error({ msg: '[personal] patch error', dni, error: dbError });
        if (dbError.code === 'ER_DUP_ENTRY' || err?.name === 'SequelizeUniqueConstraintError') {
          return res.status(409).json({
            ok: false,
            error: 'Conflicto de datos: ya existe un registro con esos valores',
          });
        }
        return res.status(500).json({ ok: false, error: err?.message || 'Error al actualizar' });
      }
    }
  );

  // ── GET /personal/:dni/documentos ─────────────────────────────────────────
  /**
   * Lista todos los documentos de un agente, paginados.
   * Query: ?page= ?limit= ?tipo= ?q=
   */
  router.get(
    '/:dni/documentos',
    requireCrudFor('personal', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) {
        return res.status(400).json({ ok: false, error: 'DNI inválido' });
      }

      const page   = pickQueryInt(req.query.page, 1, 1);
      const limit  = Math.min(pickQueryInt(req.query.limit, 20, 1), 100);
      const offset = (page - 1) * limit;
      const tipo   = req.query.tipo ? String(req.query.tipo).trim() : null;
      const q      = req.query.q    ? String(req.query.q).trim()    : null;

      const where: string[] = ['dni = :dni', 'deleted_at IS NULL'];
      const repl: any = { dni, limit, offset };

      if (tipo) { where.push('tipo = :tipo'); repl.tipo = tipo; }
      if (q)    { where.push('(nombre LIKE :q OR nombre_archivo_original LIKE :q OR descripcion_archivo LIKE :q)'); repl.q = `%${q}%`; }

      const whereStr = where.join(' AND ');

      try {
        const [rows, countRows] = await Promise.all([
          sequelize.query(`
            SELECT id, tipo, numero, fecha, anio, nombre, nombre_archivo_original,
                   descripcion_archivo, tamanio, created_at,
                   CONCAT('/api/v1/documents/', id, '/file') AS fileUrl
            FROM tblarchivos
            WHERE ${whereStr}
            ORDER BY fecha DESC, id DESC
            LIMIT :limit OFFSET :offset
          `, { replacements: repl, type: QueryTypes.SELECT }),
          sequelize.query(`SELECT COUNT(1) AS total FROM tblarchivos WHERE ${whereStr}`,
            { replacements: repl, type: QueryTypes.SELECT }),
        ]);

        const total = Number((countRows as any[])[0]?.total ?? 0);
        return res.json({ ok: true, data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message || 'Error' });
      }
    }
  );

  // ── GET /personal/:dni/laboral — Historial de cargos, servicios y sectores ─
  router.get(
    '/:dni/laboral',
    requireCrudFor('personal', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      try {
        const [cargos, servicios, sectores] = await Promise.all([
          sequelize.query(`
            SELECT a.id, a.ocupacion_id, oc.nombre AS ocupacion_nombre,
                   a.fecha_ingreso, a.fecha_egreso, a.estado_empleo,
                   a.created_at, a.deleted_at
            FROM agentes a
            LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id
            WHERE a.dni = :dni
            ORDER BY a.id ASC
          `, { replacements: { dni }, type: QueryTypes.SELECT }),

          sequelize.query(`
            SELECT ags.id, ags.fecha_desde, ags.fecha_hasta,
                   ags.jefe_nombre, ags.motivo, ags.observaciones,
                   srv.nombre AS servicio_nombre,
                   sec.nombre AS sector_nombre
            FROM agentes_servicios ags
            LEFT JOIN servicios srv ON srv.id = ags.servicio_id
            LEFT JOIN sectores  sec ON sec.id = ags.sector_id
            WHERE ags.dni = :dni AND ags.deleted_at IS NULL
            ORDER BY ags.fecha_desde ASC
          `, { replacements: { dni }, type: QueryTypes.SELECT }),

          sequelize.query(`
            SELECT ags.id, ags.fecha_desde, ags.fecha_hasta,
                   ags.jefe_nombre, ags.motivo, ags.observaciones,
                   sec.nombre AS sector_nombre,
                   srv.nombre AS servicio_nombre
            FROM agentes_sectores ags
            LEFT JOIN sectores  sec ON sec.id = ags.sector_id
            LEFT JOIN servicios srv ON srv.id = ags.servicio_id
            WHERE ags.dni = :dni AND ags.deleted_at IS NULL
            ORDER BY ags.fecha_desde ASC
          `, { replacements: { dni }, type: QueryTypes.SELECT }),
        ]);

        return res.json({ ok: true, data: { cargos, servicios, sectores } });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message || 'Error' });
      }
    }
  );

  // ── Sub-router historial ──────────────────────────────────────────────────
  router.use('/', buildPersonalHistorialRouter(sequelize));

  return router;
}
