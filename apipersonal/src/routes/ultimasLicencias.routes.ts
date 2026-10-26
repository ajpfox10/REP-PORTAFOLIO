// src/routes/ultimasLicencias.routes.ts
// GET /api/v1/ultimas-licencias?dni=123,456 → última licencia de cada tipo del agente, en el Ministerio y en SIAPE
//
// Ministerio: MINISTERIO.xls / UPA4.xls / UPA18.xls que baja el robot de la Intranet (EXCEL_ASISTENCIA_DIR/MINISTERIO).
// Si un tipo no está en los .xls (traen solo el período en curso), se busca en la tabla ministerio_novedades_anual.
// SIAPE: SIAPE.xlsx "Novedades Por Periodo" (EXCEL_ASISTENCIA_DIR/SIAPE). Se devuelve la fecha de cada archivo.
// "Última" = la de fecha desde más reciente (incluye futuras). Las filas se emparejan por mapeo_novedades
// (equivalencias SIAPE → Ministerio, sin CIE); lo que no empareja va en su propia fila.
// Los Excel quedan en memoria y se releen solo si cambia el archivo.

import path from 'path';
import fs from 'fs';
import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

interface Lic { dni: number; novedad: string; desde: string; hasta: string | null; origen: string; tablaAnual?: boolean }
interface Archivo { archivo: string; fecha: string | null; filas: number; error?: string }

const ARCHIVOS_MINISTERIO: [string, string][] = [['MINISTERIO.xls', 'HOSPITAL'], ['UPA4.xls', 'UPA 4'], ['UPA18.xls', 'UPA 18']];

function normNovedad(s: any): string {
  return String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().replace(/\s*-\s*/g, '-').replace(/\s*\.\s*/g, '.');
}

/** Serial de Excel → 'AAAA-MM-DD'. Se redondea: el Ministerio trae fracciones (.874…) y SIAPE (.125). */
function serialAFecha(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = Number(v);
  if (n && XLSX) {
    const d = XLSX.SSF.parse_date_code(Math.round(n));
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
  }
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

type Leido = { mtime: number; lics: Lic[]; archivo: Archivo };
const cache = new Map<string, Leido>();

/** Lee un Excel (con cache por mtime) y lo pasa a licencias con el lector de columnas dado. */
function leer(file: string, nombre: string, aLic: (r: any) => Lic | null): Leido {
  if (!XLSX) return { mtime: 0, lics: [], archivo: { archivo: nombre, fecha: null, filas: 0, error: 'falta dependencia xlsx' } };
  if (!fs.existsSync(file)) return { mtime: 0, lics: [], archivo: { archivo: nombre, fecha: null, filas: 0, error: 'no encontrado' } };
  const st = fs.statSync(file);
  const c = cache.get(file);
  if (c && c.mtime === st.mtimeMs) return c;
  try {
    const wb = XLSX.readFile(file);
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: '' });
    const lics = rows.map(aLic).filter(Boolean) as Lic[];
    const leido = { mtime: st.mtimeMs, lics, archivo: { archivo: nombre, fecha: st.mtime.toISOString(), filas: lics.length } };
    cache.set(file, leido);
    return leido;
  } catch (e: any) {
    return { mtime: 0, lics: [], archivo: { archivo: nombre, fecha: st.mtime.toISOString(), filas: 0, error: e?.message } };
  }
}

const soloDigitos = (v: any) => Number(String(v ?? '').replace(/\D/g, ''));

function leerMinisterio(dir: string) {
  const lics: Lic[] = [];
  const archivos: Archivo[] = [];
  for (const [nombre, dep] of ARCHIVOS_MINISTERIO) {
    const l = leer(path.join(dir, 'MINISTERIO', nombre), nombre, (r) => {
      const dni = soloDigitos(r['Nro Documento']);
      const novedad = String(r['Novedad'] ?? '').trim();
      const desde = serialAFecha(r['Fecha Desde']);
      if (!dni || !novedad || !desde) return null;
      return { dni, novedad, desde, hasta: serialAFecha(r['Fecha Hasta']), origen: dep };
    });
    lics.push(...l.lics);
    archivos.push(l.archivo);
  }
  return { lics, archivos };
}

function leerSiape(dir: string) {
  const carpeta = path.join(dir, 'SIAPE');
  const nombre = fs.existsSync(path.join(carpeta, 'SIAPE.xlsx')) ? 'SIAPE.xlsx'
    : (fs.existsSync(carpeta) ? fs.readdirSync(carpeta).find(f => /^siape\.xls[xm]?$/i.test(f)) : undefined) ?? 'SIAPE.xlsx';
  const l = leer(path.join(carpeta, nombre), nombre, (r) => {
    const dni = soloDigitos(r['NRO_DOCUMENTO']);
    const novedad = String(r['NOVEDAD'] ?? '').trim();
    const desde = serialAFecha(r['FECHA_DESDE']);
    // PRESENTE no es una licencia
    if (!dni || !novedad || !desde || normNovedad(novedad) === 'PRESENTE') return null;
    return { dni, novedad, desde, hasta: serialAFecha(r['FECHA_HASTA']), origen: String(r['ESTRUCTURA_SERVICIO'] ?? '').trim() };
  });
  return { lics: l.lics, archivos: [l.archivo] };
}

