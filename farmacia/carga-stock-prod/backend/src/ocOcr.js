const path = require('path');

// OCR de O.C. escaneadas (PDF que son solo imagen, sin capa de texto).
// Se renderiza cada pagina con pdfjs + @napi-rs/canvas y se lee con tesseract.js (spa, local).
// Si la pagina no se entiende se prueba girada 180° (escaneos puestos boca abajo).

const TESSDATA = path.join(__dirname, 'tessdata');
const ANCHO_PX = 2200;
const MAX_PAGINAS = 6;

let nc = null;
function canvasLib() {
  if (!nc) {
    nc = require('@napi-rs/canvas');
    globalThis.DOMMatrix = globalThis.DOMMatrix || nc.DOMMatrix;
    globalThis.Path2D = globalThis.Path2D || nc.Path2D;
    globalThis.ImageData = globalThis.ImageData || nc.ImageData;
  }
  return nc;
}

// pdfjs libera sus canvas con width = 0, que con @napi-rs/canvas tira error: este factory no lo hace
const canvasFactory = {
  create(w, h) {
    const canvas = canvasLib().createCanvas(Math.ceil(w) || 1, Math.ceil(h) || 1);
    return { canvas, context: canvas.getContext('2d') };
  },
  reset(cc, w, h) { cc.canvas.width = Math.ceil(w) || 1; cc.canvas.height = Math.ceil(h) || 1; },
  destroy(cc) { cc.canvas = null; cc.context = null; }
};

// Un solo worker a la vez (tesseract es pesado); se recicla cada tanto para no acumular memoria
let worker = null;
let lecturas = 0;
let cola = Promise.resolve();

async function getWorker() {
  if (worker && lecturas >= 30) {
    try { await worker.terminate(); } catch { /* noop */ }
    worker = null;
  }
  if (!worker) {
    const { createWorker } = require('tesseract.js');
    worker = await createWorker('spa', 1, { langPath: TESSDATA, cachePath: TESSDATA, gzip: false, cacheMethod: 'none' });
    lecturas = 0;
  }
  return worker;
}

async function leerImagen(png) {
  const w = await getWorker();
  try {
    const { data } = await w.recognize(png, {}, { text: true, blocks: false, hocr: false, tsv: false });
    lecturas += 1;
    return { texto: data.text || '', confianza: data.confidence || 0 };
  } catch (err) {
    try { await w.terminate(); } catch { /* noop */ }
    worker = null;
    throw err;
  }
}

async function renderPagina(doc, n, girar) {
  const { createCanvas } = canvasLib();
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(4, ANCHO_PX / Math.max(1, base.width)) });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (girar) {
    ctx.translate(c.width, c.height);
    ctx.rotate(Math.PI);
  }
  await page.render({ canvasContext: ctx, viewport: vp, canvasFactory }).promise;
  page.cleanup();
  return c.encode('png');
}

// Una pagina "se entiende" si aparecen palabras tipicas de la O.C.
function puntaje(texto) {
  return ['O.C', 'Hoja', 'Raz', 'FECHA', 'Destino', 'Licitaci', 'Renglon', 'Cantidad', 'SubTotal']
    .filter((p) => texto.toLowerCase().includes(p.toLowerCase())).length;
}

async function leerPaginas(buffer) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  canvasLib();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), canvasFactory, disableFontFace: true }).promise;
  const paginas = [];
  let girada = null; // se decide con la primera pagina y se usa para el resto
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGINAS); n += 1) {
      let lectura;
      if (girada === null) {
        const derecha = await leerImagen(await renderPagina(doc, n, false));
        if (puntaje(derecha.texto) >= 3 && derecha.confianza >= 50) {
          lectura = derecha;
          girada = false;
        } else {
          const vuelta = await leerImagen(await renderPagina(doc, n, true));
          girada = puntaje(vuelta.texto) > puntaje(derecha.texto) || vuelta.confianza > derecha.confianza;
          lectura = girada ? vuelta : derecha;
        }
      } else {
        lectura = await leerImagen(await renderPagina(doc, n, girada));
      }
      paginas.push(lectura);
    }
    return { paginas, numPages: doc.numPages, girada: !!girada };
  } finally {
    try { await doc.destroy(); } catch { /* noop */ }
  }
}

// Serializa los OCR: si llegan varios escaneos a la vez se leen de a uno
function ocrPdf(buffer) {
  const tarea = cola.then(() => leerPaginas(buffer));
  cola = tarea.catch(() => {});
  return tarea;
}

module.exports = { ocrPdf };
