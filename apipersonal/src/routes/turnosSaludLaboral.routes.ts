// src/routes/turnosSaludLaboral.routes.ts
// Turnos (citas) con la médica de Salud Laboral para cubrir un rango de licencia de un
// agente ausente. Se cruzan en GET /asistencia/ausentes28 (campos licMedica / turnoSL).
// Tabla: ver scripts/migrations/065__turnos_salud_laboral.sql (acá se crea igual si falta).
//
//  GET    /turnos-salud-laboral?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&dni=   → lista (rango que se solapa)
//  POST   /turnos-salud-laboral                                          → alta
//  PUT    /turnos-salud-laboral/:id                                      → edición
//  DELETE /turnos-salud-laboral/:id                                      → baja lógica

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { buscarBecados } from './asistencia.routes';

const txt    = (v: any) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const fecha  = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
const hora   = (v: any) => { const m = String(v ?? '').match(/^(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}:00` : null; };
const entero = (v: any) => { const n = Number(String(v ?? '').replace(/\D/g, '')); return n > 0 ? n : null; };
const userId = (req: Request) => ((req as any).auth?.principalId ?? null) as number | null;

async function ensureTabla(sequelize: Sequelize) {
  await sequelize.query(`CREATE TABLE IF NOT EXISTS turnos_salud_laboral (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    dni INT NOT NULL,
    fecha_turno DATE NOT NULL,
    hora_turno TIME NULL,
    fecha_desde DATE NOT NULL,
    fecha_hasta DATE NOT NULL,
    observaciones VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    deleted_by INT NULL,
    KEY idx_tsl_dni_rango (dni, fecha_desde, fecha_hasta),
    KEY idx_tsl_fecha_turno (fecha_turno),
    CONSTRAINT fk_tsl_dni__personal FOREIGN KEY (dni) REFERENCES personal (dni) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_tsl_created_by FOREIGN KEY (created_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tsl_updated_by FOREIGN KEY (updated_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tsl_deleted_by FOREIGN KEY (deleted_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_tsl_rango CHECK (fecha_hasta >= fecha_desde)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
}

const SELECT_TURNO = `
  SELECT t.id, t.dni,
         DATE_FORMAT(t.fecha_turno, '%Y-%m-%d') AS fecha_turno,
         TIME_FORMAT(t.hora_turno, '%H:%i')     AS hora_turno,
         DATE_FORMAT(t.fecha_desde, '%Y-%m-%d') AS fecha_desde,
         DATE_FORMAT(t.fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
         t.observaciones, t.created_at,
         TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) AS nombre
    FROM turnos_salud_laboral t
    LEFT JOIN personal p ON p.dni = t.dni`;

export function buildTurnosSaludLaboralRouter(sequelize: Sequelize) {
  const router = Router();

  ensureTabla(sequelize).catch((e) => logger.error({ msg: 'turnos_salud_laboral ensureTabla', err: e?.message }));

  const leerBody = (body: any) => {
    const dni = entero(body?.dni);
    if (!dni) return { error: 'Falta el agente' };
    const fechaTurno = fecha(body?.fecha_turno);
    if (!fechaTurno) return { error: 'Falta la fecha del turno' };
    const desde = fecha(body?.fecha_desde);
    const hasta = fecha(body?.fecha_hasta);
    if (!desde || !hasta) return { error: 'Falta el rango de licencia a cubrir' };
    if (hasta < desde) return { error: 'La fecha "hasta" no puede ser anterior a "desde"' };
    return {
      v: { dni, fechaTurno, horaTurno: hora(body?.hora_turno), desde, hasta, obs: txt(body?.observaciones) },
    };
  };

  // Solo la población de Reconocimientos Médicos: becado ACTIVO (ex-becado = solo consulta)
  const validarBecado = async (dni: number): Promise<string | null> => {
    const est = (await buscarBecados(sequelize, [String(dni)])).get(String(dni));
    if (!est) return `El DNI ${dni} no es becado: los turnos con la médica son solo para becados`;
    if (est === 'BAJA') return `El DNI ${dni} es un becado dado de baja: solo consulta`;
    return null;
  };

  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const where: string[] = ['t.deleted_at IS NULL'];
      const rep: any[] = [];
      const desde = fecha(req.query.desde);
      const hasta = fecha(req.query.hasta);
      if (desde) { where.push('t.fecha_hasta >= ?'); rep.push(desde); }
      if (hasta) { where.push('t.fecha_desde <= ?'); rep.push(hasta); }
      const dni = entero(req.query.dni);
      if (dni) { where.push('t.dni = ?'); rep.push(dni); }
      const data = await sequelize.query<any>(
        `${SELECT_TURNO} WHERE ${where.join(' AND ')} ORDER BY t.fecha_turno DESC, t.id DESC`,
        { type: QueryTypes.SELECT, replacements: rep },
      );
      res.json({ ok: true, data });
    } catch (e: any) {
      logger.error({ msg: 'turnos_salud_laboral list', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message ?? 'Error' });
    }
  });

  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const b = leerBody(req.body);
    if ('error' in b) return res.status(400).json({ ok: false, error: b.error });
    const { dni, fechaTurno, horaTurno, desde, hasta, obs } = b.v!;
    try {
      const [p] = await sequelize.query<any>('SELECT dni FROM personal WHERE dni = ?', { type: QueryTypes.SELECT, replacements: [dni] });
      if (!p) return res.status(400).json({ ok: false, error: `El DNI ${dni} no está en personal` });
      const errBecado = await validarBecado(dni);
      if (errBecado) return res.status(400).json({ ok: false, error: errBecado });
      const [id] = await sequelize.query(
        `INSERT INTO turnos_salud_laboral (dni, fecha_turno, hora_turno, fecha_desde, fecha_hasta, observaciones, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [dni, fechaTurno, horaTurno, desde, hasta, obs, userId(req)] },
      );
      const [row] = await sequelize.query<any>(`${SELECT_TURNO} WHERE t.id = ?`, { type: QueryTypes.SELECT, replacements: [id] });
      res.json({ ok: true, data: row });
    } catch (e: any) {
      logger.error({ msg: 'turnos_salud_laboral create', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message ?? 'Error' });
    }
  });

  router.put('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const b = leerBody(req.body);
    if ('error' in b) return res.status(400).json({ ok: false, error: b.error });
    const { dni, fechaTurno, horaTurno, desde, hasta, obs } = b.v!;
    try {
      const errBecado = await validarBecado(dni);
      if (errBecado) return res.status(400).json({ ok: false, error: errBecado });
      const [, meta]: any = await sequelize.query(
        `UPDATE turnos_salud_laboral
            SET dni = ?, fecha_turno = ?, hora_turno = ?, fecha_desde = ?, fecha_hasta = ?, observaciones = ?, updated_by = ?
          WHERE id = ? AND deleted_at IS NULL`,
        { replacements: [dni, fechaTurno, horaTurno, desde, hasta, obs, userId(req), id] },
      );
      if (!meta?.affectedRows) return res.status(404).json({ ok: false, error: 'Turno no encontrado' });
      const [row] = await sequelize.query<any>(`${SELECT_TURNO} WHERE t.id = ?`, { type: QueryTypes.SELECT, replacements: [id] });
      res.json({ ok: true, data: row });
    } catch (e: any) {
      logger.error({ msg: 'turnos_salud_laboral update', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message ?? 'Error' });
    }
  });

  router.delete('/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    try {
      await sequelize.query(
        'UPDATE turnos_salud_laboral SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
        { replacements: [userId(req), id] },
      );
      res.json({ ok: true });
    } catch (e: any) {
      logger.error({ msg: 'turnos_salud_laboral delete', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message ?? 'Error' });
    }
  });

  return router;
}
