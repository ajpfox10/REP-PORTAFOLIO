const fs = require('fs');
const path = require('path');
const config = require('./config');
const { query } = require('./db');
const { listarOrdenes } = require('./ordenesCompraDb');

// Sincroniza las O.C. de la base con un archivo de Google Drive (Excel .xlsx o Planilla de Google).
// - El destino (archivo, pestaña fija o una pestaña por año) se elige desde la pagina y se guarda
//   en oc_drive_config. Cada ambiente (dev/prod) tiene su propia base, asi que su propio destino.
// - Las columnas del PDF (A-F) las escribe solo el sistema, al agregar O.C. nuevas.
// - Las columnas de carga (G entregada, I completo, J N° ingreso, K observacion) se editan
//   en la pagina o en la planilla: se compara cada lado contra los ultimos valores acordados
//   (oc_renglones.sync_valores) y se copia el que cambio. Si cambiaron los dos, gana la planilla.
// - La columna M (oculta) tiene el id del renglon para ubicar la fila aunque se ordene la hoja.
// - Nunca se borran filas. Antes de cada escritura se hace backup (version fijada en Drive +
//   copia en el servidor) y se descarta el backup anterior: siempre queda uno, el previo al ultimo cambio.
const HEADERS = ['FECHA DE VENCIMIENTO', 'N° O.C', 'RENGLON', 'CODIGO', 'DESCRIPCION', 'CANTIDAD',
  'CANTIDAD ENTREGADA', 'FALTA', 'COMPLETO', 'N° DE INGRESO', 'OBSERVACION', 'COMPLETA / INCOMPLETA', 'ID'];
const WIDTHS = [110, 170, 75, 90, 420, 85, 100, 75, 95, 120, 170, 150, 60];
const COL = { entregada: 6, completo: 8, nroIngreso: 9, observacion: 10, id: 12 };
const LETRA = { entregada: 'G', completo: 'I', nroIngreso: 'J', observacion: 'K' };
const CAMPOS = ['entregada', 'completo', 'nroIngreso', 'observacion'];
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';

const estado = { ultimaSync: null, ultimoError: null, enCurso: false, resumen: null };
let pendiente = false;
let googleCache = null;

const httpError = (status, message) => Object.assign(new Error(message), { status });

// --- destino guardado en la base ---
async function leerDestino() {
  const [row] = await query('SELECT * FROM oc_drive_config WHERE id = 1');
  return {
    fileId: row?.file_id || null,
    fileNombre: row?.file_nombre || null,
    fileTipo: row?.file_tipo || null,
    modo: row?.modo_pestana || 'anual',
    prefijo: row?.prefijo_anual ?? 'O.C ',
    pestanaFija: row?.pestana_fija || null,
    activo: row ? Boolean(row.activo) : true,
    backup: row?.backup_fecha ? { revisionId: row.backup_revision_id, local: row.backup_local, fecha: row.backup_fecha } : null
  };
}

function validarDestino(d) {
  const modo = d.modo === 'fija' ? 'fija' : 'anual';
  const prefijo = String(d.prefijo ?? 'O.C ').replace(/[[\]*?/\\:]/g, '').slice(0, 60);
  const pestanaFija = String(d.pestanaFija || '').replace(/[[\]*?/\\:]/g, '').trim().slice(0, 100);
  if (!d.fileId) throw httpError(400, 'Elegí el archivo de Drive');
  if (modo === 'fija' && !pestanaFija) throw httpError(400, 'Indicá el nombre de la pestaña');
  if (modo === 'anual' && !prefijo.trim()) throw httpError(400, 'Indicá cómo empieza el nombre de las pestañas por año (por ejemplo "O.C ")');
  return { fileId: String(d.fileId).trim(), modo, prefijo, pestanaFija: modo === 'fija' ? pestanaFija : null };
}

