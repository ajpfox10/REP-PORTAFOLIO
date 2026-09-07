// src/routes/ausentismo.routes.ts
// Nivel de ausentismo por dependencia / servicio / sector, abierto por régimen
// horario (Guardia = turno de más de 12 hs; Planta = 12 o menos).
//
// GET /api/v1/ausentismo/resumen?desde=2025-01&hasta=2025-12&nivel=servicio
//     Devuelve grupos + totales + apertura por régimen + detalle por agente.
//     `desde`/`hasta` aceptan YYYY (año completo), YYYY-MM o YYYY-MM-DD.
//     nivel: dependencia | servicio | sector.
//     Filtros opcionales: dependencia, servicio, ocupacion (clave normalizada),
//     regimen (GUARDIA|PLANTA|TODOS).
//
// GET /api/v1/ausentismo/mapeo
//     Mapeo vigente de novedades (editable en EXCEL_ASISTENCIA_DIR\mapeo.ausentismo.json).
//
// GET /api/v1/ausentismo/estructura
//     Dependencias, servicios y ocupaciones con agentes vigentes (combos de filtro).
//
// POST /api/v1/ausentismo/importar-historial?modo=agregar|reemplazar
//     Carga los historialsiape*.xlsx de EXCEL_ASISTENCIA_DIR en la tabla
//     `historial`. 'agregar' no borra nada; 'reemplazar' borra sólo el rango
//     que los archivos cubren y lo vuelve a cargar.
//
// GET /api/v1/ausentismo/periodos
//     Años disponibles en la tabla historial (para poblar el selector).

import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import {
  evaluarAusentismo, leerMapeo, mapeoPath, claveOcupacion, etiquetaOcupacion,
  type Nivel, type Regimen,
} from '../services/ausentismoEval';
import { importarHistorialSiape, listarArchivos, type ModoImport } from '../services/historialSiapeImport';

const NIVELES: Nivel[] = ['dependencia', 'servicio', 'sector'];

