const { query, transaction } = require('./db');
const { parseOrdenCompra, hashArchivo, claveOc } = require('./ordenesCompraExcel');

// Tablas de Ordenes de Compra. Se crean al arrancar el backend (y en migrate.js),
// asi prod no necesita correr la migracion completa.
async function ensureOrdenesCompraTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS oc_ordenes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero VARCHAR(20) NOT NULL UNIQUE,
      proveedor VARCHAR(255) NOT NULL DEFAULT '',
      fecha_oc DATE NULL,
      vence DATE NULL,
      procedimiento VARCHAR(160) NULL,
      subtotal DECIMAL(16,2) NOT NULL DEFAULT 0,
      archivo_nombre VARCHAR(255) NOT NULL,
      archivo_hash CHAR(64) NOT NULL,
      creado_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_oc_ordenes_vence (vence)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS oc_renglones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      orden_id INT NOT NULL,
      renglon INT NOT NULL,
      codigo VARCHAR(20) NOT NULL,
      descripcion TEXT NOT NULL,
      cantidad INT NOT NULL,
      importe_unitario DECIMAL(16,2) NULL,
      importe_total DECIMAL(16,2) NULL,
      cantidad_entregada INT NULL,
      completo ENUM('SI','NO') NULL,
      nro_ingreso VARCHAR(120) NULL,
      observacion VARCHAR(500) NULL,
      actualizado_por INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_oc_renglon (orden_id, renglon),
      INDEX idx_oc_renglones_codigo (codigo),
      CONSTRAINT fk_oc_renglones_orden FOREIGN KEY (orden_id) REFERENCES oc_ordenes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Ultimos valores de carga acordados con la planilla de Drive (para saber de que lado cambio cada dato)
  const syncCol = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oc_renglones' AND COLUMN_NAME = 'sync_valores'
  `);
  if (!syncCol.length) {
    await query('ALTER TABLE oc_renglones ADD COLUMN sync_valores JSON NULL AFTER observacion');
  }
  // Destino en Drive elegido desde la pagina (una sola fila) e historial de actualizaciones
  await query(`
    CREATE TABLE IF NOT EXISTS oc_drive_config (
      id TINYINT PRIMARY KEY,
      file_id VARCHAR(120) NULL,
      file_nombre VARCHAR(255) NULL,
      file_tipo ENUM('excel','planilla') NULL,
      modo_pestana ENUM('anual','fija') NOT NULL DEFAULT 'anual',
      prefijo_anual VARCHAR(60) NOT NULL DEFAULT 'O.C ',
      pestana_fija VARCHAR(100) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      backup_revision_id VARCHAR(200) NULL,
      backup_local VARCHAR(500) NULL,
      backup_fecha DATETIME NULL,
      actualizado_por INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS oc_drive_historial (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id VARCHAR(120) NULL,
      file_nombre VARCHAR(255) NULL,
      accion ENUM('sincronizar','restaurar') NOT NULL DEFAULT 'sincronizar',
      resumen JSON NULL,
      backup_revision_id VARCHAR(200) NULL,
      backup_local VARCHAR(500) NULL,
      usuario_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_oc_drive_historial_fecha (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Cada PDF recibido (por hash), para reconocer el mismo archivo aunque venga con otro nombre
  await query(`
    CREATE TABLE IF NOT EXISTS oc_archivos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      archivo_hash CHAR(64) NOT NULL UNIQUE,
      archivo_nombre VARCHAR(255) NOT NULL,
      orden_id INT NULL,
      estado ENUM('cargado','duplicado') NOT NULL,
      detalle VARCHAR(500) NULL,
      subido_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_oc_archivos_orden FOREIGN KEY (orden_id) REFERENCES oc_ordenes(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function aFecha(ddmmyyyy) {
  const m = String(ddmmyyyy || '').match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function deFecha(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// archivos: [{ name, buffer }]. Devuelve por archivo: nuevo | ya_cargado | duplicado | error
async function importarArchivos(archivos, usuarioId) {
  const resultados = [];
  const vistosEnLote = new Map();
  for (const { name, buffer } of archivos) {
    const hash = hashArchivo(buffer);
    if (vistosEnLote.has(hash)) {
      resultados.push({ name, estado: 'duplicado', detalle: `Mismo archivo que "${vistosEnLote.get(hash)}"` });
      continue;
    }
    vistosEnLote.set(hash, name);

    const [previo] = await query(
      `SELECT a.archivo_nombre, a.estado, o.numero
       FROM oc_archivos a LEFT JOIN oc_ordenes o ON o.id = a.orden_id
       WHERE a.archivo_hash = :hash`,
      { hash }
    );
    if (previo) {
      resultados.push({
        name,
        estado: 'ya_cargado',
        oc: previo.numero || null,
        detalle: previo.numero ? `Ya estaba cargado (O.C. ${previo.numero}, "${previo.archivo_nombre}")` : `Ya se había recibido como "${previo.archivo_nombre}"`
      });
      continue;
    }

    let orden;
    try {
      orden = await parseOrdenCompra(buffer);
    } catch (err) {
      resultados.push({ name, estado: 'error', detalle: err.message });
      continue;
    }

    const resultado = await transaction(async (conn) => {
      const [existente] = await conn.execute('SELECT id, archivo_nombre FROM oc_ordenes WHERE numero = :numero FOR UPDATE', { numero: orden.oc });
      if (existente.length) {
        const detalle = `O.C. ${orden.oc} ya está cargada desde "${existente[0].archivo_nombre}"`;
        await conn.execute(
          `INSERT INTO oc_archivos (archivo_hash, archivo_nombre, orden_id, estado, detalle, subido_por)
           VALUES (:hash, :name, :ordenId, 'duplicado', :detalle, :usuarioId)`,
          { hash, name, ordenId: existente[0].id, detalle, usuarioId: usuarioId || null }
        );
        return { name, estado: 'duplicado', oc: orden.oc, detalle };
      }
      const [ins] = await conn.execute(
        `INSERT INTO oc_ordenes (numero, proveedor, fecha_oc, vence, procedimiento, subtotal, archivo_nombre, archivo_hash, creado_por)
         VALUES (:numero, :proveedor, :fecha, :vence, :procedimiento, :subtotal, :name, :hash, :usuarioId)`,
        {
          numero: orden.oc,
          proveedor: orden.proveedor,
          fecha: aFecha(orden.fecha),
          vence: aFecha(orden.vence),
          procedimiento: orden.procedimiento || null,
          subtotal: orden.subtotal,
          name,
          hash,
          usuarioId: usuarioId || null
        }
      );
      for (const it of orden.renglones) {
        await conn.execute(
          `INSERT INTO oc_renglones (orden_id, renglon, codigo, descripcion, cantidad, importe_unitario, importe_total)
           VALUES (:ordenId, :renglon, :codigo, :descripcion, :cantidad, :unitario, :total)`,
          { ordenId: ins.insertId, renglon: it.renglon, codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad, unitario: it.unitario, total: it.total }
        );
      }
      await conn.execute(
        `INSERT INTO oc_archivos (archivo_hash, archivo_nombre, orden_id, estado, subido_por)
         VALUES (:hash, :name, :ordenId, 'cargado', :usuarioId)`,
        { hash, name, ordenId: ins.insertId, usuarioId: usuarioId || null }
      );
      return { name, estado: 'nuevo', oc: orden.oc, proveedor: orden.proveedor, renglones: orden.renglones.length, total: orden.subtotal };
    });
    resultados.push(resultado);
  }
  return resultados;
}

function estadoOrden(renglones) {
  return renglones.length && renglones.every((r) => r.completo === 'SI') ? 'COMPLETA' : 'INCOMPLETA';
}

// Ordenes con sus renglones, en el formato que usan la pantalla y el Excel
async function listarOrdenes() {
  const ordenes = await query(
    `SELECT id, numero, proveedor, fecha_oc, vence, procedimiento, subtotal, archivo_nombre, created_at
     FROM oc_ordenes`
  );
  const renglones = await query(
    `SELECT id, orden_id, renglon, codigo, descripcion, cantidad, cantidad_entregada, completo, nro_ingreso, observacion, updated_at
     FROM oc_renglones ORDER BY orden_id, renglon`
  );
  const porOrden = new Map(ordenes.map((o) => [o.id, []]));
  for (const r of renglones) {
    porOrden.get(r.orden_id)?.push({
      id: r.id,
      renglon: r.renglon,
      codigo: r.codigo,
      descripcion: r.descripcion,
      cantidad: r.cantidad,
      entregada: r.cantidad_entregada,
      completo: r.completo,
      nroIngreso: r.nro_ingreso,
      observacion: r.observacion
    });
  }
  return ordenes
    .map((o) => {
      const items = porOrden.get(o.id) || [];
      return {
        id: o.id,
        oc: o.numero,
        proveedor: o.proveedor,
        fecha: deFecha(o.fecha_oc),
        vence: deFecha(o.vence),
        procedimiento: o.procedimiento || '',
        subtotal: Number(o.subtotal),
        archivo: o.archivo_nombre,
        cargadaEl: o.created_at,
        estado: estadoOrden(items),
        renglones: items
      };
    })
    .sort((a, b) => claveOc(a.oc) - claveOc(b.oc));
}

async function listarDuplicados() {
  const rows = await query(
    `SELECT archivo_nombre, detalle FROM oc_archivos WHERE estado = 'duplicado' ORDER BY archivo_nombre`
  );
  return rows.map((r) => ({ name: r.archivo_nombre, estado: 'duplicado', detalle: r.detalle || '' }));
}

const CAMPOS_RENGLON = {
  entregada: 'cantidad_entregada',
  completo: 'completo',
  nroIngreso: 'nro_ingreso',
  observacion: 'observacion'
};

function normalizarCampo(campo, value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  if (campo === 'entregada') {
    const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw Object.assign(new Error('La cantidad entregada tiene que ser un número entero, 0 o mayor'), { status: 400 });
    }
    return n;
  }
  if (campo === 'completo') {
    const v = String(value).trim().toUpperCase();
    if (!['SI', 'NO'].includes(v)) throw Object.assign(new Error('Completo tiene que ser SI o NO'), { status: 400 });
    return v;
  }
  const max = campo === 'nroIngreso' ? 120 : 500;
  return String(value).trim().slice(0, max);
}

async function actualizarRenglon(id, cambios, usuarioId) {
  const sets = [];
  const params = { id, usuarioId: usuarioId || null };
  for (const [campo, columna] of Object.entries(CAMPOS_RENGLON)) {
    const v = normalizarCampo(campo, cambios[campo]);
    if (v === undefined) continue;
    sets.push(`${columna} = :${campo}`);
    params[campo] = v;
  }
  if (!sets.length) throw Object.assign(new Error('No hay cambios para guardar'), { status: 400 });
  const result = await query(`UPDATE oc_renglones SET ${sets.join(', ')}, actualizado_por = :usuarioId WHERE id = :id`, params);
  if (!result.affectedRows) throw Object.assign(new Error('Renglón no encontrado'), { status: 404 });
  const [row] = await query(
    'SELECT id, renglon, codigo, descripcion, cantidad, cantidad_entregada, completo, nro_ingreso, observacion FROM oc_renglones WHERE id = :id',
    { id }
  );
  return {
    id: row.id, renglon: row.renglon, codigo: row.codigo, descripcion: row.descripcion, cantidad: row.cantidad,
    entregada: row.cantidad_entregada, completo: row.completo, nroIngreso: row.nro_ingreso, observacion: row.observacion
  };
}

// Pasa a la base lo cargado a mano en un Excel existente, solo en renglones que en la base estan vacios
async function importarCargaManual(prev, usuarioId) {
  if (!prev.size) return 0;
  const ordenes = await listarOrdenes();
  let actualizados = 0;
  for (const o of ordenes) {
    for (const it of o.renglones) {
      const pv = prev.get(`${o.oc}#${it.renglon}`);
      const vacio = it.entregada === null && !it.completo && !it.nroIngreso && !it.observacion;
      if (!pv || !vacio) continue;
      await actualizarRenglon(it.id, pv, usuarioId);
      actualizados += 1;
    }
  }
  return actualizados;
}

async function eliminarOrden(id) {
  return transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT numero, archivo_hash FROM oc_ordenes WHERE id = :id', { id });
    if (!rows.length) throw Object.assign(new Error('Orden no encontrada'), { status: 404 });
    // Se olvidan los PDF de esa orden para poder volver a subirlos
    await conn.execute('DELETE FROM oc_archivos WHERE orden_id = :id', { id });
    await conn.execute('DELETE FROM oc_ordenes WHERE id = :id', { id });
    return rows[0].numero;
  });
}

module.exports = {
  ensureOrdenesCompraTables,
  importarArchivos,
  listarOrdenes,
  listarDuplicados,
  actualizarRenglon,
  importarCargaManual,
  eliminarOrden
};