async function guardarDestino(datos, usuarioId) {
  const nuevo = validarDestino(datos);
  const archivo = await inspeccionarArchivo(nuevo.fileId);
  if (!archivo.puedeEditar) throw httpError(400, `El robot no tiene permiso de Editor en "${archivo.nombre}"`);
  const actual = await leerDestino();
  const cambio = actual.fileId !== nuevo.fileId || actual.modo !== nuevo.modo || actual.prefijo !== nuevo.prefijo || actual.pestanaFija !== nuevo.pestanaFija;
  await query(
    `INSERT INTO oc_drive_config (id, file_id, file_nombre, file_tipo, modo_pestana, prefijo_anual, pestana_fija, activo, actualizado_por)
     VALUES (1, :fileId, :nombre, :tipo, :modo, :prefijo, :pestanaFija, :activo, :usuarioId)
     ON DUPLICATE KEY UPDATE file_id = VALUES(file_id), file_nombre = VALUES(file_nombre), file_tipo = VALUES(file_tipo),
       modo_pestana = VALUES(modo_pestana), prefijo_anual = VALUES(prefijo_anual), pestana_fija = VALUES(pestana_fija),
       activo = VALUES(activo), actualizado_por = VALUES(actualizado_por)`,
    { ...nuevo, nombre: archivo.nombre, tipo: archivo.tipo, activo: datos.activo === false ? 0 : 1, usuarioId: usuarioId || null }
  );
  if (cambio) {
    // destino nuevo: se vuelve a vincular todo desde cero (lo escrito a mano en ese archivo se respeta)
    await query('UPDATE oc_renglones SET sync_valores = NULL');
    if (actual.fileId !== nuevo.fileId) {
      await query('UPDATE oc_drive_config SET backup_revision_id = NULL, backup_local = NULL, backup_fecha = NULL WHERE id = 1');
    }
  }
  return leerDestino();
}

async function pausar(activo, usuarioId) {
  const r = await query('UPDATE oc_drive_config SET activo = :activo, actualizado_por = :usuarioId WHERE id = 1', { activo: activo ? 1 : 0, usuarioId: usuarioId || null });
  if (!r.affectedRows) throw httpError(400, 'Primero guardá un destino');
}

function nombrePestana(destino, orden) {
  if (destino.modo === 'fija') return destino.pestanaFija;
  const anio = String(orden.oc).split('/')[1] || String(new Date().getFullYear());
  return `${destino.prefijo}${anio}`;
}

// --- Google ---
function claveConfigurada() {
  const { keyFile } = config.ordenesCompraDrive;
  return Boolean(keyFile && fs.existsSync(keyFile));
}

function google() {
  if (googleCache) return googleCache;
  const { keyFile } = config.ordenesCompraDrive;
  if (!keyFile || !fs.existsSync(keyFile)) throw httpError(400, `No se encuentra el archivo de clave de Google: ${keyFile || '(OC_GOOGLE_KEY_FILE vacío)'}`);
  const { sheets, auth } = require('@googleapis/sheets');
  const { drive } = require('@googleapis/drive');
  const googleAuth = new auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  });
  googleCache = { sheets: sheets({ version: 'v4', auth: googleAuth }), drive: drive({ version: 'v3', auth: googleAuth }) };
  return googleCache;
}

function emailRobot() {
  try {
    return JSON.parse(fs.readFileSync(config.ordenesCompraDrive.keyFile, 'utf8')).client_email || null;
  } catch {
    return null;
  }
}

function idDeArchivo(valor) {
  const s = String(valor || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  throw httpError(400, 'Pegá el link del archivo de Drive (el que empieza con https://docs.google.com/...)');
}

function urlArchivo(fileId) {
  return fileId ? `https://docs.google.com/spreadsheets/d/${fileId}/edit` : null;
}

async function listarArchivos() {
  const { drive } = google();
  const r = await drive.files.list({
    q: `(mimeType='${SHEETS_MIME}' or mimeType='${XLSX_MIME}') and trashed=false`,
    fields: 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress))',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return (r.data.files || []).map((f) => ({
    id: f.id,
    nombre: f.name,
    tipo: f.mimeType === SHEETS_MIME ? 'planilla' : 'excel',
    modificado: f.modifiedTime,
    duenio: f.owners?.[0]?.displayName || f.owners?.[0]?.emailAddress || ''
  }));
}

async function inspeccionarArchivo(valor) {
  const fileId = idDeArchivo(valor);
  const { drive } = google();
  const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType,capabilities(canEdit)', supportsAllDrives: true });
  if (![SHEETS_MIME, XLSX_MIME].includes(meta.data.mimeType)) {
    throw httpError(400, `"${meta.data.name}" no es un Excel (.xlsx) ni una Planilla de Google`);
  }
  const api = await abrirCliente(fileId);
  return {
    id: fileId,
    nombre: meta.data.name,
    tipo: api.tipo,
    puedeEditar: Boolean(meta.data.capabilities?.canEdit),
    pestanas: (await api.hojas()).map((h) => h.title),
    url: urlArchivo(fileId)
  };
}

