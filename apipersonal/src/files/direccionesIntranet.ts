// src/files/direccionesIntranet.ts
// Lee los xlsx de D:\G\DIRECCIONES INTRANET y mantiene un Map<dni, dirección>
// en memoria con TTL de 60 minutos. Todas las fuentes se fusionan; en caso de
// dni duplicado gana la fila con FECHA MODIFICACION más reciente.

import path from 'path';
import * as XLSX from 'xlsx';
import { logger } from '../logging/logger';

export interface DireccionIntranet {
  dependencia:       string | null;
  legajo:            number | null;
  calle:             string | null;
  numero:            string | null;
  entre_calle_1:     string | null;
  entre_calle_2:     string | null;
  piso:              string | null;
  departamento:      string | null;
  localidad:         string | null;
  codigo_postal:     string | null;
  otras_referencias: string | null;
  email:             string | null;
  telefonos:         string | null;
  estado:            string | null;
  fecha_modificacion: string | null;
}

const DIRS_PATH = process.env.DIRECCIONES_INTRANET_PATH ?? 'D:\\G\\DIRECCIONES INTRANET';
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutos

const FILES = [
  'direccioneshtal.xlsx',
  'Direcciones Hospital.xlsx',
  'Direcciones UPA 4.xlsx',
  'Direcciones UPA18.xlsx',
];

let cache: Map<number, DireccionIntranet> | null = null;
let cacheAt = 0;

function toStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function loadFromFile(filePath: string): Array<{ dni: number; fecha: Date | null; dir: DireccionIntranet }> {
  try {
    const wb = XLSX.readFile(filePath, { cellDates: true });
    const ws = wb.Sheets['Listado'];
    if (!ws) return [];

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    const result: Array<{ dni: number; fecha: Date | null; dir: DireccionIntranet }> = [];

    for (const row of rows) {
      const rawDni = row['NRO DOCUMENTO'];
      const dni = toNum(rawDni);
      if (!dni) continue;

      result.push({
        dni,
        fecha: toDate(row['FECHA MODIFICACION']),
        dir: {
          dependencia:       toStr(row['DEPENDENCIA']),
          legajo:            toNum(row['LEGAJO']),
          calle:             toStr(row['CALLE']),
          numero:            toStr(row['NUMERO']),
          entre_calle_1:     toStr(row['ENTRE CALLE 1']),
          entre_calle_2:     toStr(row['ENTRE CALLE 2']),
          piso:              toStr(row['PISO']),
          departamento:      toStr(row['DEPARTAMENTO']),
          localidad:         toStr(row['LOCALIDAD']),
          codigo_postal:     toStr(row['CODIGO POSTAL']),
          otras_referencias: toStr(row['OTRAS REFERENCIAS']),
          email:             toStr(row['EMAIL']),
          telefonos:         toStr(row['TELEFONOS']),
          estado:            toStr(row['ESTADO']),
          fecha_modificacion: toStr(row['FECHA MODIFICACION']),
        },
      });
    }

    return result;
  } catch (err: any) {
    logger.warn({ msg: '[direccionesIntranet] no se pudo leer', file: filePath, err: err?.message });
    return [];
  }
}

function buildCache(): Map<number, DireccionIntranet> {
  // Map temporal con fecha de cada entrada para resolver duplicados
  const byDni = new Map<number, { fecha: Date | null; dir: DireccionIntranet }>();

  for (const file of FILES) {
    const full = path.join(DIRS_PATH, file);
    const rows = loadFromFile(full);
    for (const { dni, fecha, dir } of rows) {
      const existing = byDni.get(dni);
      if (!existing) {
        byDni.set(dni, { fecha, dir });
      } else {
        // Gana la fila con fecha más reciente
        const existingDate = existing.fecha?.getTime() ?? 0;
        const newDate = fecha?.getTime() ?? 0;
        if (newDate > existingDate) {
          byDni.set(dni, { fecha, dir });
        }
      }
    }
  }

  const result = new Map<number, DireccionIntranet>();
  for (const [dni, { dir }] of byDni) {
    result.set(dni, dir);
  }

  logger.info({ msg: '[direccionesIntranet] cache cargado', total: result.size });
  return result;
}

export function getDireccion(dni: number): DireccionIntranet | null {
  const now = Date.now();
  if (!cache || now - cacheAt > CACHE_TTL_MS) {
    cache = buildCache();
    cacheAt = now;
  }
  return cache.get(dni) ?? null;
}

/** Fuerza recarga del cache (útil si se actualizaron los xlsx) */
export function invalidateDireccionesCache(): void {
  cache = null;
  cacheAt = 0;
}
