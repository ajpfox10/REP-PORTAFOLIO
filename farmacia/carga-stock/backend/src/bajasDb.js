const { query, transaction } = require('./db');

// Bajas de Farmacia MS que no son consumo: egresos de tipo Descarte, Por Vencimiento y
// Devoluciones al Deposito (Vencidos), leidos del Listado de Egresos con el detalle de cada uno.
// Se restan del consumo mensual para ver el consumo real. Ademas, los vinculos a mano entre un
// codigo pedido y el codigo con el que figura en el consumo (cuando no coinciden por codigo ni nombre).
async function ensureBajasTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS bajas_ms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sector VARCHAR(160) NOT NULL,
      egreso_id VARCHAR(20) NOT NULL,
      fecha DATE NULL,
      tipo VARCHAR(80) NULL,
      motivo VARCHAR(255) NULL,
      linea INT NOT NULL,
      codigo VARCHAR(40) NOT NULL,
      medicamento VARCHAR(255) NULL,
      lote VARCHAR(80) NULL,
      vencimiento DATE NULL,
      cantidad DECIMAL(14,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_bajas_ms_linea (sector, egreso_id, linea),
      INDEX idx_bajas_ms_codigo (codigo),
      INDEX idx_bajas_ms_fecha (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS consumo_vinculos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo_pedido VARCHAR(40) NOT NULL UNIQUE,
      codigo_consumo VARCHAR(40) NOT NULL,
      usuario_id INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Reemplaza las bajas de un sector en un rango de fechas por las leidas ahora
async function guardarBajas(sector, desdeIso, hastaIso, egresos) {
  await transaction(async (conn) => {
    await conn.execute('DELETE FROM bajas_ms WHERE sector = ? AND fecha BETWEEN ? AND ?', [sector, desdeIso, hastaIso]);
    for (const e of egresos) {
      for (const [i, it] of e.items.entries()) {
        await conn.execute(
          `INSERT INTO bajas_ms (sector, egreso_id, fecha, tipo, motivo, linea, codigo, medicamento, lote, vencimiento, cantidad)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE fecha = VALUES(fecha), tipo = VALUES(tipo), motivo = VALUES(motivo), codigo = VALUES(codigo),
             medicamento = VALUES(medicamento), lote = VALUES(lote), vencimiento = VALUES(vencimiento), cantidad = VALUES(cantidad)`,
          [sector, e.egresoId, e.fecha, e.tipo, e.motivo, i + 1, it.codigo, it.medicamento, it.lote, it.vencimiento, it.cantidad]
        );
      }
    }
  });
}

async function listarBajas() {
  return query(`
    SELECT id, sector, egreso_id, DATE_FORMAT(fecha, '%Y-%m-%d') fecha, tipo, motivo, codigo, medicamento, lote,
           DATE_FORMAT(vencimiento, '%Y-%m-%d') vencimiento, cantidad
    FROM bajas_ms ORDER BY fecha, egreso_id, linea
  `);
}

async function listarVinculosConsumo() {
  return query('SELECT codigo_pedido, codigo_consumo FROM consumo_vinculos');
}

// Ultimo trimestre con consumo de cada codigo en el Analisis Trimestral (pista de "consumido antes")
async function listarHistoricoTrimestre() {
  return query(`
    SELECT ti.codigo_articulo codigo, MAX(imp.anio * 10 + imp.trimestre) ultimo
    FROM trimestre_items ti JOIN trimestre_importaciones imp ON imp.id = ti.trimestre_importacion_id
    WHERE ti.cantidad > 0 AND imp.anio IS NOT NULL
    GROUP BY ti.codigo_articulo
  `);
}

async function guardarVinculoConsumo(codigoPedido, codigoConsumo, usuarioId) {
  const pedido = String(codigoPedido || '').trim().toUpperCase();
  const consumo = String(codigoConsumo || '').trim().toUpperCase();
  if (!pedido) throw Object.assign(new Error('Falta el código pedido'), { status: 400 });
  if (!consumo) {
    await query('DELETE FROM consumo_vinculos WHERE codigo_pedido = :pedido', { pedido });
    return { borrado: true };
  }
  await query(
    `INSERT INTO consumo_vinculos (codigo_pedido, codigo_consumo, usuario_id) VALUES (:pedido, :consumo, :usuarioId)
     ON DUPLICATE KEY UPDATE codigo_consumo = VALUES(codigo_consumo), usuario_id = VALUES(usuario_id)`,
    { pedido, consumo, usuarioId: usuarioId || null }
  );
  return { pedido, consumo };
}

module.exports = { ensureBajasTables, guardarBajas, listarBajas, listarVinculosConsumo, listarHistoricoTrimestre, guardarVinculoConsumo };
