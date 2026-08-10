// src/routes/asistencia.routes.ts
// Comparador de asistencia MINISTERIO vs SIAP
//
// FLUJO:
//  GET  /asistencia/config          â†’ directorio configurado en .env
//  GET  /asistencia/archivos        â†’ lista los .xlsx/.xltx de EXCEL_ASISTENCIA_DIR
//  GET  /asistencia/mapeo           â†’ devuelve el mapeo actual de novedades (del JSON en disco)
//  PUT  /asistencia/mapeo           â†’ guarda el mapeo editado (persiste en disco)
//  DELETE /asistencia/mapeo         â†’ restaura el mapeo por defecto
//  POST /asistencia/comparar        â†’ compara usando los archivos del directorio
//  GET  /asistencia/ausentes28      â†’ ausentes cÃ³digo 28 cruzados con fichajes y horarios
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

// SheetJS: ExcelJS NO sabe leer el formato viejo .xls (binario OLE/BIFF).
// Lo usamos solo para convertir .xls â†’ .xlsx en memoria y dÃ¡rselo a ExcelJS.
let XLSX_SJS: any;
try { XLSX_SJS = require('xlsx'); } catch { XLSX_SJS = null; }

/**
 * Carga un workbook ExcelJS desde cualquier formato soportado.
 *  - .xlsx / .xltx â†’ lectura nativa de ExcelJS.
 *  - .xls          â†’ se convierte a .xlsx en memoria con SheetJS y se carga el
 *                    buffer. Sin esto, ExcelJS tira "Can't find end of central
 *                    directory" porque el .xls no es un ZIP.
 */
async function loadWorkbook(fp: string): Promise<any> {
  const wb = new ExcelJS.Workbook();
  if (path.extname(fp).toLowerCase() === '.xls') {
    if (!XLSX_SJS) {
      throw new Error('Falta dependencia "xlsx" para leer archivos .xls (npm i xlsx)');
    }
    // cellDates:false a propÃ³sito: dejamos las fechas como serial numÃ©rico.
    // Si SheetJS crea objetos Date, los arma en la zona horaria local del server
    // (UTC-3) y una fecha-entero (medianoche) termina cayendo el dÃ­a anterior en
    // UTC â†’ todo el Ministerio salÃ­a corrido -1 dÃ­a. Como nÃºmero, parseDate las
    // convierte en UTC sin corrimiento.
    const sjsWb = XLSX_SJS.readFile(fp, { cellDates: false });
    const buf = XLSX_SJS.write(sjsWb, { type: 'buffer', bookType: 'xlsx' });
    await wb.xlsx.load(buf);
    return wb;
  }
  await wb.xlsx.readFile(fp);
  return wb;
}


// Normaliza textos de "Novedad" para evitar falsos NO COINCIDENTE por:
// - espacios alrededor de '-' o '.'
// - mayÃºsculas/minÃºsculas
// - acentos
// - espacios mÃºltiples
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

// Divide novedades compuestas solo cuando la barra estÃ¡ usada como separador con espacios.
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
  const root = path.resolve(dir);
  const out: { name: string, fullPath: string }[] = [];

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('~$') || entry.name.startsWith('.')) continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'intranet_chrome_profile') continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const lf = entry.name.toLowerCase();
      if (!lf.endsWith('.xlsx') && !lf.endsWith('.xltx') && !lf.endsWith('.xls')) continue;

      const name = path.relative(root, fullPath);
      if (name.startsWith('..') || path.isAbsolute(name)) continue;
      out.push({ name, fullPath });
    }
  };

  walk(root);
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

function fileParts(name: string): string[] {
  return name.split(/[\\/]+/).filter(Boolean);
}

