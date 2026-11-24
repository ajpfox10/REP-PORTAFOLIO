import fs from 'fs';
import type { Dirent } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { PDFDocument, degrees } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { cacheInvalidateTags } from '../infra/cache';
import { extractTextFromImage } from '../services/ocr.service';
import { oscurecerArchivoBuffer, parseNivel, tocarImagenesDeCarpeta } from '../services/oscurecerImagen';
import { ejecutarAhora, resolverScriptsDir } from '../services/robotsTareasWindows';
import { auditarDocu, ensureDocuAuditoria } from '../services/docuAuditoria';
import { execFile } from 'child_process';
import {
  datosNotaDesignacion, docxDesdeTexto, ensureNotaDesignacionTable, aplicarPlantilla, plantillaDeTanda,
  PLANTILLA_NOTA_DEFAULT, MARCADORES_NOTA, NOTA_DESIG_SUBCARPETA,
} from '../services/notaDesignacionGdeba';

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
      AND r_dep.dependencia_id = ${alias}
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
            LEFT JOIN dependencias dep_serv ON dep_serv.id = r_serv.dependencia_id AND dep_serv.deleted_at IS NULL
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
    const carpeta = carpetaDocumento(d.documento);
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

// Tamaño de página (en puntos) para una foto/escaneo JPG-PNG-TIFF dentro del combinado (19/11/2026).
// Antes se usaba 1 píxel = 1 punto → una hoja de 2480 px quedaba de ~87 × 124 cm al lado de las de
// oficio, y al achicarla en pantalla la letra se veía clara. Ahora el lado corto mide 612 pt (ancho
// carta/oficio) y el otro va según la proporción; la imagen conserva todos sus píxeles (calidad igual).
const ANCHO_HOJA_PT = 612;
function tamanoHojaFoto(wPx: number, hPx: number): [number, number] {
  const corto = Math.min(wPx, hPx) || 1;
  const k = ANCHO_HOJA_PT / corto;
  return [wPx * k, hPx * k];
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
      const [w, h] = tamanoHojaFoto(img.width, img.height);
      const p = merged.addPage([w, h]);
      p.drawImage(img, { x: 0, y: 0, width: w, height: h });
      n += 1;
    }
    return n;
  }
  if (COMBINAR_JPG.test(fp) || COMBINAR_PNG.test(fp)) {
    if (page !== null && page !== 0) return 0;
    const bytes = fs.readFileSync(fp);
    const img = COMBINAR_PNG.test(fp) ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
    const [w, h] = tamanoHojaFoto(img.width, img.height);
    const p = merged.addPage([w, h]);
    p.drawImage(img, { x: 0, y: 0, width: w, height: h });
    return 1;
  }
  return 0;
}

// ── Sacar / rotar hojas del combinado + carpeta "Trasladados" ────────────────
// "Sacar" una hoja la lleva a DOCU\<dni>\Trasladados\<subcarpeta>\ (nunca se borra):
// si el archivo tiene varias hojas, se separa SOLO esa hoja en un PDF aparte y el
// original queda sin ella; si tiene una sola (o es imagen/TIFF), se mueve el archivo.
// "Restaurar" lo devuelve a su subcarpeta de origen (la misma que está bajo Trasladados).
const TRASLADADOS_DIR = 'Trasladados';

// Certificado RDAM: carpeta única del orden de documentos (19/11/2026: antes "RDAM") y vigencia.
const RDAM_CARPETA = 'Libre de deuda (RDAM)';
const RDAM_VIGENCIA_DIAS = 60;
function fechaRdamMs(dni: number, archivo: string): number {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(archivo);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  try { return fs.statSync(resolveInsideDocu(dni, `${RDAM_CARPETA}/${archivo}`)).mtimeMs; } catch { return 0; }
}

// Nombre que no pise nada en `dir`: "x.pdf" → "x (2).pdf", "x (3).pdf"…
function nombreLibre(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let cand = fileName;
  for (let n = 2; fs.existsSync(path.join(dir, cand)); n += 1) cand = `${base} (${n})${ext}`;
  return cand;
}

