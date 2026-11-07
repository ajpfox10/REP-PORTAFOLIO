// OCR de las primeras páginas de un PDF escaneado (o de una imagen) -> texto por stdout.
// Mismo motor que el clasificador de DOCU (tesseract.js + pdfjs + @napi-rs/canvas, spa.traineddata
// en apipersonal/). Lo usa gmail_antecedentes_robot.py cuando el PDF no trae capa de texto.
//   node scripts/ocr_pdf.mjs <archivo> [paginas=2]      (correr con cwd = apipersonal)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const [file, pags = '2'] = process.argv.slice(2);
if (!file) { console.error('uso: node scripts/ocr_pdf.mjs <archivo> [paginas]'); process.exit(2); }
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ocrpdf_'));

const { createCanvas, loadImage, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');
globalThis.DOMMatrix ??= DOMMatrix; globalThis.Path2D ??= Path2D; globalThis.ImageData ??= ImageData;
const { createWorker, OEM } = await import('tesseract.js');
const worker = await createWorker('spa', OEM.LSTM_ONLY, { langPath: RAIZ, cachePath: RAIZ, errorHandler: () => {} });

async function leer(jpg) {
  const { data } = await worker.recognize(jpg, {}, { text: true, blocks: false, hocr: false, tsv: false });
  return data.text || '';
}

let texto = '';
try {
  if (/\.pdf$/i.test(file)) {
    const pdfjs = await import(pathToFileURL(path.join(RAIZ, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
    const canvasFactory = {
      create(w, h) { const c = createCanvas(Math.ceil(w) || 1, Math.ceil(h) || 1); return { canvas: c, context: c.getContext('2d') }; },
      reset(cc, w, h) { cc.canvas.width = Math.ceil(w) || 1; cc.canvas.height = Math.ceil(h) || 1; },
      destroy(cc) { cc.canvas = null; cc.context = null; },
    };
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true, canvasFactory }).promise;
    for (let p = 1; p <= Math.min(pdf.numPages, Number(pags) || 2); p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, Math.max(1, 1700 / Math.max(1, base.width))) });
      const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const jpg = path.join(TMPDIR, `p${p}.jpg`);
      fs.writeFileSync(jpg, await c.encode('jpeg', 90));
      texto += '\n' + await leer(jpg);
    }
    await pdf.destroy();
  } else {
    const img = await loadImage(fs.readFileSync(file));
    const esc = Math.min(1, 2000 / Math.max(1, img.width));
    const c = createCanvas(Math.round(img.width * esc), Math.round(img.height * esc));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const jpg = path.join(TMPDIR, 'img.jpg');
    fs.writeFileSync(jpg, await c.encode('jpeg', 90));
    texto = await leer(jpg);
  }
} finally {
  await worker.terminate();
  fs.rmSync(TMPDIR, { recursive: true, force: true });
}
process.stdout.write(texto);
