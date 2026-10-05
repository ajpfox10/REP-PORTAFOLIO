// src/routes/articulo26Intranet.routes.ts
// Módulo "Art. 26 → Ministerio (FC)" — versión 2.0 (tablas):
//   GET  /api/v1/articulo-26-intranet/control     → cruza articulo_26 contra el resultado de la carga
//                                                    (tabla art26_carga_intranet) y, si está, el
//                                                    historial de la Intranet (historial_intranet.xlsx).
//   POST /api/v1/articulo-26-intranet/lanzar      → { dependencia } corre el robot 2.0 de esa dependencia.
//   POST /api/v1/articulo-26-intranet/reintentar  → { ids } vuelve a PENDIENTE esos Art. 26 con error
//                                                    (olvida las dependencias descartadas) y lanza los robots.
//   GET  /api/v1/articulo-26-intranet/export.xlsx → descarga del listado (para mirar en Excel).
//
// El robot es scripts/cargar_art26_intranet_v2.py: toma los Art. 26 de la base, los carga como
// FC / FRANCO COMPENSATORIO y anota cada resultado en art26_carga_intranet.
// SIN USO (versión vieja): POST /generar-excel + scripts/cargar_art26_intranet.py con su
// resultado_carga_art26.xlsx.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { ejecutarAhora } from '../services/robotsTareasWindows';

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
const TABLA_CARGA    = 'art26_carga_intranet';
const SUFIJO_DEP: Record<string, string> = { 'HOSPITAL': 'hospital', 'UPA 4': 'upa4', 'UPA 18': 'upa18' };
const ESTADOS_NO_SE_CARGAN = ['ANULADO', 'RECHAZADO'];

