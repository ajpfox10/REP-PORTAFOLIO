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

// Divide novedades compuestas solo cuando la barra está usada como separador con espacios.
// No rompe textos legales como "Y/O" o "MAMARIO/PROSTATA/COLON".
function splitNovedadesCompuestas(v: any): string[] {
  const base = normNovedad(v);
  if (!base) return [];
  return Array.from(new Set([
    base,
    ...base.split(/\s+\/\s+/).map(normNovedad),
  ].filter(Boolean)));
}

function mergeMapeo(
  base: Record<string, string[]>,
  extra: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  const add = (k: string, arr: string[]) => {
    const kk = normNovedad(k);
    if (!kk) return;
    const actuales = out[kk] || [];
    out[kk] = Array.from(new Set([
      kk,
      ...actuales,
      ...(arr || []).map(normNovedad).filter(Boolean),
    ]));
  };

  for (const [k, arr] of Object.entries(base || {})) add(k, arr);
  for (const [k, arr] of Object.entries(extra || {})) add(k, arr);

  return out;
}

function equivsMinisterio(mapeoN: Record<string, string[]>, novMinisterioNorm: string): string[] {
  return Array.from(new Set([
    novMinisterioNorm,
    ...(mapeoN[novMinisterioNorm] || []),
  ].filter(Boolean)));
}

function novedadesConectan(equivs: string[], novSiap: any): boolean {
  const siapParts = splitNovedadesCompuestas(novSiap);
  return equivs.some(e => siapParts.includes(normNovedad(e)));
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
  '08-DESCANSO ANUAL': [
    'ANUAL',
    '08-DESCANSO ANUAL',
  ],

  '29-COMPLEMENTARIA': [
    'ANUAL COMPLEMENTARIA',
    '29-COMPLEMENTARIA',
  ],

  '291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.': [
    'ANUAL COMPLEMENTARIA 10430',
    '291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.',
  ],

  '93-LICENCIA COMPLEMENT.ANT.DENEGADA': [
    'ANUAL COMPLEMENTARIA',
    '93-LICENCIA COMPLEMENT.ANT.DENEGADA',
  ],

  '81-LICENCIA ANTERIOR DENEGADA': [
    'ANUAL',
    '81-LICENCIA ANTERIOR DENEGADA',
  ],

  '01-POR RAZONES DE ENFERMEDAD': [
    'ENFERMEDAD',
    '01-POR RAZONES DE ENFERMEDAD',
  ],

  '1R-ENFERMEDAD DE RIESGO': [
    'ENFERMEDAD',
    '1R-ENFERMEDAD DE RIESGO',
  ],

  'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)': [
    'ENFERMEDAD',
    'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)',
  ],

  '05-POR ATENCION DE FAMILIAR ENFERMO': [
    'ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE',
    'ATENCION FAMILIAR ENFERMO',
    '05-POR ATENCION DE FAMILIAR ENFERMO',
  ],

  '04-POR ACCIDENTE DE TRABAJO': [
    'ACCIDENTE DE TRABAJO',
    '04-POR ACCIDENTE DE TRABAJO',
  ],

  '06-POR MATERNIDAD': [
    'MATERNIDAD',
    'NACIMIENTO',
    '06-POR MATERNIDAD',
  ],

  'RN1-RECIEN NACIDO': [
    'NACIMIENTO',
    'CUIDADO RECIEN NACIDO/A',
    'RN1-RECIEN NACIDO',
  ],

  'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO': [
    'MUJER VICTIMA DE VIOLENCIA',
    'PARA MUJERES VICTIMAS DE VIOLENCIA',
    'VIOLENCIA DE GENERO',
    'VICTIMA DE VIOLENCIA DE GENERO',
    'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO',
  ],

  '18-POR EXAMEN': [
    'EXAMEN',
    'INTEGRACION DE MESA EXAMINADORA',
    '18-POR EXAMEN',
  ],

  '17-POR PRE-EXAMEN': [
    'PRE-EXAMEN',
    '17-POR PRE-EXAMEN',
  ],

  'DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA': [
    'PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA',
    'DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA',
  ],

  'PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON': [
    'EX.MED.PREV.CANCER MAMARIO/PROSTATA/COLON',
    'PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON',
  ],

  '14-DUELO FAMILIAR DIRECTO': [
    'DUELO DIRECTO',
    '14-DUELO FAMILIAR DIRECTO',
  ],

  '15-DUELO FAMILIAR INDIRECTO': [
    'DUELO INDIRECTO',
    '15-DUELO FAMILIAR INDIRECTO',
  ],

  '16-POR MATRIMONIO': [
    'MATRIMONIO',
    '16-POR MATRIMONIO',
  ],

  '22-ACTIVIDAD GREMIAL': [
    'PERMISO GREMIAL DIAS',
    'COMISION',
    '22-ACTIVIDAD GREMIAL',
  ],

  '44-PERMISO CITACIONES ORG.OFICIAL': [
    'CITACION ORG.OFICIALES',
    '44-PERMISO CITACIONES ORG.OFICIAL',
  ],

  '261-POR CAUSAS PARTICULARES': [
    'CAUSAS PARTICULARES',
    '261-POR CAUSAS PARTICULARES',
  ],
};

const DEFAULT_SKIP_NOVEDADES: string[] = [
  // ejemplos de novedades a omitir (si hiciera falta)
];

function getMapeoFile(dir: string) {
  return path.join(dir, 'mapeo.asistencia.json');
}

