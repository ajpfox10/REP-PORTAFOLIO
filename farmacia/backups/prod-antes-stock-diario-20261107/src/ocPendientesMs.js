const { query, transaction } = require('./db');

// Pendientes de ingreso por O.C. segun Farmacia MS (Reportes > Articulos Pendientes de Ingreso).
// El robot (scripts/pendientes-oc-web.js) consulta cada O.C. y deja, por renglon, lo adjudicado,
// desafectado, ingresado y faltante. Se guarda por N° de O.C. ("683/2026"), asi sirve aunque la O.C.
// no este cargada en la pagina. Cada consulta reemplaza lo anterior de esa O.C.

async function ensureOcPendientesMsTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS oc_ms_consultas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      estado ENUM('en_proceso','ok','error') NOT NULL DEFAULT 'en_proceso',
      ocs JSON NOT NULL,
      total INT NOT NULL DEFAULT 0,
      hechas INT NOT NULL DEFAULT 0,
      encontradas INT NOT NULL DEFAULT 0,
      mensaje VARCHAR(500) NULL,
      solicitado_por INT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS oc_ms_ordenes (
      oc_numero VARCHAR(20) PRIMARY KEY,
      encontrada TINYINT(1) NOT NULL,
      nro_solicitud VARCHAR(40) NULL,
      proveedor VARCHAR(255) NULL,
      prorroga VARCHAR(10) NULL,
      consulta_id INT NULL,
      consultado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS oc_ms_renglones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      oc_numero VARCHAR(20) NOT NULL,
      renglon INT NOT NULL,
      codigo VARCHAR(40) NULL,
      descripcion TEXT NULL,
      adjudicada DECIMAL(14,2) NULL,
      desafectada DECIMAL(14,2) NULL,
      ingresada DECIMAL(14,2) NULL,
      faltante DECIMAL(14,2) NULL,
      UNIQUE KEY uq_oc_ms_renglon (oc_numero, renglon)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// "452/26", "O.C 683/2026 MG" -> "452/2026"
function numeroOc(texto) {
  const m = String(texto ?? '').match(/(\d+)\s*\/\s*(\d{4}|\d{2})(?!\d)/);
  if (!m) return null;
  return `${Number(m[1])}/${m[2].length === 2 ? `20${m[2]}` : m[2]}`;
}

async function crearConsulta(ocs, usuarioId) {
  const r = await query(
    "INSERT INTO oc_ms_consultas (estado, ocs, total, solicitado_por, mensaje) VALUES ('en_proceso', CAST(:ocs AS JSON), :total, :usuarioId, 'Iniciando robot')",
    { ocs: JSON.stringify(ocs), total: ocs.length, usuarioId: usuarioId || null }
  );
  return r.insertId;
}

async function leerConsulta(id) {
  const [row] = await query('SELECT * FROM oc_ms_consultas WHERE id = :id', { id });
  if (row && typeof row.ocs === 'string') row.ocs = JSON.parse(row.ocs);
  return row || null;
}

async function actualizarConsulta(id, patch) {
  const campos = Object.keys(patch).map((k) => `${k} = :${k}`);
  await query(`UPDATE oc_ms_consultas SET ${campos.join(', ')} WHERE id = :id`, { ...patch, id });
}

async function consultaEnCurso() {
  const [row] = await query(`
    SELECT id FROM oc_ms_consultas
    WHERE estado = 'en_proceso' AND started_at > NOW() - INTERVAL 30 MINUTE
    ORDER BY id DESC LIMIT 1
  `);
  return row || null;
}

// cabecera: { nroSolicitud, proveedor, prorroga } o null si Farmacia MS no tiene esa O.C.
async function guardarResultado(consultaId, ocNumero, cabecera, renglones) {
  await transaction(async (conn) => {
    await conn.execute(
      `INSERT INTO oc_ms_ordenes (oc_numero, encontrada, nro_solicitud, proveedor, prorroga, consulta_id)
       VALUES (:oc, :encontrada, :nroSolicitud, :proveedor, :prorroga, :consultaId)
       ON DUPLICATE KEY UPDATE encontrada = VALUES(encontrada), nro_solicitud = VALUES(nro_solicitud),
         proveedor = VALUES(proveedor), prorroga = VALUES(prorroga), consulta_id = VALUES(consulta_id), consultado_at = NOW()`,
      {
        oc: ocNumero,
        encontrada: cabecera ? 1 : 0,
        nroSolicitud: cabecera?.nroSolicitud || null,
        proveedor: cabecera?.proveedor || null,
        prorroga: cabecera?.prorroga || null,
        consultaId
      }
    );
    await conn.execute('DELETE FROM oc_ms_renglones WHERE oc_numero = :oc', { oc: ocNumero });
    for (const r of renglones) {
      await conn.execute(
        `INSERT INTO oc_ms_renglones (oc_numero, renglon, codigo, descripcion, adjudicada, desafectada, ingresada, faltante)
         VALUES (:oc, :renglon, :codigo, :descripcion, :adjudicada, :desafectada, :ingresada, :faltante)
         ON DUPLICATE KEY UPDATE codigo = VALUES(codigo), descripcion = VALUES(descripcion),
           adjudicada = VALUES(adjudicada), desafectada = VALUES(desafectada), ingresada = VALUES(ingresada), faltante = VALUES(faltante)`,
        { oc: ocNumero, ...r }
      );
    }
  });
}

// Mapa "683/2026" -> { encontrada, consultadoAt, nroSolicitud, proveedor, renglones: Map(renglon -> valores) }
async function resultadosPorOc() {
  const ordenes = await query('SELECT * FROM oc_ms_ordenes');
  const renglones = await query('SELECT * FROM oc_ms_renglones ORDER BY oc_numero, renglon');
  const mapa = new Map(ordenes.map((o) => [o.oc_numero, {
    encontrada: Boolean(o.encontrada),
    consultadoAt: o.consultado_at,
    nroSolicitud: o.nro_solicitud,
    proveedor: o.proveedor,
    prorroga: o.prorroga,
    renglones: new Map()
  }]));
  for (const r of renglones) {
    mapa.get(r.oc_numero)?.renglones.set(r.renglon, {
      renglon: r.renglon,
      codigo: r.codigo,
      descripcion: r.descripcion,
      adjudicada: r.adjudicada == null ? null : Number(r.adjudicada),
      desafectada: r.desafectada == null ? null : Number(r.desafectada),
      ingresada: r.ingresada == null ? null : Number(r.ingresada),
      faltante: r.faltante == null ? null : Number(r.faltante)
    });
  }
  return mapa;
}

async function estado() {
  const consultas = await query(`
    SELECT id, estado, total, hechas, encontradas, mensaje, started_at, finished_at
    FROM oc_ms_consultas ORDER BY id DESC LIMIT 10
  `);
  const mapa = await resultadosPorOc();
  const resultados = [...mapa.entries()].map(([oc, x]) => ({ oc, ...x, renglones: [...x.renglones.values()] }));
  return { enCurso: await consultaEnCurso(), consultas, resultados };
}

module.exports = {
  ensureOcPendientesMsTables,
  numeroOc,
  crearConsulta,
  leerConsulta,
  actualizarConsulta,
  consultaEnCurso,
  guardarResultado,
  resultadosPorOc,
  estado
};
