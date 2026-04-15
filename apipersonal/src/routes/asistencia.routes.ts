// src/routes/asistencia.routes.ts
// Comparador de asistencia MINISTERIO vs SIAP
//
// FLUJO:
//  GET  /asistencia/config          → directorio configurado en .env
//  GET  /asistencia/archivos        → lista los .xlsx/.xltx de EXCEL_ASISTENCIA_DIR
//  GET  /asistencia/mapeo           → devuelve el mapeo actual de novedades (del JSON en disco)
//  PUT  /asistencia/mapeo           → guarda el mapeo editado (persiste en disco)
//  DELETE /asistencia/mapeo         → restaura el mapeo por defecto
//  POST /asistencia/comparar        → compara usando los archivos del directorio
//  GET  /asistencia/ausentes28      → ausentes código 28 cruzados con fichajes y horarios
//
// El directorio se configura en .env:
//   EXCEL_ASISTENCIA_DIR=D:\Asistencia\Excel
//
// Deteccion automatica de archivos:
//   - El archivo cuyo nombre contenga "ministerio" se usa como fuente Ministerio
//   - El archivo cuyo nombre contenga "siap"       se usa como fuente SIAP
//   - El archivo cuyo nombre contenga "horario"    se usa como fuente Horarios
//   - Tambien se puede indicar nombre explicito en el body del POST

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let ExcelJS: any;
try { ExcelJS = require('exceljs'); } catch { ExcelJS = null; }


// Normaliza textos de "Novedad" para evitar falsos NO COINCIDENTE por:
// - espacios alrededor de '-' o '.'
// - mayúsculas/minúsculas
// - acentos
// - espacios múltiples
function normHeader(s: any): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellToText(v: any): string {
  if (v == null) return '';
  // ExcelJS can return { richText: [{text:...}] }
  if (typeof v === 'object' && Array.isArray((v as any).richText)) {
    return String((v as any).richText.map((x: any) => x.text).join('')).trim();
  }
  return String(v).trim();
}

function normNovedad(s: any): string {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*-\s*/g, '-')   // "44 - X" -> "44-X"
    .replace(/\s*\.\s*/g, '.'); // "ORG . OF" -> "ORG.OF"
}

function normDni(v: any): string {
  return String(v ?? '')
    .replace(/[^0-9]/g, '')
    .trim();
}

function normMapeo(mapeo: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, arr] of Object.entries(mapeo || {})) {
    const kk = normNovedad(k);
    out[kk] = Array.from(new Set((arr || []).map(normNovedad))).filter(Boolean);
  }
  return out;
}

function getDir(): string {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir) throw new Error('Falta EXCEL_ASISTENCIA_DIR en .env');
  return dir;
}

function listExcelFiles(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.xlsx') || f.toLowerCase().endsWith('.xltx'))
    .map(f => ({ name: f, fullPath: path.join(dir, f) }));
}

function findAutoFiles(files: { name: string, fullPath: string }[]) {
  const m = files.find(f => f.name.toLowerCase().includes('ministerio'));
  const s = files.find(f => f.name.toLowerCase().includes('siap'));
  return { ministerio: m?.fullPath, siap: s?.fullPath };
}

const DEFAULT_MAPEO: Record<string, string[]> = {
  // ── Ministerio (código) ──────────────────────── SIAP equivalente(s) ─────
  // Descanso anual
  '08-DESCANSO ANUAL':                                      ['ANUAL'],
  '29-COMPLEMENTARIA':                                      ['ANUAL COMPLEMENTARIA'],
  '291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.':   ['ANUAL COMPLEMENTARIA 10430'],
  '93-LICENCIA COMPLEMENT.ANT.DENEGADA':                    ['ANUAL COMPLEMENTARIA'],  // JUSTIFICADO=NO en SIAP
  '81-LICENCIA ANTERIOR DENEGADA':                          ['ANUAL'],                 // JUSTIFICADO=NO en SIAP

  // Enfermedad
  '01-POR RAZONES DE ENFERMEDAD':                           ['ENFERMEDAD'],
  '1R-ENFERMEDAD DE RIESGO':                                ['ENFERMEDAD'],
  '05-POR ATENCION DE FAMILIAR ENFERMO':                    ['ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE', 'ATENCION FAMILIAR ENFERMO'],

  // Accidente / Maternidad / Recién nacido / Violencia de género
  '04-POR ACCIDENTE DE TRABAJO':                            ['ACCIDENTE DE TRABAJO'],
  '06-POR MATERNIDAD':                                      ['MATERNIDAD', 'NACIMIENTO'],
  'RN1-RECIEN NACIDO':                                      ['NACIMIENTO', 'CUIDADO RECIEN NACIDO/A'],
  'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO':                ['MUJER VICTIMA DE VIOLENCIA', 'PARA MUJERES VICTIMAS DE VIOLENCIA', 'VIOLENCIA DE GENERO', 'VICTIMA DE VIOLENCIA DE GENERO'],

  // Exámenes / Estudios / Salud preventiva
  '18-POR EXAMEN':                                          ['EXAMEN', 'INTEGRACION DE MESA EXAMINADORA'],
  '17-POR PRE-EXAMEN':                                      ['PRE-EXAMEN'],
  'DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA': ['PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA'],
  'PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON':    ['EX.MED.PREV.CANCER MAMARIO/PROSTATA/COLON'],

  // Duelo / Matrimonio
  '14-DUELO FAMILIAR DIRECTO':                              ['DUELO DIRECTO'],
  '15-DUELO FAMILIAR INDIRECTO':                            ['DUELO INDIRECTO'],
  '16-POR MATRIMONIO':                                      ['MATRIMONIO'],

  // Gremial / Citaciones / Causas particulares
  '22-ACTIVIDAD GREMIAL':                                   ['PERMISO GREMIAL DIAS', 'COMISION'],
  '44-PERMISO CITACIONES ORG.OFICIAL':                      ['CITACION ORG.OFICIALES'],
  '261-POR CAUSAS PARTICULARES':                            ['CAUSAS PARTICULARES'],
};

