const { query } = require('./db');

async function audit(usuarioId, accion, entidad, entidadId, detalle = {}) {
  await query(
    `INSERT INTO stock_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
     VALUES (:usuarioId, :accion, :entidad, :entidadId, CAST(:detalle AS JSON))`,
    {
      usuarioId: usuarioId || null,
      accion,
      entidad,
      entidadId: entidadId == null ? null : String(entidadId),
      detalle: JSON.stringify(detalle)
    }
  );
}

module.exports = { audit };
