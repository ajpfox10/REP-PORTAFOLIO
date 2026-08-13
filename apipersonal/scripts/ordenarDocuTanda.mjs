// scripts/ordenarDocuTanda.mjs
// Clasifica los archivos sueltos de DOCU\<dni> y los MUEVE a la subcarpeta que
// corresponde, SOLO para: DNI, CUIL, Titulo, Matricula, Etico.
// Método: nombre de archivo primero; si no alcanza, OCR (texto del PDF, o
// render+OCR / OCR de imagen con tesseract 'spa'). Conservador: lo que no
// reconoce queda quieto; palabras como "conyugue/hijo" vetan el archivo.
// No pisa: si el destino ya tiene ese nombre, renombra con sufijo.
//
// Uso:
//   node scripts/ordenarDocuTanda.mjs --dni=41352780            (dry-run 1 agente)
//   node scripts/ordenarDocuTanda.mjs --dni=41352780 --apply    (mueve)
//   node scripts/ordenarDocuTanda.mjs --tanda=prueba            (dry-run tanda)
//   node scripts/ordenarDocuTanda.mjs --tanda=prueba --apply    (mueve tanda)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APPLY = !!args.apply;
const ROOT = process.cwd();
const envRaw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const g = (k) => (envRaw.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
const DOCU = (g('TRAMITES_DOCU_BASE_DIR') || 'D:/G/DOCU').replace(/\\/g, '/');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Veto: si el nombre/texto menciona a un familiar, no es el documento del agente.
const VETO = /conyug|esposa|esposo|\bhij[oa]s?\b|madre|padre|conviviente/;

// Reglas por NOMBRE de archivo (base, normalizada). Bordes con [^a-z] para no
// romper con guiones bajos (dni_1) ni cortar palabras.
const REGLAS_NOMBRE = [
  { key: 'CUIL', re: /(^|[^a-z])cuil([^a-z]|$)/ },
  { key: 'DNI', re: /(^|[^a-z])dni([^a-z]|$)/ },
  { key: 'Matricula', re: /matricula/ },
  { key: 'Etico', re: /(^|[^a-z])etic[oa]([^a-z]|$)/ },
  { key: 'Titulo', re: /titulo|analitico|(^|[^a-z])secundario|(^|[^a-z])primario/ },
];
// Veto por TEXTO: si el documento ES otra cosa (su título lo delata), no se toca
// aunque mencione "dni"/"cuil" como rótulo de campo (toma de posesión, domicilio, etc.).
const VETO_TEXTO = /toma de posesion|situaciones de violencia|registro de situaciones|comunico a usted que mi domicilio|declaro que mi domicilio|nota de solicitud|nombramiento|incompatibilidad|declaracion jurada|apto (fisico|psico)|acta de matrimonio|certificado de antecedentes|libre de deuda|constancia de aceptacion|nota de toma/;

// Reglas por TEXTO (OCR / capa): SOLO frases ancla fuertes (título del documento),
// no rótulos de campo. Un formulario que dice "N° Cuil:" NO alcanza.
const REGLAS_TEXTO = [
  { key: 'CUIL', re: /constancia de c\.?\s?u\.?\s?i\.?\s?l|codigo unico de identificacion laboral|constancia de cuil/ },
  { key: 'DNI', re: /documento nacional de identidad|ministerio del interior.*identidad|registro nacional de las personas/ },
  { key: 'Matricula', re: /matricula (profesional|n[ro°º]|nacional)|colegio de (medicos|enfermer|profesionales|bioquimic|kinesi)|habilitacion profesional/ },
  { key: 'Etico', re: /codigo de etica|certificado de (etica|ejercicio etico)|ejercicio etico de la profesion/ },
  { key: 'Titulo', re: /(titulo|diploma) (de|profesional|secundario|intermedio)|analitico de calificaciones|bachiller|direccion general de cultura y educacion|ministerio de educacion|tecnico (en|superior)|nivel secundario/ },
];

// Clasificación por NOMBRE (veta familiares).
const clasifNombre = (nombre) => {
  const t = norm(path.basename(nombre, path.extname(nombre)));
  if (VETO.test(t)) return { key: null, veto: 'familiar' };
  for (const r of REGLAS_NOMBRE) if (r.re.test(t) && !(r.not && r.not.test(t))) return { key: r.key, veto: null };
  return { key: null, veto: null };
};
// Clasificación por TEXTO (veta familiares y otros tipos de documento).
const clasifTexto = (txt) => {
  const t = norm(txt);
  if (VETO.test(t)) return { key: null, veto: 'familiar' };
  if (VETO_TEXTO.test(t)) return { key: null, veto: 'otro documento' };
  for (const r of REGLAS_TEXTO) if (r.re.test(t)) return { key: r.key, veto: null };
  return { key: null, veto: null };
};

// Subcarpeta destino del agente para una clave (matchea la carpeta ya creada).
function carpetaDestino(subdirs, key) {
  const objetivo = { DNI: /^dni$/, CUIL: /^cuil$/, Titulo: /^titulo$/, Matricula: /^matricula/, Etico: /^etic[oa]/ }[key];
  return subdirs.find((d) => objetivo.test(norm(d))) || null;
}

const IGNORAR = /\.db$/i;
const ES_IMG = /\.(jpe?g|png|tiff?|bmp|webp)$/i;
const ES_PDF = /\.pdf$/i;

// ---- OCR / lectura ----
let pdfjs = null, ocrWorker = null, ocrCount = 0;
const OCR_RECYCLE = 40; // tesseract.js crashea tras muchas lecturas ("Too many properties")
async function getPdfjs() {
  if (!pdfjs) pdfjs = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  return pdfjs;
}
async function getOcr() {
  if (ocrWorker && ocrCount >= OCR_RECYCLE) {
    try { await ocrWorker.terminate(); } catch {}
    ocrWorker = null; ocrCount = 0;
  }
  if (!ocrWorker) {
    const { createWorker, OEM } = require('tesseract.js');
    // errorHandler evita el throw sincrónico no atrapable de tesseract.js.
    ocrWorker = await createWorker('spa', OEM.LSTM_ONLY, { errorHandler: () => {} });
  }
  return ocrWorker;
}
async function resetOcr() { try { if (ocrWorker) await ocrWorker.terminate(); } catch {} ocrWorker = null; ocrCount = 0; }
function safeCanvasFactory() {
  const { createCanvas } = require('@napi-rs/canvas');
  return {
    create(w, h) { const c = createCanvas(Math.ceil(w) || 1, Math.ceil(h) || 1); return { canvas: c, context: c.getContext('2d') }; },
    reset(cc, w, h) { cc.canvas.width = Math.ceil(w) || 1; cc.canvas.height = Math.ceil(h) || 1; },
    destroy(cc) { cc.canvas = null; cc.context = null; },
  };
}
async function pdfTextLayer(fp) {
  const lib = await getPdfjs();
  const data = new Uint8Array(fs.readFileSync(fp));
  const pdf = await lib.getDocument({ data, disableWorker: true }).promise;
  try {
    let txt = '';
    for (let p = 1; p <= Math.min(pdf.numPages, 3); p += 1) {
      const page = await pdf.getPage(p);
      const c = await page.getTextContent();
      txt += ' ' + (c.items || []).map((i) => i.str || '').join(' ');
      page.cleanup();
    }
    return txt.replace(/\s+/g, ' ').trim();
  } finally { try { await pdf.destroy(); } catch {} }
}
async function pdfRenderOcr(fp) {
  const lib = await getPdfjs();
  const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');
  globalThis.DOMMatrix = globalThis.DOMMatrix ?? DOMMatrix;
  globalThis.Path2D = globalThis.Path2D ?? Path2D;
  globalThis.ImageData = globalThis.ImageData ?? ImageData;
  const data = new Uint8Array(fs.readFileSync(fp));
  const pdf = await lib.getDocument({ data, disableWorker: true, canvasFactory: safeCanvasFactory() }).promise;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ordenar-ocr-'));
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    const out = path.join(tmp, 'p1.jpg');
    fs.writeFileSync(out, await canvas.encode('jpeg', 88));
    const w = await getOcr();
    const { data: res } = await w.recognize(out, {}, { text: true, blocks: false, hocr: false, tsv: false });
    ocrCount += 1;
    return res.text || '';
  } finally {
    try { await pdf.destroy(); } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}
async function leerTexto(fp) {
  try {
    if (ES_IMG.test(fp)) { const w = await getOcr(); const { data } = await w.recognize(fp, {}, { text: true, blocks: false, hocr: false, tsv: false }); ocrCount += 1; return data.text || ''; }
    if (ES_PDF.test(fp)) {
      const t = await pdfTextLayer(fp);
      if (t && t.length > 25) return t;         // capa de texto suficiente
      return await pdfRenderOcr(fp);            // escaneado → render + OCR
    }
  } catch (e) { await resetOcr(); return `__ERR__ ${e?.message || e}`; }
  return '';
}

function destinoUnico(dir, nombre) {
  let dest = path.join(dir, nombre);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(nombre), base = path.basename(nombre, ext);
  for (let i = 1; i < 1000; i += 1) { const c = path.join(dir, `${base} (${i})${ext}`); if (!fs.existsSync(c)) return c; }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

async function procesarAgente(dni) {
  const dir = path.join(DOCU, String(dni));
  if (!fs.existsSync(dir)) { console.log(`\n### ${dni}: SIN CARPETA`); return { movidos: 0, ocr: 0 }; }
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  const subdirs = ents.filter((e) => e.isDirectory()).map((e) => e.name);
  const files = ents.filter((e) => e.isFile()).map((e) => e.name).filter((n) => !IGNORAR.test(n));
  console.log(`\n### ${dni}  (${files.length} archivos)`);
  let movidos = 0, ocrUsados = 0;
  for (const f of files) {
    const fp = path.join(dir, f);
    let { key, veto } = clasifNombre(f);
    let via = 'nombre';
    if (!key && !veto && (ES_IMG.test(f) || ES_PDF.test(f))) {
      const txt = await leerTexto(fp);
      ocrUsados += 1;
      const r = clasifTexto(txt);
      key = r.key; veto = r.veto; via = txt.startsWith('__ERR__') ? 'ocr-error' : 'ocr';
    }
    if (veto) { console.log(`   · descartado (${veto})   ${f}`); continue; }
    if (!key) { continue; }
    const carpeta = carpetaDestino(subdirs, key);
    if (!carpeta) { console.log(`   · [${key}] sin subcarpeta destino  ${f}`); continue; }
    const dest = destinoUnico(path.join(dir, carpeta), f);
    console.log(`   → [${key}/${via}] ${f}  ⇒  ${carpeta}/${path.basename(dest)}`);
    if (APPLY) fs.renameSync(fp, dest);
    movidos += 1;
  }
  return { movidos, ocr: ocrUsados };
}

// ---- main ----
const c = await mysql.createConnection({ host: g('DB_HOST'), port: +g('DB_PORT'), user: g('DB_USER'), password: g('DB_PASS') || g('DB_PASSWORD'), database: g('DB_NAME') });
let dnis = [];
if (args.dni) dnis = [Number(args.dni)];
else if (args.tanda) {
  const [rows] = await c.query('SELECT dni FROM tramites_tanda_interinos WHERE tanda=? ORDER BY dni', [String(args.tanda)]);
  dnis = rows.map((r) => r.dni);
} else { console.error('Falta --dni= o --tanda='); process.exit(1); }

console.log(`Modo: ${APPLY ? 'APLICAR (mueve)' : 'DRY-RUN (no mueve)'} · ${dnis.length} agente(s)`);
let tm = 0, to = 0;
for (const dni of dnis) { const r = await procesarAgente(dni); tm += r.movidos; to += r.ocr; }
console.log(`\nTOTAL: ${tm} archivo(s) ${APPLY ? 'movidos' : 'a mover'} · ${to} OCR usados.`);
if (ocrWorker) await ocrWorker.terminate();
await c.end();
