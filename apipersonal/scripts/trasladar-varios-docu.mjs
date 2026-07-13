import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import mysql from 'mysql2/promise';
import mammoth from 'mammoth';
import xlsx from 'xlsx';

const ROOT = 'D:/G/VARIOS';
const DOCU = 'D:/G/DOCU';
const MOVED_ROOT = path.join(ROOT, 'TRASLADADOS');
const REPORT_DIR = path.join(process.cwd(), 'tmp', 'varios-docu');
const DRY_RUN = !process.argv.includes('--apply');
const SKIP_OCR = process.argv.includes('--no-ocr');
const FORCE_OCR = process.argv.includes('--force-ocr');
const ONLY_ARG = process.argv.find((arg) => arg.startsWith('--only='));
const ONLY = ONLY_ARG ? ONLY_ARG.slice('--only='.length).replace(/^"|"$/g, '') : '';
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : 0;
const MAX_MOVED_ARG = process.argv.find((arg) => arg.startsWith('--max-moved='));
const MAX_MOVED = MAX_MOVED_ARG ? Number(MAX_MOVED_ARG.split('=')[1]) : 0;
const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES || 2);
const MULTI_DNI_LIMIT = Number(process.env.MULTI_DNI_LIMIT || 12);
const OCR_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp']);
const TEXT_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.txt']);

const NOISE = new Set([
  'ad', 'referendum', 'art', 'sisa', 'snvs', 'covid', 'baja', 'seguro', 'seguros',
  'asignacion', 'asignaciones', 'familiar', 'prenatal', 'escolaridad', 'escolar',
  'matrimonio', 'hijo', 'hijos', 'subsidio', 'guarderia', 'denuncia', 'siniestro',
  'positivo', 'negativo', 'resultado', 'informe', 'informes', 'grafico', 'graficos',
  'legajo', 'legajos', 'digital', 'nac', 'ddjj', 'declaracion', 'jurada', 'formulario',
  'solicitud', 'mail', 'scan', 'ultimo', 'corregido', 'nuevo', 'alta', 'medica',
  'cert', 'certificado', 'matricula', 'gdeba', 'hpdigamsalgp', 'hpdzgamsalgp',
  'del', 'las', 'los', 'con', 'para', 'hacer', 'viejo', 'vieja', 'viejas',
  'anexo', 'acceso', 'directo', 'image', 'whatsapp', 'nota', 'notas', 'agente',
  'agentes', 'reclamo', 'reclamos', 'haberes', 'asistencia', 'recategorizacion',
  'reconocimiento', 'reconocimientos', 'servicio', 'servicios', 'antiguedad',
  'cbu', 'detalles', 'varios', 'recibidos', 'wsp', 'enviar', 'temporarios',
  'renuncia', 'renuncias', 'renovacion', 'becas', 'beca', 'fichaje', 'rupa',
  'telegrama', 'telegramas', 'samo', 'zona', 'desfavorable', 'upa', 'planilla',
  'bloqueo', 'bloqueos', 'ampliacion', 'ampliaciones', 'extension', 'titulo',
  'pendientes', 'nro', 'expedientes', 'expediente', 'domicilio', 'domicilios',
  'vacunacion', 'cedula', 'cedulas', 'reso', 'resolucion', 'abandono', 'pagare',
  'def', 'fallecimiento', 'cese', 'cargo', 'cesantia', 'notificacion',
  'limitacion', 'retiro', 'certificacion', 'licencias', 'licencia', 'sin',
  'identificar', 'remitos', 'ips', 'pases', 'ley', 'tramite', 'ficha',
]);

class NapiCanvasFactory {
  constructor(canvasMod) {
    this.canvasMod = canvasMod;
  }

  create(width, height) {
    const canvas = this.canvasMod.createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = Math.max(1, width);
    canvasAndContext.canvas.height = Math.max(1, height);
  }

  destroy(canvasAndContext) {
    try {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    } catch {
      // pdfjs can hand back napi canvas references that are already released.
    }
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function norm(value) {
  return stripAccents(value).toLowerCase();
}

function cleanTokens(value) {
  return norm(value)
    .replace(/[_-]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => /^[a-z]+$/.test(token) && token.length >= 3 && !NOISE.has(token));
}

function envValue(text, key) {
  return (text.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim();
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function writeCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => row.map(csvCell).join(',')).join('\r\n'), 'utf8');
}

function appendCsv(file, row) {
  fs.appendFileSync(file, `${row.map(csvCell).join(',')}\r\n`, 'utf8');
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function sameFileContent(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  return sa.size === sb.size && hashFile(a) === hashFile(b);
}

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(target);
  const stem = target.slice(0, target.length - ext.length);
  let i = 1;
  let candidate = `${stem}__varios_${i}${ext}`;
  while (fs.existsSync(candidate)) {
    i += 1;
    candidate = `${stem}__varios_${i}${ext}`;
  }
  return candidate;
}

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'TRASLADADOS') continue;
    if (entry.name.startsWith('_')) continue;
    if (entry.name.startsWith('_traslado_varios_docu_')) continue;
    if (entry.name.toLowerCase() === 'thumbs.db') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    if (entry.isFile()) files.push(full);
  }
  return files;
}