// --- clientes: Planilla de Google (API de Sheets) o .xlsx (se baja, se modifica y se sube) ---
async function abrirCliente(fileId) {
  const { drive } = google();
  const meta = await drive.files.get({ fileId, fields: 'name,mimeType,headRevisionId', supportsAllDrives: true });
  if (meta.data.mimeType === SHEETS_MIME) return clienteSheets(fileId, meta.data.name);
  if (meta.data.mimeType !== XLSX_MIME) throw httpError(400, `El archivo "${meta.data.name}" no es una planilla ni un Excel (.xlsx)`);
  return clienteExcel(fileId, meta.data.name, meta.data.headRevisionId);
}

function dirBackup() {
  const dir = config.ordenesCompraDrive.backupDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function archivoBackupLocal(nombre) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const base = String(nombre || 'archivo').replace(/\.xlsx$/i, '').replace(/[<>:"/\\|?*]/g, '_');
  return path.join(dirBackup(), `BACKUP ${config.envName} ${base} ${stamp}.xlsx`);
}

async function clienteExcel(fileId, nombre, revisionInicial) {
  const { drive } = google();
  const { abrirXlsx } = require('./ordenesCompraXlsx');
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const original = Buffer.from(res.data);
  const libro = await abrirXlsx(original);
  return {
    tipo: 'excel',
    nombre,
    hojas: libro.hojas,
    leer: libro.leer,
    escribir: libro.escribir,
    batchUpdate: libro.batchUpdate,
    // backup del archivo tal como estaba antes de este cambio
    async respaldar() {
      const local = archivoBackupLocal(nombre);
      fs.writeFileSync(local, original);
      try {
        await drive.revisions.update({ fileId, revisionId: revisionInicial, requestBody: { keepForever: true } });
      } catch (err) {
        fs.rmSync(local, { force: true });
        throw err;
      }
      return { revisionId: revisionInicial, local };
    },
    async confirmar() {
      if (!libro.sucio) return;
      // si alguien guardo el Excel mientras tanto, no se pisa: se reintenta en la proxima vuelta
      const ahora = await drive.files.get({ fileId, fields: 'headRevisionId', supportsAllDrives: true });
      if (ahora.data.headRevisionId !== revisionInicial) {
        throw Object.assign(new Error('El Excel se modificó mientras se sincronizaba; se reintenta en un minuto'), { reintentar: true });
      }
      const { Readable } = require('stream');
      await drive.files.update({ fileId, supportsAllDrives: true, media: { mimeType: XLSX_MIME, body: Readable.from(await libro.aBuffer()) } });
    }
  };
}

function clienteSheets(fileId, nombre) {
  const { sheets: api, drive } = google();
  return {
    tipo: 'planilla',
    nombre,
    async hojas() {
      const r = await api.spreadsheets.get({ spreadsheetId: fileId, fields: 'sheets.properties' });
      return r.data.sheets.map((s) => s.properties);
    },
    async batchUpdate(requests) {
      if (!requests.length) return;
      await api.spreadsheets.batchUpdate({ spreadsheetId: fileId, requestBody: { requests } });
    },
    async leer(range) {
      const r = await api.spreadsheets.values.get({ spreadsheetId: fileId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
      return r.data.values || [];
    },
    async escribir(data) {
      if (!data.length) return;
      await api.spreadsheets.values.batchUpdate({ spreadsheetId: fileId, requestBody: { valueInputOption: 'USER_ENTERED', data } });
    },
    // una Planilla de Google guarda sola su historial de versiones; ademas se exporta a .xlsx en el servidor
    async respaldar() {
      const res = await drive.files.export({ fileId, mimeType: XLSX_MIME }, { responseType: 'arraybuffer' });
      const local = archivoBackupLocal(nombre);
      fs.writeFileSync(local, Buffer.from(res.data));
      return { revisionId: null, local };
    }
  };
}

// --- normalizacion de los valores de carga ---
function vacio(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function normalizar(vals) {
  const entregadaNum = vacio(vals.entregada) ? null : Number(String(vals.entregada).replace(/\./g, '').replace(',', '.'));
  const completo = vacio(vals.completo) ? null : String(vals.completo).trim().toUpperCase();
  return {
    entregada: Number.isInteger(entregadaNum) && entregadaNum >= 0 ? entregadaNum : null,
    completo: ['SI', 'NO'].includes(completo) ? completo : null,
    nroIngreso: vacio(vals.nroIngreso) ? null : String(vals.nroIngreso).trim().slice(0, 120),
    observacion: vacio(vals.observacion) ? null : String(vals.observacion).trim().slice(0, 500)
  };
}

function iguales(a, b) {
  return CAMPOS.every((c) => (a?.[c] ?? null) === (b?.[c] ?? null));
}

function valoresDeFila(row) {
  return normalizar({
    entregada: row[COL.entregada],
    completo: row[COL.completo],
    nroIngreso: row[COL.nroIngreso],
    observacion: row[COL.observacion]
  });
}

function rango(pestana, a1) {
  return `'${pestana.replace(/'/g, "''")}'!${a1}`;
}

function numeroOc(texto) {
  const m = String(texto ?? '').match(/(\d+)\s*\/\s*(\d{4})/);
  return m ? `${Number(m[1])}/${m[2]}` : null;
}

// --- formato ---
function pedidosFormatoInicial(sheetId) {
  const solid = (r, g, b) => ({ red: r / 255, green: g / 255, blue: b / 255 });
  const r = (c0, c1, r0 = 1) => ({ sheetId, startRowIndex: r0, startColumnIndex: c0, endColumnIndex: c1 });
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 13 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { backgroundColor: solid(51, 204, 51) } },
        fields: 'userEnteredFormat.backgroundColor'
      }
    },
    ...WIDTHS.map((px, i) => ({
      updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' }
    })),
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
    // texto plano: que el N° de ingreso o las fechas no se conviertan en numeros/fechas
    ...[[0, 2], [3, 5], [9, 11]].map(([c0, c1]) => ({
      repeatCell: { range: r(c0, c1), cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' }
    })),
    {
      addConditionalFormatRule: {
        index: 0,
        rule: { ranges: [r(2, 11)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$I2="SI"' }] }, format: { backgroundColor: solid(51, 204, 51) } } }
      }
    },
    {
      addConditionalFormatRule: {
        index: 1,
        rule: { ranges: [r(2, 11)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($G2<>"",$H2>0)' }] }, format: { backgroundColor: solid(255, 235, 132) } } }
      }
    },
    {
      addConditionalFormatRule: {
        index: 2,
        rule: { ranges: [r(11, 12)], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'COMPLETA' }] }, format: { backgroundColor: solid(51, 204, 51), textFormat: { bold: true, foregroundColor: solid(255, 255, 255) } } } }
      }
    },
    {
      addConditionalFormatRule: {
        index: 3,
        rule: { ranges: [r(11, 12)], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'INCOMPLETA' }] }, format: { backgroundColor: solid(255, 107, 107), textFormat: { bold: true, foregroundColor: solid(255, 255, 255) } } } }
      }
    }
  ];
}

