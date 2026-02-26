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
  apellido:        z.string().min(1).max(100).trim().optional(),
  nombre:          z.string().min(1).max(100).trim().optional(),
  cuil:            z.string().max(15).optional(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sexo_id:         z.number().int().positive().optional().nullable(),
  email:           z.string().email().optional().nullable().or(z.literal('')),
  telefono:        z.string().max(50).optional().nullable(),
  domicilio:       z.string().max(255).optional().nullable(),
  localidad_id:    z.number().int().positive().optional().nullable(),
  observaciones:   z.string().optional().nullable(),
  estado_empleo:   z.string().max(50).optional().nullable(),
  // Datos laborales en agentes
  ley_id:          z.number().int().positive().optional().nullable(),
  planta_id:       z.number().int().positive().optional().nullable(),
  categoria_id:    z.number().int().positive().optional().nullable(),
  funcion_id:      z.number().int().positive().optional().nullable(),
  ocupacion_id:    z.number().int().positive().optional().nullable(),
  regimen_horario_id: z.number().int().positive().optional().nullable(),
  sector_id:       z.number().int().positive().optional().nullable(),
  dependencia_id:  z.number().int().positive().optional().nullable(),
  fecha_ingreso:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  fecha_egreso:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
}).strict();

export function buildPersonalRouter(sequelize: Sequelize) {
  const router = Router();

  // ── GET /personal/search ──────────────────────────────────────────────────
  /**
   * Búsqueda de personal con datos laborales básicos (JOIN agentes).
   * Retorna: dni, apellido, nombre, cuil, email, telefono,
   *          ley_nombre, planta_nombre, categoria_nombre, servicio_nombre, estado_empleo
   * Query: ?dni= | ?apellido= | ?nombre= | ?q=  + paginado ?page= ?limit=
   */
  router.get(
    '/search',
    requireCrudFor('personal', 'read'),
    async (req: Request, res: Response) => {
      const page   = pickQueryInt(req.query.page, 1, 1);
      const limit  = Math.min(pickQueryInt(req.query.limit, 20, 1), 200);
      const offset = (page - 1) * limit;

      const dni      = cleanDigits(String(req.query.dni || ''));
      const apellido = normalizeLike(String(req.query.apellido || ''));
      const nombre   = normalizeLike(String(req.query.nombre || ''));
      const qRaw     = normalizeLike(String(req.query.q || ''));
      const qDigits  = cleanDigits(qRaw);

      const hasAny = Boolean(dni || apellido || nombre || qRaw);
      if (!hasAny) {
        return res.status(400).json({ ok: false, error: 'Parámetros requeridos: dni / apellido / nombre / q' });
      }

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
        sequelize.query(`SELECT COUNT(1) AS total FROM personal p ${where}`,
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

            a.id           AS agente_id,
            a.fecha_ingreso AS fecha_ingreso_laboral,
            a.fecha_egreso,
            a.estado       AS estado_laboral

          FROM personal p
          LEFT JOIN agentes a         ON a.dni = p.dni       AND a.deleted_at IS NULL
          LEFT JOIN sexos s           ON s.id  = p.sexo_id
          LEFT JOIN ley l             ON l.id  = a.ley_id
          LEFT JOIN plantas pl        ON pl.id = a.planta_id
          LEFT JOIN categorias cat    ON cat.ID = a.categoria_id
          LEFT JOIN funciones fn      ON fn.id = a.funcion_id AND fn.deleted_at IS NULL
          LEFT JOIN ocupaciones oc    ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
          LEFT JOIN regimenes_horarios rh ON rh.id = a.regimen_horario_id AND rh.deleted_at IS NULL
          LEFT JOIN dependencias dep  ON dep.id = a.dependencia_id
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
                 ags.fecha_desde, ags.fecha_hasta, ags.observaciones
          FROM agentes_servicios ags
          JOIN servicios srv ON srv.id = ags.servicio_id
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

      const PERSONAL_COLS = ['apellido','nombre','cuil','fecha_nacimiento','sexo_id','email',
        'telefono','domicilio','localidad_id','observaciones','estado_empleo'];
      const AGENTE_COLS = ['ley_id','planta_id','categoria_id','funcion_id','ocupacion_id',
        'regimen_horario_id','sector_id','dependencia_id','fecha_ingreso','fecha_egreso'];

      for (const [k, v] of Object.entries(data)) {
        if (PERSONAL_COLS.includes(k)) personalFields[k] = v;
        else if (AGENTE_COLS.includes(k)) agenteFields[k] = v;
      }

      const t = await sequelize.transaction();
      try {
        // Verificar que el agente existe
        const [check] = await sequelize.query(
          'SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
          { replacements: { dni }, type: QueryTypes.SELECT }
        );
        if (!(check as any[]).length) {
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
          const setCols = Object.keys(agenteFields).map(k => `${k} = :${k}`).join(', ');
          await sequelize.query(
            `UPDATE agentes SET ${setCols} WHERE dni = :dni AND deleted_at IS NULL`,
            { replacements: { ...agenteFields, dni }, transaction: t }
          );
        }

        await t.commit();

        // Invalidar cache
        await invalidate([...personalTags.all(String(dni)), ...agenteTags.all(String(dni))], 'personal.patch').catch(() => {});

        // Audit
        (res.locals as any).audit = {
          action: 'personal_update',
          table_name: 'personal',
          record_pk: dni,
          request_json: data,
        };

        trackAction('personal_update', { dni, fields: Object.keys(data) }, { id: (req as any).auth?.principalId ?? undefined });

        return res.json({ ok: true, message: `Agente DNI ${dni} actualizado` });
      } catch (err: any) {
        await t.rollback().catch(() => {});
        logger.error({ msg: '[personal] patch error', dni, err: err?.message });
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

  // ── Sub-router historial ──────────────────────────────────────────────────
  router.use('/', buildPersonalHistorialRouter(sequelize));

  return router;
}