function pickAutoFile(
  files: { name: string, fullPath: string }[],
  scorer: (file: { name: string, fullPath: string }) => number,
) {
  return files
    .map(file => ({ file, score: scorer(file) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name, 'es', { sensitivity: 'base' }))[0]?.file;
}

function findAutoFiles(files: { name: string, fullPath: string }[]) {
  const horarios = pickAutoFile(files, f => {
    const parts = fileParts(f.name).map(p => p.toLowerCase());
    const base = parts[parts.length - 1] ?? '';
    let score = 0;
    if (base.includes('horario')) score += 100;
    if (base === 'horarios.xlsx' || base === 'horarios.xls') score += 100;
    if (parts.length === 1) score += 10;
    return score;
  });

  const ministerio = pickAutoFile(files, f => {
    const parts = fileParts(f.name).map(p => p.toLowerCase());
    const base = parts[parts.length - 1] ?? '';
    let score = 0;
    if (base.includes('ministerio')) score += 100;
    if (parts.slice(0, -1).some(p => p.includes('ministerio'))) score += 80;
    if (base === 'ministerio.xlsx' || base === 'ministerio.xls') score += 100;
    return score;
  });

  const siap = pickAutoFile(files, f => {
    const parts = fileParts(f.name).map(p => p.toLowerCase());
    const base = parts[parts.length - 1] ?? '';
    let score = 0;
    if (base.includes('siap') || base.includes('siae')) score += 60;
    if (parts.slice(0, -1).some(p => p.includes('siap') || p.includes('siae'))) score += 120;
    if (base === 'siape.xlsx' || base === 'siape.xls' || base === 'siap.xlsx' || base === 'siap.xls') score += 100;
    if (base.includes('error')) score -= 80;
    return score;
  });

  return {
    horarios: horarios?.fullPath,
    horariosName: horarios?.name,
    ministerio: ministerio?.fullPath,
    ministerioName: ministerio?.name,
    siap: siap?.fullPath,
    siapName: siap?.name,
  };
}

function resolveExcelPath(dir: string, fileName: string): string {
  const root = path.resolve(dir);
  const fullPath = path.resolve(root, fileName);
  const rel = path.relative(root, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Archivo fuera del directorio de asistencia');
  }
  return fullPath;
}

function getComparacionDir(): string | null {
  const dir = (env as any).LICENCIAS_PDF_DIR || process.env.LICENCIAS_PDF_DIR || null;
  return dir ? String(dir) : null;
}

function listResultadoCargaFiles(): string[] {
  const dir = getComparacionDir();
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('~$') && /^resultado_carga.*\.xlsx$/i.test(f))
    .map(f => path.join(dir, f));
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

  // Una licencia "pendiente de justificaciÃ³n" todavÃ­a no tiene tipo definido:
  // al justificarse puede resolverse como enfermedad propia, de familiar/niÃ±o, etc.
  // Por eso engancha con cualquier novedad de enfermedad del SIAP.
  'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÃ“N)': [
    'ENFERMEDAD',
    'ENFERMEDAD DE FAMILIAR O NIÃ‘O/A O ADOLESCENTE',
    'ATENCION FAMILIAR ENFERMO',
    'E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÃ“N)',
  ],

  '05-POR ATENCION DE FAMILIAR ENFERMO': [
    'ENFERMEDAD DE FAMILIAR O NIÃ‘O/A O ADOLESCENTE',
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
      // Las claves "__*" son configuraciÃ³n (p.ej. __aprueba_jefe), no equivalencias.
      const soloMapeo = Object.fromEntries(
        Object.entries(json).filter(([k]) => !k.startsWith('__')),
      ) as Record<string, string[]>;
      // El JSON del editor NO debe pisar el mapeo base: se fusiona.
      // AsÃ­ no se pierden equivalencias crÃ­ticas para detectar RANGO_DISTINTO.
      return mergeMapeo(DEFAULT_MAPEO, soloMapeo);
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
    const ar = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (ar) {
      const y = parseInt(ar[3], 10) + (ar[3].length === 2 ? 2000 : 0);
      return new Date(Date.UTC(y, parseInt(ar[2], 10) - 1, parseInt(ar[1], 10)));
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Usar UTC para evitar que fechas midnight se desplacen un dÃ­a en zonas UTC-X
const dateToStr = (d: Date | null): string => d ? d.toISOString().slice(0, 10) : '';
// Normalizar a UTC midnight antes de comparar
const toUTCMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const overlap = (s1: Date, e1: Date, s2: Date, e2: Date) =>
  toUTCMidnight(s1) <= toUTCMidnight(e2) && toUTCMidnight(s2) <= toUTCMidnight(e1);



// â”€â”€ Periodo (mes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parsePeriodoMes(val: any): { start: Date; end: Date } | null {
  const s = String(val ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 0 || mo > 11) return null;
  const start = new Date(Date.UTC(y, mo, 1));
  // Ãºltimo dÃ­a del mes
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

function sameDateRange(aDesde: Date | null, aHasta: Date | null, bDesde: Date | null, bHasta: Date | null): boolean {
  if (!aDesde || !aHasta || !bDesde || !bHasta) return false;
  return (
    toUTCMidnight(aDesde).getTime() === toUTCMidnight(bDesde).getTime() &&
    toUTCMidnight(aHasta).getTime() === toUTCMidnight(bHasta).getTime()
  );
}

function novedadesMinisterioSiapConectan(
  mapeoN: Record<string, string[]>,
  novMinisterio: string,
  novSiap: any,
  justificadoSiap: any = '',
): boolean {
  const novMN = normNovedad(novMinisterio);
  const novSN = normNovedad(novSiap);
  const justS = String(justificadoSiap || '').trim().toUpperCase();
  const equivs = equivsMinisterio(mapeoN, novMN);

  const siapEsEnfermedad =
    novSN === 'ENFERMEDAD' ||
    novSN.includes('ENFERMEDAD DE FAMILIAR') ||
    novSN.includes('ATENCION FAMILIAR ENFERMO');
  if (siapEsEnfermedad && justS === 'NO') {
    const minEsInasistencia = novMN.includes('28') && novMN.includes('INASISTENCIA');
    const minEsPendienteJustificacion =
      novMN.includes('LICENCIA POR ENFERMEDAD') && novMN.includes('PENDIENTE JUSTIFIC');
    return minEsInasistencia || minEsPendienteJustificacion;
  }

  if (!novedadesConectan(equivs, novSN)) return false;

  if (novSN.includes('ANUAL COMPLEMENTARIA')) {
    const minEsDenegada = novMN.includes('DENEGADA');
    if (justS === 'NO' && !minEsDenegada) return false;
    if (justS === 'SI' && minEsDenegada) return false;
  }

  return true;
}
async function parseMinisterio(fp: string): Promise<any[]> {
  const wb = await loadWorkbook(fp);
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
  const wb = await loadWorkbook(fp);
  const rows: any[] = [];

  const ws = wb.worksheets[0];
  if (!ws) return rows;

  const headerRow = ws.getRow(1);
  const headers: Record<string, number> = {};
  headerRow.eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) headers[v] = col;
  });

  // Columnas reales del SIAP segÃºn estructura del Excel
  const colDni      = headers['nro_documento'] ?? headers['nro documento'] ?? headers['dni'] ?? headers['documento'] ?? 5;
  const colApellido = headers['apellido'] ?? 2;
  const colNombreFirst = headers['nombre'] ?? 3;
  const colNombreFull  = headers['apellido y nombres'] ?? headers['apellido y nombre'] ?? 0;
  const colNovedad  = headers['novedad'] ?? headers['novedad siap'] ?? 12;
  const colDesde    = headers['fecha_desde'] ?? headers['fecha desde'] ?? headers['desde'] ?? 13;
  const colHasta    = headers['fecha_hasta'] ?? headers['fecha hasta'] ?? headers['hasta'] ?? 14;
  const colJustificado = headers['justificado'] ?? 15;
  const colAgrup    = headers['agrupamiento'] ?? 10;
  // E5 = col 21, E6 = col 22 â€” juntos determinan la dependencia
  const colE5 = headers['e5'] ?? 21;
  const colE6 = headers['e6'] ?? 22;

  /** Resuelve la dependencia a partir de E5 y E6:
   *  - E6 contiene "UPA 18" o "UNIDAD PRONTA ATENCIÃ“N 18"  â†’ "UPA 18"
   *  - E6 contiene "UPA 4"  o "UNIDAD PRONTA ATENCIÃ“N 4"   â†’ "UPA 4"
   *  - E5 contiene "UPA 18" o "UNIDAD PRONTA ATENCIÃ“N 18"  â†’ "UPA 18"  (fallback cuando E6 es "-")
   *  - E5 contiene "UPA 4"  o "UNIDAD PRONTA ATENCIÃ“N 4"   â†’ "UPA 4"   (fallback cuando E6 es "-")
   *  - todo lo demÃ¡s                                         â†’ "HOSPITAL"
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
  // Acepta tanto "UPA 4" como "UNIDAD PRONTA ATENCIÃ“N 4" / "UNIDAD PRONTA ATENCION 4"
  const upaInE6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (upaInE6) return `UPA ${upaInE6[1]}`;

  // fallback: E5 â€” Ã­dem
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
      justificado, // leÃ­do directo del SIAP, no calculado
      upa: dependencia, // clave para elegir el archivo ministerio correcto
      agrupamiento: cellToText(r.getCell(colAgrup)?.value),
    });
  });

  return rows;
}

type ResultadoCargaRow = {
  dni: string;
  novedad: string;
  novedadN: string;
  desde: string;
  hasta: string;
  estado: string;
  detalle: string;
  archivo: string;
};

function cargaKey(dni: any, novedadNorm: string, desde: string, hasta: string): string {
  return [normDni(dni), novedadNorm, desde || '', hasta || desde || ''].join('|');
}

function cargaFechaKey(dni: any, desde: string, hasta: string): string {
  return [normDni(dni), desde || '', hasta || desde || ''].join('|');
}

async function loadResultadosCargaIndex(): Promise<{
  byExact: Map<string, ResultadoCargaRow>;
  byDate: Map<string, ResultadoCargaRow[]>;
  files: string[];
}> {
  const byExact = new Map<string, ResultadoCargaRow>();
  const byDate = new Map<string, ResultadoCargaRow[]>();
  const files = listResultadoCargaFiles();

  for (const fp of files) {
    const wb = await loadWorkbook(fp);
    const ws = wb.worksheets[0];
    if (!ws) continue;

    const headers: Record<string, number> = {};
    ws.getRow(1).eachCell((c: any, col: number) => {
      const h = normHeader(c?.value ?? '');
      if (h) headers[h] = col;
    });

    const colDni = headers['dni'] ?? 2;
    const colNovedad = headers['novedad'] ?? 3;
    const colDesde = headers['desde'] ?? 4;
    const colHasta = headers['hasta'] ?? 5;
    const colEstado = headers['estado'] ?? 6;
    const colDetalle = headers['detalle'] ?? 7;

    ws.eachRow((r: any, rowNumber: number) => {
      if (rowNumber === 1) return;
      const dni = normDni(r.getCell(colDni)?.value);
      if (!dni) return;

      const novedad = cellToText(r.getCell(colNovedad)?.value);
      const desde = dateToStr(parseDate(r.getCell(colDesde)?.value));
      const hasta = dateToStr(parseDate(r.getCell(colHasta)?.value)) || desde;
      const row: ResultadoCargaRow = {
        dni,
        novedad,
        novedadN: normNovedad(novedad),
        desde,
        hasta,
        estado: cellToText(r.getCell(colEstado)?.value),
        detalle: cellToText(r.getCell(colDetalle)?.value),
        archivo: path.basename(fp),
      };
      if (!desde) return;

      byExact.set(cargaKey(dni, row.novedadN, desde, hasta), row);
      const fk = cargaFechaKey(dni, desde, hasta);
      const bucket = byDate.get(fk) || [];
      bucket.push(row);
      byDate.set(fk, bucket);
    });
  }

  return { byExact, byDate, files: files.map(f => path.basename(f)) };
}

function labelsCargaParaFila(row: any, mapeo: Record<string, string[]>): string[] {
  const labels = new Set<string>();
  const add = (v: any) => {
    const n = normNovedad(v);
    if (n && n !== 'â€”' && n !== '(SIN MAPEO)' && !n.includes('SIN NOVEDAD MINISTERIO')) labels.add(n);
  };

  add(row?.novedad_ministerio);

  const novSN = normNovedad(row?.novedad_siap);
  const justS = String(row?.justificado || '').trim().toUpperCase();
  const siapEsMedica =
    novSN === 'ENFERMEDAD' ||
    novSN.includes('ENFERMEDAD DE FAMILIAR') ||
    novSN.includes('ATENCION FAMILIAR ENFERMO');
  if (siapEsMedica && justS === 'NO') {
    add('E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÃ“N)');
    add('E - LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÃ“N)');
  }

  const mapeoN = normMapeo(mapeo);
  for (const [minNov, siapVals] of Object.entries(mapeoN)) {
    if (siapVals.includes(novSN) || minNov === novSN) add(minNov);
  }

  return Array.from(labels);
}

function enriquecerConResultadoCarga(rows: any[], mapeo: Record<string, string[]>, idx: {
  byExact: Map<string, ResultadoCargaRow>;
  byDate: Map<string, ResultadoCargaRow[]>;
}): any[] {
  return rows.map((r: any) => {
    const dni = normDni(r?.dni);
    const desde = dateToStr(parseDate(r?.fecha_desde_siap || r?.fecha_desde_ministerio));
    const hasta = dateToStr(parseDate(r?.fecha_hasta_siap || r?.fecha_hasta_ministerio)) || desde;
    if (!dni || !desde) return r;

    let hit: ResultadoCargaRow | undefined;
    for (const label of labelsCargaParaFila(r, mapeo)) {
      hit = idx.byExact.get(cargaKey(dni, label, desde, hasta));
      if (hit) break;
    }

    if (!hit) {
      const byDate = idx.byDate.get(cargaFechaKey(dni, desde, hasta)) || [];
      if (byDate.length === 1) hit = byDate[0];
    }

    if (!hit) return r;
    return {
      ...r,
      estado_carga: hit.estado,
      detalle_carga: hit.detalle,
      novedad_carga: hit.novedad,
      archivo_carga: hit.archivo,
    };
  });
}

function compareRows(
  ministerio: any[],
  siap: any[],
  mapeo: Record<string, string[]>,
  skipNovedades: string[],
): any[] {
  const siapByDni: Record<string, any[]> = {};
  for (const s of siap) {
    const dni = normDni((s as any).dni);
    (siapByDni[dni] = siapByDni[dni] || []).push(s);
  }

  const mapeoN = normMapeo(mapeo);
  const usedSiap = new Set<any>();
  const out: any[] = new Array(ministerio.length);
  const pendientes: Array<{
    idx: number;
    min: any;
    dniMin: string;
    upa: string;
    nov: string;
    minDesde: Date | null;
    minHasta: Date | null;
  }> = [];

  const candidatosSiap = (dni: string, upa: string) => (siapByDni[dni] || []).filter((s: any) => {
    if (usedSiap.has(s)) return false;
    const siapUpa = String((s as any).upa || '').trim();
    return !upa || !siapUpa || siapUpa === upa;
  });

  ministerio.forEach((min, idx) => {
    const dniMin = normDni((min as any).dni);
    const upa = String((min as any).upa || '').trim();
    const nov = String((min as any).novedad || '').trim();
    const novN = normNovedad(nov);

    if (skipNovedades.some(sk => novN.includes(normNovedad(sk)))) {
      out[idx] = {
        dni: (min as any).dni, nombre: (min as any).nombre,
        novedad_ministerio: nov,
        fecha_desde_ministerio: dateToStr(parseDate((min as any).desde)),
        fecha_hasta_ministerio: dateToStr(parseDate((min as any).hasta)),
        novedad_siap: 'â€”', fecha_desde_siap: 'â€”', fecha_hasta_siap: 'â€”',
        estado: 'OMITIDO', upa,
      };
      return;
    }

    const minDesde = getCmpDesde(min);
    const minHasta = getCmpHasta(min);
    const match = candidatosSiap(dniMin, upa).find((s: any) =>
      novedadesMinisterioSiapConectan(mapeoN, nov, s.novedad, s.justificado) &&
      sameDateRange(minDesde, minHasta, getCmpDesde(s), getCmpHasta(s))
    );

    if (match) {
      usedSiap.add(match);
      out[idx] = {
        dni: (min as any).dni, nombre: (min as any).nombre,
        novedad_ministerio: nov,
        fecha_desde_ministerio: dateToStr(getOriginalDesde(min)),
        fecha_hasta_ministerio: dateToStr(getOriginalHasta(min)),
        novedad_siap: match.novedad,
        fecha_desde_siap: dateToStr(getOriginalDesde(match)),
        fecha_hasta_siap: dateToStr(getOriginalHasta(match)),
        estado: 'COINCIDENTE', upa,
        motivo: '',
      };
      return;
    }

    pendientes.push({ idx, min, dniMin, upa, nov, minDesde, minHasta });
  });

  for (const p of pendientes) {
    const todos = (siapByDni[p.dniMin] || []).filter((s: any) => {
      const siapUpa = String((s as any).upa || '').trim();
      return !p.upa || !siapUpa || siapUpa === p.upa;
    });
    const disponibles = todos.filter((s: any) => !usedSiap.has(s));
    let vioSiapConNovedadMapeada = false;
    let vioRangoDistinto = false;
    let vioSolape = false;
    let bestCandidate: any = null;
    let motivo = 'SIAP_SIN_NOVEDAD_EQUIVALENTE';

    bestCandidate = disponibles.find((s: any) =>
      !novedadesMinisterioSiapConectan(mapeoN, p.nov, s.novedad, s.justificado) &&
      sameDateRange(p.minDesde, p.minHasta, getCmpDesde(s), getCmpHasta(s))
    );
    if (bestCandidate) {
      motivo = 'NOVEDAD_DISTINTA';
    } else {
      for (const s of disponibles) {
        if (!novedadesMinisterioSiapConectan(mapeoN, p.nov, s.novedad, s.justificado)) continue;
        vioSiapConNovedadMapeada = true;

        const sDesde = getCmpDesde(s);
        const sHasta = getCmpHasta(s);
        if (!p.minDesde || !p.minHasta || !sDesde || !sHasta) continue;

        if (!bestCandidate) bestCandidate = s;
        if (overlap(p.minDesde, p.minHasta, sDesde, sHasta)) vioSolape = true;
        else vioRangoDistinto = true;
      }

      motivo =
        vioSolape ? 'SOLAPA_PERO_NO_IGUAL' :
        vioRangoDistinto ? 'RANGO_DISTINTO' :
        disponibles.length === 0 && todos.length > 0 ? 'SIAP_YA_MATCHADO_EN_OTRA_FILA' :
        vioSiapConNovedadMapeada ? 'MAPEO_OK_PERO_SIN_MATCH' :
        'SIAP_SIN_NOVEDAD_EQUIVALENTE';
    }

    if (bestCandidate) usedSiap.add(bestCandidate);

    out[p.idx] = {
      dni: (p.min as any).dni, nombre: (p.min as any).nombre,
      novedad_ministerio: p.nov,
      fecha_desde_ministerio: dateToStr(getOriginalDesde(p.min)),
      fecha_hasta_ministerio: dateToStr(getOriginalHasta(p.min)),
      novedad_siap: bestCandidate ? bestCandidate.novedad : 'â€”',
      fecha_desde_siap: bestCandidate ? dateToStr(getOriginalDesde(bestCandidate)) : 'â€”',
      fecha_hasta_siap: bestCandidate ? dateToStr(getOriginalHasta(bestCandidate)) : 'â€”',
      estado: bestCandidate && motivo !== 'RANGO_DISTINTO' && motivo !== 'SOLAPA_PERO_NO_IGUAL' ? 'NO COINCIDENTE' : (bestCandidate ? 'RANGO_DISTINTO' : 'NO COINCIDENTE'),
      motivo,
      upa: p.upa,
    };
  }

  return out;
}
function compareRowsSiapVsMinisterio(
  siap: any[],
  ministerioMap: Record<string, any[]>,
  mapeo: Record<string, string[]>,
  skipNovedades: string[],
): any[] {
  const minByUpaAndDni: Record<string, Record<string, any[]>> = {};
  for (const [upa, rows] of Object.entries(ministerioMap)) {
    minByUpaAndDni[upa] = {};
    for (const m of rows) {
      const dni = normDni((m as any).dni);
      (minByUpaAndDni[upa][dni] = minByUpaAndDni[upa][dni] || []).push(m);
    }
  }

  const mapeoN = normMapeo(mapeo);
  const usedMinisterio = new Set<any>();
  const out: any[] = new Array(siap.length);
  const pendientes: Array<{
    idx: number;
    baseRow: any;
    mins: any[];
    novSN: string;
    sDesde: Date | null;
    sHasta: Date | null;
  }> = [];

  siap.forEach((s: any, idx) => {
    const dniS  = normDni((s as any).dni);
    const upa   = String((s as any).upa || '').trim();
    const novS  = String((s as any).novedad || '').trim();
    const novSN = normNovedad(novS);
    const justS = String((s as any).justificado || '').trim().toUpperCase();
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
      out[idx] = { ...baseRow, novedad_ministerio: 'â€”', fecha_desde_ministerio: 'â€”', fecha_hasta_ministerio: 'â€”', estado: 'OMITIDO' };
      return;
    }

    if (!upa || !minByUpaAndDni[upa]) {
      out[idx] = { ...baseRow, novedad_ministerio: 'â€”', fecha_desde_ministerio: 'â€”', fecha_hasta_ministerio: 'â€”',
        estado: 'NO COINCIDENTE', motivo: upa ? `Sin archivo ministerio para ${upa}` : 'Sin UPA en SIAP' };
      return;
    }

    const mins = minByUpaAndDni[upa][dniS] || [];
    const disponibles = () => mins.filter((m: any) => !usedMinisterio.has(m));
    const match = disponibles().find((m: any) =>
      novedadesMinisterioSiapConectan(mapeoN, m.novedad, novS, justS) &&
      sameDateRange(getCmpDesde(m), getCmpHasta(m), sDesde, sHasta)
    );

    if (match) {
      usedMinisterio.add(match);
      out[idx] = {
        ...baseRow,
        novedad_ministerio:     String(match.novedad || '').trim(),
        fecha_desde_ministerio: dateToStr(getOriginalDesde(match)),
        fecha_hasta_ministerio: dateToStr(getOriginalHasta(match)),
        estado: 'COINCIDENTE',
        motivo: '',
      };
      return;
    }

    pendientes.push({ idx, baseRow, mins, novSN, sDesde, sHasta });
  });

  for (const p of pendientes) {
    const disponibles = p.mins.filter((m: any) => !usedMinisterio.has(m));
    let vioMismoMapeo = false;
    let vioRangoDistinto = false;
    let vioSolape = false;
    let bestCandidate: any = null;
    let motivo = 'MAPEO_NO_ENCUENTRA_EQUIVALENTE';

    bestCandidate = disponibles.find((m: any) =>
      !novedadesMinisterioSiapConectan(mapeoN, m.novedad, p.baseRow.novedad_siap, p.baseRow.justificado) &&
      sameDateRange(getCmpDesde(m), getCmpHasta(m), p.sDesde, p.sHasta)
    );
    if (bestCandidate) {
      motivo = 'NOVEDAD_DISTINTA';
    } else {
      for (const m of disponibles) {
        if (!novedadesMinisterioSiapConectan(mapeoN, m.novedad, p.baseRow.novedad_siap, p.baseRow.justificado)) continue;
        vioMismoMapeo = true;

        const mDesde = getCmpDesde(m);
        const mHasta = getCmpHasta(m);
        if (!mDesde || !mHasta || !p.sDesde || !p.sHasta) continue;

        if (!bestCandidate) bestCandidate = m;
        if (overlap(mDesde, mHasta, p.sDesde, p.sHasta)) vioSolape = true;
        else vioRangoDistinto = true;
      }

      motivo =
        p.mins.length === 0  ? `DNI_NO_EXISTE_EN_MINISTERIO_PARA_${p.baseRow.upa}` :
        vioSolape           ? 'SOLAPA_PERO_NO_IGUAL' :
        vioRangoDistinto    ? 'RANGO_DISTINTO' :
        disponibles.length === 0 && p.mins.length > 0 ? 'MINISTERIO_YA_MATCHADO_EN_OTRA_FILA' :
        vioMismoMapeo       ? 'MAPEO_OK_PERO_SIN_MATCH' :
                               'MAPEO_NO_ENCUENTRA_EQUIVALENTE';
    }

    if (bestCandidate) usedMinisterio.add(bestCandidate);

    const novedadesMinTexto = bestCandidate
      ? String(bestCandidate.novedad || '').trim()
      : disponibles.length > 0
        ? 'SIN NOVEDAD MINISTERIO EQUIVALENTE'
        : 'â€”';

    out[p.idx] = {
      ...p.baseRow,
      novedad_ministerio:     novedadesMinTexto,
      fecha_desde_ministerio: bestCandidate ? dateToStr(getOriginalDesde(bestCandidate)) : 'â€”',
      fecha_hasta_ministerio: bestCandidate ? dateToStr(getOriginalHasta(bestCandidate)) : 'â€”',
      estado: bestCandidate && motivo !== 'RANGO_DISTINTO' && motivo !== 'SOLAPA_PERO_NO_IGUAL' ? 'NO COINCIDENTE' : (bestCandidate ? 'RANGO_DISTINTO' : 'NO COINCIDENTE'),
      motivo,
    };
  }

  return out;
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
        return res.status(400).json({ ok: false, error: 'Body invÃ¡lido: { mapeo: {...} }' });
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

      const ministerioFile = req.query?.ministerioFile ? resolveExcelPath(dir, String(req.query.ministerioFile)) : auto.ministerio;
      const siapFile       = req.query?.siapFile       ? resolveExcelPath(dir, String(req.query.siapFile))       : auto.siap;

      if (!ministerioFile || !fs.existsSync(ministerioFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ archivo MINISTERIO (auto o provisto)' });
      }
      if (!siapFile || !fs.existsSync(siapFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ archivo SIAP (auto o provisto)' });
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

      // â”€â”€ Archivo SIAP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const siapFile = req.body?.siapFile ? resolveExcelPath(dir, req.body.siapFile) : auto.siap;
      if (!siapFile || !fs.existsSync(siapFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ archivo SIAP' });
      }

      // â”€â”€ Archivos Ministerio: array [{ file, upa }] â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // ministerioFiles: [{ file: "nombre.xlsx", upa: "UPA 18" }, { file: "otro.xlsx", upa: "UPA 4" }]
      // Si no viene ministerioFiles, retrocompatibilidad con ministerioFile Ãºnico
      type MinFile = { file: string; upa: string };
      let ministerioFiles: MinFile[] = [];

      if (Array.isArray(req.body?.ministerioFiles) && req.body.ministerioFiles.length > 0) {
        ministerioFiles = req.body.ministerioFiles;
      } else if (req.body?.ministerioFile) {
        // compatibilidad: un solo archivo sin UPA asignada â†’ se llama "GENERAL"
        ministerioFiles = [{ file: req.body.ministerioFile, upa: 'GENERAL' }];
      } else if (auto.ministerio) {
        const autoMinisterioName = files.find(f => f.fullPath === auto.ministerio)?.name ?? path.basename(auto.ministerio);
        ministerioFiles = [{ file: autoMinisterioName, upa: 'GENERAL' }];
      }

      if (ministerioFiles.length === 0) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ ningÃºn archivo MINISTERIO' });
      }

      // â”€â”€ Parsear todos los ministerios en paralelo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const ministerioMap: Record<string, any[]> = {};
      let totalMinisterioRows = 0;
      await Promise.all(
        ministerioFiles.map(async ({ file, upa }) => {
          const fp = resolveExcelPath(dir, file);
          if (!fs.existsSync(fp)) return; // si no existe, esa UPA quedarÃ¡ sin rows
          const rows = await parseMinisterio(fp);
          ministerioMap[upa] = rows;
          totalMinisterioRows += rows.length;
        })
      );

      // â”€â”€ Parsear SIAP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let siapRows = await parseSiap(siapFile);

      // â”€â”€ Deduplicar filas idÃ©nticas del SIAP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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


      // â”€â”€ Deduplicar filas idÃ©nticas del Ministerio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ Comparar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const direccion = req.body?.direccion ?? 'SIAP_VS_MIN';
      let comparado: any[];
      if (direccion === 'MIN_VS_SIAP') {
        // Itera el Ministerio â€” quÃ© tiene el Ministerio y si coincide en SIAP
        const allMinRows = Object.entries(ministerioMap)
          .flatMap(([upa, rows]) => rows.map((r: any) => ({ ...r, upa })));
        comparado = compareRows(allMinRows, siapRows, mapeo, skipFinal);
      } else {
        // Itera el SIAP â€” quÃ© tiene el SIAP y si coincide en Ministerio
        comparado = compareRowsSiapVsMinisterio(siapRows, ministerioMap, mapeo, skipFinal);
      }

      const resultadoCarga = await loadResultadosCargaIndex();
      comparado = enriquecerConResultadoCarga(comparado, mapeo, resultadoCarga);

      const comparadoCompleto = comparado;
      // Por defecto esta pantalla devuelve solo errores/inconsistencias.
      // Si alguna vez necesitÃ¡s ver todo, mandÃ¡ { soloErrores: false } desde el front.
      const soloErrores = req.body?.soloErrores !== false;
      if (soloErrores) {
        comparado = comparado.filter((r: any) => r.estado !== 'COINCIDENTE' && r.estado !== 'OMITIDO');
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
            rango_distinto: comparadoCompleto.filter(r => r.estado === 'RANGO_DISTINTO').length,
            omitidos:      comparadoCompleto.filter(r => r.estado === 'OMITIDO').length,
          },
          files: {
            ministerioFiles: ministerioFiles.map(m => m.file),
            siapFile: siapF.name,
            resultadoCargaFiles: resultadoCarga.files,
          },
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  // â”€â”€ GET /ausentes28 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Devuelve cada dÃ­a con cÃ³digo 28-INASISTENCIA cruzado con:
  //   - Â¿Le correspondÃ­a venir? (desde horarios.xlsx, columna XDIA_CONTROLABLE)
  //   - Â¿FichÃ³ ese dÃ­a? (desde DB biomÃ©trica usando la config de fichero_config.json)
  //
  // Query params (todos opcionales):
  //   periodo        YYYY-MM   â†’ filtra por mes
  //   ministerioFile nombre.xlsx
  //   horariosFile   nombre.xlsx
  router.get('/ausentes28', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend' });
    }
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);

      // â”€â”€ Archivos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const auto = findAutoFiles(files);
      const ministerioFile = req.query.ministerioFile
        ? path.join(dir, String(req.query.ministerioFile))
        : auto.ministerio;
      if (!ministerioFile || !fs.existsSync(ministerioFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ archivo MINISTERIO' });
      }

      const autoHorarios = files.find(f => f.name.toLowerCase().includes('horario'));
      const horariosFile = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : autoHorarios?.fullPath ?? null;

      // â”€â”€ Periodo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const period = req.query.periodo ? parsePeriodoMes(String(req.query.periodo)) : null;

      // â”€â”€ 1. Leer MINISTERIO â†’ solo novedad 28 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ 2. Leer horarios â†’ mapa DNI â†’ dÃ­as controlables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      type HorarioDia = { lunes: boolean; martes: boolean; miercoles: boolean; jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean };
      const horariosMap: Record<string, HorarioDia> = {};
      if (horariosFile && fs.existsSync(horariosFile)) {
        const wb = await loadWorkbook(horariosFile);
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

      // â”€â”€ 3. Expandir rangos a dÃ­as individuales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // DOW (getUTCDay): 0=dom, 1=lun, 2=mar, 3=mie, 4=jue, 5=vie, 6=sab
      const DOW_KEYS: (keyof HorarioDia)[] = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
      const DOW_LABELS = ['Dom','Lun','Mar','MiÃ©','Jue','Vie','SÃ¡b'];

      // â”€â”€ 3b. Leer SIAP (opcional) â†’ mapa DNI â†’ rangos con novedad â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const autoSiap = files.find(f => f.name.toLowerCase().includes('siap'));
      const siapFile = req.query.siapFile
        ? path.join(dir, String(req.query.siapFile))
        : autoSiap?.fullPath ?? null;

      // siapByDni: dni â†’ [{ novedad, desde, hasta, justificado }]
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

      // null = sin novedad SIAP, true = justificada (SI), false = no justificada (NO/vacÃ­o)
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

      // â”€â”€ 4. Consultar DB biomÃ©trica â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          dbError = e?.message ?? 'Error al consultar DB biomÃ©trica';
          logger.warn({ msg: 'ausentes28: error DB biomÃ©trica', error: dbError });
        }
      } else {
        dbError = 'fichero_config.json no encontrado â€” configura la conexiÃ³n en el mÃ³dulo Fichero';
      }

      // â”€â”€ 5. Consultar reconocimientos_medicos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // recMedicoMap: "dni|YYYY-MM-DD" â†’ tipo (o "" si no tiene tipo)
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

      // â”€â”€ 6. Construir resultado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          recMedico:         recMedicoMap.has(recKey) ? (recMedicoMap.get(recKey) || 'SÃ­') : null,
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

  // â”€â”€ GET /siap-fichajes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Query params: periodo, siapFile, ministerioFile (opcional), horariosFile (opcional)
  router.get('/siap-fichajes', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend' });
    }
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);
      const auto  = findAutoFiles(files);

      // â”€â”€ Archivos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const siapFilePath = req.query.siapFile
        ? path.join(dir, String(req.query.siapFile))
        : auto.siap ?? null;
      if (!siapFilePath || !fs.existsSync(siapFilePath)) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ archivo SIAP' });
      }

      const ministerioFilePath = req.query.ministerioFile
        ? path.join(dir, String(req.query.ministerioFile))
        : auto.ministerio ?? null;

      const autoHorarios2 = files.find(f => f.name.toLowerCase().includes('horario'));
      const horariosFilePath = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : autoHorarios2?.fullPath ?? null;

      const period = req.query.periodo ? parsePeriodoMes(String(req.query.periodo)) : null;

      // â”€â”€ 1. Leer SIAP â†’ expandir a dÃ­as individuales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const DOW_KEYS2 = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'] as const;
      const DOW_LABELS2 = ['Dom','Lun','Mar','MiÃ©','Jue','Vie','SÃ¡b'];

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

      // â”€â”€ 1b. Leer horarios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Para cada DNI: guarda la entrada por dÃ­a y si es guardia rotativa 18-06
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
          const wb2 = await loadWorkbook(horariosFilePath);
          const ws2 = wb2.worksheets[0];
          if (ws2) {
            const hdr2: Record<string, number> = {};
            ws2.getRow(1).eachCell((c: any, col: number) => {
              const v = normHeader(c?.value ?? '');
              if (v) hdr2[v] = col;
            });
            const colDni2 = hdr2['nro_documento'] ?? hdr2['nro documento'] ?? hdr2['documento'] ?? 4;
            // columnas de entrada por dÃ­a (formato: LUNES_ENTRADA = col 5, etc.)
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
              // Guardia rotativa: los 5 dÃ­as de semana tienen 18:00 como entrada
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

      // debiaVenir se calcula despuÃ©s de tener fichajesMap (ver paso 5)

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
            debiaVenir:      null, // se rellena en paso 5, despuÃ©s de tener fichajes
          });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      if (expanded2.length === 0) {
        return res.json({ ok: true, data: [], meta: { total: 0, conFichaje: 0, sinFichaje: 0, enMinisterio: 0, sinMinisterio: 0, sinBiometrico: false, dbError: null } });
      }

      // â”€â”€ 2. Indexar Ministerio por DNI â†’ rangos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // minByDni: dni â†’ [{ novedad, desde, hasta }]
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

      // â”€â”€ 3. Consultar DB biomÃ©trica â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          dbError2 = e?.message ?? 'Error al consultar DB biomÃ©trica';
          logger.warn({ msg: 'siap-fichajes: error DB biomÃ©trica', error: dbError2 });
        }
      } else {
        dbError2 = 'fichero_config.json no encontrado';
      }

      // â”€â”€ 4. Construir resultado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      // Helper: dado un DNI y una fecha, devuelve las fechas Lunâ†’Vie de esa semana ISO
      const semanaISO = (fecha: string): string[] => {
        const d = parseDate(fecha);
        if (!d) return [];
        const dow = d.getUTCDay() || 7; // 1=lun â€¦ 7=dom
        const lunes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow - 1)));
        return [0,1,2,3,4].map(i => {
          const x = new Date(lunes);
          x.setUTCDate(x.getUTCDate() + i);
          return dateToStr(x);
        }); // [lun, mar, mie, jue, vie]
      };

      // Para guardia rotativa: mira fichajes de la semana para saber si es LMV o MJ
      // Busca en la semana actual, luego en Â±1 semana con ciclo invertido
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

  // â”€â”€ GET /agente-mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Devuelve todos los dÃ­as del mes para un DNI: fichaje + novedades SIAP y Ministerio
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

      const DOW_LABELS3 = ['Dom','Lun','Mar','MiÃ©','Jue','Vie','SÃ¡b'];

      // â”€â”€ Todos los dÃ­as del mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const dias: { fecha: string; diaSemana: string }[] = [];
      const cur = new Date(period.start);
      while (cur <= period.end) {
        dias.push({ fecha: dateToStr(cur), diaSemana: DOW_LABELS3[cur.getUTCDay()] });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      // â”€â”€ SIAP: novedades del agente en el mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ Ministerio: novedades del agente en el mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ Fichajes del agente en el mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        dbErr = 'Sin conexiÃ³n biomÃ©trica';
      }

      // â”€â”€ Horarios del agente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const DOW_HOR_KEYS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
      const horarioPorDow: (string | null)[] = [null, null, null, null, null, null, null];
      const horariosFilePath2 = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : files.find(f => f.name.toLowerCase().includes('horario'))?.fullPath ?? null;
      if (horariosFilePath2 && fs.existsSync(horariosFilePath2)) {
        const wbH = await loadWorkbook(horariosFilePath2);
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
              horarioPorDow[dow] = hora ?? (ctrl ? 'SÃ­' : null);
            }
          });
        }
      }

      // â”€â”€ Armar respuesta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ GET /presentes-turno â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Para una fecha y servicio: arma esperados desde horarios, cruza fichadas
  // biomÃ©tricas y muestra justificaciÃ³n SIAP/Ministerio para quienes no ficharon.
  router.get('/presentes-turno', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs' });
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexiÃ³n a DB principal' });

    try {
      const servicioId = req.query.servicio_id ? Number(req.query.servicio_id) : null;
      if (!servicioId) return res.status(400).json({ ok: false, error: 'Falta servicio_id' });

      const fecha = String(req.query.fecha ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ ok: false, error: 'Falta fecha vÃ¡lida (YYYY-MM-DD)' });
      }

      const dir = getDir();
      const files = listExcelFiles(dir);
      const auto = findAutoFiles(files);

      const horariosFile = req.query.horariosFile
        ? resolveExcelPath(dir, String(req.query.horariosFile))
        : auto.horarios ?? null;
      if (!horariosFile || !fs.existsSync(horariosFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ el archivo de horarios' });
      }

      const siapFile = req.query.siapFile
        ? resolveExcelPath(dir, String(req.query.siapFile))
        : auto.siap ?? null;
      const ministerioFile = req.query.ministerioFile
        ? resolveExcelPath(dir, String(req.query.ministerioFile))
        : auto.ministerio ?? null;

      const fechaDt = new Date(`${fecha}T00:00:00Z`);
      const fechaNextDt = new Date(fechaDt);
      fechaNextDt.setUTCDate(fechaNextDt.getUTCDate() + 1);
      const fechaNext = fechaNextDt.toISOString().slice(0, 10);
      const dowKeys = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const;
      const dowKey = dowKeys[fechaDt.getUTCDay()];

      const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
      const pHora = (v: any): string | null => {
        const s = String(v ?? '').trim();
        const m = s.match(/^(\d{1,2}):(\d{2})/);
        return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
      };
      const turnoDia = (ent: string, sal: string): 'manana' | 'tarde' | 'noche' | '24hs' => {
        if (ent === sal) return '24hs';
        if (toMin(sal) < toMin(ent)) return 'noche';
        const h = Number(ent.slice(0, 2));
        if (h >= 5 && h < 12) return 'manana';
        if (h >= 12 && h < 18) return 'tarde';
        return 'noche';
      };

      const { QueryTypes } = await import('sequelize');
      const [svcRow] = await sequelize.query<{ id: number; nombre: string }>(
        'SELECT id, nombre FROM servicios WHERE id = :id AND deleted_at IS NULL LIMIT 1',
        { type: QueryTypes.SELECT, replacements: { id: servicioId } }
      );
      if (!svcRow) return res.status(404).json({ ok: false, error: `Servicio ${servicioId} no encontrado` });

      const agentesDb = await sequelize.query<any>(`
        SELECT p.dni,
               TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) AS nombre_db,
               a.estado_empleo,
               srv.id AS servicio_id,
               srv.nombre AS servicio_nombre
        FROM personal p
        JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
        JOIN (
          SELECT ags1.dni, ags1.servicio_id
          FROM agentes_servicios ags1
          JOIN (
            SELECT dni, MAX(id) AS max_id
            FROM agentes_servicios
            WHERE deleted_at IS NULL
              AND fecha_desde <= :fecha
              AND (fecha_hasta IS NULL OR fecha_hasta >= :fecha)
            GROUP BY dni
          ) ult ON ult.max_id = ags1.id
        ) vig ON vig.dni = p.dni
        JOIN servicios srv ON srv.id = vig.servicio_id AND srv.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND a.estado_empleo = 'ACTIVO'
          AND vig.servicio_id = :servicioId
      `, { type: QueryTypes.SELECT, replacements: { fecha, servicioId } });

      const dbByDni: Record<string, any> = {};
      const dnisServicio = new Set<string>();
      for (const r of agentesDb) {
        const dni = normDni(r.dni);
        if (!dni) continue;
        dbByDni[dni] = r;
        dnisServicio.add(dni);
      }

      const wb = await loadWorkbook(horariosFile);
      const ws = wb.worksheets[0];
      if (!ws) return res.status(400).json({ ok: false, error: 'Archivo de horarios vacÃ­o' });

      const hdr: Record<string, number> = {};
      ws.getRow(1).eachCell((c: any, col: number) => {
        const v = normHeader(c?.value ?? '');
        if (v) hdr[v] = col;
      });
      const colDni = hdr['nro_documento'] ?? hdr['nro documento'] ?? hdr['documento'] ?? hdr['dni'] ?? 4;
      const colNom = hdr['apellido_nombre'] ?? hdr['apellido y nombres'] ?? hdr['apellido y nombre'] ?? 0;
      const hasCtrl = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
        .some(d => hdr[`${d}_controlable`] > 0);

      type Esperado = {
        dni: string;
        nombre: string;
        entrada: string;
        salida: string;
        turno: 'manana' | 'tarde' | 'noche' | '24hs';
        ficho: boolean;
        fichajes: string[];
        justificaciones: Array<{ fuente: 'SIAP' | 'Ministerio'; novedad: string; desde: string; hasta: string }>;
      };

      const esperadosBase: Esperado[] = [];
      ws.eachRow((r: any, rn: number) => {
        if (rn === 1) return;
        const dni = normDni(r.getCell(colDni)?.value);
        if (!dni || !dnisServicio.has(dni)) return;

        const ent = pHora(r.getCell(hdr[`${dowKey}_entrada`] ?? 0)?.value);
        const sal = pHora(r.getCell(hdr[`${dowKey}_salida`] ?? 0)?.value);
        const colCtl = hdr[`${dowKey}_controlable`] ?? 0;
        const controlable = hasCtrl
          ? String(r.getCell(colCtl)?.value ?? '').toUpperCase().trim() === 'SI'
          : !!ent;
        if (!ent || !sal || !controlable) return;

        esperadosBase.push({
          dni,
          nombre: (colNom ? cellToText(r.getCell(colNom)?.value) : '') || dbByDni[dni]?.nombre_db || dni,
          entrada: ent,
          salida: sal,
          turno: turnoDia(ent, sal),
          ficho: false,
          fichajes: [],
          justificaciones: [],
        });
      });

      const dnis = esperadosBase.map(a => a.dni);
      const justMap: Record<string, Esperado['justificaciones']> = {};
      const addJust = (dni: string, fuente: 'SIAP' | 'Ministerio', row: any) => {
        const desde = parseDate(row?.desde);
        const hasta = parseDate(row?.hasta) ?? desde;
        if (!desde || !hasta) return;
        const ds = dateToStr(desde);
        const hs = dateToStr(hasta);
        if (ds <= fecha && hs >= fecha) {
          (justMap[dni] = justMap[dni] || []).push({
            fuente,
            novedad: String(row?.novedad ?? '').trim(),
            desde: ds,
            hasta: hs,
          });
        }
      };

      if (siapFile && fs.existsSync(siapFile)) {
        const rows = await parseSiap(siapFile);
        for (const row of rows) {
          const dni = normDni(row?.dni);
          if (dnisServicio.has(dni)) addJust(dni, 'SIAP', row);
        }
      }
      if (ministerioFile && fs.existsSync(ministerioFile)) {
        const rows = await parseMinisterio(ministerioFile);
        for (const row of rows) {
          const dni = normDni(row?.dni);
          if (dnisServicio.has(dni)) addJust(dni, 'Ministerio', row);
        }
      }

      const fichajesMap: Record<string, string[]> = {};
      let dbError: string | null = null;
      const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
      if (dnis.length && fs.existsSync(cfgPath)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const bioConn = await mysql.createConnection({
            host: cfg.mysqlHost || '127.0.0.1',
            port: cfg.mysqlPort || 3306,
            user: cfg.mysqlUser || 'root',
            password: cfg.mysqlPass || '',
            database: cfg.mysqlDb || 'adms_db',
            connectTimeout: 10_000,
            dateStrings: true,
          });
          const placeholders = dnis.map(() => '?').join(',');
          const [ficRows] = await bioConn.query<RowDataPacket[]>(
            `SELECT ui.badgenumber AS dni, ci.checktime, ci.checktype
             FROM checkinout ci
             INNER JOIN userinfo ui ON ci.userid = ui.userid
             WHERE ui.badgenumber IN (${placeholders})
               AND ci.checktime >= ? AND ci.checktime <= ?
             ORDER BY ci.checktime ASC`,
            [...dnis, `${fecha} 00:00:00`, `${fechaNext} 23:59:59`]
          );
          await bioConn.end();
          for (const row of ficRows) {
            const dni = normDni(row.dni);
            const cts = String(row.checktime);
            const f = cts.slice(0, 10);
            const h = cts.slice(11, 16);
            if (f !== fecha && f !== fechaNext) continue;
            (fichajesMap[dni] = fichajesMap[dni] || []).push(`${f} ${h}`);
          }
        } catch (e: any) {
          dbError = e?.message || 'No se pudo leer biomÃ©trico';
        }
      } else if (!fs.existsSync(cfgPath)) {
        dbError = 'fichero_config.json no encontrado';
      }

      const agentes = esperadosBase
        .map(a => {
          const fichajes = fichajesMap[a.dni] || [];
          const ficho = a.turno === 'noche' || a.turno === '24hs'
            ? fichajes.some(x => x.startsWith(fecha))
            : fichajes.some(x => x.startsWith(fecha));
          return {
            ...a,
            ficho,
            fichajes: fichajes.filter(x => a.turno === 'noche' || a.turno === '24hs' ? true : x.startsWith(fecha)),
            justificaciones: justMap[a.dni] || [],
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

      const turnos = ['manana', 'tarde', 'noche', '24hs'] as const;
      const data = turnos.map(turno => {
        const rows = agentes.filter(a => a.turno === turno);
        const ficharon = rows.filter(a => a.ficho);
        const noFicharon = rows.filter(a => !a.ficho);
        const justificados = noFicharon.filter(a => a.justificaciones.length > 0);
        return {
          turno,
          esperadoBruto: rows.length,
          ficharon: ficharon.length,
          noFicharon: noFicharon.length,
          justificados: justificados.length,
          sinJustificar: noFicharon.length - justificados.length,
          ficharonDetalle: ficharon,
          noFicharonDetalle: noFicharon,
        };
      }).filter(t => t.esperadoBruto > 0);

      return res.json({
        ok: true,
        fecha,
        servicio: svcRow,
        archivos: {
          horarios: path.basename(horariosFile),
          siap: siapFile ? path.basename(siapFile) : null,
          ministerio: ministerioFile ? path.basename(ministerioFile) : null,
        },
        totalEsperado: agentes.length,
        totalFicharon: agentes.filter(a => a.ficho).length,
        totalNoFicharon: agentes.filter(a => !a.ficho).length,
        dbError,
        turnos: data,
      });
    } catch (err: any) {
      logger.error({ msg: 'presentes-turno error', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // â”€â”€ GET /reporte-servicio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Reporte mensual de asistencia por servicio: horas teÃ³ricas vs reales,
  // fichajes diarios, feriados y resÃºmenes semanales/mensuales.
  // Query params: servicio_id, periodo (YYYY-MM), siapFile, horariosFile
  router.get('/reporte-servicio', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs' });
    if (!sequelize)  return res.status(500).json({ ok: false, error: 'Sin conexiÃ³n a DB principal' });

    try {
      const servicioId = req.query.servicio_id ? Number(req.query.servicio_id) : null;
      if (!servicioId) return res.status(400).json({ ok: false, error: 'Falta servicio_id' });

      const periodoStr = req.query.periodo ? String(req.query.periodo) : null;
      if (!periodoStr) return res.status(400).json({ ok: false, error: 'Falta periodo (YYYY-MM)' });
      const period = parsePeriodoMes(periodoStr);
      if (!period) return res.status(400).json({ ok: false, error: 'PerÃ­odo invÃ¡lido, usar formato YYYY-MM' });

      const dir   = getDir();
      const files = listExcelFiles(dir);
      const auto  = findAutoFiles(files);

      const horariosFile = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : files.find(f => f.name.toLowerCase().includes('horario'))?.fullPath ?? null;

      const siapFile = req.query.siapFile
        ? path.join(dir, String(req.query.siapFile))
        : auto.siap ?? null;

      // â”€â”€ 1. Nombre del servicio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const { QueryTypes } = await import('sequelize');
      const [svcRow] = await sequelize.query<{ id: number; nombre: string }>(
        'SELECT id, nombre FROM servicios WHERE id = :id AND deleted_at IS NULL LIMIT 1',
        { type: QueryTypes.SELECT, replacements: { id: servicioId } }
      );
      if (!svcRow) return res.status(404).json({ ok: false, error: `Servicio ${servicioId} no encontrado` });

      // â”€â”€ 2. Agentes del servicio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ 3. Feriados del mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const feriadosDb = await sequelize.query<{ fecha: string; nombre: string; tipo: string }>(
        `SELECT DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha, nombre, tipo
         FROM feriados
         WHERE fecha >= :desde AND fecha <= :hasta
         ORDER BY fecha`,
        { type: QueryTypes.SELECT, replacements: { desde: period.start.toISOString().slice(0,10), hasta: period.end.toISOString().slice(0,10) } }
      );
      const feriadoSet = new Set(feriadosDb.map(f => f.fecha));

      // â”€â”€ 4. Horarios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const DOW_KEYS_RS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'] as const;
      type HoraDia = { entrada: string|null; salida: string|null; controlable: boolean };
      type AgHorario = { nombre: string; esGuardia: boolean; dias: Record<string, HoraDia> };
      const horariosMap: Record<string, AgHorario> = {};

      if (horariosFile && fs.existsSync(horariosFile)) {
        const wb = await loadWorkbook(horariosFile);
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

      // â”€â”€ 5. SIAP del mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ 5b. Ministerio del mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      // â”€â”€ 6. Fichajes biomÃ©tricos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // mapa: dni â†’ fecha â†’ { entrada, salida, invertido }
      const fichajesMap: Record<string, Record<string, { entrada: string|null; salida: string|null; invertido: boolean }>> = {};
      // rawMap hoisted para post-procesamiento nocturno/24hs
      let rawMap: Record<string, Record<string, { hora: string; tipo: string }[]>> = {};
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
          // +1 dÃ­a para capturar salidas de turnos nocturnos/24hs del Ãºltimo dÃ­a del perÃ­odo
          const dateToRSext = new Date(period.end); dateToRSext.setUTCDate(dateToRSext.getUTCDate() + 1);
          const dateToRS    = dateToRSext.toISOString().slice(0, 10);
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

              // Si hay entrada pero no salida y existe mÃ¡s de un registro,
              // el agente fichÃ³ ambas marcaciones como tipo 0 (error).
              // Se usa el primer registro como entrada y el Ãºltimo como salida.
              if (entrada && !salida && records.length > 1) {
                salida    = records[records.length - 1].hora;
                invertido = true;
              }

              fichajesMap[d][fecha] = { entrada, salida, invertido };
            }
          }
        } catch (e: any) { dbError = e.message; }
      } else { dbError = 'fichero_config.json no encontrado'; }

      // â”€â”€ 7. Helpers y dÃ­as del mes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const toMins = (hhmm: string): number => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };
      const minsHoras = (ent: string, sal: string): number => {
        if (ent === sal) return 1440; // turno 24hs: entra y sale a la misma hora del dÃ­a siguiente
        let diff = toMins(sal) - toMins(ent);
        if (diff < 0) diff += 1440; // turno nocturno: cruza medianoche
        return diff;
      };
      const toHs = (mins: number) => Math.round(mins / 60 * 100) / 100;

      const allDias: string[] = [];
      const cur = new Date(period.start);
      while (cur <= period.end) {
        allDias.push(cur.toISOString().slice(0,10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
      const DOW_LABELS_RS = ['Dom','Lun','Mar','MiÃ©','Jue','Vie','SÃ¡b'];

      // â”€â”€ 6b. Post-procesamiento: turnos nocturnos y 24hs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // NO modifica fichajesMap. Construye fichajesNocturnoMap por encima,
      // y trackea consumedFichajes para que los del D+1 no se reutilicen en D+1.
      const consumedFichajes = new Set<string>();
      const getFichajesDisp = (dni: string, fecha: string) =>
        (rawMap[dni]?.[fecha] ?? []).filter(r => !consumedFichajes.has(`${dni}|${fecha}|${r.hora}`));

      type FichNocturno = { entrada: string|null; salida: string|null; invertido: boolean; llegadaTarde: boolean; minutosRetraso: number };
      const fichajesNocturnoMap: Record<string, Record<string, FichNocturno>> = {};

      for (const ag of agentesDb) {
        const dni3 = normDni(ag.dni);
        const horAg = horariosMap[dni3] ?? null;
        if (!horAg) continue;

        for (const fecha of allDias) {
          const dow    = new Date(fecha + 'T00:00:00Z').getUTCDay();
          const dowKey = DOW_KEYS_RS[dow] as string;
          const horDia = horAg.dias[dowKey] ?? null;
          if (!horDia?.entrada || !horDia?.salida || !horDia.controlable) continue;

          const entMins = toMins(horDia.entrada);
          const salMins = toMins(horDia.salida);
          if (salMins > entMins) continue; // turno normal: ya lo maneja fichajesMap

          // Fecha siguiente (D+1)
          const dtNext = new Date(fecha + 'T00:00:00Z');
          dtNext.setUTCDate(dtNext.getUTCDate() + 1);
          const fechaNext = dtNext.toISOString().slice(0, 10);

          // Buscar entrada: primer checktype=0 en dÃ­a D disponible
          // Si entrada == 00:00 y no hay en D, buscar en los Ãºltimos 90 min de D-1
          let entradaHora: string | null = null;
          const ficD = getFichajesDisp(dni3, fecha);
          const candidatosEnt = ficD.filter(r => r.tipo === '0');

          if (candidatosEnt.length === 0 && entMins <= 90) {
            // Turno que arranca cerca de medianoche: revisar final del dÃ­a anterior
            const dtPrev = new Date(fecha + 'T00:00:00Z');
            dtPrev.setUTCDate(dtPrev.getUTCDate() - 1);
            const fechaPrev = dtPrev.toISOString().slice(0, 10);
            const ficPrev = getFichajesDisp(dni3, fechaPrev).filter(r => r.tipo === '0' && toMins(r.hora) >= 1350);
            if (ficPrev.length > 0) {
              entradaHora = ficPrev[0].hora;
              consumedFichajes.add(`${dni3}|${fechaPrev}|${entradaHora}`);
            }
          } else if (candidatosEnt.length > 0) {
            entradaHora = candidatosEnt[0].hora;
            consumedFichajes.add(`${dni3}|${fecha}|${entradaHora}`);
          }

          // Buscar salida: fichaje en D+1 cerca de salMins (Â±120 min), preferir checktypeâ‰ 0
          const TOLERANCIA_SAL = 120;
          const ficNext = getFichajesDisp(dni3, fechaNext);
          const candidatosSal = ficNext.filter(r => Math.abs(toMins(r.hora) - salMins) <= TOLERANCIA_SAL);
          let salidaHora: string | null = null;
          if (candidatosSal.length > 0) {
            const noZero = candidatosSal.filter(r => r.tipo !== '0');
            const elegido = noZero.length > 0 ? noZero[noZero.length - 1] : candidatosSal[candidatosSal.length - 1];
            salidaHora = elegido.hora;
            consumedFichajes.add(`${dni3}|${fechaNext}|${salidaHora}`);
          }

          // Llegada tarde: entrada real > entrada programada + 10 min
          let llegadaTarde = false;
          let minutosRetraso = 0;
          if (entradaHora) {
            const realMins = toMins(entradaHora);
            // Si fichÃ³ antes de medianoche para un turno que empieza cerca de 00:00 â†’ no hay retraso
            const diffLlegada = realMins <= 1350 ? realMins - entMins : (realMins - 1440) - entMins;
            if (diffLlegada > 10) { llegadaTarde = true; minutosRetraso = diffLlegada; }
          }

          if (!fichajesNocturnoMap[dni3]) fichajesNocturnoMap[dni3] = {};
          fichajesNocturnoMap[dni3][fecha] = { entrada: entradaHora, salida: salidaHora, invertido: false, llegadaTarde, minutosRetraso };
        }
      }

      // â”€â”€ 8. Construir reporte por agente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

          // Detectar tipo de turno para elegir fuente de fichaje correcta
          const esNocturnoO24hs = !!(horDia?.entrada && horDia?.salida && toMins(horDia.salida) <= toMins(horDia.entrada));

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

          // Para turnos nocturnos/24hs usar el mapa especializado;
          // para normales usar fichajesMap filtrando fichajes ya consumidos por el mapa nocturno.
          let fich: { entrada: string|null; salida: string|null; invertido: boolean; llegadaTarde?: boolean; minutosRetraso?: number } | null = null;
          if (esNocturnoO24hs) {
            fich = fichajesNocturnoMap[dni3]?.[fecha] ?? null;
          } else {
            const fm = ficAg[fecha] ?? null;
            if (fm) {
              const entConsumed = !!(fm.entrada && consumedFichajes.has(`${dni3}|${fecha}|${fm.entrada}`));
              const salConsumed = !!(fm.salida  && consumedFichajes.has(`${dni3}|${fecha}|${fm.salida}`));
              if (entConsumed || salConsumed) {
                // Reconstruir desde rawMap excluyendo consumidos
                const recs = getFichajesDisp(dni3, fecha);
                const ents2 = recs.filter(r => r.tipo === '0');
                const sals2 = recs.filter(r => r.tipo !== '0');
                const ent2  = ents2.length ? ents2[0].hora : null;
                const sal2  = sals2.length ? sals2[sals2.length - 1].hora : null;
                fich = { entrada: ent2, salida: sal2, invertido: false };
              } else {
                fich = fm;
              }
            }
          }

          // Llegada tarde para turnos normales
          if (fich && !esNocturnoO24hs && fich.llegadaTarde === undefined && horDia?.entrada && fich.entrada) {
            const diffLlegada = toMins(fich.entrada) - toMins(horDia.entrada);
            if (diffLlegada > 10) {
              fich = { ...fich, llegadaTarde: true, minutosRetraso: diffLlegada };
            } else {
              fich = { ...fich, llegadaTarde: false, minutosRetraso: 0 };
            }
          }

          let horasReales = 0;
          if (fich?.entrada && fich?.salida) {
            const es24hs = horDia?.entrada === horDia?.salida;
            horasReales = es24hs
              ? toHs(toMins(fich.salida) - toMins(fich.entrada) + 1440)
              : toHs(minsHoras(fich.entrada, fich.salida));
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
            entrada_real:    fich?.entrada ?? null,
            salida_real:     fich?.salida  ?? null,
            invertido:       fich?.invertido    ?? false,
            llegadaTarde:    fich?.llegadaTarde ?? false,
            minutosRetraso:  fich?.minutosRetraso ?? 0,
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

  // â”€â”€â”€ GET /asistencia/cruce-horarios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Cruza el archivo de horarios (entrada/salida por dÃ­a) con el servicio vigente
  // y la ley de revista de la BD. Clasifica cada dÃ­a en turno maÃ±ana/tarde/noche/24hs
  // (nocturno = salida < entrada, 24hs = salida == entrada) y marca franqueros
  // (solo trabajan sÃ¡bado/domingo).
  router.get('/cruce-horarios', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs' });
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexiÃ³n a DB principal' });
    try {
      const dir = getDir();
      const files = listExcelFiles(dir);
      const horariosFile = req.query.horariosFile
        ? path.join(dir, String(req.query.horariosFile))
        : files.find(f => f.name.toLowerCase().includes('horario'))?.fullPath ?? null;
      if (!horariosFile || !fs.existsSync(horariosFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontrÃ³ el archivo de horarios' });
      }

      const toMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
      const pHora = (v: any): string | null => {
        const s = String(v ?? '').trim();
        const m = s.match(/^(\d{1,2}):(\d{2})/);
        return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
      };
      const turnoDia = (ent: string, sal: string): 'manana' | 'tarde' | 'noche' | '24hs' => {
        if (ent === sal) return '24hs';
        if (toMin(sal) < toMin(ent)) return 'noche'; // cruza medianoche
        const h = Number(ent.slice(0, 2));
        if (h >= 5 && h < 12) return 'manana';
        if (h >= 12 && h < 18) return 'tarde';
        return 'noche';
      };
      const horasDia = (ent: string, sal: string): number => {
        if (ent === sal) return 24;
        return ((toMin(sal) - toMin(ent) + 1440) % 1440) / 60;
      };

      // â”€â”€ 1. Parsear horarios.xlsx completo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const wb = await loadWorkbook(horariosFile);
      const ws = wb.worksheets[0];
      if (!ws) return res.status(400).json({ ok: false, error: 'Archivo de horarios vacÃ­o' });

      const hdr: Record<string, number> = {};
      ws.getRow(1).eachCell((c: any, col: number) => {
        const v = normHeader(c?.value ?? '');
        if (v) hdr[v] = col;
      });
      const colDni   = hdr['nro_documento'] ?? hdr['documento'] ?? hdr['dni'] ?? 4;
      const colNom   = hdr['apellido_nombre'] ?? hdr['apellido y nombre'] ?? 2;
      const colReg   = hdr['regimen_estaturario'] ?? hdr['regimen_estatutario'] ?? 19;
      const colPlan  = hdr['planta'] ?? 20;
      const colRev   = hdr['planta_de_revista'] ?? 21;
      const colAgrup = hdr['agrupamiento'] ?? 22;
      const colEstr  = hdr['estructura_servicio'] ?? 23;

      const DIAS_CH = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
      type DiaCruce = { entrada: string | null; salida: string | null; turno: string | null; horas: number };
      const agentesXlsx: any[] = [];

      ws.eachRow((r: any, rn: number) => {
        if (rn === 1) return;
        const dni = normDni(r.getCell(colDni)?.value);
        if (!dni) return;
        const dias: Record<string, DiaCruce> = {};
        let hsSemanales = 0;
        const turnosSet = new Set<string>();
        const diasTrabajados: string[] = [];
        for (const d of DIAS_CH) {
          const ent = pHora(r.getCell(hdr[`${d}_entrada`] ?? 0)?.value);
          const sal = pHora(r.getCell(hdr[`${d}_salida`] ?? 0)?.value);
          if (ent && sal) {
            const turno = turnoDia(ent, sal);
            const horas = horasDia(ent, sal);
            dias[d] = { entrada: ent, salida: sal, turno, horas };
            hsSemanales += horas;
            turnosSet.add(turno);
            diasTrabajados.push(d);
          } else {
            dias[d] = { entrada: null, salida: null, turno: null, horas: 0 };
          }
        }
        const esFranquero = diasTrabajados.length > 0
          && diasTrabajados.every(d => d === 'sabado' || d === 'domingo');
        agentesXlsx.push({
          dni,
          nombre_xlsx: cellToText(r.getCell(colNom)?.value),
          regimen: cellToText(r.getCell(colReg)?.value),
          planta_xlsx: cellToText(r.getCell(colPlan)?.value).toUpperCase(),
          revista: cellToText(r.getCell(colRev)?.value).toUpperCase(),
          agrupamiento: cellToText(r.getCell(colAgrup)?.value),
          estructura: cellToText(r.getCell(colEstr)?.value),
          dias,
          turnos: [...turnosSet],
          esFranquero,
          hsSemanales: Math.round(hsSemanales * 100) / 100,
          diasTrabajados: diasTrabajados.length,
        });
      });

      // â”€â”€ 2. Enriquecer desde la BD: servicio vigente + ley + planta â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const { QueryTypes } = await import('sequelize');
      const dniNums = [...new Set(agentesXlsx.map(a => Number(a.dni)).filter(n => Number.isFinite(n) && n > 0))];
      const dbMap: Record<string, any> = {};
      if (dniNums.length) {
        const dbRows = await sequelize.query<any>(`
          SELECT p.dni, p.apellido, p.nombre,
                 a.estado_empleo,
                 l.nombre  AS ley_nombre,
                 pl.nombre AS planta_nombre,
                 oc.id     AS ocupacion_id,
                 oc.nombre AS ocupacion_nombre,
                 srv.id    AS servicio_id,
                 srv.nombre AS servicio_nombre,
                 dep.id    AS dependencia_id,
                 dep.nombre AS dependencia_nombre
          FROM personal p
          JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
          LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
          LEFT JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
          LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
          LEFT JOIN (
            SELECT ags1.dni, ags1.servicio_id, ags1.dependencia_id
            FROM agentes_servicios ags1
            JOIN (
              SELECT dni, MAX(id) AS max_id
              FROM agentes_servicios
              WHERE deleted_at IS NULL AND fecha_hasta IS NULL
              GROUP BY dni
            ) ult ON ult.max_id = ags1.id
          ) vig ON vig.dni = p.dni
          LEFT JOIN servicios srv ON srv.id = vig.servicio_id AND srv.deleted_at IS NULL
          LEFT JOIN dependencias dep ON dep.id = vig.dependencia_id AND dep.deleted_at IS NULL
          WHERE p.deleted_at IS NULL AND p.dni IN (:dnis)
        `, { type: QueryTypes.SELECT, replacements: { dnis: dniNums } });
        for (const r of dbRows) dbMap[normDni(r.dni)] = r;
      }

      const servicioIdFiltro = req.query.servicio_id ? Number(req.query.servicio_id) : null;
      let agentes = agentesXlsx.map(a => {
        const db = dbMap[a.dni] || null;
        return {
          ...a,
          en_sistema: !!db,
          apellido: db?.apellido ?? null,
          nombre: db?.nombre ?? null,
          estado_empleo: db?.estado_empleo ?? null,
          ley_nombre: db?.ley_nombre ?? null,
          planta_nombre: db?.planta_nombre ?? null,
          ocupacion_id: db?.ocupacion_id ?? null,
          ocupacion_nombre: db?.ocupacion_nombre ?? null,
          servicio_id: db?.servicio_id ?? null,
          servicio_nombre: db?.servicio_nombre ?? null,
          dependencia_id: db?.dependencia_id ?? null,
          dependencia_nombre: db?.dependencia_nombre ?? null,
        };
      });
      if (servicioIdFiltro) agentes = agentes.filter(a => Number(a.servicio_id) === servicioIdFiltro);

      return res.json({
        ok: true,
        archivo: path.basename(horariosFile),
        total: agentes.length,
        agentes,
      });
    } catch (err: any) {
      logger.error({ msg: 'cruce-horarios error', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // â”€â”€â”€ HISTORIAL DE LICENCIAS (tabla `historial`, migraciones 032/033) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Filtros comunes por query: anio, dependencia, novedad, agrupamiento,
  // regimen (regimen_estatutario), planta, justificado, q (DNI o apellido),
  // incluirPresente=1 (por defecto PRESENTE queda afuera: no es licencia).
  function historialWhere(q: any): { where: string; repl: Record<string, any> } {
    const conds: string[] = ['1=1'];
    const repl: Record<string, any> = {};
    if (String(q.incluirPresente || '') !== '1') conds.push("novedad <> 'PRESENTE'");
    if (q.anio) {
      const a = Number(q.anio);
      if (Number.isFinite(a)) {
        conds.push('fecha_desde >= :anioD AND fecha_desde < :anioH');
        repl.anioD = `${a}-01-01`;
        repl.anioH = `${a + 1}-01-01`;
      }
    }
    const iguales: [string, string][] = [
      ['dependencia', 'dependencia'],
      ['novedad', 'novedad'],
      ['agrupamiento', 'agrupamiento'],
      ['regimen', 'regimen_estatutario'],
      ['planta', 'planta'],
      ['justificado', 'justificado'],
    ];
    for (const [param, col] of iguales) {
      if (q[param]) { conds.push(`${col} = :${param}`); repl[param] = String(q[param]); }
    }
    if (q.q) {
      const t = String(q.q).trim();
      if (/^\d{6,}$/.test(t)) { conds.push('dni = :dniQ'); repl.dniQ = Number(t); }
      else if (t) {
        conds.push("(apellido LIKE :txtQ OR nombre LIKE :txtQ OR CONCAT(apellido, ' ', nombre) LIKE :txtQ)");
        repl.txtQ = `%${t}%`;
      }
    }
    return { where: conds.join(' AND '), repl };
  }

  // GET /asistencia/historial-analisis â†’ todos los agregados para el tablero
  router.get('/historial-analisis', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexiÃ³n a DB principal' });
    try {
      const { QueryTypes } = await import('sequelize');
      const { where, repl } = historialWhere(req.query);
      // dÃ­as de cada licencia = hasta - desde + 1 (mÃ­nimo 1)
      const DIAS = 'SUM(GREATEST(DATEDIFF(IFNULL(fecha_hasta, fecha_desde), fecha_desde) + 1, 1))';
      const SEL = `COUNT(*) AS licencias, ${DIAS} AS dias, COUNT(DISTINCT dni) AS agentes`;
      const Q = (sql: string) => sequelize.query<any>(sql, { type: QueryTypes.SELECT, replacements: repl });

      const [
        cardsRows, porAnio, porMesSerie, estacionalidad, porDiaSemana,
        porNovedad, porDependencia, porAgrupamiento, porRegimen, porPlanta,
        porJustificado, topAgentesDias, topAgentesLicencias, aniosRows,
      ] = await Promise.all([
        Q(`SELECT ${SEL}, COUNT(DISTINCT novedad) AS tipos FROM historial WHERE ${where}`),
        Q(`SELECT YEAR(fecha_desde) AS anio, ${SEL} FROM historial WHERE ${where} AND fecha_desde IS NOT NULL GROUP BY anio ORDER BY anio`),
        Q(`SELECT DATE_FORMAT(fecha_desde, '%Y-%m') AS mes, ${SEL} FROM historial WHERE ${where} AND fecha_desde IS NOT NULL GROUP BY mes ORDER BY mes`),
        Q(`SELECT MONTH(fecha_desde) AS mes, ${SEL} FROM historial WHERE ${where} AND fecha_desde IS NOT NULL GROUP BY mes ORDER BY mes`),
        Q(`SELECT WEEKDAY(fecha_desde) AS dia, ${SEL} FROM historial WHERE ${where} AND fecha_desde IS NOT NULL GROUP BY dia ORDER BY dia`),
        // GROUP BY columna cruda (sin IFNULL) para que el Ã­ndice cubridor (035)
        // agrupe solo, sin tabla temporal; el NULL se traduce a '(sin dato)'
        // abajo. FORCE INDEX porque el optimizador no lo elige solo (medido:
        // 2-4Ã— mÃ¡s rÃ¡pido); con bÃºsqueda por apellido (txtQ, columna fuera del
        // Ã­ndice) forzarlo obligarÃ­a a 1M de lookups â†’ se deja al optimizador.
        Q(`SELECT novedad AS valor, ${SEL} FROM historial WHERE ${where} GROUP BY novedad ORDER BY licencias DESC`),
        Q(`SELECT dependencia AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__dep)'} WHERE ${where} GROUP BY dependencia ORDER BY licencias DESC`),
        Q(`SELECT agrupamiento AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__agrup)'} WHERE ${where} GROUP BY agrupamiento ORDER BY licencias DESC`),
        Q(`SELECT regimen_estatutario AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__regimen)'} WHERE ${where} GROUP BY regimen_estatutario ORDER BY licencias DESC`),
        Q(`SELECT planta AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__planta)'} WHERE ${where} GROUP BY planta ORDER BY licencias DESC`),
        Q(`SELECT justificado AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__justif)'} WHERE ${where} GROUP BY justificado ORDER BY licencias DESC`),
        // agregamos por dni sobre el Ã­ndice y reciÃ©n ahÃ­ buscamos el nombre (25 filas)
        Q(`SELECT t.dni, p.apellido, p.nombre, t.licencias, t.dias, t.tipos
           FROM (
             SELECT dni, COUNT(*) AS licencias, ${DIAS} AS dias, COUNT(DISTINCT novedad) AS tipos
             FROM historial WHERE ${where} GROUP BY dni ORDER BY dias DESC LIMIT 25
           ) t LEFT JOIN personal p ON p.dni = t.dni`),
        Q(`SELECT t.dni, p.apellido, p.nombre, t.licencias, t.dias, t.tipos
           FROM (
             SELECT dni, COUNT(*) AS licencias, ${DIAS} AS dias, COUNT(DISTINCT novedad) AS tipos
             FROM historial WHERE ${where} GROUP BY dni ORDER BY licencias DESC LIMIT 25
           ) t LEFT JOIN personal p ON p.dni = t.dni`),
        // aÃ±os disponibles SIN filtros, para que el selector no se achique solo
        sequelize.query<any>(
          'SELECT DISTINCT YEAR(fecha_desde) AS anio FROM historial WHERE fecha_desde IS NOT NULL ORDER BY anio',
          { type: QueryTypes.SELECT },
        ),
      ]);

      const sinDato = (rows: any[]) => rows.map(r => ({ ...r, valor: r.valor ?? '(sin dato)' }));

      return res.json({
        ok: true,
        cards: cardsRows[0] || { licencias: 0, dias: 0, agentes: 0, tipos: 0 },
        porAnio, porMesSerie, estacionalidad, porDiaSemana,
        porNovedad: sinDato(porNovedad),
        porDependencia: sinDato(porDependencia),
        porAgrupamiento: sinDato(porAgrupamiento),
        porRegimen: sinDato(porRegimen),
        porPlanta: sinDato(porPlanta),
        porJustificado: sinDato(porJustificado),
        topAgentesDias, topAgentesLicencias,
        anios: aniosRows.map((r: any) => Number(r.anio)),
      });
    } catch (err: any) {
      logger.error({ msg: 'historial-analisis error', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // GET /asistencia/historial-detalle â†’ filas crudas paginadas (mismos filtros)
  router.get('/historial-detalle', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexiÃ³n a DB principal' });
    try {
      const { QueryTypes } = await import('sequelize');
      const { where, repl } = historialWhere(req.query);
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 100));

      const [totRows, rows] = await Promise.all([
        sequelize.query<any>(`SELECT COUNT(*) AS n FROM historial WHERE ${where}`,
          { type: QueryTypes.SELECT, replacements: repl }),
        sequelize.query<any>(`
          SELECT dni, apellido, nombre, novedad, fecha_desde, fecha_hasta,
                 GREATEST(DATEDIFF(IFNULL(fecha_hasta, fecha_desde), fecha_desde) + 1, 1) AS dias,
                 justificado, dependencia, agrupamiento, regimen_estatutario, planta, estructura_servicio
          FROM historial
          WHERE ${where}
          ORDER BY fecha_desde DESC, id DESC
          LIMIT :limQ OFFSET :offQ
        `, { type: QueryTypes.SELECT, replacements: { ...repl, limQ: limit, offQ: (page - 1) * limit } }),
      ]);

      return res.json({ ok: true, total: Number(totRows[0]?.n || 0), page, limit, rows });
    } catch (err: any) {
      logger.error({ msg: 'historial-detalle error', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // GET /asistencia/historial-excesos â†’ control de topes: agentes que acumulan
  // minDias o mÃ¡s dÃ­as del mismo tipo de licencia en un mismo aÃ±o (con los
  // mismos filtros del tablero: rÃ©gimen BECARIOS + tipo X + minDias=12 responde
  // "Â¿quÃ© becarios se tomaron mÃ¡s de 12 dÃ­as de X?").
  router.get('/historial-excesos', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexiÃ³n a DB principal' });
    try {
      const { QueryTypes } = await import('sequelize');
      const { where, repl } = historialWhere(req.query);
      const minDias = Math.max(1, Number(req.query.minDias) || 12);
      const rows = await sequelize.query<any>(`
        SELECT t.dni, p.apellido, p.nombre, t.novedad, t.anio, t.dias, t.veces,
               t.regimen_estatutario, t.dependencia
        FROM (
          SELECT dni, novedad, YEAR(fecha_desde) AS anio,
                 SUM(GREATEST(DATEDIFF(IFNULL(fecha_hasta, fecha_desde), fecha_desde) + 1, 1)) AS dias,
                 COUNT(*) AS veces,
                 MAX(regimen_estatutario) AS regimen_estatutario,
                 MAX(dependencia) AS dependencia
          FROM historial
          WHERE ${where} AND fecha_desde IS NOT NULL
          GROUP BY dni, novedad, anio
          HAVING dias >= :minDias
        ) t LEFT JOIN personal p ON p.dni = t.dni
        ORDER BY t.dias DESC
        LIMIT 500
      `, { type: QueryTypes.SELECT, replacements: { ...repl, minDias } });
      return res.json({ ok: true, minDias, total: rows.length, rows });
    } catch (err: any) {
      logger.error({ msg: 'historial-excesos error', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // â”€â”€ LICENCIAS PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // GET /asistencia/licencias-pdf/archivos â†’ lista los PDFs en LICENCIAS_PDF_DIR
  router.get('/licencias-pdf/archivos', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      const dir = env.LICENCIAS_PDF_DIR;
      if (!dir) return res.json({ ok: true, dir: null, archivos: [] });
      if (!fs.existsSync(dir)) return res.json({ ok: true, dir, existe: false, archivos: [] });

      const archivos = fs.readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
        .map((f) => {
          const fp = path.join(dir, f);
          const stat = fs.statSync(fp);
          return { nombre: f, ['tamaño']: stat.size, modificado: stat.mtime };
        });

      return res.json({ ok: true, dir, existe: true, archivos });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /asistencia/licencias-pdf/comparar â†’ corre la comparaciÃ³n
  router.get('/licencias-pdf/comparar', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      const dir = env.LICENCIAS_PDF_DIR;
      if (!dir || !fs.existsSync(dir)) {
        return res.status(400).json({ ok: false, error: 'LICENCIAS_PDF_DIR no configurado o no existe' });
      }

      const mapeo = loadMapeo(env.EXCEL_ASISTENCIA_DIR || dir);

      const { compararLicencias } = await import('../services/parseLicenciasPdf.js');
      const resultado = await compararLicencias(dir, mapeo);

      return res.json({ ok: true, data: resultado });
    } catch (err: any) {
      logger.error({ msg: 'licencias-pdf/comparar error', err: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}
