// src/routes/comparacionSiape.routes.ts
// GET  /api/v1/comparacion-siape        → compara SIAPE vs MINISTERIO usando mapeo existente
// POST /api/v1/comparacion-siape/invalidar-cache
//
// Lee:
//   LICENCIAS_PDF_DIR\MINISTERIO\*.xls[x]   → archivo ministerio
//   LICENCIAS_PDF_DIR\SIAPE\*.xlsx           → archivo SIAP
//   EXCEL_ASISTENCIA_DIR\mapeo.asistencia.json  → mapeo de novedades (mismo que el comparador)
//
// Clave de join: LEGAJO (cuando disponible) → fallback DNI
// Lógica de comparación reutiliza las mismas funciones que asistencia.routes.ts

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

// ── Utilidades de texto/fecha (mismas que asistencia.routes.ts) ───────────────

function normNovedad(s: any): string {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\.\s*/g, '.');
}

function normDni(v: any): string {
  return String(v ?? '').replace(/[^0-9]/g, '').trim();
}

function normLegajo(v: any): string {
  const s = String(v ?? '').trim();
  if (!s || s === '-') return '';
  return s.replace(/\D/g, '');
}

function normMapeo(mapeo: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, arr] of Object.entries(mapeo || {})) {
    const kk = normNovedad(k);
    out[kk] = Array.from(new Set((arr || []).map(normNovedad))).filter(Boolean);
  }
  return out;
}

function splitNovedadesCompuestas(v: any): string[] {
  const base = normNovedad(v);
  if (!base) return [];
  return Array.from(new Set([base, ...base.split(/\s+\/\s+/).map(normNovedad)].filter(Boolean)));
}

function novedadesConectan(equivs: string[], novSiap: any): boolean {
  const siapParts = splitNovedadesCompuestas(novSiap);
  return equivs.some(e => siapParts.includes(normNovedad(e)));
}

function equivsMinisterio(mapeoN: Record<string, string[]>, novMinNorm: string): string[] {
  return Array.from(new Set([novMinNorm, ...(mapeoN[novMinNorm] || [])].filter(Boolean)));
}

function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const dateToStr = (d: Date | null): string => d ? d.toISOString().slice(0, 10) : '';
const toUTCMid = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
function overlap(s1: Date, e1: Date, s2: Date, e2: Date) {
  return toUTCMid(s1) <= toUTCMid(e2) && toUTCMid(s2) <= toUTCMid(e1);
}

// ── Mapeo ─────────────────────────────────────────────────────────────────────

const DEFAULT_MAPEO: Record<string, string[]> = {
  '08-DESCANSO ANUAL': ['ANUAL'],
  '29-COMPLEMENTARIA': ['ANUAL COMPLEMENTARIA'],
  '291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.': ['ANUAL COMPLEMENTARIA 10430'],
  '93-LICENCIA COMPLEMENT.ANT.DENEGADA': ['ANUAL COMPLEMENTARIA'],
  '81-LICENCIA ANTERIOR DENEGADA': ['ANUAL'],
  '01-POR RAZONES DE ENFERMEDAD': ['ENFERMEDAD'],
  '1R-ENFERMEDAD DE RIESGO': ['ENFERMEDAD'],
  'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCION)': ['ENFERMEDAD', 'ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE'],
  '05-POR ATENCION DE FAMILIAR ENFERMO': ['ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE'],
  '04-POR ACCIDENTE DE TRABAJO': ['ACCIDENTE DE TRABAJO'],
  '06-POR MATERNIDAD': ['MATERNIDAD', 'NACIMIENTO', 'CUIDADO RECIEN NACIDO/A'],
  'RN1-RECIEN NACIDO': ['NACIMIENTO', 'CUIDADO RECIEN NACIDO/A'],
  '312-PATERNIDAD/CORRESPONSAL PARENTAL NACIMIENTO MULTIPLE': ['NACIMIENTO CORRESPONSABLE PARENTAL MULTIPLE'],
  '14-DUELO FAMILIAR DIRECTO': ['DUELO DIRECTO'],
  '15-DUELO FAMILIAR INDIRECTO': ['DUELO INDIRECTO', 'DUELO DIRECTO'],
  '16-POR MATRIMONIO': ['MATRIMONIO'],
  '18-POR EXAMEN': ['EXAMEN', 'INTEGRACION DE MESA EXAMINADORA'],
  '17-POR PRE-EXAMEN': ['PRE-EXAMEN'],
  '22-ACTIVIDAD GREMIAL': ['PERMISO GREMIAL DIAS', 'COMISION'],
  '261-POR CAUSAS PARTICULARES': ['CAUSAS PARTICULARES'],
  '44-PERMISO CITACIONES ORG.OFICIAL': ['CITACION ORG.OFICIALES'],
};

