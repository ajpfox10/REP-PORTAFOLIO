// src/routes/examenIngreso.routes.ts
// Gestión de turnos para examen de ingreso
// Perfiles: app:gestion_turnos:access (gestiona turnos), crud:*:* (admin completo)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

function getUser(req: Request) {
  const auth = (req as any).auth ?? {};
  const perms: string[] = auth.permissions ?? [];
  return {
    id:          auth.principalId ?? null,
    perms,
    isAdmin:      perms.some((p: string) => p === 'crud:*:*' || p.endsWith(':*:*')),
    canGestionar: perms.some((p: string) => p === 'crud:*:*' || p.endsWith(':*:*') || p === 'app:gestion_turnos:access'),
  };
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
  candidatoId: number,
  accion: string,
  userId: number | null,
  userEmail: string | null,
  antes: any,
  despues: any,
) {
  try {
    await sequelize.query(
      `INSERT INTO examen_ingreso_auditoria
         (candidato_id, accion, usuario_id, usuario_email, datos_antes, datos_despues)
       VALUES (?, ?, ?, ?, ?, ?)`,
      { replacements: [candidatoId, accion, userId, userEmail,
          antes  ? JSON.stringify(antes)  : null,
          despues ? JSON.stringify(despues) : null] },
    );
  } catch { /* silencioso */ }
}

const TURNOS = ['laboratorio','rayos','cardiologia','psicologia','fonoaudiologia','odontologia'] as const;