function collectDnis(text, dniSet) {
  const found = new Set();
  const input = String(text || '').replace(/\s+/g, ' ');
  for (const match of input.matchAll(/\b(?:20|23|24|27|30|33|34)[-\s.]?(\d{7,8})[-\s.]?\d\b/g)) {
    const dni = String(Number(match[1]));
    if (dniSet.has(dni)) found.add(dni);
  }
  for (const match of input.matchAll(/\b(?:DNI|D\.N\.I\.|DOCUMENTO|DOC\.?|DU|CUIL|CUIT)\D{0,28}(\d{7,8})\b/gi)) {
    const dni = String(Number(match[1]));
    if (dniSet.has(dni)) found.add(dni);
  }
  for (const match of input.matchAll(/(?<!\d)(\d{7,8})(?!\d)/g)) {
    const dni = String(Number(match[1]));
    if (dniSet.has(dni)) found.add(dni);
  }
  return [...found];
}

function collectAnyDnis(text) {
  const found = new Set();
  const input = String(text || '').replace(/\s+/g, ' ');
  const addClean = (value) => {
    const dni = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
    if (dni.length >= 7 && dni.length <= 8) found.add(dni);
  };
  for (const match of input.matchAll(/\b(?:20|23|24|27|30|33|34)[-\s.]?(\d{7,8})[-\s.]?\d\b/g)) {
    addClean(match[1]);
  }
  for (const match of input.matchAll(/\b(?:DNI|D\.N\.I\.|DOCUMENTO|DOC\.?|DU|CUIL|CUIT)\D{0,28}(\d[\d.\s-]{5,16}\d)\b/gi)) {
    addClean(match[1]);
  }
  for (const match of input.matchAll(/\b(\d{1,2}[. ]\d{3}[. ]\d{3})\b/g)) {
    addClean(match[1]);
  }
  return [...found];
}

async function loadAgents() {
  const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
  const conn = await mysql.createConnection({
    host: envValue(envText, 'DB_HOST') || '127.0.0.1',
    port: Number(envValue(envText, 'DB_PORT') || 3306),
    user: envValue(envText, 'DB_USER') || 'root',
    password: envValue(envText, 'DB_PASSWORD') || '',
    database: envValue(envText, 'DB_NAME') || 'personalv5',
  });
  const [rows] = await conn.query(`
    SELECT dni, apellido, nombre
    FROM personal
    WHERE deleted_at IS NULL
      AND dni IS NOT NULL
      AND dni REGEXP '^[0-9]{7,8}$'
  `);
  await conn.end();
  const agents = rows.map((row) => {
    const dni = String(row.dni);
    const apellidoTokens = cleanTokens(row.apellido);
    const nombreTokens = cleanTokens(row.nombre);
    return {
      dni,
      label: `${row.apellido || ''}, ${row.nombre || ''}`.trim(),
      tokens: new Set([...apellidoTokens, ...nombreTokens]),
      apellidoTokens,
      nombreTokens,
    };
  });
  return { agents, dniSet: new Set(agents.map((agent) => agent.dni)) };
}

function scoreAgent(tokens, agent) {
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((token) => agent.tokens.has(token)).length;
  if (hits === 0) return 0;
  const surnameHit = agent.apellidoTokens.some((token) => tokens.includes(token));
  const nameHit = agent.nombreTokens.some((token) => tokens.includes(token));
  const allTokensHit = hits === tokens.length;
  if (tokens.length >= 2 && allTokensHit && surnameHit && nameHit) return 100 + hits;
  if (tokens.length >= 2 && allTokensHit) return 80 + hits;
  if (tokens.length === 1 && allTokensHit && surnameHit) return 45;
  return 0;
}

