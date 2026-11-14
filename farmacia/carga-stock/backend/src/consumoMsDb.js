const crypto = require('crypto');
const { query, transaction } = require('./db');
const config = require('./config');
const { MONTHS } = require('./consumoReportParser');

// Consumo mensual bajado de Farmacia MS (Reportes > Consumo Comparativo mensual, Excel anual por sector).
// Cada corrida del robot es una "descarga"; para cada sector + año vale la ultima descarga que termino bien.
async function ensureConsumoMsTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS consumo_ms_descargas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      estado ENUM('en_proceso','ok','error') NOT NULL DEFAULT 'en_proceso',
      anios VARCHAR(120) NULL,
      sectores TEXT NULL,
      archivos JSON NULL,
      total_items INT NOT NULL DEFAULT 0,
      mensaje TEXT NULL,
      solicitado_por INT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const meses = MONTHS.map((m) => `${m.key} DECIMAL(14,2) NOT NULL DEFAULT 0`).join(',\n      ');
  await query(`
    CREATE TABLE IF NOT EXISTS consumo_ms_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descarga_id INT NOT NULL,
      sector VARCHAR(160) NOT NULL,
      anio INT NOT NULL,
      codigo VARCHAR(40) NOT NULL,
      nombre_generico VARCHAR(255) NULL,
      concentracion VARCHAR(160) NULL,
      presentacion VARCHAR(160) NULL,
      forma VARCHAR(160) NULL,
      ${meses},
      total DECIMAL(16,2) NOT NULL DEFAULT 0,
      INDEX idx_consumo_ms_items_codigo (codigo),
      INDEX idx_consumo_ms_items_lote (descarga_id, sector, anio),
      CONSTRAINT fk_consumo_ms_items_descarga FOREIGN KEY (descarga_id) REFERENCES consumo_ms_descargas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Excel de D:\FARMACIA\TRIMESTRE cuyo trimestre ya se arma con el consumo de Farmacia MS:
  // el sondeo de la carpeta no los vuelve a importar.
  await query(`
    CREATE TABLE IF NOT EXISTS trimestre_reemplazados (
      archivo_hash CHAR(64) PRIMARY KEY,
      archivo_nombre VARCHAR(255) NULL,
      anio INT NULL,
      trimestre TINYINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS consumo_ms_config (
      id TINYINT PRIMARY KEY,
      carpeta VARCHAR(500) NULL,
      actualizado_por INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Carpeta de los Excel: la elegida en la pagina o CONSUMO_MS_DIR del .env
async function carpetaConsumo() {
  const [row] = await query('SELECT carpeta FROM consumo_ms_config WHERE id = 1');
  return row?.carpeta || config.consumoMs.dir;
}

async function cambiarCarpeta(ruta, usuarioId) {
  await query(
    `INSERT INTO consumo_ms_config (id, carpeta, actualizado_por) VALUES (1, :ruta, :usuarioId)
     ON DUPLICATE KEY UPDATE carpeta = VALUES(carpeta), actualizado_por = VALUES(actualizado_por)`,
    { ruta, usuarioId }
  );
}

async function crearDescarga(anios, sectores, usuarioId) {
  const r = await query(
    "INSERT INTO consumo_ms_descargas (estado, anios, sectores, solicitado_por, mensaje) VALUES ('en_proceso', :anios, :sectores, :usuarioId, 'Iniciando robot')",
    { anios: anios.join(', '), sectores: sectores.join(' | '), usuarioId: usuarioId || null }
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
  await query(`UPDATE consumo_ms_descargas SET ${campos.join(', ')} WHERE id = :id`, params);
}

// items: salida de parseConsumoReport (codigoArticulo, nombreGenerico, ..., meses)
async function guardarItems(descargaId, sector, anio, items) {
  const cols = MONTHS.map((m) => m.key);
  await transaction(async (conn) => {
    await conn.execute('DELETE FROM consumo_ms_items WHERE descarga_id = ? AND sector = ? AND anio = ?', [descargaId, sector, anio]);
    for (const it of items) {
      const valores = cols.map((k) => Number(it.meses[k] || 0));
      await conn.execute(
        `INSERT INTO consumo_ms_items
          (descarga_id, sector, anio, codigo, nombre_generico, concentracion, presentacion, forma, ${cols.join(', ')}, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${cols.map(() => '?').join(', ')}, ?)`,
        [descargaId, sector, anio, it.codigoArticulo, it.nombreGenerico || null, it.concentracion || null,
          it.presentacion || null, it.forma || null, ...valores, valores.reduce((a, b) => a + b, 0)]
      );
    }
  });
}

async function descargaEnCurso() {
  const [row] = await query(`
    SELECT id FROM consumo_ms_descargas
    WHERE estado = 'en_proceso' AND started_at > NOW() - INTERVAL 30 MINUTE
    ORDER BY id DESC LIMIT 1
  `);
  return row || null;
}

async function listarDescargas() {
  return query(`
    SELECT id, estado, anios, sectores, archivos, total_items, mensaje, started_at, finished_at
    FROM consumo_ms_descargas ORDER BY id DESC LIMIT 15
  `);
}

// Consumo vigente: para cada sector + año y cada MES, vale la ultima descarga completa que trae datos en ese mes.
// Asi, volver a bajar un año desde Farmacia MS (que no tiene los meses del sistema anterior y los trae en 0)
// actualiza los meses que si tiene sin tapar los meses cargados a mano desde EGRESOS DETALLADOS.
async function consumoVigente() {
  const keys = MONTHS.map((m) => m.key);
  const grupos = await query(`
    SELECT i.sector, i.anio, i.descarga_id, ${keys.map((k) => `SUM(i.${k} <> 0) ${k}`).join(', ')}
    FROM consumo_ms_items i
    JOIN consumo_ms_descargas d ON d.id = i.descarga_id AND d.estado = 'ok'
    GROUP BY i.sector, i.anio, i.descarga_id
    ORDER BY i.sector, i.anio, i.descarga_id DESC
  `);
  const porLote = new Map(); // sector|anio -> descargas, de la mas nueva a la mas vieja
  for (const g of grupos) {
    const k = `${g.sector}|${g.anio}`;
    if (!porLote.has(k)) porLote.set(k, []);
    porLote.get(k).push(g);
  }
  const lotes = [];
  const items = [];
  for (const descargas of porLote.values()) {
    const { sector, anio } = descargas[0];
    // Mes -> descarga que manda (la mas nueva con algun valor en ese mes)
    const fuente = {};
    for (const k of keys) fuente[k] = (descargas.find((g) => Number(g[k]) > 0) || descargas[0]).descarga_id;
    const usadas = Array.from(new Set([descargas[0].descarga_id, ...Object.values(fuente)]));
    const filas = await query(`
      SELECT id, descarga_id, sector, anio, codigo, nombre_generico, concentracion, presentacion, forma, ${keys.join(', ')}
      FROM consumo_ms_items
      WHERE sector = :sector AND anio = :anio AND descarga_id IN (${usadas.map((_, i) => `:d${i}`).join(', ')})
      ORDER BY descarga_id DESC
    `, { sector, anio, ...Object.fromEntries(usadas.map((d, i) => [`d${i}`, d])) });
    const porCodigo = new Map();
    for (const f of filas) {
      // Filas de la descarga mas nueva primero: sus datos de catalogo y su id quedan
      if (!porCodigo.has(f.codigo)) {
        porCodigo.set(f.codigo, {
          id: f.id, sector, anio, codigo: f.codigo, nombre_generico: f.nombre_generico, concentracion: f.concentracion,
          presentacion: f.presentacion, forma: f.forma, ...Object.fromEntries(keys.map((k) => [k, 0])), total: 0
        });
      }
      const it = porCodigo.get(f.codigo);
      if (f.descarga_id === descargas[0].descarga_id) it.enUltima = true;
      for (const k of keys) if (fuente[k] === f.descarga_id) it[k] = Number(f[k] || 0);
    }
    for (const { enUltima, ...it } of porCodigo.values()) {
      it.total = Math.round(keys.reduce((a, k) => a + it[k], 0) * 100) / 100;
      // Lo que vino en la ultima descarga se muestra siempre (como antes); de las viejas, solo si suma algo
      if (enUltima || it.total !== 0) items.push(it);
    }
    lotes.push({ sector, anio, descarga_id: descargas[0].descarga_id, descargas: usadas.sort((a, b) => a - b) });
  }
  return { lotes, items };
}

// Arma los trimestres del Analisis Trimestral con el consumo mensual bajado de Farmacia MS,
// un juego por sector (Farmacia Unificada y Psicofarmacos) y solo trimestres terminados. Cada trimestre
// reemplaza al que hubiera del mismo sector + año + trimestre (por ejemplo, un Excel ConsumosDetallados).
const HOSPITAL = 'HOSPITAL INTERZONAL GENERAL DE AGUDOS SIMPLEMENTE EVITA DE GONZALES CATAN KM 32';

async function generarTrimestresDesdeConsumo() {
  const { items } = await consumoVigente();
  const resultado = [];
  for (const sector of config.stockActual.sectores) {
    resultado.push(...await generarTrimestresSector(sector, items.filter((it) => it.sector === sector)));
  }
  return resultado;
}

async function generarTrimestresSector(sector, delSector) {
  const hoy = new Date();
  const mesActual = hoy.getFullYear() * 12 + hoy.getMonth();
  const resultado = [];
  for (const anio of Array.from(new Set(delSector.map((it) => it.anio))).sort()) {
    const delAnio = delSector.filter((it) => it.anio === anio);
    for (let t = 1; t <= 4; t += 1) {
      // Solo trimestres terminados (el ultimo mes del trimestre ya paso)
      if (anio * 12 + (t * 3 - 1) >= mesActual) continue;
      const meses = MONTHS.slice((t - 1) * 3, t * 3).map((m) => m.key);
      const filas = delAnio.map((it) => ({ it, cantidad: meses.reduce((a, k) => a + Number(it[k] || 0), 0) }));
      if (!filas.some((f) => f.cantidad > 0)) continue; // trimestre sin datos en Farmacia MS
      const hash = crypto.createHash('sha256')
        .update(`farmaciams-consumo|${sector}|${anio}|${t}|${filas.map((f) => `${f.it.codigo}=${f.cantidad}`).join(',')}`)
        .digest('hex');
      const desde = `${anio}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`;
      const hasta = new Date(anio, t * 3, 0);
      const hastaIso = `${anio}-${String(hasta.getMonth() + 1).padStart(2, '0')}-${String(hasta.getDate()).padStart(2, '0')}`;
      const nombre = `Farmacia MS · Consumo mensual ${sector} (T${t} ${anio})`;
      const r = await transaction(async (conn) => {
        const [mismo] = await conn.execute('SELECT id FROM trimestre_importaciones WHERE archivo_hash = ?', [hash]);
        if (mismo.length) return { id: mismo[0].id, cambio: false };
        // Lo que ya habia de ese trimestre para el sector (Excel de la carpeta o una corrida anterior)
        const [previos] = await conn.execute(
          'SELECT id, archivo_hash, archivo_nombre, source_path FROM trimestre_importaciones WHERE anio = ? AND trimestre = ? AND sector LIKE ?',
          [anio, t, `${sector}%`]
        );
        for (const p of previos) {
          if (p.source_path) {
            await conn.execute(
              'INSERT IGNORE INTO trimestre_reemplazados (archivo_hash, archivo_nombre, anio, trimestre) VALUES (?, ?, ?, ?)',
              [p.archivo_hash, p.archivo_nombre, anio, t]
            );
          }
          await conn.execute('DELETE FROM trimestre_importaciones WHERE id = ?', [p.id]);
        }
        const [imp] = await conn.execute(
          `INSERT INTO trimestre_importaciones
            (archivo_nombre, archivo_hash, hospital, sector, source_path, periodo_desde, periodo_hasta, anio, trimestre, total_items, creado_por)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)`,
          [nombre, hash, HOSPITAL, sector, desde, hastaIso, anio, t, filas.length]
        );
        for (const f of filas) {
          await conn.execute(
            `INSERT INTO trimestre_items
              (trimestre_importacion_id, codigo_articulo, nombre_generico, concentracion, forma, presentacion, cantidad)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [imp.insertId, f.it.codigo, f.it.nombre_generico, f.it.concentracion, f.it.forma, f.it.presentacion, f.cantidad]
          );
        }
        return { id: imp.insertId, cambio: true, reemplazados: previos.map((p) => p.archivo_nombre) };
      });
      resultado.push({ sector, anio, trimestre: t, items: filas.length, ...r });
    }
  }
  return resultado;
}

module.exports = {
  generarTrimestresDesdeConsumo,
  ensureConsumoMsTables,
  carpetaConsumo,
  cambiarCarpeta,
  crearDescarga,
  actualizarDescarga,
  guardarItems,
  descargaEnCurso,
  listarDescargas,
  consumoVigente
};
