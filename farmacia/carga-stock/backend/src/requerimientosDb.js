const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query, transaction } = require('./db');
const config = require('./config');
const { audit } = require('./audit');
const { parseRequerimientoPdf } = require('./requerimientoReportParser');

// Tablas del Analisis de Requerimiento Anual. Se crean al arrancar el backend (y en migrate.js).
async function ensureRequerimientoTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_importaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      archivo_nombre VARCHAR(255) NOT NULL,
      archivo_hash CHAR(64) NOT NULL,
      numero VARCHAR(20) NOT NULL,
      anio_numero INT NOT NULL,
      fuente VARCHAR(160) NULL,
      hospital VARCHAR(255) NULL,
      estado VARCHAR(60) NULL,
      tipo_contratacion VARCHAR(120) NULL,
      servicio VARCHAR(120) NULL,
      fecha DATE NULL,
      periodo_desde DATE NULL,
      periodo_hasta DATE NULL,
      total_items INT NOT NULL DEFAULT 0,
      total_declarado DECIMAL(16,2) NULL,
      total_calculado DECIMAL(16,2) NULL,
      creado_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_requerimiento_hash (archivo_hash),
      UNIQUE KEY uq_requerimiento_numero (numero, anio_numero),
      CONSTRAINT fk_requerimiento_importaciones_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      importacion_id INT NOT NULL,
      item_nro INT NOT NULL,
      cantidad DECIMAL(14,2) NOT NULL DEFAULT 0,
      stock DECIMAL(14,2) NULL,
      codigo VARCHAR(20) NOT NULL,
      codigo_sigaf VARCHAR(20) NULL,
      descripcion TEXT NOT NULL,
      descripcion_especifica TEXT NULL,
      droga VARCHAR(255) NOT NULL,
      droga_clave VARCHAR(255) NOT NULL,
      muestra VARCHAR(10) NULL,
      imputacion VARCHAR(20) NULL,
      justiprecio DECIMAL(14,2) NULL,
      estado VARCHAR(40) NULL,
      total DECIMAL(16,2) NULL,
      UNIQUE KEY uq_requerimiento_item (importacion_id, item_nro),
      INDEX idx_requerimiento_items_codigo (codigo),
      INDEX idx_requerimiento_items_droga (droga_clave),
      CONSTRAINT fk_requerimiento_items_importacion FOREIGN KEY (importacion_id) REFERENCES requerimiento_importaciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Hoja del PDF donde esta cada item. Si la columna es nueva, los PDF ya cargados
  // se vuelven a leer en el proximo sondeo para completarla.
  const hojaCol = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requerimiento_items' AND COLUMN_NAME = 'hoja'
  `);
  if (!hojaCol.length) {
    await query('ALTER TABLE requerimiento_items ADD COLUMN hoja INT NULL AFTER item_nro');
    await query('ALTER TABLE requerimiento_importaciones ADD COLUMN total_hojas INT NULL AFTER total_items');
    reimportarConocidos = true;
  }
  // Carpeta de los PDF elegida desde la pagina (una sola fila)
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_config (
      id TINYINT PRIMARY KEY,
      carpeta VARCHAR(500) NULL,
      actualizado_por INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const rows = await query('SELECT carpeta FROM requerimiento_config WHERE id = 1');
  if (rows[0]?.carpeta) carpetaActual = rows[0].carpeta;
}

// true cuando hay que volver a leer los PDF ya cargados (cambio de estructura de la tabla)
let reimportarConocidos = false;

// Carpeta vigente: la elegida en la pagina o, si no hay, la de config (.env)
let carpetaActual = config.requerimientoSourceDir;

function carpetaRequerimientos() {
  return carpetaActual;
}

async function cambiarCarpeta(ruta, usuarioId) {
  await query(
    `INSERT INTO requerimiento_config (id, carpeta, actualizado_por) VALUES (1, :ruta, :usuarioId)
     ON DUPLICATE KEY UPDATE carpeta = VALUES(carpeta), actualizado_por = VALUES(actualizado_por)`,
    { ruta, usuarioId }
  );
  carpetaActual = ruta;
  hashesFallidos.clear();
  await audit(usuarioId, 'cambiar_carpeta_requerimiento', 'requerimiento_config', 1, { carpeta: ruta });
  return sondearRequerimientos();
}

function hashArchivo(fullPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
}

function listarPdfs() {
  const dir = carpetaActual;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

// Importa un PDF de la carpeta. Si ya hay una carga del mismo requerimiento (numero/anio)
// con otro contenido, gana el PDF modificado mas recientemente: el mas nuevo reemplaza al
// cargado, y uno mas viejo se rechaza (asi dos versiones en la carpeta no se pisan en cada sondeo).
async function procesarArchivoRequerimiento(fileName, usuarioId) {
  if (/[\\/]/.test(fileName)) { const e = new Error('Nombre de archivo invalido'); e.status = 400; throw e; }
  const fullPath = path.join(carpetaActual, fileName);
  if (!fs.existsSync(fullPath)) { const e = new Error('Archivo no encontrado'); e.status = 404; throw e; }
  const parsed = await parseRequerimientoPdf(fullPath);
  if (!parsed.numero) { const e = new Error('No se encontro el numero de requerimiento.'); e.status = 400; throw e; }
  if (!parsed.items.length) { const e = new Error('El PDF no tiene items para importar.'); e.status = 400; throw e; }

  const [cargado] = await query(
    'SELECT archivo_nombre, archivo_hash FROM requerimiento_importaciones WHERE numero = :numero AND anio_numero = :anio',
    { numero: parsed.numero, anio: parsed.anioNumero }
  );
  if (cargado && cargado.archivo_hash !== parsed.hash) {
    const pathCargado = path.join(carpetaActual, cargado.archivo_nombre);
    let sigueEnCarpeta = false;
    try { sigueEnCarpeta = hashArchivo(pathCargado) === cargado.archivo_hash; } catch { /* ya no esta */ }
    if (sigueEnCarpeta && fs.statSync(pathCargado).mtimeMs >= fs.statSync(fullPath).mtimeMs) {
      const e = new Error(`Versión más vieja del requerimiento ${parsed.numero}/${parsed.anioNumero}: queda cargado «${cargado.archivo_nombre}», que es más nuevo.`);
      e.status = 409;
      throw e;
    }
  }

  const impId = await transaction(async (conn) => {
    await conn.execute(
      'DELETE FROM requerimiento_importaciones WHERE archivo_hash = ? OR (numero = ? AND anio_numero = ?)',
      [parsed.hash, parsed.numero, parsed.anioNumero]
    );
    const [imp] = await conn.execute(
      `INSERT INTO requerimiento_importaciones
        (archivo_nombre, archivo_hash, numero, anio_numero, fuente, hospital, estado, tipo_contratacion, servicio,
         fecha, periodo_desde, periodo_hasta, total_items, total_hojas, total_declarado, total_calculado, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fileName, parsed.hash, parsed.numero, parsed.anioNumero, parsed.fuente, parsed.hospital, parsed.estado,
        parsed.tipoContratacion, parsed.servicio, parsed.fecha, parsed.periodoDesde, parsed.periodoHasta,
        parsed.items.length, parsed.totalHojas, parsed.totalDeclarado, parsed.totalCalculado, usuarioId]
    );
    for (const it of parsed.items) {
      await conn.execute(
        `INSERT INTO requerimiento_items
          (importacion_id, item_nro, hoja, cantidad, stock, codigo, codigo_sigaf, descripcion, descripcion_especifica,
           droga, droga_clave, muestra, imputacion, justiprecio, estado, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [imp.insertId, it.item, it.hoja, it.cantidad, it.stock, it.codigo, it.sigaf, it.descripcion, it.descripcionEspecifica,
          it.droga, it.drogaClave, it.muestra, it.imputacion, it.justiprecio, it.estado, it.total]
      );
    }
    return imp.insertId;
  });

  await audit(usuarioId, 'importar_requerimiento', 'requerimiento_importaciones', impId, {
    archivo: fileName, numero: `${parsed.numero}/${parsed.anioNumero}`, items: parsed.items.length,
    origen: usuarioId ? 'manual' : 'sondeo'
  });
  return { impId, parsed };
}

// Estado de cada PDF de la carpeta: en tabla, duplicado de otro archivo o pendiente.
async function estadoCarpeta() {
  const rows = await query('SELECT id, archivo_hash, archivo_nombre, numero, anio_numero FROM requerimiento_importaciones');
  const porHash = new Map(rows.map((r) => [r.archivo_hash, r]));
  const vistos = new Map();
  return listarPdfs().map((name) => {
    const fullPath = path.join(carpetaActual, name);
    const stat = fs.statSync(fullPath);
    let hash = null;
    try { hash = hashArchivo(fullPath); } catch { /* en uso */ }
    const imp = hash ? porHash.get(hash) : null;
    const duplicadoDe = hash && vistos.has(hash) ? vistos.get(hash) : null;
    if (hash && !vistos.has(hash)) vistos.set(hash, name);
    return {
      name,
      bytes: stat.size,
      modifiedAt: stat.mtime,
      importacionId: imp ? imp.id : null,
      numero: imp ? `${imp.numero}/${imp.anio_numero}` : null,
      // Mismo contenido que otro PDF de la carpeta, o que el archivo con el que se cargo
      duplicadoDe: imp ? (imp.archivo_nombre !== name ? imp.archivo_nombre : null) : duplicadoDe,
      omitido: !imp && hash ? hashesFallidos.get(hash) || null : null
    };
  });
}

// --- Sondeo automatico de la carpeta ---
let sondeoEnCurso = false;
let ultimoSondeo = null;
let ultimoResumen = { archivos: 0, nuevos: 0, errores: [] };
// hash -> motivo por el que el PDF no se cargo (no se reintenta hasta que cambie el archivo)
const hashesFallidos = new Map();

async function sondearRequerimientos() {
  if (sondeoEnCurso) return ultimoResumen;
  sondeoEnCurso = true;
  try {
    const rows = await query('SELECT archivo_hash FROM requerimiento_importaciones');
    const conocidos = reimportarConocidos ? new Set() : new Set(rows.map((r) => r.archivo_hash));
    reimportarConocidos = false;
    const archivos = listarPdfs();
    let nuevos = 0;
    const errores = [];
    for (const name of archivos) {
      let hash;
      try { hash = hashArchivo(path.join(carpetaActual, name)); } catch { continue; }
      if (conocidos.has(hash) || hashesFallidos.has(hash)) continue;
      try {
        const { impId, parsed } = await procesarArchivoRequerimiento(name, null);
        conocidos.add(hash);
        nuevos += 1;
        console.log(`[requerimiento-watch] importado "${name}" -> #${impId} (${parsed.numero}/${parsed.anioNumero}, ${parsed.items.length} items)`);
      } catch (err) {
        hashesFallidos.set(hash, err.message);
        errores.push({ archivo: name, error: err.message });
        console.warn(`[requerimiento-watch] "${name}" omitido: ${err.message}`);
      }
    }
    ultimoResumen = { archivos: archivos.length, nuevos, errores };
  } catch (err) {
    console.error('[requerimiento-watch] error de sondeo:', err.message);
  } finally {
    ultimoSondeo = new Date().toISOString();
    sondeoEnCurso = false;
  }
  return ultimoResumen;
}