function pedidosBloque(sheetId, r0, r1) {
  // r0/r1: filas 1-based inclusive del bloque de una O.C.
  const thin = { style: 'SOLID', width: 1 };
  const reqs = [{
    updateBorders: {
      range: { sheetId, startRowIndex: r0 - 1, endRowIndex: r1, startColumnIndex: 0, endColumnIndex: 12 },
      top: thin, left: thin, right: thin, innerHorizontal: thin, innerVertical: thin,
      bottom: { style: 'SOLID_MEDIUM', width: 2 }
    }
  }, {
    repeatCell: {
      range: { sheetId, startRowIndex: r0 - 1, endRowIndex: r1, startColumnIndex: 0, endColumnIndex: 12 },
      cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat.verticalAlignment'
    }
  }, {
    // desplegable SI/NO en COMPLETO (en filas que ya existian no se toca el formato)
    setDataValidation: {
      range: { sheetId, startRowIndex: r0 - 1, endRowIndex: r1, startColumnIndex: 8, endColumnIndex: 9 },
      rule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'SI' }, { userEnteredValue: 'NO' }] }, showCustomUi: true, strict: false }
    }
  }];
  if (r1 > r0) {
    for (const c of [0, 1, 11]) {
      reqs.push({ mergeCells: { range: { sheetId, startRowIndex: r0 - 1, endRowIndex: r1, startColumnIndex: c, endColumnIndex: c + 1 }, mergeType: 'MERGE_ALL' } });
    }
  }
  return reqs;
}