function loadMapeo(): Record<string, string[]> {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR as string;
  if (!dir) return DEFAULT_MAPEO;
  const fp = path.join(dir, 'mapeo.asistencia.json');
  if (!fs.existsSync(fp)) return DEFAULT_MAPEO;
  try {
    const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
    // Fusionar: el JSON del disco extiende el DEFAULT sin pisarlo
    const out: Record<string, string[]> = { ...DEFAULT_MAPEO };
    for (const [k, arr] of Object.entries(json as Record<string, string[]>)) {
      const kk = normNovedad(k);
      if (!kk) continue;
      out[kk] = Array.from(new Set([...(out[kk] || []), ...(arr || []).map(normNovedad)].filter(Boolean)));
    }
    return out;
  } catch {
    return DEFAULT_MAPEO;
  }
}

// ── Dependencia (E5/E6 del SIAP) ─────────────────────────────────────────────

function resolveDepedencia(e5raw: string, e6raw: string): string {
  const norm = (s: string) =>
    String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const e6 = norm(e6raw);
  const e5 = norm(e5raw);
  const inE6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE6) return `UPA ${inE6[1]}`;
  const inE5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE5) return `UPA ${inE5[1]}`;
  return 'HOSPITAL';
}

// ── Parseo de Excel ────────────────────────────────────────────────────────────

export interface AgRow {
  legajo: string;
  dni: string;
  nombre: string;
  novedad: string;
  desde: Date | null;
  hasta: Date | null;
  dependencia: string;
  ley: string;
  justificado: string;
}

export function findExcelInDir(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f =>
    !f.startsWith('~$') && !f.startsWith('.') &&
    /\.(xlsx|xls|xltx)$/i.test(f)
  );
  return files.length ? path.join(dir, files[0]) : null;
}

function parseExcelMinisterio(fp: string): AgRow[] {
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  const rows: AgRow[] = [];
  if (raw.length < 2) return rows;

  // Detectar columnas por encabezado (fila 0)
  const hdr = (raw[0] as string[]).map(h => String(h ?? '').toLowerCase().trim());
  const ci = (keys: string[]) => {
    for (const k of keys) { const i = hdr.indexOf(k); if (i >= 0) return i; }
    return -1;
  };

  const cLeg = ci(['legajo']);
  const cDni = ci(['nro documento', 'nro_documento', 'dni', 'documento']);
  const cNom = ci(['apellido y nombres', 'apellido y nombre', 'nombre']);
  const cNov = ci(['novedad']);
  const cDesde = ci(['fecha desde', 'fecha_desde', 'desde']);
  const cHasta = ci(['fecha hasta', 'fecha_hasta', 'hasta']);

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as any[];
    const legajo = normLegajo(cLeg >= 0 ? r[cLeg] : '');
    const dni    = normDni(cDni >= 0 ? r[cDni] : '');
    const nombre = String(cNom >= 0 ? (r[cNom] ?? '') : '').trim();
    const novedad = String(cNov >= 0 ? (r[cNov] ?? '') : '').trim();
    const desde  = parseDate(cDesde >= 0 ? r[cDesde] : null);
    const hasta  = parseDate(cHasta >= 0 ? r[cHasta] : null);

    if (!legajo && !dni && !nombre) continue;
    rows.push({ legajo, dni, nombre, novedad, desde, hasta, dependencia: '—', ley: '', justificado: '' });
  }
  return rows;
}

