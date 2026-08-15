import fs from 'fs';
import type { Dirent } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { cacheInvalidateTags } from '../infra/cache';
import { extractTextFromImage } from '../services/ocr.service';

const dynamicImport: (s: string) => Promise<any> = new Function('s', 'return import(s)') as any;

const TRAMITES = [
  { value: 'RENOVACION', label: 'Renovacion' },
  { value: 'DESIGNACION', label: 'Designacion' },
  { value: 'NOMBRAMIENTO', label: 'Nombramiento' },
] as const;

const POBLACIONES = [
  { value: 'BECARIOS', label: 'Becarios' },
  { value: 'INTERINOS_10430', label: 'Interinos Ley 10430' },
] as const;

type AgentHit = {
  dni: number;
  apellido: string;
  nombre: string;
  cuil: string | null;
};

type PdfAnalysisRow = {
  fileName: string;
  fileUrl: string;
  bytes: number;
  pages: number;
  detectedDni: number | null;
  agente: AgentHit | null;
  candidates: number[];
  status: 'detectado' | 'sin_agente' | 'ambiguedad' | 'sin_texto' | 'error';
  reason: string | null;
  lectura: 'texto' | 'ocr' | 'sin_texto';
  pageTitles: string[];
  pageSubOrder: number[];
};

type SaveFileInput = {
  fileName: string;
  dni: number | string;
  include?: boolean;
  expediente?: string | null;
  pageOrder?: string | null;
};

type DocumentOrderInput = {
  kind: 'caratula' | 'file' | 'rupa';
  fileName: string | null;
  pageOrder: string | null;
};

type MergeFileInput = {
  fileName: string;
  dni: number;
  expediente: string | null;
  pageOrder: string | null;
};

type ExtraDocsOptions = {
  includeCaratula: boolean;
  includeRupa: boolean;
  rupaSourceMode: 'docu' | 'descargas' | 'custom';
  rupaDir: string | null;
};

type PreloadAgentRow = {
  dni: number;
  apellidoNombre: string;
  fechaIngresoExcel: string | null;
  expediente: string;
  incluido: boolean;
  leyNombre: string | null;
  plantaNombre: string | null;
  ocupacionNombre: string | null;
  ocupacionLey: string | null;
  tipoBeca: string | null;
  dependenciaNombre: string | null;
};

type SavedListadoRow = {
  id: string;
  name: string;
  createdAt: string;
  poblacion: string;
  tramite: string;
  anioBeca: string;
  programaBeca: string;
  dependenciaId: string;
  expedienteModo: 'unico' | 'individual';
  expedienteUnico: string;
  rows: Array<Record<string, unknown>>;
  savedBy?: number | null;
};

type BecaTipo = {
  value: string;
  label: string;
  total: number;
};

type DependenciaOption = {
  value: string;
  label: string;
  total: number;
};

function dependenciaWhereSql(alias = 'd.id') {
  return `EXISTS (
    SELECT 1
    FROM agentes_servicios ags_dep
    LEFT JOIN servicios s_dep ON s_dep.id = ags_dep.servicio_id AND s_dep.deleted_at IS NULL
    LEFT JOIN reparticiones r_dep ON r_dep.id = s_dep.reparticion_id AND r_dep.deleted_at IS NULL
    WHERE ags_dep.dni = p.dni
      AND ags_dep.deleted_at IS NULL
      AND (ags_dep.fecha_hasta IS NULL OR ags_dep.fecha_hasta >= CURDATE())
      AND COALESCE(r_dep.dependencia_id, ags_dep.dependencia_id) = ${alias}
  )`;
}

function getInputDir() {
  return String(env.TRAMITES_PDF_INPUT_DIR || '').trim();
}

function getDocuBaseDir() {
  return String(env.TRAMITES_DOCU_BASE_DIR || '').trim();
}

function getListadosStorePath() {
  const base = getDocuBaseDir() || String(env.DOCUMENTS_BASE_DIR || '').trim() || process.cwd();
  return path.join(base, '.personalv5', 'tramites-documentales-listados.json');
}

function readSavedListados(): SavedListadoRow[] {
  const filePath = getListadosStorePath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch (err: any) {
    logger.warn({ msg: '[tramites] no se pudieron leer listados seteados', filePath, error: err?.message });
    return [];
  }
}

function writeSavedListados(rows: SavedListadoRow[]) {
  const filePath = getListadosStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}

// Un listado se considera "el mismo" por su combinación de población/trámite/año/programa/dependencia
// (no por fecha ni id). Sirve para actualizar en lugar de acumular duplicados.
function listadoIdentity(l: Pick<SavedListadoRow, 'poblacion' | 'tramite' | 'anioBeca' | 'programaBeca' | 'dependenciaId'>): string {
  return [l.poblacion, l.tramite, l.anioBeca, l.programaBeca, l.dependenciaId]
    .map((v) => String(v ?? '').trim().toUpperCase())
    .join('|');
}

// Deja un solo listado por identidad: el más nuevo (por createdAt). Ordenado desc.
function dedupSavedListados(rows: SavedListadoRow[]): SavedListadoRow[] {
  const sorted = [...rows].sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  const seen = new Set<string>();
  const out: SavedListadoRow[] = [];
  for (const row of sorted) {
    const key = listadoIdentity(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function cleanSavedListado(raw: any, actor: number | null): SavedListadoRow {
  const rows = Array.isArray(raw?.rows) ? raw.rows.slice(0, 500) : [];
  return {
    id: String(raw?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name: String(raw?.name || 'Listado seteado').trim().slice(0, 220) || 'Listado seteado',
    createdAt: raw?.createdAt && !Number.isNaN(Date.parse(String(raw.createdAt)))
      ? String(raw.createdAt)
      : new Date().toISOString(),
    poblacion: String(raw?.poblacion || 'BECARIOS'),
    tramite: String(raw?.tramite || 'DESIGNACION'),
    anioBeca: String(raw?.anioBeca || ''),
    programaBeca: String(raw?.programaBeca || 'TODAS'),
    dependenciaId: String(raw?.dependenciaId || 'TODAS'),
    expedienteModo: raw?.expedienteModo === 'individual' ? 'individual' : 'unico',
    expedienteUnico: String(raw?.expedienteUnico || ''),
    rows,
    savedBy: actor,
  };
}

// ¿Es una plantilla de caratula (caratula<estab><ley>.pdf)? Se excluye del analisis de documentos.
function isCaratulaTemplateName(name: string): boolean {
  return normalizeSearch(name).replace(/[^a-z0-9]/g, '').startsWith('caratula');
}

function listPdfFiles(inputDir: string): string[] {
  if (!inputDir || !fs.existsSync(inputDir)) return [];

  const base = path.resolve(inputDir);
  const found: string[] = [];
  const stack = [base];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        // Las plantillas de caratula (caratulahtal10430.pdf, etc.) viven en Descargas pero NO son
        // documentos de agente: no se deben analizar/combinar como tales.
        if (isCaratulaTemplateName(entry.name)) continue;
        found.push(path.relative(base, fullPath).replace(/\\/g, '/'));
      }
    }
  }

  return found.sort((a, b) => a.localeCompare(b, 'es'));
}

function resolveInputPdf(fileName: string): string {
  const inputDir = getInputDir();
  const relativeName = String(fileName || '').replace(/\\/g, '/').trim();
  if (!relativeName || path.isAbsolute(relativeName) || relativeName.includes('\0') || !relativeName.toLowerCase().endsWith('.pdf')) {
    throw Object.assign(new Error('Archivo invalido'), { status: 400 });
  }

  const base = path.resolve(inputDir);
  const fullPath = path.resolve(base, relativeName);
  const rel = path.relative(base, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Archivo fuera de carpeta permitida'), { status: 400 });
  }
  if (!fs.existsSync(fullPath)) {
    throw Object.assign(new Error('Archivo no encontrado'), { status: 404 });
  }
  return fullPath;
}

function sanitizeTramite(value: string): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!TRAMITES.some((t) => t.value === raw)) {
    throw Object.assign(new Error('Tramite invalido'), { status: 400 });
  }
  return raw;
}

function parseDni(value: number | string): number | null {
  const dni = Number(String(value || '').replace(/\D/g, ''));
  return Number.isInteger(dni) && dni > 0 ? dni : null;
}

function safeFilename(name: string): string {
  return path.basename(String(name || 'archivo.pdf'))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim() || 'archivo.pdf';
}

function uniquePath(dir: string, filename: string): string {
  const clean = safeFilename(filename);
  const ext = path.extname(clean);
  const base = path.basename(clean, ext);
  let candidate = path.join(dir, clean);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${i}${ext}`);
    i += 1;
  }
  return candidate;
}

function normalizeSearch(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function listPdfPathsRecursive(rootDir: string, maxFiles = 600): string[] {
  const base = path.resolve(rootDir);
  if (!base || !fs.existsSync(base)) return [];

  const found: string[] = [];
  const stack = [base];
  while (stack.length && found.length < maxFiles) {
    const current = stack.pop();
    if (!current) continue;
    let entries: Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        found.push(fullPath);
        if (found.length >= maxFiles) break;
      }
    }
  }

  return found.sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'es'));
}

function findNamedPdf(rootDir: string, namePart: string, dni?: number, exactName = false): string | null {
  const normalizedName = normalizeSearch(namePart);
  const dniText = dni ? String(dni) : '';
  const pdfs = listPdfPathsRecursive(rootDir);
  const exactMatches = pdfs.filter((fullPath) => {
    const normalizedStem = normalizeSearch(path.basename(fullPath, path.extname(fullPath)));
    return normalizedStem === normalizedName;
  });
  if (exactMatches.length) return exactMatches[0];
  if (exactName) return null;

  const matches = pdfs.filter((fullPath) => {
    const normalizedBase = normalizeSearch(path.basename(fullPath));
    return normalizedBase.includes(normalizedName);
  });
  if (!matches.length) return null;

  if (dniText) {
    const byDni = matches.find((fullPath) => normalizeSearch(path.basename(fullPath)).includes(dniText));
    if (byDni) return byDni;
  }

  return matches[0];
}

type EstablecimientoToken = 'htal' | 'upa18' | 'upa4';
type CaratulaInfo = { estab: EstablecimientoToken; ley: '10430' | '10471'; dependenciaNombre: string | null };
type CaratulaHit = { path: string; verificado: boolean; key: string };

// La dependencia del agente define el establecimiento de la caratula:
//   "UPA 18" -> upa18 ; "UPA 4" -> upa4 ; cualquier otra (HIGA/EVITA) -> htal
function establecimientoToken(dependenciaNombre: string | null): EstablecimientoToken {
  const norm = normalizeSearch(dependenciaNombre || '');
  if (/upa\D{0,6}18/.test(norm)) return 'upa18';
  if (/upa\D{0,6}4(?!\d)/.test(norm)) return 'upa4';
  return 'htal';
}

function findRupaPdf(dni: number, opts: ExtraDocsOptions): string | null {
  const mode = opts.rupaSourceMode || 'docu';
  let searchDir = '';
  if (mode === 'custom') {
    const customDir = String(opts.rupaDir || '').trim();
    if (!customDir) return null;
    if (fs.existsSync(customDir) && fs.statSync(customDir).isFile() && customDir.toLowerCase().endsWith('.pdf')) {
      return customDir;
    }
    const byDniDir = path.join(customDir, String(dni));
    searchDir = fs.existsSync(byDniDir) ? byDniDir : customDir;
  } else if (mode === 'descargas') {
    searchDir = getInputDir();
  } else {
    searchDir = path.join(getDocuBaseDir(), String(dni));
  }

  if (!searchDir || !fs.existsSync(searchDir)) return null;
  return findNamedPdf(searchDir, 'rupa', dni);
}

type AgenteIdentidad = { dni: number; apellido: string; nombre: string };

async function agenteIdentidad(sequelize: Sequelize, dni: number): Promise<AgenteIdentidad | null> {
  try {
    const rows = await sequelize.query<AgenteIdentidad>(
      `SELECT dni, apellido, nombre FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT }
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

// ¿El texto del PDF corresponde a este agente? Por CUIL/DNI o por apellido + nombre.
function contenidoMatcheaAgente(text: string, ident: AgenteIdentidad): boolean {
  if (collectDniCandidates(text).includes(ident.dni)) return true;
  const norm = normalizeSearch(text);
  const ap = normalizeSearch(ident.apellido);
  const no = normalizeSearch(ident.nombre);
  return Boolean(ap && no && norm.includes(ap) && norm.includes(no));
}

// path = archivo RUPA; verificado = si el contenido (CUIL o apellido+nombre) confirmó que es del agente.
type RupaHit = { path: string; verificado: boolean };

// Busca el RUPA en la carpeta del agente (modo docu). Convención: el RUPA dice "rupa" en el nombre.
// Lee el contenido (texto y, si hace falta, OCR) para confirmar que es del agente por CUIL o
// apellido+nombre. Si no se puede leer/confirmar, devuelve el archivo "rupa" pero marcado
// verificado=false (para que el front lo muestre como "a revisar", no como confirmado).
async function findRupaPdfByContent(sequelize: Sequelize, dni: number, opts: ExtraDocsOptions): Promise<RupaHit | null> {
  const mode = opts.rupaSourceMode || 'docu';
  if (mode !== 'docu') {
    const p = findRupaPdf(dni, opts);
    return p ? { path: p, verificado: true } : null;
  }

  const searchDir = path.join(getDocuBaseDir(), String(dni));
  if (!searchDir || !fs.existsSync(searchDir)) return null;

  const candidatos = listPdfPathsRecursive(searchDir).filter((fp) => /rupa/i.test(path.basename(fp)));
  if (!candidatos.length) return null;

  const ident = await agenteIdentidad(sequelize, dni);

  for (const fp of candidatos) {
    let text = '';
    try {
      text = (await extractPdfText(fp)).text || '';
      if (!text.trim() && env.TRAMITES_PDF_OCR_ENABLE) {
        text = (await withTimeout(extractPdfTextWithOcr(fp), OCR_TIMEOUT_MS, `OCR RUPA ${path.basename(fp)}`)).text || '';
      }
    } catch {
      text = '';
    }
    if (ident && text.trim() && contenidoMatcheaAgente(text, ident)) {
      return { path: fp, verificado: true };
    }
  }

  // No se pudo confirmar por contenido: hay un archivo "rupa" pero queda a revisar.
  return { path: candidatos[0], verificado: false };
}

// Resuelve establecimiento (dependencia) + ley (ocupacion) del agente por DNI, con la misma
// logica de resolucion de dependencia que usa la precarga (directa o via servicios).
async function agenteCaratulaInfo(sequelize: Sequelize, dni: number): Promise<CaratulaInfo | null> {
  try {
    const rows = await sequelize.query<{ dependenciaNombre: string | null; ocupacionLey: string | null }>(
      `
        SELECT
          (
            SELECT dep_serv.nombre
            FROM agentes_servicios ags_serv
            LEFT JOIN servicios s_serv ON s_serv.id = ags_serv.servicio_id AND s_serv.deleted_at IS NULL
            LEFT JOIN reparticiones r_serv ON r_serv.id = s_serv.reparticion_id AND r_serv.deleted_at IS NULL
            LEFT JOIN dependencias dep_serv ON dep_serv.id = COALESCE(r_serv.dependencia_id, ags_serv.dependencia_id) AND dep_serv.deleted_at IS NULL
            WHERE ags_serv.dni = p.dni
              AND ags_serv.deleted_at IS NULL
              AND (ags_serv.fecha_hasta IS NULL OR ags_serv.fecha_hasta >= CURDATE())
            ORDER BY ags_serv.fecha_desde DESC, ags_serv.id DESC
            LIMIT 1
          ) AS dependenciaNombre,
          CASE
            WHEN ocl.nombre LIKE '%10471%' THEN '10471'
            WHEN ocl.nombre LIKE '%10430%' THEN '10430'
            ELSE NULL
          END AS ocupacionLey
        FROM personal p
        JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
        LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
        LEFT JOIN ley ocl ON ocl.id = oc.ley_id AND ocl.deleted_at IS NULL
        WHERE p.dni = :dni AND p.deleted_at IS NULL
        LIMIT 1
      `,
      { replacements: { dni }, type: QueryTypes.SELECT }
    );
    const row = rows[0];
    if (!row) return null;
    return {
      estab: establecimientoToken(row.dependenciaNombre),
      ley: row.ocupacionLey === '10471' ? '10471' : '10430',
      dependenciaNombre: row.dependenciaNombre,
    };
  } catch {
    return null;
  }
}

