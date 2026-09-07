import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const BASE = 'D:/G/DOCU';
const CACHE = 'tmp_textos.json';
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'clasif_'));
const IGNORAR = /\.(db|lnk|tmp|ini)$/i;

const dnis = JSON.parse(fs.readFileSync('tmp_dnis.json', 'utf8'));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

// ── pdfjs + canvas (mismo patrón que ansesPdf.service.ts) ────────────────────
const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');
globalThis.DOMMatrix ??= DOMMatrix; globalThis.Path2D ??= Path2D; globalThis.ImageData ??= ImageData;
const pdfjs = await import(pathToFileURL(path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);

function canvasFactory() {
  return {
    create(w, h) { const c = createCanvas(Math.ceil(w) || 1, Math.ceil(h) || 1); return { canvas: c, context: c.getContext('2d') }; },
    reset(cc, w, h) { cc.canvas.width = Math.ceil(w) || 1; cc.canvas.height = Math.ceil(h) || 1; },
    destroy(cc) { cc.canvas = null; cc.context = null; },
  };
}

// ── worker OCR reciclado cada 40 lecturas (tesseract.js pierde memoria) ──────
const { createWorker, OEM } = await import('tesseract.js');
let worker = null, lecturas = 0;
async function ocr(file) {
  if (lecturas >= 40 && worker) { try { await worker.terminate(); } catch {} worker = null; lecturas = 0; }
  worker ??= await createWorker('spa', OEM.LSTM_ONLY, { errorHandler: () => {} });
  const { data } = await worker.recognize(file, {}, { text: true, blocks: false, hocr: false, tsv: false });
  lecturas++;
  return data.text || '';
}

async function textoDePdf(file) {
  try {
    const t = execFileSync('pdftotext', ['-f', '1', '-l', '2', '-q', file, '-'], { encoding: 'utf8', timeout: 20000 });
    if (t.replace(/\s+/g, ' ').trim().length > 60) return { texto: t, origen: 'texto' };
  } catch {}
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true, canvasFactory: canvasFactory() }).promise;
  let acc = '';
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, 2); p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(4, Math.max(1, 2000 / Math.max(1, base.width))) });
      const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      const jpg = path.join(TMPDIR, 'p.jpg');
      fs.writeFileSync(jpg, await c.encode('jpeg', 92));
      acc += '\n' + await ocr(jpg);
      if (acc.replace(/\s+/g, ' ').trim().length > 400) break;   // con la 1a pagina alcanza
    }
  } finally { try { await pdf.destroy(); } catch {} }
  return { texto: acc, origen: 'ocr' };
}

const pendientes = [];
for (const d of dnis) {
  const dir = path.join(BASE, d);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() || IGNORAR.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (!cache[full]) pendientes.push({ dni: d, full, name: e.name });
  }
}
console.log(`a procesar: ${pendientes.length}`);

let i = 0;
for (const f of pendientes) {
  i++;
  try {
    const r = /\.pdf$/i.test(f.name)
      ? await textoDePdf(f.full)
      : { texto: await ocr(f.full), origen: 'ocr-img' };
    cache[f.full] = { dni: f.dni, name: f.name, origen: r.origen, texto: (r.texto || '').slice(0, 6000) };
  } catch (err) {
    cache[f.full] = { dni: f.dni, name: f.name, origen: 'error', texto: '', error: String(err).slice(0, 200) };
  }
  fs.appendFileSync("tmp_progreso.log", `${i}/${pendientes.length} ${f.name} [${cache[f.full].origen}]
`);
  if (i % 25 === 0) fs.writeFileSync(CACHE, JSON.stringify(cache));
}
fs.writeFileSync(CACHE, JSON.stringify(cache));
try { await worker?.terminate(); } catch {}
console.log('LISTO', Object.keys(cache).length);
