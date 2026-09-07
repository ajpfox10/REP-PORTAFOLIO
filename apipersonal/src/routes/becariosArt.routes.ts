// src/routes/becariosArt.routes.ts
// Registro de agentes becarios dados de alta en ART.
//
// Endpoints:
//   GET    /becarios-art/candidatos  Agentes becarios activos no registrados aún
//   GET    /becarios-art             Lista registrados con datos de personal, agentes y dirección
//   GET    /becarios-art/:dni        Detalle de un becario
//   POST   /becarios-art             Alta (body: { dni, pagina })
//   PATCH  /becarios-art/:dni        Actualizar pagina
//   DELETE /becarios-art/:dni        Baja lógica (soft delete)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes }      from 'sequelize';
import { z }                          from 'zod';
import { requirePermission }          from '../middlewares/rbacCrud';
import { logger }                     from '../logging/logger';
import { trackAction }                from '../logging/track';
import { getDireccion, DireccionIntranet } from '../files/direccionesIntranet';

const createSchema = z.object({
  dni:    z.number().int().positive(),
  pagina: z.string().max(50).trim().optional().default(''),
});

const patchSchema = z.object({
  pagina: z.string().min(1).max(50).trim(),
});

const BECARIOS_LEY_IDS = [6, 7, 8, 9, 10, 11, 12, 13];

function enriquecerConDireccion<T extends { dni?: number }>(row: T): T & { direccion: ReturnType<typeof getDireccion> } {
  return { ...row, direccion: row.dni ? getDireccion(row.dni) : null };
}