function resolveByName(text, agents) {
  const tokens = [...new Set(cleanTokens(text))];
  if (tokens.length === 0) return [];
  const scored = agents
    .map((agent) => ({ agent, score: scoreAgent(tokens, agent) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  const best = scored[0].score;
  const winners = scored.filter((item) => item.score === best).map((item) => item.agent);
  if (best >= 80 && winners.length <= MULTI_DNI_LIMIT) return winners;
  if (best === 45 && winners.length === 1) return winners;
  return [];
}

async function loadPdfText(file, pdfjs, canvasFactory) {
  try {
    const data = new Uint8Array(fs.readFileSync(file));
    const pdf = await pdfjs.getDocument({ data, disableWorker: true, canvasFactory }).promise;
    const pages = Math.min(pdf.numPages, 4);
    const parts = [];
    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      parts.push((content.items || []).map((item) => String(item.str || '')).join(' '));
    }
    await pdf.destroy?.();
    return parts.join('\n');
  } catch {
    return '';
  }
}

async function loadOfficeText(file) {
  try {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: file });
      return result.value || '';
    }
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(file, { dense: false, cellDates: false });
      return workbook.SheetNames
        .slice(0, 3)
        .map((name) => xlsx.utils.sheet_to_csv(workbook.Sheets[name], { FS: ' ', RS: '\n' }))
        .join('\n');
    }
    if (ext === '.csv' || ext === '.txt') {
      return fs.readFileSync(file, 'utf8').slice(0, 200000);
    }
  } catch {
    return '';
  }
  return '';
}

async function ocrFile(file, worker, pdfjs, canvasMod, canvasFactory) {
  try {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.pdf') return await ocrPdf(file, worker, pdfjs, canvasMod, canvasFactory);
    const result = await worker.recognize(file);
    return result?.data?.text || '';
  } catch {
    return '';
  }
}

async function ocrPdf(file, worker, pdfjs, canvasMod, canvasFactory) {
  const { createCanvas } = canvasMod;
  let out = '';
  let tmp = null;
  try {
    const data = new Uint8Array(fs.readFileSync(file));
    const pdf = await pdfjs.getDocument({ data, disableWorker: true, canvasFactory }).promise;
    const pages = Math.min(pdf.numPages, OCR_MAX_PAGES);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'varios-ocr-'));
    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const jpg = path.join(tmp, `p${i}.jpg`);
      fs.writeFileSync(jpg, await canvas.encode('jpeg', 90));
      const result = await worker.recognize(jpg);
      out += `\n${result?.data?.text || ''}`;
    }
    await pdf.destroy?.();
  } catch {
    return out;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

function copyPreservingTimes(src, dest) {
  const stat = fs.statSync(src);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, stat.mode);
  fs.utimesSync(dest, stat.atime, stat.mtime);
}

function movePreservingStructure(src, rel) {
  const target = uniquePath(path.join(MOVED_ROOT, rel));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(src, target);
  return target;
}

function copyToDocu(src, rel, dni) {
  const dniDir = path.join(DOCU, dni);
  const folderStatus = fs.existsSync(dniDir) ? 'carpeta_existente' : 'carpeta_creada';
  if (!fs.existsSync(dniDir)) fs.mkdirSync(dniDir, { recursive: true });
  const expected = path.join(dniDir, 'VARIOS', rel);
  if (fs.existsSync(expected) && sameFileContent(src, expected)) {
    return { dest: expected, status: 'ya_existia_igual', folderStatus };
  }
  const dest = uniquePath(expected);
  copyPreservingTimes(src, dest);
  return { dest, status: dest === expected ? 'copiado' : 'copiado_con_sufijo', folderStatus };
}

