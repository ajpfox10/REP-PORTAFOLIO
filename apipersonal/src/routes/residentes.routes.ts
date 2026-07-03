import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

type ResidenteBase = {
  dni: number;
  apellido: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  servicio_id: number | null;
  servicio_nombre: string | null;
};

type LicenciaRow = {
  apellido_nombre: string;
  dni: number;
  tipo_licencia: string;
  cant_dias: number;
};

const LIC_CACHE_TTL_MS = 5 * 60 * 1000;
let licCache: { ts: number; rows: LicenciaRow[] } | null = null;

function isResidenteSql() {
  return `(
    a.ley_id = 11
    OR a.ocupacion_id = 132
    OR LOWER(COALESCE(l.nombre, '')) LIKE '%residente%'
    OR LOWER(COALESCE(oc.nombre, '')) LIKE '%residente%'
  )`;
}

function readLicenciasPendientes(): { rows: LicenciaRow[]; source: string | null; error: string | null } {
  if (licCache && Date.now() - licCache.ts < LIC_CACHE_TTL_MS) {
    return { rows: licCache.rows, source: null, error: null };
  }
  if (!XLSX) return { rows: [], source: null, error: 'Modulo xlsx no disponible' };

  const dir = String((env as any).EXCEL_ASISTENCIA_DIR || '').trim();
  if (!dir) return { rows: [], source: null, error: 'EXCEL_ASISTENCIA_DIR no configurado' };

  const xlsPath = path.join(dir, 'Tiempo Acumulado.xls');
  if (!fs.existsSync(xlsPath)) return { rows: [], source: xlsPath, error: `Archivo no encontrado: ${xlsPath}` };

  try {
    const wb = XLSX.readFile(xlsPath, { cellDates: true, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    const rows: LicenciaRow[] = [];

    for (let i = 5; i < raw.length; i += 1) {
      const r = raw[i] as unknown[];
      if (!r || r[2] == null) continue;
      const dni = parseInt(String(r[2] ?? '').replace(/\D/g, ''), 10);
      if (!dni) continue;
      const tipo = String(r[4] ?? '').trim();
      if (!tipo || tipo === 'Tipo de Licencia') continue;
      const cantDias = typeof r[5] === 'number' ? r[5] : parseFloat(String(r[5] ?? '')) || 0;
      rows.push({
        apellido_nombre: String(r[0] ?? '').trim(),
        dni,
        tipo_licencia: tipo,
        cant_dias: cantDias,
      });
    }

    licCache = { ts: Date.now(), rows };
    return { rows, source: xlsPath, error: null };
  } catch (err: any) {
    return { rows: [], source: xlsPath, error: err?.message || 'Error leyendo Tiempo Acumulado.xls' };
  }
}

export function buildResidentesRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/resumen', async (_req: Request, res: Response) => {
    try {
      const residentes = await sequelize.query<ResidenteBase>(
        `
          SELECT
            p.dni,
            p.apellido,
            p.nombre,
            p.email,
            p.telefono,
            ags.servicio_id,
            COALESCE(srv.nombre, ags.nombre, 'Sin servicio') AS servicio_nombre
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
            AND ${isResidenteSql()}
          ORDER BY servicio_nombre ASC, p.apellido ASC, p.nombre ASC
        `,
        { type: QueryTypes.SELECT }
      );

      const rotaciones = await sequelize.query<any>(
        `
          SELECT
            rr.id,
            rr.dni,
            rr.fecha_desde,
            rr.fecha_hasta,
            rr.servicio,
            rr.horarios,
            rr.dias,
            rr.observaciones,
            p.apellido,
            p.nombre
          FROM residentes_rotacion rr
          LEFT JOIN personal p ON p.dni = rr.dni AND p.deleted_at IS NULL
          WHERE rr.deleted_at IS NULL
          ORDER BY COALESCE(rr.fecha_hasta, '2999-12-31') DESC, rr.fecha_desde DESC, rr.id DESC
        `,
        { type: QueryTypes.SELECT }
      );

      const residentesByDni = new Map(residentes.map((r) => [Number(r.dni), r]));
      const servicioMap = new Map<string, { servicio_id: number | null; servicio_nombre: string; total: number }>();
      for (const r of residentes) {
        const servicioNombre = String(r.servicio_nombre || 'Sin servicio');
        const key = `${r.servicio_id ?? 'null'}|${servicioNombre}`;
        const current = servicioMap.get(key) || { servicio_id: r.servicio_id, servicio_nombre: servicioNombre, total: 0 };
        current.total += 1;
        servicioMap.set(key, current);
      }

      const today = new Date().toISOString().slice(0, 10);
      const activeRotaciones = rotaciones.filter((r) => !r.fecha_hasta || String(r.fecha_hasta).slice(0, 10) >= today);
      const pastRotaciones = rotaciones.filter((r) => r.fecha_hasta && String(r.fecha_hasta).slice(0, 10) < today);

      const licencias = readLicenciasPendientes();
      const licenciasResidentes = licencias.rows.filter((row) => residentesByDni.has(Number(row.dni)));
      const licenciasByDni = new Map<number, { dni: number; apellido_nombre: string; total_dias: number; tipos: string[] }>();
      for (const row of licenciasResidentes) {
        const current = licenciasByDni.get(row.dni) || {
          dni: row.dni,
          apellido_nombre: row.apellido_nombre,
          total_dias: 0,
          tipos: [],
        };
        current.total_dias += Number(row.cant_dias || 0);
        if (!current.tipos.includes(row.tipo_licencia)) current.tipos.push(row.tipo_licencia);
        licenciasByDni.set(row.dni, current);
      }

      const sinEmail = residentes.filter((r) => !String(r.email || '').trim());
      const sinTelefono = residentes.filter((r) => !String(r.telefono || '').trim());

      return res.json({
        ok: true,
        data: {
          totals: {
            residentes: residentes.length,
            servicios: servicioMap.size,
            rotacionesActivas: activeRotaciones.length,
            rotacionesPasadas: pastRotaciones.length,
            licenciasConDias: Array.from(licenciasByDni.values()).filter((r) => r.total_dias > 0).length,
            diasLicencia: Array.from(licenciasByDni.values()).reduce((acc, r) => acc + r.total_dias, 0),
            sinEmail: sinEmail.length,
            sinTelefono: sinTelefono.length,
          },
          porServicio: Array.from(servicioMap.values()).sort((a, b) => b.total - a.total || a.servicio_nombre.localeCompare(b.servicio_nombre, 'es')),
          rotacionesActivas: activeRotaciones.slice(0, 12),
          rotacionesPasadas: pastRotaciones.slice(0, 12),
          licencias: Array.from(licenciasByDni.values()).sort((a, b) => b.total_dias - a.total_dias).slice(0, 12),
          contacto: {
            sinEmail: sinEmail.slice(0, 12).map((r) => ({ dni: r.dni, apellido: r.apellido, nombre: r.nombre, servicio_nombre: r.servicio_nombre })),
            sinTelefono: sinTelefono.slice(0, 12).map((r) => ({ dni: r.dni, apellido: r.apellido, nombre: r.nombre, servicio_nombre: r.servicio_nombre })),
          },
          sources: {
            licencias: licencias.source,
            licenciasError: licencias.error,
          },
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[residentes] resumen error', error: err?.message, sql: err?.sql });
      return res.status(500).json({ ok: false, error: err?.message || 'Error cargando resumen de residentes' });
    }
  });

  return router;
}
