// src/services/oscurecerImagen.ts
// "🌑 Oscurecer" (19/11/2026): letras claras/grises de una hoja escaneada → más oscuras, fondo blanco.
// Se usa desde Trámites → 🗂️ Documentos (botón por hoja) y al guardar un escaneo con "Oscuridad".
//
// Curva de niveles por canal (RGB, conserva el color):
//   t = clamp((v - negro) / (blanco - negro)) ; v' = 255 * t^gamma
// Todo lo que está por encima de `blanco` queda blanco puro (el papel no se ensucia) y el gamma > 1
// oscurece los grises medios (la tinta clara).
//
// PDF: si la página es una imagen JPEG (lo normal en un escaneo) se oscurece ESA imagen adentro del PDF
// sin perder resolución; si no (texto vectorial, Flate, etc.) se dibuja la página a 300 dpi, se oscurece
// y se reemplaza la página por la imagen.
import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFNumber, PDFArray } from 'pdf-lib';

export type NivelOscuridad = 1 | 2 | 3;

const NIVELES: Record<NivelOscuridad, { negro: number; blanco: number; gamma: number }> = {
  // Calibrado con la DDJJ de Salud de 19030229 (19/11/2026): la tinta clara cae en 150–220 y el
  // papel en ~250. Ej. un gris 190 queda en 166 / 130 / 87; el papel (>= 240) sigue blanco.
  1: { negro: 0, blanco: 240, gamma: 1.8 },  // Oscuro
  2: { negro: 20, blanco: 240, gamma: 2.6 }, // Más oscuro (lo que hace el botón)
  3: { negro: 40, blanco: 242, gamma: 3.6 }, // Muy oscuro
};

export function parseNivel(raw: unknown, porDefecto: NivelOscuridad = 2): NivelOscuridad {
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? n : porDefecto;
}

function lut(nivel: NivelOscuridad): Uint8ClampedArray {
  const { negro, blanco, gamma } = NIVELES[nivel];
  const out = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    const t = Math.min(1, Math.max(0, (v - negro) / (blanco - negro)));
    out[v] = Math.round(255 * Math.pow(t, gamma));
  }
  return out;
}

function canvasLib(): any {
  return require('@napi-rs/canvas');
}

/** Oscurece en el lugar los píxeles de un contexto 2D. */
export function oscurecerContexto(ctx: any, w: number, h: number, nivel: NivelOscuridad): void {
  const tabla = lut(nivel);
  // por franjas: una hoja de 600 dpi son ~35 M píxeles; así no se pide un ImageData gigante de una vez
  const franja = 512;
  for (let y = 0; y < h; y += franja) {
    const alto = Math.min(franja, h - y);
    const img = ctx.getImageData(0, y, w, alto);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = tabla[d[i]];
      d[i + 1] = tabla[d[i + 1]];
      d[i + 2] = tabla[d[i + 2]];
    }
    ctx.putImageData(img, 0, y);
  }
}

/** JPG/PNG → mismo formato, oscurecido. */
export async function oscurecerImagenBuffer(buf: Buffer, nivel: NivelOscuridad, formato: 'jpeg' | 'png'): Promise<Buffer> {
  const { createCanvas, loadImage } = canvasLib();
  const img = await loadImage(buf);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  oscurecerContexto(ctx, img.width, img.height, nivel);
  return formato === 'png' ? canvas.encodeSync('png') : canvas.encodeSync('jpeg', 92);
}

function filtroDe(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map((x) => String(x));
  return [String(f)];
}

/**
 * Oscurece las imágenes JPEG de las páginas pedidas (índices base 0; null = todas) dentro del PDF.
 * Devuelve las páginas que NO tenían una imagen JPEG para oscurecer (hay que dibujarlas).
 */
