// src/routes/licenciasConsultorio.routes.ts
// GET  /api/v1/licencias-consultorio           → JSON (padrón + licencias)
// GET  /api/v1/licencias-consultorio/export     → .xlsx (mismo dato, aplanado)
// POST /api/v1/licencias-consultorio/invalidar-cache
//
// Página SOLO jefa de consultorio: consulta de licencias de su grupo de profesionales.
// Grupo = padrón desde la DB:
//   - LEY 10471 (ley_id 4 Guardia / 5 Planta): SOLO médicos y kinesiólogos.
//     (No enfermería, obstetricia, bioquímica, trabajo social, farmacia, etc.)
//   - Becados médicos (ley_id 6..13 con ocupación médica): MEDICA/MEDICO*/MD./RESIDENTE.
// Licencias = del Excel SIAPE (LICENCIAS_PDF_DIR\SIAPE\*.xlsx), pegadas por DNI.
//   Se EXCLUYEN novedades PRESENTE / AUSENTE (no son licencias).
//
// Read-only. Cacheado 5 min.

import path from 'path';
import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { findExcelInDir, parseExcelSiape } from './comparacionSiape.routes';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const LEY_10471 = [4, 5];
const LEY_BECAS = [6, 7, 8, 9, 10, 11, 12, 13];

type PadronRow = {
  dni: number;
  apellido: string;
  nombre: string;
  ley_id: number;
  ley_nombre: string | null;
  ocupacion_nombre: string | null;
  servicio_nombre: string | null;
  grupo: '10471' | 'BECADO';
};

interface LicItem {
  novedad: string;
  desde: string;
  hasta: string;
  dias: number;
  justificado: string;
}

const CACHE_TTL = 5 * 60 * 1000;
let cache: { ts: number; data: any } | null = null;

function dateToStr(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

function diasEntre(desde: Date | null, hasta: Date | null): number {
  if (!desde) return 0;
  const h = hasta ?? desde;
  const a = Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate());
  const b = Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate());
  return Math.round((b - a) / 86400000) + 1;
}

