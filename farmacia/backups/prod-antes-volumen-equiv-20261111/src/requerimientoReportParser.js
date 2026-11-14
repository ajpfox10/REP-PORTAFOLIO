const fs = require('fs');
const crypto = require('crypto');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Parser de "Formulario de Requerimiento" (PDF del sistema de compras).
// La tabla se lee por posicion X de cada texto: la descripcion y a veces la cantidad
// ("18.00" + "0") vienen partidas en varias lineas debajo de la fila del item.
const COLUMNAS = [
  { key: 'item', hasta: 70 },
  { key: 'cantidad', hasta: 115 },
  { key: 'stock', hasta: 128 },
  { key: 'codigo', hasta: 175 },
  { key: 'sigaf', hasta: 225 },
  { key: 'descripcion', hasta: 328 },
  { key: 'muestra', hasta: 355 },
  { key: 'imputacion', hasta: 385 },
  { key: 'justiprecio', hasta: 440 },
  { key: 'estado', hasta: 485 },
  { key: 'total', hasta: Infinity }
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function columnaDe(x) {
  return COLUMNAS.find((col) => x < col.hasta).key;
}

// "$1.234,56" -> 1234.56 ; "3.000" -> 3000
function parseNumeroAr(value) {
  const limpio = String(value ?? '').replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// "20-10-2026" -> "2026-10-20"
function parseFechaAr(value) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(String(value ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function sinAcentos(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Droga = texto antes del primer " - " de la descripcion del catalogo.
function extraerDroga(descripcion) {
  const partes = normalizeText(descripcion).split(/\s+-\s+/);
  return normalizeText(partes[0].replace(/\s*-\s*$/, '')) || normalizeText(descripcion);
}

function claveDroga(droga) {
  return sinAcentos(droga).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

async function leerTextos(buffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false }).promise;
  const paginas = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const textos = content.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str }));
    // De arriba hacia abajo y de izquierda a derecha
    textos.sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
    paginas.push(textos);
  }
  return paginas;
}

// Agrupa textos de una misma linea (misma Y).
function agruparLineas(textos) {
  const lineas = [];
  for (const t of textos) {
    const ultima = lineas[lineas.length - 1];
    if (ultima && Math.abs(ultima.y - t.y) <= 2) ultima.partes.push(t);
    else lineas.push({ y: t.y, partes: [t] });
  }
  return lineas.map((l) => ({ y: l.y, x: l.partes[0].x, texto: normalizeText(l.partes.map((p) => p.str).join(' ')), partes: l.partes }));
}

async function parseRequerimientoPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const paginas = await leerTextos(buffer);

  const cab = {
    numero: null, anioNumero: null, fuente: null, hospital: null, estado: null, tipoContratacion: null,
    fecha: null, servicio: null, periodoDesde: null, periodoHasta: null, totalDeclarado: null
  };
  const items = [];
  const especificas = new Map();
  let modo = 'cabecera'; // cabecera -> items -> especifica -> fin
  let actual = null;
  let especificaActual = null;

  for (const [indicePagina, textos] of paginas.entries()) {
    for (const linea of agruparLineas(textos)) {
      const texto = linea.texto;
      if (/^Hoja \d+ de \d+$/i.test(texto)) continue;

      if (modo === 'cabecera') {
        let m;
        if ((m = /Requerimiento Nro\.\s*(\d+)\s*\/\s*(\d{4})/i.exec(texto))) { cab.numero = m[1]; cab.anioNumero = Number(m[2]); continue; }
        if ((m = /^Fuente de Financiamiento:\s*(.*)$/i.exec(texto))) { cab.fuente = m[1]; continue; }
        if (/^HOSPITAL/i.test(texto)) { cab.hospital = texto; continue; }
        if ((m = /^Estado:\s*(.*)$/i.exec(texto))) { cab.estado = m[1]; continue; }
        if ((m = /^Tipo Contrataci.n:\s*(.*)$/i.exec(texto))) { cab.tipoContratacion = m[1]; continue; }
        if ((m = /^Fecha:\s*(.*)$/i.exec(texto))) { cab.fecha = parseFechaAr(m[1]); continue; }
        if ((m = /^Servicio solicitante:\s*(.*)$/i.exec(texto))) { cab.servicio = m[1]; continue; }
        if ((m = /desde el (\S+) al (\S+)/i.exec(texto))) { cab.periodoDesde = parseFechaAr(m[1]); cab.periodoHasta = parseFechaAr(m[2]); continue; }
        if (/^Item\b/i.test(texto) && /Justiprecio/i.test(texto)) { modo = 'items'; }
        continue;
      }

      if (modo === 'items') {
        const totalMatch = /^Total:\s*(\$[\d.,]+)/i.exec(texto);
        if (totalMatch) { cab.totalDeclarado = parseNumeroAr(totalMatch[1]); modo = 'especifica'; continue; }
        if (/^Item\b/i.test(texto) && /Justiprecio/i.test(texto)) continue; // encabezado repetido
        for (const parte of linea.partes) {
          const col = columnaDe(parte.x);
          const str = normalizeText(parte.str);
          if (col === 'item' && /^\d+$/.test(str)) {
            actual = { item: Number(str), hoja: indicePagina + 1, cantidad: '', stock: '', codigo: '', sigaf: '', descripcion: [], muestra: '', imputacion: '', justiprecio: '', estado: '', total: '' };
            items.push(actual);
            continue;
          }
          if (!actual) continue;
          if (col === 'descripcion') actual.descripcion.push(str);
          else if (col === 'cantidad') actual.cantidad += str; // "18.00" + "0"
          else if (col !== 'item') actual[col] = actual[col] ? `${actual[col]} ${str}` : str;
        }
        continue;
      }

      if (modo === 'especifica') {
        if (/^Observaciones:/i.test(texto)) { modo = 'fin'; continue; }
        if (/^Descripci.n Espec.fica/i.test(texto)) continue;
        const m = /^Item\s*(\d+)\s*:\s*(.*)$/i.exec(texto);
        if (m) {
          especificaActual = Number(m[1]);
          especificas.set(especificaActual, m[2]);
        } else if (especificaActual != null) {
          especificas.set(especificaActual, `${especificas.get(especificaActual)} ${texto}`);
        }
      }
    }
  }

  const filas = items.map((it) => {
    const descripcion = normalizeText(it.descripcion.join(' ').replace(/\(Ver Descripci.n Espec.fica\)/i, ''));
    const droga = extraerDroga(descripcion);
    return {
      item: it.item,
      hoja: it.hoja,
      cantidad: parseNumeroAr(it.cantidad) ?? 0,
      stock: parseNumeroAr(it.stock),
      codigo: it.codigo,
      sigaf: it.sigaf || null,
      descripcion,
      descripcionEspecifica: especificas.has(it.item) ? normalizeText(especificas.get(it.item)) : null,
      droga,
      drogaClave: claveDroga(droga),
      muestra: it.muestra || null,
      imputacion: it.imputacion || null,
      justiprecio: parseNumeroAr(it.justiprecio),
      estado: it.estado || null,
      total: parseNumeroAr(it.total)
    };
  }).filter((it) => it.codigo);

  const totalCalculado = filas.reduce((acc, it) => acc + Number(it.total || 0), 0);
  return { hash, ...cab, totalHojas: paginas.length, items: filas, totalCalculado: Math.round(totalCalculado * 100) / 100 };
}

module.exports = { parseRequerimientoPdf, claveDroga };
