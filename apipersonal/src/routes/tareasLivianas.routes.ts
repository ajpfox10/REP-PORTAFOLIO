// src/routes/tareasLivianas.routes.ts
// Tareas livianas de agentes (Salud Laboral).
// Acceso: admin (crud:*:*) + user (crud:*:read/write o crud:tareas_livianas:*). NO salud_laboral.
// Guarda rango desde/hasta, servicio y turno; la junta médica se detecta en tblarchivos por DNI.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission, can } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

function getUser(req: Request) {
  const auth = (req as any).auth ?? {};
  const perms: string[] = auth.permissions ?? [];
  const isAdmin   = perms.some((p: string) => p === 'crud:*:*');
  const canVer    = can(perms, 'tareas_livianas', 'read');
  const canCrear  = can(perms, 'tareas_livianas', 'create');
  const canEditar = can(perms, 'tareas_livianas', 'update');
  return { id: auth.principalId ?? null, perms, isAdmin, canVer, canCrear, canEditar };
}

async function getUserEmail(sequelize: Sequelize, userId: number | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const [row] = await sequelize.query<any>(
      `SELECT email FROM usuarios WHERE id = ? LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: [userId] },
    );
    return row?.email ?? null;
  } catch { return null; }
}

async function logAudit(
  sequelize: Sequelize,
  registroId: number,
  accion: string,
  userId: number | null,
  userEmail: string | null,
  antes: any,
  despues: any,
) {
  try {
    await sequelize.query(
      `INSERT INTO tareas_livianas_auditoria
         (registro_id, accion, usuario_id, usuario_email, datos_antes, datos_despues)
       VALUES (?, ?, ?, ?, ?, ?)`,
      { replacements: [registroId, accion, userId, userEmail,
          antes   ? JSON.stringify(antes)   : null,
          despues ? JSON.stringify(despues) : null] },
    );
  } catch { /* silencioso */ }
}

// Parsea "YYYY-MM-DD" (o ISO) como día calendario en UTC, sin corrimiento por zona horaria.
function toUtcDay(v: string): number {
  const s = String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(v).getTime();
}

function calcDias(desde?: string | null, hasta?: string | null): number | null {
  if (!desde || !hasta) return null;
  const d1 = toUtcDay(desde);
  const d2 = toUtcDay(hasta);
  if (isNaN(d1) || isNaN(d2) || d2 < d1) return null;
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
}

export function buildTareasLivianasRouter(sequelize: Sequelize) {
  const router = Router();

  // ── Crear tablas si no existen ────────────────────────────────────────────
  (async () => {
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS tareas_livianas (
          id                   INT AUTO_INCREMENT PRIMARY KEY,
          agente_dni           VARCHAR(20)  NOT NULL,
          agente_nombre        VARCHAR(200) NULL,
          servicio             VARCHAR(200) NULL,
          turno                VARCHAR(30)  NULL,
          fecha_desde          DATE         NOT NULL,
          fecha_hasta          DATE         NULL,
          cantidad_dias        INT          NULL,
          junta_medica_doc_id  INT          NULL,
          observaciones        TEXT         NULL,
          activo               TINYINT(1)   NOT NULL DEFAULT 1,
          creado_por_id        INT          NULL,
          creado_por_email     VARCHAR(200) NULL,
          creado_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          modificado_por_id    INT          NULL,
          modificado_por_email VARCHAR(200) NULL,
          modificado_at        DATETIME     NULL,
          eliminado_por_id     INT          NULL,
          eliminado_por_email  VARCHAR(200) NULL,
          eliminado_at         DATETIME     NULL,
          INDEX idx_tl_dni (agente_dni),
          INDEX idx_tl_fechas (fecha_desde, fecha_hasta)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS tareas_livianas_auditoria (
          id            INT AUTO_INCREMENT PRIMARY KEY,
          registro_id   INT          NOT NULL,
          accion        VARCHAR(50)  NOT NULL,
          usuario_id    INT          NULL,
          usuario_email VARCHAR(200) NULL,
          datos_antes   TEXT         NULL,
          datos_despues TEXT         NULL,
          created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (e: any) {
      logger.error({ msg: 'tareas_livianas: error creando tablas', error: e?.message });
    }
  })();

  // ── GET /junta-medica/:dni ────────────────────────────────────────────────
  // Detecta las juntas médicas ya cargadas del agente (flujo Resoluciones → G:\varios).
  router.get('/junta-medica/:dni', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canVer) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const dni = String(req.params.dni || '').replace(/\D/g, '');
    if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
    try {
      const rows = await sequelize.query<any>(
        `SELECT id, nombre, tipo, ruta, fecha, created_at
           FROM tblarchivos
          WHERE dni = ? AND deleted_at IS NULL
            AND (tipo LIKE '%junta%' OR nombre LIKE '%junta%' OR tipo LIKE '%dictamen%')
          ORDER BY created_at DESC
          LIMIT 50`,
        { type: QueryTypes.SELECT, replacements: [dni] },
      );
      return res.json({ ok: true, data: rows });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET /mi-sector ────────────────────────────────────────────────────────
  // Portal del jefe: SOLO las tareas de los agentes con pase abierto en el servicio del
  // usuario logueado (usuarios.servicio_id). El filtro se hace acá, no en el navegador,
  // así un jefe no puede pedir las de otro servicio. Admin ve todas (o ?servicio_id=).
  // ?vigentes=1 → solo las que siguen corriendo hoy (sin hasta o hasta >= hoy).
  router.get('/mi-sector', requirePermission('api:access'), async (req: Request, res: Response) => {
    const auth = (req as any).auth ?? {};
    const perms: string[] = auth.permissions ?? [];
    const esAdmin = perms.includes('crud:*:*');
    if (!esAdmin && !perms.includes('app:jefe_servicio:access')) {
      return res.status(403).json({ ok: false, error: 'Sin permiso' });
    }
    try {
      let servicioId: number | null = null;
      if (esAdmin && req.query.servicio_id) servicioId = Number(req.query.servicio_id) || null;
      if (!esAdmin) {
        if (auth.principalType !== 'user' || !auth.principalId) {
          return res.status(403).json({ ok: false, error: 'Sin usuario' });
        }
        const [usr] = await sequelize.query<any>(
          `SELECT servicio_id FROM usuarios WHERE id = ? AND deleted_at IS NULL`,
          { type: QueryTypes.SELECT, replacements: [auth.principalId] },
        );
        servicioId = usr?.servicio_id != null ? Number(usr.servicio_id) : null;
        if (servicioId == null) {
          return res.status(403).json({ ok: false, error: 'Tu usuario no tiene un servicio asignado' });
        }
      }

      const conds: string[] = ['t.activo = 1'];
      const vals: any[] = [];
      if (String(req.query.vigentes || '') === '1') {
        conds.push('(t.fecha_hasta IS NULL OR t.fecha_hasta >= CURDATE())');
      }
      if (servicioId != null) {
        // Mismo criterio que el portal: pase abierto con ese servicio_id, o pase histórico
        // sin servicio_id cuyo nombre coincide con el del servicio.
        // Comparación numérica: CAST(ags.dni AS CHAR) toma la collation de la conexión
        // (utf8mb4_unicode_ci) y chocaba con agente_dni (0900_ai_ci) → 500 "Illegal mix of collations".
        conds.push(`CAST(t.agente_dni AS UNSIGNED) IN (
          SELECT ags.dni
            FROM agentes_servicios ags
            JOIN servicios srv ON srv.id = ?
           WHERE ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
             AND (ags.servicio_id = srv.id
                  OR (ags.servicio_id IS NULL AND TRIM(ags.nombre) = TRIM(srv.nombre))))`);
        vals.push(servicioId);
      }
      const rows = await sequelize.query<any>(
        `SELECT t.id, t.agente_dni, t.agente_nombre, t.servicio, t.turno,
                t.fecha_desde, t.fecha_hasta, t.cantidad_dias, t.junta_medica_doc_id,
                t.observaciones, t.creado_at,
                -- dictamen: el vinculado a la tarea, si no la última junta registrada (mig 133) y,
                -- si tampoco, la última junta escaneada del agente
                COALESCE(t.junta_medica_doc_id, (
                  SELECT j.archivo_id FROM juntas_medicas j
                   WHERE j.dni = t.agente_dni AND j.activo = 1 AND j.archivo_id IS NOT NULL
                   ORDER BY COALESCE(j.fecha_junta, DATE(j.creado_at)) DESC, j.id DESC LIMIT 1), (
                  SELECT a.id FROM tblarchivos a
                   WHERE a.dni = t.agente_dni AND a.deleted_at IS NULL
                     AND (a.tipo LIKE '%junta%' OR a.nombre LIKE '%junta%' OR a.tipo LIKE '%dictamen%')
                   ORDER BY a.created_at DESC LIMIT 1)) AS junta_doc_id
           FROM tareas_livianas t
          WHERE ${conds.join(' AND ')}
          ORDER BY (t.fecha_hasta IS NULL OR t.fecha_hasta >= CURDATE()) DESC,
                   t.fecha_desde DESC, t.id DESC`,
        { type: QueryTypes.SELECT, replacements: vals },
      );
      return res.json({ ok: true, servicio_id: servicioId, data: rows });
    } catch (e: any) {
      logger.error({ msg: 'tareas_livianas mi-sector', error: e?.message });
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET /informe ──────────────────────────────────────────────────────────
  // Agrupa las tareas vigentes (o filtradas) por servicio y turno.
  router.get('/informe', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canVer) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    try {
      const { desde, hasta, servicio, turno } = req.query as any;
      const conds: string[] = ['activo = 1'];
      const vals: any[] = [];
      if (desde)    { conds.push('fecha_desde >= ?'); vals.push(desde); }
      if (hasta)    { conds.push('(fecha_hasta IS NULL OR fecha_hasta <= ?)'); vals.push(hasta); }
      if (servicio) { conds.push('servicio LIKE ?'); vals.push(`%${servicio}%`); }
      if (turno)    { conds.push('turno = ?'); vals.push(turno); }
      const rows = await sequelize.query<any>(
        `SELECT * FROM tareas_livianas WHERE ${conds.join(' AND ')} ORDER BY servicio, turno, agente_nombre`,
        { type: QueryTypes.SELECT, replacements: vals },
      );
      // Agrupar servicio → turno → agentes
      const grupos: Record<string, Record<string, any[]>> = {};
      for (const r of rows) {
        const s = r.servicio || '(sin servicio)';
        const t = r.turno || '(sin turno)';
        (grupos[s] ??= {});
        (grupos[s][t] ??= []).push(r);
      }
      const resumen = Object.entries(grupos).map(([servicio, turnos]) => ({
        servicio,
        total: Object.values(turnos).reduce((a, arr) => a + arr.length, 0),
        turnos: Object.entries(turnos).map(([turno, agentes]) => ({ turno, total: agentes.length, agentes })),
      }));
      return res.json({ ok: true, total: rows.length, resumen, data: rows });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET / ─────────────────────────────────────────────────────────────────
  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canVer) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    try {
      const { desde, hasta, servicio, turno, dni } = req.query as any;
      const conds: string[] = ['activo = 1'];
      const vals: any[] = [];
      if (dni)      { conds.push('agente_dni = ?'); vals.push(String(dni).replace(/\D/g, '')); }
      if (desde)    { conds.push('fecha_desde >= ?'); vals.push(desde); }
      if (hasta)    { conds.push('(fecha_hasta IS NULL OR fecha_hasta <= ?)'); vals.push(hasta); }
      if (servicio) { conds.push('servicio LIKE ?'); vals.push(`%${servicio}%`); }
      if (turno)    { conds.push('turno = ?'); vals.push(turno); }
      const rows = await sequelize.query<any>(
        `SELECT *, TIMESTAMPDIFF(HOUR, creado_at, NOW()) AS horas_desde_carga,
                -- última junta registrada del agente (mig 133): el 📄 la muestra si la tarea no tiene una vinculada
                (SELECT j.archivo_id FROM juntas_medicas j
                  WHERE j.dni = tareas_livianas.agente_dni AND j.activo = 1 AND j.archivo_id IS NOT NULL
                  ORDER BY COALESCE(j.fecha_junta, DATE(j.creado_at)) DESC, j.id DESC LIMIT 1) AS junta_registrada_doc_id
           FROM tareas_livianas WHERE ${conds.join(' AND ')}
          ORDER BY fecha_desde DESC, id DESC`,
        { type: QueryTypes.SELECT, replacements: vals },
      );
      return res.json({ ok: true, data: rows });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── POST / ──────────────────────────────────────────────────────────────
  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canCrear) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const {
      agente_dni, agente_nombre, servicio, turno,
      fecha_desde, fecha_hasta, junta_medica_doc_id, observaciones,
    } = req.body ?? {};
    const dni = String(agente_dni || '').replace(/\D/g, '');
    if (!dni) return res.status(400).json({ ok: false, error: 'Agente (DNI) requerido' });
    if (!fecha_desde) return res.status(400).json({ ok: false, error: 'Fecha desde requerida' });
    try {
      const email = await getUserEmail(sequelize, u.id);
      const dias = calcDias(fecha_desde, fecha_hasta);
      const [result] = await sequelize.query(
        `INSERT INTO tareas_livianas
           (agente_dni, agente_nombre, servicio, turno, fecha_desde, fecha_hasta,
            cantidad_dias, junta_medica_doc_id, observaciones, creado_por_id, creado_por_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [dni, agente_nombre || null, servicio || null, turno || null,
            fecha_desde, fecha_hasta || null, dias, junta_medica_doc_id || null,
            observaciones || null, u.id, email] },
      ) as any;
      const newId = result?.insertId ?? result;
      const [created] = await sequelize.query<any>(
        `SELECT * FROM tareas_livianas WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [newId] },
      );
      await logAudit(sequelize, newId, 'crear', u.id, email, null, created);
      return res.json({ ok: true, data: created });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── PUT /:id ────────────────────────────────────────────────────────────────
  router.put('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canEditar) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const id = Number(req.params.id);
    const {
      agente_dni, agente_nombre, servicio, turno,
      fecha_desde, fecha_hasta, junta_medica_doc_id, observaciones,
    } = req.body ?? {};
    const dni = String(agente_dni || '').replace(/\D/g, '');
    if (!dni) return res.status(400).json({ ok: false, error: 'Agente (DNI) requerido' });
    if (!fecha_desde) return res.status(400).json({ ok: false, error: 'Fecha desde requerida' });
    try {
      const [antes] = await sequelize.query<any>(
        `SELECT *, TIMESTAMPDIFF(HOUR, creado_at, NOW()) AS horas_desde_carga
           FROM tareas_livianas WHERE id = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      // No-admin: solo puede editar dentro de las 24hs de cargado
      if (!u.isAdmin && Number(antes.horas_desde_carga) > 24) {
        return res.status(403).json({ ok: false, error: 'Solo editable dentro de las 24hs de cargado' });
      }
      const email = await getUserEmail(sequelize, u.id);
      const dias = calcDias(fecha_desde, fecha_hasta);
      await sequelize.query(
        `UPDATE tareas_livianas SET
           agente_dni=?, agente_nombre=?, servicio=?, turno=?, fecha_desde=?, fecha_hasta=?,
           cantidad_dias=?, junta_medica_doc_id=?, observaciones=?,
           modificado_por_id=?, modificado_por_email=?, modificado_at=NOW()
         WHERE id=?`,
        { replacements: [dni, agente_nombre || null, servicio || null, turno || null,
            fecha_desde, fecha_hasta || null, dias, junta_medica_doc_id || null,
            observaciones || null, u.id, email, id] },
      );
      const [despues] = await sequelize.query<any>(
        `SELECT * FROM tareas_livianas WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      await logAudit(sequelize, id, 'modificar', u.id, email, antes, despues);
      return res.json({ ok: true, data: despues });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── DELETE /:id (admin) ─────────────────────────────────────────────────────
  router.delete('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo admin' });
    const id = Number(req.params.id);
    try {
      const [antes] = await sequelize.query<any>(
        `SELECT * FROM tareas_livianas WHERE id = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const email = await getUserEmail(sequelize, u.id);
      await sequelize.query(
        `UPDATE tareas_livianas SET activo=0, eliminado_por_id=?, eliminado_por_email=?, eliminado_at=NOW() WHERE id=?`,
        { replacements: [u.id, email, id] },
      );
      await logAudit(sequelize, id, 'eliminar', u.id, email, antes, null);
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