const DEFAULT_SKIP_NOVEDADES: string[] = [
  // ejemplos de novedades a omitir (si hiciera falta)
];

function getMapeoFile(dir: string) {
  return path.join(dir, 'mapeo.asistencia.json');
}

function loadMapeo(dir: string): Record<string, string[]> {
  const fp = getMapeoFile(dir);
  if (!fs.existsSync(fp)) return DEFAULT_MAPEO;
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const json = JSON.parse(raw);
    if (json && typeof json === 'object') return json;
    return DEFAULT_MAPEO;
  } catch {
    return DEFAULT_MAPEO;
  }
}

function saveMapeo(dir: string, mapeo: Record<string, string[]>) {
  const fp = getMapeoFile(dir);
  fs.writeFileSync(fp, JSON.stringify(mapeo, null, 2), 'utf8');
}

function deleteMapeo(dir: string) {
  const fp = getMapeoFile(dir);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const months: Record<string, number> = {
      JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
      ENE:0,ABR:3,AGO:7,SET:8,DIC:11,
    };
    const m1 = val.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/i);
    if (m1) {
      const y = parseInt(m1[3]) + (m1[3].length === 2 ? 2000 : 0);
      const mo = months[m1[2].toUpperCase()] ?? 0;
      const dy = parseInt(m1[1]);
      return new Date(Date.UTC(y, mo, dy));
    }
    // ISO string YYYY-MM-DD -> UTC
    const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2]-1, +iso[3]));
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Usar UTC para evitar que fechas midnight se desplacen un día en zonas UTC-X
const dateToStr = (d: Date | null): string => d ? d.toISOString().slice(0, 10) : '';
// Normalizar a UTC midnight antes de comparar
const toUTCMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const overlap = (s1: Date, e1: Date, s2: Date, e2: Date) =>
  toUTCMidnight(s1) <= toUTCMidnight(e2) && toUTCMidnight(s2) <= toUTCMidnight(e1);



// ── Periodo (mes) ────────────────────────────────────────────────────────────
function parsePeriodoMes(val: any): { start: Date; end: Date } | null {
  const s = String(val ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 0 || mo > 11) return null;
  const start = new Date(Date.UTC(y, mo, 1));
  // último día del mes
  const end = new Date(Date.UTC(y, mo + 1, 0));
  return { start, end };
}

function clipRowToPeriod(row: any, period: { start: Date; end: Date }): any | null {
  let desde = parseDate(row?.desde);
  let hasta = parseDate(row?.hasta) ?? desde;

  if (!desde && hasta) desde = hasta;
  if (!desde || !hasta) return null;

  const s = toUTCMidnight(desde);
  const e = toUTCMidnight(hasta);
  const ps = toUTCMidnight(period.start);
  const pe = toUTCMidnight(period.end);

  // si no toca el mes, se descarta
  if (e < ps || s > pe) return null;

  const clippedDesde = s < ps ? ps : s;
  const clippedHasta = e > pe ? pe : e;

  return { ...row, desde: clippedDesde, hasta: clippedHasta };
}
async function parseMinisterio(fp: string): Promise<any[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const rows: any[] = [];

  const ws = wb.worksheets[0];
  if (!ws) return rows;

  const headerRow = ws.getRow(1);
  const headers: Record<string, number> = {};
  headerRow.eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) headers[v] = col;
  });

  // "Nro Documento" -> 'nro documento', "documento" como fallback
  const colDni = headers['dni'] ?? headers['nro documento'] ?? headers['documento'] ?? headers['nro_documento'] ?? 1;
  // "Apellido y Nombres" (con s) -> 'apellido y nombres'
  const colNombre = headers['apellido y nombres'] ?? headers['apellido y nombre'] ?? headers['apellidoynombre'] ?? headers['apellido_nombre'] ?? headers['nombre'] ?? 2;
  const colNovedad = headers['novedad ministerio'] ?? headers['novedad'] ?? 3;
  const colDesde = headers['desde'] ?? headers['fecha desde'] ?? 4;
  const colHasta = headers['hasta'] ?? headers['fecha hasta'] ?? 5;

  ws.eachRow((r: any, rowNumber: number) => {
    if (rowNumber === 1) return;
    const dni = r.getCell(colDni)?.value;
    const nombre = r.getCell(colNombre)?.value;
    const nov = r.getCell(colNovedad)?.value;
    const desde = parseDate(r.getCell(colDesde)?.value);
    const hasta = parseDate(r.getCell(colHasta)?.value);
    if (!dni && !nombre && !nov) return;
    rows.push({
      dni,
      nombre: cellToText(nombre),
      novedad: cellToText(nov),
      desde,
      hasta,
    });
  });

  return rows;
}

