'use strict';

/**
 * shared/export.js
 * Exportación de datos a Excel (.xlsx) y CSV.
 * Usa exceljs para Excel con formato profesional.
 *
 * Uso:
 *   const { toExcel, toCsv } = require('./export');
 *   const buffer = await toExcel({ title: 'Reporte', rows, columns });
 *   res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 *   res.send(buffer);
 */

const ExcelJS = require('exceljs');
const { formatDateTime } = require('./locale');

// ─── Paleta corporativa ───────────────────────────────────────────────────────

const THEME = {
  headerBg     : '2563EB',   // azul primario
  headerFg     : 'FFFFFF',
  subheaderBg  : 'EFF6FF',
  altRowBg     : 'F8FAFC',
  borderColor  : 'CBD5E1',
  titleFg      : '1E293B',
  totalBg      : 'DBEAFE',
};

// ─── toExcel ─────────────────────────────────────────────────────────────────

/**
 * Genera un buffer Excel (.xlsx) con formato corporativo.
 *
 * @param {object} opts
 * @param {string}   opts.title     — Título del reporte
 * @param {string}   [opts.subtitle]
 * @param {object[]} opts.columns   — [{ key, header, width?, type?, format? }]
 *   type: 'number' | 'currency' | 'percent' | 'date' | 'string' (default)
 * @param {object[]} opts.rows      — datos (array de objetos)
 * @param {object[]} [opts.totals]  — [{ key, value }] — fila de totales al final
 * @param {object}   [opts.meta]    — { from, to, generatedBy, branch }
 * @param {boolean}  [opts.autoFilter] — agregar autoFilter (default true)
 * @returns {Promise<Buffer>}
 */
// SEC: cap de filas para evitar OOM o generación de archivos excesivamente grandes
const MAX_EXPORT_ROWS = parseInt(process.env.EXPORT_MAX_ROWS || '10000', 10);

