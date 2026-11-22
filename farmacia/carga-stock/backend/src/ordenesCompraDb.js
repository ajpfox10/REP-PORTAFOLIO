const { query, transaction } = require('./db');
const { parseOrdenCompra, borradorDesdeOcr, hashArchivo, claveOc, OPCIONES_COMPLETO, COMPLETO_OK } = require('./ordenesCompraExcel');
const { ocrPdf } = require('./ocOcr');

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
      completo ENUM('SI','NO','CAMBIO','DESAFECTADO','A REVISAR') NULL,
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
  // COMPLETO paso de SI/NO a tener tambien CAMBIO, DESAFECTADO y A REVISAR
  const [completoCol] = await query(`
    SELECT COLUMN_TYPE AS tipo FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oc_renglones' AND COLUMN_NAME = 'completo'
  `);
  if (completoCol && !OPCIONES_COMPLETO.every((o) => String(completoCol.tipo).toUpperCase().includes(`'${o}'`))) {
    await query(`ALTER TABLE oc_renglones MODIFY completo ENUM(${OPCIONES_COMPLETO.map((o) => `'${o}'`).join(',')}) NULL`);
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
  // O.C. traidas del Excel de Drive (sin PDF): su estado lo dice la col L (COMPLETA / INCOMPLETA) del Excel
  const ordenCols = (await query(`
    SELECT COLUMN_NAME AS col FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oc_ordenes' AND COLUMN_NAME IN ('origen', 'estado_planilla')
  `)).map((r) => r.col);
  if (!ordenCols.includes('origen')) {
    await query("ALTER TABLE oc_ordenes ADD COLUMN origen ENUM('pdf','excel') NOT NULL DEFAULT 'pdf' AFTER archivo_hash");
    await query("UPDATE oc_ordenes SET origen = 'excel' WHERE archivo_nombre LIKE 'Excel de Drive (%'");
  }
  if (!ordenCols.includes('estado_planilla')) {
    await query("ALTER TABLE oc_ordenes ADD COLUMN estado_planilla ENUM('COMPLETA','INCOMPLETA') NULL AFTER origen");
  }
  // Opciones de COMPLETO ya puestas en el desplegable del archivo de Drive (si cambian, se reescribe)
  const listaCol = await query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oc_drive_config' AND COLUMN_NAME = 'lista_completo'
  `);
  if (!listaCol.length) {
    await query('ALTER TABLE oc_drive_config ADD COLUMN lista_completo VARCHAR(200) NULL AFTER activo');
  }
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
  // Entregas parciales de los renglones de O.C. INCOMPLETAS: cada "salieron 1000" es una fila.
  // origen 'anterior' = lo que el renglon ya tenia cargado antes de la primera entrega (no se pierde)
  await query(`
    CREATE TABLE IF NOT EXISTS oc_entregas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      renglon_id INT NOT NULL,
      cantidad INT NOT NULL,
      nro_ingreso VARCHAR(120) NULL,
      observacion VARCHAR(500) NULL,
      fecha DATE NOT NULL,
      origen ENUM('pagina','planilla','anterior') NOT NULL DEFAULT 'pagina',
      usuario_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_oc_entregas_renglon (renglon_id),
      CONSTRAINT fk_oc_entregas_renglon FOREIGN KEY (renglon_id) REFERENCES oc_renglones(id) ON DELETE CASCADE
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

// Inserta una O.C. ya leida (del PDF o confirmada desde un escaneo). Si el numero ya existe la marca duplicada.
async function guardarOrden(orden, name, hash, usuarioId) {
  return transaction(async (conn) => {
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
    // COMPLETO arranca en NO: nada entregado todavia (asi tambien queda en el Excel de Drive)
    for (const it of orden.renglones) {
      await conn.execute(
        `INSERT INTO oc_renglones (orden_id, renglon, codigo, descripcion, cantidad, importe_unitario, importe_total, completo)
         VALUES (:ordenId, :renglon, :codigo, :descripcion, :cantidad, :unitario, :total, 'NO')`,
        { ordenId: ins.insertId, renglon: it.renglon, codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad, unitario: it.unitario ?? null, total: it.total ?? null }
      );
    }
    await conn.execute(
      `INSERT INTO oc_archivos (archivo_hash, archivo_nombre, orden_id, estado, detalle, subido_por)
       VALUES (:hash, :name, :ordenId, 'cargado', :detalle, :usuarioId)`,
      { hash, name, ordenId: ins.insertId, detalle: orden.detalleArchivo || null, usuarioId: usuarioId || null }
    );
    return { name, estado: 'nuevo', oc: orden.oc, proveedor: orden.proveedor, renglones: orden.renglones.length, total: orden.subtotal };
  });
}

// Escaneos leidos por OCR que esperan la confirmacion del usuario: hash -> { name, buffer, borrador, ts }.
// En memoria: si se reinicia el backend hay que volver a importar el PDF (se vuelve a leer).
const escaneosPendientes = new Map();
const ESCANEO_TTL_MS = 12 * 60 * 60 * 1000;

function limpiarEscaneos() {
  const ahora = Date.now();
  for (const [hash, p] of escaneosPendientes) if (ahora - p.ts > ESCANEO_TTL_MS) escaneosPendientes.delete(hash);
}

async function leerEscaneo(name, buffer, hash) {
  limpiarEscaneos();
  const previo = escaneosPendientes.get(hash);
  if (previo) {
    previo.name = name;
    previo.ts = Date.now();
    return previo.borrador;
  }
  const borrador = borradorDesdeOcr(await ocrPdf(buffer));
  if (borrador.oc) escaneosPendientes.set(hash, { name, buffer, borrador, ts: Date.now() });
  return borrador;
}

function aEnteroPositivo(v) {
  const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function aImporte(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// El usuario reviso el borrador de un escaneo (numero, renglones, cantidades) y lo confirma
async function confirmarEscaneo(hash, datos, usuarioId) {
  limpiarEscaneos();
  const pendiente = escaneosPendientes.get(String(hash || ''));
  if (!pendiente) throw err(404, 'Ese escaneo ya no está pendiente: volvé a importar el PDF para leerlo de nuevo');
  const oc = String(datos?.oc || '').replace(/\s+/g, '').replace('-', '/');
  const m = oc.match(/^(\d{1,6})\/(\d{4})$/);
  if (!m) throw err(400, 'El N° de O.C. tiene que ser número/año, por ejemplo 500/2026');
  const fechaOk = (f) => !f || /^\d\d\/\d\d\/\d{4}$/.test(String(f).trim());
  if (!fechaOk(datos.fecha) || !fechaOk(datos.vence)) throw err(400, 'Las fechas tienen que ser DD/MM/AAAA');
  const lista = Array.isArray(datos.renglones) ? datos.renglones : [];
  if (!lista.length) throw err(400, 'La O.C. tiene que tener al menos un renglón');
  const vistos = new Set();
  const renglones = lista.map((r, i) => {
    const renglon = aEnteroPositivo(r.renglon);
    const cantidad = aEnteroPositivo(r.cantidad);
    const codigo = String(r.codigo || '').trim().toUpperCase().slice(0, 20);
    const descripcion = String(r.descripcion || '').replace(/\s+/g, ' ').trim();
    if (!renglon) throw err(400, `Fila ${i + 1}: falta el número de renglón`);
    if (vistos.has(renglon)) throw err(400, `El renglón ${renglon} está repetido`);
    vistos.add(renglon);
    if (!codigo) throw err(400, `Renglón ${renglon}: falta el código`);
    if (!descripcion) throw err(400, `Renglón ${renglon}: falta la descripción`);
    if (!cantidad) throw err(400, `Renglón ${renglon}: la cantidad tiene que ser un entero mayor a 0`);
    return { renglon, codigo, descripcion, cantidad, unitario: aImporte(r.unitario), total: aImporte(r.total) };
  }).sort((a, b) => a.renglon - b.renglon);
  const orden = {
    oc: `${Number(m[1])}/${m[2]}`,
    proveedor: String(datos.proveedor || '').trim().slice(0, 255),
    fecha: String(datos.fecha || '').trim(),
    vence: String(datos.vence || '').trim(),
    procedimiento: String(datos.procedimiento || '').trim().slice(0, 160),
    subtotal: renglones.reduce((a, r) => a + (r.total || 0), 0),
    renglones,
    detalleArchivo: 'Escaneada: leída por OCR y confirmada a mano'
  };
  const resultado = await guardarOrden(orden, pendiente.name, hash, usuarioId);
  escaneosPendientes.delete(hash);
  return { ...resultado, buffer: pendiente.buffer };
}

// archivos: [{ name, buffer }]. Devuelve por archivo: nuevo | ya_cargado | duplicado | revisar | error
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
    } catch (e) {
      if (!e.sinTexto) {
        resultados.push({ name, estado: 'error', detalle: e.message });
        continue;
      }
      // PDF escaneado: se lee con OCR y queda para que el usuario confirme numero y cantidades
      let borrador;
      try {
        borrador = await leerEscaneo(name, buffer, hash);
      } catch (ocrErr) {
        resultados.push({ name, estado: 'error', detalle: `Es un escaneo y no se pudo leer con OCR: ${ocrErr.message}` });
        continue;
      }
      if (!borrador.oc) {
        resultados.push({ name, estado: 'error', detalle: 'Es un escaneo y ni con OCR aparece el "Nro de O.C.": no parece una Orden de Compra' });
        continue;
      }
      const [ya] = await query('SELECT archivo_nombre FROM oc_ordenes WHERE numero = :numero', { numero: borrador.oc });
      if (ya) {
        resultados.push({ name, estado: 'duplicado', oc: borrador.oc, detalle: `Escaneo de la O.C. ${borrador.oc}, que ya está cargada desde "${ya.archivo_nombre}"` });
        continue;
      }
      resultados.push({
        name,
        estado: 'revisar',
        oc: borrador.oc,
        hash,
        borrador,
        detalle: `Escaneo leído por OCR (O.C. ${borrador.oc}, ${borrador.renglones.length} renglones): revisá el número y las cantidades y confirmá la carga`
      });
      continue;
    }

    resultados.push(await guardarOrden(orden, name, hash, usuarioId));
  }
  return resultados;
}

