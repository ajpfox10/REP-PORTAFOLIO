const fs = require('fs');
const cheerio = require('cheerio');

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isDash(value) {
  const text = normalizeText(value);
  return text === '' || text === '-' || text.toLowerCase() === 'nan';
}

function toIntOrNull(value) {
  if (isDash(value)) return null;
  const cleaned = normalizeText(value).replace(/\./g, '').replace(',', '.');
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function parseEmissionDate(text) {
  const match = normalizeText(text).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseStockReport(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html);
  const rows = [];
  $('tr').each((_index, tr) => {
    const cells = [];
    $(tr).find('th,td').each((_cellIndex, cell) => {
      cells.push(normalizeText($(cell).text()));
    });
    if (cells.length) rows.push(cells);
  });
  let hospital = '';
  let sector = '';
  let fechaEmision = null;
  const items = [];

  for (const row of rows) {
    const values = row.map(normalizeText);
    const joined = values.join(' ');
    if (!hospital && joined.includes('HOSPITAL')) {
      const parts = joined.split(' - ');
      hospital = normalizeText(parts[0]);
      sector = normalizeText(parts.slice(1).join(' - '));
    }
    if (!fechaEmision && joined.toLowerCase().includes('emisi')) {
      fechaEmision = parseEmissionDate(joined);
    }
    if (/^\d+$/.test(values[0] || '') && values.length >= 6) {
      const minimoConGuion = isDash(values[3]);
      const maximoConGuion = isDash(values[4]);
      items.push({
        filaReporte: Number(values[0]),
        codigoArticulo: values[1],
        descripcion: values[2],
        stockMinimoActual: toIntOrNull(values[3]),
        stockMaximoActual: toIntOrNull(values[4]),
        stockActual: toIntOrNull(values[5]),
        minimoConGuion,
        maximoConGuion,
        requiereCarga: minimoConGuion || maximoConGuion
      });
    }
  }

  return {
    hospital,
    sector,
    fechaEmision,
    totalItems: items.length,
    itemsConGuion: items.filter((item) => item.requiereCarga).length,
    items
  };
}

module.exports = { parseStockReport };