async function toExcel ({ title, subtitle, columns, rows, totals, meta = {}, autoFilter = true }) {
  // SEC: limitar filas para prevenir ataques de agotamiento de memoria
  if (rows && rows.length > MAX_EXPORT_ROWS) {
    rows = rows.slice(0, MAX_EXPORT_ROWS);
  }
  const wb = new ExcelJS.Workbook();
  wb.creator   = 'VetManager API';
  wb.created   = new Date();
  wb.modified  = new Date();

  const ws = wb.addWorksheet(title.slice(0, 31), {
    pageSetup  : { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    properties : { tabColor: { argb: THEME.headerBg } },
  });

  let currentRow = 1;

  // ── Encabezado corporativo ──
  ws.mergeCells(`A${currentRow}:${colLetter(columns.length)}${currentRow}`);
  const titleCell = ws.getCell(`A${currentRow}`);
  titleCell.value = title;
  titleCell.font  = { name: 'Calibri', size: 14, bold: true, color: { argb: THEME.titleFg } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(currentRow).height = 28;
  currentRow++;

  if (subtitle || meta.from) {
    ws.mergeCells(`A${currentRow}:${colLetter(columns.length)}${currentRow}`);
    const sub = ws.getCell(`A${currentRow}`);
    const parts = [];
    if (subtitle)    parts.push(subtitle);
    if (meta.from)   parts.push(`Período: ${meta.from} → ${meta.to || 'hoy'}`);
    if (meta.branch) parts.push(`Sucursal: ${meta.branch}`);
    sub.value     = parts.join('   |   ');
    sub.font      = { name: 'Calibri', size: 9, italic: true, color: { argb: '64748B' } };
    sub.alignment = { horizontal: 'center' };
    currentRow++;
  }

  currentRow++;   // fila vacía

  // ── Fila de headers ──
  const headerRow = ws.getRow(currentRow);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font  = { name: 'Calibri', size: 10, bold: true, color: { argb: THEME.headerFg } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.headerBg } };
    cell.alignment = { vertical: 'middle', horizontal: _colAlign(col.type), wrapText: false };
    cell.border    = _thinBorder();
  });
  headerRow.height = 22;
  const dataStartRow = currentRow;
  currentRow++;

  // ── Filas de datos ──
  rows.forEach((row, ri) => {
    const exRow = ws.getRow(currentRow);
    columns.forEach((col, ci) => {
      const cell = exRow.getCell(ci + 1);
      cell.value = _formatValue(row[col.key], col.type);
      if (col.type === 'currency') cell.numFmt = '#,##0.00';
      if (col.type === 'percent')  cell.numFmt = '0.00"%"';
      if (col.type === 'number')   cell.numFmt = '#,##0.##';
      if (col.type === 'date')     cell.numFmt = 'dd/mm/yyyy';
      cell.alignment = { vertical: 'middle', horizontal: _colAlign(col.type) };
      cell.border    = _thinBorder();
      if (ri % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.altRowBg } };
      }
    });
    exRow.height = 18;
    currentRow++;
  });

  // ── Fila de totales ──
  if (totals && totals.length) {
    const totRow = ws.getRow(currentRow);
    // Primera celda: "TOTALES"
    const labelCell = totRow.getCell(1);
    labelCell.value = 'TOTALES';
    labelCell.font  = { bold: true, name: 'Calibri', size: 10 };
    labelCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.totalBg } };
    labelCell.border = _thinBorder();

    columns.forEach((col, ci) => {
      const tot = totals.find(t => t.key === col.key);
      const cell = totRow.getCell(ci + 1);
      if (tot !== undefined) {
        cell.value  = _formatValue(tot.value, col.type);
        if (col.type === 'currency') cell.numFmt = '#,##0.00';
        if (col.type === 'percent')  cell.numFmt = '0.00"%"';
        if (col.type === 'number')   cell.numFmt = '#,##0.##';
      }
      cell.font   = { bold: true, name: 'Calibri', size: 10 };
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: THEME.totalBg } };
      cell.border = _thinBorder();
    });
    totRow.height = 20;
    currentRow++;
  }

  // ── Autofit de columnas ──
  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width || _autoWidth(col, rows);
  });

  // ── AutoFilter ──
  if (autoFilter && rows.length > 0) {
    ws.autoFilter = {
      from: { row: dataStartRow, column: 1 },
      to:   { row: dataStartRow, column: columns.length },
    };
  }

  // ── Metadatos al pie ──
  if (meta.generatedBy || meta.generatedAt) {
    currentRow++;
    ws.mergeCells(`A${currentRow}:${colLetter(columns.length)}${currentRow}`);
    const foot = ws.getCell(`A${currentRow}`);
    foot.value = `Generado por: ${meta.generatedBy || 'VetManager'} — ${formatDateTime(new Date())}`;
    foot.font  = { name: 'Calibri', size: 8, italic: true, color: { argb: '94A3B8' } };
    foot.alignment = { horizontal: 'right' };
  }

  // ── Freeze panes ──
  ws.views = [{ state: 'frozen', ySplit: dataStartRow, xSplit: 0 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── toCsv ───────────────────────────────────────────────────────────────────

/**
 * Genera un string CSV (UTF-8 con BOM para Excel en español).
 *
 * @param {object} opts
 * @param {object[]} opts.columns  — [{ key, header }]
 * @param {object[]} opts.rows
 * @param {string}   [opts.delimiter] — default ';' (estándar Excel español)
 * @returns {string}
 */
function toCsv ({ columns, rows, delimiter = ';' }) {
  // SEC: limitar filas para prevenir generación de archivos CSV enormes
  if (rows && rows.length > MAX_EXPORT_ROWS) {
    rows = rows.slice(0, MAX_EXPORT_ROWS);
  }
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    // SEC: CSV injection — prefixar con comilla simple los valores que comienzan
    // con caracteres de fórmula (=, +, -, @, \t, \r).
    // Esto hace que Excel/LibreOffice los trate como texto literal.
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    // Si contiene el delimitador, comillas o salto de línea, envolver en comillas
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(c => escape(c.header)).join(delimiter);
  const dataRows = rows.map(row =>
    columns.map(c => escape(row[c.key])).join(delimiter)
  );

  // BOM UTF-8 para que Excel abra correctamente con tildes
  return '\uFEFF' + [header, ...dataRows].join('\r\n');
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

function colLetter (n) {
  // 1 → A, 26 → Z, 27 → AA
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function _thinBorder () {
  const side = { style: 'thin', color: { argb: THEME.borderColor } };
  return { top: side, left: side, bottom: side, right: side };
}

function _colAlign (type) {
  return ['number', 'currency', 'percent'].includes(type) ? 'right' : 'left';
}

function _formatValue (val, type) {
  if (val === null || val === undefined) return '';
  if (type === 'date')     return val instanceof Date ? val : new Date(val);
  if (type === 'number' || type === 'currency' || type === 'percent') {
    const n = Number(val);
    return isNaN(n) ? val : n;
  }
  return val;
}

function _autoWidth (col, rows) {
  const headerLen = (col.header || '').length;
  const maxData   = rows.reduce((max, row) => {
    const v = row[col.key];
    return Math.max(max, v != null ? String(v).length : 0);
  }, 0);
  return Math.min(Math.max(headerLen, maxData) + 4, 40);
}

module.exports = { toExcel, toCsv };
