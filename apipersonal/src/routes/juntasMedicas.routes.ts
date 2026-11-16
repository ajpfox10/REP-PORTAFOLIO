// src/routes/juntasMedicas.routes.ts
// Juntas médicas hechas (Salud Laboral → pestaña ⚖️ Juntas médicas). Mig 133.
// Cada junta: agente, fecha de la junta, resultado, desde/hasta (días calculados), observaciones
// y el escaneo vinculado (archivo_id → tblarchivos). El PDF se abre con GET /documents/:id/file
// (documentsAccess.ts deja pasar estos archivos a Salud Laboral y al jefe del servicio del agente).
// Acceso: mismos permisos que tareas livianas (crud:tareas_livianas:* o comodín). Borrar: solo admin.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission, can } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

/** Escaneos que "parecen" junta médica (mismo criterio que /tareas-livianas/junta-medica). */
export const SQL_ES_JUNTA = `(a.tipo LIKE '%junta%' OR a.nombre LIKE '%junta%' OR a.tipo LIKE '%dictamen%')`;

/** Servicio actual del agente (pase abierto). Recibe la expresión del DNI. */
const sqlServicioActual = (dniExpr: string) => `(
  SELECT COALESCE(srv.nombre, ags.nombre) FROM agentes_servicios ags
    LEFT JOIN servicios srv ON srv.id = ags.servicio_id
   WHERE ags.dni = ${dniExpr} AND ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
   ORDER BY ags.fecha_desde DESC, ags.id DESC LIMIT 1)`;

function getUser(req: Request) {
  const auth = (req as any).auth ?? {};
  const perms: string[] = auth.permissions ?? [];
  return {
    id: auth.principalType === 'user' || auth.principalType === 'dev' ? (auth.principalId ?? null) : null,
    principalType: auth.principalType,
    perms,
    isAdmin: perms.includes('crud:*:*'),
    canVer: can(perms, 'tareas_livianas', 'read'),
    canCrear: can(perms, 'tareas_livianas', 'create'),
    canEditar: can(perms, 'tareas_livianas', 'update'),
  };
}

function toUtcDay(v: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).slice(0, 10));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}
function calcDias(desde?: string | null, hasta?: string | null): number | null {
  if (!desde || !hasta) return null;
  const d1 = toUtcDay(desde), d2 = toUtcDay(hasta);
  if (isNaN(d1) || isNaN(d2) || d2 < d1) return null;
  return Math.round((d2 - d1) / 86_400_000) + 1;
}
const fechaOk = (v: any) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null);

