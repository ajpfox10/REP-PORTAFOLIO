import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT || 0);
const [SHARD, NSHARDS] = (process.argv[2] || '0/1').split('/').map(Number);
const BASE = 'D:/G/DOCU';
const IGNORAR = /\.(db|lnk|tmp|ini)$/i;
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), `cls${SHARD}_`));
const LOG = `tmp_mov_${SHARD}.jsonl`;
const CACHE = `tmp_textos_${SHARD}.json`;

const dnis = JSON.parse(fs.readFileSync('tmp_dnis.json', 'utf8'));
const yaHecho = {};
for (const src of ['tmp_textos.json', 'tmp_textos_0.json', 'tmp_textos_1.json', 'tmp_textos_2.json']) {
  if (!fs.existsSync(src)) continue;
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(src, 'utf8')))) {
    // Solo el OCR con texto util: lo extraido con pdftotext se relee por el encoding.
    if (/^ocr/.test(v.origen) && (v.texto || '').trim().length >= 40) yaHecho[k] = v;
  }
}
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

// -- extraccion --------------------------------------------------------------
const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');
globalThis.DOMMatrix ??= DOMMatrix; globalThis.Path2D ??= Path2D; globalThis.ImageData ??= ImageData;
const pdfjs = await import(pathToFileURL(path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
const canvasFactory = () => ({
  create(w, h) { const c = createCanvas(Math.ceil(w) || 1, Math.ceil(h) || 1); return { canvas: c, context: c.getContext('2d') }; },
  reset(cc, w, h) { cc.canvas.width = Math.ceil(w) || 1; cc.canvas.height = Math.ceil(h) || 1; },
  destroy(cc) { cc.canvas = null; cc.context = null; },
});

const { createWorker, OEM } = await import('tesseract.js');
let worker = null, lecturas = 0;
async function aJpgSiHaceFalta(file) {
  if (!/\.(bmp|tif|tiff)$/i.test(file)) return file;
  const { loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(fs.readFileSync(file));
  const esc = Math.min(1, 2000 / Math.max(1, img.width));
  const c = createCanvas(Math.round(img.width * esc), Math.round(img.height * esc));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const out = path.join(TMPDIR, 'conv.jpg');
  fs.writeFileSync(out, await c.encode('jpeg', 90));
  return out;
}

async function ocr(fileOriginal) {
  const file = await aJpgSiHaceFalta(fileOriginal);
  if (lecturas >= 40 && worker) { try { await worker.terminate(); } catch {} worker = null; lecturas = 0; }
  worker ??= await createWorker('spa', OEM.LSTM_ONLY, { errorHandler: () => {} });
  const { data } = await worker.recognize(file, {}, { text: true, blocks: false, hocr: false, tsv: false });
  lecturas++;
  return data.text || '';
}

async function extraer(file) {
  if (!/\.pdf$/i.test(file)) return { texto: await ocr(file), origen: 'ocr-img' };
  try {
    const t = execFileSync('pdftotext', ['-enc', 'UTF-8', '-f', '1', '-l', '2', '-q', file, '-'], { encoding: 'utf8', timeout: 20000 });
    // Los PDF de GDEBA traen una capa de texto que solo repite "IF-... PAGINA 1 DE 3":
    // pasa cualquier umbral de largo pero no dice nada del contenido, que va escaneado.
    const util = t.replace(/IF-\d{4}-\d+-GDEBA-\w+/gi, ' ').replace(/P[AÁ]GINA \d+ DE \d+/gi, ' ').replace(/\s+/g, ' ').trim();
    if (util.length > 60) return { texto: t, origen: 'texto' };
  } catch {}
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true, canvasFactory: canvasFactory() }).promise;
  let acc = '';
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, 2); p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, Math.max(1, 1700 / Math.max(1, base.width))) });
      const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      const jpg = path.join(TMPDIR, 'p.jpg');
      fs.writeFileSync(jpg, await c.encode('jpeg', 90));
      acc += '\n' + await ocr(jpg);
      if (acc.replace(/\s+/g, ' ').trim().length > 300) break;
    }
  } finally { try { await pdf.destroy(); } catch {} }
  return { texto: acc, origen: 'ocr' };
}

