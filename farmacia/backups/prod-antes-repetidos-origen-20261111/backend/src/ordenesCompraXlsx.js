const ExcelJS = require('exceljs');

// Adaptador que imita la parte de la API de Google Sheets que usa ordenesCompraDrive.js,
// pero sobre un .xlsx en memoria (el archivo de Drive se baja, se modifica y se vuelve a subir).
// Solo se implementan los pedidos de formato que usa la sincronizacion.

function fechaTexto(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function valorCelda(cell) {
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return '';
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fechaTexto(v);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return v.text;
    if ('result' in v || v.formula || v.sharedFormula) {
      const r = v.result;
      if (r === null || r === undefined || typeof r === 'object') return r instanceof Date ? fechaTexto(r) : '';
      return r;
    }
    if (v.error) return '';
  }
  return v;
}

function parsearRango(range) {
  const m = String(range).match(/^'((?:[^']|'')+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/);
  if (!m) throw new Error(`Rango no soportado: ${range}`);
  const col = (letras) => letras.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
  return {
    titulo: m[1].replace(/''/g, "'"),
    c0: col(m[2]),
    r0: Number(m[3]),
    c1: m[4] ? col(m[4]) : col(m[2]),
    r1: m[5] ? Number(m[5]) : (m[4] ? null : Number(m[3]))
  };
}

const ARGB = (c) => {
  const h = (x) => Math.round((x || 0) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `FF${h(c.red)}${h(c.green)}${h(c.blue)}`;
};

async function abrirXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let sucio = false;

  const hoja = (titulo) => {
    const ws = wb.getWorksheet(titulo);
    if (!ws) throw new Error(`No existe la pestaña "${titulo}" en el Excel`);
    return ws;
  };
  const hojaPorId = (id) => wb.worksheets.find((w) => w.id === id) || wb.worksheets[0];
  const celdas = (ws, range, fn) => {
    for (let r = range.startRowIndex; r < range.endRowIndex; r += 1) {
      for (let c = range.startColumnIndex; c < range.endColumnIndex; c += 1) fn(ws.getCell(r + 1, c + 1), r, c);
    }
  };

  return {
    get sucio() {
      return sucio;
    },

    async hojas() {
      return wb.worksheets.map((ws) => ({ title: ws.name, sheetId: ws.id, gridProperties: { rowCount: 1048576 } }));
    },

    async leer(range) {
      const { titulo, c0, r0, c1, r1 } = parsearRango(range);
      const ws = hoja(titulo);
      const hasta = r1 || ws.rowCount;
      const out = [];
      for (let r = r0; r <= hasta; r += 1) {
        const row = ws.getRow(r);
        const vals = [];
        for (let c = c0; c <= c1; c += 1) vals.push(valorCelda(row.getCell(c)));
        out.push(vals);
      }
      while (out.length && !out[out.length - 1].some((v) => v !== '' && v !== null && v !== undefined)) out.pop();
      return out;
    },

    async escribir(data) {
      for (const { range, values } of data) {
        const { titulo, c0, r0 } = parsearRango(range);
        const ws = hoja(titulo);
        values.forEach((fila, i) => {
          fila.forEach((v, j) => {
            const cell = ws.getCell(r0 + i, c0 + j);
            if (typeof v === 'string' && v.startsWith('=')) cell.value = { formula: v.slice(1) };
            else cell.value = v === '' || v === undefined ? null : v;
          });
        });
        sucio = true;
      }
    },

    async batchUpdate(requests) {
      for (const q of requests) {
        sucio = true;
        if (q.addSheet) {
          wb.addWorksheet(q.addSheet.properties.title);
        } else if (q.updateSheetProperties) {
          const ws = hojaPorId(q.updateSheetProperties.properties.sheetId);
          ws.views = [{ state: 'frozen', ySplit: 1 }];
        } else if (q.updateDimensionProperties) {
          const { range, properties } = q.updateDimensionProperties;
          if (range.dimension !== 'COLUMNS') continue;
          const ws = hojaPorId(range.sheetId);
          for (let c = range.startIndex; c < range.endIndex; c += 1) {
            const col = ws.getColumn(c + 1);
            if (properties.hiddenByUser !== undefined) col.hidden = properties.hiddenByUser;
            if (properties.pixelSize) col.width = Math.round(properties.pixelSize / 7);
          }
        } else if (q.mergeCells) {
          const { range } = q.mergeCells;
          hojaPorId(range.sheetId).mergeCells(range.startRowIndex + 1, range.startColumnIndex + 1, range.endRowIndex, range.endColumnIndex);
        } else if (q.updateBorders) {
          const { range } = q.updateBorders;
          const thin = { style: 'thin', color: { argb: 'FF000000' } };
          const medium = { style: 'medium', color: { argb: 'FF000000' } };
          celdas(hojaPorId(range.sheetId), range, (cell, r) => {
            cell.border = { top: thin, left: thin, right: thin, bottom: r === range.endRowIndex - 1 ? medium : thin };
          });
        } else if (q.setDataValidation) {
          const { range, rule } = q.setDataValidation;
          const lista = rule.condition.values.map((v) => v.userEnteredValue).join(',');
          const r = { ...range, endRowIndex: range.endRowIndex || range.startRowIndex + 1 };
          celdas(hojaPorId(range.sheetId), r, (cell) => {
            cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${lista}"`] };
          });
        } else if (q.repeatCell) {
          const { range, cell: spec } = q.repeatCell;
          const f = spec.userEnteredFormat || {};
          if (!range.endRowIndex) continue; // formatos de columna entera: solo para hojas nuevas de Google
          celdas(hojaPorId(range.sheetId), range, (cell) => {
            if (f.textFormat?.bold) cell.font = { ...(cell.font || {}), bold: true };
            if (f.verticalAlignment || f.horizontalAlignment || f.wrapStrategy) {
              cell.alignment = {
                ...(cell.alignment || {}),
                ...(f.verticalAlignment ? { vertical: f.verticalAlignment === 'MIDDLE' ? 'middle' : f.verticalAlignment.toLowerCase() } : {}),
                ...(f.horizontalAlignment ? { horizontal: f.horizontalAlignment.toLowerCase() } : {}),
                ...(f.wrapStrategy === 'WRAP' ? { wrapText: true } : {})
              };
            }
            if (f.backgroundColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(f.backgroundColor) } };
          });
        }
        // appendDimension y addConditionalFormatRule no hacen falta en un .xlsx
      }
    },

    async aBuffer() {
      return Buffer.from(await wb.xlsx.writeBuffer());
    }
  };
}

module.exports = { abrirXlsx };
