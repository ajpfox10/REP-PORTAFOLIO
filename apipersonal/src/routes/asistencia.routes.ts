// src/routes/asistencia.routes.ts
// Comparador de asistencia MINISTERIO vs SIAP
//
// FLUJO:
//  GET  /asistencia/config          → directorio configurado en .env
//  GET  /asistencia/archivos        → lista los .xlsx/.xltx de EXCEL_ASISTENCIA_DIR
//  GET  /asistencia/mapeo           → devuelve el mapeo actual de novedades (tabla mapeo_novedades)
//  PUT  /asistencia/mapeo           → guarda el mapeo editado (tabla mapeo_novedades, reglas generales)
//  DELETE /asistencia/mapeo         → restaura el mapeo de la carga inicial (migración 055)
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
import {
  loadMapeoTabla, saveMapeoTabla, restaurarMapeoTabla,
  loadMapeoGeneral, listReglasCie, addReglasCie, bajaReglaCie, normCie,
  novedadesConCodigoCarga, normNovedadCarga,
} from '../services/mapeoNovedades';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { evaluarAgente, leerFichadas, EvalAgente, HORARIOS_ARCHIVO } from '../services/sinSalidaEval';

let ExcelJS: any;
try { ExcelJS = require('exceljs'); } catch { ExcelJS = null; }

// SheetJS: ExcelJS NO sabe leer el formato viejo .xls (binario OLE/BIFF).
// Lo usamos solo para convertir .xls → .xlsx en memoria y dárselo a ExcelJS.
let XLSX_SJS: any;
try { XLSX_SJS = require('xlsx'); } catch { XLSX_SJS = null; }

/**
 * Carga un workbook ExcelJS desde cualquier formato soportado.
 *  - .xlsx / .xltx → lectura nativa de ExcelJS.
 *  - .xls          → se convierte a .xlsx en memoria con SheetJS y se carga el
 *                    buffer. Sin esto, ExcelJS tira "Can't find end of central
 *                    directory" porque el .xls no es un ZIP.
 */