export function buildExamenIngresoRouter(sequelize: Sequelize) {
  const router = Router();

  // ── Crear tablas si no existen ────────────────────────────────────────────
  (async () => {
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS examen_ingreso (
          id                   INT AUTO_INCREMENT PRIMARY KEY,
          dni                  VARCHAR(20)  NULL,
          nombre               VARCHAR(200) NOT NULL,
          es_agente            TINYINT(1)   NOT NULL DEFAULT 0,
          observaciones        TEXT         NULL,
          activo               TINYINT(1)   NOT NULL DEFAULT 1,
          turno_laboratorio    DATE         NULL,
          turno_rayos          DATE         NULL,
          turno_cardiologia    DATE         NULL,
          turno_psicologia     DATE         NULL,
          turno_fonoaudiologia DATE         NULL,
          turno_odontologia    DATE         NULL,
          avisado              TINYINT(1)   NOT NULL DEFAULT 0,
          avisado_por_id       INT          NULL,
          avisado_por_email    VARCHAR(200) NULL,
          avisado_at           DATETIME     NULL,
          creado_por_id        INT          NULL,
          creado_por_email     VARCHAR(200) NULL,
          creado_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          modificado_por_id    INT          NULL,
          modificado_por_email VARCHAR(200) NULL,
          modificado_at        DATETIME     NULL,
          eliminado_por_id     INT          NULL,
          eliminado_por_email  VARCHAR(200) NULL,
          eliminado_at         DATETIME     NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS examen_ingreso_auditoria (
          id           INT AUTO_INCREMENT PRIMARY KEY,
          candidato_id INT          NOT NULL,
          accion       VARCHAR(50)  NOT NULL,
          usuario_id   INT          NULL,
          usuario_email VARCHAR(200) NULL,
          datos_antes  TEXT         NULL,
          datos_despues TEXT        NULL,
          created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (e: any) {
      logger.error({ msg: 'examen_ingreso: error creando tablas', error: e?.message });
    }
  })();

  // ── GET /candidatos ───────────────────────────────────────────────────────
  router.get('/candidatos', requirePermission('api:access'), async (req: Request, res: Response) => {
    const { canGestionar } = getUser(req);
    if (!canGestionar) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    try {
      const rows = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE activo = 1 ORDER BY nombre ASC`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, data: rows });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET /alertas (para banner) ────────────────────────────────────────────
  router.get('/alertas', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<any>(
        `SELECT id, dni, nombre, es_agente, avisado,
                turno_laboratorio, turno_rayos, turno_cardiologia,
                turno_psicologia, turno_fonoaudiologia, turno_odontologia
         FROM examen_ingreso
         WHERE activo = 1
         ORDER BY nombre ASC`,
        { type: QueryTypes.SELECT },
      );
      // pendientes = tienen al menos un turno sin asignar
      const pendientes = rows.filter((r: any) =>
        !r.turno_laboratorio || !r.turno_rayos || !r.turno_cardiologia ||
        !r.turno_psicologia  || !r.turno_fonoaudiologia || !r.turno_odontologia
      );
      return res.json({ ok: true, total: rows.length, pendientes: pendientes.length, data: pendientes.slice(0, 20) });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── GET /auditoria/:id ────────────────────────────────────────────────────
  router.get('/auditoria/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const { isAdmin } = getUser(req);
    if (!isAdmin) return res.status(403).json({ ok: false, error: 'Solo admin' });
    try {
      const rows = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso_auditoria WHERE candidato_id = ? ORDER BY created_at DESC`,
        { type: QueryTypes.SELECT, replacements: [req.params.id] },
      );
      return res.json({ ok: true, data: rows });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── POST /candidatos (admin) ──────────────────────────────────────────────
  router.post('/candidatos', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo admin' });
    const { dni, nombre, es_agente, observaciones } = req.body ?? {};
    if (!nombre?.trim()) return res.status(400).json({ ok: false, error: 'Nombre requerido' });
    try {
      const email = await getUserEmail(sequelize, u.id);
      const [result] = await sequelize.query(
        `INSERT INTO examen_ingreso (dni, nombre, es_agente, observaciones, creado_por_id, creado_por_email)
         VALUES (?, ?, ?, ?, ?, ?)`,
        { replacements: [dni?.trim() || null, nombre.trim(), es_agente ? 1 : 0,
            observaciones?.trim() || null, u.id, email] },
      ) as any;
      const newId = result?.insertId ?? result;
      const [created] = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [newId] },
      );
      await logAudit(sequelize, newId, 'crear', u.id, email, null, created);
      return res.json({ ok: true, data: created });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── PUT /candidatos/:id (admin — datos del candidato) ────────────────────
  router.put('/candidatos/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo admin' });
    const id = Number(req.params.id);
    const { dni, nombre, es_agente, observaciones } = req.body ?? {};
    if (!nombre?.trim()) return res.status(400).json({ ok: false, error: 'Nombre requerido' });
    try {
      const [antes] = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE id = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const email = await getUserEmail(sequelize, u.id);
      await sequelize.query(
        `UPDATE examen_ingreso SET dni=?, nombre=?, es_agente=?, observaciones=?,
           modificado_por_id=?, modificado_por_email=?, modificado_at=NOW()
         WHERE id=?`,
        { replacements: [dni?.trim() || null, nombre.trim(), es_agente ? 1 : 0,
            observaciones?.trim() || null, u.id, email, id] },
      );
      const [despues] = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      await logAudit(sequelize, id, 'modificar', u.id, email, antes, despues);
      return res.json({ ok: true, data: despues });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── PUT /candidatos/:id/turnos (gestión + admin) ──────────────────────────
  router.put('/candidatos/:id/turnos', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canGestionar) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const id = Number(req.params.id);
    const body = req.body ?? {};
    const sets: string[] = [];
    const vals: any[]    = [];
    for (const t of TURNOS) {
      const key = `turno_${t}`;
      if (key in body) {
        sets.push(`${key} = ?`);
        vals.push(body[key] || null);
      }
    }
    if (!sets.length) return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
    try {
      const email = await getUserEmail(sequelize, u.id);
      sets.push('modificado_por_id = ?', 'modificado_por_email = ?', 'modificado_at = NOW()');
      vals.push(u.id, email, id);
      const [antes] = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE id = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      await sequelize.query(
        `UPDATE examen_ingreso SET ${sets.join(', ')} WHERE id = ?`,
        { replacements: vals },
      );
      const [despues] = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      await logAudit(sequelize, id, 'turnos', u.id, email, antes, despues);
      return res.json({ ok: true, data: despues });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── PUT /candidatos/:id/avisar (gestión + admin) ──────────────────────────
  router.put('/candidatos/:id/avisar', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canGestionar) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const id = Number(req.params.id);
    const avisado = req.body?.avisado !== false;
    try {
      const email = await getUserEmail(sequelize, u.id);
      await sequelize.query(
        `UPDATE examen_ingreso SET
           avisado=?, avisado_por_id=?, avisado_por_email=?, avisado_at=?,
           modificado_por_id=?, modificado_por_email=?, modificado_at=NOW()
         WHERE id=? AND activo=1`,
        { replacements: [avisado ? 1 : 0, u.id, email, avisado ? new Date() : null,
            u.id, email, id] },
      );
      const [row] = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      await logAudit(sequelize, id, avisado ? 'avisar' : 'desavisar', u.id, email, null, { avisado });
      return res.json({ ok: true, data: row });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── DELETE /candidatos/:id (admin — soft delete) ──────────────────────────
  router.delete('/candidatos/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo admin' });
    const id = Number(req.params.id);
    try {
      const [antes] = await sequelize.query<any>(
        `SELECT * FROM examen_ingreso WHERE id = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const email = await getUserEmail(sequelize, u.id);
      await sequelize.query(
        `UPDATE examen_ingreso SET activo=0, eliminado_por_id=?, eliminado_por_email=?, eliminado_at=NOW() WHERE id=?`,
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