function loadMapeo(dir: string): Record<string, string[]> {
  const fp = getMapeoFile(dir);

  if (!fs.existsSync(fp)) {
    return DEFAULT_MAPEO;
  }

  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const json = JSON.parse(raw);

    if (json && typeof json === 'object' && !Array.isArray(json)) {
      // El JSON del editor NO debe pisar el mapeo base: se fusiona.
      // Así no se pierden equivalencias críticas para detectar RANGO_DISTINTO.
      return mergeMapeo(DEFAULT_MAPEO, json);
    }

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

function clipRowToPeriodForCompare(row: any, period: { start: Date; end: Date }): any | null {
  let desde = parseDate(row?.desde);
  let hasta = parseDate(row?.hasta) ?? desde;

  if (!desde && hasta) desde = hasta;
  if (!desde || !hasta) return null;

  const s = toUTCMidnight(desde);
  const e = toUTCMidnight(hasta);
  const ps = toUTCMidnight(period.start);
  const pe = toUTCMidnight(period.end);

  // Si no toca el mes, se descarta.
  if (e < ps || s > pe) return null;

  // Se compara SOLO la parte del rango que cae dentro del mes solicitado,
  // pero se conservan las fechas originales para mostrar y exportar.
  const cmpDesde = s < ps ? ps : s;
  const cmpHasta = e > pe ? pe : e;

  return {
    ...row,
    desdeOriginal: desde,
    hastaOriginal: hasta,
    cmpDesde,
    cmpHasta,
  };
}

function getCmpDesde(row: any): Date | null {
  return parseDate(row?.cmpDesde) ?? parseDate(row?.desde);
}

function getCmpHasta(row: any): Date | null {
  return parseDate(row?.cmpHasta) ?? parseDate(row?.hasta) ?? getCmpDesde(row);
}

function getOriginalDesde(row: any): Date | null {
  return parseDate(row?.desdeOriginal) ?? parseDate(row?.desde);
}

function getOriginalHasta(row: any): Date | null {
  return parseDate(row?.hastaOriginal) ?? parseDate(row?.hasta) ?? getOriginalDesde(row);
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

    const equivs = equivsMinisterio(mapeoN, novN);

    const minDesde = getCmpDesde(min);
    const minHasta = getCmpHasta(min);

    let vioSiapConNovedadMapeada = false;
    let vioRangoDistinto = false;
    let vioSolape = false;
    let bestCandidate: any = null;

    const match = (siapByDni[dniMin] || []).find((s: any) => {
      if (!novedadesConectan(equivs, s.novedad)) return false;
      vioSiapConNovedadMapeada = true;

      const sDesde = getCmpDesde(s);
      const sHasta = getCmpHasta(s);

      // Si faltan fechas, NO matcheamos (evita falsos coincidentes)
      if (!minDesde || !minHasta || !sDesde || !sHasta) return false;

      // Igualdad exacta de rangos (desde y hasta). Si conecta por novedad pero no por fecha,
      // debe quedar como inconsistencia RANGO_DISTINTO, no desaparecer.
      const ok =
        toUTCMidnight(minDesde).getTime() === toUTCMidnight(sDesde).getTime() &&
        toUTCMidnight(minHasta).getTime() === toUTCMidnight(sHasta).getTime();

      if (!ok) {
        if (!bestCandidate) bestCandidate = s;
        vioRangoDistinto = true;
        if (overlap(minDesde, minHasta, sDesde, sHasta)) vioSolape = true;
      }

      return ok;
    });

    const motivo =
      match ? '' :
      vioRangoDistinto ? 'RANGO_DISTINTO' :
      vioSolape ? 'SOLAPA_PERO_NO_IGUAL' :
      vioSiapConNovedadMapeada ? 'MAPEO_OK_PERO_SIN_MATCH' :
      'SIAP_SIN_NOVEDAD_EQUIVALENTE';

    const displaySiap = match ?? bestCandidate;

    return {
      dni: (min as any).dni, nombre: (min as any).nombre,
      novedad_ministerio: nov,
      fecha_desde_ministerio: dateToStr(getOriginalDesde(min)),
      fecha_hasta_ministerio: dateToStr(getOriginalHasta(min)),
      novedad_siap: displaySiap ? displaySiap.novedad : '—',
      fecha_desde_siap: displaySiap ? dateToStr(getOriginalDesde(displaySiap)) : '—',
      fecha_hasta_siap: displaySiap ? dateToStr(getOriginalHasta(displaySiap)) : '—',
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
    const sDesde = getCmpDesde(s);
    const sHasta = getCmpHasta(s);

    const baseRow = {
      dni:              (s as any).dni,
      nombre:           (s as any).nombre,
      novedad_siap:     novS,
      fecha_desde_siap: dateToStr(getOriginalDesde(s)),
      fecha_hasta_siap: dateToStr(getOriginalHasta(s)),
      upa,
      justificado:      justS,
    };

    if (skipNovedades.some(sk => novSN.includes(normNovedad(sk)))) {
      return { ...baseRow, novedad_ministerio: '—', fecha_desde_ministerio: '—', fecha_hasta_ministerio: '—', estado: 'OMITIDO' };
    }

    let vioMismoMapeo = false;    // el mapeo conecta, pero no se logró match exacto de fecha
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
      const equivs = equivsMinisterio(mapeoN, novMN);

      if (!novedadesConectan(equivs, novSN)) return false;
      vioMismoMapeo = true;

      // Regla ANUAL COMPLEMENTARIA: usar JUSTIFICADO para distinguir aprobada/denegada
      if (novSN.includes('ANUAL COMPLEMENTARIA')) {
        const minEsDenegada = novMN.includes('DENEGADA');
        if (justS === 'NO' && !minEsDenegada) return false;
        if (justS === 'SI' && minEsDenegada)  return false;
      }

      const mDesde = getCmpDesde(m);
      const mHasta = getCmpHasta(m);
      if (!mDesde || !mHasta || !sDesde || !sHasta) return false;

      const ok =
        toUTCMidnight(mDesde).getTime() === toUTCMidnight(sDesde).getTime() &&
        toUTCMidnight(mHasta).getTime() === toUTCMidnight(sHasta).getTime();

      if (!ok) {
        if (!bestCandidate) bestCandidate = m;
        vioRangoDistinto = true;
        if (overlap(mDesde, mHasta, sDesde, sHasta)) vioSolape = true;
      }

      return ok;
    });

    const motivo =
      match              ? '' :
      mins.length === 0  ? `DNI_NO_EXISTE_EN_MINISTERIO_PARA_${upa}` :
      vioRangoDistinto   ? 'RANGO_DISTINTO' :
      vioSolape          ? 'SOLAPA_PERO_NO_IGUAL' :
      vioMismoMapeo      ? 'MAPEO_OK_PERO_SIN_MATCH' :
                           'MAPEO_NO_ENCUENTRA_EQUIVALENTE';

    // Si no hay match exacto pero el DNI existe en Ministerio → mostrar lo que tiene
    const displayMin = match ?? bestCandidate;
    const novedadesMinTexto = displayMin
      ? String(displayMin.novedad || '').trim()
      : mins.length > 0
        ? [...new Set(mins.map((m: any) => String(m.novedad || '').trim()).filter(Boolean))].join(' / ')
        : '—';

    return {
      ...baseRow,
      novedad_ministerio:     novedadesMinTexto,
      fecha_desde_ministerio: displayMin ? dateToStr(getOriginalDesde(displayMin)) : '—',
      fecha_hasta_ministerio: displayMin ? dateToStr(getOriginalHasta(displayMin)) : '—',
      estado: match ? 'COINCIDENTE' : 'NO COINCIDENTE',
      motivo,
    };
  });
}

