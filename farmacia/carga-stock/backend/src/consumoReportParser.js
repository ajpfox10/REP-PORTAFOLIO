const fs = require('fs');
const cheerio = require('cheerio');

const MONTHS = [
  { key: 'enero', label: 'Enero' },
  { key: 'febrero', label: 'Febrero' },
  { key: 'marzo', label: 'Marzo' },
  { key: 'abril', label: 'Abril' },
  { key: 'mayo', label: 'Mayo' },
  { key: 'junio', label: 'Junio' },
  { key: 'julio', label: 'Julio' },
  { key: 'agosto', label: 'Agosto' },
  { key: 'septiembre', label: 'Septiembre' },
  { key: 'octubre', label: 'Octubre' },
  { key: 'noviembre', label: 'Noviembre' },
  { key: 'diciembre', label: 'Diciembre' }
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toNumber(value) {
  const text = normalizeText(value);
  if (!text || text === '-') return 0;
  const number = Number(text.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function monthWindow(items) {
  const withData = MONTHS.filter((month) =>
    items.some((item) => Number(item.meses[month.key] || 0) > 0)
  );
  if (withData.length >= 6) return withData.slice(-6);
  const currentMonthIndex = new Date().getMonth();
  const start = Math.max(0, currentMonthIndex - 5);
  return MONTHS.slice(start, currentMonthIndex + 1).slice(-6);
}

function monthsForPeriodo(periodo, items) {
  if (periodo === 'anio_completo') return MONTHS;
  if (periodo === 'semestre_1') return MONTHS.slice(0, 6);
  if (periodo === 'semestre_2') return MONTHS.slice(6, 12);
  return monthWindow(items);
}

function computeStats(item, selectedMonths) {
  const values = selectedMonths.map((month) => ({
    key: month.key,
    label: month.label,
    value: Number(item.meses[month.key] || 0)
  }));
  const suma6 = values.reduce((sum, entry) => sum + entry.value, 0);
  const monthCount = selectedMonths.length || 6;
  const promedio6 = suma6 / monthCount;
  const maximoSugerido = Math.ceil(suma6 / monthCount);
  const minimoDivisor = Math.max(1, monthCount / 2);
  const minimoSugerido = Math.ceil(suma6 / minimoDivisor);
  const minValue = Math.min(...values.map((entry) => entry.value));
  const maxValue = Math.max(...values.map((entry) => entry.value));
  return {
    valores6: values,
    suma6,
    promedio6,
    minimoSugerido,
    maximoSugerido,
    mesesMinimos: values.filter((entry) => entry.value === minValue).map((entry) => entry.label),
    mesesMaximos: values.filter((entry) => entry.value === maxValue).map((entry) => entry.label)
  };
}

function parseConsumoReport(filePath, options = {}) {
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(html);
  const rows = [];
  $('tr').each((_index, tr) => {
    const cells = [];
    $(tr).children('th,td').each((_cellIndex, cell) => {
      cells.push(normalizeText($(cell).text()));
    });
    if (cells.length) rows.push(cells);
  });

  let hospital = '';
  let sector = '';
  let headerIndex = -1;
  let headers = [];

  rows.forEach((row, index) => {
    const joined = row.join(' ');
    if (!hospital && joined.includes('HOSPITAL')) {
      const parts = joined.split(' - ');
      hospital = normalizeText(parts[0]);
      sector = normalizeText(parts.slice(1).join(' - '));
    }
    const normalized = row.map(normalizeHeader);
    if (headerIndex === -1 && normalized.includes('codigo de articulo')) {
      headerIndex = index;
      headers = normalized;
    }
  });

  if (headerIndex === -1) {
    return {
      hospital,
      sector,
      totalItems: 0,
      mesesUsados: [],
      items: []
    };
  }

  const indexByHeader = Object.fromEntries(headers.map((header, index) => [header, index]));
  const monthIndexes = Object.fromEntries(MONTHS.map((month) => [month.key, indexByHeader[normalizeHeader(month.label)]]));
  const items = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const codigo = normalizeText(row[indexByHeader['codigo de articulo']]);
    if (!codigo) continue;
    const meses = {};
    for (const month of MONTHS) {
      meses[month.key] = toNumber(row[monthIndexes[month.key]]);
    }
    items.push({
      codigoArticulo: codigo,
      nombreGenerico: normalizeText(row[indexByHeader['nombre generico']]),
      concentracion: normalizeText(row[indexByHeader.concentracion]),
      presentacion: normalizeText(row[indexByHeader.presentacion]),
      forma: normalizeText(row[indexByHeader.forma]),
      sector: normalizeText(row[indexByHeader.sector]),
      meses
    });
  }

  const mesesUsados = monthsForPeriodo(options.periodo, items);
  const computed = items.map((item) => ({
    ...item,
    ...computeStats(item, mesesUsados)
  }));

  return {
    hospital,
    sector,
    totalItems: computed.length,
    periodo: options.periodo || 'auto',
    mesesUsados,
    items: computed
  };
}

module.exports = { MONTHS, parseConsumoReport };