/** Última (por fecha desde, y después hasta) de cada tipo de novedad. */
function ultimaPorTipo(lics: Lic[]): Map<string, Lic> {
  const out = new Map<string, Lic>();
  for (const l of lics) {
    const k = normNovedad(l.novedad);
    const prev = out.get(k);
    if (!prev || l.desde > prev.desde || (l.desde === prev.desde && (l.hasta ?? '') > (prev.hasta ?? ''))) out.set(k, l);
  }
  return out;
}

function grupo(nov: string): number {
  const n = normNovedad(nov);
  if (/COMPLEMENT/.test(n)) return 1;
  if (/ANUAL/.test(n)) return 0;
  return 2;
}

export function buildUltimasLicenciasRouter(sequelize: Sequelize): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const dnis = String(req.query.dni ?? '').split(',').map(soloDigitos).filter(Boolean);
      if (!dnis.length) return res.status(400).json({ ok: false, error: 'Falta dni' });
      const dir = (env as any).EXCEL_ASISTENCIA_DIR;
      if (!dir) return res.status(500).json({ ok: false, error: 'Falta EXCEL_ASISTENCIA_DIR' });

      const min = leerMinisterio(dir);
      const sia = leerSiape(dir);
      const delAgente = (l: Lic) => dnis.includes(l.dni);
      const ultMin = ultimaPorTipo(min.lics.filter(delAgente));
      const ultSia = ultimaPorTipo(sia.lics.filter(delAgente));

      // Lo que no está en los .xls: tabla anual del Ministerio (robot intranet_descarga_anual)
      const anual = await sequelize.query<any>(
        `SELECT dni, dependencia, novedad, DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS hasta
         FROM ministerio_novedades_anual WHERE dni IN (:dnis) AND fecha_desde IS NOT NULL AND novedad IS NOT NULL`,
        { replacements: { dnis }, type: QueryTypes.SELECT }).catch(() => [] as any[]);
      const ultAnual = ultimaPorTipo(anual.map((r: any) => ({
        dni: Number(r.dni), novedad: String(r.novedad).trim(), desde: r.desde, hasta: r.hasta ?? null, origen: r.dependencia, tablaAnual: true,
      })));
      for (const [k, l] of ultAnual) if (!ultMin.has(k)) ultMin.set(k, l);
      const [bajadaAnual] = await sequelize.query<any>(
        `SELECT DATE_FORMAT(MAX(descargado_en), '%Y-%m-%dT%H:%i:%s') AS fecha, COUNT(*) AS filas FROM ministerio_novedades_anual`,
        { type: QueryTypes.SELECT }).catch(() => [] as any[]);
      min.archivos.push({
        archivo: 'tabla anual', filas: Number(bajadaAnual?.filas ?? 0),
        fecha: bajadaAnual?.fecha ?? null,  // hora local del servidor (sin Z)
        ...(bajadaAnual ? {} : { error: 'no disponible' }),
      });

      // Equivalencias SIAPE → Ministerio (sin CIE: el CIE no viene en este export)
      const mapeo = new Map<string, Set<string>>();
      const filasMapeo = await sequelize.query<any>(
        `SELECT novedad_siape, novedad_ministerio FROM mapeo_novedades WHERE activo = 1 AND codigo_cie = ''`,
        { type: QueryTypes.SELECT }).catch(() => [] as any[]);
      for (const m of filasMapeo) {
        const k = normNovedad(m.novedad_siape);
        if (!mapeo.has(k)) mapeo.set(k, new Set([k]));
        mapeo.get(k)!.add(normNovedad(m.novedad_ministerio));
      }

      const usadosMin = new Set<string>();
      const filas: { ministerio: Lic | null; siape: Lic | null; coincide: boolean | null }[] = [];
      for (const [k, s] of ultSia) {
        const equivs = mapeo.get(k) ?? new Set([k]);
        // De las equivalentes que tiene el agente en el Ministerio, la más reciente
        let m: Lic | null = null;
        let mk = '';
        for (const e of equivs) {
          const c = ultMin.get(e);
          if (c && !usadosMin.has(e) && (!m || c.desde > m.desde)) { m = c; mk = e; }
        }
        if (mk) usadosMin.add(mk);
        filas.push({ ministerio: m, siape: s, coincide: m ? (m.desde === s.desde && (m.hasta ?? m.desde) === (s.hasta ?? s.desde)) : null });
      }
      for (const [k, m] of ultMin) if (!usadosMin.has(k)) filas.push({ ministerio: m, siape: null, coincide: null });

      const ref = (f: typeof filas[number]) => f.siape ?? f.ministerio!;
      const masReciente = (f: typeof filas[number]) => [f.siape?.desde ?? '', f.ministerio?.desde ?? ''].sort().pop()!;
      filas.sort((a, b) => grupo(ref(a).novedad) - grupo(ref(b).novedad) || masReciente(b).localeCompare(masReciente(a)));

      return res.json({
        ok: true,
        data: filas.map(f => ({ ...f, grupo: ['ANUAL', 'COMPLEMENTARIA', 'OTRA'][grupo(ref(f).novedad)] })),
        archivos: { ministerio: min.archivos, siape: sia.archivos },
      });
    } catch (e: any) {
      logger.error({ msg: 'ultimas-licencias', err: e?.message });
      return res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  return router;
}
