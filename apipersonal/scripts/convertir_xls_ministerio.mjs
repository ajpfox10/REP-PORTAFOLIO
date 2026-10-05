// convertir_xls_ministerio.mjs
// Convierte el "xls mentiroso" que baja la Intranet (Novedades registradas: es HTML/texto con
// extension .xls) en un .xls de verdad (BIFF8), igual al que se guardaba a mano desde Excel:
//   - la primera fila es el encabezado (Legajo, Nro Documento, ... Fecha Desde, Fecha Hasta ...)
//   - fechas (aaaa-mm-dd o dd/mm/aaaa) -> numero de serie de Excel (lo que espera el comparador)
//   - legajo / documento -> numero
// Uso: node convertir_xls_ministerio.mjs <entrada> <salida.xls>
// Imprime una linea JSON: {"ok":true,"filas":N,"columnas":[...]} o {"ok":false,"error":"..."}
import fs from 'fs';
import * as XLSX from 'xlsx';

const [, , entrada, salida] = process.argv;

function serialExcel(d, m, y) {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5);
}

// La Intranet manda algunos nombres con doble codificacion (AVELDAÃ\x91O = AVELDAÑO): se
// re-decodifica solo la celda que tiene ese patron y solo si el resultado es UTF-8 valido.
function repararDobleCodificacion(s) {
  if (!/[ÃÂ][\u0080-¿]/.test(s)) return s;
  const r = Buffer.from(s, 'latin1').toString('utf8');
  return r.includes('�') ? s : r;
}

function convertirCelda(v) {
  if (v == null) return '';
  const s = repararDobleCodificacion(String(v).replace(/ /g, ' ').trim());
  const f = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (f) return serialExcel(+f[1], +f[2], +f[3]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T][\d:]+)?$/);   // la Intranet manda aaaa-mm-dd
  if (iso) return serialExcel(+iso[3], +iso[2], +iso[1]);
  if (/^\d{1,12}$/.test(s)) return Number(s);
  return s;
}

try {
  if (!entrada || !salida) throw new Error('Uso: node convertir_xls_ministerio.mjs <entrada> <salida.xls>');
  // La Intranet manda HTML en UTF-8; leido como buffer SheetJS lo toma como latin-1 y rompe
  // tildes y Ñ (ARGAÃ‘ARAS, JUSTIFICCIÃ“N). Si es HTML/texto se decodifica como UTF-8.
  const buf = fs.readFileSync(entrada);
  const esBinario = buf.slice(0, 4).toString('hex') === 'd0cf11e0' || buf.slice(0, 2).toString() === 'PK';
  const wb = esBinario
    ? XLSX.read(buf, { type: 'buffer', raw: true, cellDates: false })
    : XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  // el encabezado es la primera fila que tiene "Documento" y "Desde" (puede haber titulos arriba)
  const iHdr = filas.findIndex((r) => {
    const t = r.map((c) => String(c).toLowerCase());
    return t.some((c) => c.includes('documento')) && t.some((c) => c.includes('desde'));
  });
  if (iHdr < 0) throw new Error('No encuentro el encabezado (Documento / Desde) en lo descargado');

  const hdr = filas[iHdr].map((c) => String(c).replace(/\s+/g, ' ').trim());
  const datos = filas.slice(iHdr + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => hdr.map((_, i) => convertirCelda(r[i])));

  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet([hdr, ...datos]), 'NovedadesRegistradas');
  fs.writeFileSync(salida, XLSX.write(out, { bookType: 'xls', type: 'buffer' }));

  // verificacion: se relee como .xls real
  const chk = XLSX.read(fs.readFileSync(salida), { type: 'buffer', cellDates: false });
  const n = XLSX.utils.sheet_to_json(chk.Sheets[chk.SheetNames[0]], { header: 1 }).length - 1;
  console.log(JSON.stringify({ ok: true, filas: n, columnas: hdr }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  process.exitCode = 1;
}
