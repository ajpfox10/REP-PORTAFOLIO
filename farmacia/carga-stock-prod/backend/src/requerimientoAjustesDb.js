const { query, transaction } = require('./db');
const { audit } = require('./audit');

// Correcciones del requerimiento: el PDF del Ministerio no se toca nunca. Para cada codigo y ciclo
// (semestre del periodo del requerimiento, 'AAAA-S') se guarda el valor corregido a mano junto con el
// original del PDF. Cada cambio queda en el historial, que no se borra nunca.
async function ensureAjustesTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_ajustes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(40) NOT NULL,
      ciclo VARCHAR(7) NOT NULL,
      cantidad_original DECIMAL(14,2) NOT NULL,
      cantidad DECIMAL(14,2) NOT NULL,
      motivo VARCHAR(255) NULL,
      usuario_id INT NULL,
      usuario_nombre VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_req_ajuste (codigo, ciclo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_ajustes_historial (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(40) NOT NULL,
      ciclo VARCHAR(7) NOT NULL,
      accion VARCHAR(20) NOT NULL,
      cantidad_original DECIMAL(14,2) NULL,
      valor_anterior DECIMAL(14,2) NULL,
      valor_nuevo DECIMAL(14,2) NULL,
      motivo VARCHAR(255) NULL,
      usuario_id INT NULL,
      usuario_nombre VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_req_ajuste_hist (ciclo, codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function errorStatus(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const cicloOk = (c) => /^\d{4}-[12]$/.test(String(c || ''));
const num = (v) => (v == null ? null : Number(v));

// Valor original: suma de lo pedido para el codigo en los PDF cuyo periodo cae en el ciclo
async function originalPdf(codigo, ciclo) {
  const [anio, sem] = ciclo.split('-').map(Number);
  const [r] = await query(`
    SELECT SUM(ri.cantidad) cantidad, COUNT(*) n
    FROM requerimiento_items ri JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    WHERE ri.codigo = :codigo AND YEAR(i.periodo_desde) = :anio AND IF(MONTH(i.periodo_desde) <= 6, 1, 2) = :sem
  `, { codigo, anio, sem });
  return Number(r?.n) ? Number(r.cantidad || 0) : null;
}

function fila(r) {
  return { ...r, cantidad_original: num(r.cantidad_original), cantidad: num(r.cantidad),
    valor_anterior: num(r.valor_anterior), valor_nuevo: num(r.valor_nuevo) };
}

async function listar(ciclo) {
  if (ciclo && !cicloOk(ciclo)) throw errorStatus('Ciclo inválido');
  const rows = await query(`SELECT * FROM requerimiento_ajustes ${ciclo ? 'WHERE ciclo = :ciclo' : ''} ORDER BY updated_at DESC`, { ciclo });
  return rows.map(fila);
}

async function historial(ciclo, codigo) {
  if (ciclo && !cicloOk(ciclo)) throw errorStatus('Ciclo inválido');
  const cond = [];
  if (ciclo) cond.push('ciclo = :ciclo');
  if (codigo) cond.push('codigo = :codigo');
  const rows = await query(`SELECT * FROM requerimiento_ajustes_historial ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 5000`, { ciclo, codigo });
  return rows.map(fila);
}

// Guarda el valor corregido. Si es igual al original del PDF, se vuelve al original.
async function guardar({ codigo, ciclo, cantidad, motivo }, usuario) {
  codigo = String(codigo || '').trim();
  if (!codigo) throw errorStatus('Falta el código');
  if (!cicloOk(ciclo)) throw errorStatus('Ciclo inválido');
  const cant = Number(String(cantidad ?? '').replace(',', '.'));
  if (!Number.isFinite(cant) || cant < 0) throw errorStatus('La cantidad tiene que ser un número mayor o igual a 0');
  motivo = String(motivo || '').trim().slice(0, 255) || null;
  const original = await originalPdf(codigo, ciclo);
  if (original == null) throw errorStatus(`El código ${codigo} no está en los requerimientos de ese semestre`, 404);
  const [actual] = await query('SELECT * FROM requerimiento_ajustes WHERE codigo = :codigo AND ciclo = :ciclo', { codigo, ciclo });
  const anterior = actual ? Number(actual.cantidad) : original;
  if (cant === original && !actual) return { ajuste: null, original };
  if (cant === original) return volver({ codigo, ciclo, motivo }, usuario);
  if (actual && cant === anterior && (motivo || null) === (actual.motivo || null)) return { ajuste: fila(actual), original };
  await transaction(async (conn) => {
    await conn.execute(`
      INSERT INTO requerimiento_ajustes (codigo, ciclo, cantidad_original, cantidad, motivo, usuario_id, usuario_nombre)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE cantidad_original = VALUES(cantidad_original), cantidad = VALUES(cantidad), motivo = VALUES(motivo),
        usuario_id = VALUES(usuario_id), usuario_nombre = VALUES(usuario_nombre)
    `, [codigo, ciclo, original, cant, motivo, usuario?.id || null, usuario?.nombre || null]);
    await conn.execute(`
      INSERT INTO requerimiento_ajustes_historial (codigo, ciclo, accion, cantidad_original, valor_anterior, valor_nuevo, motivo, usuario_id, usuario_nombre)
      VALUES (?, ?, 'corregir', ?, ?, ?, ?, ?, ?)
    `, [codigo, ciclo, original, anterior, cant, motivo, usuario?.id || null, usuario?.nombre || null]);
  });
  await audit(usuario?.id, 'requerimiento_corregir', 'requerimiento_ajustes', null, { codigo, ciclo, original, anterior, nuevo: cant, motivo });
  const [nuevo] = await query('SELECT * FROM requerimiento_ajustes WHERE codigo = :codigo AND ciclo = :ciclo', { codigo, ciclo });
  return { ajuste: fila(nuevo), original };
}

// Vuelve al valor del PDF: borra la correccion y lo deja anotado en el historial
async function volver({ codigo, ciclo, motivo }, usuario) {
  codigo = String(codigo || '').trim();
  if (!cicloOk(ciclo)) throw errorStatus('Ciclo inválido');
  const [actual] = await query('SELECT * FROM requerimiento_ajustes WHERE codigo = :codigo AND ciclo = :ciclo', { codigo, ciclo });
  const original = await originalPdf(codigo, ciclo);
  if (!actual) return { ajuste: null, original };
  await transaction(async (conn) => {
    await conn.execute('DELETE FROM requerimiento_ajustes WHERE id = ?', [actual.id]);
    await conn.execute(`
      INSERT INTO requerimiento_ajustes_historial (codigo, ciclo, accion, cantidad_original, valor_anterior, valor_nuevo, motivo, usuario_id, usuario_nombre)
      VALUES (?, ?, 'volver', ?, ?, ?, ?, ?, ?)
    `, [codigo, ciclo, original, actual.cantidad, original, String(motivo || '').trim().slice(0, 255) || null, usuario?.id || null, usuario?.nombre || null]);
  });
  await audit(usuario?.id, 'requerimiento_volver_original', 'requerimiento_ajustes', actual.id, { codigo, ciclo, original, anterior: Number(actual.cantidad) });
  return { ajuste: null, original };
}

module.exports = { ensureAjustesTables, listar, historial, guardar, volver };