async function snapshots() {
  const rows = await query('SELECT id, sync_valores FROM oc_renglones');
  const map = new Map();
  for (const r of rows) {
    let v = r.sync_valores;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { v = null; }
    }
    map.set(r.id, v || null);
  }
  return map;
}

async function guardarSnapshot(id, vals) {
  await query('UPDATE oc_renglones SET sync_valores = CAST(:v AS JSON) WHERE id = :id', { id, v: JSON.stringify(vals) });
}

// --- plan por pestaña (no escribe nada) ---
async function planificarPestana(api, hojas, pestana, ordenes, snaps) {
  const props = hojas.find((h) => h.title === pestana) || null;
  const filas = props ? await api.leer(rango(pestana, 'A1:M')) : [];
  const fila1 = filas[0] || [];
  const plan = {
    pestana,
    props,
    crear: !props,
    encabezado: vacio(fila1[0]) ? 'completo' : vacio(fila1[COL.id]) ? 'id' : null,
    escrituras: [],
    nuevas: [],
    bloques: [],
    enBase: [],
    snapsNuevas: [],
    ultimaFila: 0,
    resumen: { pestana, crear: !props, agregadas: 0, vinculadas: 0, haciaPlanilla: 0, haciaBase: 0 }
  };
  const { resumen } = plan;
  const porId = new Map();
  const porClave = new Map();
  for (const o of ordenes) {
    for (const r of o.renglones) {
      porId.set(r.id, { orden: o, renglon: r });
      porClave.set(`${numeroOc(o.oc)}#${r.renglon}`, r.id);
    }
  }

  // 1) ubicar cada renglon: por ID (col M) y, para filas escritas a mano, por N° de O.C. (col B) + renglon (col C)
  const filaDeId = new Map();
  for (let i = 1; i < filas.length; i += 1) {
    const id = Number((filas[i] || [])[COL.id]);
    if (id && porId.has(id) && !filaDeId.has(id)) filaDeId.set(id, i + 1);
  }
  let ocActual = null;
  for (let i = 1; i < filas.length; i += 1) {
    const row = filas[i] || [];
    // la col B esta combinada por O.C.: vale para las filas de abajo hasta la proxima O.C.
    if (!vacio(row[1])) ocActual = numeroOc(row[1]);
    const id = Number(row[COL.id]);
    if (id && porId.has(id)) continue;
    const ren = Number(row[2]);
    if (!ocActual || !Number.isInteger(ren) || ren <= 0) continue;
    const idClave = porClave.get(`${ocActual}#${ren}`);
    if (!idClave || filaDeId.has(idClave)) continue;
    filaDeId.set(idClave, i + 1);
    plan.escrituras.push({ range: rango(pestana, `M${i + 1}`), values: [[idClave]] });
    resumen.vinculadas += 1;
  }

  // 2) columnas de carga: se copia el lado que cambio desde la ultima sincronizacion
  for (const [id, fila] of filaDeId) {
    const hojaVals = valoresDeFila(filas[fila - 1] || []);
    const base = normalizar(porId.get(id).renglon);
    const snap = snaps.get(id);
    if (iguales(hojaVals, base)) {
      if (!iguales(snap, base)) plan.enBase.push(() => guardarSnapshot(id, base));
      continue;
    }
    const cambioHoja = !snap || !iguales(hojaVals, snap);
    const hojaVacia = CAMPOS.every((c) => hojaVals[c] === null);
    if (cambioHoja && !(snap === null && hojaVacia)) {
      plan.enBase.push(() => query(
        `UPDATE oc_renglones SET cantidad_entregada = :entregada, completo = :completo, nro_ingreso = :nroIngreso,
           observacion = :observacion, sync_valores = CAST(:v AS JSON) WHERE id = :id`,
        { ...hojaVals, id, v: JSON.stringify(hojaVals) }
      ));
      resumen.haciaBase += 1;
    } else {
      plan.escrituras.push(...CAMPOS.map((c) => ({ range: rango(pestana, `${LETRA[c]}${fila}`), values: [[base[c] ?? '']] })));
      plan.enBase.push(() => guardarSnapshot(id, base));
      resumen.haciaPlanilla += 1;
    }
  }

  // 3) renglones que no estan en la pestaña: se agregan al final, agrupados por O.C.
  let proxima = Math.max(filas.length, 1) + 1;
  for (const o of ordenes) {
    const faltan = o.renglones.filter((r) => !filaDeId.has(r.id));
    if (!faltan.length) continue;
    const r0 = proxima;
    const r1 = r0 + faltan.length - 1;
    faltan.forEach((r, k) => {
      const fila = r0 + k;
      const vals = normalizar(r);
      plan.nuevas.push({
        range: rango(pestana, `A${fila}:M${fila}`),
        values: [[
          k === 0 ? o.vence : '', k === 0 ? `${o.oc} ${o.proveedor}` : '', r.renglon, r.codigo, r.descripcion, r.cantidad,
          vals.entregada ?? '', `=IF(G${fila}="",F${fila},F${fila}-G${fila})`, vals.completo ?? '', vals.nroIngreso ?? '', vals.observacion ?? '',
          k === 0 ? `=IF(COUNTIF(I${r0}:I${r1},"SI")=${faltan.length},"COMPLETA","INCOMPLETA")` : '', r.id
        ]]
      });
      plan.snapsNuevas.push([r.id, vals]);
    });
    plan.bloques.push([r0, r1]);
    proxima = r1 + 1;
    resumen.agregadas += faltan.length;
  }
  plan.ultimaFila = proxima - 1;
  plan.escribe = plan.crear || Boolean(plan.encabezado) || plan.escrituras.length > 0 || plan.nuevas.length > 0;
  return plan;
}