// Novedades que NO son licencias y no deben mostrarse.
function esNovedadIgnorable(nov: string): boolean {
  const n = String(nov ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return n.startsWith('PRESENTE') || n.startsWith('AUSENTE');
}

async function loadPadron(sequelize: Sequelize): Promise<PadronRow[]> {
  // Un registro por DNI: el agente activo más reciente.
  // - 10471 (4/5): SOLO médicos (MEDIC*, M_DIC%) y kinesiólogos (%KINESIOLOG%).
  // - Becados (6..13): solo ocupación médica (MEDIC*, M_DIC%, MD.*, RESIDENTE*).
  return sequelize.query<PadronRow>(
    `
      SELECT
        p.dni,
        p.apellido,
        p.nombre,
        a.ley_id,
        l.nombre AS ley_nombre,
        oc.nombre AS ocupacion_nombre,
        COALESCE(srv.nombre, ags.nombre) AS servicio_nombre,
        CASE WHEN a.ley_id IN (:ley10471) THEN '10471' ELSE 'BECADO' END AS grupo
      FROM personal p
      JOIN agentes a ON a.id = (
        SELECT ax.id
        FROM agentes ax
        WHERE ax.dni = p.dni
          AND ax.deleted_at IS NULL
        ORDER BY (ax.estado_empleo = 'ACTIVO' AND ax.fecha_egreso IS NULL) DESC, ax.id DESC
        LIMIT 1
      )
      LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
      LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
      LEFT JOIN agentes_servicios ags ON ags.id = (
        SELECT ags1.id
        FROM agentes_servicios ags1
        WHERE ags1.dni = p.dni
          AND ags1.deleted_at IS NULL
          AND (ags1.fecha_hasta IS NULL OR ags1.fecha_hasta >= CURDATE())
        ORDER BY ags1.fecha_desde DESC, ags1.id DESC
        LIMIT 1
      )
      LEFT JOIN servicios srv ON srv.id = ags.servicio_id AND srv.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
        AND a.estado_empleo = 'ACTIVO'
        AND (
          (
            a.ley_id IN (:ley10471)
            AND (
              UPPER(oc.nombre) LIKE 'MEDIC%'
              OR UPPER(oc.nombre) LIKE 'M_DIC%'
              OR UPPER(oc.nombre) LIKE '%KINESIOLOG%'
            )
          )
          OR (
            a.ley_id IN (:leyBecas)
            AND (
              UPPER(oc.nombre) LIKE 'MEDIC%'
              OR UPPER(oc.nombre) LIKE 'M_DIC%'
              OR UPPER(oc.nombre) LIKE 'MD.%'
              OR UPPER(oc.nombre) LIKE 'RESIDENTE%'
            )
          )
        )
      ORDER BY p.apellido ASC, p.nombre ASC
    `,
    { replacements: { ley10471: LEY_10471, leyBecas: LEY_BECAS }, type: QueryTypes.SELECT }
  );
}

async function buildData(sequelize: Sequelize) {
  const padron = await loadPadron(sequelize);

  const baseDir = String((env as any).LICENCIAS_PDF_DIR || '').trim();
  let archivoSiape: string | null = null;
  let siapeError: string | null = null;
  const licByDni = new Map<string, LicItem[]>();

  if (!baseDir) {
    siapeError = 'LICENCIAS_PDF_DIR no configurado en .env';
  } else {
    const siapeFile = findExcelInDir(path.join(baseDir, 'SIAPE'));
    if (!siapeFile) {
      siapeError = `No se encontró Excel en ${path.join(baseDir, 'SIAPE')}`;
    } else {
      archivoSiape = path.basename(siapeFile);
      try {
        for (const r of parseExcelSiape(siapeFile)) {
          if (!r.dni) continue;
          if (esNovedadIgnorable(r.novedad)) continue; // sin PRESENTE / AUSENTE
          const arr = licByDni.get(r.dni) || [];
          arr.push({
            novedad: r.novedad,
            desde: dateToStr(r.desde),
            hasta: dateToStr(r.hasta),
            dias: diasEntre(r.desde, r.hasta),
            justificado: r.justificado || '',
          });
          licByDni.set(r.dni, arr);
        }
      } catch (err: any) {
        siapeError = err?.message || 'Error leyendo Excel SIAPE';
      }
    }
  }

  const agentes = padron.map((p) => {
    const licencias = (licByDni.get(String(p.dni)) || []).sort((a, b) =>
      String(a.desde).localeCompare(String(b.desde))
    );
    return {
      dni: p.dni,
      apellido: p.apellido,
      nombre: p.nombre,
      ley_id: p.ley_id,
      ley_nombre: p.ley_nombre,
      grupo: p.grupo,
      ocupacion_nombre: p.ocupacion_nombre,
      servicio_nombre: p.servicio_nombre || 'Sin servicio',
      licencias,
      dias_licencia: licencias.reduce((acc, l) => acc + (l.dias || 0), 0),
    };
  });

  const conLicencia = agentes.filter((a) => a.licencias.length > 0).length;

  return {
    resumen: {
      total_padron: agentes.length,
      con_licencia: conLicencia,
      sin_licencia: agentes.length - conLicencia,
      diez_mil_471: agentes.filter((a) => a.grupo === '10471').length,
      becados: agentes.filter((a) => a.grupo === 'BECADO').length,
    },
    archivo_siape: archivoSiape,
    siape_error: siapeError,
    agentes,
    generado: new Date().toISOString(),
  };
}

async function getData(sequelize: Sequelize, refresh: boolean) {
  if (!refresh && cache && Date.now() - cache.ts < CACHE_TTL) return { data: cache.data, cached: true };
  const data = await buildData(sequelize);
  cache = { ts: Date.now(), data };
  return { data, cached: false };
}

export function buildLicenciasConsultorioRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { data, cached } = await getData(sequelize, req.query.refresh === '1');
      return res.json({ ok: true, ...data, cached });
    } catch (err: any) {
      logger.error({ msg: '[licencias-consultorio] error', error: err?.message, sql: err?.sql });
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando licencias de consultorio' });
    }
  });

  router.get('/export', async (req: Request, res: Response) => {
    try {
      if (!XLSX) return res.status(503).json({ ok: false, error: 'Módulo xlsx no disponible' });
      const { data } = await getData(sequelize, req.query.refresh === '1');

      // Aplanado: una fila por licencia; agentes sin licencia van con columnas de licencia vacías.
      const filas: any[] = [];
      for (const a of data.agentes) {
        const base = {
          Apellido: a.apellido,
          Nombre: a.nombre,
          DNI: a.dni,
          Grupo: a.grupo === '10471' ? 'Ley 10471' : 'Becado',
          Ley: a.ley_nombre || '',
          Ocupación: a.ocupacion_nombre || '',
          Servicio: a.servicio_nombre,
        };
        if (a.licencias.length === 0) {
          filas.push({ ...base, Novedad: '', Desde: '', Hasta: '', Días: '', Justificado: '' });
        } else {
          for (const l of a.licencias) {
            filas.push({
              ...base,
              Novedad: l.novedad,
              Desde: l.desde,
              Hasta: l.hasta,
              Días: l.dias || '',
              Justificado: l.justificado || '',
            });
          }
        }
      }

      const ws = XLSX.utils.json_to_sheet(filas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Licencias');
      const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const fecha = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="licencias_consultorio_${fecha}.xlsx"`);
      return res.send(buf);
    } catch (err: any) {
      logger.error({ msg: '[licencias-consultorio] export error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error exportando' });
    }
  });

  router.post('/invalidar-cache', (_req, res) => {
    cache = null;
    return res.json({ ok: true });
  });

  return router;
}