function moverArchivo(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (e: any) {
    if (e?.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

// Escribe por archivo temporal + rename para no dejar el original a medio escribir.
function escribirAtomico(fp: string, buf: Buffer | Uint8Array): void {
  const tmp = `${fp}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, buf);
  try { fs.renameSync(tmp, fp); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* noop */ } throw e; }
}

// "<subcarpeta>/<archivo>" de una fuente del combinado (no puede estar en Trasladados).
function fuenteCombinarRel(dni: number, relRaw: unknown): { carpeta: string; archivo: string; fp: string } {
  const partes = String(relRaw || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (partes.length !== 2 || partes[0].toLowerCase() === TRASLADADOS_DIR.toLowerCase()) {
    throw Object.assign(new Error('Archivo inválido'), { status: 400 });
  }
  const carpeta = safeSegment(partes[0]);
  const archivo = safeSegment(partes[1]);
  const fp = resolveInsideDocu(dni, `${carpeta}/${archivo}`);
  if (!fs.existsSync(fp)) throw Object.assign(new Error('El archivo ya no existe'), { status: 404 });
  return { carpeta, archivo, fp };
}

// "Trasladados/<subcarpeta>/<archivo>" → ruta validada.
function trasladadoRel(dni: number, relRaw: unknown): { carpeta: string; archivo: string; fp: string } {
  const partes = String(relRaw || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (partes.length !== 3 || partes[0].toLowerCase() !== TRASLADADOS_DIR.toLowerCase()) {
    throw Object.assign(new Error('Archivo trasladado inválido'), { status: 400 });
  }
  const carpeta = safeSegment(partes[1]);
  const archivo = safeSegment(partes[2]);
  const fp = resolveInsideDocu(dni, `${TRASLADADOS_DIR}/${carpeta}/${archivo}`);
  if (!fs.existsSync(fp)) throw Object.assign(new Error('El archivo ya no existe'), { status: 404 });
  return { carpeta, archivo, fp };
}

async function cargarPdfEditable(fp: string): Promise<PDFDocument> {
  const src = await PDFDocument.load(fs.readFileSync(fp), { ignoreEncryption: true });
  if (src.isEncrypted) throw Object.assign(new Error('El PDF está protegido; no se puede modificar'), { status: 400 });
  return src;
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

// Tabla del envío de combinados a GDEBA (misma DDL que la mig 131; se crea sola en prod).
const ensuredCombinadoGdeba = new WeakSet<Sequelize>();
async function ensureCombinadoGdebaTable(sequelize: Sequelize): Promise<void> {
  if (ensuredCombinadoGdeba.has(sequelize)) return;
  await sequelize.query(`CREATE TABLE IF NOT EXISTS tramites_combinado_gdeba (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dni INT NOT NULL,
  archivo VARCHAR(500) NOT NULL,
  estado ENUM('PENDIENTE','ENVIADA_FIRMA','FIRMADA','ERROR') NOT NULL DEFAULT 'PENDIENTE',
  firmante VARCHAR(60) NULL,
  gdeba_numero VARCHAR(80) NULL,
  gdeba_error VARCHAR(500) NULL,
  enviada_at DATETIME NULL,
  estado_at DATETIME NULL,
  estado_por INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_comb_gdeba_archivo (archivo),
  KEY ix_comb_gdeba_dni (dni),
  KEY ix_comb_gdeba_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // mig 132: PDF firmado bajado de GDEBA
  const cols = await sequelize.query<any>(`SHOW COLUMNS FROM tramites_combinado_gdeba`, { type: QueryTypes.SELECT });
  const tiene = new Set(cols.map((c: any) => String(c.Field)));
  if (!tiene.has('archivo_firmado')) {
    await sequelize.query(`ALTER TABLE tramites_combinado_gdeba ADD COLUMN archivo_firmado VARCHAR(500) NULL AFTER gdeba_numero`);
  }
  if (!tiene.has('firmada_at')) {
    await sequelize.query(`ALTER TABLE tramites_combinado_gdeba ADD COLUMN firmada_at DATETIME NULL AFTER enviada_at`);
  }
  ensuredCombinadoGdeba.add(sequelize);
}

// "<dni>/Tramite de nombramiento/<x>.pdf" → ruta absoluta validada (solo PDFs de esa subcarpeta).
function resolverCombinado(archivo: string): string {
  const partes = String(archivo || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (partes.length !== 3 || !/^\d{6,9}$/.test(partes[0]) || partes[1] !== COMBINAR_NOMBRE_SALIDA
      || !partes[2].toLowerCase().endsWith('.pdf') || partes[2].includes('..')) {
    throw Object.assign(new Error('Archivo de combinado inválido'), { status: 400 });
  }
  const base = path.resolve(getDocuBaseDir());
  const full = path.resolve(base, partes[0], partes[1], partes[2]);
  const rel = path.relative(base, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw Object.assign(new Error('Ruta insegura'), { status: 400 });
  if (!fs.existsSync(full)) throw Object.assign(new Error('El PDF ya no existe'), { status: 404 });
  return full;
}
// Anota un combinado en la tabla (PENDIENTE) si no estaba. Si ya estaba y se vuelve a
// guardar (mismo nombre = se pisó el PDF), un ERROR vuelve a PENDIENTE para reintentar.
async function registrarCombinado(sequelize: Sequelize, dni: number, archivo: string): Promise<void> {
  await ensureCombinadoGdebaTable(sequelize);
  await sequelize.query(
    `INSERT INTO tramites_combinado_gdeba (dni, archivo, estado) VALUES (:dni, :archivo, 'PENDIENTE')
     ON DUPLICATE KEY UPDATE estado = IF(estado = 'ERROR', 'PENDIENTE', estado)`,
    { replacements: { dni, archivo } },
  );
}
function archivoRelCombinado(fullPath: string): string {
  return path.relative(path.resolve(getDocuBaseDir()), fullPath).replace(/\\/g, '/');
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
       (dni, numero, anio, caratula, fecha, estado, created_by, created_at)
     VALUES
       (:dni, :numero,
        COALESCE(CAST(REGEXP_SUBSTR(:numero, '(?<![0-9])(19|20)[0-9]{2}(?![0-9])') AS UNSIGNED), YEAR(:fecha)),
        :caratula, :fecha, :estado, :createdBy, :createdAt)`,
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
        LEFT JOIN dependencias dep_serv ON dep_serv.id = r_serv.dependencia_id AND dep_serv.deleted_at IS NULL
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
        t.id, t.tanda, t.dni, t.estado, t.creado_at AS creadoAt, t.origen, t.anio,
        t.ley_14783 AS ley14783,
        t.ley_10592 AS ley10592,
        TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) AS apellidoNombre,
        DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fechaIngreso,
        oc.nombre AS ocupacionNombre,
        COALESCE(nagr.nombre, oc.agrupamiento) AS ocupacionAgrupamiento,
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
          LEFT JOIN dependencias dep_serv ON dep_serv.id = r_serv.dependencia_id AND dep_serv.deleted_at IS NULL
          WHERE ags_serv.dni = t.dni
            AND ags_serv.deleted_at IS NULL
            AND (ags_serv.fecha_hasta IS NULL OR ags_serv.fecha_hasta >= CURDATE())
          ORDER BY ags_serv.fecha_desde DESC, ags_serv.id DESC
          LIMIT 1
        ) AS dependenciaNombre
      FROM tramites_tanda_interinos t
      JOIN personal p ON p.dni = t.dni AND p.deleted_at IS NULL
      -- Una sola fila de agentes por DNI (el DNI no es unico en agentes: hay
      -- varios tramos de carrera). Se elige el tramo vigente: ACTIVO primero,
      -- si no el mas reciente. Evita que el agente se duplique en la lista.
      LEFT JOIN agentes a ON a.id = (
        SELECT a2.id
        FROM agentes a2
        WHERE a2.dni = t.dni AND a2.deleted_at IS NULL
        ORDER BY (a2.estado_empleo = 'ACTIVO') DESC, a2.fecha_ingreso DESC, a2.id DESC
        LIMIT 1
      )
      LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
      LEFT JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
      LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
      LEFT JOIN ley ocl ON ocl.id = oc.ley_id AND ocl.deleted_at IS NULL
      LEFT JOIN nomenclador_agrupamientos nagr ON nagr.id = oc.agrupamiento_id
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

// Nombre de la subcarpeta de DOCU para un documento del orden. Las barras del nombre pasan a "_"
// ("DNI hijo/as (Solo Extranjeros)" → "DNI hijo_as (Solo Extranjeros)", como las arma el robot
// pase_planta y las carpetas hechas a mano). Antes se cortaba en la barra y quedaba "as (Solo
// Extranjeros)" (21/11/2026).
function carpetaDocumento(documento: string): string {
  return safeSegment(String(documento || '').replace(/[\\/]/g, '_'));
}

// ---- Documentos que le corresponden a cada agente (Faltantes + subcarpetas) ----
// "(Solo chofer/es)": chofer por ocupación o por el Google Form de designación (es_chofer = 1).
const DOC_SOLO_CHOFER = /\(\s*solo\s+chofer(es)?\s*\)/i;
// "(Solo Extranjeros)" y la Carta de ciudadanía (no lo dice en el nombre): solo extranjeros.
const DOC_SOLO_EXTRANJERO = /\(\s*solo\s+extranjer[oa]s?\s*\)|carta\s+de\s+ciudadan/i;
// Ético y Matrícula en la 10430: solo técnicos y profesionales (en la 10471 a todos).
const DOC_ETICO = /^\s*[eé]tico\b/i;
const DOC_MATRICULA = /^\s*matr[ií]cula\b/i;
// Anexo 1 Ley 14783 y el certificado de nacimiento que lo acompaña: solo con el tilde 14783 de la tanda.
const DOC_LEY_14783 = /14783|acompa[nñ]a\s+anexo\s*1/i;
// Certificado de discapacidad: solo con el tilde Ley 10592 de la tanda.
const DOC_LEY_10592 = /discapacidad|10592/i;

type AgenteDocs = {
  dni: number | string;
  ocupacionLey?: string | null;
  ocupacionNombre?: string | null;
  ocupacionAgrupamiento?: string | null;
  ley14783?: number | string | null;
  ley10592?: number | string | null;
};

// Por cada agente (filas de listTandaAgentes): su ley y los documentos activos del orden que le
// corresponden, en orden. null = sin ley 10430/10471 (no se le puede armar la lista).
async function documentosPorAgente(
  sequelize: Sequelize,
  agentes: AgenteDocs[],
): Promise<Map<number, { ley: string; docs: string[] } | null>> {
  const docsRows = await sequelize.query<{ ley: string; documento: string }>(
    `SELECT ley, documento FROM orden_documentos_expediente
      WHERE proceso = :proceso AND activo = 1 ORDER BY ley, orden`,
    { replacements: { proceso: 'PASE A TRANSITORIA' }, type: QueryTypes.SELECT }
  );
  const docsPorLey = new Map<string, string[]>();
  for (const d of docsRows) { const a = docsPorLey.get(d.ley) || []; a.push(d.documento); docsPorLey.set(d.ley, a); }

  const dnis = Array.from(new Set(agentes.map((a) => Number(a.dni)).filter(Boolean)));
  const choferPorForm = new Set<number>();
  // Extranjero = DNI de 90 millones o más, o nacionalidad (personal) / país de nacimiento (legajo)
  // cargado y distinto de Argentina. Sin dato y DNI < 90M → argentino.
  const extranjeros = new Set<number>(dnis.filter((d) => d >= 90_000_000));
  if (dnis.length) {
    const fr = await sequelize.query<{ dni: number }>(
      `SELECT dni FROM designacion_form_datos WHERE es_chofer = 1 AND dni IN (:dnis)`,
      { replacements: { dnis }, type: QueryTypes.SELECT }
    );
    for (const r of fr) choferPorForm.add(Number(r.dni));
    const nr = await sequelize.query<{ dni: number; nacionalidad: string | null; nac_pais: string | null }>(
      `SELECT p.dni, p.nacionalidad, l.nac_pais
         FROM personal p
         LEFT JOIN legajo_datos_personales l ON l.dni = p.dni
        WHERE p.dni IN (:dnis) AND p.deleted_at IS NULL`,
      { replacements: { dnis }, type: QueryTypes.SELECT }
    );
    // Solo cuenta un valor con letras que no sea Argentina (descarta basura tipo "23213" o "Si").
    const esOtroPais = (v: string | null) => {
      const s = String(v || '').trim();
      return /^[a-záéíóúñ ]{3,}$/i.test(s) && !/^argentin/i.test(s) && !/^(si|sí|no)$/i.test(s);
    };
    for (const r of nr) if (esOtroPais(r.nacionalidad) || esOtroPais(r.nac_pais)) extranjeros.add(Number(r.dni));
  }

  const out = new Map<number, { ley: string; docs: string[] } | null>();
  for (const a of agentes) {
    const dni = Number(a.dni);
    const ley = a.ocupacionLey === '10471' ? '10471' : a.ocupacionLey === '10430' ? '10430' : null;
    if (!ley || !docsPorLey.has(ley)) { out.set(dni, null); continue; }
    const esChofer = /chofer/i.test(String(a.ocupacionNombre || '')) || choferPorForm.has(dni);
    const esExtranjero = extranjeros.has(dni);
    // Sin agrupamiento conocido se sigue pidiendo el Ético/Matrícula.
    const agrup = String(a.ocupacionAgrupamiento || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const pideEtico = ley !== '10430' || !agrup || /TECNIC|PROFESION/.test(agrup);
    const docs = docsPorLey.get(ley)!.filter((d) =>
      (esChofer || !DOC_SOLO_CHOFER.test(d))
      && (esExtranjero || !DOC_SOLO_EXTRANJERO.test(d))
      && (pideEtico || (!DOC_ETICO.test(d) && !DOC_MATRICULA.test(d)))
      && (Number(a.ley14783) === 1 || !DOC_LEY_14783.test(d))
      && (Number(a.ley10592) === 1 || !DOC_LEY_10592.test(d)));
    out.set(dni, { ley, docs });
  }
  return out;
}

type ResultadoSubcarpetas = {
  creadas: number;
  existentes: number;
  sinLey: Array<{ dni: number; nombre: string }>;
  sinCarpeta: Array<{ dni: number; nombre: string }>;
  detalle: Array<{ dni: number; nombre: string; ley: string; creadas: number; existentes: number }>;
};

// Crea en DOCU\<dni> las subcarpetas de los documentos que le corresponden a cada agente
// (documentosPorAgente). Si el agente todavía no tiene DOCU\<dni> no se crea nada (sinCarpeta),
// igual que antes. Nunca borra ni renombra: lo que ya existe queda como está. dryRun = solo cuenta.
async function crearSubcarpetasAgentes(
  sequelize: Sequelize,
  agentes: Array<AgenteDocs & { apellidoNombre?: string | null }>,
  dryRun = false,
): Promise<ResultadoSubcarpetas> {
  const porAgente = await documentosPorAgente(sequelize, agentes);
  const res: ResultadoSubcarpetas = { creadas: 0, existentes: 0, sinLey: [], sinCarpeta: [], detalle: [] };
  for (const a of agentes) {
    const dni = Number(a.dni);
    const nombre = String(a.apellidoNombre || `DNI ${dni}`);
    const info = porAgente.get(dni);
    if (!info) { res.sinLey.push({ dni, nombre }); continue; }
    const dir = resolveDocuAgentDir(dni);
    if (!fs.existsSync(dir)) { res.sinCarpeta.push({ dni, nombre }); continue; }
    let c = 0;
    let e = 0;
    for (const doc of info.docs) {
      const target = path.join(dir, carpetaDocumento(doc));
      if (fs.existsSync(target)) { e += 1; continue; }
      if (!dryRun) fs.mkdirSync(target, { recursive: true });
      c += 1;
    }
    res.creadas += c;
    res.existentes += e;
    res.detalle.push({ dni, nombre, ley: info.ley, creadas: c, existentes: e });
  }
  return res;
}

// Tandas que se llenan solas desde MySQL (EVENT ev_tanda_temporarios_10430, origen 'auto'): no pasan
// por POST /tandas, así que cada 30 min se les arman las subcarpetas que les corresponden a esos
// agentes (21/11/2026). Idempotente: solo crea las que faltan, nunca borra. Saltea a los 'aprobado'
// (trámite terminado). Solo en producción: dev usa otra base pero el mismo D:\G\DOCU.
let subcarpetasAutoIniciado = false;
let subcarpetasAutoCorriendo = false;
async function subcarpetasTandasAuto(sequelize: Sequelize): Promise<void> {
  if (subcarpetasAutoCorriendo) return;
  subcarpetasAutoCorriendo = true;
  try {
    const tandas = await sequelize.query<{ tanda: string }>(
      `SELECT DISTINCT tanda FROM tramites_tanda_interinos WHERE origen = 'auto'`,
      { type: QueryTypes.SELECT }
    );
    for (const { tanda } of tandas) {
      const agentes = ((await listTandaAgentes(sequelize, tanda)) as any[])
        .filter((a) => a.origen === 'auto' && a.estado !== 'aprobado');
      if (!agentes.length) continue;
      const r = await crearSubcarpetasAgentes(sequelize, agentes);
      if (r.creadas) {
        logger.info({ msg: '[tramites] subcarpetas tanda auto', tanda, creadas: r.creadas,
          agentes: r.detalle.filter((d) => d.creadas).map((d) => d.dni) });
      }
    }
  } catch (e: any) {
    logger.error({ msg: '[tramites] subcarpetas tanda auto error', error: e?.message });
  } finally {
    subcarpetasAutoCorriendo = false;
  }
}
function iniciarSubcarpetasTandasAuto(sequelize: Sequelize): void {
  if (subcarpetasAutoIniciado || env.NODE_ENV !== 'production') return;
  subcarpetasAutoIniciado = true;
  const correr = () => { void subcarpetasTandasAuto(sequelize); };
  setTimeout(correr, 60_000).unref();
  setInterval(correr, 30 * 60_000).unref();
}

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

// Estado del trámite de cada agente en la tanda (marca manual, en orden del trámite).
const ESTADOS_TANDA = ['pendiente', 'falta documentacion', 'carpeta completa', 'presentado', 'observado', 'aprobado'];

// Multer propio para subir a DOCU: en memoria (buffers) y varios archivos.
const docuUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.DOCUMENTS_MAX_BYTES || 25 * 1024 * 1024, files: 20 },
});

export function buildTramitesDocumentalesRouter(sequelize: Sequelize) {
  const router = Router();

  // Subcarpetas de DOCU para los agentes que entran solos a una tanda (EVENT de MySQL).
  iniciarSubcarpetasTandasAuto(sequelize);

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
          origen     VARCHAR(10)  NOT NULL DEFAULT 'anio',
          anio       SMALLINT     NULL,
          UNIQUE KEY uq_tanda_dni (tanda, dni),
          KEY idx_tti_dni (dni),
          CONSTRAINT fk_tti_personal_dni FOREIGN KEY (dni) REFERENCES personal (dni)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      // origen: 'anio' (vino de la consulta por año, `anio` = año de ingreso) o 'manual'
      // (agregado de a uno con el buscador). Para tablas creadas antes de estas columnas.
      const cols = await sequelize.query<{ c: string }>(
        `SELECT column_name AS c FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'tramites_tanda_interinos'`,
        { type: QueryTypes.SELECT }
      );
      const have = new Set(cols.map((r) => String(r.c).toLowerCase()));
      if (!have.has('origen')) {
        await sequelize.query(`ALTER TABLE tramites_tanda_interinos ADD COLUMN origen VARCHAR(10) NOT NULL DEFAULT 'anio'`);
      }
      if (!have.has('anio')) {
        await sequelize.query(`ALTER TABLE tramites_tanda_interinos ADD COLUMN anio SMALLINT NULL`);
      }
      // ley_14783 = 1: el agente entra por la Ley 14783 → se le pide el Anexo 1 y
      // el certificado de nacimiento que lo acompaña (tilde en la pestaña Trámites).
      if (!have.has('ley_14783')) {
        await sequelize.query(`ALTER TABLE tramites_tanda_interinos ADD COLUMN ley_14783 TINYINT(1) NOT NULL DEFAULT 0`);
      }
      // ley_10592 = 1: entra por la Ley 10592 (discapacidad, PBA) → se le pide el
      // Certificado de discapacidad (mig 130).
      if (!have.has('ley_10592')) {
        await sequelize.query(`ALTER TABLE tramites_tanda_interinos ADD COLUMN ley_10592 TINYINT(1) NOT NULL DEFAULT 0`);
      }
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
  // Exámenes de aptitud de SIAPE desde la tabla examenes_medicos_siape (mig 100),
  // que llena la exportación "Examenes Médicos Salud" (acumula, no borra) y el
  // robot de certificados. Antes leía D:\G\APTOS\APTOS.xlsx (copia a mano).
  // Cruza con la base: por DNI trae ley, planta, ocupación y estado del agente.
  // Los que no están en personal salen con en_sistema=false.
  router.get('/aptos', async (_req: Request, res: Response) => {
    const ORIGEN = 'tabla examenes_medicos_siape';
    try {
      const raw = await sequelize.query<any>(
        `SELECT codigo_examen, dni, apellido, nombre, cuil, tipo_examen, modalidad,
                DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, fecha_origen, estado_examen, resolucion, tipo_tramite
         FROM examenes_medicos_siape
         ORDER BY apellido, nombre, fecha`,
        { type: QueryTypes.SELECT }
      );

      const rows = raw.map((r: any) => ({
        dni:        Number(r.dni) || 0,
        apellido:   String(r.apellido ?? '').trim(),
        nombre:     String(r.nombre ?? '').trim(),
        cuil:       String(r.cuil ?? '').trim(),
        codigo:     String(r.codigo_examen ?? '').trim(),
        tipo:       String(r.tipo_examen ?? '').trim(),
        modalidad:  String(r.modalidad ?? '').trim(),
        fecha:      String(r.fecha ?? '').trim(),
        // 'certificado' = SIAPE sin FECHA, se tomó la de emisión del certificado (mig 101)
        fecha_origen: String(r.fecha_origen ?? '').trim(),
        estado_examen: String(r.estado_examen ?? '').trim(),
        resolucion: String(r.resolucion ?? '').trim(),
        tipo_tramite: String(r.tipo_tramite ?? '').trim(),
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

      return res.json({ ok: true, data: { rows, existe: rows.length > 0, path: ORIGEN } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] aptos error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al leer examenes_medicos_siape' });
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

  // Antecedentes recibidos por mail (robot gmail_antecedentes) con la tanda de cada agente
  // y si es extranjero (misma regla que Faltantes: DNI >= 90M, o nacionalidad / país de
  // nacimiento cargado y distinto de Argentina). Todos los ítems; el front filtra por año del mail.
  router.get('/antecedentes-recibidos', async (_req: Request, res: Response) => {
    try {
      const items = await sequelize.query<any>(
        `SELECT i.id, i.dni, i.nombre, i.novedad, i.estado, i.detalle, i.creado_at
           FROM script_run_items i
          WHERE i.script = 'gmail_antecedentes'
          ORDER BY i.id DESC
          LIMIT 20000`,
        { type: QueryTypes.SELECT },
      );
      const dnis = Array.from(new Set(items.map((r: any) => Number(String(r.dni || '').replace(/\D/g, ''))).filter((d) => d > 0)));
      const tandasPorDni = new Map<number, string[]>();
      const extranjeros = new Set<number>(dnis.filter((d) => d >= 90_000_000));
      if (dnis.length) {
        const tr = await sequelize.query<{ dni: number; tanda: string }>(
          `SELECT dni, tanda FROM tramites_tanda_interinos WHERE dni IN (:dnis) ORDER BY tanda`,
          { replacements: { dnis }, type: QueryTypes.SELECT },
        );
        for (const r of tr) {
          const k = Number(r.dni);
          if (!tandasPorDni.has(k)) tandasPorDni.set(k, []);
          tandasPorDni.get(k)!.push(r.tanda);
        }
        const nr = await sequelize.query<{ dni: number; nacionalidad: string | null; nac_pais: string | null }>(
          `SELECT p.dni, p.nacionalidad, l.nac_pais
             FROM personal p
             LEFT JOIN legajo_datos_personales l ON l.dni = p.dni
            WHERE p.dni IN (:dnis) AND p.deleted_at IS NULL`,
          { replacements: { dnis }, type: QueryTypes.SELECT },
        );
        const esOtroPais = (v: string | null) => {
          const s = String(v || '').trim();
          return /^[a-záéíóúñ ]{3,}$/i.test(s) && !/^argentin/i.test(s) && !/^(si|sí|no)$/i.test(s);
        };
        for (const r of nr) if (esOtroPais(r.nacionalidad) || esOtroPais(r.nac_pais)) extranjeros.add(Number(r.dni));
      }
      // "Extranjeros" para RRHH = becarios del Programa Beca de Radicación para Profesionales
      // Extranjeros (ley_id 12), no cualquier DNI >= 90M (17/11/2026). Vigentes = ACTIVO / TRAMITE /
      // COMISION. Con lo recibido por mail de cada uno, para el bloque "Faltan" del panel.
      const becarios = await sequelize.query<{ dni: number; nombre: string; estado: string }>(
        `SELECT a.dni, TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) AS nombre,
                MIN(a.estado_empleo) AS estado
           FROM agentes a
           JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
          WHERE a.ley_id = 12 AND a.deleted_at IS NULL AND a.estado_empleo IN ('ACTIVO', 'TRAMITE', 'COMISION')
          GROUP BY a.dni, p.apellido, p.nombre
          ORDER BY p.apellido, p.nombre`,
        { type: QueryTypes.SELECT },
      );
      const radicacion = new Set<number>(becarios.map((b) => Number(b.dni)));
      const recibidoPorDni = new Map<number, Record<string, string>>();
      for (const r of items as any[]) {
        const d = Number(String(r.dni || '').replace(/\D/g, ''));
        if (!d || !radicacion.has(d) || r.estado === 'error') continue;
        const tipo = String(r.novedad || '').split(' · ')[0].replace(/^Antecedentes\s*/i, '').trim().toLowerCase();
        if (!tipo || tipo === '?') continue;
        const m = recibidoPorDni.get(d) || {};
        const f = String(r.creado_at instanceof Date ? r.creado_at.toISOString() : r.creado_at);
        if (!m[tipo] || f > m[tipo]) m[tipo] = f;   // el más reciente de cada tipo
        recibidoPorDni.set(d, m);
      }
      const tandasBecarios = new Map<number, string[]>();
      if (becarios.length) {
        const tb = await sequelize.query<{ dni: number; tanda: string }>(
          `SELECT dni, tanda FROM tramites_tanda_interinos WHERE dni IN (:dnis) ORDER BY tanda`,
          { replacements: { dnis: Array.from(radicacion) }, type: QueryTypes.SELECT },
        );
        for (const r of tb) {
          const k = Number(r.dni);
          if (!tandasBecarios.has(k)) tandasBecarios.set(k, []);
          tandasBecarios.get(k)!.push(r.tanda);
        }
      }
      const data = items.map((r: any) => {
        const d = Number(String(r.dni || '').replace(/\D/g, ''));
        return {
          ...r, tandas: d ? tandasPorDni.get(d) || [] : [], extranjero: d ? extranjeros.has(d) : false,
          radicacion: d ? radicacion.has(d) : false,
        };
      });
      const becariosRadicacion = becarios.map((b) => ({
        dni: Number(b.dni), nombre: b.nombre, estado: b.estado,
        tandas: tandasBecarios.get(Number(b.dni)) || [],
        recibidos: recibidoPorDni.get(Number(b.dni)) || {},
      }));
      return res.json({ ok: true, data, becariosRadicacion });
    } catch (err: any) {
      logger.error({ msg: '[tramites] antecedentes-recibidos error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // Agregar agentes a una tanda (INSERT IGNORE → no duplica por UNIQUE(tanda,dni)).
  // Body: { tanda, origen: 'anio'|'manual', items: [{ dni, anio }] } (o `dnis` como antes).
  router.post('/tandas', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta el nombre de la tanda' });
      const origen = req.body?.origen === 'manual' ? 'manual' : 'anio';
      const raw: unknown[] = Array.isArray(req.body?.items)
        ? req.body.items
        : Array.isArray(req.body?.dnis) ? (req.body.dnis as unknown[]).map((dni) => ({ dni })) : [];
      const porDni = new Map<number, number | null>();
      for (const it of raw as any[]) {
        const dni = parseDni(it?.dni);
        if (dni && !porDni.has(dni)) porDni.set(dni, parseYear(it?.anio));
      }
      if (!porDni.size) return res.status(400).json({ ok: false, error: 'No hay DNIs válidos para agregar' });
      const items = Array.from(porDni.entries());
      await sequelize.query(
        `INSERT IGNORE INTO tramites_tanda_interinos (tanda, dni, origen, anio) VALUES ${items.map(() => '(?, ?, ?, ?)').join(', ')}`,
        { replacements: items.flatMap(([dni, anio]) => [tanda, dni, origen, anio]), type: QueryTypes.INSERT }
      );
      const rows = (await listTandaAgentes(sequelize, tanda)) as any[];
      // A los que se acaban de sumar se les arman en DOCU\<dni> las subcarpetas de los documentos
      // que les corresponden (21/11/2026). Si falla no se pierde la tanda: solo se avisa.
      let subcarpetas: { creadas: number; existentes: number; sinLey: number; sinCarpeta: number; error?: string } | null = null;
      try {
        const nuevos = rows.filter((r) => porDni.has(Number(r.dni)));
        const r = await crearSubcarpetasAgentes(sequelize, nuevos);
        subcarpetas = { creadas: r.creadas, existentes: r.existentes, sinLey: r.sinLey.length, sinCarpeta: r.sinCarpeta.length };
      } catch (e: any) {
        logger.error({ msg: '[tramites] tandas POST subcarpetas error', error: e?.message });
        subcarpetas = { creadas: 0, existentes: 0, sinLey: 0, sinCarpeta: 0, error: e?.message || 'Error al crear subcarpetas' };
      }
      return res.json({ ok: true, data: { tanda, rows, agregados: items.length, subcarpetas } });
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

  // Buscador para agregar agentes de a uno: por DNI (prefijo) o por apellido/nombre
  // (todas las palabras). Devuelve el tramo vigente (ACTIVO primero) para mostrar ley/planta.
  router.get('/buscar-agente', async (req: Request, res: Response) => {
    try {
      const q = String(queryString(req.query.q) || '').trim();
      if (q.length < 2) return res.json({ ok: true, data: { rows: [] } });
      const replacements: Record<string, string> = {};
      let where: string;
      if (/^\d+$/.test(q)) {
        where = 'CAST(p.dni AS CHAR) LIKE :dniLike';
        replacements.dniLike = `${q}%`;
      } else {
        const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
        where = words.map((w, i) => {
          replacements[`w${i}`] = `%${w}%`;
          return `CONCAT(COALESCE(p.apellido, ''), ' ', COALESCE(p.nombre, '')) LIKE :w${i}`;
        }).join(' AND ');
      }
      const rows = await sequelize.query(
        `
          SELECT
            p.dni,
            TRIM(CONCAT(COALESCE(p.apellido, ''), ', ', COALESCE(p.nombre, ''))) AS apellidoNombre,
            DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fechaIngreso,
            l.nombre  AS leyNombre,
            pl.nombre AS plantaNombre,
            a.estado_empleo AS estadoEmpleo
          FROM personal p
          LEFT JOIN agentes a ON a.id = (
            SELECT a2.id FROM agentes a2
            WHERE a2.dni = p.dni AND a2.deleted_at IS NULL
            ORDER BY (a2.estado_empleo = 'ACTIVO') DESC, a2.fecha_ingreso DESC, a2.id DESC
            LIMIT 1
          )
          LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
          LEFT JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
          WHERE p.deleted_at IS NULL AND ${where}
          ORDER BY (a.estado_empleo = 'ACTIVO') DESC, apellidoNombre ASC
          LIMIT 20
        `,
        { replacements, type: QueryTypes.SELECT }
      );
      return res.json({ ok: true, data: { rows } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] buscar-agente error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al buscar agente' });
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
      {
        const base = resolveDocuAgentDir(dni);
        const destRel = path.relative(base, dest);
        auditarDocu(sequelize, req, [{
          dni, ruta: path.join(String(dni), destRel), documento: path.dirname(destRel) === '.' ? null : path.dirname(destRel),
          origen: 'movido', detalle: `desde ${path.relative(base, from)}${fromIsDir ? ' (carpeta)' : ''}`,
        }]);
      }
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
      const base = resolveDocuAgentDir(dni);
      const carpeta = path.relative(base, folder) || null;
      // quien sube puede decir que es un robot/extensión (ej. 'rdam', 'cuil_anses'): queda como origen robot
      const robot = String(req.body?.robot || '').replace(/[^\w .-]/g, '').slice(0, 80) || null;
      for (const file of files) {
        const name = safeSegment(file.originalname);
        const dest = uniqueDest(path.join(folder, name));
        fs.writeFileSync(dest, file.buffer);
        saved.push(path.basename(dest));
      }
      auditarDocu(sequelize, req, saved.map((n) => ({
        dni, ruta: path.join(String(dni), carpeta || '', n), documento: carpeta,
        origen: robot ? 'robot' as const : 'subida' as const, robot,
        detalle: files.length === 1 && files[0].originalname !== n ? `original: ${files[0].originalname}` : null,
      })));
      return res.json({ ok: true, data: { saved, total: saved.length } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al subir archivos' });
    }
  });

  // Después de guardar un certificado RDAM nuevo en DOCU\<dni>\Libre de deuda (RDAM): todo lo demás
  // de esa carpeta pasa a DOCU\<dni>\Trasladados\Libre de deuda (RDAM)\ (nunca se borra; se recupera
  // en ♻️ Restaurar). Body: { dni, conservar }. (19/11/2026: antes borraba en la carpeta "RDAM".)
  router.post('/docu-rdam-limpiar', (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const conservar = path.basename(String(req.body?.conservar || ''));
      if (!conservar) return res.status(400).json({ ok: false, error: 'Falta el archivo a conservar' });
      const dir = resolveInsideDocu(dni, RDAM_CARPETA);
      if (!fs.existsSync(path.join(dir, conservar))) {
        return res.status(400).json({ ok: false, error: 'El certificado nuevo no está en la carpeta: no se traslada nada' });
      }
      const destDir = path.join(resolveDocuAgentDir(dni), TRASLADADOS_DIR, RDAM_CARPETA);
      const trasladados: string[] = [];
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (f === conservar || /^thumbs\.db$/i.test(f) || !fs.statSync(full).isFile()) continue;
        fs.mkdirSync(destDir, { recursive: true });
        moverArchivo(full, path.join(destDir, nombreLibre(destDir, f)));
        trasladados.push(f);
      }
      // `borrados` se mantiene por compatibilidad con el front viejo (ahora se trasladan, no se borran)
      return res.json({ ok: true, data: { trasladados, borrados: trasladados } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al borrar' });
    }
  });

  // Agentes de la tanda para bajar la constancia de CUIL de ANSES o el certificado RDAM (lo hace la
  // extensión de Chrome desde la PC del usuario: ANSES bloquea al servidor y el RDAM pide captcha
  // en el login). Devuelve los datos que piden los formularios y si ya hay algo en la subcarpeta
  // de DOCU (?carpeta=CUIL por defecto, o RDAM). En vez de la tanda acepta ?dnis=1,2,3 (agentes
  // sueltos de la base, sin tanda).
  router.get('/tandas/cuil-pendientes', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.query.tanda);
      const dnis = Array.from(new Set(String(queryString(req.query.dnis) || '').split(/[^\d]+/)
        .map((d) => parseDni(d)).filter((d): d is number => !!d))).slice(0, 500);
      if (!tanda && !dnis.length) return res.status(400).json({ ok: false, error: 'Falta la tanda o los DNI' });
      const esRdam = queryString(req.query.carpeta) === 'RDAM';
      const carpeta = esRdam ? RDAM_CARPETA : 'CUIL';
      const limiteRdam = Date.now() - RDAM_VIGENCIA_DIAS * 86400000;
      const rows = await sequelize.query<any>(
        dnis.length
          ? `
          SELECT p.dni, p.apellido, p.nombre, p.cuil,
                 DATE_FORMAT(p.fecha_nacimiento, '%Y-%m-%d') AS fechaNacimiento,
                 UPPER(s.nombre) AS sexo
          FROM personal p
          LEFT JOIN sexos s ON s.id = p.sexo_id
          WHERE p.deleted_at IS NULL AND p.dni IN (:dnis)
          ORDER BY p.apellido, p.nombre
        `
          : `
          SELECT t.dni, p.apellido, p.nombre, p.cuil,
                 DATE_FORMAT(p.fecha_nacimiento, '%Y-%m-%d') AS fechaNacimiento,
                 UPPER(s.nombre) AS sexo
          FROM tramites_tanda_interinos t
          JOIN personal p ON p.dni = t.dni AND p.deleted_at IS NULL
          LEFT JOIN sexos s ON s.id = p.sexo_id
          WHERE t.tanda = :tanda
          ORDER BY p.apellido, p.nombre
        `,
        { replacements: { tanda, dnis }, type: QueryTypes.SELECT }
      );
      const out = rows.map((r) => {
        let archivos: string[] = [];
        try {
          const dir = resolveInsideDocu(Number(r.dni), carpeta);
          if (fs.existsSync(dir)) archivos = fs.readdirSync(dir).filter((f) => !/^thumbs\.db$/i.test(f) && !f.startsWith('~$'));
        } catch { /* sin carpeta DOCU */ }
        const faltan = ['apellido', 'nombre', 'fechaNacimiento', 'sexo'].filter((k) => !r[k]);
        return {
          dni: Number(r.dni),
          apellido: String(r.apellido || '').trim(),
          nombre: String(r.nombre || '').trim(),
          cuil: r.cuil ? String(r.cuil).replace(/\D/g, '') : null,
          fechaNacimiento: r.fechaNacimiento || null,
          sexo: r.sexo === 'FEMENINO' ? 'F' : r.sexo === 'MASCULINO' ? 'M' : null,
          // RDAM: solo cuenta si hay un certificado VIGENTE (fecha del nombre o del archivo, < 60 días)
          tieneCuil: esRdam
            ? archivos.some((f) => fechaRdamMs(Number(r.dni), f) > limiteRdam)
            : archivos.length > 0,
          archivos,
          faltanDatos: faltan,
        };
      });
      return res.json({ ok: true, data: { tanda, rows: out } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] cuil-pendientes error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al listar' });
    }
  });

  // Pase a planta: copia documentos de DOCU a PASE_A_PLANTA_DIR\<HTAL|UPA 18|UPA 4>\<APELLIDO NOMBRE>,
  // siempre en JPG (antecedentes nacionales/provinciales y planilla de compatibilidad). Lo hace
  // scripts/pase_planta.py (el mismo que corre el robot del mail cada 2 min): así el botón y el robot
  // siguen las mismas reglas. Body: { tanda, ejecutar } — ejecutar=false (default) = vista previa.
  router.post('/tandas/pase-planta', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const ejecutar = req.body?.ejecutar === true;
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const args = ['pase_planta.py', '--json', '--tanda', tanda, ...(ejecutar ? [] : ['--dry-run'])];
      const salida = await new Promise<string>((resolve, reject) => {
        // execFile sin shell: la tanda va como argumento, no se interpreta.
        execFile('python', args, {
          cwd: resolverScriptsDir(), timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 20 * 1024 * 1024,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        }, (err, out, stderr) => {
          const txt = String(out || '').trim();
          if (txt.startsWith('{')) return resolve(txt);
          reject(new Error(String(stderr || err?.message || 'pase_planta.py no devolvió nada').slice(-500)));
        });
      });
      const r = JSON.parse(salida);
      if (!r.ok) return res.status(400).json({ ok: false, error: r.error || 'Error' });
      if (ejecutar) logger.info({ msg: '[tramites] pase-planta copiado', tanda, ...r.data?.totales });
      return res.json({ ok: true, data: { tanda, ...r.data } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] pase-planta error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // ── Auditoría de la documentación (pestaña 🕵️ Auditoría, 22/11/2026) ────────────────────────────
  // GET ?dni= | ?tanda= → por agente, cada archivo de DOCU con quién lo guardó, desde qué PC/equipo y
  // por qué vía. Junta tres fuentes:
  //   1. docu_auditoria (mig 146): robots, subidas y movimientos desde Trámites (desde el 22/11/2026).
  //   2. tblarchivos: escáner (usuario + equipo vía audit_log → scanner_saas), mail (robot Gmail), cargas.
  //   3. la carpeta DOCU\<dni>: archivos que no figuran en 1 ni 2 → "sin registro" (fecha del archivo).
  router.get('/auditoria', async (req: Request, res: Response) => {
    try {
      const dniQ = parseDni(queryString(req.query.dni) || '');
      const tanda = queryString(req.query.tanda);
      if (!dniQ && !tanda) return res.status(400).json({ ok: false, error: 'Falta el DNI o la tanda' });
      await ensureDocuAuditoria(sequelize);
      const agentes = await sequelize.query<any>(
        dniQ
          ? `SELECT p.dni, p.apellido, p.nombre FROM personal p WHERE p.dni = :dni AND p.deleted_at IS NULL LIMIT 1`
          : `SELECT t.dni, MAX(p.apellido) AS apellido, MAX(p.nombre) AS nombre
               FROM tramites_tanda_interinos t LEFT JOIN personal p ON p.dni = t.dni AND p.deleted_at IS NULL
              WHERE t.tanda = :tanda GROUP BY t.dni ORDER BY apellido, nombre`,
        { replacements: { dni: dniQ, tanda }, type: QueryTypes.SELECT },
      );
      if (dniQ && !agentes.length) agentes.push({ dni: dniQ, apellido: '', nombre: '' });
      const dnis = agentes.map((a) => Number(a.dni));
      if (!dnis.length) return res.json({ ok: true, data: { rows: [], agentes: [] } });

      const aud = await sequelize.query<any>(
        `SELECT id, dni, ruta, documento, origen, usuario_id, pc, ip, robot, detalle, creado_at
           FROM docu_auditoria WHERE dni IN (:dnis) ORDER BY creado_at DESC, id DESC`,
        { replacements: { dnis }, type: QueryTypes.SELECT },
      );
      const tbl = await sequelize.query<any>(
        `SELECT id, dni, ruta, nombre, tipo, escaneado_por, created_by, descripcion_archivo, created_at
           FROM tblarchivos WHERE dni IN (:dnis) AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
        { replacements: { dnis }, type: QueryTypes.SELECT },
      );
      // escaneos: audit_log guarda el trabajo del escáner → equipo (multifunción) en scanner_saas
      const tblIds = tbl.map((t) => String(t.id));
      const scanLog = tblIds.length ? await sequelize.query<any>(
        `SELECT entity_pk, usuario_id, ip,
                JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.scanner_job_id')) AS job
           FROM audit_log WHERE action = 'scanner_document_saved' AND entity_table = 'tblarchivos' AND entity_pk IN (:ids)
          ORDER BY id`,
        { replacements: { ids: tblIds }, type: QueryTypes.SELECT },
      ) : [];
      const scanDe = new Map<string, any>();
      for (const s of scanLog) scanDe.set(String(s.entity_pk), s);   // queda el último (update pisa)
      const jobs = [...new Set(scanLog.map((s) => Number(s.job)).filter((n) => n > 0))];
      const equipoDeJob = new Map<number, string>();
      if (jobs.length) {
        try {
          const eq = await sequelize.query<any>(
            `SELECT j.id, d.name, d.hostname FROM scanner_saas.scan_jobs j
               LEFT JOIN scanner_saas.devices d ON d.id = j.device_id WHERE j.id IN (:jobs)`,
            { replacements: { jobs }, type: QueryTypes.SELECT },
          );
          for (const e of eq) {
            // "RRHH-2 (3)._uscan._tcp.local (192.168.0.45)" → "RRHH-2 (3)"
            const nombre = String(e.name || '').replace(/\._(u?scans?|scanner)\._tcp\.local.*$/i, '').trim();
            equipoDeJob.set(Number(e.id), nombre || e.hostname || '');
          }
        } catch (e: any) {
          logger.warn({ msg: '[tramites] auditoria: sin acceso a scanner_saas', error: e?.message });
        }
      }
      // nombres de usuario
      const uids = [...new Set([
        ...aud.map((a) => a.usuario_id), ...tbl.flatMap((t) => [t.escaneado_por, t.created_by]),
        ...scanLog.map((s) => s.usuario_id),
      ].map(Number).filter((n) => n > 0))];
      const usuarios = new Map<number, string>();
      if (uids.length) {
        const us = await sequelize.query<any>(`SELECT id, nombre, email FROM usuarios WHERE id IN (:uids)`,
          { replacements: { uids }, type: QueryTypes.SELECT });
        for (const u of us) usuarios.set(Number(u.id), u.nombre || u.email || `#${u.id}`);
      }
      const nomUsuario = (id: any) => (Number(id) > 0 ? usuarios.get(Number(id)) || `#${id}` : null);

      const norm = (r: string) => String(r || '').replace(/\//g, '\\').replace(/^\\+/, '').toLowerCase();
      const conRegistro = new Set<string>();
      const rows: any[] = [];
      const separar = (ruta: string) => {
        const partes = String(ruta || '').replace(/\//g, '\\').split('\\').filter(Boolean);
        if (partes[0] && /^\d+$/.test(partes[0])) partes.shift();
        const archivo = partes.pop() || '';
        return { archivo, carpeta: partes.join('\\') };
      };
      const base = path.resolve(getDocuBaseDir());
      const existe = (ruta: string) => { try { return fs.existsSync(path.join(base, ruta)); } catch { return false; } };

      for (const a of aud) {
        conRegistro.add(norm(a.ruta));
        rows.push({
          fuente: 'auditoria', dni: Number(a.dni), ...separar(a.ruta), ruta: a.ruta, documento: a.documento,
          fecha: a.creado_at, origen: a.origen, usuario: nomUsuario(a.usuario_id), pc: a.pc || a.ip || null,
          robot: a.robot, detalle: a.detalle, existe: existe(a.ruta),
        });
      }
      for (const t of tbl) {
        conRegistro.add(norm(t.ruta));
        const desc = String(t.descripcion_archivo || '');
        const scan = scanDe.get(String(t.id));
        const mail = /Origen: mail/i.test(desc);
        const origen = scan || t.escaneado_por ? 'escaner' : mail ? 'mail' : t.created_by ? 'carga' : 'importado';
        rows.push({
          fuente: 'tblarchivos', dni: Number(t.dni), ...separar(t.ruta), ruta: t.ruta, documento: t.nombre || t.tipo,
          fecha: t.created_at, origen,
          usuario: nomUsuario(scan?.usuario_id || t.escaneado_por || t.created_by),
          pc: scan ? (equipoDeJob.get(Number(scan.job)) || null) : null,
          robot: mail ? 'gmail_antecedentes' : null,
          detalle: mail ? (desc.match(/Origen: (mail de [^|]*)/i)?.[1]?.trim() || null)
            : scan?.job ? `trabajo de escáner ${scan.job}` : null,
          existe: existe(t.ruta),
        });
      }
      // archivos en DOCU sin ningún registro
      const INICIO_REGISTRO_DOCU = new Date(2026, 10, 22).getTime();
      const robotPorNombre = (nombre: string): string | null => {
        if (/^(Curriculum SIAPE|Planilla de datos personales SIAPE|Constancia de aceptacion SIAPE) \d{2}-\d{2}-\d{4}/i.test(nombre)) return 'siape_legajo_digital';
        if (/^Apto Psicofisico SIAPE /i.test(nombre)) return 'siape_certificados_examen';
        if (/ RDAM \d{4}-\d{2}-\d{2}( \(\d+\))?\.pdf$/i.test(nombre)) return 'rdam_certificados';
        if (/^(Antecedentes (Nacionales|Provinciales|Eticos)|Buena Salud)( \d{4}-\d{2}-\d{2})?( \(\d+\))?\.(pdf|png|jpe?g)$/i.test(nombre)) return 'gmail_antecedentes';
        return null;
      };
      for (const dni of dnis) {
        const dir = path.join(base, String(dni));
        const pila: string[] = [''];
        let vistos = 0;
        while (pila.length && vistos < 2000) {
          const rel = pila.pop()!;
          let ents: Dirent[] = [];
          try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { continue; }
          for (const e of ents) {
            const r = rel ? path.join(rel, e.name) : e.name;
            if (e.isDirectory()) { pila.push(r); continue; }
            if (/^(thumbs\.db|desktop\.ini)$|^~\$/i.test(e.name)) continue;
            vistos += 1;
            const ruta = path.join(String(dni), r);
            if (conRegistro.has(norm(ruta))) continue;
            let mtime: Date | null = null;
            try { mtime = fs.statSync(path.join(dir, r)).mtime; } catch { /* ignora */ }
            // 24/11/2026: lo que bajó un robot se reconoce por el nombre que le pone el robot → "Robot".
            // El resto: si es de antes del 22/11 (cuando empezó el registro) → "Anterior al registro";
            // si es posterior → "alerta" (se copió a mano por el Explorador, sin pasar por la app).
            const rob = robotPorNombre(e.name);
            const posterior = !!mtime && mtime.getTime() >= INICIO_REGISTRO_DOCU;
            rows.push({
              fuente: 'carpeta', dni, ...separar(ruta), ruta, documento: null, fecha: mtime,
              origen: rob ? 'robot' : posterior ? 'alerta' : 'sin_registro',
              usuario: null, pc: null, robot: rob,
              detalle: rob ? 'reconocido por el nombre del archivo'
                : posterior ? 'copiado a la carpeta sin pasar por la app (Explorador)' : null,
              existe: true,
            });
          }
        }
      }
      rows.sort((x, y) => new Date(y.fecha || 0).getTime() - new Date(x.fecha || 0).getTime());
      return res.json({
        ok: true,
        data: {
          agentes: agentes.map((a) => ({ dni: Number(a.dni), apellido: a.apellido || '', nombre: a.nombre || '' })),
          rows,
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] auditoria error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error' });
    }
  });

  // ── Legajo Digital SIAPE (botón ⬇️ Legajo SIAPE) ──────────────────────────────
  // El robot scripts/descargar_legajo_digital_siape.py (robots_config siape_legajo_digital, mig 136)
  // baja de SIAPE el CV y la Planilla de datos personales (PASE A PLANTA PERMANENTE 2026) a
  // DOCU\<dni>\Curriculum y \Planilla de datos personales. Tarda ~6 min por agente y usa SIAPE,
  // así que se lanza por run_robot (respeta el turno de los robots de SIAPE); el pedido (tanda, dnis)
  // va a app_runtime_config porque run_robot no pasa parámetros, y el robot deja su avance en
  // 'siape_legajo_digital_estado'.
  const LD_SCRIPT = 'siape_legajo_digital';
  const LD_PEDIDO = 'siape_legajo_digital_pedido';
  const LD_ESTADO = 'siape_legajo_digital_estado';
  const LD_DOCS = [
    { clave: 'cv', carpeta: 'Curriculum', prefijo: 'Curriculum SIAPE' }, // sync-guard:ignore
    { clave: 'planilla', carpeta: 'Planilla de datos personales', prefijo: 'Planilla de datos personales SIAPE' }, // sync-guard:ignore
    { clave: 'constancia', carpeta: 'Constancia de Aceptacion SIAPE', prefijo: 'Constancia de aceptacion SIAPE' }, // sync-guard:ignore
  ] as const;

  const leerRuntime = async (clave: string): Promise<any> => {
    const [r] = await sequelize.query<any>(
      `SELECT config_json, updated_at FROM app_runtime_config WHERE config_key = :clave`,
      { replacements: { clave }, type: QueryTypes.SELECT },
    );
    if (!r?.config_json) return null;
    try {
      const j = typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json;
      return { ...j, _updatedAt: r.updated_at };
    } catch { return null; }
  };

  // GET ?tanda= → por agente: qué archivo de SIAPE ya está en DOCU + último resultado del robot.
  router.get('/tandas/legajo-digital', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.query.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const base = path.resolve(getDocuBaseDir());
      const agentes = await sequelize.query<any>(
        `SELECT t.dni, p.apellido, p.nombre
           FROM tramites_tanda_interinos t
           LEFT JOIN personal p ON p.dni = t.dni AND p.deleted_at IS NULL
          WHERE t.tanda = :tanda
          ORDER BY p.apellido, p.nombre`,
        { replacements: { tanda }, type: QueryTypes.SELECT },
      );
      const dnis = agentes.map((a) => String(a.dni));
      // último resultado del robot por DNI (script_run_items)
      const items = dnis.length ? await sequelize.query<any>(
        `SELECT i.dni, i.estado, i.detalle, i.creado_at
           FROM script_run_items i
           JOIN (SELECT dni, MAX(id) AS id FROM script_run_items WHERE script = :s AND dni IN (:dnis) GROUP BY dni) u
             ON u.id = i.id`,
        { replacements: { s: LD_SCRIPT, dnis }, type: QueryTypes.SELECT },
      ) : [];
      const ultimo = new Map(items.map((i) => [String(i.dni), i]));
      const rows = agentes.map((a) => {
        const docs: Record<string, string | null> = {};
        for (const d of LD_DOCS) {
          let archivo: string | null = null;
          try {
            const dir = path.join(base, String(a.dni), d.carpeta);
            if (fs.existsSync(dir)) {
              const hits = fs.readdirSync(dir).filter((f) => f.startsWith(d.prefijo)).sort();
              archivo = hits.length ? hits[hits.length - 1] : null;
            }
          } catch { archivo = null; }
          docs[d.clave] = archivo;
        }
        const u = ultimo.get(String(a.dni));
        const det = String(u?.detalle || '');
        return {
          dni: Number(a.dni),
          apellido: a.apellido || '',
          nombre: a.nombre || '',
          cv: docs.cv,
          planilla: docs.planilla,
          constancia: docs.constancia,
          ultimo: u ? {
            estado: String(u.estado || ''),
            // "sin_tramite: ..." = no está en la tanda 2026 de SIAPE
            sinTramite: det.startsWith('sin_tramite'),
            detalle: det.slice(0, 400),
            fecha: u.creado_at,
          } : null,
        };
      });
      const estado = await leerRuntime(LD_ESTADO);
      const pedido = await leerRuntime(LD_PEDIDO);
      // "corriendo" vale si el robot actualizó hace menos de 20 min (un agente tarda ~6)
      const fresco = estado?.actualizado && (Date.now() - new Date(estado.actualizado).getTime()) < 20 * 60 * 1000;
      const corriendo = !!(estado?.corriendo && fresco);
      // pedido más nuevo que la última corrida y de hace menos de 1 h = en cola esperando el turno de SIAPE
      const pedidoAt = pedido?.pedidoAt ? new Date(pedido.pedidoAt).getTime() : 0;
      const inicioAt = estado?.inicio ? new Date(estado.inicio).getTime() : 0;
      // Pedido sin corrida: está "en cola" solo si de verdad hay un robot de SIAPE con el turno
      // (run_robot espera ese lock hasta 3 h) o si se pidió hace menos de 2 min (está arrancando).
      // Si el turno está libre y pasó ese rato, el robot no arrancó: se avisa y se puede relanzar.
      const pendiente = !corriendo && pedidoAt > inicioAt && Date.now() - pedidoAt < 3 * 60 * 60 * 1000;
      let turnoOcupado = false;
      if (pendiente) {
        const [l] = await sequelize.query<any>(`SELECT IS_USED_LOCK('robots_siape') AS h`, { type: QueryTypes.SELECT });
        turnoOcupado = l?.h != null;
      }
      const enCola = pendiente && (turnoOcupado || Date.now() - pedidoAt < 2 * 60 * 1000);
      const noArranco = pendiente && !enCola;
      return res.json({
        ok: true,
        data: {
          tanda, rows,
          robot: {
            corriendo, enCola, noArranco, pedidoAt: pedido?.pedidoAt ?? null,
            tanda: estado?.tanda ?? null,
            total: estado?.total ?? null,
            hechos: estado?.hechos ?? null,
            actual: corriendo ? (estado?.actual ?? null) : null,
            inicio: estado?.inicio ?? null,
            fin: estado?.fin ?? null,
            bajados: estado?.bajados ?? null,
            errores: estado?.errores ?? null,
            error: estado?.error ?? null,
          },
        },
      });
    } catch (err: any) {
      logger.error({ msg: '[tramites] legajo-digital estado error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al leer el estado' });
    }
  });

  // POST { tanda, dnis? } → deja el pedido y lanza el robot (si no hay ningún otro de SIAPE, arranca ya;
  // si hay, run_robot espera su turno).
  router.post('/tandas/legajo-digital', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const dnis: number[] | undefined = Array.isArray(req.body?.dnis)
        ? req.body.dnis.map((v: any) => parseDni(v)).filter((v: number | null): v is number => !!v)
        : undefined;
      const estado = await leerRuntime(LD_ESTADO);
      const fresco = estado?.actualizado && (Date.now() - new Date(estado.actualizado).getTime()) < 20 * 60 * 1000;
      if (estado?.corriendo && fresco) {
        return res.status(409).json({ ok: false, error: `El robot ya está corriendo (tanda "${estado.tanda || '-'}"). Esperá a que termine.` });
      }
      const actor = (req as any).auth?.principalType === 'user' ? Number((req as any).auth.principalId) || null : null;
      const pedido = { tanda, ...(dnis?.length ? { dnis } : {}), pedidoAt: new Date().toISOString() };
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES (:k, :j, :u, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { k: LD_PEDIDO, j: JSON.stringify(pedido), u: actor } },
      );
      const como = await ejecutarAhora(LD_SCRIPT);
      logger.info({ msg: '[tramites] legajo-digital lanzado', tanda, dnis: dnis?.length || 0, como });
      return res.json({ ok: true, data: { tanda, como } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] legajo-digital lanzar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'No se pudo lanzar el robot' });
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

  // Arma las subcarpetas que le corresponden a un agente de la tanda (tras un tilde). Un error
  // acá no debe hacer fallar el guardado del tilde: solo se loguea.
  async function subcarpetasDeUnAgente(tanda: string, dni: number): Promise<void> {
    try {
      const fila = ((await listTandaAgentes(sequelize, tanda)) as any[]).filter((r) => Number(r.dni) === dni);
      if (fila.length) await crearSubcarpetasAgentes(sequelize, fila);
    } catch (e: any) {
      logger.error({ msg: '[tramites] subcarpetas tilde error', dni, error: e?.message });
    }
  }

  // Tilde "Ley 14783" del agente en la tanda. Body: { tanda, dni, valor: boolean }.
  router.post('/tandas/ley-14783', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const dni = parseDni(req.body?.dni);
      if (!tanda || !dni) return res.status(400).json({ ok: false, error: 'Falta tanda o dni' });
      const valor = req.body?.valor === true || req.body?.valor === 1 || req.body?.valor === 'true' ? 1 : 0;
      await sequelize.query(
        'UPDATE tramites_tanda_interinos SET ley_14783 = :valor WHERE tanda = :tanda AND dni = :dni',
        { replacements: { valor, tanda, dni }, type: QueryTypes.UPDATE }
      );
      // Con el tilde puesto pasan a corresponderle Anexo 1 + certificado de nacimiento: sus carpetas.
      if (valor) await subcarpetasDeUnAgente(tanda, dni);
      return res.json({ ok: true, data: { tanda, dni, ley14783: valor } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al guardar Ley 14783' });
    }
  });

  // Tilde "Ley 10592" (discapacidad) del agente en la tanda. Body: { tanda, dni, valor: boolean }.
  router.post('/tandas/ley-10592', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const dni = parseDni(req.body?.dni);
      if (!tanda || !dni) return res.status(400).json({ ok: false, error: 'Falta tanda o dni' });
      const valor = req.body?.valor === true || req.body?.valor === 1 || req.body?.valor === 'true' ? 1 : 0;
      await sequelize.query(
        'UPDATE tramites_tanda_interinos SET ley_10592 = :valor WHERE tanda = :tanda AND dni = :dni',
        { replacements: { valor, tanda, dni }, type: QueryTypes.UPDATE }
      );
      // Con el tilde puesto pasa a corresponderle el certificado de discapacidad: su carpeta.
      if (valor) await subcarpetasDeUnAgente(tanda, dni);
      return res.json({ ok: true, data: { tanda, dni, ley10592: valor } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al guardar Ley 10592' });
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

  // Alta de un documento nuevo en el orden: { proceso?, ley, documento, observacion?, otraLey? }.
  // Entra al final (orden = max+1) de cada ley elegida y crea la subcarpeta DOCU\<dni>\<documento>
  // a todos los agentes de TODAS las tandas que sean de esa ley y ya tengan carpeta en DOCU,
  // salteando a los que están en estado 'aprobado' (trámite terminado). Nunca pisa carpetas.
  router.post('/orden-docs', async (req: Request, res: Response) => {
    try {
      const proceso = queryString(req.body?.proceso) || ORDEN_PROCESO_DEFAULT;
      const ley = queryString(req.body?.ley);
      const documento = String(req.body?.documento || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const observacion = String(req.body?.observacion || '').trim() || null;
      if (!ley || !['10430', '10471'].includes(ley)) return res.status(400).json({ ok: false, error: 'Ley inválida' });
      if (!documento) return res.status(400).json({ ok: false, error: 'Falta el nombre del documento' });
      if (/[\\/]/.test(documento)) return res.status(400).json({ ok: false, error: 'El nombre no puede tener / ni \\ (se usa como nombre de carpeta)' });
      const carpeta = safeSegment(documento); // valida que sirva como nombre de carpeta
      const leyes = req.body?.otraLey ? [ley, ley === '10430' ? '10471' : '10430'] : [ley];

      // Nombre repetido (mismo nombre o misma carpeta) en alguna de las leyes → no se agrega nada.
      const existentes = await sequelize.query<{ ley: string; documento: string }>(
        `SELECT ley, documento FROM orden_documentos_expediente WHERE proceso = :proceso AND ley IN (:leyes)`,
        { replacements: { proceso, leyes }, type: QueryTypes.SELECT }
      );
      const choca = existentes.find((e) => carpetaDocumento(e.documento).toLowerCase() === carpeta.toLowerCase());
      if (choca) return res.status(409).json({ ok: false, error: `Ya existe «${choca.documento}» en la ley ${choca.ley}` });

      await sequelize.transaction(async (t) => {
        for (const l of leyes) {
          const [mx] = await sequelize.query<{ m: number | null }>(
            `SELECT MAX(orden) AS m FROM orden_documentos_expediente WHERE proceso = :proceso AND ley = :ley`,
            { replacements: { proceso, ley: l }, type: QueryTypes.SELECT, transaction: t }
          );
          await sequelize.query(
            `INSERT INTO orden_documentos_expediente (proceso, ley, orden, documento, observacion, activo)
             VALUES (:proceso, :ley, :orden, :documento, :observacion, 1)`,
            { replacements: { proceso, ley: l, orden: Number(mx?.m || 0) + 1, documento, observacion }, type: QueryTypes.INSERT, transaction: t }
          );
        }
      });

      // Carpetas en DOCU para los agentes de todas las tandas de esas leyes.
      const agentes = (await listTandaAgentes(sequelize, null)) as any[];
      const vistos = new Set<number>();
      let creadas = 0, yaTenian = 0, sinCarpeta = 0, aprobados = 0;
      for (const a of agentes) {
        const dni = Number(a.dni);
        if (!dni || vistos.has(dni)) continue;
        if (!leyes.includes(String(a.ocupacionLey || ''))) continue;
        vistos.add(dni);
        if (String(a.estado || '').toLowerCase() === 'aprobado') { aprobados += 1; continue; }
        const dir = resolveDocuAgentDir(dni);
        if (!fs.existsSync(dir)) { sinCarpeta += 1; continue; }
        const target = path.join(dir, carpeta);
        if (fs.existsSync(target)) { yaTenian += 1; continue; }
        fs.mkdirSync(target, { recursive: true });
        creadas += 1;
      }
      logger.info({ msg: '[tramites] documento agregado al orden', proceso, leyes, documento, creadas, yaTenian, sinCarpeta, aprobados });
      return res.json({ ok: true, data: { documento, leyes, carpetas: { creadas, yaTenian, sinCarpeta, aprobados } } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] orden-docs alta error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al agregar el documento' });
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

  // Crea, para cada agente de una tanda, las subcarpetas dentro de DOCU\<dni> de los
  // documentos ACTIVOS del orden que le corresponden (ver documentosPorAgente). No duplica ni
  // borra. Con dryRun no crea nada, solo informa. Los DNI sin carpeta o sin ley se reportan aparte.
  router.post('/tandas/crear-subcarpetas', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });

      const agentes = (await listTandaAgentes(sequelize, tanda)) as any[];
      if (!agentes.length) return res.status(404).json({ ok: false, error: 'La tanda no tiene agentes' });

      // Solo los documentos que le corresponden a cada agente (21/11/2026: antes creaba todos).
      const r = await crearSubcarpetasAgentes(sequelize, agentes, dryRun);
      return res.json({
        ok: true,
        data: {
          tanda, dryRun,
          totales: { agentes: r.detalle.length, creadas: r.creadas, existentes: r.existentes, sinLey: r.sinLey.length, sinCarpeta: r.sinCarpeta.length },
          sinLey: r.sinLey, sinCarpeta: r.sinCarpeta, detalle: r.detalle,
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
      // Qué documentos le corresponden a cada uno (chofer, extranjero, ético/matrícula por
      // agrupamiento, tildes 14783/10592): ver documentosPorAgente.
      const porAgente = await documentosPorAgente(sequelize, agentes);

      const incompletos: Array<{ dni: number; nombre: string; ley: string; sinCarpeta: boolean; faltan: string[]; completos: number; total: number }> = [];
      const sinLey: Array<{ dni: number; nombre: string }> = [];

      for (const a of agentes) {
        const dni = Number(a.dni);
        const nombre = String(a.apellidoNombre || `DNI ${dni}`);
        const info = porAgente.get(dni);
        if (!info) { sinLey.push({ dni, nombre }); continue; }
        const { ley, docs } = info;
        const dir = resolveDocuAgentDir(dni);
        if (!fs.existsSync(dir)) {
          incompletos.push({ dni, nombre, ley, sinCarpeta: true, faltan: [...docs], completos: 0, total: docs.length });
          continue;
        }
        const faltan: string[] = [];
        for (const doc of docs) {
          const sub = path.join(dir, carpetaDocumento(doc));
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
  // DOCU\<dni>\Tramite de nombramiento\Tramite de nombramiento <APELLIDO NOMBRE> <año>.pdf (pisa si existe).
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

      // Nombre: "Tramite de nombramiento <APELLIDO NOMBRE> <año>.pdf". Si ya existe, se pisa.
      const ident = await agenteIdentidad(sequelize, dni);
      const apeNom = ident
        ? `${String(ident.apellido || '').trim()} ${String(ident.nombre || '').trim()}`.trim()
        : `DNI ${dni}`;
      const apeNomSeguro = apeNom.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase() || `DNI ${dni}`;
      const fileName = `${COMBINAR_NOMBRE_SALIDA} ${apeNomSeguro} ${new Date().getFullYear()}.pdf`;

      const destDir = path.join(resolveDocuAgentDir(dni), COMBINAR_NOMBRE_SALIDA);
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);
      fs.writeFileSync(destPath, Buffer.from(await merged.save()));
      // queda anotado para la pestaña "Combinados" (envío a GDEBA)
      await registrarCombinado(sequelize, dni, `${dni}/${COMBINAR_NOMBRE_SALIDA}/${fileName}`)
        .catch((e) => logger.warn({ msg: '[tramites] no se pudo anotar el combinado', error: e?.message }));
      return res.json({ ok: true, data: { dni, paginas: armadas, ruta: `${COMBINAR_NOMBRE_SALIDA}/${fileName}` } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-guardar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al guardar el combinado' });
    }
  });

  // Saca UNA hoja del combinado → DOCU\<dni>\Trasladados\<subcarpeta>\.
  // modo 'hoja': se separó esa página y el original quedó sin ella (las siguientes corren -1).
  // modo 'archivo': se movió el archivo entero (tenía una sola hoja, o es imagen/TIFF).
  router.post('/combinar-sacar', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const page = Number(req.body?.page);
      if (!Number.isInteger(page) || page < 0) return res.status(400).json({ ok: false, error: 'Página inválida' });
      const { carpeta, archivo, fp } = fuenteCombinarRel(dni, req.body?.rel);

      const destDir = path.join(resolveDocuAgentDir(dni), TRASLADADOS_DIR, carpeta);
      fs.mkdirSync(destDir, { recursive: true });

      let modo: 'hoja' | 'archivo' = 'archivo';
      let destName: string;
      const src = COMBINAR_PDF.test(fp) ? await cargarPdfEditable(fp) : null;
      if (src && page >= src.getPageCount()) return res.status(400).json({ ok: false, error: 'Página inexistente' });

      if (src && src.getPageCount() > 1) {
        const sacada = await PDFDocument.create();
        const [copia] = await sacada.copyPages(src, [page]);
        sacada.addPage(copia);
        const base = archivo.replace(/\.pdf$/i, '');
        destName = nombreLibre(destDir, `${base} - hoja ${page + 1}.pdf`);
        fs.writeFileSync(path.join(destDir, destName), Buffer.from(await sacada.save())); // primero la copia
        src.removePage(page);
        escribirAtomico(fp, Buffer.from(await src.save()));
        modo = 'hoja';
      } else {
        destName = nombreLibre(destDir, archivo);
        moverArchivo(fp, path.join(destDir, destName));
      }
      logger.info({ msg: '[tramites] hoja trasladada', dni, rel: `${carpeta}/${archivo}`, page, modo, destino: destName });
      return res.json({ ok: true, data: { modo, trasladado: `${TRASLADADOS_DIR}/${carpeta}/${destName}` } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-sacar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al sacar la hoja' });
    }
  });

  // "📷 Re-escanear documento": después de que el escáner guardó el documento nuevo en su
  // subcarpeta, los archivos que tenía ANTES (los rels que el front vio en el combinado)
  // se mueven enteros a DOCU\<dni>\Trasladados\<subcarpeta>\ (nunca se borran; se
  // recuperan en ♻️ Restaurar). Body: { dni, rels: ["<subcarpeta>/<archivo>", …] }.
  router.post('/combinar-reemplazar-doc', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const relsRaw: unknown[] = Array.isArray(req.body?.rels) ? req.body.rels : [];
      const rels = Array.from(new Set(relsRaw.map((r) => String(r || '').replace(/\\/g, '/').trim()).filter(Boolean)));
      if (!rels.length || rels.length > 200) return res.status(400).json({ ok: false, error: 'Lista de archivos inválida' });

      const movidos: string[] = [];
      const yaNoEstaban: string[] = [];
      for (const rel of rels) {
        let src: { carpeta: string; archivo: string; fp: string };
        try { src = fuenteCombinarRel(dni, rel); } catch (e: any) {
          if (e?.status === 404) { yaNoEstaban.push(rel); continue; }
          throw e;
        }
        const destDir = path.join(resolveDocuAgentDir(dni), TRASLADADOS_DIR, src.carpeta);
        fs.mkdirSync(destDir, { recursive: true });
        const destName = nombreLibre(destDir, src.archivo);
        moverArchivo(src.fp, path.join(destDir, destName));
        movidos.push(`${TRASLADADOS_DIR}/${src.carpeta}/${destName}`);
      }
      logger.info({ msg: '[tramites] documento re-escaneado: viejos a Trasladados', dni, movidos, yaNoEstaban });
      return res.json({ ok: true, data: { movidos, yaNoEstaban } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-reemplazar-doc error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al trasladar los archivos viejos' });
    }
  });

  // "🌑 Oscurecer" una hoja EN EL ORIGINAL (letras claras → más oscuras, fondo blanco).
  // Antes de tocarla se guarda una copia del archivo tal cual en DOCU\<dni>\Trasladados\<subcarpeta>\
  // (se recupera en ♻️ Restaurar). PDF: solo esa página. Body: { dni, rel, page, nivel? (1-3, def 2) }.
  router.post('/combinar-oscurecer', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      // todas=true → todas las páginas del archivo (🌑 Oscurecer todas: un PDF se lee y guarda una sola vez)
      const todas = req.body?.todas === true;
      const page = todas ? 0 : Number(req.body?.page);
      if (!Number.isInteger(page) || page < 0) return res.status(400).json({ ok: false, error: 'Página inválida' });
      const nivel = parseNivel(req.body?.nivel, 2);
      const { carpeta, archivo, fp } = fuenteCombinarRel(dni, req.body?.rel);
      if (COMBINAR_TIFF.test(fp)) return res.status(400).json({ ok: false, error: 'Los TIFF no se pueden oscurecer desde acá' });
      if (!COMBINAR_PDF.test(fp) && page !== 0) return res.status(400).json({ ok: false, error: 'Página inexistente' });

      const original = fs.readFileSync(fp);
      const salida = await oscurecerArchivoBuffer(archivo, original, nivel, COMBINAR_PDF.test(fp) && !todas ? [page] : null);
      if (!salida) return res.status(400).json({ ok: false, error: 'Formato no soportado' });

      const backupDir = path.join(resolveDocuAgentDir(dni), TRASLADADOS_DIR, carpeta);
      fs.mkdirSync(backupDir, { recursive: true });
      const ext = path.extname(archivo);
      const backupName = nombreLibre(backupDir, `${archivo.slice(0, archivo.length - ext.length)} - antes de oscurecer${ext}`);
      fs.writeFileSync(path.join(backupDir, backupName), original); // primero la copia
      escribirAtomico(fp, salida);
      tocarImagenesDeCarpeta(path.dirname(fp));
      logger.info({ msg: '[tramites] hoja oscurecida', dni, rel: `${carpeta}/${archivo}`, page, nivel, backup: backupName });
      return res.json({ ok: true, data: { dni, nivel, backup: `${TRASLADADOS_DIR}/${carpeta}/${backupName}` } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-oscurecer error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al oscurecer' });
    }
  });

  // "➕ Agregar hoja": después de escanear la hoja que faltó (el escáner la guarda suelta en la
  // subcarpeta), la mete EN SU LUGAR dentro del documento.
  //   - despuesDe = { rel, page } de la hoja tras la cual va; null = al final.
  //   - antes = nombres de los archivos que había en la carpeta al abrir el escaneo (lo que no esté
  //     ahí es lo nuevo). Si lo nuevo todavía no llegó (el escáner lo escribe un poco después) → 409.
  // PDF destino: se insertan las páginas adentro del PDF y el archivo suelto va a Trasladados.
  // Imágenes: se renumeran "<base> (i-n).<ext>" en el orden nuevo. Nunca borra nada.
  router.post('/combinar-insertar', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const carpeta = safeSegment(String(req.body?.carpeta || ''));
      if (carpeta.toLowerCase() === TRASLADADOS_DIR.toLowerCase()) return res.status(400).json({ ok: false, error: 'Carpeta inválida' });
      const dir = resolveInsideDocu(dni, carpeta);
      if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: 'La carpeta no existe' });
      const antes = new Set<string>((Array.isArray(req.body?.antes) ? req.body.antes : []).map((x: any) => path.basename(String(x || ''))));
      const despuesRaw = req.body?.despuesDe;
      const despuesDe = despuesRaw && despuesRaw.rel
        ? { archivo: path.basename(String(despuesRaw.rel).replace(/\\/g, '/')), page: Math.max(0, Number(despuesRaw.page) || 0) }
        : null;

      const esHoja = (f: string) => COMBINAR_PDF.test(f) || COMBINAR_JPG.test(f) || COMBINAR_PNG.test(f);
      const actuales = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && esHoja(e.name) && !e.name.includes('.tmp-'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, 'es'));
      const nuevos = actuales.filter((f) => !antes.has(f));
      const viejos = actuales.filter((f) => antes.has(f));
      if (!nuevos.length) return res.status(409).json({ ok: false, pendiente: true, error: 'La hoja nueva todavía no llegó a la carpeta' });
      if (despuesDe && !viejos.includes(despuesDe.archivo)) return res.status(400).json({ ok: false, error: 'La hoja de referencia ya no está en la carpeta' });

      // ¿Va adentro de un PDF? (la hoja de referencia es un PDF, o al final de una carpeta que es UN solo PDF)
      const pdfDestino = despuesDe
        ? (COMBINAR_PDF.test(despuesDe.archivo) ? despuesDe.archivo : null)
        : (viejos.length === 1 && COMBINAR_PDF.test(viejos[0]) ? viejos[0] : null);

      if (pdfDestino) {
        const fpDest = path.join(dir, pdfDestino);
        const dest = await cargarPdfEditable(fpDest);
        let pos = despuesDe ? Math.min(despuesDe.page + 1, dest.getPageCount()) : dest.getPageCount();
        const ref = dest.getPage(Math.max(0, Math.min(pos - 1, dest.getPageCount() - 1)));
        const anchoRef = ref.getWidth();
        for (const f of nuevos) {
          const fp = path.join(dir, f);
          if (COMBINAR_PDF.test(f)) {
            const src = await PDFDocument.load(fs.readFileSync(fp), { ignoreEncryption: true });
            const copias = await dest.copyPages(src, src.getPageIndices());
            for (const c of copias) { dest.insertPage(pos, c); pos += 1; }
          } else {
            const bytes = fs.readFileSync(fp);
            const img = COMBINAR_PNG.test(f) ? await dest.embedPng(bytes) : await dest.embedJpg(bytes);
            const w = anchoRef; const h = (img.height / img.width) * anchoRef;
            const pg = dest.insertPage(pos, [w, h]);
            pg.drawImage(img, { x: 0, y: 0, width: w, height: h });
            pos += 1;
          }
        }
        escribirAtomico(fpDest, Buffer.from(await dest.save()));
        const trasDir = path.join(resolveDocuAgentDir(dni), TRASLADADOS_DIR, carpeta);
        fs.mkdirSync(trasDir, { recursive: true });
        for (const f of nuevos) moverArchivo(path.join(dir, f), path.join(trasDir, nombreLibre(trasDir, f)));
        logger.info({ msg: '[tramites] hoja insertada en PDF', dni, carpeta, pdf: pdfDestino, nuevos, despuesDe });
        return res.json({ ok: true, data: { modo: 'pdf', archivo: pdfDestino, insertadas: nuevos.length } });
      }

      // Imágenes: orden nuevo = viejos con los nuevos metidos después de la hoja de referencia.
      const orden = [...viejos];
      const idx = despuesDe ? orden.indexOf(despuesDe.archivo) + 1 : orden.length;
      orden.splice(idx, 0, ...nuevos);
      const imagenes = orden.filter((f) => !COMBINAR_PDF.test(f));
      const baseDe = (f: string) => f.replace(/\.[^.]+$/, '').replace(/\s*\(\d+-\d+\)$/, '').replace(/-\d+$/, '').trim();
      const base = baseDe(viejos.find((f) => !COMBINAR_PDF.test(f)) || nuevos[0]) || carpeta;
      const n = imagenes.length;
      const finales = imagenes.map((f, i) => `${base} (${i + 1}-${n})${path.extname(f).toLowerCase()}`);
      const choca = finales.find((f) => fs.existsSync(path.join(dir, f)) && !imagenes.includes(f));
      if (choca) return res.status(409).json({ ok: false, error: `Ya existe «${choca}» en la carpeta: no se renumera` });
      // dos pasadas (nombre temporal → final) para no pisar nombres que se intercambian
      const sello = Date.now();
      const temporales = imagenes.map((f, i) => {
        const tmp = `${f}.tmp-renum-${sello}-${i}`;
        fs.renameSync(path.join(dir, f), path.join(dir, tmp));
        return tmp;
      });
      temporales.forEach((tmp, i) => fs.renameSync(path.join(dir, tmp), path.join(dir, finales[i])));
      tocarImagenesDeCarpeta(dir);
      logger.info({ msg: '[tramites] hoja insertada (renumeradas)', dni, carpeta, nuevos, despuesDe, finales });
      return res.json({ ok: true, data: { modo: 'imagenes', archivos: finales, insertadas: nuevos.length } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-insertar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al agregar la hoja' });
    }
  });

  // "↕ Ordenar" las hojas de UN documento (subcarpeta) en 🗂️ Documentos. Body: { dni, carpeta,
  // orden: [{ rel, page }, …], unir?: boolean } con TODAS las hojas del documento en el orden nuevo.
  //   - Solo fotos (JPG/PNG, 1 hoja c/u): se renumeran "<base> (i-n).<ext>" (renombrar no pierde nada).
  //   - Un solo PDF: se reordenan sus páginas adentro; el original queda en Trasladados.
  //   - Mezcla (varios PDF y/o fotos): solo con unir=true → se unen en UN PDF "<base>.pdf" en ese
  //     orden y los archivos de antes van a Trasladados. Sin unir → 409 { requiereUnir: true }.
  // Nunca borra nada. Después pone fecha de hoy a las imágenes (pase_planta toma las del mismo día).
  router.post('/combinar-reordenar', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const carpeta = safeSegment(String(req.body?.carpeta || ''));
      if (carpeta.toLowerCase() === TRASLADADOS_DIR.toLowerCase()) return res.status(400).json({ ok: false, error: 'Carpeta inválida' });
      const dir = resolveInsideDocu(dni, carpeta);
      if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: 'La carpeta no existe' });
      const ordenRaw: any[] = Array.isArray(req.body?.orden) ? req.body.orden : [];
      const orden = ordenRaw.map((o) => ({
        archivo: path.basename(String(o?.rel || '').replace(/\\/g, '/')),
        page: Number(o?.page),
      }));
      if (!orden.length || orden.some((o) => !o.archivo || !Number.isInteger(o.page) || o.page < 0)) {
        return res.status(400).json({ ok: false, error: 'Orden inválido' });
      }

      // Lo que hay hoy en la carpeta (mismo criterio que el combinado) y cuántas hojas tiene cada archivo.
      const archivos = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.includes('.tmp-') && (COMBINAR_PDF.test(e.name) || COMBINAR_JPG.test(e.name) || COMBINAR_PNG.test(e.name)))
        .map((e) => e.name);
      if (fs.readdirSync(dir).some((f) => COMBINAR_TIFF.test(f))) {
        return res.status(400).json({ ok: false, error: 'La carpeta tiene TIFF: no se puede ordenar desde acá' });
      }
      const pdfs = new Map<string, PDFDocument>();
      const hojas = new Map<string, number>();
      for (const f of archivos) {
        if (COMBINAR_PDF.test(f)) {
          const d = await cargarPdfEditable(path.join(dir, f));
          pdfs.set(f, d);
          hojas.set(f, d.getPageCount());
        } else hojas.set(f, 1);
      }
      // El orden tiene que traer exactamente todas las hojas, cada una una vez.
      const total = Array.from(hojas.values()).reduce((a, b) => a + b, 0);
      const claves = new Set(orden.map((o) => `${o.archivo}#${o.page}`));
      const valido = claves.size === orden.length && orden.length === total
        && orden.every((o) => hojas.has(o.archivo) && o.page < (hojas.get(o.archivo) || 0));
      if (!valido) {
        return res.status(409).json({ ok: false, error: 'La carpeta cambió mientras ordenabas (hay hojas nuevas o faltan). Recargá y volvé a ordenar.' });
      }

      const baseDe = (f: string) => f.replace(/\.[^.]+$/, '').replace(/\s*\(\d+-\d+\)$/, '').replace(/-\d+$/, '').trim();
      const trasDir = path.join(resolveDocuAgentDir(dni), TRASLADADOS_DIR, carpeta);

      // 1) Solo fotos → renumerar
      if (!pdfs.size) {
        const base = baseDe(orden[0].archivo) || carpeta;
        const n = orden.length;
        const finales = orden.map((o, i) => `${base} (${i + 1}-${n})${path.extname(o.archivo).toLowerCase()}`);
        const choca = finales.find((f) => fs.existsSync(path.join(dir, f)) && !archivos.includes(f));
        if (choca) return res.status(409).json({ ok: false, error: `Ya existe «${choca}» en la carpeta: no se renumera` });
        const sello = Date.now();
        const temporales = orden.map((o, i) => {
          const tmp = `${o.archivo}.tmp-orden-${sello}-${i}`;
          fs.renameSync(path.join(dir, o.archivo), path.join(dir, tmp));
          return tmp;
        });
        temporales.forEach((tmp, i) => fs.renameSync(path.join(dir, tmp), path.join(dir, finales[i])));
        tocarImagenesDeCarpeta(dir);
        logger.info({ msg: '[tramites] hojas reordenadas (fotos)', dni, carpeta, finales });
        return res.json({ ok: true, data: { modo: 'fotos', archivos: finales } });
      }

      // 2) Un solo PDF (y nada más) → reordenar páginas adentro
      if (archivos.length === 1) {
        const f = archivos[0];
        const src = pdfs.get(f)!;
        const nuevo = await PDFDocument.create();
        const copias = await nuevo.copyPages(src, orden.map((o) => o.page));
        copias.forEach((p) => nuevo.addPage(p));
        fs.mkdirSync(trasDir, { recursive: true });
        const ext = path.extname(f);
        const backup = nombreLibre(trasDir, `${f.slice(0, f.length - ext.length)} - antes de ordenar${ext}`);
        fs.copyFileSync(path.join(dir, f), path.join(trasDir, backup)); // primero la copia
        escribirAtomico(path.join(dir, f), Buffer.from(await nuevo.save()));
        logger.info({ msg: '[tramites] hojas reordenadas (PDF)', dni, carpeta, archivo: f, backup });
        return res.json({ ok: true, data: { modo: 'pdf', archivos: [f], backup: `${TRASLADADOS_DIR}/${carpeta}/${backup}` } });
      }

      // 3) Mezcla → unir en un PDF (solo si lo confirmaron)
      if (req.body?.unir !== true) {
        return res.status(409).json({
          ok: false, requiereUnir: true,
          error: `El documento tiene ${archivos.length} archivos (PDF y/o fotos): para ordenarlo hay que unirlos en un solo PDF`,
        });
      }
      const unido = await PDFDocument.create();
      const cache = new Map<string, any>();
      for (const o of orden) {
        const fp = path.join(dir, o.archivo);
        const added = await appendPaginasAlMerged(unido, fp, COMBINAR_PDF.test(o.archivo) ? o.page : 0, cache);
        if (!added) throw Object.assign(new Error(`No se pudo leer ${o.archivo}`), { status: 400 });
      }
      const primero = orden.find((o) => !COMBINAR_PDF.test(o.archivo)) || orden[0];
      const base = baseDe(primero.archivo) || carpeta;
      fs.mkdirSync(trasDir, { recursive: true });
      // los de antes a Trasladados ANTES de escribir el unido (así su nombre queda libre)
      const tmpUnido = path.join(dir, `${base}.pdf.tmp-unir-${Date.now()}`);
      fs.writeFileSync(tmpUnido, Buffer.from(await unido.save()));
      for (const f of archivos) moverArchivo(path.join(dir, f), path.join(trasDir, nombreLibre(trasDir, f)));
      const final = nombreLibre(dir, `${base}.pdf`);
      fs.renameSync(tmpUnido, path.join(dir, final));
      logger.info({ msg: '[tramites] hojas reordenadas (unidas en PDF)', dni, carpeta, final, antes: archivos });
      return res.json({ ok: true, data: { modo: 'unido', archivos: [final], trasladados: archivos.length } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-reordenar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al ordenar las hojas' });
    }
  });

  // Rota una hoja EN EL ARCHIVO ORIGINAL (delta 90 / -90 / 180). PDF: rotación de la
  // página; JPG/PNG: se re-dibuja la imagen girada. TIFF no se soporta.
  router.post('/combinar-rotar', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const page = Number(req.body?.page);
      const delta = Number(req.body?.delta);
      if (!Number.isInteger(page) || page < 0) return res.status(400).json({ ok: false, error: 'Página inválida' });
      if (![90, -90, 180].includes(delta)) return res.status(400).json({ ok: false, error: 'Rotación inválida' });
      const { fp } = fuenteCombinarRel(dni, req.body?.rel);

      if (COMBINAR_PDF.test(fp)) {
        const src = await cargarPdfEditable(fp);
        if (page >= src.getPageCount()) return res.status(400).json({ ok: false, error: 'Página inexistente' });
        const pg = src.getPage(page);
        const ang = (((pg.getRotation().angle + delta) % 360) + 360) % 360;
        pg.setRotation(degrees(ang));
        escribirAtomico(fp, Buffer.from(await src.save()));
      } else if (COMBINAR_JPG.test(fp) || COMBINAR_PNG.test(fp)) {
        if (page !== 0) return res.status(400).json({ ok: false, error: 'Página inexistente' });
        const { createCanvas, loadImage } = require('@napi-rs/canvas');
        const img = await loadImage(fs.readFileSync(fp));
        const w = img.width; const h = img.height;
        const giro = Math.abs(delta) === 90;
        const canvas = createCanvas(giro ? h : w, giro ? w : h);
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((delta * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2);
        const out: Buffer = COMBINAR_PNG.test(fp) ? canvas.encodeSync('png') : canvas.encodeSync('jpeg', 92);
        escribirAtomico(fp, out);
      } else {
        return res.status(400).json({ ok: false, error: 'Los TIFF no se pueden rotar desde acá' });
      }
      logger.info({ msg: '[tramites] hoja rotada', dni, rel: req.body?.rel, page, delta });
      return res.json({ ok: true, data: { dni, delta } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-rotar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al rotar' });
    }
  });

  // Pestaña "🗂️ Documentos": los documentos del orden (PASE A TRANSITORIA, ley del agente)
  // aunque su subcarpeta esté vacía, para listarlos a la izquierda y como destino de "Subir".
  router.get('/documentos-agente', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.query?.dni as any);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const ley = await leyDeAgente(sequelize, dni);
      if (!ley) return res.status(400).json({ ok: false, error: 'No se pudo determinar la ley del agente (10430/10471)' });
      const docs = await sequelize.query<{ documento: string }>(
        `SELECT documento FROM orden_documentos_expediente
          WHERE proceso = :proceso AND ley = :ley AND activo = 1 ORDER BY orden`,
        { replacements: { proceso: 'PASE A TRANSITORIA', ley }, type: QueryTypes.SELECT }
      );
      return res.json({ ok: true, data: { dni, ley, docs: docs.map((d) => ({ documento: d.documento, carpeta: carpetaDocumento(d.documento) })) } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] documentos-agente error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al listar documentos' });
    }
  });

  // "Subir a otra carpeta": pasa UNA hoja a la subcarpeta de otro documento del mismo agente.
  // PDF de varias hojas: se copia la hoja a un PDF nuevo en el destino y recién después se
  // saca del original. Una sola hoja (o imagen/TIFF): se mueve el archivo entero.
  // Body: { dni, rel, page, destino (nombre del documento del orden) }.
  router.post('/combinar-mover-hoja', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const page = Number(req.body?.page);
      if (!Number.isInteger(page) || page < 0) return res.status(400).json({ ok: false, error: 'Página inválida' });
      const { carpeta, archivo, fp } = fuenteCombinarRel(dni, req.body?.rel);

      // el destino tiene que ser un documento del orden de la ley del agente
      const ley = await leyDeAgente(sequelize, dni);
      const docs = ley ? await sequelize.query<{ documento: string }>(
        `SELECT documento FROM orden_documentos_expediente WHERE proceso = :proceso AND ley = :ley AND activo = 1`,
        { replacements: { proceso: 'PASE A TRANSITORIA', ley }, type: QueryTypes.SELECT }
      ) : [];
      const destino = docs.find((d) => d.documento === String(req.body?.destino || ''));
      if (!destino) return res.status(400).json({ ok: false, error: 'Documento de destino inválido' });
      const carpetaDest = carpetaDocumento(destino.documento);
      if (carpetaDest.toLowerCase() === carpeta.toLowerCase()) return res.status(400).json({ ok: false, error: 'La hoja ya está en ese documento' });

      const destDir = path.join(resolveDocuAgentDir(dni), carpetaDest);
      fs.mkdirSync(destDir, { recursive: true });

      let modo: 'hoja' | 'archivo' = 'archivo';
      let destName: string;
      const src = COMBINAR_PDF.test(fp) ? await cargarPdfEditable(fp) : null;
      if (src && page >= src.getPageCount()) return res.status(400).json({ ok: false, error: 'Página inexistente' });

      if (src && src.getPageCount() > 1) {
        const hoja = await PDFDocument.create();
        const [copia] = await hoja.copyPages(src, [page]);
        hoja.addPage(copia);
        const base = archivo.replace(/\.pdf$/i, '');
        destName = nombreLibre(destDir, `${base} - hoja ${page + 1}.pdf`);
        fs.writeFileSync(path.join(destDir, destName), Buffer.from(await hoja.save())); // primero la copia
        src.removePage(page);
        escribirAtomico(fp, Buffer.from(await src.save()));
        modo = 'hoja';
      } else {
        if (!src && page !== 0) return res.status(400).json({ ok: false, error: 'Página inexistente' });
        destName = nombreLibre(destDir, archivo);
        moverArchivo(fp, path.join(destDir, destName));
      }
      logger.info({ msg: '[tramites] hoja movida de documento', dni, rel: `${carpeta}/${archivo}`, page, modo, destino: `${carpetaDest}/${destName}` });
      return res.json({ ok: true, data: { modo, destino: `${carpetaDest}/${destName}` } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinar-mover-hoja error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al mover la hoja' });
    }
  });

  // Lista lo trasladado de uno o varios agentes (?dnis=1,2,3).
  router.get('/trasladados', async (req: Request, res: Response) => {
    try {
      const dnis = String(req.query?.dnis || '').split(',').map((d) => parseDni(d.trim())).filter((d): d is number => !!d).slice(0, 1000);
      const rows: Array<{ dni: number; rel: string; carpeta: string; archivo: string; bytes: number; fecha: string }> = [];
      for (const dni of dnis) {
        const base = path.join(resolveDocuAgentDir(dni), TRASLADADOS_DIR);
        if (!fs.existsSync(base)) continue;
        for (const d of fs.readdirSync(base, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          for (const f of fs.readdirSync(path.join(base, d.name), { withFileTypes: true })) {
            if (!f.isFile() || /^thumbs\.db$/i.test(f.name) || f.name.includes('.tmp-')) continue;
            const st = fs.statSync(path.join(base, d.name, f.name));
            rows.push({ dni, rel: `${TRASLADADOS_DIR}/${d.name}/${f.name}`, carpeta: d.name, archivo: f.name, bytes: st.size, fecha: st.mtime.toISOString() });
          }
        }
      }
      rows.sort((a, b) => b.fecha.localeCompare(a.fecha));
      return res.json({ ok: true, data: { rows } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] trasladados error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al listar trasladados' });
    }
  });

  // Contenido de un trasladado (base64) para la vista previa.
  router.get('/trasladados/archivo', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(String(req.query?.dni || ''));
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const { archivo, fp } = trasladadoRel(dni, req.query?.rel);
      const tipo = COMBINAR_PDF.test(archivo) ? 'pdf' : COMBINAR_PNG.test(archivo) ? 'png' : COMBINAR_JPG.test(archivo) ? 'jpg' : 'otro';
      if (tipo === 'otro') return res.json({ ok: true, data: { tipo, base64: null } });
      return res.json({ ok: true, data: { tipo, base64: fs.readFileSync(fp).toString('base64') } });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al leer el archivo' });
    }
  });

  // Devuelve un trasladado a su subcarpeta de origen (sin pisar: agrega " (2)" si hace falta).
  router.post('/trasladados/restaurar', async (req: Request, res: Response) => {
    try {
      const dni = parseDni(req.body?.dni);
      if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const { carpeta, archivo, fp } = trasladadoRel(dni, req.body?.rel);
      const destDir = path.join(resolveDocuAgentDir(dni), carpeta);
      fs.mkdirSync(destDir, { recursive: true });
      const destName = nombreLibre(destDir, archivo);
      moverArchivo(fp, path.join(destDir, destName));
      logger.info({ msg: '[tramites] trasladado restaurado', dni, rel: req.body?.rel, destino: `${carpeta}/${destName}` });
      return res.json({ ok: true, data: { rel: `${carpeta}/${destName}` } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] restaurar trasladado error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al restaurar' });
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
      const seg = doc ? carpetaDocumento(doc) : '';
      // Con doc → subcarpeta del documento (carpetaDocumento/safeSegment evita traversal); sin doc → carpeta del agente.
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

  // ── Nota de designación para GDEBA ─────────────────────────────────────────
  // Texto = plantilla de la tanda (tramites_nota_designacion_plantilla, o el modelo
  // original) con los datos del agente; se puede retocar por agente (texto_editado = 1,
  // que "Generar" respeta). Estados: GENERADA → ENVIADA_FIRMA (robot o a mano) →
  // FIRMADA (con número IF) / ERROR.
  const NOTA_ESTADOS = ['GENERADA', 'ENVIADA_FIRMA', 'FIRMADA', 'ERROR'] as const;
  const actorDe = (req: Request) =>
    (req as any).auth?.principalType === 'user' ? Number((req as any).auth.principalId) || null : null;

  /** Escribe el .docx de la nota en DOCU\<dni>\Nota designacion GDEBA\ y devuelve la ruta relativa. */
  async function guardarDocxNota(dni: number, texto: string): Promise<string> {
    const dir = path.join(resolveDocuAgentDir(dni), NOTA_DESIG_SUBCARPETA);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `NOTA DESIGNACION GDEBA_${dni}.docx`);
    fs.writeFileSync(file, await docxDesdeTexto(texto));
    return `${NOTA_DESIG_SUBCARPETA}/${path.basename(file)}`;
  }

  // GET: vista previa de la tanda (datos + texto que va a llevar + estado de la nota).
  router.get('/tandas/nota-designacion', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.query.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      await ensureNotaDesignacionTable(sequelize);
      const { plantilla } = await plantillaDeTanda(sequelize, tanda);
      const agentes = (await listTandaAgentes(sequelize, tanda)) as any[];
      const previas = await sequelize.query<any>(
        `SELECT dni, estado, archivo, texto, texto_editado AS textoEditado,
                gdeba_numero AS gdebaNumero, gdeba_error AS gdebaError,
                DATE_FORMAT(generada_at, '%Y-%m-%d %H:%i') AS generadaAt,
                DATE_FORMAT(enviada_at, '%Y-%m-%d %H:%i') AS enviadaAt,
                DATE_FORMAT(firmada_at, '%Y-%m-%d %H:%i') AS firmadaAt,
                DATE_FORMAT(estado_at, '%Y-%m-%d %H:%i') AS estadoAt
           FROM tramites_nota_designacion WHERE tanda = :tanda`,
        { replacements: { tanda }, type: QueryTypes.SELECT },
      );
      const porDni = new Map(previas.map((r: any) => [Number(r.dni), r]));
      const data = [];
      for (const a of agentes) {
        const d = await datosNotaDesignacion(sequelize, Number(a.dni), a.dependenciaNombre);
        const nota = porDni.get(Number(a.dni)) || null;
        if (nota) nota.textoEditado = !!Number(nota.textoEditado);
        data.push({ ...d, textoPlantilla: d.faltan.length ? null : aplicarPlantilla(plantilla, d), nota });
      }
      return res.json({ ok: true, data });
    } catch (err: any) {
      logger.error({ msg: '[tramites] nota-designacion preview error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al armar las notas' });
    }
  });

  // POST: genera la nota de los DNI elegidos (o de toda la tanda): texto desde la
  // plantilla de la tanda + .docx en DOCU. Respeta el texto retocado a mano
  // (texto_editado = 1: solo rehace el .docx). No toca las ENVIADA_FIRMA / FIRMADA.
  router.post('/tandas/nota-designacion', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const pedidos: number[] | null = Array.isArray(req.body?.dnis)
        ? req.body.dnis.map((v: any) => parseDni(v)).filter((v: number | null): v is number => !!v)
        : null;
      await ensureNotaDesignacionTable(sequelize);
      const actor = actorDe(req);
      const { plantilla } = await plantillaDeTanda(sequelize, tanda);

      const agentes = ((await listTandaAgentes(sequelize, tanda)) as any[])
        .filter((a) => !pedidos || pedidos.includes(Number(a.dni)));
      if (!agentes.length) return res.status(404).json({ ok: false, error: 'No hay agentes para generar' });

      const generadas: Array<{ dni: number; archivo: string; editada: boolean }> = [];
      const salteadas: Array<{ dni: number; nombre: string; motivo: string }> = [];
      for (const a of agentes) {
        const dni = Number(a.dni);
        const nombre = String(a.apellidoNombre || `DNI ${dni}`);
        const d = await datosNotaDesignacion(sequelize, dni, a.dependenciaNombre);
        if (d.faltan.length) { salteadas.push({ dni, nombre, motivo: `Falta: ${d.faltan.join(', ')}` }); continue; }
        const [prev] = await sequelize.query<any>(
          'SELECT estado, texto, texto_editado FROM tramites_nota_designacion WHERE tanda = :tanda AND dni = :dni',
          { replacements: { tanda, dni }, type: QueryTypes.SELECT },
        );
        if (prev?.estado === 'ENVIADA_FIRMA' || prev?.estado === 'FIRMADA') {
          salteadas.push({ dni, nombre, motivo: prev.estado === 'FIRMADA' ? 'Ya está firmada' : 'Ya se envió a firmar' });
          continue;
        }
        const editada = !!Number(prev?.texto_editado);
        const texto = editada ? String(prev.texto) : aplicarPlantilla(plantilla, d);
        const rel = await guardarDocxNota(dni, texto);

        await sequelize.query(
          `INSERT INTO tramites_nota_designacion
             (tanda, dni, tratamiento, apellido_nombre, establecimiento, ley, horas, cargo, agrupamiento, categoria,
              texto, texto_editado, archivo, estado, gdeba_error, generada_at, generada_por)
           VALUES (:tanda, :dni, :tratamiento, :apellidoNombre, :establecimiento, :ley, :horas, :cargo, :agrupamiento, :categoria,
              :texto, 0, :archivo, 'GENERADA', NULL, NOW(), :actor)
           ON DUPLICATE KEY UPDATE
             tratamiento = VALUES(tratamiento), apellido_nombre = VALUES(apellido_nombre),
             establecimiento = VALUES(establecimiento), ley = VALUES(ley), horas = VALUES(horas),
             cargo = VALUES(cargo), agrupamiento = VALUES(agrupamiento), categoria = VALUES(categoria),
             texto = VALUES(texto), archivo = VALUES(archivo), estado = 'GENERADA', gdeba_error = NULL,
             generada_at = NOW(), generada_por = VALUES(generada_por)`,
          {
            replacements: {
              tanda, dni, tratamiento: d.tratamiento, apellidoNombre: d.apellidoNombre,
              establecimiento: d.establecimiento, ley: d.ley, horas: d.horas, cargo: d.cargo,
              agrupamiento: d.agrupamiento, categoria: d.categoria, texto, archivo: rel, actor,
            },
          },
        );
        generadas.push({ dni, archivo: rel, editada });
      }
      return res.json({ ok: true, data: { tanda, generadas, salteadas } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] nota-designacion generar error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al generar las notas' });
    }
  });

  // GET/PUT: plantilla (texto modelo con marcadores) de la tanda. PUT con plantilla
  // vacía/null vuelve al modelo original. No regenera: eso lo hace "Generar".
  router.get('/tandas/nota-designacion/plantilla', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.query.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const { plantilla, propia } = await plantillaDeTanda(sequelize, tanda);
      return res.json({ ok: true, data: { plantilla, propia, modelo: PLANTILLA_NOTA_DEFAULT, marcadores: MARCADORES_NOTA } });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al leer la plantilla' });
    }
  });

  router.put('/tandas/nota-designacion/plantilla', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      await ensureNotaDesignacionTable(sequelize);
      const plantilla = String(req.body?.plantilla ?? '').replace(/\r\n/g, '\n').trim();
      if (!plantilla) {
        await sequelize.query('DELETE FROM tramites_nota_designacion_plantilla WHERE tanda = :tanda', { replacements: { tanda } });
        return res.json({ ok: true, data: { propia: false } });
      }
      if (plantilla.length > 20000) return res.status(400).json({ ok: false, error: 'La plantilla es demasiado larga' });
      const desconocidos = [...new Set((plantilla.match(/\{[A-Z_]+\}/g) || [])
        .filter((m) => !MARCADORES_NOTA.some((k) => k.clave === m)))];
      if (desconocidos.length) return res.status(400).json({ ok: false, error: `Marcadores que no existen: ${desconocidos.join(', ')}` });
      await sequelize.query(
        `INSERT INTO tramites_nota_designacion_plantilla (tanda, plantilla, updated_by) VALUES (:tanda, :plantilla, :u)
         ON DUPLICATE KEY UPDATE plantilla = VALUES(plantilla), updated_by = VALUES(updated_by)`,
        { replacements: { tanda, plantilla, u: actorDe(req) } },
      );
      return res.json({ ok: true, data: { propia: true } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] nota-designacion plantilla error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al guardar la plantilla' });
    }
  });

  // PUT: retoca el texto de UNA nota (queda texto_editado = 1 y se rehace el .docx).
  // texto vacío/null = volver a la plantilla de la tanda. No se edita una ya enviada/firmada.
  router.put('/tandas/nota-designacion/texto', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const dni = parseDni(req.body?.dni);
      if (!tanda || !dni) return res.status(400).json({ ok: false, error: 'Falta la tanda o el DNI' });
      await ensureNotaDesignacionTable(sequelize);
      const [nota] = await sequelize.query<any>(
        'SELECT estado FROM tramites_nota_designacion WHERE tanda = :tanda AND dni = :dni',
        { replacements: { tanda, dni }, type: QueryTypes.SELECT },
      );
      if (!nota) return res.status(404).json({ ok: false, error: 'Primero generá la nota de este agente' });
      if (nota.estado === 'ENVIADA_FIRMA' || nota.estado === 'FIRMADA')
        return res.status(409).json({ ok: false, error: 'La nota ya se envió a firmar: no se puede editar' });

      let texto = String(req.body?.texto ?? '').replace(/\r\n/g, '\n').trim();
      let editado = 1;
      if (!texto) {
        const [a] = ((await listTandaAgentes(sequelize, tanda)) as any[]).filter((x) => Number(x.dni) === dni);
        const d = await datosNotaDesignacion(sequelize, dni, a?.dependenciaNombre);
        texto = aplicarPlantilla((await plantillaDeTanda(sequelize, tanda)).plantilla, d);
        editado = 0;
      }
      if (texto.length > 20000) return res.status(400).json({ ok: false, error: 'El texto es demasiado largo' });
      const rel = await guardarDocxNota(dni, texto);
      await sequelize.query(
        `UPDATE tramites_nota_designacion SET texto = :texto, texto_editado = :editado, archivo = :rel,
                estado = IF(estado = 'ERROR', 'GENERADA', estado), gdeba_error = NULL
          WHERE tanda = :tanda AND dni = :dni`,
        { replacements: { texto, editado, rel, tanda, dni } },
      );
      return res.json({ ok: true, data: { dni, textoEditado: !!editado, archivo: rel } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] nota-designacion texto error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al guardar el texto' });
    }
  });

  // PUT: marca a mano el estado de una o varias notas (Enviada a firmar / Firmada con
  // número IF / Generada para volver atrás / Error).
  router.put('/tandas/nota-designacion/estado', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      const dnis: number[] = (Array.isArray(req.body?.dnis) ? req.body.dnis : [req.body?.dni])
        .map((v: any) => parseDni(v)).filter((v: number | null): v is number => !!v);
      const estado = String(req.body?.estado || '').toUpperCase();
      if (!tanda || !dnis.length) return res.status(400).json({ ok: false, error: 'Falta la tanda o el DNI' });
      if (!(NOTA_ESTADOS as readonly string[]).includes(estado)) return res.status(400).json({ ok: false, error: 'Estado inválido' });
      const numero = String(req.body?.gdebaNumero ?? '').trim().toUpperCase() || null;
      if (estado === 'FIRMADA' && numero && !/^[A-Z]{2,5}-\d{4}-\d{5,10}-GDEBA-[A-Z0-9]+$/.test(numero))
        return res.status(400).json({ ok: false, error: 'Número inválido: tiene que ser como IF-2026-40518978-GDEBA-HPDIGAMSALGP' });
      const error = estado === 'ERROR' ? String(req.body?.motivo ?? '').trim().slice(0, 500) || 'Marcado a mano' : null;
      await ensureNotaDesignacionTable(sequelize);
      const [, meta]: any = await sequelize.query(
        `UPDATE tramites_nota_designacion
            SET estado = :estado, estado_at = NOW(), estado_por = :u,
                enviada_at = CASE WHEN :estado IN ('ENVIADA_FIRMA','FIRMADA') THEN COALESCE(enviada_at, NOW()) ELSE NULL END,
                firmada_at = CASE WHEN :estado = 'FIRMADA' THEN COALESCE(firmada_at, NOW()) ELSE NULL END,
                gdeba_numero = CASE WHEN :estado = 'FIRMADA' THEN COALESCE(:numero, gdeba_numero) ELSE gdeba_numero END,
                gdeba_error = :error
          WHERE tanda = :tanda AND dni IN (:dnis)`,
        { replacements: { estado, u: actorDe(req), numero, error, tanda, dnis } },
      );
      return res.json({ ok: true, data: { actualizadas: Number(meta?.affectedRows ?? 0) } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] nota-designacion estado error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al cambiar el estado' });
    }
  });

  // POST: dispara el robot que carga las notas en GDEBA y las envía a firmar
  // (scripts/gdeba_nota_designacion.py vía run_robot). El pedido (tanda, prueba,
  // dnis) queda en app_runtime_config porque run_robot no pasa parámetros.
  // prueba = true (default): 1 nota, frena antes de "Enviar a firmar".
  router.post('/tandas/nota-designacion/gdeba', async (req: Request, res: Response) => {
    try {
      const tanda = queryString(req.body?.tanda);
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const prueba = req.body?.prueba !== false && req.body?.prueba !== 'false';
      const dnis: number[] | undefined = Array.isArray(req.body?.dnis)
        ? req.body.dnis.map((v: any) => parseDni(v)).filter((v: number | null): v is number => !!v)
        : undefined;
      await ensureNotaDesignacionTable(sequelize);
      const [{ n }] = await sequelize.query<any>(
        `SELECT COUNT(*) AS n FROM tramites_nota_designacion
          WHERE tanda = :tanda AND estado IN ('GENERADA','ERROR') ${dnis?.length ? 'AND dni IN (:dnis)' : ''}`,
        { replacements: { tanda, dnis: dnis?.length ? dnis : [0] }, type: QueryTypes.SELECT },
      );
      if (!Number(n)) return res.status(400).json({ ok: false, error: 'No hay notas generadas pendientes de cargar en GDEBA' });
      const actor = (req as any).auth?.principalType === 'user' ? Number((req as any).auth.principalId) || null : null;
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES ('gdeba_nota_designacion_pedido', :j, :u, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { j: JSON.stringify({ tanda, prueba, ...(dnis?.length ? { dnis } : {}) }), u: actor } },
      );
      const como = await ejecutarAhora('gdeba_nota_designacion');
      return res.json({ ok: true, data: { tanda, prueba, pendientes: Number(n), como } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] nota-designacion gdeba error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'No se pudo lanzar el robot de GDEBA' });
    }
  });

  // ── Combinados de "Tramite de nombramiento" → GDEBA (IFGRA) ─────────────────
  // Lista los PDF de DOCU\<DNI>\Tramite de nombramiento\ (los graba "Guardar combinado")
  // con el estado de su envío a GDEBA (tabla tramites_combinado_gdeba, mig 131).
  // Recorrer las ~3000 carpetas de DOCU tarda ~25 s, así que la lista sale de la tabla
  // (cada "Guardar combinado" anota su archivo). ?rescan=1 recorre el disco y anota los
  // que falten (para los guardados antes de esta pestaña o copiados a mano).
  router.get('/combinados', async (req: Request, res: Response) => {
    try {
      await ensureCombinadoGdebaTable(sequelize);
      const base = path.resolve(getDocuBaseDir());
      if (!getDocuBaseDir() || !fs.existsSync(base)) {
        return res.status(400).json({ ok: false, error: `Carpeta DOCU no disponible: ${base}` });
      }
      if (String(req.query.rescan || '') === '1') {
        for (const d of fs.readdirSync(base, { withFileTypes: true })) {
          if (!d.isDirectory() || !/^\d{6,9}$/.test(d.name)) continue;
          const dir = path.join(base, d.name, COMBINAR_NOMBRE_SALIDA);
          if (!fs.existsSync(dir)) continue;
          for (const f of fs.readdirSync(dir)) {
            // los "... - FIRMADO IF-....pdf" los baja el robot de firmados: no son combinados nuevos
            if (f.toLowerCase().endsWith('.pdf') && !/ - FIRMADO /i.test(f)) {
              await registrarCombinado(sequelize, Number(d.name), `${d.name}/${COMBINAR_NOMBRE_SALIDA}/${f}`);
            }
          }
        }
      }
      const registrados = await sequelize.query<any>(`SELECT dni, archivo FROM tramites_combinado_gdeba`, { type: QueryTypes.SELECT });
      const archivos: { dni: number; archivo: string; nombreArchivo: string; bytes: number; modificado: string }[] = [];
      for (const r of registrados) {
        const full = path.join(base, ...String(r.archivo).split('/'));
        if (!fs.existsSync(full)) continue; // borrado o renombrado a mano: no se lista
        const st = fs.statSync(full);
        archivos.push({
          dni: Number(r.dni),
          archivo: String(r.archivo),
          nombreArchivo: path.basename(full),
          bytes: st.size,
          modificado: st.mtime.toISOString(),
        });
      }
      const dnis = [...new Set(archivos.map((a) => a.dni))];
      const personas = dnis.length
        ? await sequelize.query<any>(
          `SELECT dni, TRIM(CONCAT(COALESCE(apellido,''), ', ', COALESCE(nombre,''))) AS apellidoNombre
             FROM personal WHERE dni IN (:dnis)`,
          { replacements: { dnis }, type: QueryTypes.SELECT })
        : [];
      const nombres = new Map(personas.map((p: any) => [Number(p.dni), String(p.apellidoNombre)]));
      const estados = await sequelize.query<any>(
        `SELECT archivo, estado, firmante, gdeba_numero AS gdebaNumero, gdeba_error AS gdebaError,
                enviada_at AS enviadaAt, estado_at AS estadoAt, archivo_firmado AS archivoFirmado,
                firmada_at AS firmadaAt
           FROM tramites_combinado_gdeba`,
        { type: QueryTypes.SELECT });
      const porArchivo = new Map(estados.map((e: any) => [String(e.archivo), e]));
      const rows = archivos
        .map((a) => {
          const e: any = porArchivo.get(a.archivo) || {};
          return {
            ...a,
            apellidoNombre: nombres.get(a.dni) || `DNI ${a.dni}`,
            estado: e.estado || 'PENDIENTE',
            firmante: e.firmante || null,
            gdebaNumero: e.gdebaNumero || null,
            gdebaError: e.gdebaError || null,
            enviadaAt: e.enviadaAt || null,
            firmadaAt: e.firmadaAt || null,
            // solo si el PDF firmado sigue en disco
            archivoFirmado: e.archivoFirmado && fs.existsSync(path.join(base, ...String(e.archivoFirmado).split('/')))
              ? String(e.archivoFirmado) : null,
          };
        })
        .sort((x, y) => x.apellidoNombre.localeCompare(y.apellidoNombre, 'es'));
      return res.json({ ok: true, data: { rows, carpeta: base } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinados list error', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message || 'Error al listar combinados' });
    }
  });

  // Ver un combinado (archivo = "<dni>/Tramite de nombramiento/<archivo>.pdf").
  router.get('/combinados/pdf', (req: Request, res: Response) => {
    try {
      const fullPath = resolverCombinado(String(req.query.archivo || ''));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath).replace(/"/g, '_')}"`);
      return fs.createReadStream(fullPath).pipe(res);
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al abrir el PDF' });
    }
  });

  // Cambio manual de estado (p.ej. FIRMADA con su número de GDEBA, o volver a PENDIENTE).
  router.put('/combinados/estado', async (req: Request, res: Response) => {
    try {
      await ensureCombinadoGdebaTable(sequelize);
      const archivo = String(req.body?.archivo || '');
      const fullPath = resolverCombinado(archivo);
      const estado = String(req.body?.estado || '').toUpperCase();
      if (!['PENDIENTE', 'ENVIADA_FIRMA', 'FIRMADA', 'ERROR'].includes(estado)) {
        return res.status(400).json({ ok: false, error: 'Estado inválido' });
      }
      const numero = String(req.body?.gdebaNumero || '').trim() || null;
      const actor = (req as any).auth?.principalType === 'user' ? Number((req as any).auth.principalId) || null : null;
      const dni = Number(archivo.split('/')[0]);
      await sequelize.query(
        `INSERT INTO tramites_combinado_gdeba (dni, archivo, estado, gdeba_numero, estado_at, estado_por)
         VALUES (:dni, :archivo, :estado, :numero, NOW(), :actor)
         ON DUPLICATE KEY UPDATE estado = VALUES(estado), gdeba_numero = COALESCE(VALUES(gdeba_numero), gdeba_numero),
           gdeba_error = IF(VALUES(estado) = 'ERROR', gdeba_error, NULL), estado_at = NOW(), estado_por = VALUES(estado_por)`,
        { replacements: { dni, archivo: archivoRelCombinado(fullPath), estado, numero, actor } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error al cambiar el estado' });
    }
  });

  // Dispara el robot gdeba_combinado_firmados.py: busca en GEDO (Avisos) los combinados
  // enviados a firmar y baja los firmados a la misma carpeta. Solo lectura en GDEBA.
  router.post('/combinados/bajar-firmados', async (req: Request, res: Response) => {
    try {
      await ensureCombinadoGdebaTable(sequelize);
      const archivos: string[] = (Array.isArray(req.body?.archivos) ? req.body.archivos : [])
        .map((a: any) => String(a || '')).filter(Boolean);
      const [{ n }] = await sequelize.query<any>(
        `SELECT COUNT(*) AS n FROM tramites_combinado_gdeba WHERE estado = 'ENVIADA_FIRMA'
         ${archivos.length ? 'AND archivo IN (:archivos)' : ''}`,
        { replacements: { archivos: archivos.length ? archivos : [''] }, type: QueryTypes.SELECT },
      );
      if (!Number(n)) return res.status(400).json({ ok: false, error: 'No hay combinados enviados a firmar para buscar' });
      const actor = (req as any).auth?.principalType === 'user' ? Number((req as any).auth.principalId) || null : null;
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES ('gdeba_combinado_firmados_pedido', :j, :u, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { j: JSON.stringify(archivos.length ? { archivos } : {}), u: actor } },
      );
      const como = await ejecutarAhora('gdeba_combinado_firmados');
      return res.json({ ok: true, data: { buscar: Number(n), como } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinados bajar-firmados error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'No se pudo lanzar el robot' });
    }
  });

  // Dispara el robot gdeba_combinado_ifgra.py: sube cada PDF como Informe Gráfico (IFGRA)
  // y lo envía a firmar al usuario GDEBA indicado. prueba = true (default): 1 archivo,
  // frena antes de Aceptar. El pedido va a app_runtime_config (run_robot no pasa parámetros).
  router.post('/combinados/gdeba', async (req: Request, res: Response) => {
    try {
      await ensureCombinadoGdebaTable(sequelize);
      const archivos: string[] = (Array.isArray(req.body?.archivos) ? req.body.archivos : [])
        .map((a: any) => archivoRelCombinado(resolverCombinado(String(a || ''))));
      if (!archivos.length) return res.status(400).json({ ok: false, error: 'Elegí al menos un combinado' });
      const firmante = String(req.body?.firmanteUsuario || '').trim().toUpperCase();
      if (!/^[A-Z0-9._-]{3,40}$/.test(firmante)) {
        return res.status(400).json({ ok: false, error: 'Falta el usuario GDEBA del firmante (ej. el usuario de GDEBA, no el nombre)' });
      }
      const prueba = req.body?.prueba !== false && req.body?.prueba !== 'false';
      for (const a of archivos) {
        await sequelize.query(
          `INSERT INTO tramites_combinado_gdeba (dni, archivo, estado) VALUES (:dni, :a, 'PENDIENTE')
           ON DUPLICATE KEY UPDATE dni = dni`,
          { replacements: { dni: Number(a.split('/')[0]), a } },
        );
      }
      const actor = (req as any).auth?.principalType === 'user' ? Number((req as any).auth.principalId) || null : null;
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES ('gdeba_combinado_ifgra_pedido', :j, :u, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { j: JSON.stringify({ archivos: prueba ? archivos.slice(0, 1) : archivos, prueba, firmanteUsuario: firmante }), u: actor } },
      );
      const como = await ejecutarAhora('gdeba_combinado_ifgra');
      return res.json({ ok: true, data: { archivos: prueba ? 1 : archivos.length, prueba, firmante, como } });
    } catch (err: any) {
      logger.error({ msg: '[tramites] combinados gdeba error', error: err?.message });
      return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'No se pudo lanzar el robot de GDEBA' });
    }
  });

  return router;
}
