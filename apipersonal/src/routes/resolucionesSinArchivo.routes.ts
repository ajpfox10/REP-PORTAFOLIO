// src/routes/resolucionesSinArchivo.routes.ts
// Banner "resoluciones sin archivo escaneado" (dashboard + página Resoluciones).
//
// GET    /resoluciones-sin-archivo            → resoluciones sin archivo_id, salvo las desactivadas.
//          estado: EMPATE (hay varios archivos posibles, elegir a mano) |
//                  ENCONTRADO (hay uno, falta confirmarlo/vincularlo) |
//                  SIN_ARCHIVO (no está en RESOLUCIONES Y VARIOS)
// POST   /resoluciones-sin-archivo/:id/ocultar → desactiva la alerta de esa resolución
// DELETE /resoluciones-sin-archivo/:id/ocultar → la vuelve a activar
// POST   /resoluciones-sin-archivo/buscar { ids? } → registra PDF nuevos de la carpeta + vincula
//
// Cuando la resolución queda vinculada (archivo_id) sale sola del listado.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { matchResolucionGeneral, ArchivoGeneral } from '../services/resolucionArchivoMatch';
import { registrarArchivosFaltantes, vincularPendientes } from '../services/resolucionesVincular';

const inicializadas = new WeakSet<Sequelize>();
async function ensureTabla(sequelize: Sequelize) {
  if (inicializadas.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS resoluciones_alertas_ocultas (
      resolucion_id INT NOT NULL,
      ocultado_por  INT NULL,
      ocultado_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (resolucion_id),
      CONSTRAINT fk_res_alertas_ocultas_res FOREIGN KEY (resolucion_id) REFERENCES resoluciones (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  inicializadas.add(sequelize);
}

const userId = (req: Request): number | null => {
  const a = (req as any).auth;
  return a?.principalType === 'user' || a?.principalType === 'dev' ? Number(a.principalId) || null : null;
};

export function buildResolucionesSinArchivoRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      await ensureTabla(sequelize);
      const filas = await sequelize.query<any>(
        `SELECT r.id, r.dni, r.numero, r.motivo, r.fecha, p.apellido, p.nombre
           FROM resoluciones r
           LEFT JOIN personal p ON p.dni = r.dni
           LEFT JOIN resoluciones_alertas_ocultas o ON o.resolucion_id = r.id
          WHERE r.archivo_id IS NULL AND r.deleted_at IS NULL
            AND r.numero IS NOT NULL AND TRIM(r.numero) <> ''
            AND o.resolucion_id IS NULL
          ORDER BY r.fecha DESC, r.id DESC`,
        { type: QueryTypes.SELECT },
      );
      const generales = await sequelize.query<ArchivoGeneral>(
        `SELECT id, nombre, nombre_archivo_original FROM tblarchivos
          WHERE dni = 1 AND ruta LIKE '%RESOLUCIONES Y VARIOS' AND deleted_at IS NULL`,
        { type: QueryTypes.SELECT },
      );
      const [{ ocultas }] = await sequelize.query<any>(
        `SELECT COUNT(*) AS ocultas FROM resoluciones_alertas_ocultas o
           JOIN resoluciones r ON r.id = o.resolucion_id
          WHERE r.archivo_id IS NULL AND r.deleted_at IS NULL`,
        { type: QueryTypes.SELECT },
      );

      const data = filas.map(r => {
        const m = matchResolucionGeneral(r, generales, r.apellido || '');
        const estado = m.archivo ? 'ENCONTRADO' : m.candidatos.length ? 'EMPATE' : 'SIN_ARCHIVO';
        return {
          id: r.id, dni: r.dni, numero: r.numero, motivo: r.motivo, fecha: r.fecha,
          agente: [r.apellido, r.nombre].filter(Boolean).join(', '),
          estado,
          posibles: (m.archivo ? [m.archivo] : m.candidatos).slice(0, 4).map(a => a.nombre_archivo_original || a.nombre),
        };
      });
      res.json({ ok: true, data, ocultas: Number(ocultas) || 0 });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  // POST /buscar  { ids?: number[] } → registra PDF nuevos de la carpeta y vincula los que tengan
  // un solo candidato. Sin ids revisa todas las pendientes (botón "↻ Buscar de nuevo").
  router.post('/buscar', async (req: Request, res: Response) => {
    try {
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0).slice(0, 500)
        : undefined;
      const registrados = await registrarArchivosFaltantes(sequelize);
      const vinculados = await vincularPendientes(sequelize, ids);
      res.json({ ok: true, registrados, vinculados });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  router.post('/:id/ocultar', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ ok: false, error: 'ID inválido' }); return; }
    try {
      await ensureTabla(sequelize);
      await sequelize.query(
        `INSERT INTO resoluciones_alertas_ocultas (resolucion_id, ocultado_por) VALUES (:id, :u)
         ON DUPLICATE KEY UPDATE ocultado_por = VALUES(ocultado_por), ocultado_at = CURRENT_TIMESTAMP`,
        { replacements: { id, u: userId(req) } },
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  router.delete('/:id/ocultar', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ ok: false, error: 'ID inválido' }); return; }
    try {
      await ensureTabla(sequelize);
      await sequelize.query('DELETE FROM resoluciones_alertas_ocultas WHERE resolucion_id = :id', { replacements: { id } });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  return router;
}
