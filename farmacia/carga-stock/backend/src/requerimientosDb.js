const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query, transaction } = require('./db');
const config = require('./config');
const { audit } = require('./audit');
const { parseRequerimientoPdf } = require('./requerimientoReportParser');
const { expandirCodigos, familias, cargarPerfiles, perfil, comparar } = require('./codigosEquivDb');

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
  // Requerimiento cargado a mano (sin PDF), por anio: una fila por codigo
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_manual (
      id INT AUTO_INCREMENT PRIMARY KEY,
      anio INT NOT NULL,
      codigo VARCHAR(20) NOT NULL,
      droga VARCHAR(255) NOT NULL,
      descripcion VARCHAR(500) NULL,
      cantidad DECIMAL(14,2) NOT NULL,
      creado_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_requerimiento_manual (anio, codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // El requerimiento es por semestre: una fila por anio + semestre + codigo
  const semCol = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requerimiento_manual' AND COLUMN_NAME = 'semestre'
  `);
  if (!semCol.length) {
    await query('ALTER TABLE requerimiento_manual ADD COLUMN semestre TINYINT NOT NULL DEFAULT 1 AFTER anio');
    await query('ALTER TABLE requerimiento_manual DROP INDEX uq_requerimiento_manual, ADD UNIQUE KEY uq_requerimiento_manual (anio, semestre, codigo)');
  }
  // Tilde de "controlado" por renglon (pasa a la pestaña Controlados)
  const ctrlCol = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requerimiento_manual' AND COLUMN_NAME = 'controlado'
  `);
  if (!ctrlCol.length) {
    await query('ALTER TABLE requerimiento_manual ADD COLUMN controlado TINYINT(1) NOT NULL DEFAULT 0 AFTER cantidad');
  }
  // Formularios de requerimiento / expedientes en papel (escaneados) donde figura cada codigo
  await query(`
    CREATE TABLE IF NOT EXISTS requerimiento_fuentes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      anio INT NOT NULL,
      clave VARCHAR(60) NOT NULL,
      formulario VARCHAR(30) NULL,
      expediente VARCHAR(40) NULL,
      etiqueta VARCHAR(160) NULL,
      hojas VARCHAR(80) NULL,
      codigo VARCHAR(20) NOT NULL,
      UNIQUE KEY uq_requerimiento_fuentes (anio, clave, codigo),
      KEY idx_requerimiento_fuentes_codigo (anio, codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Catalogo de farmacos conocidos (stock actual, consumo MS, trimestral y requerimientos) para elegir en la carga manual
async function catalogoFarmacos() {
  return query(`
    SELECT codigo, MAX(droga) AS droga, MAX(descripcion) AS descripcion FROM (
      SELECT codigo, nombre_generico AS droga,
             TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) AS descripcion
        FROM stock_actual_items WHERE codigo IS NOT NULL AND codigo <> ''
      UNION ALL
      SELECT codigo, nombre_generico,
             TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion))
        FROM consumo_ms_items WHERE codigo IS NOT NULL AND codigo <> ''
      UNION ALL
      SELECT codigo_articulo, nombre_generico,
             TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion))
        FROM trimestre_items WHERE codigo_articulo IS NOT NULL AND codigo_articulo <> ''
      UNION ALL
      SELECT codigo, droga, LEFT(descripcion, 500) FROM requerimiento_items
    ) t
    GROUP BY codigo
    ORDER BY droga, codigo
  `);
}

async function listarManual(anio) {
  const filas = await query(
    `SELECT m.id, m.anio, m.semestre, m.codigo, m.droga, m.descripcion, m.cantidad, m.controlado, m.created_at, m.updated_at
     FROM requerimiento_manual m WHERE m.anio = :anio ORDER BY m.semestre, m.droga, m.codigo`,
    { anio }
  );
  // Formularios / expedientes: los del codigo y los de sus codigos equivalentes
  const fam = await familias();
  const fuentes = new Map();
  for (const f of await query('SELECT codigo, clave FROM requerimiento_fuentes WHERE anio = :anio ORDER BY clave', { anio })) {
    if (!fuentes.has(f.codigo)) fuentes.set(f.codigo, []);
    fuentes.get(f.codigo).push(f.clave);
  }
  return filas.map((m) => {
    const grupo = fam.get(m.codigo) || [m.codigo];
    const claves = Array.from(new Set(grupo.flatMap((c) => fuentes.get(c) || []))).sort();
    return { ...m, fuentes: claves.length ? claves.join('|') : null, equivalentes: grupo.filter((c) => c !== m.codigo) };
  });
}

// Formularios / expedientes del anio (para el filtro de la carga manual)
async function gruposFuentes(anio) {
  return query(
    `SELECT clave, MAX(formulario) formulario, MAX(expediente) expediente, MAX(etiqueta) etiqueta, MAX(hojas) hojas, COUNT(*) codigos
     FROM requerimiento_fuentes WHERE anio = :anio GROUP BY clave ORDER BY clave`,
    { anio }
  );
}

// Reemplaza los formularios/expedientes de un anio (grupos = [{clave, formulario, expediente, etiqueta, hojas, codigos: []}])
async function cargarFuentes(anio, grupos) {
  await query('DELETE FROM requerimiento_fuentes WHERE anio = :anio', { anio });
  let n = 0;
  for (const g of grupos) {
    for (const codigo of new Set(g.codigos)) {
      await query(
        `INSERT INTO requerimiento_fuentes (anio, clave, formulario, expediente, etiqueta, hojas, codigo)
         VALUES (:anio, :clave, :formulario, :expediente, :etiqueta, :hojas, :codigo)`,
        { anio, clave: g.clave, formulario: g.formulario || null, expediente: g.expediente || null, etiqueta: g.etiqueta || null, hojas: g.hojas || null, codigo }
      );
      n += 1;
    }
  }
  return n;
}

// Alta o cambio de cantidad (si el codigo ya estaba cargado para ese anio y semestre, se reemplaza la cantidad)
async function guardarManual({ anio, semestre, codigo, droga, descripcion, cantidad }, usuarioId) {
  await query(
    `INSERT INTO requerimiento_manual (anio, semestre, codigo, droga, descripcion, cantidad, creado_por)
     VALUES (:anio, :semestre, :codigo, :droga, :descripcion, :cantidad, :usuarioId)
     ON DUPLICATE KEY UPDATE droga = VALUES(droga), descripcion = VALUES(descripcion), cantidad = VALUES(cantidad)`,
    { anio, semestre, codigo, droga, descripcion: descripcion || null, cantidad, usuarioId }
  );
  await audit(usuarioId, 'guardar_requerimiento_manual', 'requerimiento_manual', null, { anio, semestre, codigo, cantidad });
}

// Copia al anio/semestre de la carga manual los farmacos del requerimiento de PDF mas nuevo
// (el ciclo con el periodo de consumo mas reciente), con cantidad 0. No pisa lo ya cargado.
async function copiarDesdeRequerimientoNuevo(anio, semestre, usuarioId) {
  const [ult] = await query(`
    SELECT YEAR(periodo_desde) anio, IF(MONTH(periodo_desde) <= 6, 1, 2) sem
    FROM requerimiento_importaciones WHERE periodo_desde IS NOT NULL
    ORDER BY periodo_desde DESC LIMIT 1
  `);
  if (!ult) { const e = new Error('No hay requerimientos de PDF cargados'); e.status = 400; throw e; }
  const desde = `${ult.anio}-${ult.sem === 1 ? '01-01' : '07-01'}`;
  const hasta = `${ult.anio}-${ult.sem === 1 ? '06-30' : '12-31'}`;
  const result = await query(`
    INSERT IGNORE INTO requerimiento_manual (anio, semestre, codigo, droga, descripcion, cantidad, creado_por)
    SELECT :anio, :semestre, ri.codigo, MAX(ri.droga), MAX(LEFT(ri.descripcion, 500)), 0, :usuarioId
    FROM requerimiento_items ri JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    WHERE i.periodo_desde BETWEEN :desde AND :hasta
    GROUP BY ri.codigo
  `, { anio, semestre, usuarioId, desde, hasta });
  const origen = `${ult.sem === 1 ? '1er' : '2do'} semestre ${ult.anio}`;
  await audit(usuarioId, 'copiar_requerimiento_manual', 'requerimiento_manual', null, { anio, semestre, origen, insertados: result.affectedRows });
  return { insertados: result.affectedRows, origen };
}

// Datos para las columnas opcionales de la carga manual, por codigo (solo los codigos cargados en el anio).
// Consumo = Analisis Trimestral (todos los sectores), que cubre 2024-2026 por trimestre.
async function columnasManual(anio, semestre) {
  const filas = await query('SELECT codigo, semestre, cantidad FROM requerimiento_manual WHERE anio = :anio', { anio });
  const codigos = Array.from(new Set(filas.map((f) => f.codigo)));
  const out = {};
  for (const c of codigos) out[c] = {};
  if (!codigos.length) return { datos: out, meta: {} };
  // Codigos equivalentes (cambios de codigo del Ministerio): los datos de toda la familia se suman
  const { todos, destinos } = await expandirCodigos(codigos);
  const inCod = todos.map((_, i) => ':c' + i).join(', ');
  const pc = Object.fromEntries(todos.map((c, i) => ['c' + i, c]));
  const dest = (codigo) => (destinos.get(codigo) || []).map((c) => out[c]).filter(Boolean);
  const set = (codigo, campo, valor) => { for (const d of dest(codigo)) d[campo] = valor; };
  const sumarA = (codigo, campo, valor) => { for (const d of dest(codigo)) d[campo] = (d[campo] || 0) + valor; };
  const sumarMinMax = (codigo, campo, valor) => { if (valor == null) return; for (const d of dest(codigo)) d[campo] = (d[campo] || 0) + valor; };
  const trims = semestre === 1 ? [1, 2] : [3, 4];
  const desde = `${anio}-${semestre === 1 ? '01-01' : '07-01'}`;
  const hasta = `${anio}-${semestre === 1 ? '06-30' : '12-31'}`;

  // Pedido manual: otro semestre y total del anio
  for (const f of filas) {
    const d = out[f.codigo];
    d.totalAnio = (d.totalAnio || 0) + Number(f.cantidad);
    if (Number(f.semestre) !== semestre) d.pedidoOtroSem = (d.pedidoOtroSem || 0) + Number(f.cantidad);
  }

  // Consumo por trimestre (Analisis Trimestral)
  const cons = await query(`
    SELECT ti.codigo_articulo codigo, i.anio, i.trimestre, SUM(ti.cantidad) cantidad
    FROM trimestre_items ti JOIN trimestre_importaciones i ON i.id = ti.trimestre_importacion_id
    WHERE ti.codigo_articulo IN (${inCod}) AND i.anio BETWEEN :a0 AND :a1
    GROUP BY ti.codigo_articulo, i.anio, i.trimestre
  `, { ...pc, a0: anio - 3, a1: anio + 1 });
  for (const r of cons) {
    const q = Number(r.cantidad || 0);
    if (r.anio === anio && trims.includes(r.trimestre)) sumarA(r.codigo, 'consumoSem', q);
    if (r.anio === anio - 1 && trims.includes(r.trimestre)) sumarA(r.codigo, 'consumoSemAnt', q);
    if (r.anio === anio - 2 && trims.includes(r.trimestre)) sumarA(r.codigo, 'consumoSemAnt2', q);
    if (r.anio === anio - 3 && trims.includes(r.trimestre)) sumarA(r.codigo, 'consumoSemAnt3', q);
    if (r.anio === anio + 1) sumarA(r.codigo, 'consumoAnioSig', q);
  }
  // Meses con datos en el semestre (para el promedio mensual)
  const [tri] = await query(`
    SELECT COUNT(DISTINCT trimestre) n FROM trimestre_importaciones WHERE anio = :anio AND trimestre IN (${trims.join(", ")})
  `, { anio });
  const mesesSem = Number(tri?.n || 0) * 3;

  // Requerimientos de PDF de los anios siguientes (por anio del periodo de consumo)
  const reqs = await query(`
    SELECT ri.codigo, YEAR(i.periodo_desde) anio, IF(MONTH(i.periodo_desde) <= 6, 1, 2) sem, SUM(ri.cantidad) cantidad
    FROM requerimiento_items ri JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    WHERE ri.codigo IN (${inCod}) AND i.periodo_desde IS NOT NULL
    GROUP BY ri.codigo, YEAR(i.periodo_desde), IF(MONTH(i.periodo_desde) <= 6, 1, 2)
  `, pc);
  for (const r of reqs) {
    const q = Number(r.cantidad);
    if (r.anio === anio + 1) {
      sumarA(r.codigo, 'reqAnioSig', q);
      sumarA(r.codigo, Number(r.sem) === 1 ? 'reqSigSem1' : 'reqSigSem2', q);
    }
    if (r.anio === anio + 2) sumarA(r.codigo, 'reqAnioSig2', q);
  }
  // Carga manual del anio siguiente (lo que se carga a mano en la columna «Pedido ... anio siguiente»),
  // por codigo exacto; el frontend lo suma a lo de los PDF.
  const manSig = await query(`
    SELECT id, codigo, semestre, cantidad FROM requerimiento_manual
    WHERE anio = :anioSig AND codigo IN (${codigos.map((_, i) => ':m' + i).join(', ')})
  `, { ...Object.fromEntries(codigos.map((c, i) => ['m' + i, c])), anioSig: anio + 1 });
  for (const r of manSig) {
    const q = Number(r.cantidad || 0);
    const sem = Number(r.semestre) === 1 ? 1 : 2;
    if (out[r.codigo]) {
      out[r.codigo][`manSigSem${sem}`] = q;
      out[r.codigo][`manSigSem${sem}Id`] = r.id;
    }
  }
  // Justiprecio: el del requerimiento mas reciente que lo tenga
  const precios = await query(`
    SELECT ri.codigo, ri.justiprecio
    FROM requerimiento_items ri JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    WHERE ri.codigo IN (${inCod}) AND ri.justiprecio IS NOT NULL
    ORDER BY i.periodo_desde DESC, i.id DESC
  `, pc);
  for (const r of precios) for (const d of dest(r.codigo)) if (d.justiprecio == null) d.justiprecio = Number(r.justiprecio);

  // Stock actual (ultima descarga ok, suma de sectores)
  const [stk] = await query("SELECT id, fecha_stock FROM stock_actual_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
  if (stk) {
    const rows = await query(`
      SELECT codigo, SUM(stock) stock, SUM(stock_minimo) minimo, SUM(stock_maximo) maximo
      FROM stock_actual_items WHERE descarga_id = :id AND codigo IN (${inCod}) GROUP BY codigo
    `, { id: stk.id, ...pc });
    for (const r of rows) {
      sumarA(r.codigo, 'stockActual', Number(r.stock || 0));
      sumarMinMax(r.codigo, 'minMs', r.minimo == null ? null : Number(r.minimo));
      sumarMinMax(r.codigo, 'maxMs', r.maximo == null ? null : Number(r.maximo));
    }
  }
  // Min/max sugerido
  const sug = await query(`SELECT codigo_articulo codigo, stock_minimo, stock_maximo FROM stock_sugeridos WHERE codigo_articulo IN (${inCod})`, pc);
  for (const r of sug) {
    set(r.codigo, 'minSug', r.stock_minimo == null ? null : Number(r.stock_minimo));
    set(r.codigo, 'maxSug', r.stock_maximo == null ? null : Number(r.stock_maximo));
  }

  // Proximo vencimiento (ultima descarga ok, desde hoy, con stock)
  const [ven] = await query("SELECT id FROM venc_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
  if (ven) {
    const rows = await query(`
      SELECT codigo, DATE_FORMAT(vencimiento, '%Y-%m-%d') vto, SUM(stock) cantidad
      FROM venc_items
      WHERE descarga_id = :id AND codigo IN (${inCod}) AND vencimiento >= CURDATE() AND stock > 0
      GROUP BY codigo, vencimiento ORDER BY vencimiento
    `, { id: ven.id, ...pc });
    for (const r of rows) {
      for (const d of dest(r.codigo)) {
        if (!d.proxVto) { d.proxVto = r.vto; d.proxVtoCant = 0; }
        if (d.proxVto === r.vto) d.proxVtoCant += Number(r.cantidad || 0);
        // Todos los vencimientos con stock (fecha y unidades), del mas cercano al mas lejano
        if (!d.vtos) d.vtos = [];
        const ya = d.vtos.find((x) => x.vto === r.vto);
        if (ya) ya.cant += Number(r.cantidad || 0); else d.vtos.push({ vto: r.vto, cant: Number(r.cantidad || 0) });
      }
    }
  }

  // O.C. del mismo anio + semestre (historial de Drive)
  const ocs = await query(`
    SELECT codigo, SUM(cantidad) pedida, SUM(entregada) entregada
    FROM oc_historial WHERE anio = :anio AND semestre = :semestre AND codigo IN (${inCod}) GROUP BY codigo
  `, { anio, semestre, ...pc });
  for (const r of ocs) {
    sumarA(r.codigo, 'ocPedida', Number(r.pedida || 0));
    sumarA(r.codigo, 'ocEntregada', Number(r.entregada || 0));
  }

  // Bajas del semestre (descarte / vencimiento)
  const bajas = await query(`
    SELECT codigo, SUM(cantidad) cantidad FROM bajas_ms
    WHERE codigo IN (${inCod}) AND fecha BETWEEN :desde AND :hasta GROUP BY codigo
  `, { ...pc, desde, hasta });
  for (const r of bajas) sumarA(r.codigo, 'bajasSem', Number(r.cantidad || 0));

  return { datos: out, meta: { mesesSem, stockFecha: stk?.fecha_stock || null } };
}

// ---------------- Comparacion carga manual (anio) vs PDF de requerimiento del mismo semestre del anio siguiente ----------------
// Para cada renglon que difiere entre los dos anios dice el motivo probable:
//  soloEste (pedido en anio y no en anio+1):
//   cambioCodigo  = el mismo producto esta en el PDF con otro codigo (no es una diferencia real)
//   minNo         = el Ministerio dijo NO comprar ese codigo
//   minNoNuevo    = el Ministerio dijo NO comprar el mismo producto con otro codigo
//   otraConc      = en el PDF esta la misma droga en otra concentracion / presentacion
//   sinNada       = no hay nada de esa droga en el PDF ni en la comunicacion del Ministerio
//  soloSig (pedido en anio+1 y en 0 en anio):
//   reemplaza     = es el codigo nuevo de un producto que en anio se pidio con el codigo viejo
//   minNoPedido   = esta en el PDF aunque el Ministerio dijo NO comprar
//   otraConcSig   = en anio se pidio la misma droga en otra concentracion / presentacion
//   nuevo         = no se pedia en anio
async function comparacionManual(anio, semestre) {
  const sig = anio + 1;
  const desde = `${sig}-${semestre === 1 ? '01-01' : '07-01'}`;
  const hasta = `${sig}-${semestre === 1 ? '06-30' : '12-31'}`;
  const manual = await query('SELECT codigo, droga, descripcion, cantidad FROM requerimiento_manual WHERE anio = :anio AND semestre = :semestre', { anio, semestre });
  const pdf = await query(`
    SELECT ri.codigo, MAX(ri.droga) droga, MAX(LEFT(ri.descripcion, 500)) descripcion, SUM(ri.cantidad) cantidad,
      GROUP_CONCAT(DISTINCT i.archivo_nombre ORDER BY i.archivo_nombre SEPARATOR ', ') archivos,
      GROUP_CONCAT(CONCAT(REPLACE(i.archivo_nombre, '.pdf', ''), IF(ri.hoja IS NULL, '', CONCAT(' · hoja ', ri.hoja)), ' · ítem ', ri.item_nro)
        ORDER BY i.archivo_nombre, ri.item_nro SEPARATOR ' | ') donde
    FROM requerimiento_items ri JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    WHERE i.periodo_desde BETWEEN :desde AND :hasta GROUP BY ri.codigo
  `, { desde, hasta });
  const [com] = await query(
    'SELECT id, archivo_nombre, periodo_texto FROM ministerio_comunicaciones WHERE anio = :sig AND semestre = :semestre ORDER BY id DESC LIMIT 1',
    { sig, semestre }
  );
  const minItems = com ? await query('SELECT codigo, medicamento, habilitado, decision FROM ministerio_items WHERE comunicacion_id = :id', { id: com.id }) : [];
  const fam = await familias();
  const grupo = (c) => fam.get(c) || [c];
  // Pares marcados «No es» en Codigos equivalentes: nunca se toman como el mismo producto
  const noEs = new Set((await query("SELECT codigo_a, codigo_b FROM codigo_equivalencias WHERE estado = 'distinto'"))
    .flatMap((r) => [`${r.codigo_a}|${r.codigo_b}`, `${r.codigo_b}|${r.codigo_a}`]));
  const marcadoNoEs = (c1, c2) => grupo(c1).some((x) => grupo(c2).some((y) => noEs.has(`${x}|${y}`)));
  // Solo los marcados con «No es la misma droga» desde la carga del requerimiento cuentan como revisados (no se pide)
  const revisado = new Set((await query("SELECT codigo_a, codigo_b FROM codigo_equivalencias WHERE estado = 'distinto' AND nota = 'revisado-requerimiento'"))
    .flatMap((r) => [`${r.codigo_a}|${r.codigo_b}`, `${r.codigo_b}|${r.codigo_a}`]));
  const marcadoRevisado = (c1, c2) => grupo(c1).some((x) => grupo(c2).some((y) => revisado.has(`${x}|${y}`)));
  const qPdf = new Map(pdf.map((p) => [p.codigo, Number(p.cantidad || 0)]));
  // Lo cargado a mano para el mismo semestre de anio + 1 REEMPLAZA a lo de los PDF (tambien un 0)
  const qMan = new Map();
  for (const m of await query('SELECT codigo, cantidad FROM requerimiento_manual WHERE anio = :sig AND semestre = :semestre', { sig, semestre })) {
    qMan.set(m.codigo, (qMan.get(m.codigo) || 0) + Number(m.cantidad));
  }
  const qPdfFam = (c) => {
    const g = grupo(c);
    const m = g.some((x) => qMan.has(x));
    return g.reduce((s, x) => s + ((m ? qMan.get(x) : qPdf.get(x)) || 0), 0);
  };
  const minPorCod = new Map(minItems.map((m) => [m.codigo, m]));
  const minFam = (c) => grupo(c).map((x) => minPorCod.get(x)).find(Boolean) || null;

  const perfiles = await cargarPerfiles(manual);
  const drogasSolas = perfiles.values().next().value?.drogasSolas || new Set();
  const pf = (codigo, droga, descripcion) => perfiles.get(codigo) || perfil({ codigo, droga: droga || '', descripcion: descripcion || '' }, drogasSolas);
  // La comunicacion del Ministerio solo trae el texto: la droga es lo de antes del primer numero, mas las "+ OTRA" de las combinaciones
  const drogaMin = (t) => {
    const s = String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    return [s.split(/\d/)[0], ...Array.from(s.matchAll(/\+\s*([A-Z][A-Z ]*)/g), (x) => x[1])].join(' + ');
  };
  const pfMin = (m) => perfil({ codigo: m.codigo, droga: drogaMin(m.medicamento), descripcion: m.medicamento || '' }, drogasSolas);
  const mismoProducto = (r) => r.droga === 'si' && r.ok && (r.concentracion === 'si' || r.nivel === 'alta');
  // Misma droga y misma cantidad pedida: es el mismo producto si la forma farmaceutica no es distinta
  // (comprimido vs inyectable si cuenta; el volumen o la concentracion no, porque la descripcion vieja suele tener errores)
  const LIQ = new Set(['jarabe', 'suspensión oral', 'solución oral', 'gotas']);
  const CAPS = new Set(['cápsula', 'comprimido']);
  const mismaForma = (pa, pb) => !pa.forma || !pb.forma || pa.forma === pb.forma || (LIQ.has(pa.forma) && LIQ.has(pb.forma)) || (CAPS.has(pa.forma) && CAPS.has(pb.forma));
  const mismaCantidad = (pa, pb, q1, q2) => Number(q1) > 0 && Number(q1) === Number(q2) && mismaForma(pa, pb);
  const fmt = (n) => Number(n || 0).toLocaleString('es-AR');
  const desc = (x) => String(x.descripcion || x.droga || '').slice(0, 90);

  // Para el motivo se mira solo el PDF: asi un renglon con presentacion nueva cargada a mano sigue mostrando las otras presentaciones
  const qSoloPdfFam = (c) => grupo(c).reduce((s, x) => s + (qPdf.get(x) || 0), 0);
  // En la lista: sin nada en el PDF, o puesto en 0 a mano para el año siguiente aunque el PDF lo pida
  const ceroAMano = (c) => grupo(c).some((x) => qMan.has(x)) && qPdfFam(c) === 0 && qSoloPdfFam(c) > 0;
  const soloEste = manual.filter((f) => Number(f.cantidad) > 0 && (qSoloPdfFam(f.codigo) === 0 || ceroAMano(f.codigo)));
  const soloSig = manual.filter((f) => Number(f.cantidad) === 0 && qPdfFam(f.codigo) > 0);
  const out = {};

  for (const f of soloEste) {
    if (ceroAMano(f.codigo)) { out[f.codigo] = { lado: 'soloEste', motivo: 'ceroAMano', rel: `El PDF ${sig} pide ${fmt(qSoloPdfFam(f.codigo))}; lo pusiste en 0 a mano.` }; continue; }
    const a = pf(f.codigo, f.droga, f.descripcion);
    const enFam = new Set(grupo(f.codigo));
    const mi = minFam(f.codigo);
    // Candidatos del PDF del anio siguiente con la misma droga
    const cands = pdf.filter((p) => !enFam.has(p.codigo) && Number(p.cantidad) > 0).map((p) => { const b = pf(p.codigo, p.droga, p.descripcion); return { p, b, r: comparar(a, b) }; })
      .filter((x) => x.r.droga === 'si');
    const mismos = cands.filter((x) => !marcadoNoEs(f.codigo, x.p.codigo) && (mismoProducto(x.r) || mismaCantidad(a, x.b, x.p.cantidad, f.cantidad)));
    let motivo; let rel = ''; let codigos;
    if (mi && mi.decision === 'no') { motivo = 'minNo'; rel = `Ministerio: «${mi.habilitado}» (${mi.codigo})`; }
    else if (mismos.length) {
      motivo = 'cambioCodigo';
      rel = mismos.map((x) => `${x.p.codigo} ${desc(x.p)} (${sig}: ${fmt(x.p.cantidad)})`).join(' · ');
      codigos = mismos.map((x) => ({ codigo: x.p.codigo, cantidad: Number(x.p.cantidad), descripcion: String(x.p.descripcion || x.p.droga || ''), archivos: x.p.archivos || '', donde: x.p.donde || '' }));
    } else {
      const minMismos = minItems.filter((m) => m.decision === 'no' && !enFam.has(m.codigo)).map((m) => ({ m, r: comparar(a, pfMin(m)) })).filter((x) => mismoProducto(x.r));
      if (minMismos.length) { motivo = 'minNoNuevo'; rel = minMismos.map((x) => `${x.m.codigo} ${x.m.medicamento} → Ministerio: «${x.m.habilitado}»`).join(' · '); }
      else if (cands.length) {
        // Si ya se marco «No es la misma droga» con todos los candidatos: revisado, no se pide en anio + 1
        const noEsTodos = cands.every((x) => marcadoRevisado(f.codigo, x.p.codigo));
        motivo = noEsTodos ? 'revisadoNo' : 'otraConc';
        rel = cands.map((x) => `${x.p.codigo} ${desc(x.p)} (${sig}: ${fmt(x.p.cantidad)})`).join(' · ');
        codigos = cands.map((x) => ({ codigo: x.p.codigo, cantidad: Number(x.p.cantidad), descripcion: String(x.p.descripcion || x.p.droga || ''), archivos: x.p.archivos || '', donde: x.p.donde || '', noEs: marcadoRevisado(f.codigo, x.p.codigo) }));
      }
      else {
        motivo = 'sinNada';
        const minDroga = minItems.map((m) => ({ m, r: comparar(a, pfMin(m)) })).filter((x) => x.r.droga === 'si');
        if (minDroga.length) rel = `Ministerio menciona otra presentación: ${minDroga.map((x) => `${x.m.codigo} ${x.m.medicamento} «${x.m.habilitado}»`).join(' · ')}`;
      }
    }
    // Sin nada en el PDF y puesto en 0 a mano para el año siguiente: se decidio no agregarlo
    if (motivo === 'sinNada' && grupo(f.codigo).some((x) => qMan.has(x)) && qPdfFam(f.codigo) === 0) {
      motivo = 'noAgregar';
      rel = `Decidiste no agregarlo al requerimiento ${sig} (queda en 0).`;
    }
    out[f.codigo] = { lado: 'soloEste', motivo, rel, ...(codigos ? { codigos } : {}) };
  }
  // Stock actual del producto del PDF (sumando sus codigos atados), para verlo antes de atarlo
  const conCodigos = Object.values(out).flatMap((o) => o.codigos || []);
  if (conCodigos.length) {
    const [stk] = await query("SELECT id FROM stock_actual_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
    const todos = Array.from(new Set(conCodigos.flatMap((c) => grupo(c.codigo))));
    const porCod = new Map();
    if (stk) {
      const ph = todos.map((_, i) => ':s' + i).join(', ');
      for (const r of await query(`SELECT codigo, SUM(stock) stock FROM stock_actual_items WHERE descarga_id = :id AND codigo IN (${ph}) GROUP BY codigo`,
        { id: stk.id, ...Object.fromEntries(todos.map((c, i) => ['s' + i, c])) })) porCod.set(r.codigo, Number(r.stock || 0));
    }
    // Consumo del mismo semestre por año (Analisis Trimestral) y como se llama cada codigo atado, para comparar antes de atar
    const trims = semestre === 1 ? [1, 2] : [3, 4];
    const phT = todos.map((_, i) => ':t' + i).join(', ');
    const pT = Object.fromEntries(todos.map((c, i) => ['t' + i, c]));
    const consumo = new Map(); // codigo -> {anio: cantidad}
    const nombres = new Map(); // codigo -> {nombre, sectores:Set}
    for (const r of await query(`
      SELECT ti.codigo_articulo codigo, i.anio, i.trimestre, i.sector, SUM(ti.cantidad) cantidad,
        MAX(TRIM(CONCAT_WS(' ', ti.nombre_generico, ti.concentracion, ti.forma))) nombre
      FROM trimestre_items ti JOIN trimestre_importaciones i ON i.id = ti.trimestre_importacion_id
      WHERE ti.codigo_articulo IN (${phT}) AND i.anio BETWEEN :a0 AND :a1
      GROUP BY ti.codigo_articulo, i.anio, i.trimestre, i.sector
    `, { ...pT, a0: anio - 3, a1: anio })) {
      if (!nombres.has(r.codigo)) nombres.set(r.codigo, { nombre: r.nombre, sectores: new Set() });
      const n = nombres.get(r.codigo);
      if (Number(r.cantidad) > 0) n.sectores.add(String(r.sector || '').toLowerCase());
      if (!trims.includes(Number(r.trimestre))) continue;
      if (!consumo.has(r.codigo)) consumo.set(r.codigo, {});
      const m = consumo.get(r.codigo);
      m[r.anio] = (m[r.anio] || 0) + Number(r.cantidad || 0);
    }
    const descReq = new Map((await query(`SELECT codigo, MAX(LEFT(descripcion, 200)) d FROM requerimiento_items WHERE codigo IN (${phT}) GROUP BY codigo`, pT)).map((r) => [r.codigo, r.d]));
    const descMan = new Map((await query(`SELECT codigo, MAX(COALESCE(descripcion, droga)) d FROM requerimiento_manual WHERE codigo IN (${phT}) GROUP BY codigo`, pT)).map((r) => [r.codigo, r.d]));
    const descStk = new Map((await query(`SELECT codigo, MAX(TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma))) d FROM stock_actual_items WHERE codigo IN (${phT}) GROUP BY codigo`, pT)).map((r) => [r.codigo, r.d]));
    const descDe = (x) => nombres.get(x)?.nombre || descReq.get(x) || descMan.get(x) || descStk.get(x) || `sin descripción (código ${x})`;
    for (const c of conCodigos) {
      const g = grupo(c.codigo);
      c.atados = g.filter((x) => x !== c.codigo);
      c.stock = stk && g.some((x) => porCod.has(x)) ? g.reduce((sum, x) => sum + (porCod.get(x) || 0), 0) : null;
      c.consumo = {};
      for (let y = anio - 3; y <= anio; y++) {
        const tiene = g.some((x) => consumo.get(x)?.[y] != null);
        c.consumo[y] = tiene ? g.reduce((sum, x) => sum + (consumo.get(x)?.[y] || 0), 0) : null;
      }
      c.productos = g.map((x) => ({
        descripcion: descDe(x),
        sectores: Array.from(nombres.get(x)?.sectores || []),
        consumo: Object.fromEntries(Array.from({ length: 4 }, (_, i) => anio - 3 + i).map((y) => [y, consumo.get(x)?.[y] ?? null]))
      }));
    }
  }

  for (const f of soloSig) {
    const a = pf(f.codigo, f.droga, f.descripcion);
    const enFam = new Set(grupo(f.codigo));
    const mi = minFam(f.codigo);
    const q = qPdfFam(f.codigo);
    const cands = manual.filter((m) => !enFam.has(m.codigo) && Number(m.cantidad) > 0).map((m) => { const b = pf(m.codigo, m.droga, m.descripcion); return { m, b, r: comparar(a, b) }; })
      .filter((x) => x.r.droga === 'si');
    // El codigo viejo tiene que haber quedado sin pedir en el anio siguiente
    const mismos = cands.filter((x) => qPdfFam(x.m.codigo) === 0 && !marcadoNoEs(f.codigo, x.m.codigo) && (mismoProducto(x.r) || mismaCantidad(a, x.b, x.m.cantidad, q)));
    let motivo; let rel = '';
    if (mismos.length) { motivo = 'reemplaza'; rel = `Código nuevo de: ${mismos.map((x) => `${x.m.codigo} ${desc(x.m)} (${anio}: ${fmt(x.m.cantidad)})`).join(' · ')}`; }
    else if (mi && mi.decision === 'no') { motivo = 'minNoPedido'; rel = `Ministerio: «${mi.habilitado}» (${mi.codigo}) pero está en el PDF`; }
    else if (cands.length) { motivo = 'otraConcSig'; rel = `En ${anio} se pidió: ${cands.map((x) => `${x.m.codigo} ${desc(x.m)} (${fmt(x.m.cantidad)})`).join(' · ')}`; }
    else motivo = 'nuevo';
    out[f.codigo] = { lado: 'soloSig', motivo, rel };
  }
  return { porCodigo: out, ministerio: com ? { archivo: com.archivo_nombre, periodo: com.periodo_texto, items: minItems.length } : null };
}

// Columnas elegibles del Analisis de Requerimiento: datos por codigo abiertos por semestre ('YYYY-S')
async function columnasPorCodigos(codigosEntrada) {
  const codigos = Array.from(new Set((codigosEntrada || []).map((c) => String(c || '').trim()).filter(Boolean))).slice(0, 3000);
  const out = {};
  for (const c of codigos) out[c] = { consumo: {}, manual: {}, req: {}, ocPedida: {}, ocEntregada: {}, bajas: {} };
  const meta = { mesesConsumo: {}, ciclosConsumo: [], ciclosManual: [], ciclosReq: [], ciclosOc: [], ciclosBajas: [], stockFecha: null };
  if (!codigos.length) return { datos: out, meta };
  // Codigos equivalentes (cambios de codigo del Ministerio): los datos de toda la familia se suman
  const { todos, destinos } = await expandirCodigos(codigos);
  const inCod = todos.map((_, i) => ':c' + i).join(', ');
  const pc = Object.fromEntries(todos.map((c, i) => ['c' + i, c]));
  const dest = (codigo) => (destinos.get(codigo) || []).map((c) => out[c]).filter(Boolean);
  const set = (codigo, campo, valor) => { for (const d of dest(codigo)) d[campo] = valor; };
  const sumarA = (codigo, campo, valor) => { for (const d of dest(codigo)) d[campo] = (d[campo] || 0) + valor; };
  const sumarMinMax = (codigo, campo, valor) => { if (valor == null) return; for (const d of dest(codigo)) d[campo] = (d[campo] || 0) + valor; };
  const sumar = (codigo, campo, ciclo, valor) => {
    for (const d of dest(codigo)) d[campo][ciclo] = (d[campo][ciclo] || 0) + valor;
  };
  const orden = (s) => Array.from(s).sort();

  // Consumo por semestre (Analisis Trimestral, todos los sectores)
  const trims = await query('SELECT anio, trimestre FROM trimestre_importaciones GROUP BY anio, trimestre');
  const ciclosCons = new Set();
  for (const t of trims) {
    const ciclo = `${t.anio}-${t.trimestre <= 2 ? 1 : 2}`;
    ciclosCons.add(ciclo);
    meta.mesesConsumo[ciclo] = (meta.mesesConsumo[ciclo] || 0) + 3;
  }
  meta.ciclosConsumo = orden(ciclosCons);
  const cons = await query(`
    SELECT ti.codigo_articulo codigo, i.anio, i.trimestre, SUM(ti.cantidad) cantidad
    FROM trimestre_items ti JOIN trimestre_importaciones i ON i.id = ti.trimestre_importacion_id
    WHERE ti.codigo_articulo IN (${inCod})
    GROUP BY ti.codigo_articulo, i.anio, i.trimestre
  `, pc);
  for (const r of cons) sumar(r.codigo, 'consumo', `${r.anio}-${r.trimestre <= 2 ? 1 : 2}`, Number(r.cantidad || 0));

  // Carga manual (ej. 2025) por semestre
  const man = await query(`SELECT codigo, anio, semestre, SUM(cantidad) cantidad FROM requerimiento_manual WHERE codigo IN (${inCod}) GROUP BY codigo, anio, semestre`, pc);
  const ciclosMan = new Set((await query('SELECT DISTINCT anio, semestre FROM requerimiento_manual')).map((r) => `${r.anio}-${r.semestre}`));
  for (const r of man) sumar(r.codigo, 'manual', `${r.anio}-${r.semestre}`, Number(r.cantidad || 0));
  meta.ciclosManual = orden(ciclosMan);

  // Requerimientos de PDF por ciclo (semestre del periodo de consumo)
  const reqs = await query(`
    SELECT ri.codigo, YEAR(i.periodo_desde) anio, IF(MONTH(i.periodo_desde) <= 6, 1, 2) sem, SUM(ri.cantidad) cantidad
    FROM requerimiento_items ri JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    WHERE ri.codigo IN (${inCod}) AND i.periodo_desde IS NOT NULL
    GROUP BY ri.codigo, YEAR(i.periodo_desde), IF(MONTH(i.periodo_desde) <= 6, 1, 2)
  `, pc);
  const ciclosReq = new Set((await query(`
    SELECT DISTINCT YEAR(periodo_desde) anio, IF(MONTH(periodo_desde) <= 6, 1, 2) sem FROM requerimiento_importaciones WHERE periodo_desde IS NOT NULL
  `)).map((r) => `${r.anio}-${r.sem}`));
  for (const r of reqs) sumar(r.codigo, 'req', `${r.anio}-${r.sem}`, Number(r.cantidad || 0));
  meta.ciclosReq = orden(ciclosReq);

  // Stock actual (ultima descarga ok, suma de sectores)
  const [stk] = await query("SELECT id, fecha_stock FROM stock_actual_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
  if (stk) {
    meta.stockFecha = stk.fecha_stock || null;
    const rows = await query(`
      SELECT codigo, SUM(stock) stock, SUM(stock_minimo) minimo, SUM(stock_maximo) maximo
      FROM stock_actual_items WHERE descarga_id = :id AND codigo IN (${inCod}) GROUP BY codigo
    `, { id: stk.id, ...pc });
    for (const r of rows) {
      sumarA(r.codigo, 'stockActual', Number(r.stock || 0));
      sumarMinMax(r.codigo, 'minMs', r.minimo == null ? null : Number(r.minimo));
      sumarMinMax(r.codigo, 'maxMs', r.maximo == null ? null : Number(r.maximo));
    }
  }
  const sug = await query(`SELECT codigo_articulo codigo, stock_minimo, stock_maximo FROM stock_sugeridos WHERE codigo_articulo IN (${inCod})`, pc);
  for (const r of sug) {
    set(r.codigo, 'minSug', r.stock_minimo == null ? null : Number(r.stock_minimo));
    set(r.codigo, 'maxSug', r.stock_maximo == null ? null : Number(r.stock_maximo));
  }

  // Proximo vencimiento (ultima descarga ok, desde hoy, con stock)
  const [ven] = await query("SELECT id FROM venc_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
  if (ven) {
    const rows = await query(`
      SELECT codigo, DATE_FORMAT(vencimiento, '%Y-%m-%d') vto, SUM(stock) cantidad
      FROM venc_items
      WHERE descarga_id = :id AND codigo IN (${inCod}) AND vencimiento >= CURDATE() AND stock > 0
      GROUP BY codigo, vencimiento ORDER BY vencimiento
    `, { id: ven.id, ...pc });
    for (const r of rows) {
      for (const d of dest(r.codigo)) {
        if (!d.proxVto) { d.proxVto = r.vto; d.proxVtoCant = 0; }
        if (d.proxVto === r.vto) d.proxVtoCant += Number(r.cantidad || 0);
        // Todos los vencimientos con stock (fecha y unidades), del mas cercano al mas lejano
        if (!d.vtos) d.vtos = [];
        const ya = d.vtos.find((x) => x.vto === r.vto);
        if (ya) ya.cant += Number(r.cantidad || 0); else d.vtos.push({ vto: r.vto, cant: Number(r.cantidad || 0) });
      }
    }
  }

  // O.C. por anio + semestre
  const ocs = await query(`
    SELECT codigo, anio, semestre, SUM(cantidad) pedida, SUM(entregada) entregada
    FROM oc_historial WHERE codigo IN (${inCod}) AND anio IS NOT NULL AND semestre IN (1, 2)
    GROUP BY codigo, anio, semestre
  `, pc);
  const ciclosOc = new Set((await query('SELECT DISTINCT anio, semestre FROM oc_historial WHERE anio IS NOT NULL AND semestre IN (1, 2)')).map((r) => `${r.anio}-${r.semestre}`));
  for (const r of ocs) {
    sumar(r.codigo, 'ocPedida', `${r.anio}-${r.semestre}`, Number(r.pedida || 0));
    sumar(r.codigo, 'ocEntregada', `${r.anio}-${r.semestre}`, Number(r.entregada || 0));
  }
  meta.ciclosOc = orden(ciclosOc);

  // Bajas por semestre (descarte / vencimiento)
  const bajas = await query(`
    SELECT codigo, YEAR(fecha) anio, IF(MONTH(fecha) <= 6, 1, 2) sem, SUM(cantidad) cantidad
    FROM bajas_ms WHERE codigo IN (${inCod}) AND fecha IS NOT NULL
    GROUP BY codigo, YEAR(fecha), IF(MONTH(fecha) <= 6, 1, 2)
  `, pc);
  const ciclosBajas = new Set((await query(`
    SELECT DISTINCT YEAR(fecha) anio, IF(MONTH(fecha) <= 6, 1, 2) sem FROM bajas_ms WHERE fecha IS NOT NULL
  `)).map((r) => `${r.anio}-${r.sem}`));
  for (const r of bajas) sumar(r.codigo, 'bajas', `${r.anio}-${r.sem}`, Number(r.cantidad || 0));
  meta.ciclosBajas = orden(ciclosBajas);

  return { datos: out, meta };
}

async function marcarControladoManual(id, controlado, usuarioId) {
  const result = await query('UPDATE requerimiento_manual SET controlado = :controlado WHERE id = :id', { id, controlado: controlado ? 1 : 0 });
  if (result.affectedRows) await audit(usuarioId, 'controlado_requerimiento_manual', 'requerimiento_manual', id, { controlado: !!controlado });
  return result.affectedRows;
}

async function eliminarManual(id, usuarioId) {
  const result = await query('DELETE FROM requerimiento_manual WHERE id = :id', { id });
  if (result.affectedRows) await audit(usuarioId, 'eliminar_requerimiento_manual', 'requerimiento_manual', id, {});
  return result.affectedRows;
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
  eliminarImportacion,
  catalogoFarmacos,
  listarManual,
  guardarManual,
  eliminarManual,
  gruposFuentes,
  cargarFuentes,
  marcarControladoManual,
  columnasManual,
  comparacionManual,
  columnasPorCodigos,
  copiarDesdeRequerimientoNuevo
};