function estadoSondeo() {
  return {
    enabled: config.requerimientoWatch.enabled,
    intervalMs: config.requerimientoWatch.intervalMs,
    ultimoSondeo,
    archivosUltimo: ultimoResumen.archivos,
    importadosUltimo: ultimoResumen.nuevos,
    errores: ultimoResumen.errores
  };
}

function iniciarSondeoRequerimientos() {
  if (!config.requerimientoWatch.enabled) {
    console.log('[requerimiento-watch] deshabilitado (REQUERIMIENTO_WATCH=off)');
    return;
  }
  const { intervalMs } = config.requerimientoWatch;
  console.log(`[requerimiento-watch] activo. Carpeta: ${carpetaActual} · cada ${Math.round(intervalMs / 1000)}s`);
  setTimeout(sondearRequerimientos, 8000);
  setInterval(sondearRequerimientos, intervalMs);
}

async function listarImportaciones() {
  return query(`
    SELECT id, archivo_nombre, numero, anio_numero, fuente, estado, tipo_contratacion, servicio, fecha,
           periodo_desde, periodo_hasta, total_items, total_hojas, total_declarado, total_calculado, created_at
    FROM requerimiento_importaciones
    ORDER BY anio_numero DESC, numero ASC
  `);
}

async function listarItems() {
  return query(`
    SELECT ri.id, ri.importacion_id, ri.item_nro, ri.hoja, i.total_hojas, ri.cantidad, ri.stock, ri.codigo, ri.codigo_sigaf, ri.descripcion,
           ri.descripcion_especifica, ri.droga, ri.droga_clave, ri.imputacion, ri.justiprecio, ri.estado, ri.total,
           i.numero, i.anio_numero, i.archivo_nombre, i.periodo_desde, i.periodo_hasta
    FROM requerimiento_items ri
    JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    ORDER BY ri.droga_clave, ri.codigo, i.numero, ri.item_nro
  `);
}

async function eliminarImportacion(id, usuarioId) {
  const result = await query('DELETE FROM requerimiento_importaciones WHERE id = :id', { id });
  if (result.affectedRows) {
    await audit(usuarioId, 'eliminar_requerimiento', 'requerimiento_importaciones', id, {});
    hashesFallidos.clear();
  }
  return result.affectedRows;
}

module.exports = {
  ensureRequerimientoTables,
  carpetaRequerimientos,
  cambiarCarpeta,
  procesarArchivoRequerimiento,
  estadoCarpeta,
  sondearRequerimientos,
  estadoSondeo,
  iniciarSondeoRequerimientos,
  listarImportaciones,
  listarItems,
  eliminarImportacion
};