export function parseExcelSiape(fp: string): AgRow[] {
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  const rows: AgRow[] = [];
  if (raw.length < 2) return rows;

  const hdr = (raw[0] as string[]).map(h => String(h ?? '').toLowerCase().trim());
  const ci = (keys: string[]) => {
    for (const k of keys) { const i = hdr.indexOf(k); if (i >= 0) return i; }
    return -1;
  };

  const cLeg    = ci(['legajo']);
  const cDni    = ci(['nro_documento', 'nro documento', 'dni']);
  const cAp     = ci(['apellido']);
  const cNom    = ci(['nombre']);
  const cNov    = ci(['novedad']);
  const cDesde  = ci(['fecha_desde', 'fecha desde', 'desde']);
  const cHasta  = ci(['fecha_hasta', 'fecha hasta', 'hasta']);
  const cE5     = ci(['e5']);
  const cE6     = ci(['e6']);
  const cLey    = ci(['ley', 'convenio', 'regimen', 'planta', 'categoria']);
  const cJust   = ci(['justificado']);

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as any[];
    const legajo = normLegajo(cLeg >= 0 ? r[cLeg] : '');
    const dni    = normDni(cDni >= 0 ? r[cDni] : '');
    const ap     = String(cAp >= 0 ? (r[cAp] ?? '') : '').trim();
    const nm     = String(cNom >= 0 ? (r[cNom] ?? '') : '').trim();
    const nombre = ap && nm ? `${ap}, ${nm}` : (ap || nm);
    const novedad = String(cNov >= 0 ? (r[cNov] ?? '') : '').trim();
    const desde  = parseDate(cDesde >= 0 ? r[cDesde] : null);
    const hasta  = parseDate(cHasta >= 0 ? r[cHasta] : null);
    const e5raw  = String(cE5 >= 0 ? (r[cE5] ?? '') : '');
    const e6raw  = String(cE6 >= 0 ? (r[cE6] ?? '') : '');
    const dependencia = resolveDepedencia(e5raw, e6raw);

    const ley = String(cLey >= 0 ? (r[cLey] ?? '') : '').trim();
    const justificado = String(cJust >= 0 ? (r[cJust] ?? '') : '').trim().toUpperCase();
    if (!novedad) continue;
    rows.push({ legajo, dni, nombre, novedad, desde, hasta, dependencia, ley, justificado });
  }
  return rows;
}

// ── Comparación ───────────────────────────────────────────────────────────────

export interface CompRow {
  legajo: string;
  dni: string;
  nombre: string;
  dependencia: string;
  ley: string;
  novedad_ministerio: string;
  fecha_desde_min: string;
  fecha_hasta_min: string;
  novedad_siap: string;
  fecha_desde_siap: string;
  fecha_hasta_siap: string;
  justificado_siap: string;
  estado: 'COINCIDENTE' | 'NO COINCIDENTE' | 'RANGO_DISTINTO' | 'SOLO_SIAP';
  motivo: string;
}

// ── Reglas de becario ─────────────────────────────────────────────────────────

function esBecario(ley: string): boolean {
  return ley.toUpperCase().includes('BECARIO') || ley.toUpperCase().includes('BECA');
}

function diasEntreFechas(desde: Date | null, hasta: Date | null): number {
  if (!desde || !hasta) return 0;
  return Math.round((toUTCMid(hasta).getTime() - toUTCMid(desde).getTime()) / 86400000) + 1;
}

function esVacaciones(novedad: string): boolean {
  const n = normNovedad(novedad);
  return n.includes('ANUAL') || n.includes('VACACION') || n.includes('DESCANSO ANUAL');
}

function esLicencia29(novedad: string): boolean {
  const n = normNovedad(novedad);
  return n.startsWith('29') || (n.includes('COMPLEMENT') && n.includes('29'));
}

function motivoBecario(ley: string, novedad: string, desde: Date | null, hasta: Date | null): string | null {
  if (!esBecario(ley)) return null;
  if (esLicencia29(novedad)) return 'BECARIO_NO_APLICA';
  if (esVacaciones(novedad) && diasEntreFechas(desde, hasta) > 14) return 'BECARIO_NO_APLICA';
  return null;
}

const NOV_ENF_PENDIENTE = 'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCION)';

function esMedicaSinJustificar(row: AgRow): boolean {
  if (String(row.justificado || '').trim().toUpperCase() !== 'NO') return false;
  const n = normNovedad(row.novedad);
  return n.startsWith('ENFERMEDAD') ||
    n.includes('ATENCION FAMILIAR ENFERMO') ||
    n.includes('ENFERMEDAD DE FAMILIAR');
}

function novedadSiapParaComparar(row: AgRow): string {
  return esMedicaSinJustificar(row) ? NOV_ENF_PENDIENTE : row.novedad;
}

function novedadesConectanRow(equivs: string[], row: AgRow): boolean {
  return novedadesConectan(equivs, novedadSiapParaComparar(row));
}

const dia = (d: Date) => Math.floor(toUTCMid(d).getTime() / 86400000);