export function buildBecariosArtRouter(sequelize: Sequelize) {
  const router = Router();

  // ── GET /candidatos — becarios activos sin registrar ─────────────────────
  // DEBE ir antes de /:dni para que no confunda "candidatos" con un DNI
  router.get('/candidatos', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<Record<string, any>>(`
        SELECT
          p.dni, p.apellido, p.nombre, p.cuil, p.telefono,
          DATE_FORMAT(p.fecha_nacimiento, '%d/%m/%Y') AS fecha_nacimiento,
          a.legajo, l.nombre AS ley_nombre,
          COALESCE(rep.reparticion_nombre, dep.nombre) AS establecimiento,
          -- Dirección desde la tabla personal (fuente real que usa el script de ART)
          p.domicilio, p.numerodomicilio, p.cp, p.localidad_id,
          loc.localidad_nombre, loc.provincia_nombre,
          -- Estado de la cola de alta automática en ART
          q.status        AS art_status,
          q.last_error    AS art_error,
          q.resultado_art AS art_resultado,
          q.attempts      AS art_attempts,
          q.finished_at   AS art_finished_at
        FROM personal p
        JOIN agentes a   ON a.dni = p.dni AND a.deleted_at IS NULL
        JOIN ley l       ON l.id  = a.ley_id
        LEFT JOIN localidades loc ON loc.id = p.localidad_id
        LEFT JOIN art_alta_queue q ON q.id = (
          SELECT MAX(q2.id) FROM art_alta_queue q2 WHERE q2.dni = p.dni
        )
        LEFT JOIN (
          SELECT s1.dni, s1.servicio_id
          FROM agentes_servicios s1
          JOIN (
            SELECT dni, MAX(id) AS id
            FROM agentes_servicios
            WHERE deleted_at IS NULL
              AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
            GROUP BY dni
          ) ult ON ult.id = s1.id
        ) ags ON ags.dni = p.dni
        LEFT JOIN servicios srv      ON srv.id  = ags.servicio_id   AND srv.deleted_at IS NULL
        LEFT JOIN reparticiones rep  ON rep.id  = srv.reparticion_id AND rep.deleted_at IS NULL
        LEFT JOIN dependencias  dep  ON dep.id  = rep.dependencia_id AND dep.deleted_at IS NULL
        WHERE a.estado_empleo = 'ACTIVO'
          AND p.deleted_at IS NULL
          AND a.ley_id IN (:becariosLeyIds)
          AND NOT EXISTS (
            SELECT 1 FROM becarios_art b
            WHERE b.dni = p.dni AND b.deleted_at IS NULL
          )
        ORDER BY p.apellido ASC, p.nombre ASC
      `, { replacements: { becariosLeyIds: BECARIOS_LEY_IDS }, type: QueryTypes.SELECT });

      const data = rows.map((r: any) => {
        const dir = getDireccion(Number(r.dni)); // fallback: Excel Direcciones Intranet
        const norm = (v: any) => (v == null ? '' : String(v).trim());

        // Dirección con prioridad tabla personal → fallback Excel (igual que el script de ART).
        const calle     = norm(r.domicilio)        || norm(dir?.calle);
        const numero     = norm(r.numerodomicilio) || norm(dir?.numero);
        const localidad = norm(r.localidad_nombre) || norm(dir?.localidad);
        const provincia = norm(r.provincia_nombre);
        const cp         = norm(r.cp)              || norm(dir?.codigo_postal);

        const partes: string[] = [];
        if (calle)     partes.push(calle + (numero ? ' ' + numero : ''));
        if (localidad) partes.push(localidad + (cp ? ' (' + cp + ')' : ''));
        const direccion = partes.join(', ') || null;

        // ¿Está lista la dirección para ART? (lo que el alta necesita sí o sí)
        const faltan: string[] = [];
        if (!calle)                     faltan.push('calle');
        if (!numero)                    faltan.push('número');
        if (!localidad && !provincia)   faltan.push('localidad');
        if (!cp)                        faltan.push('CP');

        // Fuente efectiva de la dirección: personal si hay dato propio, si no Excel.
        const fuente = (norm(r.domicilio) || r.localidad_id) ? 'personal' : (dir ? 'excel' : null);

        return {
          ...r,
          direccion,
          art_listo: faltan.length === 0,
          art_faltan: faltan,
          art_fuente_direccion: fuente,
        };
      });
      return res.json({ ok: true, data, total: data.length });
    } catch (err: any) {
      logger.error({ msg: '[becariosArt] candidatos error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al obtener candidatos' });
    }
  });

  // ── GET /errores — errores de la carga automática ART (tabla becarios_art_errores) ─
  // DEBE ir antes de /:dni. La tabla la crea el script de carga; si no existe, devolvemos vacío.
  router.get('/errores', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<Record<string, any>>(`
        SELECT
          e.dni, e.motivo, e.detalle, e.screenshot, e.lote, e.updated_at,
          p.apellido, p.nombre, p.cuil, a.legajo, l.nombre AS ley_nombre
        FROM becarios_art_errores e
        LEFT JOIN personal p ON p.dni = e.dni AND p.deleted_at IS NULL
        LEFT JOIN agentes  a ON a.dni = e.dni AND a.deleted_at IS NULL
        LEFT JOIN ley      l ON l.id  = a.ley_id
        ORDER BY e.updated_at DESC
      `, { type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows, total: rows.length });
    } catch (err: any) {
      if (err?.parent?.code === 'ER_NO_SUCH_TABLE' || /ER_NO_SUCH_TABLE|doesn't exist/i.test(err?.message || '')) {
        return res.json({ ok: true, data: [], total: 0 });
      }
      logger.error({ msg: '[becariosArt] errores list error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al listar errores ART' });
    }
  });

  // ── DELETE /errores/:dni — marcar error como resuelto (lo quita de la lista) ──
  router.delete('/errores/:dni', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      await sequelize.query('DELETE FROM becarios_art_errores WHERE dni = :dni', { replacements: { dni } });
      return res.json({ ok: true });
    } catch (err: any) {
      if (err?.parent?.code === 'ER_NO_SUCH_TABLE' || /ER_NO_SUCH_TABLE|doesn't exist/i.test(err?.message || '')) {
        return res.json({ ok: true });
      }
      logger.error({ msg: '[becariosArt] errores delete error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al resolver error ART' });
    }
  });

  // ── POST /errores/:dni/reintentar — encola el alta ART para ese DNI ──
  // NO corre el navegador aca: bajo pm2 seria headless (sin escritorio) y el menu de ART
  // falla ("element is not visible"). En su lugar dejamos el item PENDING en art_alta_queue;
  // lo procesa el worker de escritorio (scripts/artAltaWorker.mjs) con Chrome VISIBLE.
  // El script, al completar el alta OK, borra la fila de becarios_art_errores.
  router.post('/errores/:dni/reintentar', requirePermission('api:access'), async (req: Request, res: Response) => {
    const dni = parseInt(req.params.dni, 10);
    if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });

    try {
      // 1) Verificar que el agente existe (NO usar affectedRows del upsert para esto: con
      //    ON DUPLICATE KEY UPDATE, si la fila de la cola ya existía y queda igual, MySQL
      //    devuelve affectedRows=0 aunque el agente exista → falso "no encontré agente").
      const agentes = await sequelize.query<{ id: number; dni: number; fecha_ingreso: any; estado_empleo: any }>(
        `SELECT id, dni, fecha_ingreso, estado_empleo FROM agentes WHERE dni = :dni LIMIT 1`,
        { replacements: { dni }, type: QueryTypes.SELECT }
      );
      if (!agentes.length) {
        return res.json({ ok: false, error: 'No encontré un agente con ese DNI para encolar' });
      }
      const ag = agentes[0];

      // 2) Encolar / resetear a PENDING (UNIQUE KEY en agente_id → si ya existe, la reusa).
      await sequelize.query(
        `INSERT INTO art_alta_queue
           (agente_id, dni, fecha_ingreso_db, estado_empleo, status, attempts, created_at, updated_at)
         VALUES (:id, :dni, :fi, :ee, 'PENDING', 0, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status='PENDING', attempts=0, locked_at=NULL, last_error=NULL,
           resultado_art=NULL, updated_at=NOW()`,
        { replacements: { id: ag.id, dni: ag.dni, fi: ag.fecha_ingreso ?? null, ee: ag.estado_empleo ?? null } }
      );
      trackAction('becario_art_reintento_encolado', { dni });
      return res.json({ ok: true, queued: true });
    } catch (err: any) {
      logger.error({ msg: '[becariosArt] reintento encolar error', dni, err: err?.message });
      return res.json({ ok: false, error: (err?.message || 'No se pudo encolar').slice(0, 400) });
    }
  });

  // ── GET /cola — estado de la cola de alta automática (art_alta_queue) ──────
  // Fuente de verdad de la carga desatendida: acá se ve el error REAL de cada agente
  // (incluye crashes del script que NO llegan a becarios_art_errores, p.ej. SQL rotos).
  // DEBE ir antes de /:dni. Si la tabla no existe todavía, devolvemos vacío.
  router.get('/cola', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      const resumenRows = await sequelize.query<{ status: string; cant: number }>(
        `SELECT status, COUNT(*) AS cant FROM art_alta_queue GROUP BY status`,
        { type: QueryTypes.SELECT }
      );
      const resumen: Record<string, number> = {};
      for (const r of resumenRows) resumen[r.status] = Number(r.cant);

      // Filas que requieren atención (todo lo que no está DONE), error primero.
      const rows = await sequelize.query<Record<string, any>>(`
        SELECT
          q.id, q.dni, q.status, q.attempts, q.last_error, q.resultado_art,
          q.created_at, q.updated_at, q.started_at, q.finished_at,
          p.apellido, p.nombre, a.legajo, l.nombre AS ley_nombre
        FROM art_alta_queue q
        LEFT JOIN personal p ON p.dni = q.dni AND p.deleted_at IS NULL
        LEFT JOIN agentes  a ON a.id  = q.agente_id
        LEFT JOIN ley      l ON l.id  = a.ley_id
        WHERE q.status <> 'DONE'
        ORDER BY FIELD(q.status, 'ERROR', 'PROCESSING', 'PENDING', 'SKIPPED'), q.updated_at DESC
      `, { type: QueryTypes.SELECT });

      return res.json({ ok: true, data: rows, resumen, total: rows.length });
    } catch (err: any) {
      if (err?.parent?.code === 'ER_NO_SUCH_TABLE' || /ER_NO_SUCH_TABLE|doesn't exist/i.test(err?.message || '')) {
        return res.json({ ok: true, data: [], resumen: {}, total: 0 });
      }
      logger.error({ msg: '[becariosArt] cola error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al obtener la cola ART' });
    }
  });

  // ── GET / — listado completo ──────────────────────────────────────────────
  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const q = req.query.q ? String(req.query.q).trim() : null;

      const where: string[] = ['b.deleted_at IS NULL', 'p.deleted_at IS NULL'];
      const repl: Record<string, any> = {};

      if (q) {
        where.push('(p.apellido LIKE :q OR p.nombre LIKE :q OR p.dni LIKE :q OR b.pagina LIKE :q)');
        repl.q = `%${q}%`;
      }

      const rows = await sequelize.query<Record<string, any>>(`
        SELECT
          b.id,
          b.dni,
          COALESCE(b.origen_art, 'manual') AS origen_art,
          p.apellido,
          p.nombre,
          a.legajo,
          b.pagina,
          b.created_at,
          b.updated_at,
          b.creado_por,
          COALESCE(NULLIF(uc.nombre, ''), uc.email) AS creado_por_nombre,
          b.actualizado_por,
          COALESCE(NULLIF(ua.nombre, ''), ua.email) AS actualizado_por_nombre
        FROM becarios_art b
        JOIN  personal  p  ON p.dni  = b.dni AND p.deleted_at IS NULL
        LEFT JOIN agentes a ON a.dni  = b.dni AND a.deleted_at IS NULL
        LEFT JOIN usuarios uc ON uc.id = b.creado_por
        LEFT JOIN usuarios ua ON ua.id = b.actualizado_por
        WHERE ${where.join(' AND ')}
        ORDER BY p.apellido ASC, p.nombre ASC
      `, { replacements: repl, type: QueryTypes.SELECT });

      const data = rows.map(enriquecerConDireccion);
      return res.json({ ok: true, data, total: data.length });
    } catch (err: any) {
      logger.error({ msg: '[becariosArt] list error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al listar becarios ART' });
    }
  });

  // ── GET /:dni — detalle ───────────────────────────────────────────────────
  router.get('/:dni', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });

      const rows = await sequelize.query<Record<string, any>>(`
        SELECT
          b.id,
          b.dni,
          COALESCE(b.origen_art, 'manual') AS origen_art,
          p.apellido,
          p.nombre,
          a.legajo,
          b.pagina,
          b.created_at,
          b.updated_at,
          b.creado_por,
          COALESCE(NULLIF(uc.nombre, ''), uc.email) AS creado_por_nombre,
          b.actualizado_por,
          COALESCE(NULLIF(ua.nombre, ''), ua.email) AS actualizado_por_nombre
        FROM becarios_art b
        JOIN  personal  p  ON p.dni  = b.dni AND p.deleted_at IS NULL
        LEFT JOIN agentes a ON a.dni  = b.dni AND a.deleted_at IS NULL
        LEFT JOIN usuarios uc ON uc.id = b.creado_por
        LEFT JOIN usuarios ua ON ua.id = b.actualizado_por
        WHERE b.dni = :dni AND b.deleted_at IS NULL
        LIMIT 1
      `, { replacements: { dni }, type: QueryTypes.SELECT });

      if (!rows.length) return res.status(404).json({ ok: false, error: `DNI ${dni} no registrado en becarios ART` });

      return res.json({ ok: true, data: enriquecerConDireccion(rows[0]) });
    } catch (err: any) {
      logger.error({ msg: '[becariosArt] get error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al obtener becario ART' });
    }
  });

  // ── POST / — alta ─────────────────────────────────────────────────────────
  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.flatten() });
      }

      const { dni, pagina } = parsed.data;
      const userId = (req as any).auth?.principalId ?? null;

      // Verificar que existe en personal
      const exists = await sequelize.query(
        'SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1',
        { replacements: { dni }, type: QueryTypes.SELECT }
      );
      if (!(exists as any[]).length) {
        return res.status(404).json({ ok: false, error: `DNI ${dni} no encontrado en personal` });
      }

      const [result] = await sequelize.query(
        `INSERT INTO becarios_art (dni, pagina, origen_art, creado_por, created_at, updated_at)
         VALUES (:dni, :pagina, 'manual', :userId, NOW(), NOW())`,
        { replacements: { dni, pagina, userId } }
      );

      const insertId = (result as any)?.insertId;
      trackAction('becario_art_alta', { actor: userId, becario_id: insertId, dni, pagina });

      return res.status(201).json({ ok: true, data: { id: insertId } });
    } catch (err: any) {
      if (err?.parent?.code === 'ER_DUP_ENTRY' || err?.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ ok: false, error: 'El DNI ya está registrado en becarios ART' });
      }
      logger.error({ msg: '[becariosArt] post error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al registrar becario ART' });
    }
  });

  // ── PATCH /:dni — actualizar página ──────────────────────────────────────
  router.patch('/:dni', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });

      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.flatten() });
      }

      const { pagina } = parsed.data;
      const userId = (req as any).auth?.principalId ?? null;

      const [meta] = await sequelize.query(
        `UPDATE becarios_art
         SET pagina = :pagina, actualizado_por = :userId, updated_at = NOW()
         WHERE dni = :dni AND deleted_at IS NULL`,
        { replacements: { pagina, userId, dni } }
      );

      if ((meta as any)?.affectedRows === 0) {
        return res.status(404).json({ ok: false, error: `DNI ${dni} no registrado en becarios ART` });
      }

      trackAction('becario_art_actualizar', { actor: userId, dni, pagina });

      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: '[becariosArt] patch error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al actualizar becario ART' });
    }
  });

  // ── DELETE /:dni — baja lógica ────────────────────────────────────────────
  router.delete('/:dni', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });

      const userId = (req as any).auth?.principalId ?? null;

      const [meta] = await sequelize.query(
        `UPDATE becarios_art SET deleted_at = NOW(), updated_at = NOW()
         WHERE dni = :dni AND deleted_at IS NULL`,
        { replacements: { dni } }
      );

      if ((meta as any)?.affectedRows === 0) {
        return res.status(404).json({ ok: false, error: `DNI ${dni} no registrado en becarios ART` });
      }

      trackAction('becario_art_baja', { actor: userId, dni });

      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: '[becariosArt] delete error', err: err?.message });
      return res.status(500).json({ ok: false, error: 'Error al dar de baja becario ART' });
    }
  });

  return router;
}