// Misma DDL que cargar_art26_intranet_v2.py / migración 064 (se crea sola en runtime).
async function ensureTablaCarga(sequelize: Sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA_CARGA} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      art26_id BIGINT UNSIGNED NOT NULL,
      dni VARCHAR(12) NOT NULL,
      nombre VARCHAR(160) NOT NULL DEFAULT '',
      desde DATE NOT NULL,
      hasta DATE NOT NULL,
      estado_art26 VARCHAR(20) NOT NULL DEFAULT '',
      dependencia_sugerida VARCHAR(20) NOT NULL DEFAULT 'HOSPITAL',
      deps_descartadas VARCHAR(60) NOT NULL DEFAULT '',
      dependencia VARCHAR(20) NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      label_intranet VARCHAR(200) NULL,
      detalle VARCHAR(500) NULL,
      intentos INT NOT NULL DEFAULT 0,
      cargado_en DATETIME NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_art26_carga_intranet__art26 (art26_id),
      KEY idx_art26_carga_intranet__estado (estado, dependencia_sugerida),
      CONSTRAINT fk_art26_carga_intranet__art26 FOREIGN KEY (art26_id)
        REFERENCES articulo_26 (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

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
  estado_ms: 'YA_EN_MS' | 'PENDIENTE' | 'CONFLICTO' | 'ERROR' | 'NO_SE_CARGA';
  detalle_ms: string;
  carga_id: number | null;     // fila de art26_carga_intranet (para reintentar)
  dependencia: string;         // donde se cargó / intentó
  intentos: number;
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
      carga_id: null,
      dependencia: '',
      intentos: 0,
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

// ── Resultado de la carga 2.0 (tabla) ────────────────────────────────────────

interface CargaItem { id: number; art26_id: number; estado: string; detalle: string; dependencia: string; intentos: number; }

async function leerCarga(sequelize: Sequelize): Promise<Record<number, CargaItem>> {
  await ensureTablaCarga(sequelize);
  const rows = await sequelize.query<any>(`
    SELECT id, art26_id, estado, COALESCE(detalle, '') AS detalle,
           COALESCE(dependencia, dependencia_sugerida) AS dependencia, intentos
      FROM ${TABLA_CARGA}`, { type: QueryTypes.SELECT });
  const out: Record<number, CargaItem> = {};
  for (const r of rows) out[Number(r.art26_id)] = { ...r, id: Number(r.id), art26_id: Number(r.art26_id) };
  return out;
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
      const carga = await leerCarga(sequelize);

      const histByDni: Record<string, HistItem[]> = {};
      for (const h of historial) if (h.dni) (histByDni[h.dni] = histByDni[h.dni] || []).push(h);

      for (const r of rows) {
        if (ESTADOS_NO_SE_CARGAN.includes(r.estado.toUpperCase())) {
          r.estado_ms = 'NO_SE_CARGA'; r.detalle_ms = `Art. 26 ${r.estado.toLowerCase()}: no se carga`; continue;
        }
        if (!r.desde || r.desde.getUTCFullYear() < 2000) {   // mismo corte que el robot (fecha mal cargada)
          r.estado_ms = 'NO_SE_CARGA'; r.detalle_ms = `Fecha inválida (${r.desde_ddmm || 'sin fecha'}): corregir el Art. 26`; continue;
        }
        // 1) el resultado del robot manda: OK = ya está cargado; error = se marca con su motivo
        const cg = carga[r.id];
        if (cg) {
          r.carga_id = cg.id; r.dependencia = cg.dependencia; r.intentos = cg.intentos;
          if (cg.estado === 'OK') { r.estado_ms = 'YA_EN_MS'; r.detalle_ms = cg.detalle || 'Cargado por el robot'; continue; }
          if (cg.estado !== 'PENDIENTE' && cg.estado !== 'BAJA') {
            r.estado_ms = 'ERROR'; r.detalle_ms = cg.detalle || 'El robot no pudo cargarla'; continue;
          }
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
        no_se_carga: rows.filter(r => r.estado_ms === 'NO_SE_CARGA').length,
        por_estado_art26: rows.reduce((acc: Record<string, number>, r) => {
          acc[r.estado || '—'] = (acc[r.estado || '—'] || 0) + 1; return acc;
        }, {}),
      };

      return res.json({
        ok: true,
        resumen,
        fuentes: {
          historial: fs.existsSync(path.join(dir, HISTORIAL_NAME)) ? HISTORIAL_NAME : null,
          log:       Object.keys(carga).length ? `tabla ${TABLA_CARGA}` : null,
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

  // POST /lanzar — corre el robot 2.0 de una dependencia
  router.post('/lanzar', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const dep = String(req.body?.dependencia ?? '').toUpperCase().replace(/\s+/g, ' ').trim().replace(/^UPA(\d)/, 'UPA $1');
      if (!SUFIJO_DEP[dep]) return res.status(400).json({ ok: false, error: 'Dependencia inválida' });
      const script = `intranet_carga_art26_v2_${SUFIJO_DEP[dep]}`;
      const como = await ejecutarAhora(script);
      return res.json({ ok: true, script, como, msg: `Robot ${script} lanzado (queda en la página Robots)` });
    } catch (err: any) {
      logger.error({ msg: 'Error lanzar Art.26 2.0', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // POST /reintentar — { ids: carga_id[] } vuelve a PENDIENTE (y olvida las dependencias
  // descartadas) y lanza los robots de las dependencias sugeridas de esas filas.
  router.post('/reintentar', requirePermission(PERM), async (req: Request, res: Response) => {
    try {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0);
      if (!ids.length) return res.status(400).json({ ok: false, error: 'Sin filas para reintentar' });
      await ensureTablaCarga(sequelize);
      const filas = await sequelize.query<any>(
        `SELECT id, dependencia_sugerida FROM ${TABLA_CARGA} WHERE id IN (:ids) AND estado NOT IN ('OK', 'BAJA')`,
        { type: QueryTypes.SELECT, replacements: { ids } });
      if (!filas.length) return res.json({ ok: true, msg: 'No hay filas con error para reintentar' });
      await sequelize.query(
        `UPDATE ${TABLA_CARGA} SET estado = 'PENDIENTE', deps_descartadas = '' WHERE id IN (:ids)`,
        { replacements: { ids: filas.map(f => f.id) } });
      const deps = [...new Set(filas.map(f => String(f.dependencia_sugerida)))].filter(d => SUFIJO_DEP[d]);
      for (const d of deps) await ejecutarAhora(`intranet_carga_art26_v2_${SUFIJO_DEP[d]}`);
      return res.json({ ok: true, filas: filas.length, msg: `${filas.length} Art. 26 vuelven a PENDIENTE · robots: ${deps.join(', ')}` });
    } catch (err: any) {
      logger.error({ msg: 'Error reintentar Art.26 2.0', err });
      return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // SIN USO (versión vieja): POST /generar-excel — escribía el Excel que consumía cargar_art26_intranet.py
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