// Misma regla que la formula de la col L del Excel (formulaEstado en ordenesCompraDrive): con algun NO o
// A REVISAR es INCOMPLETA; COMPLETA cuando todos los renglones dicen SI, CAMBIO o DESAFECTADO
function estadoOrden(renglones) {
  return renglones.length && renglones.every((r) => COMPLETO_OK.includes(r.completo)) ? 'COMPLETA' : 'INCOMPLETA';
}

// Estado que se ve de la O.C.: las traidas del Excel de Drive usan lo que dice su col L
function estadoFinal({ origen, estadoPlanilla, estado }) {
  return origen === 'excel' && estadoPlanilla ? estadoPlanilla : estado;
}

// Ordenes con sus renglones, en el formato que usan la pantalla y el Excel
async function listarOrdenes() {
  const ordenes = await query(
    `SELECT id, numero, proveedor, fecha_oc, vence, procedimiento, subtotal, archivo_nombre, origen, estado_planilla, created_at
     FROM oc_ordenes`
  );
  const renglones = await query(
    `SELECT id, orden_id, renglon, codigo, descripcion, cantidad, cantidad_entregada, completo, nro_ingreso, observacion, updated_at
     FROM oc_renglones ORDER BY orden_id, renglon`
  );
  const entregas = await query(
    `SELECT e.id, e.renglon_id, e.cantidad, e.nro_ingreso, e.observacion, e.fecha, e.origen, u.username
     FROM oc_entregas e LEFT JOIN usuarios u ON u.id = e.usuario_id ORDER BY e.renglon_id, e.fecha, e.id`
  );
  const entregasDe = new Map();
  for (const e of entregas) {
    if (!entregasDe.has(e.renglon_id)) entregasDe.set(e.renglon_id, []);
    entregasDe.get(e.renglon_id).push({
      id: e.id, cantidad: e.cantidad, nroIngreso: e.nro_ingreso, observacion: e.observacion,
      fecha: deFecha(e.fecha), origen: e.origen, usuario: e.username || null
    });
  }
  const porOrden = new Map(ordenes.map((o) => [o.id, []]));
  for (const r of renglones) {
    porOrden.get(r.orden_id)?.push({
      entregas: entregasDe.get(r.id) || [],
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
      const estado = estadoOrden(items);
      // solo las O.C. INCOMPLETAS reciben entregas; las COMPLETAS no se tocan
      const incompleta = estadoFinal({ origen: o.origen, estadoPlanilla: o.estado_planilla, estado }) === 'INCOMPLETA';
      for (const it of items) it.admiteEntregas = incompleta && !COMPLETO_OK.includes(it.completo);
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
        origen: o.origen,
        estadoPlanilla: o.estado_planilla,
        estado,
        admiteEntregas: incompleta,
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
    if (!OPCIONES_COMPLETO.includes(v)) throw Object.assign(new Error(`Completo tiene que ser ${OPCIONES_COMPLETO.join(', ')}`), { status: 400 });
    return v;
  }
  const max = campo === 'nroIngreso' ? 120 : 500;
  return String(value).trim().slice(0, max);
}

async function actualizarRenglon(id, cambios, usuarioId) {
  // con entregas cargadas, la cantidad entregada es la suma de ellas: se cambia con + Entrega
  if (cambios.entregada !== undefined) {
    const [ren] = await query(
      'SELECT r.cantidad_entregada, (SELECT COUNT(*) FROM oc_entregas e WHERE e.renglon_id = r.id) AS n FROM oc_renglones r WHERE r.id = :id',
      { id }
    );
    if (ren && ren.n > 0 && normalizarCampo('entregada', cambios.entregada) !== ren.cantidad_entregada) {
      throw Object.assign(new Error('Este renglón tiene entregas cargadas: usá "+ Entrega" o borrá la entrega equivocada'), { status: 400 });
    }
  }
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

// --- Entregas parciales (solo renglones de O.C. INCOMPLETAS) ---
function err(status, message) {
  return Object.assign(new Error(message), { status });
}

function fechaEntrega(valor) {
  const s = String(valor || '').trim();
  if (!s) return new Date().toLocaleDateString('sv-SE'); // hoy, AAAA-MM-DD en hora local
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const f = aFecha(s);
  if (!f) throw err(400, 'La fecha tiene que ser DD/MM/AAAA');
  return f;
}

async function buscarRenglon(renglonId) {
  for (const o of await listarOrdenes()) {
    const r = o.renglones.find((x) => x.id === renglonId);
    if (r) return { orden: o, renglon: r };
  }
  throw err(404, 'Renglón no encontrado');
}

// Lo que el renglon ya tenia cargado antes de la primera entrega pasa a ser la entrega "anterior"
async function guardarCargaAnterior(conn, renglonId) {
  const [[ren]] = await conn.execute('SELECT cantidad_entregada, nro_ingreso FROM oc_renglones WHERE id = :id FOR UPDATE', { id: renglonId });
  const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM oc_entregas WHERE renglon_id = :id', { id: renglonId });
  if (n > 0 || (!ren.cantidad_entregada && !ren.nro_ingreso)) return;
  await conn.execute(
    `INSERT INTO oc_entregas (renglon_id, cantidad, nro_ingreso, observacion, fecha, origen)
     VALUES (:id, :cantidad, :ingreso, 'Cargado antes de las entregas parciales', CURDATE(), 'anterior')`,
    { id: renglonId, cantidad: ren.cantidad_entregada || 0, ingreso: ren.nro_ingreso || null }
  );
}

// Entregada = suma de las entregas; N° de ingreso = todos los ingresos; FALTA 0 -> COMPLETO = SI
async function recalcularRenglon(conn, renglonId) {
  const [[ren]] = await conn.execute('SELECT cantidad, completo FROM oc_renglones WHERE id = :id', { id: renglonId });
  const [ents] = await conn.execute('SELECT cantidad, nro_ingreso FROM oc_entregas WHERE renglon_id = :id ORDER BY fecha, id', { id: renglonId });
  const total = ents.reduce((acc, e) => acc + e.cantidad, 0);
  const ingresos = [...new Set(ents.map((e) => String(e.nro_ingreso || '').trim()).filter(Boolean))].join(' / ').slice(0, 120);
  let { completo } = ren;
  if (total >= ren.cantidad) completo = 'SI';
  else if (completo === 'SI') completo = 'NO'; // se borro una entrega: vuelve a faltar
  await conn.execute(
    'UPDATE oc_renglones SET cantidad_entregada = :total, nro_ingreso = :ingresos, completo = :completo WHERE id = :id',
    { id: renglonId, total: ents.length ? total : null, ingresos: ingresos || null, completo }
  );
}

// datos: { cantidad, nroIngreso, observacion, fecha, confirmarExceso }
async function agregarEntrega(renglonId, datos, usuarioId) {
  const cantidad = Number(String(datos.cantidad ?? '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw err(400, 'La cantidad que salió tiene que ser un número entero mayor a 0');
  const { orden, renglon } = await buscarRenglon(renglonId);
  if (!orden.admiteEntregas) throw err(400, `La O.C. ${orden.oc} está COMPLETA: no se le cargan entregas`);
  if (!renglon.admiteEntregas) throw err(400, `El renglón ${renglon.renglon} ya está en ${renglon.completo}: no se le cargan entregas`);
  const falta = renglon.cantidad - (renglon.entregada || 0);
  if (cantidad > falta && !datos.confirmarExceso) {
    throw Object.assign(err(409, `Faltan ${falta.toLocaleString('es-AR')} y estás cargando ${cantidad.toLocaleString('es-AR')}. ¿Está bien?`), { exceso: true, falta });
  }
  const nroIngreso = String(datos.nroIngreso ?? '').trim().slice(0, 120) || null;
  const observacion = String(datos.observacion ?? '').trim().slice(0, 500) || null;
  const fecha = fechaEntrega(datos.fecha);
  await transaction(async (conn) => {
    await guardarCargaAnterior(conn, renglonId);
    await conn.execute(
      `INSERT INTO oc_entregas (renglon_id, cantidad, nro_ingreso, observacion, fecha, origen, usuario_id)
       VALUES (:id, :cantidad, :nroIngreso, :observacion, :fecha, 'pagina', :usuarioId)`,
      { id: renglonId, cantidad, nroIngreso, observacion, fecha, usuarioId: usuarioId || null }
    );
    await recalcularRenglon(conn, renglonId);
    await conn.execute('UPDATE oc_renglones SET actualizado_por = :u WHERE id = :id', { id: renglonId, u: usuarioId || null });
  });
  return (await buscarRenglon(renglonId)).renglon;
}

// Borra una entrega mal cargada (la carga "anterior" no se borra: es lo que ya estaba)
async function eliminarEntrega(entregaId, usuarioId) {
  const renglonId = await transaction(async (conn) => {
    const [[e]] = await conn.execute('SELECT renglon_id, origen FROM oc_entregas WHERE id = :id FOR UPDATE', { id: entregaId });
    if (!e) throw err(404, 'Entrega no encontrada');
    if (e.origen === 'anterior') throw err(400, 'Esa es la carga que el renglón ya tenía: no se borra desde acá');
    await conn.execute('DELETE FROM oc_entregas WHERE id = :id', { id: entregaId });
    await recalcularRenglon(conn, e.renglon_id);
    await conn.execute('UPDATE oc_renglones SET actualizado_por = :u WHERE id = :id', { id: e.renglon_id, u: usuarioId || null });
    return e.renglon_id;
  });
  return (await buscarRenglon(renglonId)).renglon;
}

// Desde la planilla de Drive cambiaron la cantidad entregada de un renglon que admite entregas:
// la diferencia queda como entrega (y si ya no falta nada, COMPLETO = SI)
// antes: { entregada, nroIngreso } que tenia la base antes de copiar lo de la planilla
async function entregaDesdePlanilla(renglonId, antes, nueva) {
  const anterior = antes.entregada || 0;
  const diff = (nueva || 0) - anterior;
  if (!diff) return;
  await transaction(async (conn) => {
    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM oc_entregas WHERE renglon_id = :id', { id: renglonId });
    if (!n && (anterior || antes.nroIngreso)) {
      await conn.execute(
        `INSERT INTO oc_entregas (renglon_id, cantidad, nro_ingreso, observacion, fecha, origen)
         VALUES (:id, :anterior, :ingreso, 'Cargado antes de las entregas parciales', CURDATE(), 'anterior')`,
        { id: renglonId, anterior, ingreso: antes.nroIngreso || null }
      );
    }
    await conn.execute(
      `INSERT INTO oc_entregas (renglon_id, cantidad, observacion, fecha, origen)
       VALUES (:id, :diff, :obs, CURDATE(), 'planilla')`,
      { id: renglonId, diff, obs: diff < 0 ? 'Corrección hecha en la planilla' : 'Cargado en la planilla' }
    );
    const [[ren]] = await conn.execute('SELECT cantidad, completo FROM oc_renglones WHERE id = :id', { id: renglonId });
    if ((nueva || 0) >= ren.cantidad && !COMPLETO_OK.includes(ren.completo)) {
      await conn.execute("UPDATE oc_renglones SET completo = 'SI' WHERE id = :id", { id: renglonId });
    }
  });
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
  estadoOrden,
  importarArchivos,
  confirmarEscaneo,
  listarOrdenes,
  listarDuplicados,
  actualizarRenglon,
  agregarEntrega,
  eliminarEntrega,
  entregaDesdePlanilla,
  importarCargaManual,
  eliminarOrden
};
