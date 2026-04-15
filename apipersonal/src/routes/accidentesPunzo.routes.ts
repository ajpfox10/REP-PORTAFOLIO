// src/routes/accidentesPunzo.routes.ts
// Registro de accidentes punzo-cortantes
// Perfiles: app:infectologia:access (solo lectura), app:cargainfecto:access (carga/edita), crud:*:* (admin)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

function getUser(req: Request) {
  const u = (req as any).user ?? {};
  const perms: string[] = u.permissions ?? u.perms ?? [];
  const isAdmin      = perms.some(p => p === 'crud:*:*' || p.endsWith(':*:*'));
  const canCargar    = isAdmin || perms.includes('app:cargainfecto:access');
  const canVer       = canCargar || perms.includes('app:infectologia:access');
  return { id: u.id ?? null, email: u.email ?? null, perms, isAdmin, canCargar, canVer };
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
      `INSERT INTO accidentes_punzo_auditoria
         (registro_id, accion, usuario_id, usuario_email, datos_antes, datos_despues)
       VALUES (?, ?, ?, ?, ?, ?)`,
      { replacements: [registroId, accion, userId, userEmail,
          antes   ? JSON.stringify(antes)   : null,
          despues ? JSON.stringify(despues) : null] },
    );
  } catch { /* silencioso */ }
}

export function buildAccidentesPunzoRouter(sequelize: Sequelize) {
  const router = Router();

  // ── Crear tablas si no existen ────────────────────────────────────────────
  (async () => {
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS accidentes_punzo (
          id                   INT AUTO_INCREMENT PRIMARY KEY,
          agente_dni           VARCHAR(20)  NULL,
          agente_nombre        VARCHAR(200) NULL,
          servicio             VARCHAR(200) NULL,
          fecha                DATE         NOT NULL,
          caso                 TEXT         NULL,
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
          eliminado_at         DATETIME     NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS accidentes_punzo_auditoria (
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
      logger.error({ msg: 'accidentes_punzo: error creando tablas', error: e?.message });
    }
  })();

  // ── GET / ────────────────────────────────────────────────────────────────
  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canVer) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    try {
      const { desde, hasta, servicio } = req.query as any;
      const conds: string[] = ['activo = 1'];
      const vals: any[] = [];
      if (desde)    { conds.push('fecha >= ?'); vals.push(desde); }
      if (hasta)    { conds.push('fecha <= ?'); vals.push(hasta); }
      if (servicio) { conds.push('servicio LIKE ?'); vals.push(`%${servicio}%`); }
      const rows = await sequelize.query<any>(
        `SELECT * FROM accidentes_punzo WHERE ${conds.join(' AND ')} ORDER BY fecha DESC, id DESC`,
        { type: QueryTypes.SELECT, replacements: vals },
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
        `SELECT id, agente_nombre, servicio, fecha, caso
         FROM accidentes_punzo
         WHERE activo = 1 AND fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         ORDER BY fecha DESC LIMIT 10`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, recientes: rows.length, data: rows });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── POST / ───────────────────────────────────────────────────────────────
  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canCargar) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const { agente_dni, agente_nombre, servicio, fecha, caso, observaciones } = req.body ?? {};
    if (!fecha) return res.status(400).json({ ok: false, error: 'Fecha requerida' });
    try {
      const [result] = await sequelize.query(
        `INSERT INTO accidentes_punzo
           (agente_dni, agente_nombre, servicio, fecha, caso, observaciones, creado_por_id, creado_por_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [agente_dni || null, agente_nombre || null, servicio || null,
            fecha, caso || null, observaciones || null, u.id, u.email] },
      ) as any;
      const newId = result?.insertId ?? result;
      const [created] = await sequelize.query<any>(
        `SELECT * FROM accidentes_punzo WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [newId] },
      );
      await logAudit(sequelize, newId, 'crear', u.id, u.email, null, created);
      return res.json({ ok: true, data: created });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── PUT /:id ──────────────────────────────────────────────────────────────
  router.put('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.canCargar) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    const id = Number(req.params.id);
    const { agente_dni, agente_nombre, servicio, fecha, caso, observaciones } = req.body ?? {};
    if (!fecha) return res.status(400).json({ ok: false, error: 'Fecha requerida' });
    try {
      const [antes] = await sequelize.query<any>(
        `SELECT * FROM accidentes_punzo WHERE id = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      await sequelize.query(
        `UPDATE accidentes_punzo SET
           agente_dni=?, agente_nombre=?, servicio=?, fecha=?, caso=?, observaciones=?,
           modificado_por_id=?, modificado_por_email=?, modificado_at=NOW()
         WHERE id=?`,
        { replacements: [agente_dni || null, agente_nombre || null, servicio || null,
            fecha, caso || null, observaciones || null, u.id, u.email, id] },
      );
      const [despues] = await sequelize.query<any>(
        `SELECT * FROM accidentes_punzo WHERE id = ?`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      await logAudit(sequelize, id, 'modificar', u.id, u.email, antes, despues);
      return res.json({ ok: true, data: despues });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── DELETE /:id (admin) ───────────────────────────────────────────────────
  router.delete('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo admin' });
    const id = Number(req.params.id);
    try {
      const [antes] = await sequelize.query<any>(
        `SELECT * FROM accidentes_punzo WHERE id = ? AND activo = 1`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      await sequelize.query(
        `UPDATE accidentes_punzo SET activo=0, eliminado_por_id=?, eliminado_por_email=?, eliminado_at=NOW() WHERE id=?`,
        { replacements: [u.id, u.email, id] },
      );
      await logAudit(sequelize, id, 'eliminar', u.id, u.email, antes, null);
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
