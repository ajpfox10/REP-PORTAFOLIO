// src/routes/articulo26Intranet.routes.ts
// Módulo "Art. 26 → Ministerio (FC)". Espeja el patrón de comparacion-siape:
//   GET  /api/v1/articulo-26-intranet/control    → cruza articulo_26 (todos los estados) contra
//                                                   el historial de la Intranet y el log de carga.
//   POST /api/v1/articulo-26-intranet/generar-excel → escribe el Excel que consume el robot Playwright.
//   GET  /api/v1/articulo-26-intranet/export.xlsx  → descarga ese mismo Excel.
//
// El robot es scripts/cargar_art26_intranet.py, que carga cada fila como novedad
// FC / FRANCO COMPENSATORIO en la Intranet MS y deja el log en <ART26_DIR>\resultado_carga_art26.xlsx.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

// La novedad de la Intranet bajo la que se carga el Art. 26.
const FC_LABELS = ['FRANCO COMPENSATORIO', 'FC'];

// ── Utilidades ────────────────────────────────────────────────────────────────

function normTxt(s: any): string {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normDni(v: any): string {
  return String(v ?? '').replace(/[^0-9]/g, '').trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

/** Devuelve la fecha 'YYYY-MM-DD' de un valor date/string; null si no parsea. */
function toDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
  const s = String(val).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);           // dd/mm/yyyy (formato Intranet)
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const isoStr = (d: Date | null) => d ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : '';
const ddmmyyyy = (d: Date | null) => d ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : '';
const overlap = (s1: Date, e1: Date, s2: Date, e2: Date) => s1 <= e2 && s2 <= e1;

function art26Dir(): string {
  const base = (env as any).LICENCIAS_PDF_DIR || (env as any).EXCEL_ASISTENCIA_DIR;
  return path.join(String(base || '.'), 'ART26');
}
const EXPORT_NAME    = 'art26_export.xlsx';
const HISTORIAL_NAME = 'historial_intranet.xlsx';
const LOG_NAME       = 'resultado_carga_art26.xlsx';

// ── Modelo de fila ──────────────────────────────────────────────────────────

interface Art26Row {
  id: number;
  dni: string;
  apellido: string;
  nombre: string;
  nombre_full: string;
  fecha: string;         // ISO
  dias: number;
  desde: Date | null;
  hasta: Date | null;
  desde_ddmm: string;
  hasta_ddmm: string;
  motivo: string;
  observaciones: string;
  estado: string;        // estado del Art.26 (PENDIENTE/APROBADO/...)
  jefe_nombre: string;
  estado_ms: 'YA_EN_MS' | 'PENDIENTE' | 'CONFLICTO' | 'ERROR';
  detalle_ms: string;
}

async function fetchArt26(sequelize: Sequelize): Promise<Art26Row[]> {
  const rows = await sequelize.query(`
    SELECT a.id, a.dni, a.fecha, a.dias, a.motivo, a.observaciones, a.estado, a.jefe_nombre,
           p.apellido, p.nombre
    FROM articulo_26 a
    LEFT JOIN personal p ON p.dni = a.dni
    WHERE a.deleted_at IS NULL
    ORDER BY a.fecha DESC, a.id DESC
  `, { type: QueryTypes.SELECT }) as any[];

  return rows.map(r => {
    const desde = toDate(r.fecha);
    const dias  = Number(r.dias) > 0 ? Number(r.dias) : 1;
    const hasta = desde ? addDays(desde, dias - 1) : null;
    const apellido = String(r.apellido ?? '').trim();
    const nombre   = String(r.nombre ?? '').trim();
    const nombre_full = [apellido, nombre].filter(Boolean).join(', ') || normDni(r.dni);
    return {
      id: Number(r.id),
      dni: normDni(r.dni),
      apellido, nombre, nombre_full,
      fecha: isoStr(desde),
      dias,
      desde, hasta,
      desde_ddmm: ddmmyyyy(desde),
      hasta_ddmm: ddmmyyyy(hasta),
      motivo: String(r.motivo ?? '').trim(),
      observaciones: String(r.observaciones ?? '').trim(),
      estado: String(r.estado ?? '').trim(),
      jefe_nombre: String(r.jefe_nombre ?? '').trim(),
      estado_ms: 'PENDIENTE',
      detalle_ms: '',
    };
  });
}

// ── Lectura del historial de la Intranet (opcional) ──────────────────────────

interface HistItem { dni: string; novedad: string; desde: Date | null; hasta: Date | null; esFC: boolean; }

function leerHistorial(fp: string): HistItem[] {
  if (!XLSX || !fs.existsSync(fp)) return [];
  try {
    const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    if (raw.length < 2) return [];
    const hdr = (raw[0] as any[]).map(h => String(h ?? '').toLowerCase().trim());
    const ci = (keys: string[]) => { for (const k of keys) { const i = hdr.indexOf(k); if (i >= 0) return i; } return -1; };
    const cDni   = ci(['dni', 'nro_documento', 'nro documento', 'documento']);
    const cNov   = ci(['novedad', 'codigo', 'código']);
    const cDesde = ci(['desde', 'fecha_desde', 'fecha desde']);
    const cHasta = ci(['hasta', 'fecha_hasta', 'fecha hasta']);
    const cElim  = ci(['eliminado', 'elimin']);
    const out: HistItem[] = [];
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i] as any[];
      const elim = normTxt(cElim >= 0 ? r[cElim] : '');
      if (elim.startsWith('S')) continue;
      const nov = normTxt(cNov >= 0 ? r[cNov] : '');
      out.push({
        dni: normDni(cDni >= 0 ? r[cDni] : ''),
        novedad: nov,
        desde: toDate(cDesde >= 0 ? r[cDesde] : null),
        hasta: toDate(cHasta >= 0 ? r[cHasta] : null),
        esFC: FC_LABELS.some(l => nov.includes(normTxt(l))),
      });
    }
    return out;
  } catch (e) {
    logger.warn({ msg: 'No se pudo leer historial Art.26', e: String((e as any)?.message ?? e) });
    return [];
  }
}

