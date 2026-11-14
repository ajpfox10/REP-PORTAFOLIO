const XLSX = require('xlsx');
const { query, transaction } = require('./db');
const config = require('./config');
const { COMPLETO_OK } = require('./ordenesCompraExcel');

// Stock actual bajado de Farmacia MS (Reportes > Consulta de Stock, Excel por sector).
// Cada corrida del robot es una "descarga"; la vigente es la ultima que termino bien.
async function ensureStockActualTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS stock_actual_descargas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      estado ENUM('en_proceso','ok','error') NOT NULL DEFAULT 'en_proceso',
      sectores TEXT NULL,
      archivos JSON NULL,
      fecha_stock DATE NULL,
      total_items INT NOT NULL DEFAULT 0,
      mensaje TEXT NULL,
      solicitado_por INT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL,
      INDEX idx_stock_actual_descargas_estado (estado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS stock_actual_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descarga_id INT NOT NULL,
      sector VARCHAR(160) NOT NULL,
      fecha_stock DATE NULL,
      codigo VARCHAR(40) NOT NULL,
      nombre_generico VARCHAR(255) NULL,
      concentracion VARCHAR(160) NULL,
      presentacion VARCHAR(160) NULL,
      forma VARCHAR(160) NULL,
      stock_minimo DECIMAL(14,2) NULL,
      stock_maximo DECIMAL(14,2) NULL,
      cant_ingreso DECIMAL(14,2) NULL,
      cant_egreso DECIMAL(14,2) NULL,
      stock DECIMAL(14,2) NULL,
      INDEX idx_stock_actual_items_codigo (codigo),
      INDEX idx_stock_actual_items_descarga (descarga_id, sector),
      CONSTRAINT fk_stock_actual_items_descarga FOREIGN KEY (descarga_id) REFERENCES stock_actual_descargas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Ingresos Detallados de Farmacia MS (tipo de ingreso y origen), bajados junto con cada descarga de stock.
  // Se usan para explicar de donde salio cada codigo repetido.
  await query(`
    CREATE TABLE IF NOT EXISTS stock_actual_ingresos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      descarga_id INT NOT NULL,
      sector VARCHAR(160) NOT NULL,
      nro_ingreso VARCHAR(40) NULL,
      tipo VARCHAR(120) NULL,
      fecha DATE NULL,
      codigo VARCHAR(40) NOT NULL,
      descripcion VARCHAR(400) NULL,
      lote VARCHAR(80) NULL,
      laboratorio VARCHAR(160) NULL,
      vencimiento VARCHAR(20) NULL,
      cantidad DECIMAL(14,2) NULL,
      usuario VARCHAR(80) NULL,
      origen VARCHAR(400) NULL,
      INDEX idx_stock_actual_ingresos_codigo (descarga_id, codigo),
      CONSTRAINT fk_stock_actual_ingresos_descarga FOREIGN KEY (descarga_id) REFERENCES stock_actual_descargas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Carpeta donde el robot guarda los Excel, elegida desde la pagina (una sola fila)
  await query(`
    CREATE TABLE IF NOT EXISTS stock_actual_config (
      id TINYINT PRIMARY KEY,
      carpeta VARCHAR(500) NULL,
      actualizado_por INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Carpeta vigente: la elegida en la pagina o, si no hay, la del .env (STOCK_ACTUAL_DIR).
// Se lee de la base en cada uso porque el robot corre en otro proceso.
async function carpetaDescarga() {
  const [row] = await query('SELECT carpeta FROM stock_actual_config WHERE id = 1');
  return row?.carpeta || config.stockActual.dir;
}

async function cambiarCarpeta(ruta, usuarioId) {
  await query(
    `INSERT INTO stock_actual_config (id, carpeta, actualizado_por) VALUES (1, :ruta, :usuarioId)
     ON DUPLICATE KEY UPDATE carpeta = VALUES(carpeta), actualizado_por = VALUES(actualizado_por)`,
    { ruta, usuarioId }
  );
}

function numeroOrNull(value) {
  if (value === '' || value == null || value === '-') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Lee el Excel de "Consulta de Stock": fila 1 titulo ("... Stock existente al día 30/10/2026 ..."),
// fila 2 encabezados, despues un producto por fila.
function parseStockExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const titulo = String(rows[0]?.[0] || '');
  const m = /al d.a (\d{2})\/(\d{2})\/(\d{4})/i.exec(titulo);
  const fechaStock = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  const items = [];
  for (const r of rows.slice(2)) {
    const codigo = String(r[0] || '').trim();
    if (!codigo) continue;
    items.push({
      codigo,
      nombre: String(r[1] || '').trim() || null,
      concentracion: String(r[2] || '').trim() || null,
      presentacion: String(r[3] || '').trim() || null,
      forma: String(r[4] || '').trim() || null,
      stockMinimo: numeroOrNull(r[5]),
      stockMaximo: numeroOrNull(r[6]),
      cantIngreso: numeroOrNull(r[7]),
      cantEgreso: numeroOrNull(r[8]),
      stock: numeroOrNull(r[9])
    });
  }
  return { titulo, fechaStock, items };
}

// Excel de Reportes > Ingresos Detallados: fila 0 titulo, fila 1 encabezado
// (Nro Ingreso, Tipo Ingreso, Fecha Ingreso, Fecha Registro, Codigo, Descripcion, Lote, Descrip. Lote, Fecha Vto, Cantidad, Usuario, Origen)
function parseIngresosExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const fechaIso = (v) => {
    if (typeof v === 'number') return XLSX.SSF.format('yyyy-mm-dd', v);
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const texto = (v, max) => (String(v ?? '').trim() || null)?.slice(0, max) ?? null;
  const out = [];
  for (const r of rows.slice(2)) {
    const codigo = String(r[4] || '').trim();
    if (!codigo) continue;
    // "Establecimiento: HOSPITAL X" -> "HOSPITAL X"; "Sector: ..." y "Servicio: ..." quedan como vienen
    const origen = String(r[11] || '').replace(/^Establecimiento:\s*/i, '').trim();
    out.push({
      nroIngreso: texto(r[0], 40),
      tipo: texto(r[1], 120),
      fecha: fechaIso(r[2]),
      codigo,
      descripcion: texto(r[5], 400),
      lote: texto(r[6], 80),
      laboratorio: texto(r[7], 160),
      vencimiento: texto(r[8], 20),
      cantidad: numeroOrNull(r[9]),
      usuario: texto(r[10], 80),
      origen: origen && origen !== '-' ? origen.slice(0, 400) : null
    });
  }
  return out;
}

async function guardarIngresosSector(descargaId, sector, ingresos) {
  await transaction(async (conn) => {
    await conn.execute('DELETE FROM stock_actual_ingresos WHERE descarga_id = ? AND sector = ?', [descargaId, sector]);
    for (const it of ingresos) {
      await conn.execute(
        `INSERT INTO stock_actual_ingresos
          (descarga_id, sector, nro_ingreso, tipo, fecha, codigo, descripcion, lote, laboratorio, vencimiento, cantidad, usuario, origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [descargaId, sector, it.nroIngreso, it.tipo, it.fecha, it.codigo, it.descripcion, it.lote, it.laboratorio,
          it.vencimiento, it.cantidad, it.usuario, it.origen]
      );
    }
  });
}

async function crearDescarga(sectores, usuarioId) {
  const insert = await query(
    'INSERT INTO stock_actual_descargas (estado, sectores, solicitado_por, mensaje) VALUES (\'en_proceso\', :sectores, :usuarioId, \'Iniciando robot\')',
    { sectores: sectores.join(' | '), usuarioId: usuarioId || null }
  );
  return insert.insertId;
}

async function actualizarDescarga(id, patch) {
  const campos = [];
  const params = { id };
  for (const [key, value] of Object.entries(patch)) {
    campos.push(`${key} = :${key}`);
    params[key] = key === 'archivos' ? JSON.stringify(value) : value;
  }
  await query(`UPDATE stock_actual_descargas SET ${campos.join(', ')} WHERE id = :id`, params);
}

async function guardarItemsSector(descargaId, sector, parsed) {
  await transaction(async (conn) => {
    await conn.execute('DELETE FROM stock_actual_items WHERE descarga_id = ? AND sector = ?', [descargaId, sector]);
    for (const it of parsed.items) {
      await conn.execute(
        `INSERT INTO stock_actual_items
          (descarga_id, sector, fecha_stock, codigo, nombre_generico, concentracion, presentacion, forma,
           stock_minimo, stock_maximo, cant_ingreso, cant_egreso, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [descargaId, sector, parsed.fechaStock, it.codigo, it.nombre, it.concentracion, it.presentacion, it.forma,
          it.stockMinimo, it.stockMaximo, it.cantIngreso, it.cantEgreso, it.stock]
      );
    }
  });
}

async function descargaEnCurso() {
  // Una corrida "en_proceso" de mas de 30 minutos se considera colgada
  const [row] = await query(`
    SELECT id FROM stock_actual_descargas
    WHERE estado = 'en_proceso' AND started_at > NOW() - INTERVAL 30 MINUTE
    ORDER BY id DESC LIMIT 1
  `);
  return row || null;
}

async function listarDescargas(limit = 15) {
  return query(`
    SELECT id, estado, sectores, archivos, fecha_stock, total_items, mensaje, started_at, finished_at
    FROM stock_actual_descargas
    ORDER BY id DESC
    LIMIT ${Number(limit) || 15}
  `);
}

// Items de la descarga indicada, o de la ultima que termino bien
async function itemsStockActual(descargaId = 0) {
  let id = Number(descargaId) || 0;
  if (!id) {
    const [ultima] = await query("SELECT id FROM stock_actual_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
    id = ultima ? ultima.id : 0;
  }
  if (!id) return { descargaId: null, items: [] };
  const items = await query(`
    SELECT id, sector, fecha_stock, codigo, nombre_generico, concentracion, presentacion, forma,
           stock_minimo, stock_maximo, cant_ingreso, cant_egreso, stock
    FROM stock_actual_items
    WHERE descarga_id = :id
    ORDER BY sector, nombre_generico, codigo
  `, { id });
  return { descargaId: id, items };
}

function claveNombre(texto) {
  // Primera palabra significativa del nombre (la droga), sin acentos: "CLORHIDRATO DE PROPRANOLOL" -> "PROPRANOLOL"
  const palabras = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const ignorar = new Set(['CLORHIDRATO', 'DE', 'SODICO', 'SODICA', 'ACETATO', 'SULFATO', 'BROMURO', 'FOSFATO', 'CITRATO']);
  return palabras.find((p) => !ignorar.has(p) && p.length > 2) || palabras[0] || '';
}

// Cruce por codigo entre los renglones de las Ordenes de Compra y el ultimo stock descargado
// de Farmacia MS (todos los sectores sumados). Los codigos de O.C. que no estan en el stock
// se buscan por nombre de droga para sugerir posibles equivalentes.
async function cruceOrdenesCompra() {
  const { descargaId, items: todos } = await itemsStockActual();
  // Solo los sectores configurados (Farmacia Unificada y Psicofarmacos); una descarga vieja puede traer otros, como TBC
  const sectores = new Set(config.stockActual.sectores);
  const items = todos.filter((it) => sectores.has(it.sector));
  const [descarga] = descargaId
    ? await query('SELECT id, fecha_stock, sectores FROM stock_actual_descargas WHERE id = :id', { id: descargaId })
    : [null];
  const renglones = await query(`
    SELECT o.numero, o.proveedor, o.vence, r.renglon, r.codigo, r.descripcion, r.cantidad, r.cantidad_entregada, r.completo
    FROM oc_renglones r
    JOIN oc_ordenes o ON o.id = r.orden_id
    ORDER BY o.numero, r.renglon
  `);

  const filas = new Map();
  const fila = (codigo) => {
    if (!filas.has(codigo)) {
      filas.set(codigo, {
        codigo, nombre: null, concentracion: null, forma: null, sectores: [], porSector: {}, enStock: false,
        stock: null, stockMinimo: null, stockMaximo: null,
        descripcionOc: null, ordenes: [], pedido: 0, pendiente: 0
      });
    }
    return filas.get(codigo);
  };

  for (const it of items) {
    const f = fila(it.codigo);
    f.enStock = true;
    f.nombre = f.nombre || it.nombre_generico;
    f.concentracion = f.concentracion || it.concentracion;
    f.forma = f.forma || [it.presentacion, it.forma].filter(Boolean).join(' ');
    f.sectores.push(it.sector);
    f.porSector[it.sector] = Number(it.stock || 0);
    f.stock = Number(f.stock || 0) + Number(it.stock || 0);
    if (it.stock_minimo != null) f.stockMinimo = Number(f.stockMinimo || 0) + Number(it.stock_minimo);
    if (it.stock_maximo != null) f.stockMaximo = Number(f.stockMaximo || 0) + Number(it.stock_maximo);
  }

  for (const r of renglones) {
    const f = fila(r.codigo);
    const entregada = r.cantidad_entregada == null ? 0 : Number(r.cantidad_entregada);
    // nada por entregar: renglon resuelto (SI, CAMBIO, DESAFECTADO)
    const pendiente = COMPLETO_OK.includes(r.completo) ? 0 : Math.max(0, Number(r.cantidad) - entregada);
    f.descripcionOc = f.descripcionOc || r.descripcion;
    f.ordenes.push({ oc: r.numero, proveedor: r.proveedor, renglon: r.renglon, vence: r.vence, cantidad: Number(r.cantidad), entregada: r.cantidad_entregada, completo: r.completo, pendiente });
    f.pedido += Number(r.cantidad);
    f.pendiente += pendiente;
  }

  // Indice por nombre de droga del stock, para sugerir equivalentes de codigos de O.C. que no figuran
  const porNombre = new Map();
  for (const f of filas.values()) {
    if (!f.enStock) continue;
    const k = claveNombre(f.nombre);
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k).push({ codigo: f.codigo, nombre: [f.nombre, f.concentracion, f.forma].filter(Boolean).join(' '), stock: f.stock });
  }

  const data = Array.from(filas.values()).map((f) => {
    const conOc = f.ordenes.length > 0;
    let estado;
    if (!f.enStock) estado = 'oc_sin_stock';
    else if (conOc) estado = 'con_oc';
    else if (Number(f.stock) === 0) estado = 'sin_stock_sin_oc';
    else if (f.stockMinimo != null && Number(f.stock) < f.stockMinimo) estado = 'bajo_minimo_sin_oc';
    else estado = 'ok_sin_oc';
    const similares = estado === 'oc_sin_stock' ? (porNombre.get(claveNombre(f.descripcionOc)) || []) : [];
    return { ...f, estado, similares, stockProyectado: f.enStock ? Number(f.stock) + f.pendiente : null };
  }).sort((a, b) => String(a.nombre || a.descripcionOc).localeCompare(String(b.nombre || b.descripcionOc)));

  return { descarga: descarga ? { ...descarga, sectores: config.stockActual.sectores.join(' | ') } : null, totalOrdenes: new Set(renglones.map((r) => r.numero)).size, data };
}

module.exports = {
  ensureStockActualTables,
  carpetaDescarga,
  cambiarCarpeta,
  parseStockExcel,
  crearDescarga,
  actualizarDescarga,
  guardarItemsSector,
  parseIngresosExcel,
  guardarIngresosSector,
  descargaEnCurso,
  listarDescargas,
  itemsStockActual,
  cruceOrdenesCompra
};