// ¿El contenido de la caratula corresponde al establecimiento + ley esperados?
// Se compacta el texto (sin espacios/puntos/simbolos) para tolerar "U.P.A. N° 18", "Ley N° 10.430", etc.
function caratulaContenidoOk(text: string, info: CaratulaInfo): boolean {
  const compact = normalizeSearch(text).replace(/[^a-z0-9]/g, '');
  const leyOk = compact.includes(info.ley);
  const estabOk =
    info.estab === 'upa18' ? /upa\D{0,4}18/.test(compact)
    : info.estab === 'upa4' ? /upa\D{0,4}4(?!\d)/.test(compact)
    : /evita|higa|hospital/.test(compact);
  return leyOk && estabOk;
}

// Elige la caratula por establecimiento+ley del agente: caratula<estab><ley>.pdf en Descargas
// (p.ej. caratulahtal10430). Verifica por contenido (texto/OCR) que sea la correcta; si no se
// puede confirmar, devuelve el archivo igual pero verificado=false (para mostrar "a revisar").
async function findCaratulaPdfByAgent(sequelize: Sequelize, dni: number): Promise<CaratulaHit | null> {
  const info = await agenteCaratulaInfo(sequelize, dni);
  if (!info) return null;
  const key = `caratula${info.estab}${info.ley}`; // ya compacto, ej "caratulahtal10430"
  const inputDir = getInputDir();
  if (!inputDir || !fs.existsSync(inputDir)) return null;

  // Match tolerante: compacta el nombre del archivo (sin espacios/puntos/mayus) para aceptar
  // "caratulahtal10430.pdf", "Caratula HTAL 10430.pdf", "caratulahtal 10471.pdf", etc.
  const candidatos = listPdfPathsRecursive(inputDir).map((fp) => ({
    fp,
    stem: normalizeSearch(path.basename(fp, path.extname(fp))).replace(/[^a-z0-9]/g, ''),
  }));
  const found = (candidatos.find((c) => c.stem === key) || candidatos.find((c) => c.stem.includes(key)))?.fp || null;
  if (!found) return null;

  // La caratula ya se eligio por establecimiento+ley (base) + nombre de archivo. El "control" solo
  // lee la CAPA DE TEXTO (rapido, sin canvas ni OCR — el OCR de estas plantillas escaneadas colgaba
  // 60s por agente). Si no hay texto, se confia en la seleccion; solo se marca "a revisar" si hay
  // texto y CONTRADICE el establecimiento/ley esperado.
  const text = await caratulaTextCached(found);
  const verificado = !text.trim() ? true : caratulaContenidoOk(text, info);
  return { path: found, verificado, key };
}

// Lee la capa de texto de una caratula, cacheada por archivo (mtime+size). La plantilla es la misma
// para todos los agentes del mismo estab/ley, asi que se lee a lo sumo una vez.
const caratulaTextCache = new Map<string, { mtimeMs: number; size: number; text: string }>();
async function caratulaTextCached(fp: string): Promise<string> {
  try {
    const stat = fs.statSync(fp);
    const cached = caratulaTextCache.get(fp);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.text;
    let text = '';
    try {
      text = (await extractPdfText(fp)).text || '';
    } catch {
      text = '';
    }
    caratulaTextCache.set(fp, { mtimeMs: stat.mtimeMs, size: stat.size, text });
    return text;
  } catch {
    return '';
  }
}

async function pdfMeta(fullPath: string) {
  const stat = fs.statSync(fullPath);
  const pdf = await PDFDocument.load(fs.readFileSync(fullPath));
  return {
    fileName: path.basename(fullPath),
    bytes: stat.size,
    pages: pdf.getPageCount(),
  };
}

function pageIndexesFromOrder(rawOrder: string | null | undefined, totalPages: number): number[] {
  const raw = String(rawOrder || '').trim();
  if (!raw) return Array.from({ length: totalPages }, (_, index) => index);

  const indexes: number[] = [];
  for (const part of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1 || from > totalPages || to > totalPages) {
        throw Object.assign(new Error(`Orden de paginas invalido: ${part}`), { status: 400 });
      }
      const step = from <= to ? 1 : -1;
      for (let page = from; step > 0 ? page <= to : page >= to; page += step) {
        indexes.push(page - 1);
      }
      continue;
    }

    const page = Number(part);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      throw Object.assign(new Error(`Pagina fuera de rango: ${part}`), { status: 400 });
    }
    indexes.push(page - 1);
  }

  return indexes.length ? indexes : Array.from({ length: totalPages }, (_, index) => index);
}

async function appendPdfToMerged(merged: PDFDocument, sourcePath: string, pageOrder?: string | null) {
  const sourcePdf = await PDFDocument.load(fs.readFileSync(sourcePath));
  const pageIndexes = pageIndexesFromOrder(pageOrder, sourcePdf.getPageCount());
  const pages = await merged.copyPages(sourcePdf, pageIndexes);
  pages.forEach((page) => merged.addPage(page));
}

// ── Combinación de PDF por agente (pestaña "Combinación de PDF") ─────────────
// Junta los archivos (PDF + jpg/png) de las subcarpetas del agente, en el orden
// de la pestaña "Orden de documentos" (documentos activos, por `orden`, según ley).
const COMBINAR_PDF = /\.pdf$/i;
const COMBINAR_JPG = /\.jpe?g$/i;
const COMBINAR_PNG = /\.png$/i;
const COMBINAR_TIFF = /\.tiff?$/i;
const COMBINAR_NOMBRE_SALIDA = 'Tramite de nombramiento';

// Decodifica un TIFF (posiblemente multipágina) a un array de PNG (uno por página),
// para poder embeberlo en el PDF (pdf-lib no soporta TIFF). Usa utif + @napi-rs/canvas.
function decodeTiffToPngPages(fp: string): Buffer[] {
  const UTIF = require('utif');
  const { createCanvas, ImageData } = require('@napi-rs/canvas');
  const buf = fs.readFileSync(fp);
  const ifds = UTIF.decode(buf);
  const out: Buffer[] = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const w = ifd.width;
    const h = ifd.height;
    if (!w || !h) continue;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    out.push(canvas.encodeSync('png'));
  }
  return out;
}

async function leyDeAgente(sequelize: Sequelize, dni: number): Promise<string | null> {
  const rows = await sequelize.query<{ ley: string | null }>(
    `SELECT CASE WHEN ocl.nombre LIKE '%10471%' THEN '10471'
                 WHEN ocl.nombre LIKE '%10430%' THEN '10430' ELSE NULL END AS ley
     FROM personal p
     LEFT JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
     LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
     LEFT JOIN ley ocl ON ocl.id = oc.ley_id AND ocl.deleted_at IS NULL
     WHERE p.dni = :dni AND p.deleted_at IS NULL LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  const l = rows[0]?.ley;
  return l === '10471' ? '10471' : l === '10430' ? '10430' : null;
}

// Fuentes ordenadas: por cada documento activo (en orden), los archivos combinables
// de su subcarpeta. `rel` es la ruta relativa dentro de DOCU\<dni>.
async function fuentesCombinar(sequelize: Sequelize, dni: number): Promise<Array<{ doc: string; rel: string; fp: string; archivo: string }>> {
  const ley = await leyDeAgente(sequelize, dni);
  if (!ley) throw Object.assign(new Error('No se pudo determinar la ley del agente (10430/10471)'), { status: 400 });
  const docs = await sequelize.query<{ documento: string }>(
    `SELECT documento FROM orden_documentos_expediente
      WHERE proceso = :proceso AND ley = :ley AND activo = 1 ORDER BY orden`,
    { replacements: { proceso: 'PASE A TRANSITORIA', ley }, type: QueryTypes.SELECT }
  );
  const dir = resolveDocuAgentDir(dni);
  const refs: Array<{ doc: string; rel: string; fp: string; archivo: string }> = [];
  for (const d of docs) {
    const carpeta = safeSegment(d.documento);
    const sub = path.join(dir, carpeta);
    if (!fs.existsSync(sub)) continue;
    const files = fs.readdirSync(sub, { withFileTypes: true })
      .filter((e) => e.isFile() && (COMBINAR_PDF.test(e.name) || COMBINAR_JPG.test(e.name) || COMBINAR_PNG.test(e.name) || COMBINAR_TIFF.test(e.name)))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'es'));
    for (const f of files) refs.push({ doc: d.documento, rel: `${carpeta}/${f}`.replace(/\\/g, '/'), fp: path.join(sub, f), archivo: f });
  }
  return refs;
}

// Agrega una página puntual (o todas, si page===null) de un archivo al merged.
// Devuelve cuántas páginas agregó. Usa cache de PDFs ya cargados.
async function appendPaginasAlMerged(
  merged: PDFDocument,
  fp: string,
  page: number | null,
  cache: Map<string, any>
): Promise<number> {
  if (COMBINAR_PDF.test(fp)) {
    let src: PDFDocument | undefined = cache.get(fp);
    if (!src) { src = await PDFDocument.load(fs.readFileSync(fp), { ignoreEncryption: true }); cache.set(fp, src); }
    const total = src.getPageCount();
    const idxs = page === null ? src.getPageIndices() : (page >= 0 && page < total ? [page] : []);
    if (!idxs.length) return 0;
    const copied = await merged.copyPages(src, idxs);
    copied.forEach((p) => merged.addPage(p));
    return copied.length;
  }
  if (COMBINAR_TIFF.test(fp)) {
    // Un TIFF puede ser multipágina → cada página se embebe como PNG.
    let pngs: Buffer[] | undefined = cache.get(fp);
    if (!pngs) { pngs = decodeTiffToPngPages(fp); cache.set(fp, pngs); }
    const idxs = page === null ? pngs.map((_, i) => i) : (page >= 0 && page < pngs.length ? [page] : []);
    let n = 0;
    for (const i of idxs) {
      const img = await merged.embedPng(pngs[i]);
      const p = merged.addPage([img.width, img.height]);
      p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      n += 1;
    }
    return n;
  }
  if (COMBINAR_JPG.test(fp) || COMBINAR_PNG.test(fp)) {
    if (page !== null && page !== 0) return 0;
    const bytes = fs.readFileSync(fp);
    const img = COMBINAR_PNG.test(fp) ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
    const p = merged.addPage([img.width, img.height]);
    p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    return 1;
  }
  return 0;
}

function parseDocumentOrder(raw: unknown): DocumentOrderInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      kind: String(item?.kind || '') as DocumentOrderInput['kind'],
      fileName: String(item?.fileName || '').trim() || null,
      pageOrder: String(item?.pageOrder || '').trim() || null,
    }))
    .filter((item): item is DocumentOrderInput => (
      item.kind === 'caratula' || item.kind === 'file' || item.kind === 'rupa'
    ));
}

function orderedMergeItems(
  filesForDni: MergeFileInput[],
  extraDocs: ExtraDocsOptions,
  documentOrder: DocumentOrderInput[]
) {
  const byFileName = new Map(filesForDni.map((file) => [file.fileName, file]));
  const items: Array<{ kind: 'caratula' | 'file' | 'rupa'; file?: MergeFileInput; pageOrder?: string | null }> = [];

  const pushOrderItem = (orderItem: DocumentOrderInput) => {
    if (orderItem.kind === 'caratula' && extraDocs.includeCaratula) {
      items.push({ kind: 'caratula', pageOrder: orderItem.pageOrder });
    } else if (orderItem.kind === 'rupa' && extraDocs.includeRupa) {
      items.push({ kind: 'rupa', pageOrder: orderItem.pageOrder });
    } else if (orderItem.kind === 'file' && orderItem.fileName) {
      const file = byFileName.get(orderItem.fileName);
      if (file) {
        items.push({ kind: 'file', file, pageOrder: orderItem.pageOrder || file.pageOrder || null });
      }
    }
  };

  if (documentOrder.length) {
    // El editor de hojas manda un documentOrder COMPLETO: lista cada hoja/documento
    // que quedo incluido, en el orden exacto que ve el usuario. Un documento ausente
    // significa "excluido a proposito" (p.ej. destildar un PDF de una sola hoja o la
    // ultima hoja que le quedaba). Por eso NO se re-agregan los archivos faltantes:
    // hacerlo hacia reaparecer documentos excluidos y el combinado no quedaba igual
    // que en el editor.
    documentOrder.forEach(pushOrderItem);
    return items;
  }

  if (extraDocs.includeCaratula) items.push({ kind: 'caratula' });
  filesForDni.forEach((file) => items.push({ kind: 'file', file, pageOrder: file.pageOrder || null }));
  if (extraDocs.includeRupa) items.push({ kind: 'rupa' });
  return items;
}

function targetFolderFor(dni: number, tramite: string, sub?: string): string {
  const base = path.resolve(getDocuBaseDir());
  const cleanSub = String(sub || '').replace(/[\\/]+/g, ' ').trim();
  const parts = [base, String(dni), tramite, ...(cleanSub ? [cleanSub] : [])];
  const target = path.resolve(...parts);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Carpeta destino insegura'), { status: 400 });
  }
  return target;
}

// Subcarpeta fija por año en curso donde se guarda el combinado, p.ej. "DESIGNACION INTERINO 2026".
function subcarpetaCombinado(): string {
  return `DESIGNACION INTERINO ${new Date().getFullYear()}`;
}

function routeForDocumentStorage(fullPath: string): string {
  const bases = [env.DOCUMENTS_SCAN_DIR, getDocuBaseDir(), env.DOCUMENTS_BASE_DIR]
    .map((base) => String(base || '').trim())
    .filter(Boolean);

  for (const base of bases) {
    const rel = path.relative(path.resolve(base), path.resolve(fullPath));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.replace(/\\/g, '/');
    }
  }

  return fullPath;
}

async function registerCombinedDocument(
  sequelize: Sequelize,
  opts: {
    dni: number;
    tramite: string;
    combinedPath: string;
    expediente: string | null;
    actor: number | null;
  }
): Promise<{ id: number | null; fileUrl: string | null }> {
  const stat = fs.statSync(opts.combinedPath);
  const filename = path.basename(opts.combinedPath);
  const now = new Date();
  const year = now.getFullYear();
  const fecha = now.toISOString().slice(0, 10);
  const nombre = `${opts.tramite} - PDF combinado`;
  const descripcion = `Tramite documental ${opts.tramite}. PDF combinado generado desde carpeta de descargas.`;
  const ruta = routeForDocumentStorage(opts.combinedPath);

  const [result] = await sequelize.query(
    `INSERT INTO tblarchivos
       (dni, ruta, nombre, numero, tipo, tamanio, anio, fecha, descripcion_archivo, nombre_archivo_original, created_by, created_at)
     VALUES
       (:dni, :ruta, :nombre, :numero, :tipo, :tamanio, :anio, :fecha, :descripcion, :originalName, :createdBy, :createdAt)`,
    {
      replacements: {
        dni: opts.dni,
        ruta,
        nombre,
        numero: opts.expediente || null,
        tipo: 'tramite_documental',
        tamanio: String(stat.size),
        anio: year,
        fecha,
        descripcion,
        originalName: filename,
        createdBy: opts.actor,
        createdAt: now,
      },
    }
  );

  const id = Number((result as any)?.insertId || 0) || null;
  await cacheInvalidateTags(['documents:list', `documents:dni:${opts.dni}`]).catch(() => {});

  return {
    id,
    fileUrl: id ? `/api/v1/documents/${id}/file` : null,
  };
}

async function registerAgentExpediente(
  sequelize: Sequelize,
  opts: {
    dni: number;
    numero: string | null;
    tramite: string;
    actor: number | null;
  }
): Promise<{ id: number | null; created: boolean } | null> {
  const numero = String(opts.numero || '').trim();
  if (!numero) return null;

  const existing = await sequelize.query<{ id: number }>(
    `SELECT id
       FROM expedientes
      WHERE dni = :dni
        AND numero = :numero
        AND deleted_at IS NULL
      LIMIT 1`,
    {
      replacements: { dni: opts.dni, numero },
      type: QueryTypes.SELECT,
    }
  );

  if (existing[0]?.id) {
    return { id: Number(existing[0].id), created: false };
  }

  const now = new Date();
  const fecha = now.toISOString().slice(0, 10);
  const caratula = `Tramite documental ${opts.tramite}`;
  const [result] = await sequelize.query(
    `INSERT INTO expedientes
       (dni, numero, caratula, fecha, estado, created_by, created_at)
     VALUES
       (:dni, :numero, :caratula, :fecha, :estado, :createdBy, :createdAt)`,
    {
      replacements: {
        dni: opts.dni,
        numero,
        caratula,
        fecha,
        estado: 'En trámite',
        createdBy: opts.actor,
        createdAt: now,
      },
    }
  );

  await cacheInvalidateTags(['table:expedientes']).catch(() => {});

  return {
    id: Number((result as any)?.insertId || 0) || null,
    created: true,
  };
}

async function loadPdfJs() {
  const pdfjsFile = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  return dynamicImport(pathToFileURL(pdfjsFile).href);
}

// pdfjs + @napi-rs/canvas pueden colgarse o tirar un rechazo no manejado al destruir el
// documento (NodeCanvasFactory.destroy). Un timeout garantiza que la request SIEMPRE responda:
// si el OCR se cuelga, el PDF queda como "sin texto" en vez de colgar toda la operación.
const OCR_TIMEOUT_MS = Math.max(10000, Number(process.env.TRAMITES_PDF_OCR_TIMEOUT_MS || 60000) || 60000);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label}: se agoto el tiempo (${ms}ms)`), { status: 504 }));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// Destruye el documento pdfjs sin propagar el crash de teardown del canvas nativo.
async function safeDestroyPdf(pdf: any) {
  try {
    await pdf?.destroy?.();
  } catch {
    /* el teardown de @napi-rs/canvas a veces tira; no debe romper la operacion */
  }
}