// -- clasificacion -----------------------------------------------------------
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
const REGLAS = [
  ['CUIL',                           n => /CONSTANCIA DE CUIL|CODIGO UNICO DE IDENTIFICACION LABORAL/.test(n)],
  ['Certificado ant. Nacionales',    n => /REGISTRO NACIONAL DE REINCIDENCIA|REINCIDENCIA Y ESTADISTICA CRIMINAL/.test(n)],
  ['Certificado ant. Provinciales',  n => /REGISTRO DE ANTECEDENTES/.test(n) && /POLICIA DE LA PROVINCIA|MINISTERIO DE SEGURIDAD/.test(n)],
  ['Certificado Apto Psicofisico',   n => /APTITUD PSICOFISICA|APTO PSICOFISICO|MEDICINA OCUPACIONAL/.test(n)],
  ['Libre de deuda (RDAM)',          n => /DEUDORES ALIMENTARIOS|LIBRE DE DEUDA ALIMENTARIA|\bRDAM\b/.test(n)],
  ['Certificado de aportantes (IPS)', n => /INSTITUTO DE PREVISION SOCIAL/.test(n) && /APORTANT|APORTES|CERTIFICACION DE SERVICIOS/.test(n)],
  ['Etico (si lo tuviere)',          n => /ETICA PUBLICA|DECLARACION JURADA PATRIMONIAL|PATRIMONIAL INTEGRAL|\bTPAT\b/.test(n)],
  ['Planilla de incompatibilidad',   (n, c) => /INCOMPATIBILIDAD|\bINCOMP|COMPATIBILIDAD HORARIA|LEY N.{0,3}13.?644/.test(c)],
  ['DDJJ Cond. De Salud',            (n, c) => /CONDICION(ES)? DE SALUD|DECLARACION JURADA DE SALUD|ESTADO DE SALUD/.test(c)],
  ['Constancia de Aceptacion SIAPE', n => /ACEPTACION/.test(n) && /SIAPE|DEL CARGO/.test(n)],
  ['Caratula SIAPE',                 (n, c) => /CARATULA/.test(c)],
  ['Curriculum',                     (n, c) => /CURRICULUM/.test(c)],
  ['Titulo',                         (n, c) => /OTORGA EL TITULO|EXPIDE EL PRESENTE TITULO|TITULO DE |TITULO EN TRAMITE|BACHILLER|TECNICO SUPERIOR EN|DIRECCION GENERAL DE CULTURA Y EDUCACION/.test(c)],
  ['Matricula (si la tuviere)',      n => /REGISTRO UNICO DE PROFESIONES DE LA SALUD|FISCALIZACION SANITARIA|MATRICULA (PROFESIONAL|N|NRO)|COLEGIO DE (MEDICOS|PSICOLOGOS|ENFERMER|FARMAC|KINESI|NUTRICI|TRABAJADORES)/.test(n)],
  ['Planilla de datos personales',   n => /PLANILLA DE DATOS PERSONALES|DATOS PERSONALES DEL AGENTE/.test(n)],
  ['DNI',                            n => /DOCUMENTO NACIONAL DE IDENTIDAD|REGISTRO NACIONAL DE LAS PERSONAS/.test(n)],
  ['Declaracion jurada',             n => /DECLARACION JURADA|\bDDJJ\b|\bDJD\b/.test(n)],
];
const clasificar = (texto, nombre) => {
  const n = norm(texto), cab = n.slice(0, 800), f = norm(nombre);
  for (const [dest, test] of REGLAS) if (test(n, cab) || test(f, f)) return dest;
  return null;
};
const setDnis = new Set(dnis.map(String));
const dnisEn = n => [...n.matchAll(/\b([12]?\d{7})\b/g)].map(m => m[1]);

