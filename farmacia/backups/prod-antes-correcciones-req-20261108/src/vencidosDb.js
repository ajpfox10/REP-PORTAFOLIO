const fs = require('fs');
const cheerio = require('cheerio');
const { query, transaction } = require('./db');
const config = require('./config');

// Vencimientos bajados de Farmacia MS (Reportes > Articulos Vencidos y Proximos a Vencer, Excel por sector).
// El reporte lista los lotes con stock que vencen hasta la fecha pedida. Cada corrida del robot es una
// "descarga"; la vigente es la ultima que termino bien.
async function ensureVencidosTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS venc_descargas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      estado ENUM('en_proceso','ok','error') NOT NULL DEFAULT 'en_proceso',
      sectores TEXT NULL,
      hasta DATE NULL,
      archivos JSON NULL,
      total_items INT NOT NULL DEFAULT 0,
      mensaje TEXT NULL,
      solicitado_por INT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS venc_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descarga_id INT NOT NULL,
      sector VARCHAR(160) NOT NULL,
      codigo VARCHAR(40) NOT NULL,
      nombre_generico VARCHAR(255) NULL,
      concentracion VARCHAR(160) NULL,
      presentacion VARCHAR(160) NULL,
      forma VARCHAR(160) NULL,
      lote VARCHAR(80) NULL,
      vencimiento DATE NULL,
      stock DECIMAL(14,2) NULL,
      INDEX idx_venc_items_codigo (codigo),
      INDEX idx_venc_items_descarga (descarga_id, sector),
      CONSTRAINT fk_venc_items_descarga FOREIGN KEY (descarga_id) REFERENCES venc_descargas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS venc_config (
      id TINYINT PRIMARY KEY,
      carpeta VARCHAR(500) NULL,
      actualizado_por INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function carpetaVencidos() {
  const [row] = await query('SELECT carpeta FROM venc_config WHERE id = 1');
  return row?.carpeta || config.vencidos.dir;
}

async function cambiarCarpeta(ruta, usuarioId) {
  await query(
    `INSERT INTO venc_config (id, carpeta, actualizado_por) VALUES (1, :ruta, :usuarioId)
     ON DUPLICATE KEY UPDATE carpeta = VALUES(carpeta), actualizado_por = VALUES(actualizado_por)`,
    { ruta, usuarioId }
  );
}

function limpiar(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function numero(v) {
  const t = limpiar(v);
  if (!t || t === '-') return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// "31/03/2027" -> "2027-03-31"
function fechaIso(v) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(limpiar(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// El "Excel" es una tabla HTML: se lee como texto para no convertir los numeros de lote
function parseVencidosExcel(filePath) {
  const $ = cheerio.load(fs.readFileSync(filePath, 'utf8'));
  const items = [];
  $('tr').each((_, tr) => {
    const celdas = $(tr).find('td,th').map((__, td) => limpiar($(td).text())).get();
    if (celdas.length < 8) return;
    const codigo = celdas[0].toUpperCase();
    if (!/^[A-Z]\d{5,}/.test(codigo)) return; // encabezados
    items.push({
      codigo,
      nombre: celdas[1] || null,
      concentracion: celdas[2] || null,
      presentacion: celdas[3] || null,
      forma: celdas[4] || null,
      lote: celdas[5] || null,
      vencimiento: fechaIso(celdas[6]),
      stock: numero(celdas[7])
    });
  });
  return { items };
}

async function crearDescarga(sectores, hasta, usuarioId) {
  const r = await query(
    "INSERT INTO venc_descargas (estado, sectores, hasta, solicitado_por, mensaje) VALUES ('en_proceso', :sectores, :hasta, :usuarioId, 'Iniciando robot')",
    { sectores: sectores.join(' | '), hasta, usuarioId: usuarioId || null }
  );
  return r.insertId;
}

async function actualizarDescarga(id, patch) {
  const campos = [];
  const params = { id };
  for (const [key, value] of Object.entries(patch)) {
    campos.push(`${key} = :${key}`);
    params[key] = key === 'archivos' ? JSON.stringify(value) : value;
  }
  await query(`UPDATE venc_descargas SET ${campos.join(', ')} WHERE id = :id`, params);
}

async function guardarItems(descargaId, sector, items) {
  await transaction(async (conn) => {
    await conn.execute('DELETE FROM venc_items WHERE descarga_id = ? AND sector = ?', [descargaId, sector]);
    for (const it of items) {
      await conn.execute(
        `INSERT INTO venc_items (descarga_id, sector, codigo, nombre_generico, concentracion, presentacion, forma, lote, vencimiento, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [descargaId, sector, it.codigo, it.nombre, it.concentracion, it.presentacion, it.forma, it.lote, it.vencimiento, it.stock]
      );
    }
  });
}

async function descargaEnCurso() {
  const [row] = await query(`
    SELECT id FROM venc_descargas
    WHERE estado = 'en_proceso' AND started_at > NOW() - INTERVAL 30 MINUTE
    ORDER BY id DESC LIMIT 1
  `);
  return row || null;
}

async function listarDescargas() {
  return query(`
    SELECT id, estado, sectores, hasta, archivos, total_items, mensaje, started_at, finished_at
    FROM venc_descargas ORDER BY id DESC LIMIT 15
  `);
}

async function itemsVencidos(descargaId = 0) {
  let id = Number(descargaId) || 0;
  if (!id) {
    const [ultima] = await query("SELECT id FROM venc_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
    id = ultima ? ultima.id : 0;
  }
  if (!id) return { descargaId: null, items: [] };
  const items = await query(`
    SELECT id, sector, codigo, nombre_generico, concentracion, presentacion, forma, lote,
           DATE_FORMAT(vencimiento, '%Y-%m-%d') vencimiento, stock
    FROM venc_items WHERE descarga_id = :id
    ORDER BY vencimiento, nombre_generico
  `, { id });
  return { descargaId: id, items };
}

module.exports = {
  ensureVencidosTables,
  carpetaVencidos,
  cambiarCarpeta,
  parseVencidosExcel,
  crearDescarga,
  actualizarDescarga,
  guardarItems,
  descargaEnCurso,
  listarDescargas,
  itemsVencidos
};