async function parseSiap(fp: string): Promise<any[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const rows: any[] = [];

  const ws = wb.worksheets[0];
  if (!ws) return rows;

  const headerRow = ws.getRow(1);
  const headers: Record<string, number> = {};
  headerRow.eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) headers[v] = col;
  });

  // Columnas reales del SIAP según estructura del Excel
  const colDni      = headers['nro_documento'] ?? headers['nro documento'] ?? headers['dni'] ?? headers['documento'] ?? 5;
  const colApellido = headers['apellido'] ?? 2;
  const colNombreFirst = headers['nombre'] ?? 3;
  const colNombreFull  = headers['apellido y nombres'] ?? headers['apellido y nombre'] ?? 0;
  const colNovedad  = headers['novedad'] ?? headers['novedad siap'] ?? 12;
  const colDesde    = headers['fecha_desde'] ?? headers['fecha desde'] ?? headers['desde'] ?? 13;
  const colHasta    = headers['fecha_hasta'] ?? headers['fecha hasta'] ?? headers['hasta'] ?? 14;
  const colJustificado = headers['justificado'] ?? 15;
  // E5 = col 21, E6 = col 22 — juntos determinan la dependencia
  const colE5 = headers['e5'] ?? 21;
  const colE6 = headers['e6'] ?? 22;

  /** Resuelve la dependencia a partir de E5 y E6:
   *  - E6 contiene "UPA 18" o "UNIDAD PRONTA ATENCIÓN 18"  → "UPA 18"
   *  - E6 contiene "UPA 4"  o "UNIDAD PRONTA ATENCIÓN 4"   → "UPA 4"
   *  - E5 contiene "UPA 18" o "UNIDAD PRONTA ATENCIÓN 18"  → "UPA 18"  (fallback cuando E6 es "-")
   *  - E5 contiene "UPA 4"  o "UNIDAD PRONTA ATENCIÓN 4"   → "UPA 4"   (fallback cuando E6 es "-")
   *  - todo lo demás                                         → "HOSPITAL"
   */
function resolveDepedencia(e5raw: string, e6raw: string): string {
  const norm = (s: string) =>
    String(s ?? '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const e6 = norm(e6raw);
  const e5 = norm(e5raw);

  // prioridad: si E6 dice UPA, manda (casos tipo "Albert")
  // Acepta tanto "UPA 4" como "UNIDAD PRONTA ATENCIÓN 4" / "UNIDAD PRONTA ATENCION 4"
  const upaInE6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (upaInE6) return `UPA ${upaInE6[1]}`;

  // fallback: E5 — ídem
  const upaInE5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (upaInE5) return `UPA ${upaInE5[1]}`;

  return 'HOSPITAL';
}

  ws.eachRow((r: any, rowNumber: number) => {
    if (rowNumber === 1) return;
    const dni = r.getCell(colDni)?.value;
    let nombre: string;
    if (colNombreFull) {
      nombre = cellToText(r.getCell(colNombreFull)?.value);
    } else {
      const ap = cellToText(r.getCell(colApellido)?.value);
      const nm = cellToText(r.getCell(colNombreFirst)?.value);
      nombre = [ap, nm].filter(Boolean).join(', ');
    }
    const nov         = r.getCell(colNovedad)?.value;
    const desde       = parseDate(r.getCell(colDesde)?.value);
    const hasta       = parseDate(r.getCell(colHasta)?.value);
    const justificado = cellToText(r.getCell(colJustificado)?.value); // "SI" | "NO" | ""
    const e5raw       = cellToText(r.getCell(colE5)?.value);
    const e6raw = cellToText(r.getCell(colE6)?.value);
    const dependencia = resolveDepedencia(e5raw, e6raw); // "UPA 18" | "UPA 4" | "HOSPITAL"

    if (!dni && !nombre && !nov) return;
    rows.push({
      dni,
      nombre,
      novedad: cellToText(nov),
      desde,
      hasta,
      justificado, // leído directo del SIAP, no calculado
      upa: dependencia, // clave para elegir el archivo ministerio correcto
    });
  });

  return rows;
}