// -- carpeta destino real (respeta el nombre exacto que ya existe en disco) ---
function destinoReal(dirAgente, canonico) {
  const objetivo = norm(canonico);
  for (const e of fs.readdirSync(dirAgente, { withFileTypes: true }))
    if (e.isDirectory() && norm(e.name) === objetivo) return path.join(dirAgente, e.name);
  const nuevo = path.join(dirAgente, canonico);
  fs.mkdirSync(nuevo, { recursive: true });
  return nuevo;
}

// -- recorrido ---------------------------------------------------------------
const hash = s => { let h = 0; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0; return h; };
const trabajo = [];
for (const d of dnis) {
  const dir = path.join(BASE, d);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() || IGNORAR.test(e.name)) continue;
    if (hash(path.join(dir, e.name)) % NSHARDS !== SHARD) continue;
    trabajo.push({ dni: d, dir, name: e.name, full: path.join(dir, e.name) });
  }
}
console.log(`shard ${SHARD}/${NSHARDS}: ${trabajo.length} archivos`);

let movidos = 0, quietos = 0, sospechosos = 0, errores = 0, i = 0;
for (const f of trabajo) {
  if (LIMIT && i >= LIMIT) break;
  i++;
  let r;
  try {
    r = yaHecho[f.full] ? { texto: yaHecho[f.full].texto, origen: yaHecho[f.full].origen } : await extraer(f.full);
  } catch (err) {
    errores++;
    fs.appendFileSync(LOG, JSON.stringify({ estado: 'error', de: f.full, error: String(err).slice(0, 150) }) + '\n');
    continue;
  }
  cache[f.full] = { dni: f.dni, name: f.name, origen: r.origen, texto: (r.texto || '').slice(0, 4000) };

  const n = norm(r.texto);
  const encontrados = dnisEn(n);
  const ajeno = !encontrados.includes(f.dni) && encontrados.some(x => x !== f.dni && setDnis.has(x));
  const destino = clasificar(r.texto, f.name);

  let estado;
  if (!destino) { estado = 'sin-clasificar'; quietos++; }
  else if (ajeno) { estado = 'dni-ajeno'; sospechosos++; }
  else {
    const dirDest = destinoReal(f.dir, destino);
    let target = path.join(dirDest, f.name);
    if (fs.existsSync(target)) {
      const ext = path.extname(f.name), stem = path.basename(f.name, ext);
      let k = 2;
      while (fs.existsSync(target)) target = path.join(dirDest, `${stem} (${k++})${ext}`);
    }
    if (!DRY) {
      // El archivo pudo desaparecer entre el listado y el rename: se registra, no se crashea.
      try { fs.renameSync(f.full, target); }
      catch (err) {
        errores++;
        fs.appendFileSync(LOG, JSON.stringify({ estado: 'error-mover', de: f.full, error: String(err).slice(0, 150) }) + '\n');
        continue;
      }
    }
    movidos++; estado = 'movido';
    fs.appendFileSync(LOG, JSON.stringify({ estado, de: f.full, a: target, destino }) + '\n');
  }
  if (estado !== 'movido') fs.appendFileSync(LOG, JSON.stringify({ estado, de: f.full, destino, dnis: encontrados.slice(0, 3) }) + '\n');
  if (i % 20 === 0) fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.appendFileSync(`tmp_prog_${SHARD}.log`, `${i}/${trabajo.length} ${estado} ${destino || '-'} << ${f.name}\n`);
}
fs.writeFileSync(CACHE, JSON.stringify(cache));
try { await worker?.terminate(); } catch {}
console.log(`FIN shard ${SHARD} · movidos ${movidos} · sin clasificar ${quietos} · dni ajeno ${sospechosos} · errores ${errores}`);
