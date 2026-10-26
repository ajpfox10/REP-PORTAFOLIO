const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Orden de Compra GDEBA (DOCFI-...-GDEBA-HPDIGAMSALGP.pdf) -> Excel de control de entregas.
const ITEM_PATTERN = /^(\d+)\s+(Original|Alt\S*(?:\s*\d+)?)\s+([A-Z]\d{7})\s+(\S+)\s+(.*?)\s+(\d\.\d\.\d)\s+([\d.]+)\s+\$([\d.,]+)\s+\$([\d.,]+)$/;
const SHEET = 'CONTROL O.C.';
const HEADERS = ['FECHA DE VENCIMIENTO', 'N° O.C', 'RENGLON', 'CODIGO', 'DESCRIPCION', 'CANTIDAD',
  'CANTIDAD ENTREGADA', 'FALTA', 'COMPLETO', 'N° DE INGRESO', 'OBSERVACION', 'COMPLETA / INCOMPLETA'];
const WIDTHS = [14, 22, 10, 12, 60, 11, 13, 10, 12, 16, 22, 20];
// Columnas que carga el usuario a mano y se conservan al regenerar
const MANUAL_COLS = [7, 9, 10, 11];

function num(value) {
  return Number(String(value).replace(/\./g, '').replace(',', '.'));
}

async function extractLines(buffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items
      .filter((item) => item.str && item.str.trim())
      .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const item of items) {
      const row = rows.find((r) => Math.abs(r.y - item.y) <= 2);
      if (row) row.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }
    for (const row of rows) {
      const text = row.items.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  await doc.destroy();
  return lines;
}

async function parseOrdenCompra(buffer) {
  const lines = await extractLines(buffer);
  const text = lines.join('\n');
  const oc = text.match(/Nro de O\.C\.:\s*(\S+)/);
  if (!oc) throw new Error('No parece una Orden de Compra (falta "Nro de O.C.")');
  const proveedor = text.match(/Raz.n Social:\s*(.*?)(?:\s+Destino:.*)?$/m);
  const fecha = text.match(/FECHA:\s*(\d\d\/\d\d\/\d{4})/);
  const vence = text.match(/al proveedor y el\s*(\d\d\/\d\d\/\d{4})/);
  const proc = text.match(/CORRESPONDE A (.*?Nro \d+ ?\/ ?\d+)/);
  const subtotal = text.match(/SubTotal:\s*\$([\d.,]+)/);

  const items = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(ITEM_PATTERN);
    if (m) {
      cur = { renglon: Number(m[1]), codigo: m[3], desc: [m[5]], cantidad: num(m[7]), unitario: num(m[8]), total: num(m[9]), closed: false };
      items.push(cur);
      continue;
    }
    if (!cur || cur.closed) continue;
    if (/^(Hoja |SubTotal|Nro de O\.C\.)/.test(line)) { cur.closed = true; continue; }
    cur.desc.push(line);
    if (/Espec.fica/.test(line)) cur.closed = true;
  }
  const renglones = items.map(({ closed, desc, ...it }) => ({
    ...it,
    descripcion: desc.join(' ').replace(/\s*\(ver\s+Descripci.n\s+Espec.fica\)\s*$/i, '').replace(/\s+/g, ' ').trim()
  })).sort((a, b) => a.renglon - b.renglon);

  const sub = subtotal ? num(subtotal[1]) : null;
  const suma = renglones.reduce((acc, it) => acc + it.total, 0);
  if (!renglones.length) throw new Error(`O.C. ${oc[1]}: no se encontraron renglones`);
  if (sub !== null && Math.abs(suma - sub) > 0.05) {
    throw new Error(`O.C. ${oc[1]}: la suma de renglones ($${suma.toFixed(2)}) no coincide con el SubTotal ($${sub.toFixed(2)})`);
  }
  return {
    oc: oc[1],
    proveedor: proveedor ? proveedor[1].trim() : '',
    fecha: fecha ? fecha[1] : '',
    vence: vence ? vence[1] : '',
    procedimiento: proc ? proc[1] : '',
    subtotal: sub ?? suma,
    renglones
  };
}


function hashArchivo(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// PDFs de una carpeta del servidor. Primero los nombres "limpios" y despues los " (1)",
// asi el original queda cargado y la copia se informa como duplicada.
function leerPdfsCarpeta(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.pdf$/i.test(e.name))
    .map((e) => e.name)
    .sort(ordenNombres)
    .map((name) => ({ name, buffer: fs.readFileSync(path.join(dir, name)) }));
}

function ordenNombres(a, b) {
  return Number(/\(\d+\)/.test(a)) - Number(/\(\d+\)/.test(b)) || a.localeCompare(b);
}

function claveOc(oc) {
  const [n, y] = String(oc).split('/');
  return Number(y) * 100000 + Number(n);
}