function rangoCubierto(desde: Date | null, hasta: Date | null, filas: AgRow[]): boolean {
  if (!desde || !hasta || filas.length === 0) return false;
  const ini = dia(desde);
  const fin = dia(hasta);
  const tramos = filas
    .map(f => {
      const d = f.desde;
      const h = f.hasta ?? f.desde;
      return d && h ? [Math.max(ini, dia(d)), Math.min(fin, dia(h))] as [number, number] : null;
    })
    .filter((x): x is [number, number] => !!x && x[0] <= x[1])
    .sort((a, b) => a[0] - b[0]);
  let cubreHasta = ini - 1;
  for (const [a, b] of tramos) {
    if (a > cubreHasta + 1) return false;
    cubreHasta = Math.max(cubreHasta, b);
    if (cubreHasta >= fin) return true;
  }
  return cubreHasta >= fin;
}

function comparar(ministerio: AgRow[], siap: AgRow[], mapeo: Record<string, string[]>): CompRow[] {
  const mapeoN = normMapeo(mapeo);

  // Indexar SIAP por legajo y por DNI
  const siapByLeg: Record<string, AgRow[]> = {};
  const siapByDni: Record<string, AgRow[]> = {};
  for (const s of siap) {
    if (s.legajo) (siapByLeg[s.legajo] = siapByLeg[s.legajo] || []).push(s);
    if (s.dni)    (siapByDni[s.dni]    = siapByDni[s.dni]    || []).push(s);
  }

  const resultados: CompRow[] = [];
  const siapVisto = new Set<AgRow>();

  for (const min of ministerio) {
    const novNorm = normNovedad(min.novedad);
    const equivs  = equivsMinisterio(mapeoN, novNorm);

    // Candidatos SIAP: DNI como clave principal
    const candidatos: AgRow[] = (siapByDni[min.dni] || []).length
      ? siapByDni[min.dni]
      : (min.legajo ? (siapByLeg[min.legajo] || []) : []);

    // Dependencia: se toma del primer candidato SIAP (misma persona aunque no haya match de novedad)
    const depRef = candidatos[0]?.dependencia ?? '—';

    const minDesde = min.desde;
    const minHasta = min.hasta ?? min.desde;

    let vioNovedadMapeada = false;
    let vioRangoDist = false;
    let bestCand: AgRow | null = null;

    const match = candidatos.find(s => {
      if (!novedadesConectanRow(equivs, s)) return false;
      vioNovedadMapeada = true;

      const sD = s.desde;
      const sH = s.hasta ?? s.desde;
      if (!minDesde || !minHasta || !sD || !sH) return false;

      const exact =
        toUTCMid(minDesde).getTime() === toUTCMid(sD).getTime() &&
        toUTCMid(minHasta).getTime() === toUTCMid(sH).getTime();

      if (!exact) {
        if (!bestCand) bestCand = s;
        vioRangoDist = true;
      }
      return exact;
    });

    const medicasPendientesCubiertas = !match
      ? candidatos.filter(s => {
          if (siapVisto.has(s) || !esMedicaSinJustificar(s) || !novedadesConectanRow(equivs, s)) return false;
          const sD = s.desde;
          const sH = s.hasta ?? s.desde;
          return !!minDesde && !!minHasta && !!sD && !!sH && overlap(minDesde, minHasta, sD, sH);
        })
      : [];
    const cubreMedicaPendiente = rangoCubierto(minDesde, minHasta, medicasPendientesCubiertas);

    if (match) siapVisto.add(match);
    else if (cubreMedicaPendiente) medicasPendientesCubiertas.forEach(s => siapVisto.add(s));
    else if (bestCand) siapVisto.add(bestCand);

    const display = match ?? medicasPendientesCubiertas[0] ?? bestCand;
    const estado: CompRow['estado'] = match || cubreMedicaPendiente ? 'COINCIDENTE' : vioRangoDist ? 'RANGO_DISTINTO' : 'NO COINCIDENTE';
    const motivo = match ? '' : cubreMedicaPendiente ? 'MEDICA_SIN_JUSTIFICAR_CUBIERTA_POR_PENDIENTE' : vioRangoDist ? 'RANGO_DISTINTO' : vioNovedadMapeada ? 'MAPEO_OK_PERO_SIN_MATCH' : 'SIAP_SIN_NOVEDAD_EQUIVALENTE';

    const leyRef = display?.ley ?? candidatos[0]?.ley ?? '';
    resultados.push({
      legajo:             min.legajo,
      dni:                min.dni,
      nombre:             min.nombre,
      dependencia:        display?.dependencia ?? depRef,
      ley:                leyRef,
      novedad_ministerio: min.novedad,
      fecha_desde_min:    dateToStr(min.desde),
      fecha_hasta_min:    dateToStr(min.hasta),
      novedad_siap:       display?.novedad ?? '—',
      fecha_desde_siap:   dateToStr(display?.desde ?? null),
      fecha_hasta_siap:   dateToStr(display?.hasta ?? null),
      justificado_siap:   display?.justificado ?? '',
      estado,
      motivo,
    });
  }

  // Agentes que están SOLO en SIAP (no encontrados en MINISTERIO)
  for (const s of siap) {
    if (siapVisto.has(s)) continue;
    // Solo incluir si la novedad tiene mapeo (descartamos PRESENTE etc.)
    const novNorm = normNovedad(s.novedad);
    const tieneMapeo = Object.values(mapeoN).some(arr => arr.includes(novNorm)) ||
                       Object.keys(mapeoN).includes(novNorm);
    if (!tieneMapeo) continue;

    const motivoSiap = motivoBecario(s.ley, s.novedad, s.desde, s.hasta) ?? 'EN_SIAP_SIN_MINISTERIO';
    resultados.push({
      legajo:             s.legajo,
      dni:                s.dni,
      nombre:             s.nombre,
      dependencia:        s.dependencia,
      ley:                s.ley,
      novedad_ministerio: '—',
      fecha_desde_min:    '—',
      fecha_hasta_min:    '—',
      novedad_siap:       s.novedad,
      fecha_desde_siap:   dateToStr(s.desde),
      fecha_hasta_siap:   dateToStr(s.hasta),
      justificado_siap:   s.justificado ?? '',
      estado:             'SOLO_SIAP',
      motivo:             motivoSiap,
    });
  }

  return resultados;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface Cache { ts: number; data: any }
let cache: Cache | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// ── Router ────────────────────────────────────────────────────────────────────

export function buildComparacionSiapeRouter() {
  const router = Router();

  router.get('/', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      if (!XLSX) return res.status(503).json({ ok: false, error: 'Módulo xlsx no disponible' });

      const baseDir = (env as any).LICENCIAS_PDF_DIR as string;
      if (!baseDir) return res.status(503).json({ ok: false, error: 'LICENCIAS_PDF_DIR no configurado en .env' });

      if (req.query.refresh === '1') cache = null;
      if (cache && Date.now() - cache.ts < CACHE_TTL) {
        return res.json({ ok: true, ...cache.data, cached: true });
      }

      const minDir  = path.join(baseDir, 'MINISTERIO');
      const siapDir = path.join(baseDir, 'SIAPE');

      const minFile  = findExcelInDir(minDir);
      const siapFile = findExcelInDir(siapDir);

      if (!minFile)  return res.status(404).json({ ok: false, error: `No se encontró Excel en ${minDir}` });
      if (!siapFile) return res.status(404).json({ ok: false, error: `No se encontró Excel en ${siapDir}` });

      const mapeo      = loadMapeo();
      const ministerio = parseExcelMinisterio(minFile);
      const siap       = parseExcelSiape(siapFile);
      const resultado  = comparar(ministerio, siap, mapeo);

      const coincidentes    = resultado.filter(r => r.estado === 'COINCIDENTE');
      const rangoDist       = resultado.filter(r => r.estado === 'RANGO_DISTINTO');
      const noCoincidentes  = resultado.filter(r => r.estado === 'NO COINCIDENTE');
      const soloSiap        = resultado.filter(r => r.estado === 'SOLO_SIAP');

      const data = {
        resumen: {
          total_ministerio: ministerio.length,
          total_siap_con_novedad: siap.filter(s => {
            const nn = normNovedad(s.novedad);
            const mN = normMapeo(mapeo);
            return Object.values(mN).some(a => a.includes(nn)) || Object.keys(mN).includes(nn);
          }).length,
          coincidentes:   coincidentes.length,
          rango_distinto: rangoDist.length,
          no_coincidentes: noCoincidentes.length,
          solo_siap:      soloSiap.length,
        },
        archivos: {
          ministerio: path.basename(minFile),
          siap:       path.basename(siapFile),
        },
        resultado,
        errores: [...noCoincidentes, ...rangoDist, ...soloSiap],
      };

      cache = { ts: Date.now(), data };
      return res.json({ ok: true, ...data, cached: false });

    } catch (err: unknown) {
      logger.error({ msg: 'Error comparacion-siape', err });
      return res.status(500).json({ ok: false, error: String((err as any)?.message ?? err) });
    }
  });

  router.post('/invalidar-cache', requirePermission('crud:*:*'), (_req, res) => {
    cache = null;
    return res.json({ ok: true });
  });

  return router;
}