export function buildAusentismoRouter(sequelize: Sequelize) {
  const router = Router();

  // ── GET /resumen ────────────────────────────────────────────────────────────
  router.get(
    '/resumen',
    requirePermission('crud:*:*'),
    async (req: Request, res: Response) => {
      try {
        const desde = String(req.query.desde || '').trim();
        const hasta = String(req.query.hasta || '').trim();
        if (!desde || !hasta) {
          return res.status(400).json({ error: 'Faltan los parámetros desde y hasta' });
        }
        const ok = (v: string) => /^\d{4}$/.test(v) || /^\d{4}-\d{2}$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v);
        if (!ok(desde) || !ok(hasta)) {
          return res.status(400).json({ error: 'Formato inválido: usar YYYY, YYYY-MM o YYYY-MM-DD' });
        }

        const nivelRaw = String(req.query.nivel || 'servicio') as Nivel;
        const nivel = NIVELES.includes(nivelRaw) ? nivelRaw : 'servicio';
        const regimenRaw = String(req.query.regimen || 'TODOS').toUpperCase();
        const regimen = (regimenRaw === 'GUARDIA' || regimenRaw === 'PLANTA' ? regimenRaw : 'TODOS') as Regimen | 'TODOS';

        const data = await evaluarAusentismo({
          desde, hasta, nivel, regimen,
          dependencia: req.query.dependencia ? String(req.query.dependencia) : undefined,
          servicio: req.query.servicio ? String(req.query.servicio) : undefined,
          ocupacion: req.query.ocupacion ? String(req.query.ocupacion) : undefined,
        }, sequelize);

        return res.json(data);
      } catch (e: any) {
        logger.error({ msg: 'ausentismo/resumen', error: e?.message, stack: e?.stack });
        return res.status(500).json({ error: 'Error calculando el ausentismo', detalle: e?.message });
      }
    },
  );

  // ── GET /mapeo ──────────────────────────────────────────────────────────────
  router.get(
    '/mapeo',
    requirePermission('crud:*:*'),
    async (_req: Request, res: Response) => {
      return res.json({ archivo: mapeoPath(), mapeo: leerMapeo() });
    },
  );

  // ── GET /estructura ─────────────────────────────────────────────────────────
  router.get(
    '/estructura',
    requirePermission('crud:*:*'),
    async (_req: Request, res: Response) => {
      try {
        const rows: any[] = await sequelize.query(`
          SELECT COALESCE(dep.nombre, 'Sin asignar') AS dependencia,
                 COALESCE(srv.nombre, 'Sin asignar') AS servicio,
                 COUNT(DISTINCT vig.dni) AS agentes
            FROM (
              SELECT a1.dni, a1.servicio_id
                FROM agentes_servicios a1
                JOIN (SELECT dni, MAX(id) AS mx FROM agentes_servicios
                       WHERE deleted_at IS NULL AND fecha_hasta IS NULL GROUP BY dni) u
                  ON u.mx = a1.id
            ) vig
            LEFT JOIN servicios srv     ON srv.id = vig.servicio_id AND srv.deleted_at IS NULL
            LEFT JOIN reparticiones rep ON rep.id = srv.reparticion_id AND rep.deleted_at IS NULL
            LEFT JOIN dependencias dep  ON dep.id = rep.dependencia_id AND dep.deleted_at IS NULL
           WHERE srv.id IS NOT NULL
           GROUP BY dependencia, servicio
           ORDER BY dependencia, servicio
        `, { type: QueryTypes.SELECT });

        const mapa = new Map<string, { dependencia: string; servicios: { nombre: string; agentes: number }[] }>();
        for (const r of rows) {
          if (!mapa.has(r.dependencia)) mapa.set(r.dependencia, { dependencia: r.dependencia, servicios: [] });
          mapa.get(r.dependencia)!.servicios.push({ nombre: r.servicio, agentes: Number(r.agentes) });
        }
        // ocupaciones normalizadas (Auxiliar de Farmacia A/B → un solo grupo)
        const ocupRows: any[] = await sequelize.query(`
          SELECT o.nombre, COUNT(DISTINCT a.dni) AS agentes
            FROM agentes a
            JOIN ocupaciones o ON o.id = a.ocupacion_id
           WHERE a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'
           GROUP BY o.nombre
        `, { type: QueryTypes.SELECT });

        const ocupMapa = new Map<string, { clave: string; variantes: Map<string, number>; agentes: number }>();
        for (const r of ocupRows) {
          const clave = claveOcupacion(r.nombre);
          if (!clave) continue;
          if (!ocupMapa.has(clave)) ocupMapa.set(clave, { clave, variantes: new Map(), agentes: 0 });
          const o = ocupMapa.get(clave)!;
          o.variantes.set(String(r.nombre), Number(r.agentes));
          o.agentes += Number(r.agentes);
        }
        const ocupaciones = [...ocupMapa.values()]
          .map(o => ({ clave: o.clave, nombre: etiquetaOcupacion(o.variantes), agentes: o.agentes }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));

        return res.json({ dependencias: [...mapa.values()], ocupaciones });
      } catch (e: any) {
        logger.error({ msg: 'ausentismo/estructura', error: e?.message });
        return res.status(500).json({ error: 'Error leyendo la estructura' });
      }
    },
  );

  // ── POST /importar-historial ────────────────────────────────────────────────
  router.post(
    '/importar-historial',
    requirePermission('crud:*:*'),
    async (req: Request, res: Response) => {
      try {
        const modo: ModoImport = String(req.query.modo || 'agregar') === 'reemplazar' ? 'reemplazar' : 'agregar';
        const r = await importarHistorialSiape(sequelize, modo);
        return res.json(r);
      } catch (e: any) {
        logger.error({ msg: 'ausentismo/importar-historial', error: e?.message, stack: e?.stack });
        return res.status(500).json({ error: 'Error importando el historial', detalle: e?.message });
      }
    },
  );

  // ── GET /archivos-historial ─────────────────────────────────────────────────
  router.get(
    '/archivos-historial',
    requirePermission('crud:*:*'),
    async (_req: Request, res: Response) => {
      return res.json(listarArchivos());
    },
  );

  // ── GET /periodos ───────────────────────────────────────────────────────────
  router.get(
    '/periodos',
    requirePermission('crud:*:*'),
    async (_req: Request, res: Response) => {
      try {
        const rows: any[] = await sequelize.query(
          `SELECT YEAR(fecha_desde) AS anio, COUNT(*) AS registros
             FROM historial
            WHERE fecha_desde IS NOT NULL
            GROUP BY anio
            HAVING registros > 100
            ORDER BY anio DESC`,
          { type: QueryTypes.SELECT },
        );
        return res.json({ anios: rows.map(r => Number(r.anio)) });
      } catch (e: any) {
        logger.error({ msg: 'ausentismo/periodos', error: e?.message });
        return res.status(500).json({ error: 'Error leyendo períodos' });
      }
    },
  );

  return router;
}
