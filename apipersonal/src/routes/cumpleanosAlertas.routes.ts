import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { trackAction } from '../logging/track';

type CumpleEstado = 'PENDIENTE' | 'AVISADO' | 'OMITIDO';

const initializedDatabases = new WeakSet<Sequelize>();

async function ensureTable(sequelize: Sequelize) {
  if (initializedDatabases.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS alertas_cumpleanos_estado (
      id INT NOT NULL AUTO_INCREMENT,
      dni INT NOT NULL,
      anio INT NOT NULL,
      fecha_cumple DATE NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      avisado_at DATETIME NULL,
      avisado_por INT NULL,
      omitido_at DATETIME NULL,
      omitido_por INT NULL,
      observaciones TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_alertas_cumpleanos_dni_anio (dni, anio),
      KEY idx_alertas_cumpleanos_estado (estado),
      KEY idx_alertas_cumpleanos_fecha (fecha_cumple)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  initializedDatabases.add(sequelize);
}

function toInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function parseDbDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const text = String(value).slice(0, 10);
  const parts = text.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return isNaN(d.getTime()) ? null : d;
}

function birthdayForYear(fechaNacimiento: any, year: number) {
  const born = parseDbDate(fechaNacimiento);
  if (!born) return null;
  const month = born.getMonth();
  const day = born.getDate();
  const candidate = new Date(year, month, day);
  if (month === 1 && day === 29 && candidate.getMonth() !== 1) {
    return new Date(year, 1, 28);
  }
  return candidate;
}

function dateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function setEstado(sequelize: Sequelize, req: Request, res: Response, estado: CumpleEstado) {
  try {
    await ensureTable(sequelize);
    const dni = Number(req.params.dni);
    const anio = Number(req.params.anio);
    const userId = (req as any).auth?.principalId ?? null;
    if (!Number.isInteger(dni) || dni <= 0 || !Number.isInteger(anio)) {
      return res.status(400).json({ ok: false, error: 'Parametros invalidos' });
    }

    const rows = await sequelize.query<{ fecha_nacimiento: string }>(
      `SELECT fecha_nacimiento FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT },
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'DNI no encontrado' });

    const cumple = birthdayForYear(rows[0].fecha_nacimiento, anio);
    if (!cumple) return res.status(400).json({ ok: false, error: 'Fecha de nacimiento invalida' });

    if (estado === 'PENDIENTE') {
      await sequelize.query(
        `INSERT INTO alertas_cumpleanos_estado
           (dni, anio, fecha_cumple, estado, created_at, updated_at)
         VALUES
           (:dni, :anio, :fechaCumple, :estado, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           fecha_cumple = VALUES(fecha_cumple),
           estado = VALUES(estado),
           avisado_at = NULL,
           avisado_por = NULL,
           omitido_at = NULL,
           omitido_por = NULL,
           updated_at = NOW()`,
        { replacements: { dni, anio, fechaCumple: dateOnly(cumple), estado } },
      );
    } else {
      const nowField = estado === 'AVISADO' ? 'avisado_at' : 'omitido_at';
      const userField = estado === 'AVISADO' ? 'avisado_por' : 'omitido_por';

      await sequelize.query(
        `INSERT INTO alertas_cumpleanos_estado
           (dni, anio, fecha_cumple, estado, ${nowField}, ${userField}, created_at, updated_at)
         VALUES
           (:dni, :anio, :fechaCumple, :estado, NOW(), :userId, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           fecha_cumple = VALUES(fecha_cumple),
           estado = VALUES(estado),
           ${nowField} = NOW(),
           ${userField} = :userId,
           updated_at = NOW()`,
        { replacements: { dni, anio, fechaCumple: dateOnly(cumple), estado, userId } },
      );
    }

    trackAction('alerta_cumpleanos_estado', { actor: userId, dni, anio, estado });
    return res.json({ ok: true, data: { dni, anio, estado } });
  } catch (err: any) {
    logger.error({ msg: 'Error actualizando alerta de cumpleanos', err });
    return res.status(500).json({ ok: false, error: 'Error al actualizar cumpleanos' });
  }
}

export function buildCumpleanosAlertasRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      await ensureTable(sequelize);
      const dias = toInt(req.query.dias, 7, 0, 60);
      const estadoFiltro = String(req.query.estado || 'pendientes').toLowerCase();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setDate(end.getDate() + dias);

      const rows = await sequelize.query<any>(
        `SELECT
           p.dni, p.apellido, p.nombre, p.fecha_nacimiento, p.email, p.telefono,
           (SELECT srv.nombre FROM agentes_servicios ags JOIN servicios srv ON srv.id = ags.servicio_id
             WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
             ORDER BY ags.id DESC LIMIT 1) AS servicio_nombre,
           (SELECT sec.nombre FROM agentes_servicios ags JOIN sectores sec ON sec.id = ags.sector_id
             WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
             ORDER BY ags.id DESC LIMIT 1) AS sector_nombre
         FROM personal p
         WHERE p.deleted_at IS NULL
           AND p.fecha_nacimiento IS NOT NULL`,
        { type: QueryTypes.SELECT },
      );

      const years = [today.getFullYear(), today.getFullYear() + 1];
      const items = rows.flatMap((p) => {
        return years.map((year) => {
          const cumple = birthdayForYear(p.fecha_nacimiento, year);
          if (!cumple) return null;
          cumple.setHours(0, 0, 0, 0);
          if (cumple < today || cumple > end) return null;
          const diasRestantes = Math.round((cumple.getTime() - today.getTime()) / 86400000);
          return {
            ...p,
            anio: year,
            fecha_cumple: dateOnly(cumple),
            dias: diasRestantes,
          };
        }).filter(Boolean);
      });

      const estadoRows = await sequelize.query<any>(
        `SELECT e.*, COALESCE(NULLIF(u.nombre, ''), u.email) AS avisado_por_nombre
         FROM alertas_cumpleanos_estado e
         LEFT JOIN usuarios u ON u.id = e.avisado_por
         WHERE e.fecha_cumple BETWEEN :desde AND :hasta`,
        { replacements: { desde: dateOnly(today), hasta: dateOnly(end) }, type: QueryTypes.SELECT },
      );
      const estadoMap = new Map(estadoRows.map((e) => [`${e.dni}-${e.anio}`, e]));

      const data = items
        .map((item: any) => {
          const estado = estadoMap.get(`${item.dni}-${item.anio}`);
          return {
            ...item,
            estado_aviso: estado?.estado || 'PENDIENTE',
            avisado_at: estado?.avisado_at || null,
            avisado_por: estado?.avisado_por || null,
            avisado_por_nombre: estado?.avisado_por_nombre || null,
          };
        })
        .filter((item: any) => {
          if (estadoFiltro === 'todos') return true;
          if (estadoFiltro === 'avisados') return item.estado_aviso === 'AVISADO';
          if (estadoFiltro === 'omitidos') return item.estado_aviso === 'OMITIDO';
          return item.estado_aviso === 'PENDIENTE';
        })
        .sort((a: any, b: any) => a.dias - b.dias || String(a.apellido).localeCompare(String(b.apellido), 'es'));

      return res.json({ ok: true, data, meta: { total: data.length, dias, estado: estadoFiltro } });
    } catch (err: any) {
      logger.error({ msg: 'Error listando alertas de cumpleanos', err });
      return res.status(500).json({ ok: false, error: 'Error al listar cumpleanos' });
    }
  });

  router.post('/:dni/:anio/avisar', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'AVISADO'));
  router.post('/:dni/:anio/omitir', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'OMITIDO'));
  router.post('/:dni/:anio/pendiente', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'PENDIENTE'));

  return router;
}