async function planificar(api, destino) {
  const ordenes = await listarOrdenes();
  const grupos = new Map();
  for (const o of ordenes) {
    const p = nombrePestana(destino, o);
    if (!grupos.has(p)) grupos.set(p, []);
    grupos.get(p).push(o);
  }
  const hojas = await api.hojas();
  const snaps = await snapshots();
  const planes = [];
  for (const [pestana, lista] of grupos) planes.push(await planificarPestana(api, hojas, pestana, lista, snaps));
  return planes;
}

// --- escribir el plan ---
async function aplicarPestana(api, plan) {
  let props = plan.props;
  if (plan.crear) {
    await api.batchUpdate([{ addSheet: { properties: { title: plan.pestana } } }]);
    props = (await api.hojas()).find((h) => h.title === plan.pestana);
  }
  const sheetId = props.sheetId;
  if (plan.encabezado === 'completo') {
    await api.escribir([{ range: rango(plan.pestana, 'A1:M1'), values: [HEADERS] }]);
    await api.batchUpdate(pedidosFormatoInicial(sheetId));
  } else if (plan.encabezado === 'id') {
    await api.escribir([{ range: rango(plan.pestana, 'M1'), values: [['ID']] }]);
    await api.batchUpdate([{
      updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' }
    }]);
  }
  const necesarias = plan.ultimaFila - (props.gridProperties?.rowCount || 1000);
  if (plan.nuevas.length && necesarias > 0) {
    await api.batchUpdate([{ appendDimension: { sheetId, dimension: 'ROWS', length: necesarias + 50 } }]);
  }
  await api.escribir([...plan.escrituras, ...plan.nuevas]);
  await api.batchUpdate(plan.bloques.flatMap(([r0, r1]) => pedidosBloque(sheetId, r0, r1)));
}

async function descartarBackup(backup, nuevo, fileId) {
  if (!backup) return;
  if (backup.local && backup.local !== nuevo?.local) fs.rmSync(backup.local, { force: true });
  if (backup.revisionId && backup.revisionId !== nuevo?.revisionId) {
    try {
      await google().drive.revisions.update({ fileId, revisionId: backup.revisionId, requestBody: { keepForever: false } });
    } catch {
      // la version vieja pudo haber sido borrada a mano en Drive: no importa
    }
  }
}

async function registrarBackup(backup) {
  await query(
    'UPDATE oc_drive_config SET backup_revision_id = :revisionId, backup_local = :local, backup_fecha = NOW() WHERE id = 1',
    { revisionId: backup.revisionId, local: backup.local }
  );
}