function compareRows(
  ministerio: any[],
  siap: any[],
  mapeo: Record<string, string[]>,
  skipNovedades: string[],
): any[] {
  // Indexar SIAP por DNI normalizado para evitar falsos "NO COINCIDENTE"
  const siapByDni: Record<string, any[]> = {};
  for (const s of siap) {
    const dni = normDni((s as any).dni);
    (siapByDni[dni] = siapByDni[dni] || []).push(s);
  }

  const mapeoN = normMapeo(mapeo);

  return ministerio.map(min => {
    const dniMin = normDni((min as any).dni);

    const nov = String((min as any).novedad || '').trim();
    const novN = normNovedad(nov);

    if (skipNovedades.some(sk => novN.includes(normNovedad(sk)))) {
      return {
        dni: (min as any).dni, nombre: (min as any).nombre,
        novedad_ministerio: nov,
        fecha_desde_ministerio: dateToStr(parseDate((min as any).desde)),
        fecha_hasta_ministerio: dateToStr(parseDate((min as any).hasta)),
        novedad_siap: '—', fecha_desde_siap: '—', fecha_hasta_siap: '—',
        estado: 'OMITIDO',
      };
    }

    const equivs = mapeoN[novN] || [];

    const minDesde = parseDate((min as any).desde);
    const minHasta = parseDate((min as any).hasta) ?? minDesde;

     let vioSiapConNovedadMapeada = false;
     let vioRangoDistinto = false;
     let vioSolape = false;    
    const match = (siapByDni[dniMin] || []).find((s: any) => {
      if (!equivs.includes(normNovedad(s.novedad))) return false;
       vioSiapConNovedadMapeada = true;

      const sDesde = parseDate(s.desde);
      const sHasta = parseDate(s.hasta) ?? sDesde;

      // Si faltan fechas, NO matcheamos (evita falsos coincidentes)
      if (!minDesde || !minHasta || !sDesde || !sHasta) return false;

      // Igualdad exacta de rangos (desde y hasta)
      const ok =
  toUTCMidnight(minDesde).getTime() === toUTCMidnight(sDesde).getTime() &&
  toUTCMidnight(minHasta).getTime() === toUTCMidnight(sHasta).getTime();

	if (!ok) {
	  vioRangoDistinto = true;
	  if (overlap(minDesde, minHasta, sDesde, sHasta)) vioSolape = true;
	}

	return ok;
    });
     const siapRowsForDni = siapByDni[dniMin] || [];
      const motivo =
      match ? '' :
      equivs.length === 0 ? 'SIN_MAPEO_PARA_NOVEDAD_MINISTERIO' :
        vioSolape ? 'SOLAPA_PERO_NO_IGUAL' :
     vioRangoDistinto ? 'RANGO_DISTINTO' :
     vioSiapConNovedadMapeada ? 'MAPEO_OK_PERO_SIN_MATCH' :
    'SIAP_SIN_NOVEDAD_EQUIVALENTE';  
    return {
      dni: (min as any).dni, nombre: (min as any).nombre,
      novedad_ministerio: nov,
      fecha_desde_ministerio: dateToStr(minDesde),
      fecha_hasta_ministerio: dateToStr(minHasta),
      novedad_siap: match ? match.novedad : (equivs.length === 0 ? '(sin mapeo)' : '—'),
      fecha_desde_siap: match ? dateToStr(parseDate(match.desde)) : '—',
      fecha_hasta_siap: match ? dateToStr(parseDate(match.hasta) ?? parseDate(match.desde)) : '—',
      estado: match ? 'COINCIDENTE' : 'NO COINCIDENTE',
      motivo,
    };
  });
}


/**
 * Compara SIAP vs múltiples archivos Ministerio.
 * ministerioMap: Record<"UPA 18" | "UPA 4" | "HOSPITAL", rows[]>
 * Cada fila SIAP tiene .upa (resuelta de E5/E6) y .justificado ("SI"|"NO").
 *
 * Regla especial ANUAL COMPLEMENTARIA:
 *   SIAP ANUAL COMPLEMENTARIA + JUSTIFICADO=NO  → busca "ANUAL COMPLEMENTARIA DENEGADA" en Ministerio
 *   SIAP ANUAL COMPLEMENTARIA + JUSTIFICADO=SI  → busca "ANUAL COMPLEMENTARIA" en Ministerio
 */