async function oscurecerJpegsDePaginas(doc: PDFDocument, paginas: number[], nivel: NivelOscuridad): Promise<number[]> {
  const sinJpeg: number[] = [];
  const hechos = new Set<string>();
  for (const idx of paginas) {
    const page = doc.getPage(idx);
    let tocadas = 0;
    const xobjs = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (xobjs) {
      for (const [, ref] of xobjs.entries()) {
        const obj = doc.context.lookup(ref);
        if (!(obj instanceof PDFRawStream)) continue;
        if (String(obj.dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
        const filtros = filtroDe(obj.dict);
        if (filtros.length !== 1 || filtros[0] !== '/DCTDecode') continue;
        const key = String(ref);
        if (hechos.has(key)) { tocadas += 1; continue; }
        const nuevo = await oscurecerImagenBuffer(Buffer.from(obj.contents), nivel, 'jpeg');
        const dict = obj.dict.clone(doc.context);
        dict.set(PDFName.of('Length'), PDFNumber.of(nuevo.length));
        dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB')); // canvas re-codifica siempre en RGB
        dict.delete(PDFName.of('Decode'));
        doc.context.assign(ref as any, PDFRawStream.of(dict, new Uint8Array(nuevo)));
        hechos.add(key);
        tocadas += 1;
      }
    }
    if (!tocadas) sinJpeg.push(idx);
  }
  return sinJpeg;
}

/** Dibuja las páginas a 300 dpi con pdfjs, las oscurece y las reemplaza por esa imagen. */
async function oscurecerPaginasDibujando(
  doc: PDFDocument, bytesOriginal: Uint8Array, paginas: number[], nivel: NivelOscuridad,
): Promise<void> {
  if (!paginas.length) return;
  const { createCanvas, DOMMatrix, Path2D, ImageData } = canvasLib();
  (globalThis as any).DOMMatrix = (globalThis as any).DOMMatrix ?? DOMMatrix;
  (globalThis as any).Path2D = (globalThis as any).Path2D ?? Path2D;
  (globalThis as any).ImageData = (globalThis as any).ImageData ?? ImageData;
  const pdfjsFile = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  // eslint-disable-next-line no-new-func
  const pdfjs: any = await (new Function('u', 'return import(u)'))(require('url').pathToFileURL(pdfjsFile).href);
  const canvasFactory = {
    create(w: number, h: number) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; },
    reset(cc: any, w: number, h: number) { cc.canvas.width = w; cc.canvas.height = h; },
    destroy(cc: any) { cc.canvas = null; cc.context = null; },
  };
  const pdf = await pdfjs.getDocument({ data: bytesOriginal.slice(), disableWorker: true, canvasFactory }).promise;
  try {
    for (const idx of paginas) {
      const pg = await pdf.getPage(idx + 1);
      const scale = 300 / 72;
      const vp = pg.getViewport({ scale });
      const w = Math.ceil(vp.width); const h = Math.ceil(vp.height);
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      pg.cleanup();
      oscurecerContexto(ctx, w, h, nivel);
      const jpg = await doc.embedJpg(canvas.encodeSync('jpeg', 92));
      const wPt = vp.width / scale; const hPt = vp.height / scale;
      const nueva = doc.insertPage(idx, [wPt, hPt]);
      nueva.drawImage(jpg, { x: 0, y: 0, width: wPt, height: hPt });
      doc.removePage(idx + 1);
    }
  } finally {
    try { await pdf.destroy(); } catch { /* noop */ }
  }
}

/** PDF → PDF con las páginas pedidas oscurecidas (null = todas). */
export async function oscurecerPdfBuffer(buf: Buffer | Uint8Array, nivel: NivelOscuridad, paginas: number[] | null = null): Promise<Buffer> {
  const bytes = new Uint8Array(buf);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (doc.isEncrypted) throw Object.assign(new Error('El PDF está protegido; no se puede modificar'), { status: 400 });
  const idxs = (paginas ?? doc.getPageIndices()).filter((i) => i >= 0 && i < doc.getPageCount());
  const faltan = await oscurecerJpegsDePaginas(doc, idxs, nivel);
  await oscurecerPaginasDibujando(doc, bytes, faltan, nivel);
  return Buffer.from(await doc.save());
}

/** Oscurece un archivo según su extensión. Devuelve null si el formato no se soporta (TIFF, etc.). */
export async function oscurecerArchivoBuffer(
  nombre: string, buf: Buffer, nivel: NivelOscuridad, paginas: number[] | null = null,
): Promise<Buffer | null> {
  if (/\.jpe?g$/i.test(nombre)) return oscurecerImagenBuffer(buf, nivel, 'jpeg');
  if (/\.png$/i.test(nombre)) return oscurecerImagenBuffer(buf, nivel, 'png');
  if (/\.pdf$/i.test(nombre)) return oscurecerPdfBuffer(buf, nivel, paginas);
  return null;
}

/**
 * Pone la fecha de ahora a todas las imágenes de la carpeta: el robot pase_planta toma las hojas
 * (imágenes) del MISMO día que la más nueva; si se toca una sola hoja, copiaría solo esa.
 */
export function tocarImagenesDeCarpeta(dir: string): void {
  const ahora = new Date();
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|tiff?)$/i.test(f)) continue;
    try { fs.utimesSync(path.join(dir, f), ahora, ahora); } catch { /* noop */ }
  }
}
