const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const XLSX = require('xlsx');

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value);
  if (!text || text === '-') return 0;
  const number = Number(text.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

// Forma canonica: SOLUCION INYECTABLE (y variantes) -> INYECTABLE; singular simple para plurales.
function formaCanonica(forma) {
  let s = normalizeText(forma).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!s) return null;
  if (s.includes('INYECTABLE')) return 'INYECTABLE';
  if (/^[A-Z]+S$/.test(s) && s.length > 4) s = s.slice(0, -1);
  return s;
}

// Devuelve las filas del archivo como array de arrays (celdas de texto/numero).
function readRows(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xls') {
    // Estos .xls son en realidad tablas HTML en UTF-8.
    const html = fs.readFileSync(filePath, 'utf8');
    const $ = cheerio.load(html);
    const rows = [];
    $('table').find('tr').each((_, tr) => {
      const cells = $(tr).find('th,td').map((__, cell) => normalizeText($(cell).text())).get();
      rows.push(cells);
    });
    return rows;
  }
  // .xlsx / .xlsm / .csv -> SheetJS
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function toIsoDate(ddmmyyyy) {
  const match = String(ddmmyyyy || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

// Trimestre a partir del mes de inicio del periodo: Ene-Mar=1, Abr-Jun=2, Jul-Sep=3, Oct-Dic=4.
function trimestreFromIso(isoDate) {
  if (!isoDate) return null;
  const month = Number(isoDate.slice(5, 7));
  if (!month) return null;
  return Math.ceil(month / 3);
}

function parseTrimestreReport(filePath) {
  const rows = readRows(filePath);
  const fullText = rows.map((row) => normalizeText(row.join(' '))).join(' ');

  // Rango de fechas: "entre el 01/01/2026 y 31/03/2026"
  const rangoMatch = fullText.match(/entre el\s+(\d{2}\/\d{2}\/\d{4})\s+y\s+(\d{2}\/\d{2}\/\d{4})/i);
  const periodoDesde = rangoMatch ? toIsoDate(rangoMatch[1]) : null;
  const periodoHasta = rangoMatch ? toIsoDate(rangoMatch[2]) : null;
  const anio = periodoDesde ? Number(periodoDesde.slice(0, 4)) : (periodoHasta ? Number(periodoHasta.slice(0, 4)) : null);
  const trimestre = trimestreFromIso(periodoDesde) || trimestreFromIso(periodoHasta);

  // Hospital / sector desde la linea de encabezado
  let hospital = null;
  let sector = null;
  const encabezado = rows.map((row) => normalizeText(row.join(' '))).find((text) => /Sector:/i.test(text) && /Reporte de Consumo/i.test(text));
  if (encabezado) {
    const hospMatch = encabezado.match(/^(.*?)\s*-\s*Sector:/i);
    if (hospMatch) hospital = normalizeText(hospMatch[1]);
    const sectorMatch = encabezado.match(/Sector:\s*(.*?)\s*-\s*Reporte de Consumo/i);
    if (sectorMatch) sector = normalizeText(sectorMatch[1]);
  }

  // Fila de encabezado de columnas (contiene "Cantidad" y "Articulo"/"Codigo")
  let headerIdx = rows.findIndex((row) => {
    const joined = normalizeHeader(row.join(' '));
    return joined.includes('cantidad') && (joined.includes('articulo') || joined.includes('cod'));
  });
  if (headerIdx < 0) headerIdx = 2;

  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length < 6) continue;
    const codigo = normalizeText(row[0]);
    const nombre = normalizeText(row[1]);
    if (!codigo || !nombre) continue;
    if (normalizeHeader(codigo).includes('cod')) continue;
    const cantidad = toNumber(row[5]);
    items.push({
      codigo,
      nombre,
      concentracion: normalizeText(row[2]) || null,
      forma: formaCanonica(row[3]),
      presentacion: normalizeText(row[4]) || null,
      cantidad
    });
  }

  return {
    hospital,
    sector,
    periodoDesde,
    periodoHasta,
    anio,
    trimestre,
    totalItems: items.length,
    items
  };
}

module.exports = { parseTrimestreReport };
