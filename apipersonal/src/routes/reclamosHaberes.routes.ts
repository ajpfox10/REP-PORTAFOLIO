/**
 * @file routes/reclamosHaberes.routes.ts
 * Banner de "pendientes de reclamo de haberes": cuando a un agente se le carga la
 * baja (estado_empleo -> BAJA en el PATCH /personal/:dni) se siembra un pendiente
 * con nombre + ley + fecha de baja. Se acumulan hasta marcarse Reclamado u Omitir.
 * Espeja el patron de alertas_cumpleanos_estado (tabla creada en runtime).
 */
import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { trackAction } from '../logging/track';

type ReclamoEstado = 'PENDIENTE' | 'RECLAMADO' | 'OMITIDO';

const initializedDatabases = new WeakSet<Sequelize>();

export async function ensureReclamosHaberesTable(sequelize: Sequelize) {
  if (initializedDatabases.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS reclamos_haberes_estado (
      id INT NOT NULL AUTO_INCREMENT,
      dni INT NOT NULL,
      agente_nombre VARCHAR(200) NULL,
      ley_id INT NULL,
      ley_nombre VARCHAR(150) NULL,
      fecha_baja DATE NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      reclamado_at DATETIME NULL,
      reclamado_por INT NULL,
      omitido_at DATETIME NULL,
      omitido_por INT NULL,
      observaciones TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_reclamos_haberes_dni_fecha (dni, fecha_baja),
      KEY idx_reclamos_haberes_estado (estado),
      KEY idx_reclamos_haberes_fecha (fecha_baja)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  initializedDatabases.add(sequelize);
}

function dateOnly(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/**
 * Siembra (idempotente) un pendiente de reclamo de haberes para una baja.
 * Best-effort: nunca debe romper la carga de la baja -> llamar en try/catch propio.
 */
export async function seedReclamoHaberes(
  sequelize: Sequelize,
  params: { dni: number; fechaBaja: any },
): Promise<void> {
  await ensureReclamosHaberesTable(sequelize);
  const dni = Number(params.dni);
  const fechaBaja = dateOnly(params.fechaBaja);
  if (!Number.isInteger(dni) || dni <= 0 || !fechaBaja) return;

  // Snapshot del agente al momento de la baja (nombre + ley de la vinculacion BAJA)
  const rows = await sequelize.query<{ apellido: string; nombre: string; ley_id: number | null; ley_nombre: string | null }>(
    `SELECT p.apellido, p.nombre, a.ley_id, l.nombre AS ley_nombre
       FROM personal p
       LEFT JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
       LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
      WHERE p.dni = :dni AND p.deleted_at IS NULL
      ORDER BY (a.estado_empleo = 'BAJA' AND a.fecha_egreso = :fechaBaja) DESC, a.id DESC
      LIMIT 1`,
    { replacements: { dni, fechaBaja }, type: QueryTypes.SELECT },
  );
  const r = rows[0] || ({} as any);
  const agenteNombre = [r.apellido, r.nombre].filter(Boolean).join(', ') || null;

  await sequelize.query(
    `INSERT INTO reclamos_haberes_estado
       (dni, agente_nombre, ley_id, ley_nombre, fecha_baja, estado, created_at, updated_at)
     VALUES
       (:dni, :agenteNombre, :leyId, :leyNombre, :fechaBaja, 'PENDIENTE', NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       agente_nombre = VALUES(agente_nombre),
       ley_id = VALUES(ley_id),
       ley_nombre = VALUES(ley_nombre),
       updated_at = NOW()`,
    { replacements: { dni, agenteNombre, leyId: r.ley_id ?? null, leyNombre: r.ley_nombre ?? null, fechaBaja } },
  );
}

async function setEstado(sequelize: Sequelize, req: Request, res: Response, estado: ReclamoEstado) {
  try {
    await ensureReclamosHaberesTable(sequelize);
    const id = Number(req.params.id);
    const userId = (req as any).auth?.principalId ?? null;
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Parametros invalidos' });
    }

    if (estado === 'PENDIENTE') {
      await sequelize.query(
        `UPDATE reclamos_haberes_estado
            SET estado = 'PENDIENTE', reclamado_at = NULL, reclamado_por = NULL,
                omitido_at = NULL, omitido_por = NULL, updated_at = NOW()
          WHERE id = :id`,
        { replacements: { id } },
      );
    } else {
      const nowField = estado === 'RECLAMADO' ? 'reclamado_at' : 'omitido_at';
      const userField = estado === 'RECLAMADO' ? 'reclamado_por' : 'omitido_por';
      await sequelize.query(
        `UPDATE reclamos_haberes_estado
            SET estado = :estado, ${nowField} = NOW(), ${userField} = :userId, updated_at = NOW()
          WHERE id = :id`,
        { replacements: { id, estado, userId } },
      );
    }

    trackAction('reclamo_haberes_estado', { actor: userId, id, estado });
    return res.json({ ok: true, data: { id, estado } });
  } catch (err: any) {
    logger.error({ msg: 'Error actualizando reclamo de haberes', err });
    return res.status(500).json({ ok: false, error: 'Error al actualizar reclamo' });
  }
}

export function buildReclamosHaberesRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      await ensureReclamosHaberesTable(sequelize);
      const estadoFiltro = String(req.query.estado || 'pendientes').toLowerCase();

      const where =
        estadoFiltro === 'reclamados' ? "WHERE e.estado = 'RECLAMADO'" :
        estadoFiltro === 'omitidos' ? "WHERE e.estado = 'OMITIDO'" :
        estadoFiltro === 'todos' ? '' :
        "WHERE e.estado = 'PENDIENTE'";

      const rows = await sequelize.query<any>(
        `SELECT e.id, e.dni, e.agente_nombre, e.ley_id, e.ley_nombre, e.fecha_baja, e.estado,
                e.reclamado_at, e.reclamado_por, e.omitido_at,
                COALESCE(NULLIF(u.nombre, ''), u.email) AS reclamado_por_nombre
           FROM reclamos_haberes_estado e
           LEFT JOIN usuarios u ON u.id = e.reclamado_por
           ${where}
          ORDER BY e.fecha_baja DESC, e.agente_nombre ASC`,
        { type: QueryTypes.SELECT },
      );

      const data = rows.map((e) => ({
        ...e,
        fecha_baja: dateOnly(e.fecha_baja) || String(e.fecha_baja).slice(0, 10),
      }));

      return res.json({ ok: true, data, meta: { total: data.length, estado: estadoFiltro } });
    } catch (err: any) {
      logger.error({ msg: 'Error listando reclamos de haberes', err });
      return res.status(500).json({ ok: false, error: 'Error al listar reclamos' });
    }
  });

  router.post('/:id/reclamado', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'RECLAMADO'));
  router.post('/:id/omitir', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'OMITIDO'));
  router.post('/:id/pendiente', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'PENDIENTE'));

  return router;
}
