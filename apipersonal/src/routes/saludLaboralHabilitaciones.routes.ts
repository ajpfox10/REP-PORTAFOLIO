// src/routes/saludLaboralHabilitaciones.routes.ts
// Habilitaciones del admin para que Salud Laboral cargue reconocimientos médicos de un mes
// anterior (07/11/2026). Sin habilitación vigente para ese agente y ese mes, el CRUD rechaza
// reconocimientos_medicos con fecha_desde anterior al 1° del mes actual (ver crud.routes.ts).
// Lectura: cualquier usuario con api:access (Salud Laboral necesita saber qué está habilitado).
// Alta y revocación: solo admin (crud:*:*).

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';

const ensured = new WeakSet<Sequelize>();

export async function ensureSaludLaboralHabilitacionesTable(sequelize: Sequelize) {
  if (ensured.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS salud_laboral_habilitaciones (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      dni             VARCHAR(20)  NOT NULL,
      agente_nombre   VARCHAR(200) NULL,
      mes             CHAR(7)      NOT NULL,
      vigente_hasta   DATE         NOT NULL,
      motivo          VARCHAR(500) NULL,
      creado_por_id   INT          NULL,
      creado_por_email VARCHAR(200) NULL,
      creado_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revocada_at     DATETIME     NULL,
      revocada_por_id INT          NULL,
      INDEX idx_slh_dni_mes (dni, mes),
      INDEX idx_slh_vigente (vigente_hasta)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ensured.add(sequelize);
}

/** 'YYYY-MM-DD' de hoy en hora local del server. */
export function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** '1° del mes actual' como 'YYYY-MM-DD'. */
export function inicioMesActual(): string {
  return hoyLocal().slice(0, 8) + '01';
}

/**
 * Valida la fecha de un reconocimiento médico cargado por alguien que no es admin.
 * Devuelve el mensaje de error o null si está permitido.
 */
export async function validarMesAnteriorSaludLaboral(
  sequelize: Sequelize, dni: string, fecha: string,
): Promise<string | null> {
  const f = String(fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  if (f >= inicioMesActual()) return null;
  const mes = f.slice(0, 7);
  const [mm, aa] = [mes.slice(5, 7), mes.slice(0, 4)];
  try {
    await ensureSaludLaboralHabilitacionesTable(sequelize);
    const rows = await sequelize.query<any>(
      `SELECT id FROM salud_laboral_habilitaciones
        WHERE dni = ? AND mes = ? AND revocada_at IS NULL AND vigente_hasta >= ?
        LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: [String(dni || '').trim(), mes, hoyLocal()] },
    );
    if (rows.length) return null;
  } catch (e: any) {
    logger.error({ msg: 'salud_laboral_habilitaciones: error validando', error: e?.message });
  }
  return `La licencia es de ${mm}/${aa} (mes anterior). Para cargarla, el admin tiene que habilitar a este agente para ese mes.`;
}

function getUser(req: Request) {
  const auth = (req as any).auth ?? {};
  const perms: string[] = auth.permissions ?? [];
  return { id: auth.principalId ?? null, email: auth.email ?? null, isAdmin: perms.includes('crud:*:*') };
}

export function buildSaludLaboralHabilitacionesRouter(sequelize: Sequelize) {
  const router = Router();
  ensureSaludLaboralHabilitacionesTable(sequelize).catch((e: any) =>
    logger.error({ msg: 'salud_laboral_habilitaciones: error creando tabla', error: e?.message }));

  // GET / — vigentes (o todas con ?todas=1, solo admin). Filtro opcional ?dni=
  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      await ensureSaludLaboralHabilitacionesTable(sequelize);
      const u = getUser(req);
      const todas = u.isAdmin && String(req.query.todas || '') === '1';
      const where: string[] = [];
      const rep: any[] = [];
      if (!todas) { where.push('revocada_at IS NULL AND vigente_hasta >= ?'); rep.push(hoyLocal()); }
      const dni = String(req.query.dni || '').trim();
      if (dni) { where.push('dni = ?'); rep.push(dni); }
      const rows = await sequelize.query<any>(
        `SELECT id, dni, agente_nombre, mes, DATE_FORMAT(vigente_hasta, '%Y-%m-%d') AS vigente_hasta,
                motivo, creado_por_email, creado_at, revocada_at
           FROM salud_laboral_habilitaciones
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY creado_at DESC
          LIMIT 500`,
        { type: QueryTypes.SELECT, replacements: rep },
      );
      res.json({ ok: true, data: rows, inicio_mes: inicioMesActual() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  // POST / — habilitar (solo admin). Body: { dni, agente_nombre?, mes:'YYYY-MM', vigente_hasta:'YYYY-MM-DD', motivo? }
  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo el admin puede habilitar.' });
    const dni = String(req.body?.dni || '').trim();
    const mes = String(req.body?.mes || '').trim();
    const hasta = String(req.body?.vigente_hasta || '').slice(0, 10);
    if (!/^\d{6,9}$/.test(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido.' });
    if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: 'Mes inválido (AAAA-MM).' });
    if (mes >= inicioMesActual().slice(0, 7)) return res.status(400).json({ ok: false, error: 'El mes del habilitado tiene que ser anterior al actual.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < hoyLocal()) return res.status(400).json({ ok: false, error: 'La fecha de vencimiento tiene que ser hoy o posterior.' });
    try {
      await ensureSaludLaboralHabilitacionesTable(sequelize);
      let email = u.email;
      if (!email && u.id) {
        const [r] = await sequelize.query<any>(`SELECT email FROM usuarios WHERE id = ? LIMIT 1`,
          { type: QueryTypes.SELECT, replacements: [u.id] });
        email = r?.email ?? null;
      }
      await sequelize.query(
        `INSERT INTO salud_laboral_habilitaciones (dni, agente_nombre, mes, vigente_hasta, motivo, creado_por_id, creado_por_email)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [dni, String(req.body?.agente_nombre || '').slice(0, 200) || null, mes, hasta,
            String(req.body?.motivo || '').slice(0, 500) || null, u.id, email] },
      );
      res.status(201).json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  // DELETE /:id — revocar (solo admin)
  router.delete('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const u = getUser(req);
    if (!u.isAdmin) return res.status(403).json({ ok: false, error: 'Solo el admin puede revocar.' });
    try {
      await sequelize.query(
        `UPDATE salud_laboral_habilitaciones SET revocada_at = NOW(), revocada_por_id = ?
          WHERE id = ? AND revocada_at IS NULL`,
        { replacements: [u.id, Number(req.params.id)] },
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  return router;
}