async function sincronizarCon(api, destino, { usuarioId = null } = {}) {
  const planes = await planificar(api, destino);
  const total = { agregadas: 0, vinculadas: 0, haciaPlanilla: 0, haciaBase: 0, pestanas: planes.map((p) => p.resumen) };
  for (const p of planes) for (const k of ['agregadas', 'vinculadas', 'haciaPlanilla', 'haciaBase']) total[k] += p.resumen[k];

  const escribe = planes.some((p) => p.escribe);
  let backup = null;
  if (escribe) {
    backup = await api.respaldar();
    try {
      for (const plan of planes) if (plan.escribe) await aplicarPestana(api, plan);
      if (api.confirmar) await api.confirmar();
    } catch (err) {
      // la escritura no se completo: se descarta el backup recien hecho y se conserva el anterior
      await descartarBackup(backup, destino.backup, destino.fileId);
      throw err;
    }
  }
  // recien con el archivo guardado se actualiza la base
  for (const plan of planes) {
    for (const fn of plan.enBase) await fn();
    for (const [id, vals] of plan.snapsNuevas) await guardarSnapshot(id, vals);
  }
  if (backup) {
    await descartarBackup(destino.backup, backup, destino.fileId);
    await registrarBackup(backup);
  }
  if (escribe || total.haciaBase) {
    await query(
      `INSERT INTO oc_drive_historial (file_id, file_nombre, accion, resumen, backup_revision_id, backup_local, usuario_id)
       VALUES (:fileId, :nombre, 'sincronizar', CAST(:resumen AS JSON), :rev, :local, :usuarioId)`,
      { fileId: destino.fileId, nombre: api.nombre || destino.fileNombre, resumen: JSON.stringify(total), rev: backup?.revisionId || null, local: backup?.local || null, usuarioId }
    );
  }
  return total;
}

// Una sola sincronizacion a la vez; si se pide otra mientras corre, se repite al terminar
async function sincronizar({ api, manual = false, usuarioId = null } = {}) {
  const destino = await leerDestino();
  if (!destino.fileId) return { omitida: true, motivo: 'Todavía no se eligió el archivo de Drive' };
  if (!destino.activo && !manual) return { omitida: true, motivo: 'La sincronización está en pausa' };
  if (!api && !claveConfigurada()) return { omitida: true, motivo: 'Falta la clave de Google en el servidor (OC_GOOGLE_KEY_FILE)' };
  if (estado.enCurso) {
    pendiente = true;
    return { enCola: true };
  }
  estado.enCurso = true;
  try {
    do {
      pendiente = false;
      const d = await leerDestino();
      estado.resumen = await sincronizarCon(api || await abrirCliente(d.fileId), d, { usuarioId });
      estado.ultimoError = null;
      estado.ultimaSync = new Date().toISOString();
    } while (pendiente);
    return estado.resumen;
  } catch (err) {
    estado.ultimoError = traducirError(err);
    if (!err.reintentar) googleCache = null;
    throw Object.assign(new Error(estado.ultimoError), { status: err.status || 502 });
  } finally {
    estado.enCurso = false;
  }
}

// Simulacion: que pasaria con un destino, sin escribir nada
async function probarDestino(datos) {
  const d = validarDestino(datos);
  const actual = await leerDestino();
  const api = await abrirCliente(d.fileId);
  const planes = await planificar(api, { ...actual, ...d });
  return { archivo: api.nombre, tipo: api.tipo, pestanas: planes.map((p) => p.resumen) };
}

