const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { PDFDocument, rgb } = require('pdf-lib');
const config = require('./config');

// PDF de cada O.C. para verlos desde la pagina, con el renglon marcado en rojo.
// Los PDF se buscan en la carpeta de O.C. (ORDENES_COMPRA_DIR, D:\FARMACIA\ORDENES COMPRA) y sus subcarpetas:
// primero por el nombre del archivo ("OC 683-2026 - DOCFI...pdf") y, si no, leyendo "Nro de O.C." adentro.
// Los PDF que se suben desde la PC se guardan en esa carpeta (guardarEnCarpeta).

const cacheNumero = new Map(); // ruta|mtime -> N° de O.C. leido del PDF

function carpeta() {
  return config.ordenesCompraDir;
}

// "683/2026", "683-2026", "OC 683 2026" -> "683/2026"
function numeroOc(texto) {
  const m = String(texto ?? '').match(/(\d+)\s*[/-]\s*(\d{4})(?!\d)/);
  return m ? `${Number(m[1])}/${m[2]}` : null;
}

function listarPdfs(dir, nivel = 0) {
  if (!fs.existsSync(dir) || nivel > 3) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/^backup$/i.test(e.name)) out.push(...listarPdfs(ruta, nivel + 1));
    } else if (/\.pdf$/i.test(e.name)) {
      out.push(ruta);
    }
  }
  return out;
}

async function numeroDentroDelPdf(ruta) {
  const st = fs.statSync(ruta);
  const clave = `${ruta}|${st.mtimeMs}`;
  if (cacheNumero.has(clave)) return cacheNumero.get(clave);
  let numero = null;
  try {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(ruta)), disableFontFace: true, useSystemFonts: false }).promise;
    const page = await doc.getPage(1);
    const texto = (await page.getTextContent()).items.map((i) => i.str).join(' ');
    const m = texto.match(/Nro de O\.C\.:\s*(\S+)/);
    numero = m ? numeroOc(m[1]) : null;
  } catch {
    numero = null;
  }
  cacheNumero.set(clave, numero);
  return numero;
}

// Ruta del PDF de la O.C. "683/2026" o null
// archivo: nombre con el que se cargo la O.C. (los escaneos no traen el numero en el texto)
async function buscarPdf(oc, archivo) {
  const buscado = numeroOc(oc);
  if (!buscado) return null;
  const pdfs = listarPdfs(carpeta());
  const porNombre = pdfs.find((ruta) => {
    const m = path.basename(ruta).match(/O\.?\s*C\.?\s*(\d+)\s*[-_ ]\s*(\d{4})/i);
    return m && `${Number(m[1])}/${m[2]}` === buscado;
  });
  if (porNombre) return porNombre;
  const porArchivo = archivo && pdfs.find((ruta) => path.basename(ruta).toLowerCase() === String(archivo).toLowerCase());
  if (porArchivo) return porArchivo;
  for (const ruta of pdfs) {
    if (await numeroDentroDelPdf(ruta) === buscado) return ruta;
  }
  return null;
}

// Guarda en la carpeta de O.C. un PDF subido desde la PC (si ya hay uno igual, no lo repite)
function guardarEnCarpeta(nombre, buffer) {
  const dir = carpeta();
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  for (const ruta of listarPdfs(dir)) {
    const st = fs.statSync(ruta);
    if (st.size === buffer.length && crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex') === hash) return ruta;
  }
  const limpio = path.basename(String(nombre || 'orden.pdf')).replace(/[<>:"/\\|?*]/g, '_');
  let destino = path.join(dir, /\.pdf$/i.test(limpio) ? limpio : `${limpio}.pdf`);
  for (let i = 2; fs.existsSync(destino); i += 1) destino = path.join(dir, limpio.replace(/(\.pdf)?$/i, ` (${i}).pdf`));
  fs.writeFileSync(destino, buffer);
  return destino;
}

// Marca en rojo la fila del renglon (numero a la izquierda y codigo al lado, en la misma altura).
// Devuelve { buffer, pagina } (pagina 1-based) o { buffer, pagina: null } si no lo encontro.
async function marcarRenglon(buffer, renglon, codigo) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false }).promise;
  let hallado = null;
  for (let p = 1; p <= doc.numPages && !hallado; p += 1) {
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    // numeros de renglon de esta pagina: en la columna de la izquierda, con un codigo en la misma altura
    const codigos = items.filter((i) => /^[A-Z]\d{7}$/.test(i.str));
    const filas = items
      .filter((i) => /^\d{1,4}$/.test(i.str) && i.x < 90)
      .filter((i) => codigos.some((c) => Math.abs(c.y - i.y) <= 2 && c.x > i.x))
      .sort((a, b) => b.y - a.y);
    const idx = filas.findIndex((f) => Number(f.str) === Number(renglon)
      && (!codigo || codigos.some((c) => Math.abs(c.y - f.y) <= 2 && c.str === String(codigo).trim().toUpperCase())));
    if (idx < 0) continue;
    const f = filas[idx];
    const siguiente = filas[idx + 1];
    // la fila llega hasta el renglon siguiente o, si es el ultimo de la pagina, hasta el ultimo texto que la sigue
    const debajo = items.filter((i) => i.y < f.y - 1 && (!siguiente || i.y > siguiente.y + 1)).map((i) => i.y);
    const piso = siguiente ? siguiente.y + 11 : Math.max(Math.min(...debajo, f.y) - 4, f.y - 60);
    hallado = { pagina: p, techo: f.y + 11, piso };
  }
  if (!hallado) return { buffer, pagina: null };
  const pdf = await PDFDocument.load(buffer);
  const page = pdf.getPage(hallado.pagina - 1);
  const { width } = page.getSize();
  page.drawRectangle({
    x: 28,
    y: hallado.piso,
    width: width - 56,
    height: hallado.techo - hallado.piso,
    borderColor: rgb(0.86, 0.1, 0.1),
    borderWidth: 2,
    color: rgb(1, 0.2, 0.2),
    opacity: 0.12
  });
  return { buffer: Buffer.from(await pdf.save()), pagina: hallado.pagina };
}

module.exports = { buscarPdf, guardarEnCarpeta, marcarRenglon, listarPdfs };