// ── Lectura del log de carga del robot (opcional) ────────────────────────────

interface LogItem { dni: string; desde: string; hasta: string; estado: string; detalle: string; }

function leerLog(fp: string): LogItem[] {
  if (!XLSX || !fs.existsSync(fp)) return [];
  try {
    const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr: any[] = XLSX.utils.sheet_to_json(ws, { raw: true });
    return arr.map(r => ({
      dni: normDni(r.DNI ?? r.dni),
      desde: String(r.Desde ?? r.desde ?? '').trim(),
      hasta: String(r.Hasta ?? r.hasta ?? '').trim(),
      estado: String(r.Estado ?? r.estado ?? '').trim().toUpperCase(),
      detalle: String(r.Detalle ?? r.detalle ?? '').trim(),
    }));
  } catch { return []; }
}

// ── Construcción del Excel para el robot ─────────────────────────────────────

function buildExportWorkbook(rows: Art26Row[]): any {
  const data = rows.map(r => ({
    NRO_DOCUMENTO: r.dni,
    APELLIDO:      r.apellido,
    NOMBRE:        r.nombre,
    NOVEDAD:       'FC',
    FECHA_DESDE:   r.desde_ddmm,
    FECHA_HASTA:   r.hasta_ddmm,
    DIAS:          r.dias,
    ESTADO_ART26:  r.estado,
    MOTIVO:        r.motivo,
    ID_ART26:      r.id,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ART26');
  return wb;
}

// ── Router ────────────────────────────────────────────────────────────────────

export function buildArticulo26IntranetRouter(sequelize: Sequelize) {
  const router = Router();
  const PERM = 'crud:*:*';

  // GET /control — lista + estado frente al Ministerio
  router.get('/control', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const rows = await fetchArt26(sequelize);

      const dir = art26Dir();
      const historial = leerHistorial(path.join(dir, HISTORIAL_NAME));
      const log = leerLog(path.join(dir, LOG_NAME));

      const histByDni: Record<string, HistItem[]> = {};
      for (const h of historial) if (h.dni) (histByDni[h.dni] = histByDni[h.dni] || []).push(h);
      const logByClave: Record<string, LogItem> = {};
      for (const l of log) logByClave[`${l.dni}|${l.desde}|${l.hasta}`] = l;

      for (const r of rows) {
        // 1) log del robot manda: si quedó OK ya está cargado; si ERROR, se marca
        const lg = logByClave[`${r.dni}|${r.desde_ddmm}|${r.hasta_ddmm}`];
        if (lg) {
          if (lg.estado === 'OK') { r.estado_ms = 'YA_EN_MS'; r.detalle_ms = lg.detalle || 'Cargado por el robot'; continue; }
          r.estado_ms = 'ERROR'; r.detalle_ms = lg.detalle || 'El robot no pudo cargarla'; continue;
        }
        // 2) historial de la Intranet
        if (r.desde && r.hasta) {
          const cand = histByDni[r.dni] || [];
          const fcMatch = cand.find(h => h.esFC && h.desde && h.hasta && overlap(r.desde!, r.hasta!, h.desde, h.hasta));
          if (fcMatch) {
            r.estado_ms = 'YA_EN_MS';
            r.detalle_ms = `FC ${ddmmyyyy(fcMatch.desde)}–${ddmmyyyy(fcMatch.hasta)} ya en MS`;
            continue;
          }
          const otra = cand.find(h => !h.esFC && h.desde && h.hasta && overlap(r.desde!, r.hasta!, h.desde, h.hasta));
          if (otra) {
            r.estado_ms = 'CONFLICTO';
            r.detalle_ms = `Se superpone con ${otra.novedad} ${ddmmyyyy(otra.desde)}–${ddmmyyyy(otra.hasta)}`;
            continue;
          }
        }
        r.estado_ms = 'PENDIENTE';
      }

      const resumen = {
        total: rows.length,
        pendiente: rows.filter(r => r.estado_ms === 'PENDIENTE').length,
        ya_en_ms:  rows.filter(r => r.estado_ms === 'YA_EN_MS').length,
        conflicto: rows.filter(r => r.estado_ms === 'CONFLICTO').length,
        error:     rows.filter(r => r.estado_ms === 'ERROR').length,
        por_estado_art26: rows.reduce((acc: Record<string, number>, r) => {
          acc[r.estado || '—'] = (acc[r.estado || '—'] || 0) + 1; return acc;
        }, {}),
      };

      return res.json({
        ok: true,
        resumen,
        fuentes: {
          historial: fs.existsSync(path.join(dir, HISTORIAL_NAME)) ? HISTORIAL_NAME : null,
          log:       fs.existsSync(path.join(dir, LOG_NAME)) ? LOG_NAME : null,
          export:    fs.existsSync(path.join(dir, EXPORT_NAME)) ? EXPORT_NAME : null,
          dir,
        },
        rows,
      });
    } catch (err: any) {
      logger.error({ msg: 'Error control Art.26 Intranet', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // POST /generar-excel — escribe el Excel que consume el robot
  router.post('/generar-excel', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      if (!XLSX) return res.status(503).json({ ok: false, error: 'Módulo xlsx no disponible' });
      const rows = await fetchArt26(sequelize);
      const dir = art26Dir();
      fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, EXPORT_NAME);
      XLSX.writeFile(buildExportWorkbook(rows), fp);
      return res.json({ ok: true, path: fp, filas: rows.length });
    } catch (err: any) {
      logger.error({ msg: 'Error generar-excel Art.26', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // GET /export.xlsx — descarga directa del Excel
  router.get('/export.xlsx', requirePermission(PERM), async (_req: Request, res: Response) => {
    try {
      if (!XLSX) return res.status(503).json({ ok: false, error: 'Módulo xlsx no disponible' });
      const rows = await fetchArt26(sequelize);
      const buf = XLSX.write(buildExportWorkbook(rows), { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${EXPORT_NAME}"`);
      return res.end(buf);
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  return router;
}
