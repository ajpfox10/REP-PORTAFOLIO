// src/routes/stress.routes.ts
// Alertas de stress post-vacacional
//
// GET /stress/alertas
//   → Espeja `cola_carga_stress` (lo mismo que ve el robot de carga): cada agente
//     con su estado (pendiente/cargado/omitido/error) + motivo. La cola la puebla
//     `cargar_stress.mjs --build` con el umbral y las reglas de la carga.
// GET /stress/carga-estado
//   → Conteos por estado + última corrida (banner).

import { Router, Request, Response } from 'express';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { Sequelize } from 'sequelize';

export function buildStressRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /api/v1/stress/carga-estado
  //   Estado de la carga automática de ANUAL COMPLEMENTARIA en SIAPE (tabla cola_carga_stress).
  //   Devuelve conteos por estado + última corrida, para el banner de la página.
  router.get(
    '/carga-estado',
    requirePermission('crud:*:*'),
    async (_req: Request, res: Response) => {
      try {
        const anio = new Date().getFullYear() - 1; // "año anterior al en curso"
        const [rows] = await sequelize.query(
          `SELECT estado, COUNT(*) AS c FROM cola_carga_stress WHERE anio = :anio GROUP BY estado`,
          { replacements: { anio } }
        );
        const [[meta]] = (await sequelize.query(
          `SELECT MAX(actualizado_at) AS ultima, COUNT(*) AS total FROM cola_carga_stress WHERE anio = :anio`,
          { replacements: { anio } }
        )) as any;
        const [pend] = await sequelize.query(
          `SELECT dni, apellido, dias, licencia FROM cola_carga_stress WHERE anio = :anio AND estado = 'pendiente' ORDER BY dias_transcurridos DESC`,
          { replacements: { anio } }
        );
        const [errs] = await sequelize.query(
          `SELECT dni, apellido, motivo FROM cola_carga_stress WHERE anio = :anio AND estado = 'error' ORDER BY dni`,
          { replacements: { anio } }
        );
        const conteo: Record<string, number> = { cargado: 0, error: 0, omitido: 0, pendiente: 0 };
        for (const r of rows as { estado: string; c: number }[]) conteo[r.estado] = Number(r.c);

        // Estado de la última descarga del Excel "Tiempo Acumulado" (Discoverer)
        let descarga: unknown = null;
        try {
          const [[d]] = (await sequelize.query(
            `SELECT estado, motivo, filas, actualizado_at FROM descarga_tiempo_acumulado ORDER BY id DESC LIMIT 1`
          )) as any;
          descarga = d ?? null;
        } catch { /* tabla puede no existir aún */ }

        return res.json({
          ok: true,
          anio,
          total: Number(meta?.total ?? 0),
          ultima: meta?.ultima ?? null,
          conteo,
          pendientes: pend,
          errores: errs,
          descarga,
        });
      } catch (err: unknown) {
        logger.error({ msg: 'Error stress carga-estado', err });
        return res.status(500).json({ ok: false, error: 'Error consultando estado de carga' });
      }
    }
  );

  // GET /api/v1/stress/alertas
  //   Espeja EXACTAMENTE lo que ve el script de carga: lee `cola_carga_stress`
  //   (poblada por `cargar_stress.mjs --build`, con el mismo umbral y reglas) y
  //   devuelve cada agente con su estado (pendiente/cargado/omitido/error) + motivo.
  //   El servicio se enriquece en vivo desde la DB. Así la página y el robot
  //   nunca se contradicen: si el robot lo cargó, figura 'cargado'; si SIAPE lo
  //   rechazó, figura 'error' con el motivo.
  router.get(
    '/alertas',
    requirePermission('crud:*:*'),
    async (_req: Request, res: Response) => {
      try {
        const anio = new Date().getFullYear() - 1; // "año anterior al en curso" (mismo que la carga)

        const [rows] = await sequelize.query(
          `SELECT c.dni,
                  c.apellido            AS nombre,
                  c.dias                AS dias_stress,
                  c.licencia,
                  c.ley,
                  c.dias_transcurridos,
                  c.estado,
                  c.motivo,
                  c.actualizado_at,
                  s.nombre              AS servicio
             FROM cola_carga_stress c
             LEFT JOIN agentes_servicios ags
                    ON ags.id = (SELECT id FROM agentes_servicios
                                  WHERE dni = c.dni AND deleted_at IS NULL AND fecha_hasta IS NULL
                                  ORDER BY id DESC LIMIT 1)
             LEFT JOIN servicios s ON s.id = ags.servicio_id
            WHERE c.anio = :anio
            ORDER BY FIELD(c.estado,'error','pendiente','omitido','cargado'),
                     c.dias_transcurridos DESC`,
          { replacements: { anio } }
        );

        const data = (rows as Record<string, unknown>[]).map(r => ({
          dni:                Number(r.dni),
          nombre:             String(r.nombre ?? ''),
          dias_transcurridos: r.dias_transcurridos == null ? null : Number(r.dias_transcurridos),
          ley:                (r.ley as string | null) ?? '—',
          servicio:           (r.servicio as string | null) ?? '—',
          dias_stress:        r.dias_stress == null ? null : Number(r.dias_stress),
          licencia:           (r.licencia as string | null) ?? null,
          estado:             String(r.estado ?? 'pendiente'),
          motivo:             (r.motivo as string | null) ?? null,
          actualizado_at:     r.actualizado_at ? String(r.actualizado_at) : null,
        }));

        return res.json({ ok: true, anio, data, total: data.length });

      } catch (err: unknown) {
        logger.error({ msg: 'Error stress alertas', err });
        return res.status(500).json({ ok: false, error: 'Error procesando alertas de stress' });
      }
    }
  );

  return router;
}