export function buildJuntasMedicasRouter(sequelize: Sequelize) {
  const router = Router();

  (async () => {
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS juntas_medicas (
          id INT AUTO_INCREMENT PRIMARY KEY,
          dni VARCHAR(20) NOT NULL, agente_nombre VARCHAR(200) NULL, servicio VARCHAR(200) NULL,
          fecha_junta DATE NULL, resultado VARCHAR(40) NULL, fecha_desde DATE NULL, fecha_hasta DATE NULL,
          cantidad_dias INT NULL, observaciones TEXT NULL, archivo_id INT NULL,
          activo TINYINT(1) NOT NULL DEFAULT 1,
          creado_por_id INT NULL, creado_por_email VARCHAR(200) NULL, creado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          modificado_por_id INT NULL, modificado_por_email VARCHAR(200) NULL, modificado_at DATETIME NULL,
          eliminado_por_id INT NULL, eliminado_por_email VARCHAR(200) NULL, eliminado_at DATETIME NULL,
          INDEX idx_jm_dni (dni), INDEX idx_jm_fecha (fecha_junta), INDEX idx_jm_archivo (archivo_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS juntas_medicas_descartes (
          archivo_id INT NOT NULL PRIMARY KEY, usuario_id INT NULL, usuario_email VARCHAR(200) NULL,
          at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch (e: any) {
      logger.error({ msg: 'juntas_medicas: error creando tablas', error: e?.message });
    }
  })();

  async function emailDe(id: number | null): Promise<string | null> {
    if (!id) return null;
    try {
      const [r] = await sequelize.query<any>(`SELECT email FROM usuarios WHERE id = ? LIMIT 1`, { type: QueryTypes.SELECT, replacements: [id] });
      return r?.email ?? null;
    } catch { return null; }
  }

  /** Servicio del jefe logueado (null = admin sin filtro). Lanza 'SIN_PERMISO' / 'SIN_SERVICIO'. */
  async function servicioDelJefe(req: Request): Promise<number | null> {
    const u = getUser(req);
    if (u.isAdmin) return req.query.servicio_id ? Number(req.query.servicio_id) || null : null;
    if (!u.perms.includes('app:jefe_servicio:access') || u.principalType !== 'user' || !u.id) throw new Error('SIN_PERMISO');
    const [usr] = await sequelize.query<any>(`SELECT servicio_id FROM usuarios WHERE id = ? AND deleted_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: [u.id] });
    if (usr?.servicio_id == null) throw new Error('SIN_SERVICIO');
    return Number(usr.servicio_id);
  }

  const SELECT_JUNTA = `
    SELECT j.id, j.dni, COALESCE(j.agente_nombre, CONCAT(p.apellido, ', ', p.nombre)) AS agente_nombre,
           j.servicio, ${sqlServicioActual('j.dni')} AS servicio_actual,
           j.fecha_junta, j.resultado, j.fecha_desde, j.fecha_hasta, j.cantidad_dias, j.observaciones,
           j.archivo_id, a.nombre AS archivo_nombre,
           j.creado_por_email, j.creado_at, j.modificado_por_email, j.modificado_at
      FROM juntas_medicas j
      LEFT JOIN personal p ON p.dni = j.dni AND p.deleted_at IS NULL
      LEFT JOIN tblarchivos a ON a.id = j.archivo_id AND a.deleted_at IS NULL`;

  // ── GET / ── todas las juntas activas (filtros y export en el front)
  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!getUser(req).canVer) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    try {
      const rows = await sequelize.query<any>(
        `${SELECT_JUNTA} WHERE j.activo = 1 ORDER BY COALESCE(j.fecha_junta, DATE(j.creado_at)) DESC, j.id DESC`,
        { type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows });
    } catch (e: any) {
      logger.error({ msg: 'juntas_medicas list', error: e?.message });
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET /sin-registrar ── escaneos con pinta de junta que todavía no son una junta ni se descartaron
  router.get('/sin-registrar', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!getUser(req).canVer) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    try {
      const rows = await sequelize.query<any>(
        `SELECT a.id AS archivo_id, a.dni, a.nombre, a.tipo, a.fecha, a.created_at,
                CONCAT(p.apellido, ', ', p.nombre) AS agente_nombre, ${sqlServicioActual('a.dni')} AS servicio_actual
           FROM tblarchivos a
           LEFT JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
          WHERE a.deleted_at IS NULL AND a.dni > 1000 AND ${SQL_ES_JUNTA}
            AND a.id NOT IN (SELECT archivo_id FROM juntas_medicas WHERE activo = 1 AND archivo_id IS NOT NULL)
            AND a.id NOT IN (SELECT archivo_id FROM juntas_medicas_descartes)
          ORDER BY COALESCE(a.fecha, a.created_at) DESC`,
        { type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET /por-dni/:dni ── juntas del agente + todos sus escaneos de junta (para vincular / ver)
  router.get('/por-dni/:dni', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!getUser(req).canVer) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const dni = String(req.params.dni || '').replace(/\D/g, '');
    if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
    try {
      const juntas = await sequelize.query<any>(
        `${SELECT_JUNTA} WHERE j.activo = 1 AND j.dni = ? ORDER BY COALESCE(j.fecha_junta, DATE(j.creado_at)) DESC, j.id DESC`,
        { type: QueryTypes.SELECT, replacements: [dni] });
      const escaneos = await sequelize.query<any>(
        `SELECT a.id, a.nombre, a.tipo, a.fecha, a.created_at,
                (SELECT 1 FROM juntas_medicas_descartes d WHERE d.archivo_id = a.id) AS descartado
           FROM tblarchivos a
          WHERE a.dni = ? AND a.deleted_at IS NULL
            AND (${SQL_ES_JUNTA} OR a.id IN (SELECT archivo_id FROM juntas_medicas WHERE activo = 1 AND dni = ?))
          ORDER BY a.created_at DESC LIMIT 50`,
        { type: QueryTypes.SELECT, replacements: [dni, dni] });
      return res.json({ ok: true, juntas, escaneos });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET /mi-sector ── portal del jefe: juntas de los agentes con pase abierto en SU servicio
  router.get('/mi-sector', requirePermission('api:access'), async (req: Request, res: Response) => {
    let servicioId: number | null;
    try { servicioId = await servicioDelJefe(req); }
    catch (e: any) {
      return res.status(403).json({ ok: false, error: e?.message === 'SIN_SERVICIO' ? 'Tu usuario no tiene un servicio asignado' : 'Sin permiso' });
    }
    try {
      const conds = ['j.activo = 1'];
      const vals: any[] = [];
      if (servicioId != null) {
        // Comparación numérica (ags.dni es INT): con CAST(... AS CHAR) choca la collation de la conexión
        conds.push(`CAST(j.dni AS UNSIGNED) IN (
          SELECT ags.dni FROM agentes_servicios ags JOIN servicios srv ON srv.id = ?
           WHERE ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
             AND (ags.servicio_id = srv.id OR (ags.servicio_id IS NULL AND TRIM(ags.nombre) = TRIM(srv.nombre))))`);
        vals.push(servicioId);
      }
      const rows = await sequelize.query<any>(
        `${SELECT_JUNTA} WHERE ${conds.join(' AND ')} ORDER BY COALESCE(j.fecha_junta, DATE(j.creado_at)) DESC, j.id DESC`,
        { type: QueryTypes.SELECT, replacements: vals });
      return res.json({ ok: true, servicio_id: servicioId, data: rows });
    } catch (e: any) {
      logger.error({ msg: 'juntas_medicas mi-sector', error: e?.message });
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  function leerBody(b: any) {
    const fecha_desde = fechaOk(b?.fecha_desde);
    const fecha_hasta = fechaOk(b?.fecha_hasta);
    return {
      dni: String(b?.dni ?? '').replace(/\D/g, ''),
      agente_nombre: b?.agente_nombre ? String(b.agente_nombre).slice(0, 200) : null,
      servicio: b?.servicio ? String(b.servicio).slice(0, 200) : null,
      fecha_junta: fechaOk(b?.fecha_junta),
      resultado: b?.resultado ? String(b.resultado).slice(0, 40) : null,
      fecha_desde, fecha_hasta,
      cantidad_dias: calcDias(fecha_desde, fecha_hasta),
      observaciones: b?.observaciones ? String(b.observaciones) : null,
      archivo_id: Number(b?.archivo_id) > 0 ? Number(b.archivo_id) : null,
    };
  }

  // ── POST / ──
  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canCrear) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const d = leerBody(req.body);
    if (!d.dni) return res.status(400).json({ ok: false, error: 'Falta el DNI' });
    if (!d.fecha_junta && !d.archivo_id) return res.status(400).json({ ok: false, error: 'Poné la fecha de la junta o vinculá el escaneo' });
    if (d.fecha_desde && d.fecha_hasta && d.cantidad_dias == null) return res.status(400).json({ ok: false, error: 'La fecha hasta es anterior a la fecha desde' });
    try {
      const email = await emailDe(u.id);
      const [id] = await sequelize.query(
        `INSERT INTO juntas_medicas (dni, agente_nombre, servicio, fecha_junta, resultado, fecha_desde, fecha_hasta,
            cantidad_dias, observaciones, archivo_id, creado_por_id, creado_por_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [d.dni, d.agente_nombre, d.servicio, d.fecha_junta, d.resultado, d.fecha_desde, d.fecha_hasta,
            d.cantidad_dias, d.observaciones, d.archivo_id, u.id, email] });
      return res.json({ ok: true, id });
    } catch (e: any) {
      logger.error({ msg: 'juntas_medicas create', error: e?.message });
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── PUT /:id ──
  router.put('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canEditar) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const id = Number(req.params.id);
    const d = leerBody(req.body);
    if (!d.dni) return res.status(400).json({ ok: false, error: 'Falta el DNI' });
    if (d.fecha_desde && d.fecha_hasta && d.cantidad_dias == null) return res.status(400).json({ ok: false, error: 'La fecha hasta es anterior a la fecha desde' });
    try {
      const email = await emailDe(u.id);
      await sequelize.query(
        `UPDATE juntas_medicas SET dni=?, agente_nombre=?, servicio=?, fecha_junta=?, resultado=?, fecha_desde=?, fecha_hasta=?,
            cantidad_dias=?, observaciones=?, archivo_id=?, modificado_por_id=?, modificado_por_email=?, modificado_at=NOW()
          WHERE id = ? AND activo = 1`,
        { replacements: [d.dni, d.agente_nombre, d.servicio, d.fecha_junta, d.resultado, d.fecha_desde, d.fecha_hasta,
            d.cantidad_dias, d.observaciones, d.archivo_id, u.id, email, id] });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── DELETE /:id ── baja lógica, solo admin
  router.delete('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo un administrador puede borrar juntas' });
    try {
      const email = await emailDe(u.id);
      await sequelize.query(
        `UPDATE juntas_medicas SET activo = 0, eliminado_por_id = ?, eliminado_por_email = ?, eliminado_at = NOW() WHERE id = ?`,
        { replacements: [u.id, email, Number(req.params.id)] });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── POST /descartar ── { archivo_id }: "no es una junta" (no vuelve a aparecer como sin registrar)
  router.post('/descartar', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canCrear) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const archivoId = Number(req.body?.archivo_id);
    if (!(archivoId > 0)) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
    try {
      const email = await emailDe(u.id);
      await sequelize.query(
        `INSERT IGNORE INTO juntas_medicas_descartes (archivo_id, usuario_id, usuario_email) VALUES (?, ?, ?)`,
        { replacements: [archivoId, u.id, email] });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── DELETE /descartar/:archivo_id ── deshacer el descarte
  router.delete('/descartar/:archivoId', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canCrear) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    try {
      await sequelize.query(`DELETE FROM juntas_medicas_descartes WHERE archivo_id = ?`, { replacements: [Number(req.params.archivoId)] });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