function mergeDnis(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const { agents, dniSet } = await loadAgents();
  const startRoot = ONLY ? path.resolve(ONLY) : ROOT;
  const files = LIMIT > 0 ? walkFiles(startRoot).slice(0, LIMIT) : walkFiles(startRoot);

  const pdfjs = await import(pathToFileURL(path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  const canvasMod = await import('@napi-rs/canvas');
  globalThis.DOMMatrix = globalThis.DOMMatrix ?? canvasMod.DOMMatrix;
  globalThis.Path2D = globalThis.Path2D ?? canvasMod.Path2D;
  globalThis.ImageData = globalThis.ImageData ?? canvasMod.ImageData;
  const canvasFactory = new NapiCanvasFactory(canvasMod);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa');

  const suffix = DRY_RUN ? 'simulacion' : 'aplicado';
  const movedCsv = path.join(REPORT_DIR, `_traslado_varios_docu_${stamp}_${suffix}_movidos.csv`);
  const reviewCsv = path.join(REPORT_DIR, `_traslado_varios_docu_${stamp}_${suffix}_revisar.csv`);
  const summaryJson = path.join(REPORT_DIR, `_traslado_varios_docu_${stamp}_${suffix}_resumen.json`);
  const movedRows = [['origen', 'dni', 'agente', 'via', 'destino_docu', 'estado_copia', 'estado_carpeta_dni', 'destino_trasladados']];
  const reviewRows = [['origen', 'estado', 'via', 'dnis_o_candidatos']];
  writeCsv(movedCsv, movedRows);
  writeCsv(reviewCsv, reviewRows);
  let copiedFiles = 0;
  let movedFiles = 0;
  let reviewed = 0;
  let ocrUsed = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const rel = path.relative(ROOT, file);
    const ext = path.extname(file).toLowerCase();
    const nameContext = `${rel} ${path.basename(file, ext)}`;

    let via = 'nombre_archivo';
    let dnis = [];

    if (FORCE_OCR && !SKIP_OCR && OCR_EXTS.has(ext)) {
      via = 'ocr';
      console.log(`OCR ${index + 1}/${files.length}: ${rel}`);
      const text = await ocrFile(file, worker, pdfjs, canvasMod, canvasFactory);
      dnis = collectAnyDnis(text);
      ocrUsed += 1;
    }

    if (dnis.length === 0) {
      via = 'nombre_archivo';
      const stem = path.basename(file, ext);
      dnis = mergeDnis(
        collectAnyDnis(nameContext),
        resolveByName(stem, agents).map((agent) => agent.dni),
        resolveByName(nameContext, agents).map((agent) => agent.dni)
      );
    }

    if (dnis.length === 0 && TEXT_EXTS.has(ext)) {
      via = 'texto';
      const text = ext === '.pdf' ? await loadPdfText(file, pdfjs, canvasFactory) : await loadOfficeText(file);
      dnis = collectAnyDnis(text);
    }

    if (dnis.length === 0 && !FORCE_OCR && !SKIP_OCR && OCR_EXTS.has(ext)) {
      via = 'ocr';
      console.log(`OCR ${index + 1}/${files.length}: ${rel}`);
      const text = await ocrFile(file, worker, pdfjs, canvasMod, canvasFactory);
      dnis = collectAnyDnis(text);
      ocrUsed += 1;
    }

    if (dnis.length === 0) {
      reviewed += 1;
      const row = [rel, 'sin_identificar', via, ''];
      reviewRows.push(row);
      appendCsv(reviewCsv, row);
      continue;
    }

    if (dnis.length > MULTI_DNI_LIMIT) {
      reviewed += 1;
      const row = [rel, `multiples_dni_${dnis.length}`, via, dnis.join(' ')];
      reviewRows.push(row);
      appendCsv(reviewCsv, row);
      continue;
    }

    const movedTarget = DRY_RUN ? path.join(MOVED_ROOT, rel) : null;
    const destinations = [];
    for (const dni of dnis) {
      const agent = agents.find((item) => item.dni === dni);
      const copyResult = DRY_RUN
        ? {
            dest: path.join(DOCU, dni, 'VARIOS', rel),
            status: fs.existsSync(path.join(DOCU, dni, 'VARIOS', rel)) ? 'simulado_ya_existe' : 'simulado_copiar',
            folderStatus: fs.existsSync(path.join(DOCU, dni)) ? 'carpeta_existente' : 'simulado_crear_carpeta',
          }
        : copyToDocu(file, rel, dni);
      copiedFiles += 1;
      destinations.push(copyResult.dest);
      const row = [rel, dni, agent?.label || '', via, copyResult.dest, copyResult.status, copyResult.folderStatus, movedTarget || ''];
      movedRows.push(row);
      appendCsv(movedCsv, row);
    }

    let actualMovedTarget = movedTarget;
    if (!DRY_RUN) {
      actualMovedTarget = movePreservingStructure(file, rel);
      movedFiles += 1;
      for (let i = movedRows.length - dnis.length; i < movedRows.length; i += 1) {
        movedRows[i][7] = actualMovedTarget;
      }
      writeCsv(movedCsv, movedRows);
      if (MAX_MOVED > 0 && movedFiles >= MAX_MOVED) break;
    }

    if ((index + 1) % 25 === 0) {
      console.log(`${index + 1}/${files.length} revisados | identificados copias=${copiedFiles} | revisar=${reviewed} | ocr=${ocrUsed}`);
    }
  }

  await worker.terminate();

  writeCsv(movedCsv, movedRows);
  writeCsv(reviewCsv, reviewRows);
  fs.writeFileSync(summaryJson, JSON.stringify({
    dryRun: DRY_RUN,
    root: ROOT,
    startRoot,
    docu: DOCU,
    movedRoot: MOVED_ROOT,
    skipOcr: SKIP_OCR,
    forceOcr: FORCE_OCR,
    limit: LIMIT || null,
    maxMoved: MAX_MOVED || null,
    filesSeen: files.length,
    agentFoldersUsable: agents.length,
    copyRows: copiedFiles,
    sourceFilesMoved: movedFiles,
    reviewRows: reviewed,
    ocrUsed,
    reports: { movedCsv, reviewCsv },
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    modo: DRY_RUN ? 'simulacion' : 'aplicado',
    archivos_revisados: files.length,
    filas_copiadas_o_simuladas: copiedFiles,
    archivos_origen_movidos: movedFiles,
    para_revisar: reviewed,
    ocr_usado: ocrUsed,
    reporte_movidos: movedCsv,
    reporte_revisar: reviewCsv,
    resumen: summaryJson,
  }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
