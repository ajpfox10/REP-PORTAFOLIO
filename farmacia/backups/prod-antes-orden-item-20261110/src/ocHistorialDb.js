const fs = require('fs');
const XLSX = require('xlsx');
const config = require('./config');
const { query, transaction } = require('./db');

// Historial de Ordenes de Compra leido de la planilla de Drive (una pestaña por año: "O.C 2025",
// "O.C 2026"...). Solo LECTURA: el archivo no se modifica. Sirve para comparar lo pedido en los
// requerimientos con lo comprado en cada semestre. El semestre sale de la fecha de vencimiento
// de la O.C.: enero-junio = 1er semestre, julio-diciembre = 2do.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';

async function ensureOcHistorialTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS oc_historial (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pestana VARCHAR(100) NOT NULL,
      fila INT NOT NULL,
      oc_numero VARCHAR(20) NULL,
      oc_texto VARCHAR(255) NULL,
      proveedor VARCHAR(255) NULL,
      vencimiento DATE NULL,
      anio INT NULL,
      semestre TINYINT NULL,
      renglon VARCHAR(20) NULL,
      codigo VARCHAR(40) NOT NULL,
      descripcion TEXT NULL,
      cantidad DECIMAL(14,2) NULL,
      entregada DECIMAL(14,2) NULL,
      completo VARCHAR(20) NULL,
      INDEX idx_oc_historial_codigo (codigo),
      INDEX idx_oc_historial_periodo (anio, semestre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Renglones de O.C. con codigo no valido (99994, MISON093...) atados a mano a un codigo de producto.
  // La clave es codigo + descripcion de la planilla, asi se mantiene al volver a leer Drive.
  // codigo_destino = 'NINGUNO' marca que no corresponde a ningun producto pedido.
  await query(`
    CREATE TABLE IF NOT EXISTS oc_historial_vinculos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo_origen VARCHAR(40) NOT NULL,
      descripcion_clave VARCHAR(255) NOT NULL,
      codigo_destino VARCHAR(40) NOT NULL,
      usuario_id INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_oc_historial_vinculo (codigo_origen, descripcion_clave)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS oc_historial_importaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id VARCHAR(120) NOT NULL,
      file_nombre VARCHAR(255) NULL,
      modificado_drive DATETIME NULL,
      pestanas VARCHAR(255) NULL,
      renglones INT NOT NULL DEFAULT 0,
      usuario_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Archivo a leer: OC_HISTORIAL_FILE_ID del .env o, si no hay, el destino de Drive configurado en O.C.
async function archivoHistorial() {
  if (config.ocHistorialFileId) return config.ocHistorialFileId;
  const [row] = await query('SELECT file_id FROM oc_drive_config WHERE id = 1').catch(() => []);
  return row?.file_id || null;
}

function driveSoloLectura() {
  const { keyFile } = config.ordenesCompraDrive;
  if (!keyFile || !fs.existsSync(keyFile)) throw Object.assign(new Error('No está configurada la clave de Google (OC_GOOGLE_KEY_FILE)'), { status: 400 });
  const { auth } = require('@googleapis/sheets');
  const { drive } = require('@googleapis/drive');
  const googleAuth = new auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  return drive({ version: 'v3', auth: googleAuth });
}

function numeroOrNull(value) {
  if (value === '' || value == null) return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function limpiar(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// "O.C 141/2025   SUIZO ARGENTINA S.A" -> { numero: '141/2025', proveedor: 'SUIZO ARGENTINA S.A' }
function partirOc(texto) {
  const t = limpiar(texto);
  // El año puede venir con 2 digitos: "117/26 DNM FARMA"
  const m = /(\d+)\s*\/\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  if (!m) return { numero: null, proveedor: t || null };
  const anio = m[2].length === 2 ? `20${m[2]}` : m[2];
  const proveedor = limpiar(t.slice(m.index + m[0].length).replace(/^[\s|\-–]+/, '').replace(/\|+$/, ''));
  return { numero: `${m[1]}/${anio}`, proveedor: proveedor || null };
}

function parsePlanilla(buffer) {
  const wb = XLSX.read(buffer, { cellDates: true });
  const pestanas = wb.SheetNames.filter((n) => /^O\.?\s*C/i.test(n.trim()));
  const filas = [];
  for (const pestana of pestanas) {
    const anioPestana = Number((/(\d{4})/.exec(pestana) || [])[1]) || null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[pestana], { header: 1, defval: '' });
    let oc = { numero: null, proveedor: null, texto: null };
    let vencimiento = null;
    rows.slice(1).forEach((r, idx) => {
      // La fecha y el N° de O.C. figuran solo en el primer renglon de cada O.C.
      if (limpiar(r[1])) {
        oc = { ...partirOc(r[1]), texto: limpiar(r[1]) };
        vencimiento = r[0] instanceof Date ? r[0] : null;
      } else if (r[0] instanceof Date) {
        vencimiento = r[0];
      }
      const codigo = limpiar(r[3]).toUpperCase();
      if (!codigo) return;
      const anio = vencimiento ? vencimiento.getFullYear() : anioPestana;
      filas.push({
        pestana,
        fila: idx + 2,
        ocNumero: oc.numero,
        ocTexto: oc.texto,
        proveedor: oc.proveedor,
        vencimiento: vencimiento
          ? `${vencimiento.getFullYear()}-${String(vencimiento.getMonth() + 1).padStart(2, '0')}-${String(vencimiento.getDate()).padStart(2, '0')}`
          : null,
        anio,
        semestre: vencimiento ? (vencimiento.getMonth() < 6 ? 1 : 2) : null,
        renglon: limpiar(r[2]) || null,
        codigo,
        descripcion: limpiar(r[4]) || null,
        cantidad: numeroOrNull(r[5]),
        entregada: numeroOrNull(r[6]),
        completo: limpiar(r[8]).toUpperCase() || null
      });
    });
  }
  return { pestanas, filas };
}

// Lee la planilla de Drive y reemplaza todo el historial (la planilla es la fuente)
async function importarDesdeDrive(usuarioId = null) {
  const fileId = await archivoHistorial();
  if (!fileId) throw Object.assign(new Error('No hay archivo de Drive configurado para el historial de O.C. (OC_HISTORIAL_FILE_ID)'), { status: 400 });
  const drive = driveSoloLectura();
  const meta = await drive.files.get({ fileId, fields: 'name,mimeType,modifiedTime', supportsAllDrives: true });
  const res = meta.data.mimeType === SHEETS_MIME
    ? await drive.files.export({ fileId, mimeType: XLSX_MIME }, { responseType: 'arraybuffer' })
    : await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const { pestanas, filas } = parsePlanilla(Buffer.from(res.data));
  if (!filas.length) throw Object.assign(new Error(`No se encontraron renglones en las pestañas O.C de "${meta.data.name}"`), { status: 400 });

  await transaction(async (conn) => {
    await conn.execute('DELETE FROM oc_historial');
    for (const f of filas) {
      await conn.execute(
        `INSERT INTO oc_historial
          (pestana, fila, oc_numero, oc_texto, proveedor, vencimiento, anio, semestre, renglon, codigo, descripcion, cantidad, entregada, completo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.pestana, f.fila, f.ocNumero, f.ocTexto, f.proveedor, f.vencimiento, f.anio, f.semestre, f.renglon, f.codigo,
          f.descripcion, f.cantidad, f.entregada, f.completo]
      );
    }
    await conn.execute(
      `INSERT INTO oc_historial_importaciones (file_id, file_nombre, modificado_drive, pestanas, renglones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fileId, meta.data.name, meta.data.modifiedTime ? new Date(meta.data.modifiedTime) : null, pestanas.join(', '), filas.length, usuarioId]
    );
  });
  return { archivo: meta.data.name, pestanas, renglones: filas.length };
}

function claveDescripcion(descripcion) {
  return String(descripcion || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/\s+/g, ' ').trim().slice(0, 255);
}

async function guardarVinculo(codigoOrigen, descripcion, codigoDestino, usuarioId) {
  const origen = String(codigoOrigen || '').trim().toUpperCase();
  const clave = claveDescripcion(descripcion);
  if (!origen || !clave) throw Object.assign(new Error('Falta el código o la descripción del renglón'), { status: 400 });
  const destino = String(codigoDestino || '').trim().toUpperCase();
  if (!destino) {
    await query('DELETE FROM oc_historial_vinculos WHERE codigo_origen = :origen AND descripcion_clave = :clave', { origen, clave });
    return { borrado: true };
  }
  await query(
    `INSERT INTO oc_historial_vinculos (codigo_origen, descripcion_clave, codigo_destino, usuario_id)
     VALUES (:origen, :clave, :destino, :usuarioId)
     ON DUPLICATE KEY UPDATE codigo_destino = VALUES(codigo_destino), usuario_id = VALUES(usuario_id)`,
    { origen, clave, destino, usuarioId: usuarioId || null }
  );
  return { origen, clave, destino };
}

async function historial() {
  const [ultima] = await query(`
    SELECT file_nombre, modificado_drive, pestanas, renglones, created_at
    FROM oc_historial_importaciones ORDER BY id DESC LIMIT 1
  `);
  const filas = await query(`
    SELECT id, pestana, fila, oc_numero, oc_texto, proveedor, vencimiento, anio, semestre, renglon, codigo, descripcion,
           cantidad, entregada, completo
    FROM oc_historial
    ORDER BY anio, semestre, oc_numero, fila
  `);
  const vinculos = await query('SELECT codigo_origen, descripcion_clave, codigo_destino FROM oc_historial_vinculos');
  return { importacion: ultima || null, filas, vinculos };
}

function iniciarImportacionHistorial() {
  // Primera lectura al arrancar si la tabla esta vacia; despues, a mano desde la pagina
  setTimeout(async () => {
    try {
      const [row] = await query('SELECT COUNT(*) n FROM oc_historial');
      if (row.n) return;
      const r = await importarDesdeDrive(null);
      console.log(`[oc-historial] importado "${r.archivo}": ${r.renglones} renglones (${r.pestanas.join(', ')})`);
    } catch (err) {
      console.warn('[oc-historial] no se pudo importar:', err.message);
    }
  }, 10000);
}

module.exports = { ensureOcHistorialTables, importarDesdeDrive, historial, iniciarImportacionHistorial, parsePlanilla, guardarVinculo };