// Lo cargado a mano en un Excel ya generado: "oc#renglon" -> { entregada, completo, nroIngreso, observacion }
async function leerCargaManual(file) {
  const prev = new Map();
  if (!fs.existsSync(file)) return prev;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) return prev;
  const texto = (v) => (v === null || v === undefined || v === '' ? null : (typeof v === 'object' && v.richText ? v.richText.map((t) => t.text).join('') : String(v)).trim() || null);
  let oc = null;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const b = row.getCell(2).value;
    if (b) oc = String(b).split(' ')[0];
    const entregadaRaw = row.getCell(7).value;
    const entregada = entregadaRaw === null || entregadaRaw === '' || entregadaRaw === undefined ? null : Number(entregadaRaw);
    const completo = texto(row.getCell(9).value);
    const valores = {
      entregada: Number.isFinite(entregada) ? entregada : null,
      completo: completo && ['SI', 'NO'].includes(completo.toUpperCase()) ? completo.toUpperCase() : null,
      nroIngreso: texto(row.getCell(10).value),
      observacion: texto(row.getCell(11).value)
    };
    if (oc && Object.values(valores).some((v) => v !== null)) prev.set(`${oc}#${row.getCell(3).value}`, valores);
  });
  return prev;
}

// ordenes: [{ oc, proveedor, fecha, vence, procedimiento, subtotal, archivo,
//   renglones: [{ renglon, codigo, descripcion, cantidad, entregada, completo, nroIngreso, observacion }] }]
// omitidos: [{ name, estado, detalle }] (PDF duplicados que no se cargaron)
function construirExcel(ordenes, omitidos = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const medium = { style: 'medium', color: { argb: 'FF000000' } };
  const green = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF33CC33' } };

  ws.columns = WIDTHS.map((width) => ({ width }));
  const head = ws.getRow(1);
  HEADERS.forEach((h, i) => {
    const cell = head.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
  });
  head.getCell(7).fill = green;
  head.height = 32;

  let r = 2;
  for (const orden of ordenes) {
    const r0 = r;
    for (const it of orden.renglones) {
      const row = ws.getRow(r);
      const vals = [orden.vence, `${orden.oc} ${orden.proveedor}`, it.renglon, it.codigo, it.descripcion, it.cantidad,
        it.entregada ?? null, { formula: `IF(G${r}="",F${r},F${r}-G${r})` }, it.completo || null, it.nroIngreso || null, it.observacion || null, null];
      vals.forEach((v, i) => {
        const c = i + 1;
        const cell = row.getCell(c);
        cell.value = v;
        cell.alignment = { vertical: 'middle', wrapText: [2, 5, 11].includes(c), horizontal: [5, 11].includes(c) ? 'left' : 'center' };
      });
      [6, 7, 8].forEach((c) => { row.getCell(c).numFmt = '#,##0'; });
      row.getCell(10).numFmt = '@';
      row.getCell(9).dataValidation = { type: 'list', allowBlank: true, formulae: ['"SI,NO"'] };
      r += 1;
    }
    const r1 = r - 1;
    const total = ws.getCell(r0, 12);
    total.value = { formula: `IF(COUNTIF(I${r0}:I${r1},"SI")=${r1 - r0 + 1},"COMPLETA","INCOMPLETA")` };
    total.font = { bold: true };
    for (const c of [1, 2, 12]) {
      ws.getCell(r0, c).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      if (r1 > r0) ws.mergeCells(r0, c, r1, c);
    }
    for (let rr = r0; rr <= r1; rr += 1) {
      for (let c = 1; c <= 12; c += 1) {
        ws.getCell(rr, c).border = { top: thin, left: thin, right: thin, bottom: rr === r1 ? medium : thin };
      }
    }
  }
  const last = Math.max(2, r - 1);
  ws.addConditionalFormatting({
    ref: `C2:K${last}`,
    rules: [
      { type: 'expression', priority: 1, formulae: ['$I2="SI"'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF33CC33' } } } },
      { type: 'expression', priority: 2, formulae: ['AND($G2<>"",$H2>0)'], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFEB84' } } } }
    ]
  });
  ws.addConditionalFormatting({
    ref: `L2:L${last}`,
    rules: [
      { type: 'expression', priority: 3, formulae: ['L2="COMPLETA"'], style: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FF33CC33' } } } },
      { type: 'expression', priority: 4, formulae: ['L2="INCOMPLETA"'], style: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFF6B6B' } } } }
    ]
  });
  ws.autoFilter = { from: 'A1', to: `L${last}` };

  const s = wb.addWorksheet('ARCHIVOS');
  s.columns = [12, 34, 12, 12, 34, 11, 16, 52].map((width) => ({ width }));
  s.addRow(['N° O.C', 'PROVEEDOR', 'FECHA O.C', 'VENCE', 'PROCEDIMIENTO', 'RENGLONES', 'TOTAL $', 'ARCHIVO PDF']).font = { bold: true };
  for (const o of ordenes) {
    s.addRow([o.oc, o.proveedor, o.fecha, o.vence, o.procedimiento, o.renglones.length, o.subtotal, o.archivo]).getCell(7).numFmt = '"$"#,##0.00';
  }
  if (omitidos.length) {
    s.addRow([]);
    s.addRow(['PDF NO CARGADOS (duplicados):']).font = { bold: true };
    for (const a of omitidos) s.addRow([a.name, a.estado.toUpperCase(), a.detalle]);
  }
  return wb;
}

module.exports = { parseOrdenCompra, hashArchivo, leerPdfsCarpeta, ordenNombres, claveOc, leerCargaManual, construirExcel };