export function buildAsistenciaRouter(sequelize?: import('sequelize').Sequelize) {
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
      // Se conservan las fechas originales para mostrar/exportar, pero se agregan
      // cmpDesde/cmpHasta recortadas al mes para comparar solo el período elegido.
      const period = parsePeriodoMes(req.body?.periodoMes);
      if (period) {
        siapRows = siapRows.map(r => clipRowToPeriodForCompare(r, period)).filter(Boolean) as any[];
        for (const upa of Object.keys(ministerioMap)) {
          ministerioMap[upa] = ministerioMap[upa].map(r => clipRowToPeriodForCompare(r, period)).filter(Boolean) as any[];
        }
        totalMinisterioRows = Object.values(ministerioMap).reduce((acc, rows) => acc + rows.length, 0);
      }

      // ── Deduplicar filas idénticas del Ministerio ─────────────────────────
      // Al igual que SIAP, el Ministerio puede tener filas duplicadas.
      for (const upa of Object.keys(ministerioMap)) {
        const seen = new Set<string>();
        ministerioMap[upa] = ministerioMap[upa].filter((r: any) => {
          const key = [normDni(r.dni), normNovedad(r.novedad), dateToStr(parseDate(r.desde)), dateToStr(parseDate(r.hasta))].join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
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

      const comparadoCompleto = comparado;
      // Por defecto esta pantalla devuelve solo errores/inconsistencias.
      // Si alguna vez necesitás ver todo, mandá { soloErrores: false } desde el front.
      const soloErrores = req.body?.soloErrores !== false;
      if (soloErrores) {
        comparado = comparado.filter((r: any) => r.estado === 'NO COINCIDENTE');
      }

      const siapF = path.parse(siapFile);

      return res.json({
        ok: true,
        data: {
          comparado,
          totals: {
            ministerio: totalMinisterioRows,
            siap: siapRows.length,
            coincidencias: comparadoCompleto.filter(r => r.estado === 'COINCIDENTE').length,
            no_coinciden:  comparadoCompleto.filter(r => r.estado === 'NO COINCIDENTE').length,
            omitidos:      comparadoCompleto.filter(r => r.estado === 'OMITIDO').length,
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
          const colLun    = hdr['lunes_controlable']     ?? 0;
          const colMar    = hdr['martes_controlable']    ?? 0;
          const colMie    = hdr['miercoles_controlable'] ?? 0;
          const colJue    = hdr['jueves_controlable']    ?? 0;
          const colVie    = hdr['viernes_controlable']   ?? 0;
          const colSab    = hdr['sabado_controlable']    ?? 0;
          const colDom    = hdr['domingo_controlable']   ?? 0;
          const colLunEnt = hdr['lunes_entrada']         ?? 0;
          const colMarEnt = hdr['martes_entrada']        ?? 0;
          const colMieEnt = hdr['miercoles_entrada']     ?? 0;
          const colJueEnt = hdr['jueves_entrada']        ?? 0;
          const colVieEnt = hdr['viernes_entrada']       ?? 0;
          const colSabEnt = hdr['sabado_entrada']        ?? 0;
          const colDomEnt = hdr['domingo_entrada']       ?? 0;
          const formatoA = colLun > 0;
          const isSI = (v: any) => String(v ?? '').toUpperCase().trim() === 'SI';
          const parseHora = (v: any): string | null => {
            const s = String(v ?? '').trim();
            const m = s.match(/^(\d{1,2}):(\d{2})/);
            return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
          };
          const esControlable = (ctrlCol: number, entCol: number, r: any) =>
            formatoA ? isSI(r.getCell(ctrlCol)?.value) : parseHora(r.getCell(entCol)?.value) !== null;

          ws.eachRow((r: any, rn: number) => {
            if (rn === 1) return;
            const dni = normDni(r.getCell(colDniH)?.value);
            if (!dni) return;
            horariosMap[dni] = {
              lunes:     esControlable(colLun, colLunEnt, r),
              martes:    esControlable(colMar, colMarEnt, r),
              miercoles: esControlable(colMie, colMieEnt, r),
              jueves:    esControlable(colJue, colJueEnt, r),
              viernes:   esControlable(colVie, colVieEnt, r),
              sabado:    esControlable(colSab, colSabEnt, r),
              domingo:   esControlable(colDom, colDomEnt, r),
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

      // siapByDni: dni → [{ novedad, desde, hasta, justificado }]
      const siapByDni: Record<string, Array<{ novedad: string; desde: Date; hasta: Date; justificado: string }>> = {};
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
            siapByDni[dni].push({
              novedad:      String(r.novedad      ?? '').trim(),
              desde,
              hasta,
              justificado:  String(r.justificado  ?? '').trim().toUpperCase(),
            });
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

      // null = sin novedad SIAP, true = justificada (SI), false = no justificada (NO/vacío)
      const getSiapJustificada = (dni: string, fecha: string): boolean | null => {
        const d = parseDate(fecha);
        if (!d) return null;
        const dt = toUTCMidnight(d);
        const matches = (siapByDni[dni] ?? []).filter(e =>
          toUTCMidnight(e.desde) <= dt && dt <= toUTCMidnight(e.hasta)
        );
        if (matches.length === 0) return null;
        return matches.some(e => e.justificado === 'SI');
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

      // ── 5. Consultar reconocimientos_medicos ─────────────────────────────────
      // recMedicoMap: "dni|YYYY-MM-DD" → tipo (o "" si no tiene tipo)
      const recMedicoMap = new Map<string, string>();
      if (sequelize && expanded.length > 0) {
        try {
          const allDnisRec = [...new Set(expanded.map(r => r.dni))];
          const allDatesRec = expanded.map(r => r.fecha);
          const minDateRec = allDatesRec.reduce((a, b) => (a < b ? a : b));
          const maxDateRec = allDatesRec.reduce((a, b) => (a > b ? a : b));
          const [recRows] = await sequelize.query(
            `SELECT dni, fecha_desde, fecha_hasta, tipo
               FROM reconocimientos_medicos
              WHERE dni IN (${allDnisRec.map(() => '?').join(',')})
                AND fecha_desde <= ?
                AND (fecha_hasta >= ? OR fecha_hasta IS NULL)`,
            { replacements: [...allDnisRec, maxDateRec, minDateRec] },
          ) as [any[], unknown];
          for (const rec of recRows) {
            const dniRec   = normDni(String(rec.dni));
            const desde    = String(rec.fecha_desde ?? '').slice(0, 10);
            const hasta    = rec.fecha_hasta ? String(rec.fecha_hasta).slice(0, 10) : maxDateRec;
            const tipoRec  = String(rec.tipo ?? '').trim();
            for (const row of expanded) {
              if (row.dni !== dniRec) continue;
              if (row.fecha >= desde && row.fecha <= hasta) {
                const key = `${row.dni}|${row.fecha}`;
                if (!recMedicoMap.has(key)) recMedicoMap.set(key, tipoRec);
              }
            }
          }
        } catch (e: any) {
          logger.warn({ msg: 'ausentes28: error consultando reconocimientos_medicos', error: e?.message });
        }
      }

      // ── 6. Construir resultado ───────────────────────────────────────────────
      const data = expanded.map(r => {
        const fich = fichajesMap[r.dni]?.[r.fecha];
        const recKey = `${r.dni}|${r.fecha}`;
        return {
          dni:               r.dni,
          nombre:            r.nombre,
          fecha:             r.fecha,
          diaSemana:         r.diaSemana,
          debiaVenir:        r.debiaVenir,
          novedadMinisterio: r.novedadMinisterio,
          novedadSiap:       getSiapNovedades(r.dni, r.fecha),
          siapJustificada:   getSiapJustificada(r.dni, r.fecha),
          tieneFichaje:      fich !== undefined,
          entrada:           fich?.entrada ?? null,
          salida:            fich?.salida  ?? null,
          recMedico:         recMedicoMap.has(recKey) ? (recMedicoMap.get(recKey) || 'Sí') : null,
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

  // ── GET /siap-fichajes ──────────────────────────────────────────────────────
  // Query params: periodo, siapFile, ministerioFile (opcional), horariosFile (opcional)
  router.get('/siap-fichajes', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend' });
    }
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);
      const auto  = findAutoFiles(files);

      // ── Archivos ──────────────────────────────────────────────────────────────
      const siapFilePath = req.query.siapFile
        ? path.join(dir, String(req.query.siapFile))
        : auto.siap ?? null;
      if (!siapFilePath || !fs.existsSync(siapFilePath)) {
        return res.status(400).json({ ok: false, error: 'No se encontró archivo SIAP' });
      }

      const ministerioFilePath = req.query.ministerioFile
        ? path.join(dir, String(req.query.ministerioFile))
        : auto.ministerio ?? null;

      const autoHorarios2 = files.find(f => f.name.toLowerCase().includes('horario'));
      const horariosFilePath = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : autoHorarios2?.fullPath ?? null;

      const period = req.query.periodo ? parsePeriodoMes(String(req.query.periodo)) : null;

      // ── 1. Leer SIAP → expandir a días individuales ──────────────────────────
      const DOW_KEYS2 = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'] as const;
      const DOW_LABELS2 = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

      let siapRaw = await parseSiap(siapFilePath);
      // deduplicar
      {
        const seen = new Set<string>();
        siapRaw = siapRaw.filter((r: any) => {
          const k = [normDni(r.dni), normNovedad(r.novedad), dateToStr(parseDate(r.desde)), dateToStr(parseDate(r.hasta))].join('|');
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
      }
      if (period) {
        siapRaw = siapRaw.map(r => clipRowToPeriod(r, period)).filter(Boolean) as any[];
      }

      // Solo ausentes
      siapRaw = siapRaw.filter((r: any) => normNovedad(r.novedad).includes('AUSENTE'));

      // ── 1b. Leer horarios ────────────────────────────────────────────────────
      // Para cada DNI: guarda la entrada por día y si es guardia rotativa 18-06
      interface HorarioDia2 {
        lunes: string | null; martes: string | null; miercoles: string | null;
        jueves: string | null; viernes: string | null; sabado: string | null; domingo: string | null;
        guardiaRotativa: boolean; // LMV / MJ semanas alternas
      }
      const horariosMap2: Record<string, HorarioDia2> = {};

      // ISO week number (1-53)
      const isoWeek = (d: Date): number => {
        const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const day = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
        const y1 = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        return Math.ceil(((tmp.getTime() - y1.getTime()) / 86400000 + 1) / 7);
      };

      if (horariosFilePath && fs.existsSync(horariosFilePath)) {
        try {
          const wb2 = new ExcelJS.Workbook();
          await wb2.xlsx.readFile(horariosFilePath);
          const ws2 = wb2.worksheets[0];
          if (ws2) {
            const hdr2: Record<string, number> = {};
            ws2.getRow(1).eachCell((c: any, col: number) => {
              const v = normHeader(c?.value ?? '');
              if (v) hdr2[v] = col;
            });
            const colDni2 = hdr2['nro_documento'] ?? hdr2['nro documento'] ?? hdr2['documento'] ?? 4;
            // columnas de entrada por día (formato: LUNES_ENTRADA = col 5, etc.)
            const cols: Record<string, number> = {
              lunes:     hdr2['lunes_entrada']     ?? 5,
              martes:    hdr2['martes_entrada']    ?? 7,
              miercoles: hdr2['miercoles_entrada'] ?? 9,
              jueves:    hdr2['jueves_entrada']    ?? 11,
              viernes:   hdr2['viernes_entrada']   ?? 13,
              sabado:    hdr2['sabado_entrada']    ?? 15,
              domingo:   hdr2['domingo_entrada']   ?? 17,
            };
            const getEntrada = (r: any, col: number): string | null => {
              const v = String(r.getCell(col)?.value ?? '').trim();
              return (v && v !== '-' && v !== 'null') ? v : null;
            };
            ws2.eachRow((r: any, rn: number) => {
              if (rn === 1) return;
              const dni = normDni(r.getCell(colDni2)?.value);
              if (!dni) return;
              const lE = getEntrada(r, cols.lunes);
              const mE = getEntrada(r, cols.martes);
              const xE = getEntrada(r, cols.miercoles);
              const jE = getEntrada(r, cols.jueves);
              const vE = getEntrada(r, cols.viernes);
              // Guardia rotativa: los 5 días de semana tienen 18:00 como entrada
              const is18 = (v: string | null) => v !== null && v.startsWith('18');
              const guardiaRotativa = is18(lE) && is18(mE) && is18(xE) && is18(jE) && is18(vE);
              horariosMap2[dni] = {
                lunes: lE, martes: mE, miercoles: xE, jueves: jE, viernes: vE,
                sabado:  getEntrada(r, cols.sabado),
                domingo: getEntrada(r, cols.domingo),
                guardiaRotativa,
              };
            });
          }
        } catch (e: any) {
          logger.warn({ msg: 'siap-fichajes: error leyendo horarios', error: e?.message });
        }
      }

      // debiaVenir se calcula después de tener fichajesMap (ver paso 5)

      interface SiapDiaRow {
        dni: string;
        nombre: string;
        novedadSiap: string;
        justificadoSiap: string;
        fecha: string;
        diaSemana: string;
        debiaVenir: boolean | null;
      }
      const expanded2: SiapDiaRow[] = [];
      for (const r of siapRaw) {
        const dni = normDni(r.dni);
        if (!dni) continue;
        const desde = parseDate(r.desde);
        const hasta = parseDate(r.hasta) ?? desde;
        if (!desde) continue;
        const cur = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()));
        const fin = new Date(Date.UTC((hasta as Date).getUTCFullYear(), (hasta as Date).getUTCMonth(), (hasta as Date).getUTCDate()));
        while (cur <= fin) {
          const fecha = dateToStr(cur);
          expanded2.push({
            dni,
            nombre:          String(r.nombre      ?? '').trim(),
            novedadSiap:     String(r.novedad      ?? '').trim(),
            justificadoSiap: String(r.justificado  ?? '').trim().toUpperCase(),
            fecha,
            diaSemana:       DOW_LABELS2[cur.getUTCDay()],
            debiaVenir:      null, // se rellena en paso 5, después de tener fichajes
          });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      if (expanded2.length === 0) {
        return res.json({ ok: true, data: [], meta: { total: 0, conFichaje: 0, sinFichaje: 0, enMinisterio: 0, sinMinisterio: 0, sinBiometrico: false, dbError: null } });
      }

      // ── 2. Indexar Ministerio por DNI → rangos ───────────────────────────────
      // minByDni: dni → [{ novedad, desde, hasta }]
      const minByDni: Record<string, Array<{ novedad: string; desde: Date; hasta: Date }>> = {};
      if (ministerioFilePath && fs.existsSync(ministerioFilePath)) {
        try {
          let minRows = await parseMinisterio(ministerioFilePath);
          if (period) minRows = minRows.map(r => clipRowToPeriod(r, period)).filter(Boolean) as any[];
          for (const m of minRows) {
            const dni = normDni(m.dni);
            if (!dni) continue;
            const desde = parseDate(m.desde);
            const hasta = parseDate(m.hasta) ?? desde;
            if (!desde || !hasta) continue;
            if (!minByDni[dni]) minByDni[dni] = [];
            minByDni[dni].push({ novedad: String(m.novedad ?? '').trim(), desde, hasta });
          }
        } catch (e: any) {
          logger.warn({ msg: 'siap-fichajes: error leyendo Ministerio', error: e?.message });
        }
      }
      const hayMinisterio = Object.keys(minByDni).length > 0;

      const getMinisterioNovedad = (dni: string, fecha: string): string => {
        const d = parseDate(fecha);
        if (!d) return '';
        const dt = toUTCMidnight(d);
        const matches = (minByDni[dni] ?? []).filter(m =>
          toUTCMidnight(m.desde) <= dt && dt <= toUTCMidnight(m.hasta)
        );
        return [...new Set(matches.map(m => m.novedad).filter(Boolean))].join(' / ');
      };

      // ── 3. Consultar DB biométrica ────────────────────────────────────────────
      type FichajeInfo2 = { entrada: string | null; salida: string | null };
      const fichajesMap2: Record<string, Record<string, FichajeInfo2>> = {};
      let dbError2: string | null = null;

      const cfgPath2 = path.resolve(process.cwd(), 'fichero_config.json');
      if (fs.existsSync(cfgPath2)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(cfgPath2, 'utf-8'));
          const conn = await mysql.createConnection({
            host:           cfg.mysqlHost || '127.0.0.1',
            port:           cfg.mysqlPort || 3306,
            user:           cfg.mysqlUser || 'root',
            password:       cfg.mysqlPass || '',
            database:       cfg.mysqlDb   || 'adms_db',
            connectTimeout: 10_000,
            dateStrings:    true,
          });

          const allDnis2  = [...new Set(expanded2.map(r => r.dni))];
          const allDates2 = [...new Set(expanded2.map(r => r.fecha))].sort();
          const minDate2  = allDates2[0];
          const maxDate2  = allDates2[allDates2.length - 1];

          if (allDnis2.length > 0) {
            const ph = allDnis2.map(() => '?').join(',');
            const [dbRows] = await conn.query<RowDataPacket[]>(
              `SELECT ui.badgenumber, ci.checktime, ci.checktype
                 FROM checkinout ci
                 INNER JOIN userinfo ui ON ci.userid = ui.userid
                 WHERE ui.badgenumber IN (${ph})
                   AND ci.checktime >= ? AND ci.checktime <= ?
                 ORDER BY ci.checktime ASC`,
              [...allDnis2, `${minDate2} 00:00:00`, `${maxDate2} 23:59:59`],
            );
            await conn.end();

            for (const r of dbRows) {
              const dniR  = normDni(String(r.badgenumber));
              const cts   = String(r.checktime);
              const fecha = cts.slice(0, 10);
              const hora  = cts.slice(11, 16);
              const tipo  = String(r.checktype);
              if (!fichajesMap2[dniR]) fichajesMap2[dniR] = {};
              if (!fichajesMap2[dniR][fecha]) fichajesMap2[dniR][fecha] = { entrada: null, salida: null };
              if (tipo === '0') {
                if (!fichajesMap2[dniR][fecha].entrada || hora < fichajesMap2[dniR][fecha].entrada!) {
                  fichajesMap2[dniR][fecha].entrada = hora;
                }
              } else {
                if (!fichajesMap2[dniR][fecha].salida || hora > fichajesMap2[dniR][fecha].salida!) {
                  fichajesMap2[dniR][fecha].salida = hora;
                }
              }
            }
          }
        } catch (e: any) {
          dbError2 = e?.message ?? 'Error al consultar DB biométrica';
          logger.warn({ msg: 'siap-fichajes: error DB biométrica', error: dbError2 });
        }
      } else {
        dbError2 = 'fichero_config.json no encontrado';
      }

      // ── 4. Construir resultado ────────────────────────────────────────────────

      // Helper: dado un DNI y una fecha, devuelve las fechas Lun→Vie de esa semana ISO
      const semanaISO = (fecha: string): string[] => {
        const d = parseDate(fecha);
        if (!d) return [];
        const dow = d.getUTCDay() || 7; // 1=lun … 7=dom
        const lunes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow - 1)));
        return [0,1,2,3,4].map(i => {
          const x = new Date(lunes);
          x.setUTCDate(x.getUTCDate() + i);
          return dateToStr(x);
        }); // [lun, mar, mie, jue, vie]
      };

      // Para guardia rotativa: mira fichajes de la semana para saber si es LMV o MJ
      // Busca en la semana actual, luego en ±1 semana con ciclo invertido
      const cicloGuardia = (dni: string, fecha: string): 'LMV' | 'MJ' | null => {
        const fichDni = fichajesMap2[dni] ?? {};

        const detectar = (dias: string[]): 'LMV' | 'MJ' | null => {
          // dias = [lun, mar, mie, jue, vie]
          const tieneLMV = fichDni[dias[0]] || fichDni[dias[2]] || fichDni[dias[4]]; // L M V
          const tieneMJ  = fichDni[dias[1]] || fichDni[dias[3]];                     // M J
          if (tieneLMV) return 'LMV';
          if (tieneMJ)  return 'MJ';
          return null;
        };

        const dias = semanaISO(fecha);
        const ciclo = detectar(dias);
        if (ciclo) return ciclo;

        // Semana anterior (invertida)
        const prevLun = new Date(Date.UTC(...(dias[0].split('-').map(Number) as [number,number,number])));
        prevLun.setUTCDate(prevLun.getUTCDate() - 7);
        const diasPrev = [0,1,2,3,4].map(i => { const x = new Date(prevLun); x.setUTCDate(x.getUTCDate()+i); return dateToStr(x); });
        const cicloPrev = detectar(diasPrev);
        if (cicloPrev) return cicloPrev === 'LMV' ? 'MJ' : 'LMV'; // semana siguiente = invertida

        // Semana siguiente (invertida)
        const nextLun = new Date(Date.UTC(...(dias[0].split('-').map(Number) as [number,number,number])));
        nextLun.setUTCDate(nextLun.getUTCDate() + 7);
        const diasNext = [0,1,2,3,4].map(i => { const x = new Date(nextLun); x.setUTCDate(x.getUTCDate()+i); return dateToStr(x); });
        const cicloNext = detectar(diasNext);
        if (cicloNext) return cicloNext === 'LMV' ? 'MJ' : 'LMV';

        return null;
      };

      const calcDebiaVenir = (dni: string, fecha: string): boolean | null => {
        const hor = horariosMap2[dni];
        if (!hor) return null;
        const d = parseDate(fecha);
        if (!d) return null;
        const dow = d.getUTCDay();
        if (hor.guardiaRotativa) {
          const ciclo = cicloGuardia(dni, fecha);
          if (!ciclo) return null;
          if (ciclo === 'LMV') return dow === 1 || dow === 3 || dow === 5;
          return dow === 2 || dow === 4;
        }
        const diaEntrada: Record<number, string | null> = {
          0: hor.domingo, 1: hor.lunes, 2: hor.martes,
          3: hor.miercoles, 4: hor.jueves, 5: hor.viernes, 6: hor.sabado,
        };
        return diaEntrada[dow] !== null;
      };

      const data2 = expanded2.map(r => {
        const fich   = fichajesMap2[r.dni]?.[r.fecha];
        const novMin = getMinisterioNovedad(r.dni, r.fecha);
        return {
          dni:               r.dni,
          nombre:            r.nombre,
          fecha:             r.fecha,
          diaSemana:         r.diaSemana,
          novedadSiap:       r.novedadSiap,
          justificadoSiap:   r.justificadoSiap,
          debiaVenir:        calcDebiaVenir(r.dni, r.fecha),
          enMinisterio:      hayMinisterio ? novMin.length > 0 : null,
          novedadMinisterio: novMin || '',
          tieneFichaje:      fich !== undefined,
          entrada:           fich?.entrada ?? null,
          salida:            fich?.salida  ?? null,
        };
      });

      return res.json({
        ok: true,
        data: data2,
        meta: {
          total:         data2.length,
          conFichaje:    data2.filter(r => r.tieneFichaje).length,
          sinFichaje:    data2.filter(r => !r.tieneFichaje).length,
          enMinisterio:  hayMinisterio ? data2.filter(r => r.enMinisterio).length : null,
          sinMinisterio: hayMinisterio ? data2.filter(r => !r.enMinisterio).length : null,
          sinBiometrico: dbError2 ? true : false,
          dbError:       dbError2,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  // ── GET /agente-mes ─────────────────────────────────────────────────────────
  // Devuelve todos los días del mes para un DNI: fichaje + novedades SIAP y Ministerio
  // Query params: dni, periodo (YYYY-MM), siapFile, ministerioFile
  router.get('/agente-mes', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta exceljs' });
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);
      const auto  = findAutoFiles(files);

      const dni    = normDni(String(req.query.dni ?? ''));
      const period = parsePeriodoMes(String(req.query.periodo ?? ''));
      if (!dni)    return res.status(400).json({ ok: false, error: 'Falta dni' });
      if (!period) return res.status(400).json({ ok: false, error: 'Falta periodo' });

      const siapFilePath = req.query.siapFile
        ? path.join(dir, String(req.query.siapFile)) : auto.siap ?? null;
      const ministerioFilePath = req.query.ministerioFile
        ? path.join(dir, String(req.query.ministerioFile)) : auto.ministerio ?? null;

      const DOW_LABELS3 = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

      // ── Todos los días del mes ──────────────────────────────────────────────
      const dias: { fecha: string; diaSemana: string }[] = [];
      const cur = new Date(period.start);
      while (cur <= period.end) {
        dias.push({ fecha: dateToStr(cur), diaSemana: DOW_LABELS3[cur.getUTCDay()] });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      // ── SIAP: novedades del agente en el mes ────────────────────────────────
      const siapByFecha: Record<string, { novedad: string; justificado: string }[]> = {};
      if (siapFilePath && fs.existsSync(siapFilePath)) {
        let siapRows = await parseSiap(siapFilePath);
        siapRows = siapRows.filter((r: any) => normDni(r.dni) === dni);
        siapRows = siapRows.map(r => clipRowToPeriod(r, period)).filter(Boolean) as any[];
        for (const r of siapRows) {
          const desde = parseDate(r.desde);
          const hasta = parseDate(r.hasta) ?? desde;
          if (!desde || !hasta) continue;
          const c = new Date(desde);
          while (c <= hasta) {
            const f = dateToStr(c);
            if (!siapByFecha[f]) siapByFecha[f] = [];
            siapByFecha[f].push({
              novedad:     String(r.novedad     ?? '').trim(),
              justificado: String(r.justificado ?? '').trim().toUpperCase(),
            });
            c.setUTCDate(c.getUTCDate() + 1);
          }
        }
      }

      // ── Ministerio: novedades del agente en el mes ──────────────────────────
      const minByFecha: Record<string, string[]> = {};
      if (ministerioFilePath && fs.existsSync(ministerioFilePath)) {
        let minRows = await parseMinisterio(ministerioFilePath);
        minRows = minRows.filter((r: any) => normDni(r.dni) === dni);
        minRows = minRows.map(r => clipRowToPeriod(r, period)).filter(Boolean) as any[];
        for (const m of minRows) {
          const desde = parseDate(m.desde);
          const hasta = parseDate(m.hasta) ?? desde;
          if (!desde || !hasta) continue;
          const c = new Date(desde);
          while (c <= hasta) {
            const f = dateToStr(c);
            if (!minByFecha[f]) minByFecha[f] = [];
            minByFecha[f].push(String(m.novedad ?? '').trim());
            c.setUTCDate(c.getUTCDate() + 1);
          }
        }
      }

      // ── Fichajes del agente en el mes ───────────────────────────────────────
      const fichajesByFecha: Record<string, { entrada: string | null; salida: string | null }> = {};
      let dbErr: string | null = null;
      const cfgPath3 = path.resolve(process.cwd(), 'fichero_config.json');
      if (fs.existsSync(cfgPath3)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(cfgPath3, 'utf-8'));
          const conn = await mysql.createConnection({
            host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
            user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '',
            database: cfg.mysqlDb || 'adms_db', connectTimeout: 10_000, dateStrings: true,
          });
          const minDate3 = dateToStr(period.start);
          const maxDate3 = dateToStr(period.end);
          const [rows3] = await conn.query<RowDataPacket[]>(
            `SELECT ui.badgenumber, ci.checktime, ci.checktype
               FROM checkinout ci
               INNER JOIN userinfo ui ON ci.userid = ui.userid
               WHERE ui.badgenumber = ?
                 AND ci.checktime >= ? AND ci.checktime <= ?
               ORDER BY ci.checktime ASC`,
            [dni, `${minDate3} 00:00:00`, `${maxDate3} 23:59:59`],
          );
          await conn.end();
          for (const r of rows3) {
            const cts  = String(r.checktime);
            const f    = cts.slice(0, 10);
            const hora = cts.slice(11, 16);
            const tipo = String(r.checktype);
            if (!fichajesByFecha[f]) fichajesByFecha[f] = { entrada: null, salida: null };
            if (tipo === '0') {
              if (!fichajesByFecha[f].entrada || hora < fichajesByFecha[f].entrada!)
                fichajesByFecha[f].entrada = hora;
            } else {
              if (!fichajesByFecha[f].salida || hora > fichajesByFecha[f].salida!)
                fichajesByFecha[f].salida = hora;
            }
          }
        } catch (e: any) {
          dbErr = e?.message ?? 'Error DB';
        }
      } else {
        dbErr = 'Sin conexión biométrica';
      }

      // ── Horarios del agente ─────────────────────────────────────────────────
      const DOW_HOR_KEYS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
      const horarioPorDow: (string | null)[] = [null, null, null, null, null, null, null];
      const horariosFilePath2 = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : files.find(f => f.name.toLowerCase().includes('horario'))?.fullPath ?? null;
      if (horariosFilePath2 && fs.existsSync(horariosFilePath2)) {
        const wbH = new ExcelJS.Workbook();
        await wbH.xlsx.readFile(horariosFilePath2);
        const wsH = wbH.worksheets[0];
        if (wsH) {
          const hdrH: Record<string, number> = {};
          wsH.getRow(1).eachCell((c: any, col: number) => {
            const v = normHeader(c?.value ?? '');
            if (v) hdrH[v] = col;
          });
          const colDniH2 = hdrH['nro_documento'] ?? hdrH['nro documento'] ?? hdrH['documento'] ?? 4;
          const colEnt  = DOW_HOR_KEYS.map(d => hdrH[`${d}_entrada`]       ?? 0);
          const colCtrl = DOW_HOR_KEYS.map(d => hdrH[`${d}_controlable`]   ?? 0);
          const parseHoraH = (v: any): string | null => {
            const s = String(v ?? '').trim();
            const m = s.match(/^(\d{1,2}):(\d{2})/);
            return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
          };
          const isSIH = (v: any) => String(v ?? '').toUpperCase().trim() === 'SI';
          wsH.eachRow((r: any, rn: number) => {
            if (rn === 1) return;
            if (normDni(r.getCell(colDniH2)?.value) !== dni) return;
            for (let dow = 0; dow < 7; dow++) {
              const hora = colEnt[dow]  ? parseHoraH(r.getCell(colEnt[dow])?.value)  : null;
              const ctrl = colCtrl[dow] ? isSIH(r.getCell(colCtrl[dow])?.value)      : false;
              horarioPorDow[dow] = hora ?? (ctrl ? 'Sí' : null);
            }
          });
        }
      }

      // ── Armar respuesta ─────────────────────────────────────────────────────
      const data = dias.map(d => {
        const novsSiap = siapByFecha[d.fecha] ?? [];
        const novsMin  = minByFecha[d.fecha]  ?? [];
        const fich     = fichajesByFecha[d.fecha];
        const esAusente = novsSiap.some(n => normNovedad(n.novedad).includes('AUSENTE'));
        const dow = new Date(d.fecha + 'T00:00:00Z').getUTCDay();
        return {
          fecha:             d.fecha,
          diaSemana:         d.diaSemana,
          novedadesSiap:     novsSiap,
          novedadesMin:      [...new Set(novsMin.filter(Boolean))],
          esAusente,
          tieneFichaje:      !!fich,
          entrada:           fich?.entrada ?? null,
          salida:            fich?.salida  ?? null,
          horarioEntrada:    horarioPorDow[dow],
        };
      });

      // Nombre del agente (primer match en SIAP o Ministerio)
      let nombre = '';
      if (siapFilePath && fs.existsSync(siapFilePath)) {
        const sr = await parseSiap(siapFilePath);
        const found = sr.find((r: any) => normDni(r.dni) === dni);
        if (found) nombre = String(found.nombre ?? '').trim();
      }
      if (!nombre && ministerioFilePath && fs.existsSync(ministerioFilePath)) {
        const mr = await parseMinisterio(ministerioFilePath);
        const found = mr.find((r: any) => normDni(r.dni) === dni);
        if (found) nombre = String(found.nombre ?? '').trim();
      }

      return res.json({ ok: true, dni, nombre, periodo: req.query.periodo, data, dbError: dbErr });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // ── GET /reporte-servicio ─────────────────────────────────────────────────
  // Reporte mensual de asistencia por servicio: horas teóricas vs reales,
  // fichajes diarios, feriados y resúmenes semanales/mensuales.
  // Query params: servicio_id, periodo (YYYY-MM), siapFile, horariosFile
  router.get('/reporte-servicio', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs' });
    if (!sequelize)  return res.status(500).json({ ok: false, error: 'Sin conexión a DB principal' });

    try {
      const servicioId = req.query.servicio_id ? Number(req.query.servicio_id) : null;
      if (!servicioId) return res.status(400).json({ ok: false, error: 'Falta servicio_id' });

      const periodoStr = req.query.periodo ? String(req.query.periodo) : null;
      if (!periodoStr) return res.status(400).json({ ok: false, error: 'Falta periodo (YYYY-MM)' });
      const period = parsePeriodoMes(periodoStr);
      if (!period) return res.status(400).json({ ok: false, error: 'Período inválido, usar formato YYYY-MM' });

      const dir   = getDir();
      const files = listExcelFiles(dir);
      const auto  = findAutoFiles(files);

      const horariosFile = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : files.find(f => f.name.toLowerCase().includes('horario'))?.fullPath ?? null;

      const siapFile = req.query.siapFile
        ? path.join(dir, String(req.query.siapFile))
        : auto.siap ?? null;

      // ── 1. Nombre del servicio ─────────────────────────────────────────────
      const { QueryTypes } = await import('sequelize');
      const [svcRow] = await sequelize.query<{ id: number; nombre: string }>(
        'SELECT id, nombre FROM servicios WHERE id = :id AND deleted_at IS NULL LIMIT 1',
        { type: QueryTypes.SELECT, replacements: { id: servicioId } }
      );
      if (!svcRow) return res.status(404).json({ ok: false, error: `Servicio ${servicioId} no encontrado` });

      // ── 2. Agentes del servicio ────────────────────────────────────────────
      const agentesDb = await sequelize.query<{ dni: string; nombre_agente: string | null }>(
        `SELECT DISTINCT ags.dni,
                ags.nombre AS nombre_agente
         FROM agentes_servicios ags
         WHERE ags.servicio_id = :sid
           AND ags.deleted_at IS NULL
           AND (ags.fecha_hasta IS NULL OR ags.fecha_hasta >= :desde)
           AND ags.fecha_desde <= :hasta
         ORDER BY ags.nombre`,
        { type: QueryTypes.SELECT, replacements: { sid: servicioId, desde: period.start.toISOString().slice(0,10), hasta: period.end.toISOString().slice(0,10) } }
      );
      const dniList = [...new Set(agentesDb.map(a => normDni(a.dni)).filter(Boolean))];
      if (!dniList.length) return res.json({ ok: true, servicio: svcRow, periodo: periodoStr, feriados: [], agentes: [] });

      // ── 3. Feriados del mes ────────────────────────────────────────────────
      const feriadosDb = await sequelize.query<{ fecha: string; nombre: string; tipo: string }>(
        `SELECT DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha, nombre, tipo
         FROM feriados
         WHERE fecha >= :desde AND fecha <= :hasta
         ORDER BY fecha`,
        { type: QueryTypes.SELECT, replacements: { desde: period.start.toISOString().slice(0,10), hasta: period.end.toISOString().slice(0,10) } }
      );
      const feriadoSet = new Set(feriadosDb.map(f => f.fecha));

      // ── 4. Horarios ────────────────────────────────────────────────────────
      const DOW_KEYS_RS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'] as const;
      type HoraDia = { entrada: string|null; salida: string|null; controlable: boolean };
      type AgHorario = { nombre: string; esGuardia: boolean; dias: Record<string, HoraDia> };
      const horariosMap: Record<string, AgHorario> = {};

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
          const colDni2  = hdr['nro_documento'] ?? hdr['nro documento'] ?? hdr['documento'] ?? hdr['dni'] ?? 4;
          const colNom   = hdr['apellido_nombre'] ?? hdr['apellido y nombres'] ?? hdr['apellido y nombre'] ?? 0;
          const colPlant = hdr['planta_de_revista'] ?? hdr['planta de revista'] ?? 0;
          const isSI2    = (v: any) => String(v ?? '').toUpperCase().trim() === 'SI';
          const pHora2   = (v: any): string | null => {
            const s = String(v ?? '').trim();
            const m = s.match(/^(\d{1,2}):(\d{2})/);
            return m ? `${m[1].padStart(2,'0')}:${m[2]}` : null;
          };
          const diasCols = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
          const hasCtrl  = diasCols.some(d => hdr[`${d}_controlable`] > 0);

          ws.eachRow((r: any, rn: number) => {
            if (rn === 1) return;
            const dni2 = normDni(r.getCell(colDni2)?.value);
            if (!dniList.includes(dni2)) return;
            const nombre2 = colNom ? cellToText(r.getCell(colNom)?.value) : '';
            const planta2 = colPlant ? cellToText(r.getCell(colPlant)?.value).toUpperCase() : '';
            const esGuardia2 = planta2.includes('GUARDIA');
            const dias2: Record<string, HoraDia> = {};
            for (const d of diasCols) {
              const colEnt2 = hdr[`${d}_entrada`] ?? 0;
              const colSal2 = hdr[`${d}_salida`]  ?? 0;
              const colCtl2 = hdr[`${d}_controlable`] ?? 0;
              const ent2 = colEnt2 ? pHora2(r.getCell(colEnt2)?.value) : null;
              const sal2 = colSal2 ? pHora2(r.getCell(colSal2)?.value) : null;
              const ctrl2 = hasCtrl ? (colCtl2 ? isSI2(r.getCell(colCtl2)?.value) : false) : ent2 !== null;
              dias2[d] = { entrada: ent2, salida: sal2, controlable: ctrl2 };
            }
            horariosMap[dni2] = { nombre: nombre2, esGuardia: esGuardia2, dias: dias2 };
          });
        }
      }

      // ── 5. SIAP del mes ────────────────────────────────────────────────────
      type NovedadEntry = { novedad: string; desde: string; hasta: string };
      const siapMap: Record<string, NovedadEntry[]> = {};
      if (siapFile && fs.existsSync(siapFile)) {
        const siapRows = await parseSiap(siapFile);
        for (const s of siapRows) {
          const d = normDni((s as any).dni);
          if (!dniList.includes(d)) continue;
          const desde = parseDate((s as any).desde);
          const hasta  = parseDate((s as any).hasta);
          if (!desde || !hasta) continue;
          (siapMap[d] = siapMap[d] || []).push({
            novedad: String((s as any).novedad ?? '').trim(),
            desde: dateToStr(desde),
            hasta: dateToStr(hasta),
          });
        }
      }

      // ── 5b. Ministerio del mes ─────────────────────────────────────────────
      const minFile = req.query.ministerioFile
        ? path.join(dir, String(req.query.ministerioFile))
        : files.find(f => f.name.toLowerCase().includes('ministerio'))?.fullPath ?? null;
      const minMap: Record<string, NovedadEntry[]> = {};
      if (minFile && fs.existsSync(minFile)) {
        const minRows = await parseMinisterio(minFile);
        for (const m of minRows) {
          const d = normDni((m as any).dni);
          if (!dniList.includes(d)) continue;
          const desde = parseDate((m as any).desde);
          const hasta  = parseDate((m as any).hasta);
          if (!desde || !hasta) continue;
          (minMap[d] = minMap[d] || []).push({
            novedad: String((m as any).novedad ?? '').trim(),
            desde: dateToStr(desde),
            hasta: dateToStr(hasta),
          });
        }
      }

      // ── 6. Fichajes biométricos ────────────────────────────────────────────
      // mapa: dni → fecha → { entrada, salida, invertido }
      const fichajesMap: Record<string, Record<string, { entrada: string|null; salida: string|null; invertido: boolean }>> = {};
      let dbError: string | null = null;
      const cfgPathRS = path.resolve(process.cwd(), 'fichero_config.json');
      if (fs.existsSync(cfgPathRS)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(cfgPathRS, 'utf-8'));
          const bioConn = await mysql.createConnection({
            host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
            user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '',
            database: cfg.mysqlDb || 'adms_db', connectTimeout: 10_000, dateStrings: true,
          });
          const placeholders = dniList.map(() => '?').join(',');
          const dateFromRS = period.start.toISOString().slice(0, 10);
          const dateToRS   = period.end.toISOString().slice(0, 10);
          const [ficRows] = await bioConn.query<RowDataPacket[]>(
            `SELECT ui.badgenumber AS dni, ci.checktime, ci.checktype
             FROM checkinout ci
             INNER JOIN userinfo ui ON ci.userid = ui.userid
             WHERE ui.badgenumber IN (${placeholders})
               AND ci.checktime >= ? AND ci.checktime <= ?
             ORDER BY ci.checktime ASC`,
            [...dniList, `${dateFromRS} 00:00:00`, `${dateToRS} 23:59:59`]
          );
          await bioConn.end();

          // Primera pasada: agrupar todos los registros por agente y fecha
          const rawMap: Record<string, Record<string, { hora: string; tipo: string }[]>> = {};
          for (const row of ficRows) {
            const d     = normDni(row.dni);
            const cts   = String(row.checktime);
            const fecha = cts.slice(0, 10);
            const hora  = cts.slice(11, 16);
            if (!rawMap[d]) rawMap[d] = {};
            if (!rawMap[d][fecha]) rawMap[d][fecha] = [];
            rawMap[d][fecha].push({ hora, tipo: String(row.checktype) });
          }

          // Segunda pasada: determinar entrada/salida detectando fichaje invertido
          for (const [d, dateMap] of Object.entries(rawMap)) {
            fichajesMap[d] = {};
            for (const [fecha, records] of Object.entries(dateMap)) {
              // ya vienen ordenados ASC por checktime
              const entradas = records.filter(r => r.tipo === '0');
              const salidas  = records.filter(r => r.tipo !== '0');

              let entrada: string | null = entradas.length ? entradas[0].hora : null;
              let salida:  string | null = salidas.length  ? salidas[salidas.length - 1].hora : null;
              let invertido = false;

              // Si hay entrada pero no salida y existe más de un registro,
              // el agente fichó ambas marcaciones como tipo 0 (error).
              // Se usa el primer registro como entrada y el último como salida.
              if (entrada && !salida && records.length > 1) {
                salida    = records[records.length - 1].hora;
                invertido = true;
              }

              fichajesMap[d][fecha] = { entrada, salida, invertido };
            }
          }
        } catch (e: any) { dbError = e.message; }
      } else { dbError = 'fichero_config.json no encontrado'; }

      // ── 7. Armar días del mes ──────────────────────────────────────────────
      const minsHoras = (ent: string, sal: string): number => {
        const [eh, em] = ent.split(':').map(Number);
        const [sh, sm] = sal.split(':').map(Number);
        let diff = (sh * 60 + sm) - (eh * 60 + em);
        if (diff < 0) diff += 1440; // turno nocturno
        return diff;
      };
      const toHs = (mins: number) => Math.round(mins / 60 * 100) / 100;

      const allDias: string[] = [];
      const cur = new Date(period.start);
      while (cur <= period.end) {
        allDias.push(cur.toISOString().slice(0,10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      const DOW_LABELS_RS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

      // ── 8. Construir reporte por agente ────────────────────────────────────
      const agentes = agentesDb.map(ag => {
        const dni3 = normDni(ag.dni);
        const horAg = horariosMap[dni3] ?? null;
        const ficAg = fichajesMap[dni3] ?? {};

        let hTeoricoMes = 0, hRealMes = 0, diasLab = 0, diasFeriado = 0;
        let diasConFichaje = 0, diasSinFichaje = 0, diasConNovedad = 0, diasSinSalida = 0, diasCumplio = 0, diasInvertido = 0;
        const semanas: Record<string, { teorico: number; real: number; laboral: number }> = {};

        const diasDetalle = allDias.map(fecha => {
          const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
          const dowKey = DOW_KEYS_RS[dow] as string;
          const diaSemana = DOW_LABELS_RS[dow];
          const esFeriado = feriadoSet.has(fecha);
          const feriadoNombre = esFeriado ? (feriadosDb.find(f => f.fecha === fecha)?.nombre ?? '') : null;

          const horDia = horAg?.dias[dowKey] ?? null;
          const debiaTrabajo = !esFeriado && (horDia?.controlable ?? false);

          let horasTeoricas = 0;
          if (debiaTrabajo && horDia?.entrada && horDia?.salida) {
            horasTeoricas = toHs(minsHoras(horDia.entrada, horDia.salida));
          }
          if (esFeriado) diasFeriado++;
          else if (debiaTrabajo) { diasLab++; hTeoricoMes += horasTeoricas; }

          // Semana (lunes como inicio)
          const semKey = (() => {
            const dt2 = new Date(fecha + 'T00:00:00Z');
            const d2  = dt2.getUTCDay();
            const diff = d2 === 0 ? -6 : 1 - d2;
            dt2.setUTCDate(dt2.getUTCDate() + diff);
            return dt2.toISOString().slice(0,10);
          })();
          if (!semanas[semKey]) semanas[semKey] = { teorico: 0, real: 0, laboral: 0 };
          if (debiaTrabajo) { semanas[semKey].teorico += horasTeoricas; semanas[semKey].laboral++; }

          // Novedades SIAP + Ministerio que cubren esta fecha
          const siapAg = siapMap[dni3] ?? [];
          const minAg  = minMap[dni3]  ?? [];
          const novedades = [
            ...siapAg.filter(s => s.desde <= fecha && s.hasta >= fecha).map(s => `SIAP: ${s.novedad}`),
            ...minAg.filter(s => s.desde <= fecha && s.hasta >= fecha).map(s => `Min: ${s.novedad}`),
          ];
          if (novedades.length) diasConNovedad++;

          const fich = ficAg[fecha] ?? null;
          let horasReales = 0;
          if (fich?.entrada && fich?.salida) {
            horasReales = toHs(minsHoras(fich.entrada, fich.salida));
          }
          const cumplioHoras = debiaTrabajo && horasTeoricas > 0 && horasReales >= horasTeoricas * 0.9;
          if (cumplioHoras) diasCumplio++;
          if (fich) {
            diasConFichaje++;
            hRealMes += horasReales;
            semanas[semKey].real += horasReales;
            if (fich.entrada && !fich.salida) diasSinSalida++;
            if (fich.invertido) diasInvertido++;
          } else if (debiaTrabajo && !novedades.length) diasSinFichaje++;

          return {
            fecha, diaSemana, esFeriado, feriadoNombre,
            debiaTrabajo,
            esLaboralBase: !!(horDia?.controlable),
            entrada_prog: horDia?.entrada ?? null,
            salida_prog:  horDia?.salida  ?? null,
            horasTeoricas,
            entrada_real: fich?.entrada ?? null,
            salida_real:  fich?.salida  ?? null,
            invertido:    fich?.invertido ?? false,
            horasReales,
            cumplioHoras,
            novedades,
          };
        });

        const resumenSemanal = Object.entries(semanas)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([semana, v]) => ({ semana, ...v }));

        const nombreAg = horAg?.nombre || String(ag.nombre_agente ?? '') || dni3;

        return {
          dni: dni3,
          nombre: nombreAg,
          enHorario: !!horAg,
          dias: diasDetalle,
          resumenMensual: {
            diasLaborales: diasLab,
            diasFeriados: diasFeriado,
            horasTeoricas: Math.round(hTeoricoMes * 100) / 100,
            horasReales: Math.round(hRealMes * 100) / 100,
            diasConFichaje,
            diasSinFichaje,
            diasSinSalida,
            diasCumplio,
            diasConNovedad,
            diasInvertido,
          },
          resumenSemanal,
        };
      });

      return res.json({
        ok: true,
        servicio: svcRow,
        periodo: periodoStr,
        feriados: feriadosDb,
        agentes,
        dbError,
      });
    } catch (err: any) {
      logger.error({ msg: 'reporte-servicio error', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  return router;
}