// Vuelve el archivo a como estaba antes del ultimo cambio. Lo actual queda como backup (se puede deshacer)
// y la sincronizacion queda en pausa para revisar.
async function restaurarBackup(usuarioId) {
  const destino = await leerDestino();
  if (!destino.backup) throw httpError(400, 'Todavía no hay backup para restaurar');
  if (estado.enCurso) throw httpError(409, 'Hay una sincronización en curso; probá de nuevo en unos segundos');
  const api = await abrirCliente(destino.fileId);
  if (api.tipo !== 'excel') {
    throw httpError(400, `Una Planilla de Google se restaura desde Archivo → Historial de versiones. Copia en el servidor: ${destino.backup.local}`);
  }
  const { drive } = google();
  let contenido;
  try {
    const r = await drive.revisions.get({ fileId: destino.fileId, revisionId: destino.backup.revisionId, alt: 'media' }, { responseType: 'arraybuffer' });
    contenido = Buffer.from(r.data);
  } catch {
    if (!destino.backup.local || !fs.existsSync(destino.backup.local)) throw httpError(404, 'No se encontró el backup ni en Drive ni en el servidor');
    contenido = fs.readFileSync(destino.backup.local);
  }
  estado.enCurso = true;
  try {
    const nuevoBackup = await api.respaldar();
    const { Readable } = require('stream');
    await drive.files.update({ fileId: destino.fileId, supportsAllDrives: true, media: { mimeType: XLSX_MIME, body: Readable.from(contenido) } });
    await descartarBackup(destino.backup, nuevoBackup, destino.fileId);
    await registrarBackup(nuevoBackup);
    await query('UPDATE oc_drive_config SET activo = 0 WHERE id = 1');
    await query(
      `INSERT INTO oc_drive_historial (file_id, file_nombre, accion, resumen, backup_revision_id, backup_local, usuario_id)
       VALUES (:fileId, :nombre, 'restaurar', NULL, :rev, :local, :usuarioId)`,
      { fileId: destino.fileId, nombre: api.nombre, rev: nuevoBackup.revisionId, local: nuevoBackup.local, usuarioId: usuarioId || null }
    );
  } finally {
    estado.enCurso = false;
  }
}

function traducirError(err) {
  if (err.status && err.status < 500 && !err.response) return err.message;
  const msg = err?.response?.data?.error?.message || err.message || String(err);
  const code = err?.response?.status || err.code;
  if (err.reintentar) return err.message;
  if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) {
    const api = /drive/i.test(msg) ? 'Google Drive API' : 'Google Sheets API';
    return `Falta habilitar ${api} en el proyecto de Google Cloud (APIs y servicios → Biblioteca).`;
  }
  if (/storageQuotaExceeded|quota/i.test(msg) && /storage/i.test(msg)) return 'Google no tiene espacio para guardar el archivo (cuota de almacenamiento).';
  if (code === 403 || /permission|caller does not have/i.test(msg)) {
    return 'Google rechazó el acceso: compartí el archivo con el mail del robot como Editor.';
  }
  if (code === 404 || /not found/i.test(msg)) return 'No se encontró el archivo en Drive (¿se borró o se dejó de compartir?).';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(msg)) return 'Sin conexión con Google desde el servidor.';
  return `Error con Google Drive: ${msg}`;
}

// Para despues de una carga o una edicion: no hace esperar a la pagina
function sincronizarEnSegundoPlano() {
  if (!claveConfigurada()) return;
  sincronizar().catch((err) => console.warn('[oc-drive]', err.message));
}

async function estadoDrive() {
  const destino = await leerDestino();
  const historial = await query(
    `SELECT h.id, h.created_at, h.accion, h.file_nombre, h.resumen, h.backup_local, u.username
     FROM oc_drive_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id
     ORDER BY h.id DESC LIMIT 15`
  );
  return {
    claveConfigurada: claveConfigurada(),
    robot: emailRobot(),
    destino: { ...destino, url: urlArchivo(destino.fileId) },
    ...estado,
    historial: historial.map((h) => ({
      id: h.id,
      fecha: h.created_at,
      accion: h.accion,
      archivo: h.file_nombre,
      resumen: typeof h.resumen === 'string' ? JSON.parse(h.resumen) : h.resumen,
      backupLocal: h.backup_local,
      usuario: h.username || 'automático'
    }))
  };
}

function iniciarSincronizacionDrive() {
  if (!claveConfigurada()) {
    console.log('[oc-drive] sin clave de Google (OC_GOOGLE_KEY_FILE): sincronización con Drive apagada');
    return;
  }
  const { intervalMs } = config.ordenesCompraDrive;
  console.log(`[oc-drive] activo · cada ${Math.round(intervalMs / 1000)}s · backups en ${config.ordenesCompraDrive.backupDir}`);
  setTimeout(sincronizarEnSegundoPlano, 10000);
  setInterval(sincronizarEnSegundoPlano, intervalMs);
}

module.exports = {
  sincronizar,
  sincronizarEnSegundoPlano,
  estadoDrive,
  iniciarSincronizacionDrive,
  listarArchivos,
  inspeccionarArchivo,
  probarDestino,
  guardarDestino,
  pausar,
  restaurarBackup,
  normalizar
};