async function extractPdfText(pdfPath: string): Promise<{ text: string; pages: number }> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const parts: string[] = [];

  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const pageText = (content.items || [])
        .map((item: any) => String(item?.str || ''))
        .filter(Boolean)
        .join(' ');
      if (pageText) parts.push(pageText);
    }
    return { text: parts.join('\n'), pages: pdf.numPages };
  } finally {
    await safeDestroyPdf(pdf);
  }
}

// Texto de cada página por separado (capa de texto, sin OCR). Sirve para leer el título de la
// hoja (encabezado del SIAPE/eRreH) y auto-ordenar el combinado por nombre de hoja.
async function extractPdfPageTexts(pdfPath: string): Promise<string[]> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const out: string[] = [];
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const text = (content.items || [])
        .map((item: any) => String(item?.str || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push(text);
    }
    return out;
  } finally {
    await safeDestroyPdf(pdf);
  }
}

// El título de la hoja está en el encabezado (primeros caracteres). Con eso alcanza para clasificar,
// salvo el CV de eRreH: "CURRICULUM VITAE" SÍ es texto, pero pdfjs lo extrae al FINAL del stream (no
// en el encabezado), por eso se busca en TODO el texto de la hoja. Respaldo: "antecedentes laborales".
function pageTitleFrom(pageText: string): string {
  const t = normalizeSearch(pageText);
  if (t.includes('curriculum') || t.includes('antecedentes laborales')) {
    return 'CURRICULUM VITAE';
  }
  return String(pageText || '').slice(0, 140).trim();
}

async function renderPdfPageToJpg(pdfjs: any, pdf: any, pageNo: number, tempDir: string): Promise<string> {
  const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');
  (globalThis as any).DOMMatrix = (globalThis as any).DOMMatrix ?? DOMMatrix;
  (globalThis as any).Path2D = (globalThis as any).Path2D ?? Path2D;
  (globalThis as any).ImageData = (globalThis as any).ImageData ?? ImageData;

  const scale = Math.max(1, Number(env.TRAMITES_PDF_OCR_SCALE || 2) || 2);
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  page.cleanup();
  const out = path.join(tempDir, `page_${String(pageNo).padStart(3, '0')}.jpg`);
  const jpg = await canvas.encode('jpeg', 90);
  fs.writeFileSync(out, jpg);
  return out;
}

// pdfjs por defecto libera sus canvas con `canvas.width = 0`, que con @napi-rs/canvas tira
// "Failed to unwrap exclusive reference of CanvasElement" y colgaba/crasheaba el OCR. Este factory
// libera sin ese seteo → el render/OCR ya no rompe.
function makeSafeCanvasFactory() {
  const { createCanvas } = require('@napi-rs/canvas');
  return {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.ceil(width) || 1, Math.ceil(height) || 1);
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(cc: any, width: number, height: number) {
      cc.canvas.width = Math.ceil(width) || 1;
      cc.canvas.height = Math.ceil(height) || 1;
    },
    destroy(cc: any) {
      cc.canvas = null;
      cc.context = null;
    },
  };
}