async function loadWorkbook(fp: string): Promise<any> {
  const wb = new ExcelJS.Workbook();
  if (path.extname(fp).toLowerCase() === '.xls') {
    if (!XLSX_SJS) {
      throw new Error('Falta dependencia "xlsx" para leer archivos .xls (npm i xlsx)');
    }
    // cellDates:false a propósito: dejamos las fechas como serial numérico.
    // Si SheetJS crea objetos Date, los arma en la zona horaria local del server
    // (UTC-3) y una fecha-entero (medianoche) termina cayendo el día anterior en
    // UTC → todo el Ministerio salía corrido -1 día. Como número, parseDate las
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

// El mapeo de novedades vive en la tabla `mapeo_novedades` (services/mapeoNovedades.ts):
// es el mismo que usan el comparador SIAPE y los robots de carga en la Intranet.

const DEFAULT_SKIP_NOVEDADES: string[] = [
  // ejemplos de novedades a omitir (si hiciera falta)
];

// Mapeo normalizado (claves y valores con normNovedad, cada código incluye su
// propio nombre) — misma forma que devolvía antes el JSON fusionado.
async function loadMapeo(sequelize?: import('sequelize').Sequelize): Promise<Record<string, string[]>> {
  if (!sequelize) throw new Error('Sin conexión a DB: el mapeo de novedades está en la tabla mapeo_novedades');
  return mergeMapeo({}, await loadMapeoTabla(sequelize));
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

  // El tilde JUSTIFICADO solo cuenta para enfermedad: la ANUAL COMPLEMENTARIA se carga en SIAP
  // sin tildar aunque esté otorgada, así que coincide por mapeo + fechas como el resto.
  return novedadesConectan(equivs, novSN);
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

  // Columnas reales del SIAP según estructura del Excel
  const colDni      = headers['nro_documento'] ?? headers['nro documento'] ?? headers['dni'] ?? headers['documento'] ?? 5;
  const colApellido = headers['apellido'] ?? 2;
  const colNombreFirst = headers['nombre'] ?? 3;
  const colNombreFull  = headers['apellido y nombres'] ?? headers['apellido y nombre'] ?? 0;
  const colNovedad  = headers['novedad'] ?? headers['novedad siap'] ?? 12;
  const colDesde    = headers['fecha_desde'] ?? headers['fecha desde'] ?? headers['desde'] ?? 13;
  const colHasta    = headers['fecha_hasta'] ?? headers['fecha hasta'] ?? headers['hasta'] ?? 14;
  const colJustificado = headers['justificado'] ?? 15;
  const colAgrup    = headers['agrupamiento'] ?? 10;
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
    if (n && n !== '—' && n !== '(SIN MAPEO)' && !n.includes('SIN NOVEDAD MINISTERIO')) labels.add(n);
  };

  add(row?.novedad_ministerio);

  const novSN = normNovedad(row?.novedad_siap);
  const justS = String(row?.justificado || '').trim().toUpperCase();
  const siapEsMedica =
    novSN === 'ENFERMEDAD' ||
    novSN.includes('ENFERMEDAD DE FAMILIAR') ||
    novSN.includes('ATENCION FAMILIAR ENFERMO');
  if (siapEsMedica && justS === 'NO') {
    add('E-LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)');
    add('E - LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)');
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

// 05/11/2026: qué pasó con la carga en la Intranet, desde la cola real del robot 2.0
// (novedades_carga_intranet). Los resultado_carga*.xlsx quedan solo como respaldo si no hay fila en la cola.
// Agrega carga_id, estado_carga, detalle_carga, carga_intentos, carga_ultimo (dd/mm/aaaa hh:mm),
// carga_cargado_en; en_cola=false si el robot nunca tomó esa novedad.
async function enriquecerConColaCarga(
  rows: any[],
  sequelize: import('sequelize').Sequelize | undefined,
): Promise<any[]> {
  if (!sequelize || rows.length === 0) return rows;
  const dnis = Array.from(new Set(rows.map(r => normDni(r?.dni)).filter(Boolean)));
  if (!dnis.length) return rows;
  let cola: any[] = [];
  try {
    const [res] = await sequelize.query(
      `SELECT id, dni, novedad_siap, DATE_FORMAT(desde, '%Y-%m-%d') AS desde, DATE_FORMAT(hasta, '%Y-%m-%d') AS hasta,
              estado, label_intranet, detalle, intentos,
              DATE_FORMAT(actualizado_en, '%d/%m/%Y %H:%i') AS ultimo,
              DATE_FORMAT(cargado_en, '%d/%m/%Y %H:%i') AS cargado_en
         FROM novedades_carga_intranet WHERE dni IN (:dnis)`,
      { replacements: { dnis } });
    cola = res as any[];
  } catch (err) {
    logger.warn({ msg: 'asistencia: no se pudo leer novedades_carga_intranet', err });
    return rows;
  }
  const exacta = new Map<string, any>();
  const porFecha = new Map<string, any[]>();
  for (const c of cola) {
    exacta.set(cargaKey(c.dni, normNovedad(c.novedad_siap), c.desde, c.hasta), c);
    const k = cargaFechaKey(c.dni, c.desde, c.hasta);
    (porFecha.get(k) || porFecha.set(k, []).get(k)!).push(c);
  }
  return rows.map((r: any) => {
    const dni = normDni(r?.dni);
    const desde = dateToStr(parseDate(r?.fecha_desde_siap));
    const hasta = dateToStr(parseDate(r?.fecha_hasta_siap)) || desde;
    if (!dni || !desde || !r?.novedad_siap || r.novedad_siap === '—') return r;
    let hit = exacta.get(cargaKey(dni, normNovedad(r.novedad_siap), desde, hasta));
    if (!hit) {
      const f = porFecha.get(cargaFechaKey(dni, desde, hasta)) || [];
      if (f.length === 1) hit = f[0];
    }
    if (!hit) return { ...r, en_cola: false };
    return {
      ...r,
      en_cola: true,
      carga_id: hit.id,
      estado_carga: hit.estado,
      detalle_carga: String(hit.detalle || '').replace(/^\W*Close\s+/i, '').trim() || null,
      label_carga: hit.label_intranet,
      carga_intentos: Number(hit.intentos || 0),
      carga_ultimo: hit.ultimo,
      carga_cargado_en: hit.cargado_en,
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
        novedad_siap: '—', fecha_desde_siap: '—', fecha_hasta_siap: '—',
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
      novedad_siap: bestCandidate ? bestCandidate.novedad : '—',
      fecha_desde_siap: bestCandidate ? dateToStr(getOriginalDesde(bestCandidate)) : '—',
      fecha_hasta_siap: bestCandidate ? dateToStr(getOriginalHasta(bestCandidate)) : '—',
      estado: bestCandidate && motivo !== 'RANGO_DISTINTO' && motivo !== 'SOLAPA_PERO_NO_IGUAL' ? 'NO COINCIDENTE' : (bestCandidate ? 'RANGO_DISTINTO' : 'NO COINCIDENTE'),
      motivo,
      upa: p.upa,
    };
  }

  return out;
}
// ── Comparador SIAPE → Ministerio (06/11/2026, pedido del usuario) ─────────────────────────────
// Muestra cuáles NO son exactas y en qué difieren (nunca da por OK algo parecido). Por agente+dependencia:
//  1) EXACTA (COINCIDENTE): misma licencia (mapeo) y mismas fechas.
//  2) EXACTA por unión: licencias de SIAPE partidas en días seguidos que JUNTAS dan exactamente el rango
//     del Ministerio (el robot carga los días seguidos juntos). Un día de más o de menos ya no es exacta.
//  3) FECHAS_DISTINTAS (RANGO_DISTINTO): misma licencia que se pisa en fechas → dice qué días sobran/faltan.
//     Se elige la del Ministerio que más días comparte (nunca una de otra semana).
//  4) OTRA_LICENCIA: en esas fechas el Ministerio tiene otra cosa.
//  5) FALTA_EN_MINISTERIO: nada en esas fechas (si el agente no tiene nada en esa dependencia, sigue el
//     motivo DNI_NO_EXISTE_EN_MINISTERIO_PARA_ que después precisa precisarDniSinMinisterio).
// `diferencia` = texto claro para la pantalla. Un registro del Ministerio puede explicar varias filas de SIAPE.
const DIA_MS = 86_400_000;
const fmtDM = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const diasEntre = (a: Date, b: Date) => Math.round((toUTCMidnight(b).getTime() - toUTCMidnight(a).getTime()) / DIA_MS) + 1;
const masDias = (d: Date, n: number) => new Date(toUTCMidnight(d).getTime() + n * DIA_MS);
function rangoTxt(a: Date, b: Date): string {
  return a.getTime() === b.getTime() ? `el ${fmtDM(a)}` : `del ${fmtDM(a)} al ${fmtDM(b)}`;
}
function nombreNov(n: any): string {
  return String(n || '').trim().replace(/\s+/g, ' ');
}

function compararSiapVsMinisterioDetalle(
  siap: any[],
  ministerioMap: Record<string, any[]>,
  mapeo: Record<string, string[]>,
  skipNovedades: string[],
): any[] {
  const mapeoN = normMapeo(mapeo);
  const minByUpaAndDni: Record<string, Record<string, any[]>> = {};
  for (const [upa, rows] of Object.entries(ministerioMap)) {
    minByUpaAndDni[upa] = {};
    for (const m of rows) (minByUpaAndDni[upa][normDni((m as any).dni)] ||= []).push(m);
  }
  const conecta = (m: any, s: any) => novedadesMinisterioSiapConectan(mapeoN, m.novedad, s.novedad, s.justificado);
  const rango = (r: any) => {
    const d = getOriginalDesde(r); const h = getOriginalHasta(r) ?? d;
    return d && h ? { d: toUTCMidnight(d), h: toUTCMidnight(h) } : null;
  };
  const comparte = (a: { d: Date; h: Date }, b: { d: Date; h: Date }) => {
    const ini = a.d > b.d ? a.d : b.d; const fin = a.h < b.h ? a.h : b.h;
    return fin >= ini ? diasEntre(ini, fin) : 0;
  };

  const out: any[] = new Array(siap.length);
  // agrupar SIAPE por agente+dependencia (las omitidas / sin archivo se resuelven acá mismo)
  const grupos = new Map<string, number[]>();
  siap.forEach((s: any, idx) => {
    const upa = String(s.upa || '').trim();
    const novS = String(s.novedad || '').trim();
    const novSN = normNovedad(novS);
    const base = {
      dni: s.dni, nombre: s.nombre, novedad_siap: novS,
      fecha_desde_siap: dateToStr(getOriginalDesde(s)), fecha_hasta_siap: dateToStr(getOriginalHasta(s)),
      upa, justificado: String(s.justificado || '').trim().toUpperCase(),
    };
    const vacio = { novedad_ministerio: '—', fecha_desde_ministerio: '—', fecha_hasta_ministerio: '—' };
    if (skipNovedades.some(sk => novSN.includes(normNovedad(sk)))) { out[idx] = { ...base, ...vacio, estado: 'OMITIDO' }; return; }
    if (!upa || !minByUpaAndDni[upa]) {
      out[idx] = { ...base, ...vacio, estado: 'NO COINCIDENTE', motivo: upa ? `Sin archivo ministerio para ${upa}` : 'Sin UPA en SIAP' };
      return;
    }
    out[idx] = base;   // se completa abajo
    const k = `${upa}|${normDni(s.dni)}`;
    (grupos.get(k) || grupos.set(k, []).get(k)!).push(idx);
  });

  for (const [k, idxs] of grupos) {
    const [upa, dni] = k.split('|');
    let mins = minByUpaAndDni[upa][dni] || [];
    // Sin nada en su dependencia pero con novedades en el archivo de otra: se compara contra esa
    // (misma lógica exacta/unión/fechas) y se aclara dónde está cargada.
    let otraDep = '';
    if (mins.length === 0) {
      for (const [u, porDni] of Object.entries(minByUpaAndDni)) {
        if (u !== upa && porDni[dni]?.length) { mins = porDni[dni]; otraDep = u; break; }
      }
    }
    const notaDep = otraDep ? ` · en el Ministerio figura en ${otraDep} (SIAPE dice ${upa})` : '';
    const pend = new Set(idxs);
    const usados = new Set<any>();
    const ponerMin = (idx: number, m: any, estado: string, motivo: string, diferencia: string) => {
      out[idx] = {
        ...out[idx],
        novedad_ministerio: m ? String(m.novedad || '').trim() : '—',
        fecha_desde_ministerio: m ? dateToStr(getOriginalDesde(m)) : '—',
        fecha_hasta_ministerio: m ? dateToStr(getOriginalHasta(m)) : '—',
        estado, motivo, diferencia: diferencia + notaDep,
        ...(otraDep && estado === 'COINCIDENTE' ? { cargada_en_otra_dep: otraDep } : {}),
      };
      pend.delete(idx);
    };

    // Aviso: días repetidos en SIAPE (dos licencias del agente que se pisan)
    const avisoRepetido = new Map<number, string>();
    for (const a of idxs) for (const b of idxs) {
      if (a >= b) continue;
      const ra = rango(siap[a]); const rb = rango(siap[b]);
      if (!ra || !rb || !comparte(ra, rb)) continue;
      const ini = ra.d > rb.d ? ra.d : rb.d; const fin = ra.h < rb.h ? ra.h : rb.h;
      const t = `SIAPE tiene ${rangoTxt(ini, fin)} repetido en dos licencias`;
      avisoRepetido.set(a, t); avisoRepetido.set(b, t);
    }
    const conAviso = (idx: number, t: string) => (avisoRepetido.has(idx) ? `${t} · ${avisoRepetido.get(idx)}` : t);

    // 1) exactas
    for (const idx of idxs) {
      const s = siap[idx]; const rs = rango(s); if (!rs) continue;
      const m = mins.find(m => !usados.has(m) && conecta(m, s) && sameDateRange(getOriginalDesde(m), getOriginalHasta(m), rs.d, rs.h));
      if (m) { usados.add(m); ponerMin(idx, m, 'COINCIDENTE', '', conAviso(idx, 'Exacta')); }
    }

    // 2) exacta por unión de días seguidos de la misma licencia
    for (const m of mins) {
      if (usados.has(m)) continue;
      const rm = rango(m); if (!rm) continue;
      const dentro = [...pend].filter(i => { const r = rango(siap[i]); return r && conecta(m, siap[i]) && r.d >= rm.d && r.h <= rm.h; })
        .sort((a, b) => rango(siap[a])!.d.getTime() - rango(siap[b])!.d.getTime());
      if (dentro.length < 2) continue;
      let cubre = rm.d; let ok = true;
      // cubre = primer día todavía no cubierto; un hueco (r.d > cubre) ya no es exacta
      for (const i of dentro) {
        const r = rango(siap[i])!;
        if (r.d.getTime() > cubre.getTime()) { ok = false; break; }
        const sig = masDias(r.h, 1); if (sig > cubre) cubre = sig;
      }
      if (ok && cubre.getTime() === masDias(rm.h, 1).getTime()) {
        usados.add(m);
        for (const i of dentro) ponerMin(i, m, 'COINCIDENTE', '', conAviso(i, `Exacta: en el Ministerio está junta ${rangoTxt(rm.d, rm.h)}`));
      }
    }

    // 3/4/5) el resto: describir la diferencia
    for (const idx of [...pend]) {
      const s = siap[idx]; const rs = rango(s);
      if (!rs) { ponerMin(idx, null, 'NO COINCIDENTE', 'FALTA_EN_MINISTERIO', 'SIAPE sin fechas'); continue; }
      if (mins.length === 0) {
        ponerMin(idx, null, 'NO COINCIDENTE', `DNI_NO_EXISTE_EN_MINISTERIO_PARA_${upa}`,
          `En el Ministerio el agente no tiene ninguna novedad en ${upa}`);
        out[idx]._sDesde = rs.d; out[idx]._sHasta = rs.h;
        continue;
      }
      const conDias = (lista: any[]) => lista.map(m => ({ m, rm: rango(m)!, n: rango(m) ? comparte(rango(m)!, rs) : 0 }))
        .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      const misma = conDias(mins.filter(m => conecta(m, s)));
      if (misma.length) {
        const { m, rm } = misma[0];
        const partes: string[] = [];
        if (rm.d < rs.d) partes.push(`el Ministerio tiene de más ${rangoTxt(rm.d, masDias(rs.d, -1))}`);
        if (rm.h > rs.h) partes.push(`el Ministerio tiene de más ${rangoTxt(masDias(rs.h, 1), rm.h)}`);
        if (rs.d < rm.d) partes.push(`faltan en el Ministerio ${rangoTxt(rs.d, masDias(rm.d, -1))}`);
        if (rs.h > rm.h) partes.push(`faltan en el Ministerio ${rangoTxt(masDias(rm.h, 1), rs.h)}`);
        // qué dice SIAPE en los días que el Ministerio tiene de más
        const extras: string[] = [];
        for (const [a, b] of [[rm.d, masDias(rs.d, -1)], [masDias(rs.h, 1), rm.h]] as [Date, Date][]) {
          if (b < a) continue;
          for (const j of idxs) {
            if (j === idx) continue;
            const rj = rango(siap[j]); if (!rj) continue;
            const ini = rj.d > a ? rj.d : a; const fin = rj.h < b ? rj.h : b;
            if (fin >= ini && normNovedad(siap[j].novedad) !== normNovedad(s.novedad))
              extras.push(`en SIAPE ${rangoTxt(ini, fin)} es ${String(siap[j].novedad).trim().toLowerCase()}`);
          }
        }
        const txt = `Ministerio: ${nombreNov(m.novedad)} ${rangoTxt(rm.d, rm.h)} · SIAPE: ${rangoTxt(rs.d, rs.h)} → `
          + partes.join(' y ') + (extras.length ? ` (${extras.join('; ')})` : '');
        ponerMin(idx, m, 'RANGO_DISTINTO', 'FECHAS_DISTINTAS', conAviso(idx, txt));
        continue;
      }
      const otra = conDias(mins);
      if (otra.length) {
        const { m, rm } = otra[0];
        ponerMin(idx, m, 'NO COINCIDENTE', 'OTRA_LICENCIA',
          conAviso(idx, `En esas fechas el Ministerio tiene otra licencia: ${nombreNov(m.novedad)} ${rangoTxt(rm.d, rm.h)}`));
        continue;
      }
      ponerMin(idx, null, 'NO COINCIDENTE', 'FALTA_EN_MINISTERIO',
        conAviso(idx, `Falta en el Ministerio: no tiene nada ${rangoTxt(rs.d, rs.h)}`));
    }
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
      out[idx] = { ...baseRow, novedad_ministerio: '—', fecha_desde_ministerio: '—', fecha_hasta_ministerio: '—', estado: 'OMITIDO' };
      return;
    }

    if (!upa || !minByUpaAndDni[upa]) {
      out[idx] = { ...baseRow, novedad_ministerio: '—', fecha_desde_ministerio: '—', fecha_hasta_ministerio: '—',
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
        : '—';

    out[p.idx] = {
      ...p.baseRow,
      novedad_ministerio:     novedadesMinTexto,
      fecha_desde_ministerio: bestCandidate ? dateToStr(getOriginalDesde(bestCandidate)) : '—',
      fecha_hasta_ministerio: bestCandidate ? dateToStr(getOriginalHasta(bestCandidate)) : '—',
      estado: bestCandidate && motivo !== 'RANGO_DISTINTO' && motivo !== 'SOLAPA_PERO_NO_IGUAL' ? 'NO COINCIDENTE' : (bestCandidate ? 'RANGO_DISTINTO' : 'NO COINCIDENTE'),
      motivo,
      // fechas de comparación del SIAP: las usa precisarDniSinMinisterio y las saca antes de responder
      ...(p.mins.length === 0 ? { _sDesde: p.sDesde, _sHasta: p.sHasta } : {}),
    };
  }

  return out;
}

// Plantel nominado del Ministerio (D:\G\comparacion\plantel nominado.xlsx): DNI → dependencia ("UPA 18" | "UPA 4" | "HOSPITAL").
async function leerPlantelNominado(dir: string): Promise<Map<string, string> | null> {
  const fp = path.join(dir, 'plantel nominado.xlsx');
  if (!fs.existsSync(fp)) return null;
  try {
    const wb = await loadWorkbook(fp);
    const ws = wb.worksheets[0];
    if (!ws) return null;
    const headers: Record<string, number> = {};
    ws.getRow(1).eachCell((c: any, col: number) => {
      const v = String(c?.value ?? '').trim().toUpperCase();
      if (v) headers[v] = col;
    });
    const colDni = headers['NRO_DOCUMENTO'];
    const colEst = headers['ESTRUCTURA_SERVICIO'];
    if (!colDni) return null;
    const out = new Map<string, string>();
    ws.eachRow((r: any, n: number) => {
      if (n === 1) return;
      const dni = normDni(cellToText(r.getCell(colDni)?.value));
      if (!dni) return;
      const est = colEst ? cellToText(r.getCell(colEst)?.value).toUpperCase() : '';
      const m = est.match(/UPA\s*(\d+)/) ?? est.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
      out.set(dni, m ? `UPA ${m[1]}` : 'HOSPITAL');
    });
    return out;
  } catch (e: any) {
    logger.warn({ msg: 'asistencia: no se pudo leer plantel nominado', error: e?.message });
    return null;
  }
}

// Las filas SIAP sin ninguna novedad del DNI en el archivo Ministerio de su dependencia antes salían
// como "DNI_NO_EXISTE_EN_MINISTERIO_PARA_X", que casi nunca era cierto. Se precisa el motivo:
//   1) el DNI tiene novedades en el archivo de OTRA dependencia (UPA 4 / UPA 18 / HOSPITAL);
//   2) el agente está de BAJA en personal (sin tramo ACTIVO) → estado nuevo 'BAJA';
//   3) está en el plantel nominado del Ministerio pero no tiene la novedad cargada (falta cargar);
//   4) no está en el plantel del Ministerio / no existe en personal.
async function precisarDniSinMinisterio(
  rows: any[],
  ministerioMap: Record<string, any[]>,
  mapeo: Record<string, string[]>,
  sequelize: import('sequelize').Sequelize | undefined,
  dir: string,
): Promise<any[]> {
  const PREFIJO = 'DNI_NO_EXISTE_EN_MINISTERIO_PARA_';
  const objetivo = rows.filter(r => String(r?.motivo || '').startsWith(PREFIJO));
  if (objetivo.length === 0) return rows;

  const mapeoN = normMapeo(mapeo);
  const porUpa: Record<string, Record<string, any[]>> = {};
  for (const [upa, list] of Object.entries(ministerioMap)) {
    porUpa[upa] = {};
    for (const m of list) {
      const d = normDni((m as any).dni);
      (porUpa[upa][d] = porUpa[upa][d] || []).push(m);
    }
  }

  // Estado en personal: existe / tiene tramo ACTIVO / último egreso.
  const personal = new Map<string, { activo: boolean; egreso: string | null; motivoBaja: string | null }>();
  const nums = [...new Set(objetivo.map(r => Number(normDni(r.dni))).filter(n => n > 0))];
  if (sequelize && nums.length) {
    try {
      const [dbRows] = await sequelize.query(
        `SELECT a.dni,
                MAX(a.estado_empleo = 'ACTIVO') AS activo,
                MAX(a.fecha_egreso) AS egreso,
                SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(a.motivo_baja,'') ORDER BY a.fecha_egreso DESC SEPARATOR '||'), '||', 1) AS motivo_baja
           FROM agentes a
          WHERE a.dni IN (${nums.map(() => '?').join(',')}) AND a.deleted_at IS NULL
          GROUP BY a.dni`,
        { replacements: nums },
      ) as [any[], unknown];
      for (const r of dbRows) {
        personal.set(normDni(String(r.dni)), {
          activo: Number(r.activo) === 1,
          egreso: r.egreso ? dateToStr(new Date(r.egreso)) : null,
          motivoBaja: r.motivo_baja ? String(r.motivo_baja).trim() || null : null,
        });
      }
    } catch (e: any) {
      logger.warn({ msg: 'asistencia: error consultando agentes para DNI sin Ministerio', error: e?.message });
    }
  }

  const plantel = await leerPlantelNominado(dir);

  return rows.map(row => {
    if (!String(row?.motivo || '').startsWith(PREFIJO)) return row;
    // diferencia afuera: acá se precisa el motivo (otra dependencia, baja, plantel) y el front lo traduce
    const { _sDesde, _sHasta, diferencia: _dif, ...r } = row;
    const dni = normDni(r.dni);
    const upa = String(r.upa || '').trim();

    // 1) Novedades en el archivo de otra dependencia
    for (const [otra, idx] of Object.entries(porUpa)) {
      if (otra === upa) continue;
      const mins = idx[dni];
      if (!mins || mins.length === 0) continue;
      const sDesde: Date | null = _sDesde ?? null;
      const sHasta: Date | null = _sHasta ?? null;
      const match = mins.find((m: any) =>
        novedadesMinisterioSiapConectan(mapeoN, m.novedad, r.novedad_siap, r.justificado) &&
        sameDateRange(getCmpDesde(m), getCmpHasta(m), sDesde, sHasta));
      if (match) {
        return {
          ...r,
          novedad_ministerio: String(match.novedad || '').trim(),
          fecha_desde_ministerio: dateToStr(getOriginalDesde(match)),
          fecha_hasta_ministerio: dateToStr(getOriginalHasta(match)),
          // 05/11/2026 (usuario): está cargada, solo que en el plantel de otra dependencia → OK, no es error
          // 06/11: sin motivo (no es un error); el dato de la otra dependencia va en cargada_en_otra_dep
          estado: 'COINCIDENTE',
          cargada_en_otra_dep: otra,
          motivo: '',
          diferencia: `Exacta, pero cargada en el Ministerio de ${otra} (SIAPE dice ${upa})`,
        };
      }
      return { ...r, motivo: `DNI_CON_NOVEDADES_EN_MINISTERIO_${otra}_(SIAP_DICE_${upa})` };
    }

    // 2) De baja en personal
    const p = personal.get(dni);
    if (p && !p.activo) {
      const extra = [p.egreso ? `egreso ${p.egreso}` : '', p.motivoBaja || ''].filter(Boolean).join(' - ');
      return { ...r, estado: 'BAJA', motivo: `AGENTE_DE_BAJA${extra ? ` (${extra})` : ''}` };
    }

    // 3/4) Plantel nominado del Ministerio
    if (plantel) {
      const depPlantel = plantel.get(dni);
      if (depPlantel) {
        return {
          ...r,
          motivo: depPlantel === upa
            ? 'SIN_NOVEDAD_CARGADA_EN_MINISTERIO'
            : `SIN_NOVEDAD_CARGADA_EN_MINISTERIO_(PLANTEL_${depPlantel})`,
        };
      }
      return { ...r, motivo: p ? 'NO_ESTA_EN_PLANTEL_MINISTERIO' : 'NO_ESTA_EN_PLANTEL_NI_EN_PERSONAL' };
    }
    return { ...r, motivo: p ? 'SIN_NOVEDAD_CARGADA_EN_MINISTERIO' : 'DNI_NO_EXISTE_EN_PERSONAL' };
  });
}
// Período pedido: rango libre desde/hasta (YYYY-MM-DD, puede cruzar meses) o, si no, el mes de `periodo`.
function periodoDeQuery(q: any): { start: Date; end: Date } | null {
  const iso = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
  const desde = iso(q?.desde);
  const hasta = iso(q?.hasta) ?? desde;
  if (desde && hasta) {
    const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
    const toUtc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
    return { start: toUtc(a), end: toUtc(b) };
  }
  return q?.periodo ? parsePeriodoMes(String(q.periodo)) : null;
}

// Población de Reconocimientos Médicos (Salud Laboral): becados = algún tramo en agentes con ley 6–13.
// ACTIVO = tramo becado vigente (se le puede asignar turno); BAJA = ex-becado (solo consulta).
// Mismas reglas que SaludLaboralPage (LEYES_BECADOS). Se exporta para validar los turnos.
export const LEYES_BECADOS = [6, 7, 8, 9, 10, 11, 12, 13];
export async function buscarBecados(
  sequelize: import('sequelize').Sequelize | undefined,
  dnis: string[],
): Promise<Map<string, 'ACTIVO' | 'BAJA'>> {
  const out = new Map<string, 'ACTIVO' | 'BAJA'>();
  const nums = [...new Set(dnis.map(d => Number(d)).filter(n => n > 0))];
  if (!sequelize || nums.length === 0) return out;
  try {
    const [rows] = await sequelize.query(
      `SELECT dni, MAX(estado_empleo = 'ACTIVO') AS activo
         FROM agentes
        WHERE dni IN (${nums.map(() => '?').join(',')})
          AND ley_id IN (${LEYES_BECADOS.join(',')})
          AND deleted_at IS NULL
        GROUP BY dni`,
      { replacements: nums },
    ) as [any[], unknown];
    for (const r of rows) out.set(normDni(String(r.dni)), Number(r.activo) === 1 ? 'ACTIVO' : 'BAJA');
  } catch (e: any) {
    logger.warn({ msg: 'asistencia: error consultando becados', error: e?.message });
  }
  return out;
}

// Licencias que dio la médica de Salud Laboral (grilla Reconocimientos → reconocimientos_medicos)
// para cada "dni|YYYY-MM-DD" de las filas. Si falla la consulta devuelve el mapa vacío.
type LicMedica = { id: number; desde: string; hasta: string | null; tipo: string | null; resultado: string | null };
async function buscarLicenciasMedicas(
  sequelize: import('sequelize').Sequelize | undefined,
  rows: Array<{ dni: string; fecha: string }>,
): Promise<Map<string, LicMedica>> {
  const out = new Map<string, LicMedica>();
  if (!sequelize || rows.length === 0) return out;
  try {
    const dnis = [...new Set(rows.map(r => r.dni))];
    const fechas = rows.map(r => r.fecha);
    const minF = fechas.reduce((a, b) => (a < b ? a : b));
    const maxF = fechas.reduce((a, b) => (a > b ? a : b));
    const [recRows] = await sequelize.query(
      `SELECT id, dni,
              DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS fecha_desde,
              DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
              tipo, resultado
         FROM reconocimientos_medicos
        WHERE dni IN (${dnis.map(() => '?').join(',')})
          AND deleted_at IS NULL
          AND fecha_desde <= ?
          AND (fecha_hasta >= ? OR fecha_hasta IS NULL)
        ORDER BY fecha_desde DESC, id DESC`,
      { replacements: [...dnis, maxF, minF] },
    ) as [any[], unknown];
    for (const rec of recRows) {
      const dniRec = normDni(String(rec.dni));
      const desde  = String(rec.fecha_desde ?? '').slice(0, 10);
      const hasta  = rec.fecha_hasta ? String(rec.fecha_hasta).slice(0, 10) : maxF;
      for (const row of rows) {
        if (row.dni !== dniRec || row.fecha < desde || row.fecha > hasta) continue;
        const key = `${row.dni}|${row.fecha}`;
        if (!out.has(key)) {
          out.set(key, {
            id: Number(rec.id), desde, hasta: rec.fecha_hasta ? hasta : null,
            tipo: String(rec.tipo ?? '').trim() || null,
            resultado: String(rec.resultado ?? '').trim() || null,
          });
        }
      }
    }
  } catch (e: any) {
    logger.warn({ msg: 'asistencia: error consultando reconocimientos_medicos', error: e?.message });
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

  router.get('/mapeo', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexión a DB');
      // el editor edita solo las reglas generales; las de CIE van aparte (pestaña "Por CIE")
      // para que "Guardar" nunca las convierta en generales
      const mapeo = await loadMapeoGeneral(sequelize);
      const reglasCie = await listReglasCie(sequelize);
      // combo completo de la Intranet (mig 074, lo mantiene el robot intranet_control_codigos):
      // así el editor ofrece también los códigos que nunca aparecieron en el Excel del Ministerio
      const [codigosMinisterio] = await sequelize
        .query(`SELECT codigo, novedad, vigente FROM ministerio_codigos ORDER BY novedad`)
        .catch(() => [[]] as any);
      // novedades que ofrece SiAPe (mig 076, robot siape_control_novedades), sin las que no
      // van al Ministerio: se suman a "SIAP sin mapear" aunque no estén en el Excel
      const [novedadesSiape] = await sequelize
        .query(
          `SELECT origen, novedad FROM siape_novedades_catalogo
            WHERE vigente = 1 AND no_va_al_ministerio = 0 ORDER BY novedad`,
        )
        .catch(() => [[]] as any);
      return res.json({ ok: true, mapeo, reglasCie, codigosMinisterio, novedadesSiape });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.put('/mapeo', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexión a DB');
      const mapeo = req.body?.mapeo;
      if (!mapeo || typeof mapeo !== 'object') {
        return res.status(400).json({ ok: false, error: 'Body inválido: { mapeo: {...} }' });
      }
      await saveMapeoTabla(sequelize, mapeo);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.delete('/mapeo', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexión a DB');
      await restaurarMapeoTabla(sequelize);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });


  // ── Reglas por CIE: ENFERMEDAD + CIE -> se carga como 1R / 1RC / ... ──
  router.get('/mapeo-cie', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      return res.json({ ok: true, reglas: await listReglasCie(sequelize) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.post('/mapeo-cie', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      const { novedad_siape, novedad_ministerio } = req.body || {};
      const raw = req.body?.cies;
      const cies: string[] = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\s]+/);
      const r = await addReglasCie(sequelize, novedad_siape, cies, novedad_ministerio);
      return res.json({ ok: true, ...r, reglas: await listReglasCie(sequelize) });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  router.delete('/mapeo-cie/:id', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      const ok = await bajaReglaCie(sequelize, Number(req.params.id));
      if (!ok) return res.status(404).json({ ok: false, error: 'Regla no encontrada' });
      return res.json({ ok: true, reglas: await listReglasCie(sequelize) });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // CIE que aparecen en LICENCIAS_MEDICAS.xlsx (export SIAPE) para una novedad,
  // con diagnostico y cantidad: ayuda para elegir cuales van como 1R / 1RC.
  router.get('/mapeo-cie/codigos', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      if (!XLSX_SJS) throw new Error('Falta dependencia "xlsx"');
      const dir = getDir();
      const lic = fs.readdirSync(dir).find(f => /\.xls[xm]?$/i.test(f) && !f.startsWith('~$') && /licencias?_?medicas/i.test(f));
      if (!lic) return res.json({ ok: true, archivo: null, codigos: [] });
      const nov = normNovedad(String(req.query.novedad || 'ENFERMEDAD'));
      const wb = XLSX_SJS.readFile(path.join(dir, lic), { cellDates: false });
      const rows: any[] = XLSX_SJS.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const agg = new Map<string, { codigo: string; diagnostico: string; cantidad: number }>();
      for (const r of rows) {
        if (normNovedad(String(r.NOVEDAD || '')) !== nov) continue;
        const codigo = normCie(r.CODIGO_OMS);
        if (!codigo || codigo === '66666666' || !/[A-Z0-9]/.test(codigo)) continue;
        const a = agg.get(codigo) || { codigo, diagnostico: String(r.DIAGNOSTICO || '').trim(), cantidad: 0 };
        a.cantidad++;
        if (!a.diagnostico && r.DIAGNOSTICO) a.diagnostico = String(r.DIAGNOSTICO).trim();
        agg.set(codigo, a);
      }
      const codigos = [...agg.values()].sort((a, b) => b.cantidad - a.cantidad);
      return res.json({ ok: true, archivo: lic, codigos });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // Nombres del catálogo CIE-10 (tabla cie_codigos, scripts/cargar_cie10.py).
  // ?codigos=C50,O20 → { C50: "...", O20: "...", "O20.0": "..." }: como normCie saca
  // el ".0" (O20.0 → O20), también se devuelve la variante X.0 si existe.
  router.get('/mapeo-cie/nombres', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      const { QueryTypes } = await import('sequelize');
      const pedidos = [...new Set(String(req.query.codigos || '').split(/[,;\s]+/).map(normCie).filter(Boolean))].slice(0, 500);
      if (!pedidos.length) return res.json({ ok: true, nombres: {} });
      const buscar = [...new Set(pedidos.flatMap(c => (c.includes('.') ? [c] : [c, `${c}.0`])))];
      const rows = await sequelize.query<{ codigo: string; descripcion: string }>(
        `SELECT codigo, descripcion FROM cie_codigos WHERE codigo IN (:buscar)`,
        { type: QueryTypes.SELECT, replacements: { buscar } },
      );
      const nombres: Record<string, string> = {};
      for (const r of rows) nombres[r.codigo] = r.descripcion;
      return res.json({ ok: true, nombres });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // Buscador del catálogo CIE-10 completo por código o texto: ?q=mama → [{codigo, descripcion, capitulo}]
  router.get('/mapeo-cie/catalogo', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      if (!sequelize) throw new Error('Sin conexion a DB');
      const { QueryTypes } = await import('sequelize');
      const q = String(req.query.q || '').trim().slice(0, 80);
      if (q.length < 2) return res.json({ ok: true, codigos: [] });
      const rows = await sequelize.query<any>(
        `SELECT codigo, descripcion, capitulo_nombre
           FROM cie_codigos
          WHERE codigo LIKE :pref OR descripcion LIKE :txt
          ORDER BY (codigo LIKE :pref) DESC, codigo
          LIMIT 100`,
        { type: QueryTypes.SELECT, replacements: { pref: `${q.toUpperCase()}%`, txt: `%${q}%` } },
      );
      return res.json({ ok: true, codigos: rows });
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
      const mapeo = await loadMapeo(sequelize);

      const skip: string[] = Array.isArray(req.body?.skipNovedades)
        ? req.body.skipNovedades
        : String(req.body?.skipNovedades || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      const skipFinal = skip.length ? skip : DEFAULT_SKIP_NOVEDADES;

      // ── Archivo SIAP ──────────────────────────────────────────────────────
      const siapFile = req.body?.siapFile ? resolveExcelPath(dir, req.body.siapFile) : auto.siap;
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
        const autoMinisterioName = files.find(f => f.fullPath === auto.ministerio)?.name ?? path.basename(auto.ministerio);
        ministerioFiles = [{ file: autoMinisterioName, upa: 'GENERAL' }];
      }

      if (ministerioFiles.length === 0) {
        return res.status(400).json({ ok: false, error: 'No se encontró ningún archivo MINISTERIO' });
      }

      // ── Parsear todos los ministerios en paralelo ─────────────────────────
      const ministerioMap: Record<string, any[]> = {};
      let totalMinisterioRows = 0;
      await Promise.all(
        ministerioFiles.map(async ({ file, upa }) => {
          const fp = resolveExcelPath(dir, file);
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
        const allMinRows = Object.entries(ministerioMap)
          .flatMap(([upa, rows]) => rows.map((r: any) => ({ ...r, upa })));
        comparado = compareRows(allMinRows, siapRows, mapeo, skipFinal);
      } else {
        // Itera el SIAP — qué tiene el SIAP y si coincide en Ministerio
        // 06/11/2026: comparador por diferencias concretas (el viejo compareRowsSiapVsMinisterio queda SIN USO)
        comparado = compararSiapVsMinisterioDetalle(siapRows, ministerioMap, mapeo, skipFinal);
        comparado = await precisarDniSinMinisterio(comparado, ministerioMap, mapeo, sequelize, dir);
      }

      const resultadoCarga = await loadResultadosCargaIndex();
      comparado = enriquecerConResultadoCarga(comparado, mapeo, resultadoCarga);
      comparado = await enriquecerConColaCarga(comparado, sequelize);
      // 06/11/2026: sin código de carga en el mapeo → el robot no la puede cargar (sin botón Cargar)
      if (sequelize) {
        try {
          const conCodigo = await novedadesConCodigoCarga(sequelize);
          comparado = comparado.map((r: any) => {
            const nov = String(r?.novedad_siap || '').trim();
            return nov && nov !== '—' && !conCodigo.has(normNovedadCarga(nov)) ? { ...r, sin_codigo_carga: true } : r;
          });
        } catch (err) { logger.warn({ msg: 'asistencia: no se pudo leer el mapeo de carga', err }); }
      }
      // 06/11/2026: se sacó el "OK porque el robot la cargó" (escondía diferencias, p.ej. cargas recortadas):
      // el estado sale solo de comparar SIAPE vs Ministerio; lo del robot queda en "Qué pasó en la carga".

      const comparadoCompleto = comparado;
      // Por defecto esta pantalla devuelve solo errores/inconsistencias.
      // Si alguna vez necesitás ver todo, mandá { soloErrores: false } desde el front.
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
            bajas:         comparadoCompleto.filter(r => r.estado === 'BAJA').length,
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
        ? resolveExcelPath(dir, String(req.query.ministerioFile))
        : auto.ministerio;
      if (!ministerioFile || !fs.existsSync(ministerioFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontró archivo MINISTERIO' });
      }

      const autoHorarios = files.find(f => f.name.toLowerCase().includes('horario'));
      const horariosFile = req.query.horariosFile
        ? resolveExcelPath(dir, String(req.query.horariosFile))
        : autoHorarios?.fullPath ?? null;

      // ── Periodo ─────────────────────────────────────────────────────────────
      const period = periodoDeQuery(req.query);

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

      // ── 3. Expandir rangos a días individuales ───────────────────────────────
      // DOW (getUTCDay): 0=dom, 1=lun, 2=mar, 3=mie, 4=jue, 5=vie, 6=sab
      const DOW_KEYS: (keyof HorarioDia)[] = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
      const DOW_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

      // ── 3b. Leer SIAP (opcional) → mapa DNI → rangos con novedad ───────────────
      const autoSiap = files.find(f => f.name.toLowerCase().includes('siap'));
      const siapFile = req.query.siapFile
        ? resolveExcelPath(dir, String(req.query.siapFile))
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
      // licMedicaMap: "dni|YYYY-MM-DD" → licencia que dio la médica (grilla Reconocimientos de Salud Laboral)
      const licMedicaMap = await buscarLicenciasMedicas(sequelize, expanded);
      const becadosMap   = await buscarBecados(sequelize, expanded.map(r => r.dni));

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
          recMedico:         licMedicaMap.has(recKey) ? (licMedicaMap.get(recKey)!.tipo || 'Sí') : null,
          licMedica:         licMedicaMap.get(recKey) ?? null,
          becado:            becadosMap.get(r.dni) ?? null,
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
        ? resolveExcelPath(dir, String(req.query.siapFile))
        : auto.siap ?? null;
      if (!siapFilePath || !fs.existsSync(siapFilePath)) {
        return res.status(400).json({ ok: false, error: 'No se encontró archivo SIAP' });
      }

      const ministerioFilePath = req.query.ministerioFile
        ? resolveExcelPath(dir, String(req.query.ministerioFile))
        : auto.ministerio ?? null;

      const autoHorarios2 = files.find(f => f.name.toLowerCase().includes('horario'));
      const horariosFilePath = req.query.horariosFile
        ? resolveExcelPath(dir, String(req.query.horariosFile))
        : autoHorarios2?.fullPath ?? null;

      const period = periodoDeQuery(req.query);

      // tipo: 'ausente' (default) → novedades AUSENTE (comportamiento histórico).
      //       'presente'          → días marcados PRESENTE por el jefe en SIAPE.
      // El resto del pipeline (expandir a días + cruce con reloj) es idéntico:
      // solo cambia qué novedades del SIAP se conservan.
      const tipo = String(req.query.tipo || 'ausente').toLowerCase() === 'presente'
        ? 'presente'
        : 'ausente';

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

      // Filtrar según tipo. "PRESENTE CON RETENCION DE TAREAS" también cuenta
      // como presente (contiene 'PRESENTE').
      const palabraFiltro = tipo === 'presente' ? 'PRESENTE' : 'AUSENTE';
      siapRaw = siapRaw.filter((r: any) => normNovedad(r.novedad).includes(palabraFiltro));

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
          const wb2 = await loadWorkbook(horariosFilePath);
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

      const licMedicaMap2 = await buscarLicenciasMedicas(sequelize, expanded2);
      const becadosMap2   = await buscarBecados(sequelize, expanded2.map(r => r.dni));
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
          licMedica:         licMedicaMap2.get(`${r.dni}|${r.fecha}`) ?? null,
          becado:            becadosMap2.get(r.dni) ?? null,
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
        ? resolveExcelPath(dir, String(req.query.siapFile)) : auto.siap ?? null;
      const ministerioFilePath = req.query.ministerioFile
        ? resolveExcelPath(dir, String(req.query.ministerioFile)) : auto.ministerio ?? null;

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
      const horarioSemanal: { dow: number; entrada: string | null; salida: string | null; controlable: boolean }[] = [];
      const horariosFilePath2 = req.query.horariosFile
        ? resolveExcelPath(dir, String(req.query.horariosFile))
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
          const colSal  = DOW_HOR_KEYS.map(d => hdrH[`${d}_salida`]        ?? 0);
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
              const sal  = colSal[dow]  ? parseHoraH(r.getCell(colSal[dow])?.value)  : null;
              horarioPorDow[dow] = hora ?? (ctrl ? 'Sí' : null);
              if (hora || sal || ctrl) horarioSemanal.push({ dow, entrada: hora, salida: sal, controlable: ctrl });
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

      return res.json({ ok: true, dni, nombre, periodo: req.query.periodo, data, horarioSemanal, dbError: dbErr });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // ── GET /presentes-turno ─────────────────────────────────────────────────
  // Para una fecha y servicio: arma esperados desde horarios, cruza fichadas
  // biométricas y muestra justificación SIAP/Ministerio para quienes no ficharon.
  router.get('/presentes-turno', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs' });
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexión a DB principal' });

    try {
      const servicioId = req.query.servicio_id ? Number(req.query.servicio_id) : null;
      if (!servicioId) return res.status(400).json({ ok: false, error: 'Falta servicio_id' });

      const fecha = String(req.query.fecha ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ ok: false, error: 'Falta fecha válida (YYYY-MM-DD)' });
      }

      const dir = getDir();
      const files = listExcelFiles(dir);
      const auto = findAutoFiles(files);

      const horariosFile = req.query.horariosFile
        ? resolveExcelPath(dir, String(req.query.horariosFile))
        : auto.horarios ?? null;
      if (!horariosFile || !fs.existsSync(horariosFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontró el archivo de horarios' });
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
      if (!ws) return res.status(400).json({ ok: false, error: 'Archivo de horarios vacío' });

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
          dbError = e?.message || 'No se pudo leer biométrico';
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

      // Siempre HORARIOS.xlsx (horario completo del día), igual que Sin fichaje salida
      const horariosFile = fs.existsSync(path.join(dir, HORARIOS_ARCHIVO)) ? path.join(dir, HORARIOS_ARCHIVO) : null;

      const siapFile = req.query.siapFile
        ? resolveExcelPath(dir, String(req.query.siapFile))
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
        ? resolveExcelPath(dir, String(req.query.ministerioFile))
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

      // ── 7. Helpers y días del mes ──────────────────────────────────────────
      const toMins = (hhmm: string): number => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };
      const minsHoras = (ent: string, sal: string): number => {
        if (ent === sal) return 1440; // turno 24hs: entra y sale a la misma hora del día siguiente
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
      const DOW_LABELS_RS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

      // ── 6. Fichajes + evaluación por turno (mismo criterio que Sin fichaje salida) ──
      // Guardia = sale al día siguiente; cada marca es de un solo turno; tolerancia 30 min
      // (entrar antes no es falta); semana alternada A/B deducida de los fichajes.
      const evalRS: Record<string, EvalAgente> = {};
      let dbError: string | null = null;
      const fichRS = await leerFichadas(dniList, allDias[0], allDias[allDias.length - 1]);
      if ('error' in fichRS) dbError = fichRS.error;
      else {
        for (const dni of dniList) {
          const horAg = horariosMap[dni];
          if (!horAg) continue;
          const diasEv: Record<string, { e: string; s: string }> = {};
          for (const [k, h] of Object.entries(horAg.dias)) if (h.controlable && h.entrada && h.salida) diasEv[k] = { e: h.entrada, s: h.salida };
          evalRS[dni] = evaluarAgente(diasEv, fichRS.punches[dni] || [], fichRS.lector, allDias);
        }
      }

      // ── 8. Construir reporte por agente ────────────────────────────────────
      const agentes = agentesDb.map(ag => {
        const dni3 = normDni(ag.dni);
        const horAg = horariosMap[dni3] ?? null;

        let hTeoricoMes = 0, hRealMes = 0, diasLab = 0, diasFeriado = 0;
        let diasConFichaje = 0, diasSinFichaje = 0, diasConNovedad = 0, diasSinSalida = 0, diasCumplio = 0, diasInvertido = 0, diasFueraHorario = 0;
        const semanas: Record<string, { teorico: number; real: number; laboral: number }> = {};

        const diasDetalle = allDias.map(fecha => {
          const dow = new Date(fecha + 'T00:00:00Z').getUTCDay();
          const dowKey = DOW_KEYS_RS[dow] as string;
          const diaSemana = DOW_LABELS_RS[dow];
          const esFeriado = feriadoSet.has(fecha);
          const feriadoNombre = esFeriado ? (feriadosDb.find(f => f.fecha === fecha)?.nombre ?? '') : null;

          const horDia = horAg?.dias[dowKey] ?? null;
          const evAg = evalRS[dni3];
          // semana alternada: el día está cargado pero esa semana no le toca
          const debiaTrabajo = !esFeriado && (horDia?.controlable ?? false) && !evAg?.noToca.includes(fecha);

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

          // Turno evaluado (sinSalidaEval): entrada/salida ya asignadas al turno que corresponde,
          // aunque la salida sea al día siguiente.
          const tEv = evAg?.turnos.find(x => x.fecha === fecha) ?? null;
          let fich: { entrada: string|null; salida: string|null; invertido: boolean; llegadaTarde: boolean; minutosRetraso: number } | null = null;
          if (tEv && tEv.estado !== 'SIN_FICHAJE') {
            const minTarde = tEv.entradaTs != null && tEv.entradaTs > tEv.progEntTs + 30 * 60000
              ? Math.round((tEv.entradaTs - tEv.progEntTs) / 60000) : 0;
            fich = {
              entrada: tEv.entrada, salida: tEv.estado === 'SIN_SALIDA' ? null : tEv.salida,
              invertido: tEv.estado === 'MAL_FICHADO', llegadaTarde: minTarde > 0, minutosRetraso: minTarde,
            };
          }

          const horasReales = tEv?.entradaTs != null && tEv?.salidaTs != null && tEv.estado !== 'SIN_SALIDA'
            ? toHs((tEv.salidaTs - tEv.entradaTs) / 60000) : 0;
          const cumplioHoras = debiaTrabajo && horasTeoricas > 0 && horasReales >= horasTeoricas * 0.9;
          if (cumplioHoras) diasCumplio++;
          if (fich) {
            diasConFichaje++;
            hRealMes += horasReales;
            semanas[semKey].real += horasReales;
            if (fich.entrada && !fich.salida) diasSinSalida++;
            if (fich.invertido) diasInvertido++;
            if (tEv?.estado === 'FUERA_HORARIO') diasFueraHorario++;
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
            // criterio de control: OK | FUERA_HORARIO | MAL_FICHADO | SIN_SALIDA | REVISAR_HORARIO | SOLO_SALIDA | SIN_FICHAJE
            estadoTurno:     tEv?.estado ?? null,
            motivos:         tEv?.motivos ?? [],
            enCurso:         !!evAg?.enCurso.includes(fecha),
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
            diasFueraHorario,
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

  // ─── GET /asistencia/cruce-horarios ─────────────────────────────────────────
  // Cruza el archivo de horarios (entrada/salida por día) con el servicio vigente
  // y la ley de revista de la BD. Clasifica cada día en turno mañana/tarde/noche/24hs
  // (nocturno = salida < entrada, 24hs = salida == entrada) y marca franqueros
  // (solo trabajan sábado/domingo).
  router.get('/cruce-horarios', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs' });
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexión a DB principal' });
    try {
      const dir = getDir();
      const files = listExcelFiles(dir);
      const horariosFile = req.query.horariosFile
        ? resolveExcelPath(dir, String(req.query.horariosFile))
        : files.find(f => f.name.toLowerCase().includes('horario'))?.fullPath ?? null;
      if (!horariosFile || !fs.existsSync(horariosFile)) {
        return res.status(400).json({ ok: false, error: 'No se encontró el archivo de horarios' });
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

      // ── 1. Parsear horarios.xlsx completo ──────────────────────────────────
      const wb = await loadWorkbook(horariosFile);
      const ws = wb.worksheets[0];
      if (!ws) return res.status(400).json({ ok: false, error: 'Archivo de horarios vacío' });

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

      // ── 2. Enriquecer desde la BD: servicio vigente + ley + planta ─────────
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
                 rep.id    AS reparticion_id,
                 rep.reparticion_nombre AS reparticion_nombre,
                 dep.id    AS dependencia_id,
                 dep.nombre AS dependencia_nombre
          FROM personal p
          JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
          LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
          LEFT JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
          LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
          LEFT JOIN (
            SELECT ags1.dni, ags1.servicio_id
            FROM agentes_servicios ags1
            JOIN (
              SELECT dni, MAX(id) AS max_id
              FROM agentes_servicios
              WHERE deleted_at IS NULL AND fecha_hasta IS NULL
              GROUP BY dni
            ) ult ON ult.max_id = ags1.id
          ) vig ON vig.dni = p.dni
          LEFT JOIN servicios srv ON srv.id = vig.servicio_id AND srv.deleted_at IS NULL
          LEFT JOIN reparticiones rep ON rep.id = srv.reparticion_id AND rep.deleted_at IS NULL
          LEFT JOIN dependencias dep ON dep.id = rep.dependencia_id AND dep.deleted_at IS NULL
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
          reparticion_id: db?.reparticion_id ?? null,
          reparticion_nombre: db?.reparticion_nombre ?? null,
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

  // ─── HISTORIAL DE LICENCIAS (tabla `historial`, migraciones 032/033) ─────────
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

  // GET /asistencia/historial-analisis → todos los agregados para el tablero
  router.get('/historial-analisis', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexión a DB principal' });
    try {
      const { QueryTypes } = await import('sequelize');
      const { where, repl } = historialWhere(req.query);
      // días de cada licencia = hasta - desde + 1 (mínimo 1)
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
        // GROUP BY columna cruda (sin IFNULL) para que el índice cubridor (035)
        // agrupe solo, sin tabla temporal; el NULL se traduce a '(sin dato)'
        // abajo. FORCE INDEX porque el optimizador no lo elige solo (medido:
        // 2-4× más rápido); con búsqueda por apellido (txtQ, columna fuera del
        // índice) forzarlo obligaría a 1M de lookups → se deja al optimizador.
        Q(`SELECT novedad AS valor, ${SEL} FROM historial WHERE ${where} GROUP BY novedad ORDER BY licencias DESC`),
        Q(`SELECT dependencia AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__dep)'} WHERE ${where} GROUP BY dependencia ORDER BY licencias DESC`),
        Q(`SELECT agrupamiento AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__agrup)'} WHERE ${where} GROUP BY agrupamiento ORDER BY licencias DESC`),
        Q(`SELECT regimen_estatutario AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__regimen)'} WHERE ${where} GROUP BY regimen_estatutario ORDER BY licencias DESC`),
        Q(`SELECT planta AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__planta)'} WHERE ${where} GROUP BY planta ORDER BY licencias DESC`),
        Q(`SELECT justificado AS valor, ${SEL} FROM historial ${repl.txtQ ? '' : 'FORCE INDEX (ix_historial__justif)'} WHERE ${where} GROUP BY justificado ORDER BY licencias DESC`),
        // agregamos por dni sobre el índice y recién ahí buscamos el nombre (25 filas)
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
        // años disponibles SIN filtros, para que el selector no se achique solo
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

  // GET /asistencia/historial-detalle → filas crudas paginadas (mismos filtros)
  router.get('/historial-detalle', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexión a DB principal' });
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

  // GET /asistencia/historial-excesos → control de topes: agentes que acumulan
  // minDias o más días del mismo tipo de licencia en un mismo año (con los
  // mismos filtros del tablero: régimen BECARIOS + tipo X + minDias=12 responde
  // "¿qué becarios se tomaron más de 12 días de X?").
  router.get('/historial-excesos', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!sequelize) return res.status(500).json({ ok: false, error: 'Sin conexión a DB principal' });
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

  // ── LICENCIAS PDF ─────────────────────────────────────────────────────────────

  // GET /asistencia/licencias-pdf/archivos → lista los PDFs en LICENCIAS_PDF_DIR
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

  // GET /asistencia/licencias-pdf/comparar → corre la comparación
  router.get('/licencias-pdf/comparar', requirePermission('api:access'), async (_req: Request, res: Response) => {
    try {
      const dir = env.LICENCIAS_PDF_DIR;
      if (!dir || !fs.existsSync(dir)) {
        return res.status(400).json({ ok: false, error: 'LICENCIAS_PDF_DIR no configurado o no existe' });
      }

      const mapeo = await loadMapeo(sequelize);

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