function compareRowsSiapVsMinisterio(
  siap: any[],
  ministerioMap: Record<string, any[]>,
  mapeo: Record<string, string[]>,
  skipNovedades: string[],
): any[] {
  // Pre-indexar cada ministerio por DNI
  const minByUpaAndDni: Record<string, Record<string, any[]>> = {};
  for (const [upa, rows] of Object.entries(ministerioMap)) {
    minByUpaAndDni[upa] = {};
    for (const m of rows) {
      const dni = normDni((m as any).dni);
      (minByUpaAndDni[upa][dni] = minByUpaAndDni[upa][dni] || []).push(m);
    }
  }

  const mapeoN = normMapeo(mapeo);

  return siap.map((s: any) => {
    const dniS  = normDni((s as any).dni);
    const upa   = String((s as any).upa || '').trim();
    const novS  = String((s as any).novedad || '').trim();
    const novSN = normNovedad(novS);
    const justS = String((s as any).justificado || '').trim().toUpperCase(); // "SI" | "NO" | ""
    const sDesde = parseDate((s as any).desde);
    const sHasta = parseDate((s as any).hasta) ?? sDesde;

    const baseRow = {
      dni:              (s as any).dni,
      nombre:           (s as any).nombre,
      novedad_siap:     novS,
      fecha_desde_siap: dateToStr(sDesde),
      fecha_hasta_siap: dateToStr(sHasta),
      upa,
      justificado:      justS,
    };

    if (skipNovedades.some(sk => novSN.includes(normNovedad(sk)))) {
      return { ...baseRow, novedad_ministerio: '—', fecha_desde_ministerio: '—', fecha_hasta_ministerio: '—', estado: 'OMITIDO' };
    }
    let vioMinSinMapeo = false;   // el DNI existe, pero hay novedades ministerio sin mapeo
    let vioMismoMapeo = false;    // el mapeo conecta, pero no se logró match
    let vioRangoDistinto = false; // mapeo conecta, pero rango no idéntico
    let vioSolape = false;
    if (!upa || !minByUpaAndDni[upa]) {
      return { ...baseRow, novedad_ministerio: '—', fecha_desde_ministerio: '—', fecha_hasta_ministerio: '—',
        estado: 'NO COINCIDENTE', motivo: upa ? `Sin archivo ministerio para ${upa}` : 'Sin UPA en SIAP' };
    }

    const mins = minByUpaAndDni[upa][dniS] || [];

    // Mejor candidato: fila de Ministerio que conecta por novedad pero difiere en fechas
    let bestCandidate: any = null;

    const match = mins.find((m: any) => {
      const novM  = String(m.novedad || '').trim();
      const novMN = normNovedad(novM);
      const equivs = mapeoN[novMN];
      if (!equivs) {
        vioMinSinMapeo = true;
        return false;
      }
      if (!equivs.includes(novSN)) return false;
      vioMismoMapeo = true;

      // Regla ANUAL COMPLEMENTARIA: usar JUSTIFICADO para distinguir aprobada/denegada
      if (novSN.includes('ANUAL COMPLEMENTARIA')) {
        const minEsDenegada = novMN.includes('DENEGADA');
        if (justS === 'NO' && !minEsDenegada) return false;
        if (justS === 'SI' && minEsDenegada)  return false;
      }

      const mDesde = parseDate(m.desde);
      const mHasta = parseDate(m.hasta) ?? mDesde;
      if (!mDesde || !mHasta || !sDesde || !sHasta) return false;

      if (overlap(mDesde, mHasta, sDesde, sHasta)) vioSolape = true;

      const ok =
        toUTCMidnight(mDesde).getTime() === toUTCMidnight(sDesde).getTime() &&
        toUTCMidnight(mHasta).getTime() === toUTCMidnight(sHasta).getTime();

      // Guardar como mejor candidato: novedad conecta pero fechas difieren
      if (!ok && !bestCandidate) bestCandidate = m;
      if (!ok) vioRangoDistinto = true;
      return ok;
    });

    const motivo =
      match              ? '' :
      mins.length === 0  ? `DNI_NO_EXISTE_EN_MINISTERIO_PARA_${upa}` :
      vioRangoDistinto   ? 'RANGO_DISTINTO' :
      vioSolape          ? 'SOLAPA_PERO_NO_IGUAL' :
      vioMismoMapeo      ? 'MAPEO_OK_PERO_SIN_MATCH' :
      vioMinSinMapeo     ? 'MIN_TIENE_NOVEDAD_SIN_MAPEO' :
                           'MAPEO_NO_ENCUENTRA_EQUIVALENTE';

    // Si no hay match exacto pero el DNI existe en Ministerio → mostrar lo que tiene
    const displayMin = match ?? bestCandidate;
    const novedadesMinTexto = mins.length > 0
      ? [...new Set(mins.map((m: any) => String(m.novedad || '').trim()).filter(Boolean))].join(' / ')
      : '—';

    return {
      ...baseRow,
      novedad_ministerio:     match ? match.novedad : novedadesMinTexto,
      fecha_desde_ministerio: displayMin ? dateToStr(parseDate(displayMin.desde)) : '—',
      fecha_hasta_ministerio: displayMin ? dateToStr(parseDate(displayMin.hasta) ?? parseDate(displayMin.desde)) : '—',
      estado: match ? 'COINCIDENTE' : 'NO COINCIDENTE',
      motivo,
    };
  });
}
export function buildAsistenciaRouter() {
  const router = Router();

  router.get('/config', requirePermission('api:access'), (_req: Request, res: Response) => {
    const dir = (env as any).EXCEL_ASISTENCIA_DIR;
    return res.json({ ok: true, dir });
  });

  router.get('/archivos', requirePermission('api:access'), (_req: Request, res: Response) => {
    try {
      const dir = getDir();
      const files = listExcelFiles(dir);
      const auto = findAutoFiles(files);
      return res.json({ ok: true, dir, files, auto });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.get('/mapeo', requirePermission('api:access'), (_req: Request, res: Response) => {
    try {
      const dir = getDir();
      const mapeo = loadMapeo(dir);
      return res.json({ ok: true, mapeo });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.put('/mapeo', requirePermission('api:access'), (req: Request, res: Response) => {
    try {
      const dir = getDir();
      const mapeo = req.body?.mapeo;
      if (!mapeo || typeof mapeo !== 'object') {
        return res.status(400).json({ ok: false, error: 'Body inválido: { mapeo: {...} }' });
      }
      saveMapeo(dir, mapeo);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.delete('/mapeo', requirePermission('api:access'), (_req: Request, res: Response) => {
    try {
      const dir = getDir();
      deleteMapeo(dir);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });


  router.get('/novedades', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend (npm i exceljs)' });
    }
    try {
      const dir = getDir();
      const files = listExcelFiles(dir);
      const auto = findAutoFiles(files);

      const ministerioFile = req.query?.ministerioFile ? path.join(dir, String(req.query.ministerioFile)) : auto.ministerio;
      const siapFile       = req.query?.siapFile       ? path.join(dir, String(req.query.siapFile))       : auto.siap;

      if (!ministerioFile || !fs.existsSync(ministerioFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontró archivo MINISTERIO (auto o provisto)' });
      }
      if (!siapFile || !fs.existsSync(siapFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontró archivo SIAP (auto o provisto)' });
      }

      const [ministerioRows, siapRows] = await Promise.all([
        parseMinisterio(ministerioFile),
        parseSiap(siapFile),
      ]);


      const freq = (arr: any[], key: string) => {
        const m: Record<string, number> = {};
        for (const r of arr) {
          const v = normNovedad((r as any)[key]);
          if (!v) continue;
          m[v] = (m[v] || 0) + 1;
        }
        return Object.entries(m)
          .sort((a,b) => b[1]-a[1])
          .map(([name, count]) => ({ name, count }));
      };

      return res.json({
        ok: true,
        data: {
          ministerio: freq(ministerioRows, 'novedad'),
          siap: freq(siapRows, 'novedad'),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.post('/comparar', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend (npm i exceljs)' });
    }
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);
      const auto  = findAutoFiles(files);
      const mapeo = loadMapeo(dir);

      const skip: string[] = Array.isArray(req.body?.skipNovedades)
        ? req.body.skipNovedades
        : String(req.body?.skipNovedades || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      const skipFinal = skip.length ? skip : DEFAULT_SKIP_NOVEDADES;

      // ── Archivo SIAP ──────────────────────────────────────────────────────
      const siapFile = req.body?.siapFile ? path.join(dir, req.body.siapFile) : auto.siap;
      if (!siapFile || !fs.existsSync(siapFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontró archivo SIAP' });
      }

      // ── Archivos Ministerio: array [{ file, upa }] ─────────────────────────
      // ministerioFiles: [{ file: "nombre.xlsx", upa: "UPA 18" }, { file: "otro.xlsx", upa: "UPA 4" }]
      // Si no viene ministerioFiles, retrocompatibilidad con ministerioFile único
      type MinFile = { file: string; upa: string };
      let ministerioFiles: MinFile[] = [];

      if (Array.isArray(req.body?.ministerioFiles) && req.body.ministerioFiles.length > 0) {
        ministerioFiles = req.body.ministerioFiles;
      } else if (req.body?.ministerioFile) {
        // compatibilidad: un solo archivo sin UPA asignada → se llama "GENERAL"
        ministerioFiles = [{ file: req.body.ministerioFile, upa: 'GENERAL' }];
      } else if (auto.ministerio) {
        ministerioFiles = [{ file: path.basename(auto.ministerio), upa: 'GENERAL' }];
      }

      if (ministerioFiles.length === 0) {
        return res.status(400).json({ ok: false, error: 'No se encontró ningún archivo MINISTERIO' });
      }

      // ── Parsear todos los ministerios en paralelo ─────────────────────────
      const ministerioMap: Record<string, any[]> = {};
      let totalMinisterioRows = 0;
      await Promise.all(
        ministerioFiles.map(async ({ file, upa }) => {
          const fp = path.join(dir, file);
          if (!fs.existsSync(fp)) return; // si no existe, esa UPA quedará sin rows
          const rows = await parseMinisterio(fp);
          ministerioMap[upa] = rows;
          totalMinisterioRows += rows.length;
        })
      );

      // ── Parsear SIAP ──────────────────────────────────────────────────────
      let siapRows = await parseSiap(siapFile);

      // ── Deduplicar filas idénticas del SIAP ──────────────────────────────
      // El SIAP a veces exporta la misma fila duplicada (mismo DNI + novedad + desde + hasta).
      // Mantener duplicados genera filas extra de "NO COINCIDENTE" en pantalla.
      {
        const seen = new Set<string>();
        siapRows = siapRows.filter((r: any) => {
          const key = [normDni(r.dni), normNovedad(r.novedad), dateToStr(parseDate(r.desde)), dateToStr(parseDate(r.hasta))].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      // ── Filtro por período (mes) ──────────────────────────────────────────
      const period = parsePeriodoMes(req.body?.periodoMes);
      if (period) {
        siapRows = siapRows.map(r => clipRowToPeriod(r, period)).filter(Boolean) as any[];
        for (const upa of Object.keys(ministerioMap)) {
          ministerioMap[upa] = ministerioMap[upa].map(r => clipRowToPeriod(r, period)).filter(Boolean) as any[];
        }
        totalMinisterioRows = Object.values(ministerioMap).reduce((acc, rows) => acc + rows.length, 0);
      }

      // ── Comparar ──────────────────────────────────────────────────────────
      const direccion = req.body?.direccion ?? 'SIAP_VS_MIN';
      let comparado: any[];
      if (direccion === 'MIN_VS_SIAP') {
        // Itera el Ministerio — qué tiene el Ministerio y si coincide en SIAP
        const allMinRows = Object.values(ministerioMap).flat();
        // Enriquecer con UPA para que el frontend pueda filtrar por dependencia
        const dniToUpa: Record<string, string> = {};
        for (const [upa, rows] of Object.entries(ministerioMap)) {
          for (const r of rows) dniToUpa[normDni((r as any).dni)] = upa;
        }
        comparado = compareRows(allMinRows, siapRows, mapeo, skipFinal)
          .map((r: any) => ({ ...r, upa: dniToUpa[normDni(r.dni)] ?? '' }));
      } else {
        // Itera el SIAP — qué tiene el SIAP y si coincide en Ministerio
        comparado = compareRowsSiapVsMinisterio(siapRows, ministerioMap, mapeo, skipFinal);
      }

      const siapF = path.parse(siapFile);

      return res.json({
        ok: true,
        data: {
          comparado,
          totals: {
            ministerio: totalMinisterioRows,
            siap: siapRows.length,
            coincidencias: comparado.filter(r => r.estado === 'COINCIDENTE').length,
            no_coinciden:  comparado.filter(r => r.estado === 'NO COINCIDENTE').length,
            omitidos:      comparado.filter(r => r.estado === 'OMITIDO').length,
          },
          files: {
            ministerioFiles: ministerioFiles.map(m => m.file),
            siapFile: siapF.name,
          },
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  // ── GET /ausentes28 ─────────────────────────────────────────────────────────
  // Devuelve cada día con código 28-INASISTENCIA cruzado con:
  //   - ¿Le correspondía venir? (desde horarios.xlsx, columna XDIA_CONTROLABLE)
  //   - ¿Fichó ese día? (desde DB biométrica usando la config de fichero_config.json)
  //
  // Query params (todos opcionales):
  //   periodo        YYYY-MM   → filtra por mes
  //   ministerioFile nombre.xlsx
  //   horariosFile   nombre.xlsx
  router.get('/ausentes28', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend' });
    }
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);

      // ── Archivos ────────────────────────────────────────────────────────────
      const auto = findAutoFiles(files);
      const ministerioFile = req.query.ministerioFile
        ? path.join(dir, String(req.query.ministerioFile))
        : auto.ministerio;
      if (!ministerioFile || !fs.existsSync(ministerioFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontró archivo MINISTERIO' });
      }

      const autoHorarios = files.find(f => f.name.toLowerCase().includes('horario'));
      const horariosFile = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : autoHorarios?.fullPath ?? null;

      // ── Periodo ─────────────────────────────────────────────────────────────
      const period = req.query.periodo ? parsePeriodoMes(String(req.query.periodo)) : null;

      // ── 1. Leer MINISTERIO → solo novedad 28 ────────────────────────────────
      const allMin = await parseMinisterio(ministerioFile);
      let rows28 = allMin.filter(r => {
        const n = normNovedad(String(r.novedad ?? ''));
        return n.includes('28') && n.includes('INASISTENCIA');
      });
      if (period) {
        rows28 = rows28.map(r => clipRowToPeriod(r, period)).filter(Boolean) as any[];
      }
      if (rows28.length === 0) {
        return res.json({ ok: true, data: [], meta: { total: 0, conFichaje: 0, sinFichaje: 0, debiaVenir: 0, noDebiaVenir: 0, sinInfoHorario: 0 } });
      }

      // ── 2. Leer horarios → mapa DNI → días controlables ─────────────────────
      type HorarioDia = { lunes: boolean; martes: boolean; miercoles: boolean; jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean };
      const horariosMap: Record<string, HorarioDia> = {};
      if (horariosFile && fs.existsSync(horariosFile)) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(horariosFile);
        const ws = wb.worksheets[0];
        if (ws) {
          const hdr: Record<string, number> = {};
          ws.getRow(1).eachCell((c: any, col: number) => {
            const v = normHeader(c?.value ?? '');
            if (v) hdr[v] = col;
          });
          const colDniH   = hdr['nro_documento'] ?? hdr['nro documento'] ?? hdr['documento'] ?? 4;
          const colLun    = hdr['lunes_controlable']     ?? 23;
          const colMar    = hdr['martes_controlable']    ?? 24;
          const colMie    = hdr['miercoles_controlable'] ?? 25;
          const colJue    = hdr['jueves_controlable']    ?? 26;
          const colVie    = hdr['viernes_controlable']   ?? 27;
          const colSab    = hdr['sabado_controlable']    ?? 28;
          const colDom    = hdr['domingo_controlable']   ?? 29;
          const isSI = (v: any) => String(v ?? '').toUpperCase().trim() === 'SI';

          ws.eachRow((r: any, rn: number) => {
            if (rn === 1) return;
            const dni = normDni(r.getCell(colDniH)?.value);
            if (!dni) return;
            horariosMap[dni] = {
              lunes:     isSI(r.getCell(colLun)?.value),
              martes:    isSI(r.getCell(colMar)?.value),
              miercoles: isSI(r.getCell(colMie)?.value),
              jueves:    isSI(r.getCell(colJue)?.value),
              viernes:   isSI(r.getCell(colVie)?.value),
              sabado:    isSI(r.getCell(colSab)?.value),
              domingo:   isSI(r.getCell(colDom)?.value),
            };
          });
        }
      }

      // ── 3. Expandir rangos a días individuales ───────────────────────────────
      // DOW (getUTCDay): 0=dom, 1=lun, 2=mar, 3=mie, 4=jue, 5=vie, 6=sab
      const DOW_KEYS: (keyof HorarioDia)[] = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
      const DOW_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

      // ── 3b. Leer SIAP (opcional) → mapa DNI → rangos con novedad ───────────────
      const autoSiap = files.find(f => f.name.toLowerCase().includes('siap'));
      const siapFile = req.query.siapFile
        ? path.join(dir, String(req.query.siapFile))
        : autoSiap?.fullPath ?? null;

      // siapByDni: dni → [{ novedad, desde, hasta }]
      const siapByDni: Record<string, Array<{ novedad: string; desde: Date; hasta: Date }>> = {};
      if (siapFile && fs.existsSync(siapFile)) {
        try {
          const siapRows = await parseSiap(siapFile);
          for (const r of siapRows) {
            const dni = normDni(r.dni);
            if (!dni) continue;
            const desde = parseDate(r.desde);
            const hasta = parseDate(r.hasta) ?? desde;
            if (!desde || !hasta) continue;
            if (!siapByDni[dni]) siapByDni[dni] = [];
            siapByDni[dni].push({ novedad: String(r.novedad ?? '').trim(), desde, hasta });
          }
        } catch (e: any) {
          logger.warn({ msg: 'ausentes28: error leyendo SIAP', error: e?.message });
        }
      }

      const getSiapNovedades = (dni: string, fecha: string): string => {
        const d = parseDate(fecha);
        if (!d) return '';
        const dt = toUTCMidnight(d);
        const matches = (siapByDni[dni] ?? []).filter(e =>
          toUTCMidnight(e.desde) <= dt && dt <= toUTCMidnight(e.hasta)
        );
        return [...new Set(matches.map(e => e.novedad).filter(Boolean))].join(' / ');
      };

      interface ExpandedRow {
        dni: string;
        nombre: string;
        novedadMinisterio: string;
        fecha: string;
        diaSemana: string;
        debiaVenir: boolean | null;
      }
      const expanded: ExpandedRow[] = [];

      for (const row of rows28) {
        const dni = normDni(row.dni);
        if (!dni) continue;
        const desde = parseDate(row.desde);
        const hasta = parseDate(row.hasta) ?? desde;
        if (!desde) continue;

        const cur = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()));
        const fin = new Date(Date.UTC((hasta as Date).getUTCFullYear(), (hasta as Date).getUTCMonth(), (hasta as Date).getUTCDate()));

        while (cur <= fin) {
          const dow   = cur.getUTCDay();
          const fecha = dateToStr(cur);
          const hor   = horariosMap[dni] ?? null;
          const debiaVenir: boolean | null = hor ? (hor[DOW_KEYS[dow]] ?? false) : null;
          expanded.push({ dni, nombre: row.nombre, novedadMinisterio: String(row.novedad ?? '').trim(), fecha, diaSemana: DOW_LABELS[dow], debiaVenir });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      // ── 4. Consultar DB biométrica ───────────────────────────────────────────
      type FichajeInfo = { entrada: string | null; salida: string | null };
      const fichajesMap: Record<string, Record<string, FichajeInfo>> = {};
      let dbError: string | null = null;

      const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const conn = await mysql.createConnection({
            host:           cfg.mysqlHost   || '127.0.0.1',
            port:           cfg.mysqlPort   || 3306,
            user:           cfg.mysqlUser   || 'root',
            password:       cfg.mysqlPass   || '',
            database:       cfg.mysqlDb     || 'adms_db',
            connectTimeout: 10_000,
            dateStrings:    true,
          });

          const allDnis   = [...new Set(expanded.map(r => r.dni))];
          const allDates  = [...new Set(expanded.map(r => r.fecha))].sort();
          const minDate   = allDates[0];
          const maxDate   = allDates[allDates.length - 1];

          if (allDnis.length > 0) {
            const ph = allDnis.map(() => '?').join(',');
            const [dbRows] = await conn.query<RowDataPacket[]>(
              `SELECT ui.badgenumber, ci.checktime, ci.checktype
                 FROM checkinout ci
                 INNER JOIN userinfo ui ON ci.userid = ui.userid
                 WHERE ui.badgenumber IN (${ph})
                   AND ci.checktime >= ? AND ci.checktime <= ?
                 ORDER BY ci.checktime ASC`,
              [...allDnis, `${minDate} 00:00:00`, `${maxDate} 23:59:59`],
            );
            await conn.end();

            for (const r of dbRows) {
              const dniR  = normDni(String(r.badgenumber));
              const cts   = String(r.checktime);
              const fecha = cts.slice(0, 10);
              const hora  = cts.slice(11, 16);
              const tipo  = String(r.checktype);
              if (!fichajesMap[dniR]) fichajesMap[dniR] = {};
              if (!fichajesMap[dniR][fecha]) fichajesMap[dniR][fecha] = { entrada: null, salida: null };
              if (tipo === '0') {
                if (!fichajesMap[dniR][fecha].entrada || hora < fichajesMap[dniR][fecha].entrada!) {
                  fichajesMap[dniR][fecha].entrada = hora;
                }
              } else {
                if (!fichajesMap[dniR][fecha].salida || hora > fichajesMap[dniR][fecha].salida!) {
                  fichajesMap[dniR][fecha].salida = hora;
                }
              }
            }
          }
        } catch (e: any) {
          dbError = e?.message ?? 'Error al consultar DB biométrica';
          logger.warn({ msg: 'ausentes28: error DB biométrica', error: dbError });
        }
      } else {
        dbError = 'fichero_config.json no encontrado — configura la conexión en el módulo Fichero';
      }

      // ── 5. Construir resultado ───────────────────────────────────────────────
      const data = expanded.map(r => {
        const fich = fichajesMap[r.dni]?.[r.fecha];
        return {
          dni:               r.dni,
          nombre:            r.nombre,
          fecha:             r.fecha,
          diaSemana:         r.diaSemana,
          debiaVenir:        r.debiaVenir,
          novedadMinisterio: r.novedadMinisterio,
          novedadSiap:       getSiapNovedades(r.dni, r.fecha),
          tieneFichaje:      fich !== undefined,
          entrada:           fich?.entrada ?? null,
          salida:            fich?.salida  ?? null,
        };
      });

      return res.json({
        ok: true,
        data,
        meta: {
          total:           data.length,
          conFichaje:      data.filter(r => r.tieneFichaje).length,
          sinFichaje:      data.filter(r => !r.tieneFichaje).length,
          debiaVenir:      data.filter(r => r.debiaVenir === true).length,
          noDebiaVenir:    data.filter(r => r.debiaVenir === false).length,
          sinInfoHorario:  data.filter(r => r.debiaVenir === null).length,
          sinBiometrico:   dbError ? true : false,
          dbError,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  return router;
}