async function extractPdfTextWithOcr(pdfPath: string): Promise<{ text: string; pages: number; processedPages: number }> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true, canvasFactory: makeSafeCanvasFactory() }).promise;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramites-ocr-'));
  const parts: string[] = [];

  try {
    const maxPages = Math.max(1, Number(env.TRAMITES_PDF_OCR_MAX_PAGES || 20) || 20);
    const pagesToRead = Math.min(pdf.numPages, maxPages);
    for (let pageNo = 1; pageNo <= pagesToRead; pageNo += 1) {
      // Aislar cada pagina: un render/OCR que falle no debe abortar todo el PDF.
      try {
        const imgPath = await renderPdfPageToJpg(pdfjs, pdf, pageNo, tempDir);
        const text = await extractTextFromImage(imgPath);
        if (text?.trim()) parts.push(text);
      } catch (err: any) {
        logger.warn({ msg: '[tramites] OCR pagina fallo', page: pageNo, error: err?.message });
      }
    }
    return { text: parts.join('\n'), pages: pdf.numPages, processedPages: pagesToRead };
  } finally {
    await safeDestroyPdf(pdf);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// OCR de páginas puntuales, cacheado por archivo (path+mtime+página). Sirve para desempatar hojas
// con el mismo título (cuerpo escaneado), p.ej. la DDJJ incompatibilidad. La primera vez OCR-ea; luego
// sale de cache (re-analizar es rápido).
const ocrPageCache = new Map<string, string>();
async function ocrPagesText(pdfPath: string, pageNos: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pageNos.length) return out;
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(pdfPath).mtimeMs; } catch { /* noop */ }
  const keyFor = (p: number) => `${pdfPath}|${mtimeMs}|${p}`;
  const missing = pageNos.filter((p) => !ocrPageCache.has(keyFor(p)));
  if (missing.length) {
    const pdfjs = await loadPdfJs();
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = await pdfjs.getDocument({ data, disableWorker: true, canvasFactory: makeSafeCanvasFactory() }).promise;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramites-ocr-'));
    try {
      for (const pageNo of missing) {
        let text = '';
        try {
          const imgPath = await renderPdfPageToJpg(pdfjs, pdf, pageNo, tempDir);
          text = (await extractTextFromImage(imgPath)) || '';
        } catch (err: any) {
          logger.warn({ msg: '[tramites] OCR incompat pagina fallo', page: pageNo, error: err?.message });
        }
        ocrPageCache.set(keyFor(pageNo), text);
      }
    } finally {
      await safeDestroyPdf(pdf);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
  for (const p of pageNos) out.set(p, ocrPageCache.get(keyFor(p)) || '');
  return out;
}

// Sub-orden dentro del bloque "DECLARACION JURADA SOBRE INCOMPATIBILIDAD" (mismo título, cuerpo
// escaneado). Son DOS juegos que el SIAPE exporta desordenados; se ubican por CONTENIDO (el OCR lee
// el cuerpo pero NO el "página X de Y"). Menor = primero. Las dos de incompatibilidad quedan intactas
// (0 y 1); solo se ordenan las tres de compatibilidad horaria (2, 3, 4).
//   Juego 1 · DDJJ incompatibilidad:  0 datos declarante  →  1 ítems + firma
//   Juego 2 · Planilla compatibilidad horaria (Ley 13.644):  2 datos/banda  →  3 observaciones  →  4 ratifica superior/delegado
// OJO: la incompatibilidad hoja 1 (ítem 4) dice "jerarquía", por eso ese término NO se usa para compat;
// la hoja 3 de compat se detecta por "delegado" (exclusivo de la ratificación superior/delegado).
function incompatSubRank(ocrText: string): number {
  const t = normalizeSearch(ocrText);
  // Incompatibilidad (NO se tocan; van primero)
  if (t.includes('declarante') || t.includes('planta permanente') || t.includes('relacion contractual')) return 0; // hoja 1: datos + ítems 1-8
  if (t.includes('declaro') || t.includes('juramento') || t.includes('afectado') || t.includes('rehabilit')) return 1; // hoja 2: ítems 9-17 + firma
  // Compatibilidad horaria (estas se ordenan)
  if (t.includes('delegado')) return 4;                                                                             // hoja 3: ratifica superior/delegado
  if (t.includes('banda horaria') || t.includes('completado por') || t.includes('para ser completado')) return 2;  // hoja 1: datos del agente
  return 3;                                                                                                          // hoja 2: observaciones
}

// Sub-orden dentro del bloque "DDJJ CONDICIONES DE SALUD" (mismo título, cuerpo escaneado). El SIAPE lo
// exporta desordenado; se ordena por SECCIÓN (título que el OCR sí lee). Orden pedido por el área:
//   0 datos personales → 1 hábitos → 2 antecedentes cardíacos → 3 antecedentes ginecológicos
// Testeado en 5 agentes: 4 hojas c/u, todas clasificadas OK. Sección desconocida → 4 (al final).
function saludSubRank(ocrText: string): number {
  const t = normalizeSearch(ocrText);
  if (t.includes('datos personales')) return 0;
  if (t.includes('habito') || t.includes('fuma') || t.includes('tranquilizante')) return 1;
  if (t.includes('cardiac') || t.includes('cardiaco') || t.includes('palpitaciones') || t.includes('cardiopatia')) return 2;
  if (t.includes('ginecolog')) return 3;
  return 4;
}

// Sub-orden del bloque "TITULO - MATRICULA PROFESIONAL". La MATRÍCULA (certificados de matriculación /
// libre de sanción + credencial: RUP Salud, COLFARMA, etc.) es LEGIBLE por OCR → va primero (0). El
// TÍTULO/DIPLOMA son imágenes escaneadas SIN texto legible (OCR vacío) → van después (1), en orden
// SIAPE (no se pueden distinguir entre sí). Orden pedido por el área: matrícula → título → diploma.
function tituloSubRank(ocrText: string): number {
  const t = normalizeSearch(ocrText);
  if (
    t.includes('matricul') || t.includes('certificado') || t.includes('credencial') ||
    t.includes('colegio') || t.includes('consejo') || t.includes('colfarma') ||
    t.includes('registro unico') || t.includes('libre de sancion') || t.includes('inscripto')
  ) return 0; // matrícula (legible)
  return 1;   // título / diploma (imagen sin texto)
}

function collectDniCandidates(text: string): number[] {
  const found = new Set<number>();
  const normalized = text.replace(/\s+/g, ' ');

  const cuilRegex = /\b(?:20|23|24|27|30|33|34)[-\s]?(\d{7,8})[-\s]?\d\b/g;
  for (const match of normalized.matchAll(cuilRegex)) {
    const dni = Number(match[1]);
    if (Number.isInteger(dni) && dni >= 1_000_000 && dni <= 99_999_999) found.add(dni);
  }

  const contextualRegex = /\b(?:DNI|D\.N\.I\.|DOCUMENTO|DOC\.?|DU|CUIL)\D{0,24}(\d{7,8})\b/gi;
  for (const match of normalized.matchAll(contextualRegex)) {
    const dni = Number(match[1]);
    if (Number.isInteger(dni) && dni >= 1_000_000 && dni <= 99_999_999) found.add(dni);
  }

  return [...found];
}

async function findAgents(sequelize: Sequelize, dniCandidates: number[]): Promise<AgentHit[]> {
  if (!dniCandidates.length) return [];
  const rows = await sequelize.query<AgentHit>(
    `
      SELECT dni, apellido, nombre, cuil
      FROM personal
      WHERE dni IN (:dnis)
        AND deleted_at IS NULL
      ORDER BY apellido ASC, nombre ASC
    `,
    { replacements: { dnis: dniCandidates }, type: QueryTypes.SELECT }
  );
  return rows;
}

function parseYear(value: unknown): number | null {
  const year = Number(value);
  const current = new Date().getFullYear() + 1;
  return Number.isInteger(year) && year >= 1900 && year <= current ? year : null;
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function preloadAgents(
  sequelize: Sequelize,
  opts: { poblacion: string; anioDesde: number | null; anioHasta: number | null; tipoBeca?: string | null; dependenciaId?: number | null }
): Promise<PreloadAgentRow[]> {
  const poblacion = String(opts.poblacion || '').trim().toUpperCase();
  const tipoBeca = String(opts.tipoBeca || '').trim();
  const dependenciaId = opts.dependenciaId && Number.isInteger(opts.dependenciaId) ? opts.dependenciaId : null;
  const baseSelect = `
    SELECT DISTINCT
      p.dni,
      TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) AS apellidoNombre,
      DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fechaIngresoExcel,
      '' AS expediente,
      1 AS incluido,
      l.nombre AS leyNombre,
      pl.nombre AS plantaNombre,
      oc.nombre AS ocupacionNombre,
      CASE
        WHEN ocl.nombre LIKE '%10471%' THEN '10471'
        WHEN ocl.nombre LIKE '%10430%' THEN '10430'
        ELSE NULL
      END AS ocupacionLey,
      CASE WHEN LOWER(COALESCE(l.nombre, '')) LIKE '%beca%' THEN l.nombre ELSE NULL END AS tipoBeca,
      (
        SELECT dep_serv.nombre
        FROM agentes_servicios ags_serv
        LEFT JOIN servicios s_serv ON s_serv.id = ags_serv.servicio_id AND s_serv.deleted_at IS NULL
        LEFT JOIN reparticiones r_serv ON r_serv.id = s_serv.reparticion_id AND r_serv.deleted_at IS NULL
        LEFT JOIN dependencias dep_serv ON dep_serv.id = COALESCE(r_serv.dependencia_id, ags_serv.dependencia_id) AND dep_serv.deleted_at IS NULL
        WHERE ags_serv.dni = p.dni
          AND ags_serv.deleted_at IS NULL
          AND (ags_serv.fecha_hasta IS NULL OR ags_serv.fecha_hasta >= CURDATE())
        ORDER BY ags_serv.fecha_desde DESC, ags_serv.id DESC
        LIMIT 1
      ) AS dependenciaNombre
    FROM personal p
    JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
    LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
    LEFT JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
    LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
    LEFT JOIN ley ocl ON ocl.id = oc.ley_id AND ocl.deleted_at IS NULL
  `;

  const commonWhere = `
    p.deleted_at IS NULL
    AND a.estado_empleo = 'ACTIVO'
  `;

  if (poblacion === 'BECARIOS') {
    if (!opts.anioDesde || !opts.anioHasta) {
      throw Object.assign(new Error('Para becarios indicá rango de años'), { status: 400 });
    }
    const anioDesde = Math.min(opts.anioDesde, opts.anioHasta);
    const anioHasta = Math.max(opts.anioDesde, opts.anioHasta);
    const tipoBecaWhere = tipoBeca ? 'AND l.nombre = :tipoBeca' : '';
    const dependenciaWhere = dependenciaId ? `AND ${dependenciaWhereSql(':dependenciaId')}` : '';
    return sequelize.query<PreloadAgentRow>(
      `
        ${baseSelect}
        WHERE ${commonWhere}
          AND a.fecha_ingreso IS NOT NULL
          AND LOWER(COALESCE(l.nombre, '')) LIKE '%beca%'
          AND YEAR(a.fecha_ingreso) BETWEEN :anioDesde AND :anioHasta
          ${tipoBecaWhere}
          ${dependenciaWhere}
        ORDER BY apellidoNombre ASC, fechaIngresoExcel ASC
        LIMIT 1000
      `,
      { replacements: { anioDesde, anioHasta, tipoBeca, dependenciaId }, type: QueryTypes.SELECT }
    );
  }

  if (poblacion === 'INTERINOS_10430') {
    // Filtro por año de fecha_ingreso opcional (solo si viene el rango). El flujo nuevo
    // (/interinos-10430) siempre lo pasa; el viejo /precargar no lo pasaba → sin cambios.
    const hasRange = !!opts.anioDesde && !!opts.anioHasta;
    const anioDesde = hasRange ? Math.min(opts.anioDesde!, opts.anioHasta!) : null;
    const anioHasta = hasRange ? Math.max(opts.anioDesde!, opts.anioHasta!) : null;
    const rangeWhere = hasRange
      ? 'AND a.fecha_ingreso IS NOT NULL AND YEAR(a.fecha_ingreso) BETWEEN :anioDesde AND :anioHasta'
      : '';
    return sequelize.query<PreloadAgentRow>(
      `
        ${baseSelect}
        WHERE ${commonWhere}
          AND (
            a.ley_id IN (1, 3)
            OR REPLACE(COALESCE(l.nombre, ''), '.', '') LIKE '%10430%'
          )
          AND UPPER(COALESCE(pl.nombre, '')) <> 'PERMANENTE'
          ${rangeWhere}
        ORDER BY apellidoNombre ASC
        LIMIT 1000
      `,
      { replacements: { anioDesde, anioHasta }, type: QueryTypes.SELECT }
    );
  }

  throw Object.assign(new Error('Poblacion invalida'), { status: 400 });
}

async function listBecaTipos(
  sequelize: Sequelize,
  opts: { anioDesde?: number | null; anioHasta?: number | null; dependenciaId?: number | null } = {}
): Promise<BecaTipo[]> {
  const hasRange = !!opts.anioDesde && !!opts.anioHasta;
  const anioDesde = hasRange ? Math.min(opts.anioDesde!, opts.anioHasta!) : null;
  const anioHasta = hasRange ? Math.max(opts.anioDesde!, opts.anioHasta!) : null;
  const dependenciaId = opts.dependenciaId && Number.isInteger(opts.dependenciaId) ? opts.dependenciaId : null;
  const rangeWhere = hasRange ? 'AND a.fecha_ingreso IS NOT NULL AND YEAR(a.fecha_ingreso) BETWEEN :anioDesde AND :anioHasta' : '';
  const dependenciaWhere = dependenciaId ? `AND ${dependenciaWhereSql(':dependenciaId')}` : '';
  return sequelize.query<BecaTipo>(
    `
      SELECT DISTINCT
        l.nombre AS value,
        l.nombre AS label,
        COUNT(DISTINCT p.dni) AS total
      FROM agentes a
      JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
      JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
      WHERE a.deleted_at IS NULL
        AND a.estado_empleo = 'ACTIVO'
        AND LOWER(COALESCE(l.nombre, '')) LIKE '%beca%'
        ${rangeWhere}
        ${dependenciaWhere}
      GROUP BY l.nombre
      ORDER BY l.nombre ASC
    `,
    { replacements: { anioDesde, anioHasta, dependenciaId }, type: QueryTypes.SELECT }
  );
}

async function listDependenciasFiltro(
  sequelize: Sequelize,
  opts: { anioDesde?: number | null; anioHasta?: number | null; tipoBeca?: string | null } = {}
): Promise<DependenciaOption[]> {
  const hasRange = !!opts.anioDesde && !!opts.anioHasta;
  const anioDesde = hasRange ? Math.min(opts.anioDesde!, opts.anioHasta!) : null;
  const anioHasta = hasRange ? Math.max(opts.anioDesde!, opts.anioHasta!) : null;
  const tipoBeca = String(opts.tipoBeca || '').trim();
  const rangeWhere = hasRange ? 'AND a.fecha_ingreso IS NOT NULL AND YEAR(a.fecha_ingreso) BETWEEN :anioDesde AND :anioHasta' : '';
  const tipoBecaWhere = tipoBeca ? 'AND l.nombre = :tipoBeca' : '';
  return sequelize.query<DependenciaOption>(
    `
      SELECT
        CAST(d.id AS CHAR) AS value,
        d.nombre AS label,
        COUNT(DISTINCT p.dni) AS total
      FROM dependencias d
      JOIN personal p ON p.deleted_at IS NULL
      JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
      JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
        AND a.estado_empleo = 'ACTIVO'
        AND LOWER(COALESCE(l.nombre, '')) LIKE '%beca%'
        ${rangeWhere}
        ${tipoBecaWhere}
        AND ${dependenciaWhereSql('d.id')}
      GROUP BY d.id, d.nombre
      ORDER BY d.nombre ASC
    `,
    { replacements: { anioDesde, anioHasta, tipoBeca }, type: QueryTypes.SELECT }
  );
}

async function analyzeOnePdf(sequelize: Sequelize, fileName: string): Promise<PdfAnalysisRow> {
  const fullPath = resolveInputPdf(fileName);
  const stat = fs.statSync(fullPath);

  const fileUrl = `/tramites-documentales/pdf?file=${encodeURIComponent(fileName)}`;
  try {
    const pageTexts = await extractPdfPageTexts(fullPath);
    let pages = pageTexts.length;
    let pageTitles = pageTexts.map(pageTitleFrom);
    let lectura: PdfAnalysisRow['lectura'] = 'texto';
    let trimmed = pageTexts.join('\n').trim();

    if (!trimmed && env.TRAMITES_PDF_OCR_ENABLE) {
      try {
        const ocrResult = await withTimeout(extractPdfTextWithOcr(fullPath), OCR_TIMEOUT_MS, `OCR ${fileName}`);
        pages = ocrResult.pages || pages;
        trimmed = ocrResult.text.trim();
        lectura = trimmed ? 'ocr' : 'sin_texto';
      } catch (err: any) {
        logger.warn({ msg: '[tramites] OCR analizar fallo/timeout', fileName, error: err?.message });
        lectura = 'sin_texto';
      }
    }

    if (!trimmed) {
      return {
        fileName, fileUrl, bytes: stat.size, pages,
        detectedDni: null, agente: null, candidates: [],
        status: 'sin_texto',
        reason: env.TRAMITES_PDF_OCR_ENABLE
          ? 'No se pudo extraer texto ni con OCR.'
          : 'El PDF no tiene texto extraible; OCR desactivado.',
        lectura: 'sin_texto',
        pageTitles, pageSubOrder: [],
      };
    }

    // Bloque de DDJJ (mismo título "incompatibilidad", cuerpo escaneado). El "página X de Y" no es legible,
    // así que se ordena por CONTENIDO: incompatibilidad (0,1) queda intacta y primero; compatibilidad
    // horaria (2,3,4) se ordena. OCR puntual solo de esas hojas, cacheado. Ver incompatSubRank.
    const pageSubOrder = pageTitles.map(() => 0);
    const incompatPages = pageTitles
      .map((t, i) => ({ n: normalizeSearch(t), i }))
      .filter((x) => x.n.includes('incompatibilidad'))
      .map((x) => x.i);
    if (incompatPages.length > 1 && env.TRAMITES_PDF_OCR_ENABLE) {
      try {
        const ocr = await withTimeout(
          ocrPagesText(fullPath, incompatPages.map((i) => i + 1)),
          Math.max(OCR_TIMEOUT_MS, incompatPages.length * 20000),
          `OCR incompat ${fileName}`,
        );
        for (const i of incompatPages) pageSubOrder[i] = incompatSubRank(ocr.get(i + 1) || '');
      } catch (err: any) {
        logger.warn({ msg: '[tramites] OCR incompat orden fallo/timeout', fileName, error: err?.message });
      }
    }

    // Bloque de DDJJ CONDICIONES DE SALUD: mismo título, cuerpo escaneado. Se ordena por SECCIÓN
    // (datos personales → hábitos → cardíacos → ginecológicos). OCR puntual cacheado. Ver saludSubRank.
    const saludPages = pageTitles
      .map((t, i) => ({ n: normalizeSearch(t), i }))
      .filter((x) => x.n.includes('condiciones de salud'))
      .map((x) => x.i);
    if (saludPages.length > 1 && env.TRAMITES_PDF_OCR_ENABLE) {
      try {
        const ocr = await withTimeout(
          ocrPagesText(fullPath, saludPages.map((i) => i + 1)),
          Math.max(OCR_TIMEOUT_MS, saludPages.length * 20000),
          `OCR salud ${fileName}`,
        );
        for (const i of saludPages) pageSubOrder[i] = saludSubRank(ocr.get(i + 1) || '');
      } catch (err: any) {
        logger.warn({ msg: '[tramites] OCR salud orden fallo/timeout', fileName, error: err?.message });
      }
    }

    // Bloque "TITULO - MATRICULA PROFESIONAL": matrícula (legible) primero, título/diploma (imágenes) después.
    const tituloPages = pageTitles
      .map((t, i) => ({ n: normalizeSearch(t), i }))
      .filter((x) => x.n.includes('matricula profesional'))
      .map((x) => x.i);
    if (tituloPages.length > 1 && env.TRAMITES_PDF_OCR_ENABLE) {
      try {
        const ocr = await withTimeout(
          ocrPagesText(fullPath, tituloPages.map((i) => i + 1)),
          Math.max(OCR_TIMEOUT_MS, tituloPages.length * 20000),
          `OCR titulo ${fileName}`,
        );
        for (const i of tituloPages) pageSubOrder[i] = tituloSubRank(ocr.get(i + 1) || '');
      } catch (err: any) {
        logger.warn({ msg: '[tramites] OCR titulo orden fallo/timeout', fileName, error: err?.message });
      }
    }

    const candidates = collectDniCandidates(trimmed);
    const agents = await findAgents(sequelize, candidates);

    if (agents.length === 1) {
      return {
        fileName, fileUrl, bytes: stat.size, pages,
        detectedDni: agents[0].dni, agente: agents[0], candidates,
        status: 'detectado',
        reason: lectura === 'ocr' ? 'Detectado con OCR.' : null,
        lectura, pageTitles, pageSubOrder,
      };
    }

    return {
      fileName, fileUrl, bytes: stat.size, pages,
      detectedDni: null, agente: null, candidates,
      status: agents.length > 1 ? 'ambiguedad' : 'sin_agente',
      reason: agents.length > 1
        ? `Se encontraron ${agents.length} agentes posibles.`
        : 'No se encontro un DNI/CUIL coincidente con personal.',
      lectura, pageTitles, pageSubOrder,
    };
  } catch (err: any) {
    logger.warn({ msg: '[tramites] error analizando PDF', fileName, error: err?.message });
    return {
      fileName, fileUrl, bytes: stat.size, pages: 0,
      detectedDni: null, agente: null, candidates: [],
      status: 'error', reason: err?.message || 'Error al leer PDF',
      lectura: 'sin_texto', pageTitles: [], pageSubOrder: [],
    };
  }
}

function analysisSummary(rows: PdfAnalysisRow[]) {
  const grouped = rows.reduce<Record<string, PdfAnalysisRow[]>>((acc, row) => {
    const key = row.detectedDni ? String(row.detectedDni) : 'SIN_AGENTE';
    (acc[key] ||= []).push(row);
    return acc;
  }, {});

  return {
    rows,
    grouped,
    total: rows.length,
    detected: rows.filter((r) => r.status === 'detectado').length,
    needsReview: rows.filter((r) => r.status !== 'detectado').length,
  };
}

function wantsAnalysisStream(req: Request) {
  return String(req.query?.stream || '') === '1'
    || String(req.header('accept') || '').includes('application/x-ndjson');
}

function writeAnalysisEvent(res: Response, event: Record<string, unknown>) {
  res.write(`${JSON.stringify(event)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FLUJO NUEVO (2026-08): tandas de interinos 10430 + explorador de carpeta DOCU
// ─────────────────────────────────────────────────────────────────────────────

type DocuTreeNode = {
  name: string;
  type: 'dir' | 'file';
  path: string;                 // relativa a la carpeta del agente, con '/'
  ext?: string;
  bytes?: number;
  children?: DocuTreeNode[];
};

// Carpeta del agente = <DOCU_BASE>\<dni> (mismo criterio que targetFolderFor).
function resolveDocuAgentDir(dni: number): string {
  const base = String(getDocuBaseDir() || '').trim();
  if (!base) throw Object.assign(new Error('TRAMITES_DOCU_BASE_DIR no esta configurado'), { status: 400 });
  const baseResolved = path.resolve(base);
  const target = path.resolve(baseResolved, String(dni));
  const rel = path.relative(baseResolved, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Carpeta del agente insegura'), { status: 400 });
  }
  return target;
}

// ── Clasificador de archivos sueltos → subcarpeta por documento ──────────────
// Solo 5 tipos: DNI, CUIL, Titulo, Matricula, Etico. Método: nombre primero;
// si no alcanza, OCR/capa de texto con frases ancla fuertes (no rótulos de campo).
const _normClasif = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Veta familiares (no es el documento del agente).
const CLASIF_VETO_FAMILIAR = /conyug|esposa|esposo|\bhij[oa]s?\b|madre|padre|conviviente/;
// Veta otros tipos de documento cuyo título los delata (aunque mencionen "dni"/"cuil").
const CLASIF_VETO_TEXTO = /toma de posesion|situaciones de violencia|registro de situaciones|comunico a usted que mi domicilio|declaro que mi domicilio|nota de solicitud|nombramiento|incompatibilidad|declaracion jurada|apto (fisico|psico)|acta de matrimonio|certificado de antecedentes|libre de deuda|constancia de aceptacion|nota de toma/;
const CLASIF_REGLAS_NOMBRE: Array<{ key: string; re: RegExp; not?: RegExp }> = [
  { key: 'CUIL', re: /(^|[^a-z])cuil([^a-z]|$)/ },
  { key: 'DNI', re: /(^|[^a-z])dni([^a-z]|$)/ },
  { key: 'Matricula', re: /matricula/ },
  { key: 'Etico', re: /(^|[^a-z])etic[oa]([^a-z]|$)/ },
  { key: 'Titulo', re: /titulo|analitico|(^|[^a-z])secundario|(^|[^a-z])primario/ },
];
const CLASIF_REGLAS_TEXTO: Array<{ key: string; re: RegExp }> = [
  { key: 'CUIL', re: /constancia de c\.?\s?u\.?\s?i\.?\s?l|codigo unico de identificacion laboral|constancia de cuil/ },
  { key: 'DNI', re: /documento nacional de identidad|ministerio del interior.*identidad|registro nacional de las personas/ },
  { key: 'Matricula', re: /matricula (profesional|n[ro°º]|nacional)|colegio de (medicos|enfermer|profesionales|bioquimic|kinesi)|habilitacion profesional/ },
  { key: 'Etico', re: /codigo de etica|certificado de (etica|ejercicio etico)|ejercicio etico de la profesion/ },
  { key: 'Titulo', re: /(titulo|diploma) (de|profesional|secundario|intermedio)|analitico de calificaciones|bachiller|direccion general de cultura y educacion|ministerio de educacion|tecnico (en|superior)|nivel secundario/ },
];
function clasifPorNombre(nombre: string): { key: string | null; veto: string | null } {
  const t = _normClasif(path.basename(nombre, path.extname(nombre)));
  if (CLASIF_VETO_FAMILIAR.test(t)) return { key: null, veto: 'familiar' };
  for (const r of CLASIF_REGLAS_NOMBRE) if (r.re.test(t) && !(r.not && r.not.test(t))) return { key: r.key, veto: null };
  return { key: null, veto: null };
}
function clasifPorTexto(txt: string): { key: string | null; veto: string | null } {
  const t = _normClasif(txt);
  if (CLASIF_VETO_FAMILIAR.test(t)) return { key: null, veto: 'familiar' };
  if (CLASIF_VETO_TEXTO.test(t)) return { key: null, veto: 'otro documento' };
  for (const r of CLASIF_REGLAS_TEXTO) if (r.re.test(t)) return { key: r.key, veto: null };
  return { key: null, veto: null };
}
// Subcarpeta destino existente del agente para una clave.
function subcarpetaDestino(subdirs: string[], key: string): string | null {
  const objetivo: Record<string, RegExp> = { DNI: /^dni$/, CUIL: /^cuil$/, Titulo: /^titulo$/, Matricula: /^matricula/, Etico: /^etic[oa]/ };
  return subdirs.find((d) => objetivo[key]?.test(_normClasif(d))) || null;
}
const CLASIF_ES_IMG = /\.(jpe?g|png|tiff?|bmp|webp)$/i;
const CLASIF_ES_PDF = /\.pdf$/i;
const CLASIF_IGNORAR = /\.db$/i;
// Lee el texto del documento reusando el pipeline de OCR de la ruta.
async function leerTextoDocumento(fp: string): Promise<string> {
  try {
    if (CLASIF_ES_IMG.test(fp)) {
      return await withTimeout(extractTextFromImage(fp), OCR_TIMEOUT_MS, `OCR img ${path.basename(fp)}`);
    }
    if (CLASIF_ES_PDF.test(fp)) {
      const texts = await extractPdfPageTexts(fp);
      const joined = texts.slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length > 25) return joined;
      const ocr = await withTimeout(extractPdfTextWithOcr(fp), OCR_TIMEOUT_MS, `OCR ${path.basename(fp)}`);
      return ocr.text || '';
    }
  } catch (e: any) {
    logger.warn({ msg: '[tramites] leerTextoDocumento fallo', file: path.basename(fp), error: e?.message });
  }
  return '';
}

// Árbol recursivo (carpetas primero, luego archivos, alfabético). Tope de profundidad por las dudas.
function buildDocuTree(dir: string, relBase: string, depth = 0): DocuTreeNode[] {
  if (depth > 12) return [];
  let entries: Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: DocuTreeNode[] = entries.map((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.join(relBase, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      return { name: entry.name, type: 'dir', path: rel, children: buildDocuTree(full, rel, depth + 1) };
    }
    let bytes = 0;
    try { bytes = fs.statSync(full).size; } catch { /* ignora */ }
    return {
      name: entry.name,
      type: 'file',
      path: rel,
      ext: path.extname(entry.name).toLowerCase().replace(/^\./, ''),
      bytes,
    };
  });
  return nodes.sort((a, b) => (
    a.type === b.type ? a.name.localeCompare(b.name, 'es') : a.type === 'dir' ? -1 : 1
  ));
}

// Agentes de una tanda (o de todas si no se pasa), enriquecidos por JOIN a personal/agentes.
async function listTandaAgentes(sequelize: Sequelize, tanda?: string | null) {
  const whereTanda = tanda ? 'AND t.tanda = :tanda' : '';
  return sequelize.query(
    `
      SELECT
        t.id, t.tanda, t.dni, t.estado, t.creado_at AS creadoAt,
        TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) AS apellidoNombre,
        DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fechaIngreso,
        oc.nombre AS ocupacionNombre,
        CASE
          WHEN ocl.nombre LIKE '%10471%' THEN '10471'
          WHEN ocl.nombre LIKE '%10430%' THEN '10430'
          ELSE NULL
        END AS ocupacionLey,
        l.nombre  AS leyNombre,
        pl.nombre AS plantaNombre,
        a.estado_empleo AS estadoEmpleo,
        (
          SELECT dep_serv.nombre
          FROM agentes_servicios ags_serv
          LEFT JOIN servicios s_serv ON s_serv.id = ags_serv.servicio_id AND s_serv.deleted_at IS NULL
          LEFT JOIN reparticiones r_serv ON r_serv.id = s_serv.reparticion_id AND r_serv.deleted_at IS NULL
          LEFT JOIN dependencias dep_serv ON dep_serv.id = COALESCE(r_serv.dependencia_id, ags_serv.dependencia_id) AND dep_serv.deleted_at IS NULL
          WHERE ags_serv.dni = t.dni
            AND ags_serv.deleted_at IS NULL
            AND (ags_serv.fecha_hasta IS NULL OR ags_serv.fecha_hasta >= CURDATE())
          ORDER BY ags_serv.fecha_desde DESC, ags_serv.id DESC
          LIMIT 1
        ) AS dependenciaNombre
      FROM tramites_tanda_interinos t
      JOIN personal p ON p.dni = t.dni AND p.deleted_at IS NULL
      LEFT JOIN agentes a ON a.dni = t.dni AND a.deleted_at IS NULL
      LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
      LEFT JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
      LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
      LEFT JOIN ley ocl ON ocl.id = oc.ley_id AND ocl.deleted_at IS NULL
      WHERE 1 = 1 ${whereTanda}
      ORDER BY t.tanda ASC, apellidoNombre ASC
    `,
    { replacements: tanda ? { tanda } : {}, type: QueryTypes.SELECT }
  );
}

// Resuelve una ruta (archivo o carpeta) DENTRO de la carpeta del agente. '' => la raíz del agente.
function resolveInsideDocu(dni: number, relPath: string): string {
  const dir = resolveDocuAgentDir(dni);
  const clean = String(relPath || '').replace(/\\/g, '/').trim();
  if (clean.includes('\0')) throw Object.assign(new Error('Ruta inválida'), { status: 400 });
  const full = path.resolve(dir, clean);
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Ruta fuera de la carpeta del agente'), { status: 400 });
  }
  return full;
}

// Un único segmento de nombre seguro (sin separadores ni caracteres inválidos de Windows).
function safeSegment(name: string): string {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  // Se sacan los caracteres invalidos de Windows y los de control; se conservan
  // espacios, guiones, acentos y parentesis.
  const clean = base.replace(/[<>:"/\\|?*]/g, '_').replace(/[\x00-\x1F]/g, '').trim().replace(/\.+$/, '');
  if (!clean || clean === '.' || clean === '..') {
    throw Object.assign(new Error('Nombre invalido'), { status: 400 });
  }
  return clean;}

// Evita pisar: si ya existe, agrega " (1)", " (2)", ...
function uniqueDest(dest: string): string {
  if (!fs.existsSync(dest)) return dest;
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  for (let i = 1; i < 1000; i += 1) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

const ESTADOS_TANDA = ['pendiente', 'hecho', 'aprobado'];

// Multer propio para subir a DOCU: en memoria (buffers) y varios archivos.
const docuUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.DOCUMENTS_MAX_BYTES || 25 * 1024 * 1024, files: 20 },
});

export function buildTramitesDocumentalesRouter(sequelize: Sequelize) {
  const router = Router();

  // Tabla de tandas (runtime, sin migracion — patron de este proyecto). Guarda solo dni+tanda;
  // el resto de los datos del agente sale por JOIN en listTandaAgentes.
  (async () => {
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS tramites_tanda_interinos (
          id         INT AUTO_INCREMENT PRIMARY KEY,
          tanda      VARCHAR(80)  NOT NULL,
          dni        INT          NOT NULL,
          estado     VARCHAR(30)  NOT NULL DEFAULT 'pendiente',
          creado_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_tanda_dni (tanda, dni),
          KEY idx_tti_dni (dni),
          CONSTRAINT fk_tti_personal_dni FOREIGN KEY (dni) REFERENCES personal (dni)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (e: any) {
      logger.error({ msg: 'tramites_tanda_interinos: error creando tabla', error: e?.message });
    }
  })();

  // Orden de documentos por tramite/ley (orden de trabajo "PASE A TRANSITORIA").
  // Tabla de referencia editable desde la pestana "Orden de documentos". La columna
  // `activo` permite desactivar un requisito sin borrarlo. Runtime, sin migracion.
  (async () => {
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS orden_documentos_expediente (
          id           INT AUTO_INCREMENT PRIMARY KEY,
          proceso      VARCHAR(80)  NOT NULL,
          ley          VARCHAR(20)  NOT NULL,
          orden        INT          NOT NULL,
          documento    VARCHAR(200) NOT NULL,
          observacion  TEXT         NULL,
          activo       TINYINT(1)   NOT NULL DEFAULT 1,
          UNIQUE KEY uq_proc_ley_orden (proceso, ley, orden),
          KEY idx_proceso_ley (proceso, ley)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      // Por si la tabla existia sin la columna activo.
      const [col] = await sequelize.query(
        "SHOW COLUMNS FROM orden_documentos_expediente LIKE 'activo'"
      );
      if (!(col as any[]).length) {
        await sequelize.query(
          'ALTER TABLE orden_documentos_expediente ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER observacion'
        );
      }
    } catch (e: any) {
      logger.error({ msg: 'orden_documentos_expediente: error creando tabla', error: e?.message });
    }
  })();

  // SIN USO (2026-08): pestaña "Tramites" vieja retirada; reemplazada por flujo de tandas de interinos 10430. No borrar aun.
  router.get('/listados', async (_req: Request, res: Response) => {
    // Colapsa duplicados históricos por identidad (deja el más nuevo de cada uno).
    const rows = dedupSavedListados(readSavedListados()).slice(0, 25);

    // Enriquecer con la ocupación ACTUAL de la base (para que el listado no quede congelado).
    try {
      const dnis = Array.from(new Set(
        rows.flatMap((l) => (Array.isArray(l.rows) ? l.rows : []))
          .map((r: any) => Number(String(r?.dni ?? '').replace(/\D/g, '')))
          .filter((d) => Number.isInteger(d) && d > 0)
      ));
      if (dnis.length) {
        const vivos = await sequelize.query<{ dni: number; ocupacion: string | null; ley: string | null }>(
          `SELECT p.dni, oc.nombre AS ocupacion,
                  CASE WHEN ocl.nombre LIKE '%10471%' THEN '10471' WHEN ocl.nombre LIKE '%10430%' THEN '10430' ELSE NULL END AS ley
           FROM personal p
           JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
           LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
           LEFT JOIN ley ocl ON ocl.id = oc.ley_id AND ocl.deleted_at IS NULL
           WHERE p.dni IN (:dnis) AND p.deleted_at IS NULL`,
          { replacements: { dnis }, type: QueryTypes.SELECT }
        );
        const map = new Map(vivos.map((v) => [String(v.dni), v]));
        for (const l of rows) {
          for (const r of (Array.isArray(l.rows) ? l.rows : []) as any[]) {
            const hit = map.get(String(Number(String(r?.dni ?? '').replace(/\D/g, ''))));
            if (hit) {
              if (hit.ocupacion) r.ocupacionNombre = hit.ocupacion;
              r.ocupacionLey = hit.ley;
            }
          }
        }
      }
    } catch (err: any) {
      logger.warn({ msg: '[tramites] no se pudo enriquecer listados con ocupacion actual', error: err?.message });
    }

    return res.json({ ok: true, data: { rows, storePath: getListadosStorePath() } });
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.post('/listados', (req: Request, res: Response) => {
    try {
      const actor = Number((req as any).auth?.principalId || 0) || null;
      const listado = cleanSavedListado(req.body?.listado || req.body, actor);
      const identity = listadoIdentity(listado);
      // Reemplaza cualquier listado con la misma identidad (mismo año/programa/dependencia/etc.)
      // en vez de acumular un duplicado nuevo por cada guardado.
      const current = readSavedListados().filter(
        (item) => item.id !== listado.id && listadoIdentity(item) !== identity
      );
      const rows = dedupSavedListados([listado, ...current]).slice(0, 25);
      writeSavedListados(rows);
      return res.json({ ok: true, data: { row: listado, rows, storePath: getListadosStorePath() } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] guardar listado error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al guardar listado seteado' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.delete('/listados/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const rows = readSavedListados().filter((item) => item.id !== id);
      writeSavedListados(rows);
      return res.json({ ok: true, data: { rows, storePath: getListadosStorePath() } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] borrar listado error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al borrar listado seteado' });
    }
  });

  router.get('/config', async (_req: Request, res: Response) => {
    const inputDir = getInputDir();
    const docuBaseDir = getDocuBaseDir();
    const pdfs = listPdfFiles(inputDir);
    try {
      return res.json({
        ok: true,
        data: {
          inputDir,
          docuBaseDir,
          inputDirExists: !!inputDir && fs.existsSync(inputDir),
          docuBaseDirExists: !!docuBaseDir && fs.existsSync(docuBaseDir),
          pdfCount: pdfs.length,
          ocrEnabled: env.TRAMITES_PDF_OCR_ENABLE,
          ocrMaxPages: env.TRAMITES_PDF_OCR_MAX_PAGES,
          tramites: TRAMITES,
          poblaciones: POBLACIONES,
          becaTipos: await listBecaTipos(sequelize),
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] config error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al cargar configuracion' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.post('/analizar', async (req: Request, res: Response) => {
    const inputDir = getInputDir();
    if (!inputDir || !fs.existsSync(inputDir)) {
      return res.status(400).json({ ok: false, error: `Carpeta de entrada no existe: ${inputDir || '(sin configurar)'}` });
    }

    const files = listPdfFiles(inputDir);

    try {
      const rows: PdfAnalysisRow[] = [];

      if (wantsAnalysisStream(req)) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        writeAnalysisEvent(res, {
          type: 'start',
          inputDir,
          docuBaseDir: getDocuBaseDir(),
          total: files.length,
        });

        for (const fileName of files) {
          if (res.destroyed) return;
          const row = await analyzeOnePdf(sequelize, fileName);
          rows.push(row);
          writeAnalysisEvent(res, {
            type: 'row',
            row,
            done: rows.length,
            total: files.length,
          });
        }

        writeAnalysisEvent(res, {
          type: 'done',
          inputDir,
          docuBaseDir: getDocuBaseDir(),
          ...analysisSummary(rows),
        });
        return res.end();
      }

      for (const fileName of files) {
        rows.push(await analyzeOnePdf(sequelize, fileName));
      }

      return res.json({
        ok: true,
        data: {
          inputDir,
          docuBaseDir: getDocuBaseDir(),
          ...analysisSummary(rows),
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] analizar error', error: err?.message });
      if (wantsAnalysisStream(req) && res.headersSent) {
        writeAnalysisEvent(res, { type: 'error', error: err?.message || 'Error al analizar PDFs' });
        return res.end();
      }
      return res.status(500).json({ ok: false, error: err?.message || 'Error al analizar PDFs' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.get('/beca-tipos', async (req: Request, res: Response) => {
    try {
      const rows = await listBecaTipos(sequelize, {
        anioDesde: parseYear(req.query?.anioDesde),
        anioHasta: parseYear(req.query?.anioHasta),
        dependenciaId: req.query?.dependenciaId ? Number(req.query.dependenciaId) : null,
      });
      return res.json({ ok: true, data: { rows } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] beca tipos error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al cargar programas de beca' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.get('/dependencias', async (req: Request, res: Response) => {
    try {
      const rows = await listDependenciasFiltro(sequelize, {
        anioDesde: parseYear(req.query?.anioDesde),
        anioHasta: parseYear(req.query?.anioHasta),
        tipoBeca: queryString(req.query?.tipoBeca),
      });
      return res.json({ ok: true, data: { rows } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] dependencias error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al cargar dependencias' });
    }
  });

  // SIN USO (2026-08): endpoint viejo. OJO: la funcion preloadAgents() SI se reutiliza en el flujo nuevo.
  router.post('/precargar', async (req: Request, res: Response) => {
    try {
      const rows = await preloadAgents(sequelize, {
        poblacion: req.body?.poblacion,
        anioDesde: parseYear(req.body?.anioDesde),
        anioHasta: parseYear(req.body?.anioHasta),
        tipoBeca: req.body?.tipoBeca,
        dependenciaId: req.body?.dependenciaId ? Number(req.body.dependenciaId) : null,
      });
      return res.json({
        ok: true,
        data: {
          rows,
          total: rows.length,
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] precargar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al precargar agentes' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.post('/preview', async (req: Request, res: Response) => {
    try {
      const tramite = sanitizeTramite(req.body?.tramite);
      const dni = parseDni(req.body?.dni);
      if (!dni) {
        return res.status(400).json({ ok: false, error: 'DNI invalido para previsualizar' });
      }

      const extraDocsRaw = req.body?.extraDocs || {};
      const extraDocs: ExtraDocsOptions = {
        includeCaratula: Boolean(extraDocsRaw.includeCaratula),
        includeRupa: Boolean(extraDocsRaw.includeRupa),
        rupaSourceMode: ['docu', 'descargas', 'custom'].includes(String(extraDocsRaw.rupaSourceMode))
          ? String(extraDocsRaw.rupaSourceMode) as ExtraDocsOptions['rupaSourceMode']
          : 'docu',
        rupaDir: String(extraDocsRaw.rupaDir || '').trim() || null,
      };
      const documentOrder = parseDocumentOrder(req.body?.documentOrder);
      const filesRaw = Array.isArray(req.body?.files) ? req.body.files as SaveFileInput[] : [];
      const files = filesRaw
        .filter((file) => file?.include !== false)
        .map((file) => ({
          fileName: String(file.fileName || ''),
          dni: parseDni(file.dni),
          expediente: String(file.expediente || '').trim() || null,
          pageOrder: String(file.pageOrder || '').trim() || null,
        }))
        .filter((file): file is MergeFileInput => !!file.fileName && file.dni === dni);

      if (!files.length && !extraDocs.includeCaratula && !extraDocs.includeRupa) {
        return res.status(400).json({ ok: false, error: 'No hay PDFs para previsualizar' });
      }

      const merged = await PDFDocument.create();
      const mergeItems = orderedMergeItems(files, extraDocs, documentOrder);
      const skipped: Array<{ source: string; reason: string }> = [];

      for (const mergeItem of mergeItems) {
        if (mergeItem.kind === 'caratula') {
          try {
            const caratulaHit = await findCaratulaPdfByAgent(sequelize, dni);
            if (!caratulaHit) {
              skipped.push({ source: 'caratula', reason: 'No se encontro caratula para el establecimiento/ley del agente en Descargas' });
            } else {
              await appendPdfToMerged(merged, caratulaHit.path, mergeItem.pageOrder);
            }
          } catch (err: any) {
            skipped.push({ source: 'caratula', reason: err?.message || 'Error al previsualizar caratula' });
          }
        } else if (mergeItem.kind === 'rupa') {
          try {
            const rupaHit = await findRupaPdfByContent(sequelize, dni, extraDocs);
            if (!rupaHit) {
              skipped.push({ source: 'rupa', reason: 'No se encontro PDF RUPA para el DNI' });
            } else {
              await appendPdfToMerged(merged, rupaHit.path, mergeItem.pageOrder);
            }
          } catch (err: any) {
            skipped.push({ source: 'rupa', reason: err?.message || 'Error al previsualizar RUPA' });
          }
        } else if (mergeItem.file) {
          try {
            await appendPdfToMerged(merged, resolveInputPdf(mergeItem.file.fileName), mergeItem.pageOrder);
          } catch (err: any) {
            skipped.push({ source: mergeItem.file.fileName, reason: err?.message || 'Error al previsualizar PDF' });
          }
        }
      }

      if (merged.getPageCount() <= 0) {
        return res.status(400).json({ ok: false, error: skipped[0]?.reason || 'No se pudo generar previsualizacion' });
      }

      const bytes = await merged.save();
      const filename = `PREVIEW_${tramite}_${dni}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('X-Tramites-Skipped', encodeURIComponent(JSON.stringify(skipped)));
      return res.send(Buffer.from(bytes));
    } catch (err: any) {
      logger.error({ msg: '[tramites] preview error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al previsualizar tramite' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.post('/extra-status', async (req: Request, res: Response) => {
    try {
      const dnis = Array.isArray(req.body?.dnis)
        ? Array.from(new Set(req.body.dnis.map((dni: unknown) => parseDni(String(dni))).filter(Boolean))) as number[]
        : [];
      const extraDocsRaw = req.body?.extraDocs || {};
      const extraDocs: ExtraDocsOptions = {
        includeCaratula: Boolean(extraDocsRaw.includeCaratula),
        includeRupa: Boolean(extraDocsRaw.includeRupa),
        rupaSourceMode: ['docu', 'descargas', 'custom'].includes(String(extraDocsRaw.rupaSourceMode))
          ? String(extraDocsRaw.rupaSourceMode) as ExtraDocsOptions['rupaSourceMode']
          : 'docu',
        rupaDir: String(extraDocsRaw.rupaDir || '').trim() || null,
      };

      const rows: Record<string, any> = {};
      for (const dni of dnis) {
        const rupaHit = extraDocs.includeRupa ? await findRupaPdfByContent(sequelize, dni, extraDocs) : null;
        const caratulaHit = extraDocs.includeCaratula ? await findCaratulaPdfByAgent(sequelize, dni) : null;
        rows[String(dni)] = {
          rupa: rupaHit
            ? { found: true, verificado: rupaHit.verificado, ...(await pdfMeta(rupaHit.path)) }
            : { found: false, reason: extraDocs.includeRupa ? `No se encontro rupa.pdf para DNI ${dni}` : 'RUPA desactivado' },
          caratula: caratulaHit
            ? { found: true, verificado: caratulaHit.verificado, key: caratulaHit.key, ...(await pdfMeta(caratulaHit.path)) }
            : { found: false, reason: extraDocs.includeCaratula ? `No se encontro caratula para el establecimiento/ley del DNI ${dni}` : 'Caratula desactivada' },
        };
      }

      return res.json({ ok: true, data: { rows } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] extra-status error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al consultar adjuntos' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.post('/extra-pdf', async (req: Request, res: Response) => {
    try {
      const kind = String(req.body?.kind || '').toLowerCase();
      const dni = parseDni(req.body?.dni);
      const extraDocsRaw = req.body?.extraDocs || {};
      const extraDocs: ExtraDocsOptions = {
        includeCaratula: Boolean(extraDocsRaw.includeCaratula),
        includeRupa: Boolean(extraDocsRaw.includeRupa),
        rupaSourceMode: ['docu', 'descargas', 'custom'].includes(String(extraDocsRaw.rupaSourceMode))
          ? String(extraDocsRaw.rupaSourceMode) as ExtraDocsOptions['rupaSourceMode']
          : 'docu',
        rupaDir: String(extraDocsRaw.rupaDir || '').trim() || null,
      };

      const fullPath = kind === 'rupa'
        ? (dni ? (await findRupaPdfByContent(sequelize, dni, extraDocs))?.path ?? null : null)
        : kind === 'caratula'
          ? (dni ? (await findCaratulaPdfByAgent(sequelize, dni))?.path ?? null : null)
          : null;
      if (!fullPath) {
        return res.status(404).json({ ok: false, error: 'Adjunto no encontrado' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath).replace(/"/g, '_')}"`);
      return fs.createReadStream(fullPath).pipe(res);
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al abrir adjunto' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.get('/expedientes', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').trim();
      const rows = await sequelize.query<{ value: string; label: string; total: number; createdAt: string | null }>(
        `
          SELECT value, CONCAT(value, ' (', total, ')') AS label, total, createdAt
          FROM (
            SELECT
              TRIM(numero) AS value,
              COUNT(*) AS total,
              MAX(created_at) AS createdAtRaw,
              DATE_FORMAT(MAX(created_at), '%Y-%m-%d') AS createdAt
            FROM expedientes
            WHERE deleted_at IS NULL
              AND numero IS NOT NULL
              AND TRIM(numero) <> ''
              AND (
                :q = ''
                OR numero LIKE :like
                OR caratula LIKE :like
              )
            GROUP BY TRIM(numero)
          ) t
          ORDER BY createdAtRaw DESC
          LIMIT 50
        `,
        { replacements: { q, like: `%${q}%` }, type: QueryTypes.SELECT }
      );
      return res.json({ ok: true, data: { rows } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] expedientes error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al buscar expedientes' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.post('/guardar', async (req: Request, res: Response) => {
    try {
      const tramite = sanitizeTramite(req.body?.tramite);
      const expediente = String(req.body?.expediente || '').trim() || null;
      const actor = Number((req as any).auth?.principalId || 0) || null;
      const extraDocsRaw = req.body?.extraDocs || {};
      const extraDocs: ExtraDocsOptions = {
        includeCaratula: Boolean(extraDocsRaw.includeCaratula),
        includeRupa: Boolean(extraDocsRaw.includeRupa),
        rupaSourceMode: ['docu', 'descargas', 'custom'].includes(String(extraDocsRaw.rupaSourceMode))
          ? String(extraDocsRaw.rupaSourceMode) as ExtraDocsOptions['rupaSourceMode']
          : 'docu',
        rupaDir: String(extraDocsRaw.rupaDir || '').trim() || null,
      };
      const documentOrder = parseDocumentOrder(req.body?.documentOrder);
      const documentOrdersRaw = req.body?.documentOrders && typeof req.body.documentOrders === 'object'
        ? req.body.documentOrders
        : {};
      const filesRaw = Array.isArray(req.body?.files) ? req.body.files as SaveFileInput[] : [];
      const files = filesRaw
        .filter((file) => file?.include !== false)
        .map((file) => ({
          fileName: String(file.fileName || ''),
          dni: parseDni(file.dni),
          expediente: String(file.expediente || '').trim() || null,
          pageOrder: String(file.pageOrder || '').trim() || null,
        }))
        .filter((file): file is MergeFileInput => !!file.fileName && !!file.dni);

      if (!files.length) {
        return res.status(400).json({ ok: false, error: 'No hay PDFs con DNI para guardar' });
      }

      const docuBaseDir = getDocuBaseDir();
      if (!docuBaseDir) {
        return res.status(400).json({ ok: false, error: 'TRAMITES_DOCU_BASE_DIR no esta configurado' });
      }
      if (!fs.existsSync(docuBaseDir)) {
        return res.status(400).json({ ok: false, error: `Carpeta DOCU no existe: ${docuBaseDir}` });
      }

      const grouped = files.reduce<Record<string, MergeFileInput[]>>((acc, file) => {
        (acc[String(file.dni)] ||= []).push(file);
        return acc;
      }, {});

      const subCombinado = subcarpetaCombinado();
      const folders = Object.keys(grouped).map((dni) => ({
        dni: Number(dni),
        folder: targetFolderFor(Number(dni), tramite, subCombinado),
        existed: fs.existsSync(targetFolderFor(Number(dni), tramite, subCombinado)),
      }));

      const results: any[] = [];
      for (const item of folders) {
        const filesForDni = grouped[String(item.dni)];
        const expedienteGrupo = expediente || filesForDni.find((file) => file.expediente)?.expediente || null;
        fs.mkdirSync(item.folder, { recursive: true });
        const merged = await PDFDocument.create();
        const copied: Array<{ source: string; savedAs: string }> = [];
        const skipped: Array<{ source: string; reason: string }> = [];
        const documentOrderForDni = parseDocumentOrder((documentOrdersRaw as Record<string, unknown>)[String(item.dni)]);
        const mergeItems = orderedMergeItems(filesForDni, extraDocs, documentOrderForDni.length ? documentOrderForDni : documentOrder);

        // Se guarda SOLO el PDF combinado (ya contiene fuentes + caratula + rupa adentro).
        // No se copian los archivos sueltos a la carpeta del agente.
        for (const mergeItem of mergeItems) {
          if (mergeItem.kind === 'caratula') {
            try {
              const caratulaHit = await findCaratulaPdfByAgent(sequelize, item.dni);
              if (!caratulaHit) {
                skipped.push({ source: 'caratula', reason: 'No se encontro caratula para el establecimiento/ley del agente en Descargas' });
              } else {
                await appendPdfToMerged(merged, caratulaHit.path, mergeItem.pageOrder);
              }
            } catch (err: any) {
              skipped.push({ source: 'caratula', reason: err?.message || 'Error al combinar caratula' });
            }
          } else if (mergeItem.kind === 'rupa') {
            try {
              const rupaHit = await findRupaPdfByContent(sequelize, item.dni, extraDocs);
              if (!rupaHit) {
                skipped.push({ source: 'rupa', reason: 'No se encontro PDF RUPA para el DNI' });
              } else {
                await appendPdfToMerged(merged, rupaHit.path, mergeItem.pageOrder);
              }
            } catch (err: any) {
              skipped.push({ source: 'rupa', reason: err?.message || 'Error al combinar RUPA' });
            }
          } else if (mergeItem.file) {
            try {
              const sourcePath = resolveInputPdf(mergeItem.file.fileName);
              await appendPdfToMerged(merged, sourcePath, mergeItem.pageOrder);
            } catch (err: any) {
              skipped.push({ source: mergeItem.file.fileName, reason: err?.message || 'Error al combinar' });
            }
          }
        }

        let combined: string | null = null;
        let combinedPath: string | null = null;
        let combinedReemplazado = false;
        let combinedFileUrl: string | null = null;
        let documento: { id: number | null; fileUrl: string | null } | null = null;
        let expedienteRegistro: { id: number | null; created: boolean } | null = null;
        if (merged.getPageCount() > 0) {
          const combinedName = `${tramite}_${item.dni}_COMBINADO.pdf`;
          // Nombre fijo: si ya existe el combinado de ese agente/año, se REEMPLAZA (queda 1 solo, el actual).
          combinedPath = path.join(item.folder, safeFilename(combinedName));
          combinedReemplazado = fs.existsSync(combinedPath);
          fs.writeFileSync(combinedPath, Buffer.from(await merged.save()));
          combined = path.basename(combinedPath);
          combinedFileUrl = `/api/v1/tramites-documentales/saved-pdf?path=${encodeURIComponent(combinedPath)}`;
          documento = await registerCombinedDocument(sequelize, {
            dni: item.dni,
            tramite,
            combinedPath,
            expediente: expedienteGrupo,
            actor,
          });
          expedienteRegistro = await registerAgentExpediente(sequelize, {
            dni: item.dni,
            numero: expedienteGrupo,
            tramite,
            actor,
          });
        }

        results.push({
          dni: item.dni,
          tramite,
          expediente: expedienteGrupo,
          folder: item.folder,
          folderExisted: item.existed,
          copied,
          combined,
          combinedReemplazado,
          combinedFileUrl,
          documento,
          expedienteRegistro,
          skipped,
        });
      }

      return res.json({
        ok: true,
        data: {
          tramite,
          docuBaseDir,
          results,
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] guardar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al guardar tramite' });
    }
  });

  // ── GET /tramites-documentales/aptos ──────────────────────────────────────
  // Cruza D:\G\APTOS\APTOS.xlsx (exámenes de aptitud del Ministerio) con la base:
  // por DNI trae ley, planta, ocupación y estado del agente. Los que no están
  // en personal salen con en_sistema=false.
  router.get('/aptos', async (_req: Request, res: Response) => {
    const APTOS_XLSX = 'D:\\G\\APTOS\\APTOS.xlsx';
    try {
      if (!fs.existsSync(APTOS_XLSX)) {
        return res.json({ ok: true, data: { rows: [], existe: false, path: APTOS_XLSX } });
      }
      const wb = XLSX.readFile(APTOS_XLSX, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });

      const fmtFecha = (v: any): string => {
        if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
        return String(v ?? '').trim();
      };

      const rows = raw.map((r: any) => ({
        dni:        Number(String(r['NRO_DOCUMENTO'] ?? '').replace(/\D/g, '')) || 0,
        apellido:   String(r['APELLIDO'] ?? '').trim(),
        nombre:     String(r['NOMBRE'] ?? '').trim(),
        cuil:       String(r['CUIT_CUIL'] ?? '').trim(),
        codigo:     String(r['CODIGO_EXAMEN'] ?? '').trim(),
        tipo:       String(r['TIPO_EXAMEN'] ?? '').trim(),
        modalidad:  String(r['MODALIDAD_EXAMEN'] ?? '').trim(),
        fecha:      fmtFecha(r['FECHA']),
        estado_examen: String(r['ESTADO_EXAMEN'] ?? '').trim(),
        resolucion: String(r['RESOLUCION'] ?? '').trim(),
        tipo_tramite: String(r['TIPO_TRAMITE'] ?? '').trim(),
        // enriquecimiento DB (defaults si no está)
        en_sistema: false,
        nombre_db:  '',
        ley:        '',
        planta:     '',
        ocupacion:  '',
        estado_empleo: '',
        legajo:     '',
      }));

      // Enriquecimiento DB siempre en try/catch propio: la lectura del Excel no se cae por la DB
      try {
        const dnis = Array.from(new Set(rows.map((r) => r.dni).filter((d) => d > 0)));
        if (dnis.length) {
          const vivos = await sequelize.query<{
            dni: number; nombre_db: string; ley: string | null; planta: string | null;
            ocupacion: string | null; estado_empleo: string | null; legajo: number | null;
          }>(
            `SELECT p.dni,
                    CONCAT(p.apellido, ', ', p.nombre) AS nombre_db,
                    l.nombre  AS ley,
                    pl.nombre AS planta,
                    oc.nombre AS ocupacion,
                    a.estado_empleo,
                    a.legajo
             FROM personal p
             LEFT JOIN agentes a       ON a.dni = p.dni AND a.deleted_at IS NULL
             LEFT JOIN ley l           ON l.id = a.ley_id
             LEFT JOIN plantas pl      ON pl.id = a.planta_id
             LEFT JOIN ocupaciones oc  ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
             WHERE p.dni IN (:dnis) AND p.deleted_at IS NULL
             ORDER BY (a.estado_empleo = 'ACTIVO' AND a.fecha_egreso IS NULL) DESC, a.id DESC`,
            { replacements: { dnis }, type: QueryTypes.SELECT }
          );
          // primera fila por DNI = la más relevante (activa primero, después la más nueva)
          const map = new Map<number, typeof vivos[number]>();
          for (const v of vivos) if (!map.has(Number(v.dni))) map.set(Number(v.dni), v);
          for (const r of rows) {
            const hit = map.get(r.dni);
            if (!hit) continue;
            r.en_sistema    = true;
            r.nombre_db     = hit.nombre_db ?? '';
            r.ley           = hit.ley ?? '';
            r.planta        = hit.planta ?? '';
            r.ocupacion     = hit.ocupacion ?? '';
            r.estado_empleo = hit.estado_empleo ?? '';
            r.legajo        = hit.legajo != null ? String(hit.legajo) : '';
          }
        }
      } catch (dbErr: any) {
        logger.warn({ msg: '[tramites] aptos: no se pudo enriquecer desde DB', error: dbErr?.message });
      }

      return res.json({ ok: true, data: { rows, existe: true, path: APTOS_XLSX } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] aptos error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al leer APTOS.xlsx' });
    }
  });

  router.get('/pdf', (req: Request, res: Response) => {
    try {
      const fileName = String(req.query.file || '');
      const fullPath = resolveInputPdf(fileName);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath).replace(/"/g, '_')}"`);
      return fs.createReadStream(fullPath).pipe(res);
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al abrir PDF' });
    }
  });

  // SIN USO (2026-08): reemplazado por flujo de tandas de interinos 10430.
  router.get('/saved-pdf', (req: Request, res: Response) => {
    try {
      const requested = String(req.query.path || '');
      if (!requested) {
        return res.status(400).json({ ok: false, error: 'Ruta requerida' });
      }
      const fullPath = path.resolve(requested);
      const base = path.resolve(getDocuBaseDir());
      const rel = path.relative(base, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !fullPath.toLowerCase().endsWith('.pdf')) {
        return res.status(400).json({ ok: false, error: 'Archivo fuera de DOCU' });
      }
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ ok: false, error: 'PDF no encontrado' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath).replace(/"/g, '_')}"`);
      return fs.createReadStream(fullPath).pipe(res);
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al abrir combinado' });
    }
  });

  // ── FLUJO NUEVO: consulta de interinos 10430 por rango de años ────────────
  router.get('/interinos-10430', async (req: Request, res: Response) => {
    try {
      const anioDesde = parseYear(req.query.anioDesde);
      const anioHasta = parseYear(req.query.anioHasta);
      if (!anioDesde || !anioHasta) {
        return res.status(400).json({ ok: false, error: 'Indica el rango de años (anioDesde, anioHasta)' });
      }
      const rows = await preloadAgents(sequelize, {
        poblacion: 'INTERINOS_10430',
        anioDesde,
        anioHasta,
      });
      return res.json({ ok: true, data: { rows, total: rows.length } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] interinos-10430 error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al consultar interinos' });
    }
  });

  // ── FLUJO NUEVO: tandas ───────────────────────────────────────────────────
  // Listar (todas las tandas, o una con ?tanda=). Devuelve filas planas + nombres de tanda.
  router.get('/tandas', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.query.tanda);
      const rows = await listTandaAgentes(sequelize, tanda);
      const tandas = Array.from(new Set((rows as any[]).map((r) => r.tanda)));
      return res.json({ ok: true, data: { rows, tandas } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] tandas GET error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al listar tandas' });
    }
  });

  // Agregar DNIs a una tanda (INSERT IGNORE → no duplica por UNIQUE(tanda,dni)).
  router.post('/tandas', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta el nombre de la tanda' });
      const dnis = Array.isArray(req.body?.dnis)
        ? Array.from(new Set(
            (req.body.dnis as unknown[]).map((d) => parseDni(d as any)).filter((d): d is number => !!d)
          ))
        : [];
      if (!dnis.length) return res.status(400).json({ ok: false, error: 'No hay DNIs válidos para agregar' });
      await sequelize.query(
        `INSERT IGNORE INTO tramites_tanda_interinos (tanda, dni) VALUES ${dnis.map(() => '(?, ?)').join(', ')}`,
        { replacements: dnis.flatMap((dni) => [tanda, dni]), type: QueryTypes.INSERT }
      );
      const rows = await listTandaAgentes(sequelize, tanda);
      return res.json({ ok: true, data: { tanda, rows, agregados: dnis.length } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] tandas POST error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al guardar la tanda' });
    }
  });

  // Quitar un agente de una tanda (?tanda=&dni=), o la tanda entera si no se pasa dni.
  router.delete('/tandas', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.query.tanda) || queryString(req.body?.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const dni = parseDni((req.query.dni ?? req.body?.dni) as any);
      if (dni) {
        await sequelize.query(
          'DELETE FROM tramites_tanda_interinos WHERE tanda = :tanda AND dni = :dni',
          { replacements: { tanda, dni }, type: QueryTypes.DELETE }
        );
      } else {
        await sequelize.query(
          'DELETE FROM tramites_tanda_interinos WHERE tanda = :tanda',
          { replacements: { tanda }, type: QueryTypes.DELETE }
        );
      }
      return res.json({ ok: true, data: { tanda, dni: dni || null } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] tandas DELETE error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al borrar de la tanda' });
    }
  });

  // ── FLUJO NUEVO: explorador de la carpeta DOCU del agente ─────────────────
  // Árbol de D:\G\DOCU\<dni> (carpetas + archivos, con tamaño y extensión).
  router.get('/docu-tree', (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.query.dni as any);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const dir = resolveDocuAgentDir(dni);
      if (!fs.existsSync(dir)) {
        return res.json({ ok: true, data: { dni, dir, exists: false, tree: [] } });
      }
      const tree = buildDocuTree(dir, '');
      return res.json({ ok: true, data: { dni, dir, exists: true, tree } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al leer la carpeta DOCU' });
    }
  });

  // Sirve un archivo puntual de la carpeta del agente para el visor (?dni=&path=<relativa>).
  router.get('/docu-file', (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.query.dni as any);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const dir = resolveDocuAgentDir(dni);
      const relPath = String(req.query.path || '').replace(/\\/g, '/').trim();
      if (!relPath || relPath.includes('\0')) return res.status(400).json({ ok: false, error: 'Ruta inválida' });
      const full = path.resolve(dir, relPath);
      const rel = path.relative(dir, full);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(400).json({ ok: false, error: 'Archivo fuera de la carpeta del agente' });
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
      }
      const ext = path.extname(full).toLowerCase();
      const types: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tif': 'image/tiff',
        '.tiff': 'image/tiff',
        '.txt': 'text/plain; charset=utf-8',
      };
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(full).replace(/"/g, '_')}"`);
      return fs.createReadStream(full).pipe(res);
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al abrir el archivo' });
    }
  });

  // ── FLUJO NUEVO: operaciones de archivos dentro de DOCU\<dni> ─────────────
  // Crear carpeta: { dni, path (carpeta padre relativa, '' = raíz), name }
  router.post('/docu-mkdir', (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const name = safeSegment(req.body?.name);
      const parent = resolveInsideDocu(dni, String(req.body?.path || ''));
      const target = path.join(parent, name);
      if (fs.existsSync(target)) return res.status(409).json({ ok: false, error: 'Ya existe una carpeta con ese nombre' });
      fs.mkdirSync(target, { recursive: true });
      return res.json({ ok: true, data: { name } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al crear la carpeta' });
    }
  });

  // Mover archivo/carpeta a otra carpeta del mismo agente: { dni, from (relativa), to (carpeta relativa, '' = raíz) }
  router.post('/docu-move', (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const from = resolveInsideDocu(dni, String(req.body?.from || ''));
      if (!String(req.body?.from || '').trim()) return res.status(400).json({ ok: false, error: 'Falta el origen' });
      if (!fs.existsSync(from)) return res.status(404).json({ ok: false, error: 'El origen no existe' });
      const toFolder = resolveInsideDocu(dni, String(req.body?.to || ''));
      if (fs.existsSync(toFolder) && !fs.statSync(toFolder).isDirectory()) {
        return res.status(400).json({ ok: false, error: 'El destino no es una carpeta' });
      }
      // No permitir mover una carpeta dentro de sí misma o de un descendiente.
      const fromIsDir = fs.statSync(from).isDirectory();
      if (fromIsDir) {
        const relInto = path.relative(from, toFolder);
        if (relInto === '' || (!relInto.startsWith('..') && !path.isAbsolute(relInto))) {
          return res.status(400).json({ ok: false, error: 'No se puede mover una carpeta dentro de sí misma' });
        }
      }
      fs.mkdirSync(toFolder, { recursive: true });
      const dest = path.join(toFolder, path.basename(from));
      if (path.resolve(dest) === path.resolve(from)) {
        return res.json({ ok: true, data: { moved: false, reason: 'mismo lugar' } });
      }
      if (fs.existsSync(dest)) return res.status(409).json({ ok: false, error: 'Ya existe un archivo/carpeta con ese nombre en el destino' });
      fs.renameSync(from, dest);
      return res.json({ ok: true, data: { moved: true } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al mover' });
    }
  });

  // Subir archivos: multipart con campos { dni, path (carpeta destino relativa) } y files[].
  router.post('/docu-upload', docuUpload.array('files', 20), (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const folder = resolveInsideDocu(dni, String(req.body?.path || ''));
      const files = (req.files as Express.Multer.File[]) || [];
      if (!files.length) return res.status(400).json({ ok: false, error: 'No se recibieron archivos' });
      fs.mkdirSync(folder, { recursive: true });
      const saved: string[] = [];
      for (const file of files) {
        const name = safeSegment(file.originalname);
        const dest = uniqueDest(path.join(folder, name));
        fs.writeFileSync(dest, file.buffer);
        saved.push(path.basename(dest));
      }
      return res.json({ ok: true, data: { saved, total: saved.length } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al subir archivos' });
    }
  });

  // Estado de un agente en una tanda: { tanda, dni, estado } (pendiente|hecho|aprobado).
  router.post('/tandas/estado', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const dni = parseDni(req.body?.dni);
      const estado = String(req.body?.estado || '').trim().toLowerCase();
      if (!tanda || !dni) return res.status(400).json({ ok: false, error: 'Falta tanda o dni' });
      if (!ESTADOS_TANDA.includes(estado)) {
        return res.status(400).json({ ok: false, error: `Estado inválido (${ESTADOS_TANDA.join(', ')})` });
      }
      await sequelize.query(
        'UPDATE tramites_tanda_interinos SET estado = :estado WHERE tanda = :tanda AND dni = :dni',
        { replacements: { estado, tanda, dni }, type: QueryTypes.UPDATE }
      );
      return res.json({ ok: true, data: { tanda, dni, estado } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al actualizar estado' });
    }
  });

  // ---- Orden de documentos por tramite/ley (orden de trabajo) ----
  const ORDEN_PROCESO_DEFAULT = 'PASE A TRANSITORIA';

  // Lista el orden de documentos de un proceso. Opcional ?ley=10430 para filtrar.
  router.get('/orden-docs', async (req: Request, res: Response) => {
    try {
      const proceso = queryString(req.query?.proceso) || ORDEN_PROCESO_DEFAULT;
      const ley = queryString(req.query?.ley);
      const rows = await sequelize.query(
        `SELECT id, proceso, ley, orden, documento, observacion, activo
           FROM orden_documentos_expediente
          WHERE proceso = :proceso ${ley ? 'AND ley = :ley' : ''}
          ORDER BY ley, orden`,
        { replacements: { proceso, ley }, type: QueryTypes.SELECT }
      );
      // Leyes disponibles para el selector.
      const leyes = await sequelize.query<{ ley: string }>(
        `SELECT DISTINCT ley FROM orden_documentos_expediente WHERE proceso = :proceso ORDER BY ley`,
        { replacements: { proceso }, type: QueryTypes.SELECT }
      );
      return res.json({ ok: true, data: { rows, leyes: leyes.map((l) => l.ley), proceso } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al listar orden de documentos' });
    }
  });

  // Edita un requisito: nombre, observacion y/o estado activo. Solo campos presentes.
  router.patch('/orden-docs/:id', async (req: Request, res: Response) => {
    try {
      const id = Number(req.params?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'id invalido' });

      const sets: string[] = [];
      const repl: Record<string, unknown> = { id };
      if (typeof req.body?.documento === 'string') {
        const doc = req.body.documento.trim();
        if (!doc) return res.status(400).json({ ok: false, error: 'El nombre del documento no puede quedar vacio' });
        sets.push('documento = :documento'); repl.documento = doc.slice(0, 200);
      }
      if ('observacion' in (req.body || {})) {
        const obs = typeof req.body.observacion === 'string' ? req.body.observacion.trim() : '';
        sets.push('observacion = :observacion'); repl.observacion = obs || null;
      }
      if ('activo' in (req.body || {})) {
        sets.push('activo = :activo'); repl.activo = req.body.activo ? 1 : 0;
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: 'Nada para actualizar' });

      await sequelize.query(
        `UPDATE orden_documentos_expediente SET ${sets.join(', ')} WHERE id = :id`,
        { replacements: repl, type: QueryTypes.UPDATE }
      );
      return res.json({ ok: true, data: { id } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al actualizar requisito' });
    }
  });

  // Reordena: recibe { proceso?, ley, ids: [id1, id2, ...] } en el nuevo orden.
  // Reescribe la columna `orden` (1..N). Usa un offset temporal para no chocar con la UNIQUE.
  router.post('/orden-docs/reordenar', async (req: Request, res: Response) => {
    try {
      const proceso = queryString(req.body?.proceso) || ORDEN_PROCESO_DEFAULT;
      const ley = queryString(req.body?.ley);
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => Number(x)) : [];
      if (!ley) return res.status(400).json({ ok: false, error: 'Falta ley' });
      if (!ids.length || ids.some((n: number) => !Number.isInteger(n) || n <= 0)) {
        return res.status(400).json({ ok: false, error: 'Lista de ids invalida' });
      }
      // Todos los ids deben pertenecer a ese proceso+ley (evita reordenar filas ajenas).
      const actuales = await sequelize.query<{ id: number }>(
        `SELECT id FROM orden_documentos_expediente WHERE proceso = :proceso AND ley = :ley`,
        { replacements: { proceso, ley }, type: QueryTypes.SELECT }
      );
      const setActuales = new Set(actuales.map((r) => r.id));
      if (ids.length !== setActuales.size || ids.some((id: number) => !setActuales.has(id))) {
        return res.status(400).json({ ok: false, error: 'Los ids no coinciden con el proceso/ley' });
      }

      await sequelize.transaction(async (t) => {
        // Paso 1: correr todos a un rango temporal alto para liberar la UNIQUE (proceso,ley,orden).
        for (let i = 0; i < ids.length; i += 1) {
          await sequelize.query(
            `UPDATE orden_documentos_expediente SET orden = :orden WHERE id = :id`,
            { replacements: { orden: 100000 + i, id: ids[i] }, type: QueryTypes.UPDATE, transaction: t }
          );
        }
        // Paso 2: asignar 1..N en el orden recibido.
        for (let i = 0; i < ids.length; i += 1) {
          await sequelize.query(
            `UPDATE orden_documentos_expediente SET orden = :orden WHERE id = :id`,
            { replacements: { orden: i + 1, id: ids[i] }, type: QueryTypes.UPDATE, transaction: t }
          );
        }
      });
      return res.json({ ok: true, data: { ley, total: ids.length } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al reordenar' });
    }
  });

  // Crea, para cada agente de una tanda, las subcarpetas dentro de DOCU\<dni>
  // con el nombre de cada documento ACTIVO del orden (segun la ley del agente).
  // No duplica: si la subcarpeta ya existe, la saltea. Con dryRun no crea nada,
  // solo informa que se crearia. Los DNI sin carpeta o sin ley se reportan aparte.
  router.post('/tandas/crear-subcarpetas', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });

      const agentes = (await listTandaAgentes(sequelize, tanda)) as any[];
      if (!agentes.length) return res.status(404).json({ ok: false, error: 'La tanda no tiene agentes' });

      // Documentos activos por ley (nombre de carpeta = documento del orden).
      const docsRows = await sequelize.query<{ ley: string; documento: string }>(
        `SELECT ley, documento FROM orden_documentos_expediente
          WHERE proceso = :proceso AND activo = 1 ORDER BY ley, orden`,
        { replacements: { proceso: ORDEN_PROCESO_DEFAULT }, type: QueryTypes.SELECT }
      );
      const docsPorLey = new Map<string, string[]>();
      for (const d of docsRows) {
        const arr = docsPorLey.get(d.ley) || [];
        arr.push(d.documento);
        docsPorLey.set(d.ley, arr);
      }

      let creadas = 0;
      let existentes = 0;
      const sinLey: Array<{ dni: number; nombre: string }> = [];
      const sinCarpeta: Array<{ dni: number; nombre: string }> = [];
      const detalle: Array<{ dni: number; nombre: string; ley: string; creadas: number; existentes: number }> = [];

      for (const a of agentes) {
        const dni = Number(a.dni);
        const nombre = String(a.apellidoNombre || `DNI ${dni}`);
        const ley = a.ocupacionLey === '10471' ? '10471' : a.ocupacionLey === '10430' ? '10430' : null;
        if (!ley || !docsPorLey.has(ley)) { sinLey.push({ dni, nombre }); continue; }

        const dir = resolveDocuAgentDir(dni);
        if (!fs.existsSync(dir)) { sinCarpeta.push({ dni, nombre }); continue; }

        let cAg = 0;
        let eAg = 0;
        for (const doc of docsPorLey.get(ley)!) {
          const target = path.join(dir, safeSegment(doc));
          if (fs.existsSync(target)) { eAg += 1; continue; }
          if (!dryRun) fs.mkdirSync(target, { recursive: true });
          cAg += 1;
        }
        creadas += cAg;
        existentes += eAg;
        detalle.push({ dni, nombre, ley, creadas: cAg, existentes: eAg });
      }

      return res.json({
        ok: true,
        data: {
          tanda, dryRun,
          totales: { agentes: detalle.length, creadas, existentes, sinLey: sinLey.length, sinCarpeta: sinCarpeta.length },
          sinLey, sinCarpeta, detalle,
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] crear-subcarpetas error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al crear subcarpetas' });
    }
  });

  // Ordena los archivos sueltos de UN agente: clasifica (nombre + OCR) y mueve a
  // la subcarpeta del documento (DNI/CUIL/Titulo/Matricula/Etico). El front lo
  // llama por cada agente de la tanda para dar progreso (el OCR es lento).
  router.post('/ordenar-archivos-agente', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });

      const dir = resolveDocuAgentDir(dni);
      if (!fs.existsSync(dir)) {
        return res.json({ ok: true, data: { dni, sinCarpeta: true, movidos: 0, detalle: [] } });
      }
      const ents = fs.readdirSync(dir, { withFileTypes: true });
      const subdirs = ents.filter((e) => e.isDirectory()).map((e) => e.name);
      const files = ents.filter((e) => e.isFile()).map((e) => e.name).filter((n) => !CLASIF_IGNORAR.test(n));

      let movidos = 0;
      const detalle: Array<{ archivo: string; resultado: string; tipo?: string; via?: string; destino?: string; motivo?: string }> = [];
      for (const f of files) {
        const fp = path.join(dir, f);
        let { key, veto } = clasifPorNombre(f);
        let via = 'nombre';
        if (!key && !veto && (CLASIF_ES_IMG.test(f) || CLASIF_ES_PDF.test(f))) {
          const txt = await leerTextoDocumento(fp);
          const r = clasifPorTexto(txt);
          key = r.key; veto = r.veto; via = 'ocr';
        }
        if (veto) { detalle.push({ archivo: f, resultado: 'descartado', motivo: veto }); continue; }
        if (!key) continue; // no es de los 5 tipos → queda quieto
        const carpeta = subcarpetaDestino(subdirs, key);
        if (!carpeta) { detalle.push({ archivo: f, resultado: 'sin_subcarpeta', tipo: key }); continue; }
        const dest = uniqueDest(path.join(dir, carpeta, f));
        if (!dryRun) fs.renameSync(fp, dest);
        movidos += 1;
        detalle.push({ archivo: f, resultado: 'movido', tipo: key, via, destino: `${carpeta}/${path.basename(dest)}` });
      }
      return res.json({ ok: true, data: { dni, dryRun, movidos, detalle } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] ordenar-archivos-agente error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al ordenar archivos' });
    }
  });

  // Documentación incompleta: por cada agente de la tanda, lista los documentos
  // (activos, según su ley) cuya subcarpeta está vacía o no existe (sin pdf/tiff/jpg…).
  // Devuelve SOLO los agentes incompletos, con el detalle de qué falta.
  const FALTANTES_ARCHIVO = /\.(pdf|tiff?|jpe?g|png|bmp)$/i;
  router.get('/faltantes', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.query.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });

      const agentes = (await listTandaAgentes(sequelize, tanda)) as any[];
      const docsRows = await sequelize.query<{ ley: string; documento: string }>(
        `SELECT ley, documento FROM orden_documentos_expediente
          WHERE proceso = :proceso AND activo = 1 ORDER BY ley, orden`,
        { replacements: { proceso: ORDEN_PROCESO_DEFAULT }, type: QueryTypes.SELECT }
      );
      const docsPorLey = new Map<string, string[]>();
      for (const d of docsRows) { const a = docsPorLey.get(d.ley) || []; a.push(d.documento); docsPorLey.set(d.ley, a); }

      const incompletos: Array<{ dni: number; nombre: string; ley: string; sinCarpeta: boolean; faltan: string[]; completos: number; total: number }> = [];
      const sinLey: Array<{ dni: number; nombre: string }> = [];

      for (const a of agentes) {
        const dni = Number(a.dni);
        const nombre = String(a.apellidoNombre || `DNI ${dni}`);
        const ley = a.ocupacionLey === '10471' ? '10471' : a.ocupacionLey === '10430' ? '10430' : null;
        if (!ley || !docsPorLey.has(ley)) { sinLey.push({ dni, nombre }); continue; }
        const docs = docsPorLey.get(ley)!;
        const dir = resolveDocuAgentDir(dni);
        if (!fs.existsSync(dir)) {
          incompletos.push({ dni, nombre, ley, sinCarpeta: true, faltan: [...docs], completos: 0, total: docs.length });
          continue;
        }
        const faltan: string[] = [];
        for (const doc of docs) {
          const sub = path.join(dir, safeSegment(doc));
          const tiene = fs.existsSync(sub) && fs.readdirSync(sub).some((f) => FALTANTES_ARCHIVO.test(f));
          if (!tiene) faltan.push(doc);
        }
        if (faltan.length) incompletos.push({ dni, nombre, ley, sinCarpeta: false, faltan, completos: docs.length - faltan.length, total: docs.length });
      }

      // Orden: más faltantes primero.
      incompletos.sort((a, b) => b.faltan.length - a.faltan.length);
      return res.json({
        ok: true,
        data: { tanda, totalAgentes: agentes.length, incompletos, sinLey, completos: agentes.length - incompletos.length - sinLey.length },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] faltantes error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al analizar faltantes' });
    }
  });

  // Combina los archivos (PDF + jpg/png) de las subcarpetas del agente en el orden
  // de la pestaña "Orden de documentos". Devuelve el PDF (base64) + manifiesto de
  // páginas (cada una sabe de qué archivo/página salió, para poder reordenar y guardar).
  router.post('/combinar-agente', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });

      const refs = await fuentesCombinar(sequelize, dni);
      if (!refs.length) {
        return res.status(400).json({ ok: false, error: 'El agente no tiene archivos combinables en las subcarpetas del orden' });
      }

      const merged = await PDFDocument.create();
      const cache = new Map<string, any>();
      const pages: Array<{ id: string; doc: string; rel: string; page: number; archivo: string }> = [];
      const saltados: Array<{ rel: string; motivo: string }> = [];
      for (const ref of refs) {
        try {
          const added = await appendPaginasAlMerged(merged, ref.fp, null, cache);
          for (let p = 0; p < added; p += 1) {
            pages.push({ id: `${ref.rel}#${p}`, doc: ref.doc, rel: ref.rel, page: p, archivo: ref.archivo });
          }
          if (!added) saltados.push({ rel: ref.rel, motivo: 'sin páginas o formato no soportado' });
        } catch (e: any) {
          saltados.push({ rel: ref.rel, motivo: e?.message || 'error al leer' });
        }
      }
      if (!pages.length) {
        return res.status(400).json({ ok: false, error: 'No se pudo combinar ningún archivo' });
      }
      const bytes = await merged.save();
      return res.json({
        ok: true,
        data: { dni, totalPages: pages.length, pages, saltados, pdfBase64: Buffer.from(bytes).toString('base64') },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-agente error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al combinar' });
    }
  });

  // Guarda el combinado en el orden de páginas elegido en:
  // DOCU\<dni>\Tramite de nombramiento\Tramite de nombramiento.pdf (pisa si existe).
  router.post('/combinar-guardar', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const pagesRaw = Array.isArray(req.body?.pages) ? req.body.pages : [];
      const pages = pagesRaw
        .map((p: any) => ({ rel: String(p?.rel || '').replace(/\\/g, '/').trim(), page: Number(p?.page) }))
        .filter((p: any) => p.rel && Number.isInteger(p.page) && p.page >= 0);
      if (!pages.length) return res.status(400).json({ ok: false, error: 'Falta el orden de páginas' });

      const merged = await PDFDocument.create();
      const cache = new Map<string, any>();
      let armadas = 0;
      for (const pg of pages) {
        const fp = resolveInsideDocu(dni, pg.rel); // valida que quede dentro de la carpeta del agente
        if (!fs.existsSync(fp)) continue;
        armadas += await appendPaginasAlMerged(merged, fp, pg.page, cache);
      }
      if (!armadas) return res.status(400).json({ ok: false, error: 'No se armó ninguna página' });

      const destDir = path.join(resolveDocuAgentDir(dni), COMBINAR_NOMBRE_SALIDA);
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, `${COMBINAR_NOMBRE_SALIDA}.pdf`);
      fs.writeFileSync(destPath, Buffer.from(await merged.save()));
      return res.json({ ok: true, data: { dni, paginas: armadas, ruta: `${COMBINAR_NOMBRE_SALIDA}/${COMBINAR_NOMBRE_SALIDA}.pdf` } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-guardar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al guardar el combinado' });
    }
  });

  // Prepara la carpeta del agente / subcarpeta del documento y devuelve la ruta de
  // RED (UNC) para que el front la copie al portapapeles. El Explorador NO se puede
  // abrir desde el servidor (la API vive en la Sesión 0, aislada del escritorio, y
  // menos aún en una PC remota): el usuario pega la ruta en su propio Explorador.
  // Crea la subcarpeta si falta (en Faltantes suele no existir) para poder soltar ahí el archivo.
  router.post('/abrir-carpeta', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });

      const agentDir = resolveDocuAgentDir(dni);
      const doc = String(req.body?.doc || '').trim();
      const seg = doc ? safeSegment(doc) : '';
      // Con doc → subcarpeta del documento (safeSegment evita traversal); sin doc → carpeta del agente.
      const target = seg ? path.join(agentDir, seg) : agentDir;

      // Crea lo que falte (agentDir incluido). En Faltantes la subcarpeta suele no existir.
      const creada = !fs.existsSync(target);
      fs.mkdirSync(target, { recursive: true });

      // Ruta relativa al share (lo que va despues de \\host\). Por defecto, DOCU sin la unidad.
      const uncBaseRel = (String(env.TRAMITES_DOCU_UNC || '').trim()
        || getDocuBaseDir().replace(/^[a-zA-Z]:[\\/]/, ''))
        .replace(/[\\/]+$/, '').replace(/\//g, '\\');
      const uncRel = [uncBaseRel, String(dni), ...(seg ? [seg] : [])].join('\\');

      return res.json({ ok: true, data: { dni, doc: doc || null, ruta: target, uncRel, creada } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] abrir-carpeta error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'No se pudo preparar la carpeta' });
    }
  });

  return router;
}
