const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const { pool, query, transaction } = require('./db');
const config = require('./config');
const { signToken, requireAuth, requireAdmin, requireRotulos } = require('./auth');
const { audit } = require('./audit');
const { parseStockReport } = require('./stockReportParser');
const { MONTHS, parseConsumoReport } = require('./consumoReportParser');
const { parseEtiquetasReport } = require('./etiquetasReportParser');
const { parseTrimestreReport } = require('./trimestreReportParser');

fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: config.appName, env: config.envName, db: config.db.database });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contrasena son obligatorios' });
  }
  const users = await query('SELECT * FROM usuarios WHERE username = :username AND activo = 1', { username });
  const user = users[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }
  await audit(user.id, 'login', 'usuarios', user.id, { username });
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/usuarios', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await query(`
    SELECT id, username, role, activo, created_at
    FROM usuarios
    ORDER BY username
  `);
  res.json({ data: rows });
});

app.post('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = String(req.body.role || 'operador');
  const roles = ['admin', 'operador', 'lector'];
  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Usuario obligatorio, minimo 3 caracteres' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Contrasena obligatoria, minimo 8 caracteres' });
  }
  if (!roles.includes(role)) {
    return res.status(400).json({ error: 'Rol invalido' });
  }
  const hash = await bcrypt.hash(password, 12);
  try {
    await query(
      `INSERT INTO usuarios (username, password_hash, role, activo)
       VALUES (:username, :hash, :role, 1)`,
      { username, hash, role }
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
    }
    throw error;
  }
  await audit(req.user.sub, 'crear_usuario', 'usuarios', username, { role });
  res.status(201).json({ ok: true });
});

app.patch('/api/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const role = req.body.role == null ? null : String(req.body.role);
  const activo = req.body.activo == null ? null : Number(Boolean(req.body.activo));
  const password = req.body.password == null ? '' : String(req.body.password);
  const roles = ['admin', 'operador', 'lector'];
  const updates = [];
  const params = { id };

  if (role != null) {
    if (!roles.includes(role)) return res.status(400).json({ error: 'Rol invalido' });
    if (id === req.user.sub && role !== 'admin') {
      return res.status(400).json({ error: 'No se puede quitar el rol admin del usuario actual' });
    }
    updates.push('role = :role');
    params.role = role;
  }
  if (activo != null) {
    if (id === req.user.sub && activo === 0) {
      return res.status(400).json({ error: 'No se puede desactivar el usuario actual' });
    }
    updates.push('activo = :activo');
    params.activo = activo;
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Contrasena minimo 8 caracteres' });
    updates.push('password_hash = :hash');
    params.hash = await bcrypt.hash(password, 12);
  }
  if (!updates.length) return res.status(400).json({ error: 'No hay cambios para guardar' });

  await query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = :id`, params);
  await audit(req.user.sub, 'editar_usuario', 'usuarios', id, { role, activo, cambiaPassword: Boolean(password) });
  res.json({ ok: true });
});

async function guardarConsumoImportacion({ archivoNombre, sourcePath, anio, periodo, parsed, usuarioId }) {
  return transaction(async (conn) => {
    const [insert] = await conn.execute(
      `INSERT INTO consumo_importaciones
        (archivo_nombre, hospital, sector, source_path, anio, periodo, total_items, meses_usados, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        archivoNombre,
        parsed.hospital || null,
        parsed.sector || null,
        sourcePath || null,
        anio || null,
        periodo || parsed.periodo || 'auto',
        parsed.totalItems,
        JSON.stringify(parsed.mesesUsados),
        usuarioId
      ]
    );
    const consumoImportacionId = insert.insertId;
    for (const item of parsed.items) {
      await conn.execute(
        `INSERT INTO consumo_items
          (consumo_importacion_id, codigo_articulo, nombre_generico, concentracion, presentacion,
           forma, sector, enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre,
           octubre, noviembre, diciembre, suma_6, promedio_6, minimo_sugerido, maximo_sugerido,
           meses_minimos, meses_maximos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          consumoImportacionId,
          item.codigoArticulo,
          item.nombreGenerico,
          item.concentracion,
          item.presentacion,
          item.forma,
          item.sector,
          ...MONTHS.map((month) => item.meses[month.key] || 0),
          item.suma6,
          item.promedio6,
          item.minimoSugerido,
          item.maximoSugerido,
          JSON.stringify(item.mesesMinimos),
          JSON.stringify(item.mesesMaximos)
        ]
      );
    }
    return { consumoImportacionId };
  });
}

app.get('/api/stock-source', requireAuth, requireAdmin, async (_req, res) => {
  const dir = config.stockSourceDir;
  if (!fs.existsSync(dir)) {
    return res.json({ dir, data: [] });
  }
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(xls|xlsx|html)$/i.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      const yearMatch = entry.name.match(/(\d{4})/);
      return {
        name: entry.name,
        fullPath,
        anio: yearMatch ? Number(yearMatch[1]) : null,
        bytes: stat.size,
        modifiedAt: stat.mtime
      };
    })
    .sort((a, b) => String(b.anio || '').localeCompare(String(a.anio || '')) || a.name.localeCompare(b.name));
  res.json({ dir, data: files });
});

app.get('/api/etiquetas-source', requireAuth, requireRotulos, async (_req, res) => {
  const dir = config.etiquetasSourceDir;
  if (!fs.existsSync(dir)) {
    return res.json({ dir, data: [] });
  }
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, fullPath, bytes: stat.size, modifiedAt: stat.mtime };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ dir, data: files });
});

app.get('/api/etiquetas/farmacos', requireAuth, requireRotulos, async (_req, res, next) => {
  try {
    const dir = config.etiquetasSourceDir;
    if (!fs.existsSync(dir)) {
      return res.json({ dir, files: [], data: [] });
    }
    const pdfFiles = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
      .map((entry) => path.join(dir, entry.name));

    const merged = new Map();
    const usedFiles = [];
    for (const fullPath of pdfFiles) {
      try {
        const parsed = await parseEtiquetasReport(fullPath, { excludeAmpollas: true });
        usedFiles.push(path.basename(fullPath));
        for (const item of parsed.items) {
          if (!merged.has(item.nombre)) merged.set(item.nombre, item.codigo);
        }
      } catch (fileError) {
        usedFiles.push(`${path.basename(fullPath)} (error: ${fileError.message})`);
      }
    }

    const data = Array.from(merged.keys()).sort((a, b) => a.localeCompare(b, 'es'));
    res.json({ dir, files: usedFiles, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rotulos/impresion', requireAuth, requireRotulos, async (req, res, next) => {
  try {
    const b = req.body || {};
    const farmaco = String(b.farmaco || '').trim() || null;
    const laboratorio = String(b.laboratorio || '').trim() || null;
    const lote = String(b.lote || '').trim() || null;
    const vencimiento = String(b.vencimiento || '').trim() || null;
    const cantidad = Number(b.cantidad || 0) || 0;
    const columnas = Number(b.columnas || 0) || null;
    const filas = Number(b.filas || 0) || null;
    const papel = String(b.papel || '').trim() || null;
    const anchoCm = b.anchoCm != null ? Number(b.anchoCm) : null;
    const altoCm = b.altoCm != null ? Number(b.altoCm) : null;

    const insert = await query(
      `INSERT INTO rotulos_impresiones
        (usuario_id, usuario_nombre, farmaco, laboratorio, lote, vencimiento, cantidad, columnas, filas, papel, ancho_cm, alto_cm)
       VALUES (:usuarioId, :usuarioNombre, :farmaco, :laboratorio, :lote, :vencimiento, :cantidad, :columnas, :filas, :papel, :anchoCm, :altoCm)`,
      {
        usuarioId: req.user.sub,
        usuarioNombre: req.user.username || null,
        farmaco, laboratorio, lote, vencimiento, cantidad, columnas, filas, papel,
        anchoCm: Number.isFinite(anchoCm) ? anchoCm : null,
        altoCm: Number.isFinite(altoCm) ? altoCm : null
      }
    );
    await audit(req.user.sub, 'imprimir_rotulo', 'rotulos_impresiones', insert.insertId, { farmaco, lote, cantidad });
    res.status(201).json({ id: insert.insertId });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rotulos/impresiones', requireAuth, requireRotulos, async (_req, res, next) => {
  try {
    const rows = await query(`
      SELECT id, usuario_id, usuario_nombre, farmaco, laboratorio, lote, vencimiento,
             cantidad, columnas, filas, papel, created_at
      FROM rotulos_impresiones
      ORDER BY id DESC
      LIMIT 50
    `);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

// Estado del sondeo automatico (se actualiza en sondearTrimestre()).
let trimestreUltimoSondeo = null;
let trimestreUltimoResumen = { archivos: 0, nuevos: 0 };

function estadoSondeoTrimestre() {
  return {
    enabled: config.trimestreWatch.enabled,
    intervalMs: config.trimestreWatch.intervalMs,
    ultimoSondeo: trimestreUltimoSondeo,
    importadosUltimo: trimestreUltimoResumen.nuevos,
    archivosUltimo: trimestreUltimoResumen.archivos
  };
}

app.get('/api/trimestre/source', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const dir = config.trimestreSourceDir;
    const watch = estadoSondeoTrimestre();
    if (!fs.existsSync(dir)) return res.json({ dir, watch, data: [] });
    const hashes = await query('SELECT archivo_hash, id FROM trimestre_importaciones');
    const hashMap = new Map(hashes.map((row) => [row.archivo_hash, row.id]));
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(xls|xlsx)$/i.test(entry.name))
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);
        const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
        const stat = fs.statSync(fullPath);
        return {
          name: entry.name,
          bytes: stat.size,
          modifiedAt: stat.mtime,
          leido: hashMap.has(hash),
          importacionId: hashMap.get(hash) || null
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ dir, watch, data: files });
  } catch (error) {
    next(error);
  }
});

// Importa un archivo de la carpeta de trimestre. Reutilizado por el endpoint manual
// y por el sondeo automatico. Lanza Error con .status para mapear a HTTP.
async function procesarArchivoTrimestre(fileName, usuarioId) {
  if (!fileName) { const e = new Error('Seleccionar un archivo'); e.status = 400; throw e; }
  if (/[\\/]/.test(fileName)) { const e = new Error('Nombre de archivo invalido'); e.status = 400; throw e; }
  const fullPath = path.join(config.trimestreSourceDir, fileName);
  if (!fs.existsSync(fullPath)) { const e = new Error('Archivo no encontrado'); e.status = 404; throw e; }

  const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
  const parsed = parseTrimestreReport(fullPath);
  if (!parsed.items.length) { const e = new Error('El archivo no tiene productos para importar.'); e.status = 400; throw e; }
  if (!parsed.trimestre || !parsed.anio) { const e = new Error('No se pudo determinar el trimestre/anio del archivo.'); e.status = 400; throw e; }

  // Reemplazo de duplicados: se borra cualquier carga previa con el mismo archivo (hash)
  // o el mismo periodo (sector + anio + trimestre) y se vuelve a cargar todo.
  const impId = await transaction(async (conn) => {
    await conn.execute(
      `DELETE FROM trimestre_importaciones
       WHERE archivo_hash = ?
          OR (sector <=> ? AND anio = ? AND trimestre = ?)`,
      [hash, parsed.sector, parsed.anio, parsed.trimestre]
    );
    const [imp] = await conn.execute(
      `INSERT INTO trimestre_importaciones
        (archivo_nombre, archivo_hash, hospital, sector, source_path, periodo_desde, periodo_hasta, anio, trimestre, total_items, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fileName, hash, parsed.hospital, parsed.sector, fullPath, parsed.periodoDesde, parsed.periodoHasta, parsed.anio, parsed.trimestre, parsed.totalItems, usuarioId]
    );
    const nuevoId = imp.insertId;
    for (const it of parsed.items) {
      await conn.execute(
        `INSERT INTO trimestre_items
          (trimestre_importacion_id, codigo_articulo, nombre_generico, concentracion, forma, presentacion, cantidad)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nuevoId, it.codigo, it.nombre, it.concentracion, it.forma, it.presentacion, it.cantidad]
      );
    }
    return nuevoId;
  });

  await audit(usuarioId, 'importar_trimestre', 'trimestre_importaciones', impId, {
    archivo: fileName, totalItems: parsed.totalItems, sector: parsed.sector,
    anio: parsed.anio, trimestre: parsed.trimestre, origen: usuarioId ? 'manual' : 'sondeo'
  });
  return { impId, hash, parsed };
}

app.post('/api/trimestre/importar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const fileName = String(req.body.fileName || '').trim();
    const { impId, parsed } = await procesarArchivoTrimestre(fileName, req.user.sub);
    res.status(201).json({
      id: impId, sector: parsed.sector, anio: parsed.anio, trimestre: parsed.trimestre,
      periodoDesde: parsed.periodoDesde, periodoHasta: parsed.periodoHasta, totalItems: parsed.totalItems
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

app.get('/api/trimestre/importaciones', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(`
      SELECT id, archivo_nombre, hospital, sector, periodo_desde, periodo_hasta, anio, trimestre, total_items, created_at
      FROM trimestre_importaciones
      ORDER BY anio DESC, trimestre DESC, id DESC
    `);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/trimestre/items', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const importacionId = Number(req.query.importacionId || 0);
    const search = String(req.query.search || '').trim();
    const where = [];
    const params = {};
    if (importacionId) { where.push('si.trimestre_importacion_id = :importacionId'); params.importacionId = importacionId; }
    if (search) { where.push('(si.codigo_articulo LIKE :search OR si.nombre_generico LIKE :search)'); params.search = `%${search}%`; }
    // total_periodo = total del trimestre. Sugeridos proyectados a semestre:
    // maximo (semestral, 6 meses) = cantidad x 2 ; minimo (bimestral, 2 meses) = cantidad x 2 / 3.
    const rows = await query(`
      SELECT si.id, si.trimestre_importacion_id, si.codigo_articulo, si.nombre_generico, si.concentracion,
             si.forma, si.presentacion,
             si.cantidad AS total_periodo,
             CEIL(si.cantidad * 2 / 3) AS minimo_sugerido,
             CEIL(si.cantidad * 2) AS maximo_sugerido,
             i.sector, i.anio, i.trimestre, i.periodo_desde, i.periodo_hasta
      FROM trimestre_items si
      JOIN trimestre_importaciones i ON i.id = si.trimestre_importacion_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY si.nombre_generico, si.codigo_articulo
      LIMIT 2000
    `, params);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

// Edicion manual de un item de trimestre (para corregir nombre/forma/concentracion parseados).
app.patch('/api/trimestre/items/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id invalido' });
    const campos = [];
    const params = { id };
    for (const campo of ['nombre_generico', 'forma', 'concentracion', 'presentacion']) {
      if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
        const valor = req.body[campo];
        campos.push(`${campo} = :${campo}`);
        params[campo] = (valor == null || String(valor).trim() === '') ? null : String(valor).trim();
      }
    }
    if (!campos.length) return res.status(400).json({ error: 'Nada para actualizar' });
    const result = await query(`UPDATE trimestre_items SET ${campos.join(', ')} WHERE id = :id`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'Item no encontrado' });
    await audit(req.user.sub, 'editar_trimestre_item', 'trimestre_items', id, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Edicion por codigo: corrige nombre/forma/concentracion/presentacion en TODAS las filas de
// ese codigo (todos los periodos). La identidad del producto es la misma aunque cambie el periodo.
app.patch('/api/trimestre/items-codigo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const codigo = String(req.body.codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: 'Codigo requerido' });
    const campos = [];
    const params = { codigo };
    for (const campo of ['nombre_generico', 'forma', 'concentracion', 'presentacion']) {
      if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
        const valor = req.body[campo];
        campos.push(`${campo} = :${campo}`);
        params[campo] = (valor == null || String(valor).trim() === '') ? null : String(valor).trim();
      }
    }
    if (!campos.length) return res.status(400).json({ error: 'Nada para actualizar' });
    const result = await query(`UPDATE trimestre_items SET ${campos.join(', ')} WHERE codigo_articulo = :codigo`, params);
    await audit(req.user.sub, 'editar_trimestre_codigo', 'trimestre_items', codigo, req.body);
    res.json({ ok: true, actualizados: result.affectedRows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/trimestre/comparacion', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const importaciones = await query(`
      SELECT id, archivo_nombre, sector, anio, trimestre, periodo_desde, periodo_hasta
      FROM trimestre_importaciones
      ORDER BY anio ASC, trimestre ASC, id ASC
    `);
    if (!importaciones.length) return res.json({ importaciones: [], data: [] });
    const items = await query(`
      SELECT trimestre_importacion_id, codigo_articulo, nombre_generico, forma, concentracion, presentacion,
             cantidad AS total_periodo,
             CEIL(cantidad * 2 / 3) AS minimo_sugerido,
             CEIL(cantidad * 2) AS maximo_sugerido
      FROM trimestre_items
    `);
    const productos = new Map();
    for (const it of items) {
      let prod = productos.get(it.codigo_articulo);
      if (!prod) {
        prod = {
          codigo_articulo: it.codigo_articulo,
          nombre: it.nombre_generico || null,
          forma: it.forma || null,
          concentracion: it.concentracion || null,
          presentacion: it.presentacion || null,
          porImp: {}
        };
        productos.set(it.codigo_articulo, prod);
      }
      if (!prod.nombre && it.nombre_generico) prod.nombre = it.nombre_generico;
      if (!prod.forma && it.forma) prod.forma = it.forma;
      prod.porImp[it.trimestre_importacion_id] = {
        total: Number(it.total_periodo),
        minimo: Number(it.minimo_sugerido),
        maximo: Number(it.maximo_sugerido)
      };
    }
    const data = Array.from(productos.values())
      .sort((a, b) => String(a.nombre || a.codigo_articulo).localeCompare(String(b.nombre || b.codigo_articulo), 'es'));
    res.json({ importaciones, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/trimestre/aplicar-stock', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const trimestreImportacionId = Number(req.body.trimestreImportacionId || 0);
    const stockImportacionId = Number(req.body.stockImportacionId || 0);
    if (!trimestreImportacionId || !stockImportacionId) {
      return res.status(400).json({ error: 'Seleccionar período trimestral e importación de stock crítico' });
    }

    // Con guion + con dato trimestral en el periodo elegido -> se aplican.
    // maximo (semestral) = cantidad x 2 ; minimo (bimestral) = cantidad x 2 / 3.
    const matched = await query(`
      SELECT si.codigo_articulo, si.cantidad,
             i.id item_id, v.estado valor_estado
      FROM trimestre_items si
      JOIN stock_items i
        ON i.codigo_articulo = si.codigo_articulo
       AND i.importacion_id = :stockImportacionId
       AND i.requiere_carga = 1
      LEFT JOIN stock_valores_carga v ON v.item_id = i.id
      WHERE si.trimestre_importacion_id = :trimestreImportacionId
    `, { trimestreImportacionId, stockImportacionId });

    for (const row of matched) {
      const cantidad = Number(row.cantidad || 0);
      const minimo = Math.ceil(cantidad * 2 / 3);  // Stock Minimo = bimestral (2 meses)
      const maximo = Math.ceil(cantidad * 2);       // Stock Maximo = semestral (6 meses)
      const tipoOperacion = row.valor_estado === 'cargado' ? 'actualizacion' : 'carga_inicial';
      await query(
        `INSERT INTO stock_valores_carga
          (item_id, codigo_articulo, stock_minimo_nuevo, stock_maximo_nuevo, estado, tipo_operacion, actualizado_por)
         VALUES (:itemId, :codigo, :minimo, :maximo, 'listo', :tipoOperacion, :usuario)
         ON DUPLICATE KEY UPDATE
           stock_minimo_nuevo = VALUES(stock_minimo_nuevo),
           stock_maximo_nuevo = VALUES(stock_maximo_nuevo),
           estado = 'listo',
           tipo_operacion = VALUES(tipo_operacion),
           mensaje_error = NULL,
           actualizado_por = VALUES(actualizado_por)`,
        { itemId: row.item_id, codigo: row.codigo_articulo, minimo, maximo, tipoOperacion, usuario: req.user.sub }
      );
    }

    // Los que siguen con guion sin valor listo/cargado (no se actualizan)
    const restantes = await query(`
      SELECT i.codigo_articulo, i.descripcion
      FROM stock_items i
      LEFT JOIN stock_valores_carga v ON v.item_id = i.id
      WHERE i.importacion_id = :stockImportacionId
        AND i.requiere_carga = 1
        AND (v.estado IS NULL OR v.estado NOT IN ('listo', 'cargado'))
      ORDER BY i.descripcion
    `, { stockImportacionId });

    await audit(req.user.sub, 'aplicar_trimestre_stock', 'trimestre_importaciones', trimestreImportacionId, {
      stockImportacionId, aplicados: matched.length, restantes: restantes.length
    });
    res.json({ aplicados: matched.length, restantesCount: restantes.length, restantes });
  } catch (error) {
    next(error);
  }
});

// ===== Stock sugeridos (tabla temporal editable) =====

// Redondeo hacia arriba:
//  - unidades (1-9) -> 10
//  - decenas (10-99): <=50 -> 50 ; >50 -> 100
//  - 100 en adelante -> 2 cifras significativas (147->150, 2200->2200, 16216->17000)
function redondearStock(n) {
  if (n == null) return null;
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (x < 10) return 10;
  if (x < 100) return x <= 50 ? 50 : 100;
  const step = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / step) * step;
}

// Genera/recalcula los sugeridos desde el ULTIMO trimestre con movimiento de cada codigo.
// Respeta las filas editadas a mano (editado_manual=1): no pisa su stock_minimo/stock_maximo.
app.post('/api/sugeridos/generar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [ultimo] = await query('SELECT id FROM stock_importaciones ORDER BY created_at DESC, id DESC LIMIT 1');
    if (!ultimo) return res.status(400).json({ error: 'No hay stock crítico importado.' });
    const stockImportacionId = ultimo.id;
    // Solo productos CON GUION del stock critico actual.
    const guion = await query(
      'SELECT codigo_articulo, descripcion FROM stock_items WHERE importacion_id = :stockImportacionId AND requiere_carga = 1',
      { stockImportacionId }
    );
    const descByCodigo = new Map(guion.map((g) => [g.codigo_articulo, g.descripcion]));
    if (!guion.length) {
      await query('DELETE FROM stock_sugeridos');
      return res.json({ ok: true, total: 0, conGuion: 0 });
    }

    // Todo el consumo trimestral de esos codigos.
    const codigosGuion = [...descByCodigo.keys()];
    const ph = codigosGuion.map((_, i) => `:g${i}`).join(', ');
    const gp = {};
    codigosGuion.forEach((c, i) => { gp[`g${i}`] = c; });
    const movs = await query(`
      SELECT si.codigo_articulo, si.nombre_generico, si.forma, si.concentracion, si.presentacion,
             si.cantidad, i.anio, i.trimestre
      FROM trimestre_items si
      JOIN trimestre_importaciones i ON i.id = si.trimestre_importacion_id
      WHERE si.codigo_articulo IN (${ph})
    `, gp);

    // Agrupa por codigo.
    const porCodigo = new Map();
    for (const m of movs) {
      let g = porCodigo.get(m.codigo_articulo);
      if (!g) { g = { trims: [], ident: null, identKey: -1 }; porCodigo.set(m.codigo_articulo, g); }
      g.trims.push(m);
      const k = Number(m.anio) * 10 + Number(m.trimestre);
      if (k > g.identKey) { g.identKey = k; g.ident = m; } // identidad = ultimo movimiento
    }

    // Todos los semestres que existen en el sistema (segun los trimestres importados).
    const periodos = await query('SELECT DISTINCT anio, trimestre FROM trimestre_importaciones WHERE anio IS NOT NULL AND trimestre IS NOT NULL');
    const semSet = new Map();
    for (const p of periodos) {
      const sem = Number(p.trimestre) <= 2 ? 1 : 2;
      const key = `${p.anio}-S${sem}`;
      if (!semSet.has(key)) semSet.set(key, { anio: Number(p.anio), semestre: sem, label: `S${sem} ${p.anio}` });
    }
    const globalSemestres = [...semSet.values()].sort((a, b) => (b.anio - a.anio) || (b.semestre - a.semestre));

    // Stock por semestre. Se muestran TODOS los semestres del sistema (0 si el producto no tiene
    // dato). Semestre incompleto (falta un trimestre) se PROYECTA: promedio de lo que hay x 2.
    // Solo compiten por el maximo los semestres con total > 0.
    function calcularStock(trims) {
      const byKey = new Map();
      for (const t of trims) byKey.set(`${Number(t.anio)}-${Number(t.trimestre)}`, Number(t.cantidad || 0));
      const detalle = globalSemestres.map((gs) => {
        const tris = gs.semestre === 1 ? [1, 2] : [3, 4];
        const trimestres = {};
        const presentes = [];
        for (const tri of tris) {
          const k = `${gs.anio}-${tri}`;
          if (byKey.has(k)) { const v = byKey.get(k); trimestres[`T${tri}`] = v; presentes.push(v); }
        }
        const suma = presentes.reduce((a, v) => a + v, 0);
        const total = presentes.length ? Math.round((suma / presentes.length) * 2) : 0;
        return { label: gs.label, anio: gs.anio, semestre: gs.semestre, total, trimestres, presentes: presentes.length, proyectado: presentes.length === 1 };
      });
      let elegido = null;
      for (const s of detalle) if (s.total > 0 && (!elegido || s.total > elegido.total)) elegido = s;
      if (elegido) { for (const s of detalle) s.elegido = (s === elegido); }
      const rawMax = elegido ? elegido.total : null;
      const maximo = redondearStock(rawMax);
      const minimo = rawMax != null ? redondearStock(rawMax / 3) : null;
      return { maximo, minimo, rawMax, elegido, detalle };
    }

    for (const codigo of codigosGuion) {
      const g = porCodigo.get(codigo);
      const ident = g?.ident || {};
      const calc = g ? calcularStock(g.trims) : { maximo: null, minimo: null, rawMax: null, elegido: null, detalle: [] };
      await query(`
        INSERT INTO stock_sugeridos
          (codigo_articulo, nombre_generico, forma, concentracion, presentacion, ultimo_periodo, consumo_ultimo, stock_minimo, stock_maximo, detalle_calculo, editado_manual)
        VALUES (:codigo, :nombre, :forma, :conc, :pres, :periodo, :consumo, :minCalc, :maxCalc, CAST(:detalle AS JSON), 0)
        ON DUPLICATE KEY UPDATE
          nombre_generico = VALUES(nombre_generico),
          forma = VALUES(forma),
          concentracion = VALUES(concentracion),
          presentacion = VALUES(presentacion),
          ultimo_periodo = VALUES(ultimo_periodo),
          consumo_ultimo = VALUES(consumo_ultimo),
          detalle_calculo = VALUES(detalle_calculo),
          stock_minimo = IF(editado_manual = 1, stock_minimo, VALUES(stock_minimo)),
          stock_maximo = IF(editado_manual = 1, stock_maximo, VALUES(stock_maximo))
      `, {
        codigo,
        nombre: ident.nombre_generico || descByCodigo.get(codigo) || null,
        forma: ident.forma || null, conc: ident.concentracion || null, pres: ident.presentacion || null,
        periodo: calc.elegido ? calc.elegido.label : null,
        consumo: calc.rawMax,
        minCalc: calc.minimo, maxCalc: calc.maximo,
        detalle: JSON.stringify(calc.detalle || [])
      });
    }
    const porCodigoSize = codigosGuion.length;

    // Borra del borrador lo que ya no esta con guion en el stock actual.
    const placeholders = codigosGuion.map((_, i) => `:c${i}`).join(', ');
    const dp = {};
    codigosGuion.forEach((c, i) => { dp[`c${i}`] = c; });
    await query(`DELETE FROM stock_sugeridos WHERE codigo_articulo NOT IN (${placeholders})`, dp);

    await audit(req.user.sub, 'generar_sugeridos', 'stock_sugeridos', stockImportacionId, { total: porCodigoSize });
    res.json({ ok: true, total: porCodigoSize, conGuion: porCodigoSize });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sugeridos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const where = [];
    const params = {};
    if (search) { where.push('(codigo_articulo LIKE :s OR nombre_generico LIKE :s)'); params.s = `%${search}%`; }
    const rows = await query(`
      SELECT id, codigo_articulo, nombre_generico, forma, concentracion, presentacion,
             ultimo_periodo, consumo_ultimo, stock_minimo, stock_maximo, detalle_calculo, editado_manual, updated_at
      FROM stock_sugeridos
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY nombre_generico, codigo_articulo
      LIMIT 3000
    `, params);
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/sugeridos/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id invalido' });
    const campos = [];
    const params = { id };
    const toInt = (v) => (v === '' || v == null) ? null : (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : undefined);
    if (Object.prototype.hasOwnProperty.call(req.body, 'stock_minimo')) {
      const v = toInt(req.body.stock_minimo); if (v === undefined) return res.status(400).json({ error: 'Mínimo inválido' });
      campos.push('stock_minimo = :min'); params.min = v;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'stock_maximo')) {
      const v = toInt(req.body.stock_maximo); if (v === undefined) return res.status(400).json({ error: 'Máximo inválido' });
      campos.push('stock_maximo = :max'); params.max = v;
    }
    for (const campo of ['nombre_generico', 'forma', 'concentracion', 'presentacion']) {
      if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
        const val = req.body[campo];
        campos.push(`${campo} = :${campo}`);
        params[campo] = (val == null || String(val).trim() === '') ? null : String(val).trim();
      }
    }
    if (!campos.length) return res.status(400).json({ error: 'Nada para actualizar' });
    campos.push('editado_manual = 1');
    const result = await query(`UPDATE stock_sugeridos SET ${campos.join(', ')} WHERE id = :id`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'No encontrado' });
    await audit(req.user.sub, 'editar_sugerido', 'stock_sugeridos', id, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Devuelve la importacion de stock critico ACTUAL (la mas reciente) y su estado.
app.get('/api/stock-critico/actual', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [imp] = await query(`
      SELECT id, archivo_nombre, hospital, sector, fecha_emision, total_items, items_con_guion, created_at
      FROM stock_importaciones
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    res.json({ importacion: imp || null });
  } catch (error) {
    next(error);
  }
});

// Aplica los sugeridos (ya revisados/editados) a los productos CON GUION del stock critico ACTUAL
// (la ultima importacion; se detecta analizando la tabla, sin elegir Excel a mano).
app.post('/api/sugeridos/aplicar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [ultimo] = await query('SELECT id, archivo_nombre FROM stock_importaciones ORDER BY created_at DESC, id DESC LIMIT 1');
    if (!ultimo) return res.status(400).json({ error: 'No hay ninguna importación de stock crítico cargada.' });
    const stockImportacionId = ultimo.id;
    const matched = await query(`
      SELECT s.codigo_articulo, s.stock_minimo, s.stock_maximo, i.id item_id, v.estado valor_estado
      FROM stock_sugeridos s
      JOIN stock_items i
        ON i.codigo_articulo = s.codigo_articulo
       AND i.importacion_id = :stockImportacionId
       AND i.requiere_carga = 1
      LEFT JOIN stock_valores_carga v ON v.item_id = i.id
      WHERE s.stock_minimo IS NOT NULL OR s.stock_maximo IS NOT NULL
    `, { stockImportacionId });
    for (const row of matched) {
      const tipoOperacion = row.valor_estado === 'cargado' ? 'actualizacion' : 'carga_inicial';
      await query(
        `INSERT INTO stock_valores_carga
          (item_id, codigo_articulo, stock_minimo_nuevo, stock_maximo_nuevo, estado, tipo_operacion, actualizado_por)
         VALUES (:itemId, :codigo, :min, :max, 'listo', :tipo, :usuario)
         ON DUPLICATE KEY UPDATE
           stock_minimo_nuevo = VALUES(stock_minimo_nuevo),
           stock_maximo_nuevo = VALUES(stock_maximo_nuevo),
           estado = 'listo',
           tipo_operacion = VALUES(tipo_operacion),
           mensaje_error = NULL,
           actualizado_por = VALUES(actualizado_por)`,
        { itemId: row.item_id, codigo: row.codigo_articulo, min: row.stock_minimo, max: row.stock_maximo, tipo: tipoOperacion, usuario: req.user.sub }
      );
    }
    await audit(req.user.sub, 'aplicar_sugeridos_stock', 'stock_sugeridos', stockImportacionId, { aplicados: matched.length });
    res.json({ ok: true, aplicados: matched.length, importacion: ultimo });
  } catch (error) {
    next(error);
  }
});

app.post('/api/consumos', requireAuth, requireAdmin, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo requerido' });
    }
    const periodo = String(req.body.periodo || 'auto');
    const parsed = parseConsumoReport(req.file.path, { periodo });
    if (!parsed.items.length) {
      return res.status(400).json({ error: 'El Excel seleccionado no tiene productos de consumo para importar.' });
    }
    const result = await guardarConsumoImportacion({
      archivoNombre: req.file.originalname,
      sourcePath: req.file.path,
      anio: null,
      periodo,
      parsed,
      usuarioId: req.user.sub
    });

    await audit(req.user.sub, 'importar_consumo', 'consumo_importaciones', result.consumoImportacionId, {
      archivo: req.file.originalname,
      totalItems: parsed.totalItems,
      periodo,
      mesesUsados: parsed.mesesUsados.map((month) => month.label)
    });

    res.status(201).json({
      id: result.consumoImportacionId,
      hospital: parsed.hospital,
      sector: parsed.sector,
      totalItems: parsed.totalItems,
      periodo,
      mesesUsados: parsed.mesesUsados
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/consumos/desde-stock', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const fileName = String(req.body.fileName || '').trim();
    const anio = Number(req.body.anio || 0);
    const periodo = String(req.body.periodo || 'auto');
    const allowed = ['auto', 'semestre_1', 'semestre_2', 'anio_completo'];
    if (!allowed.includes(periodo)) return res.status(400).json({ error: 'Periodo invalido' });
    const files = listSourceFiles(config.stockSourceDir);
    const selected = fileName
      ? files.find((file) => file.name === fileName)
      : files.find((file) => file.anio === anio);
    if (!selected) {
      return res.status(404).json({ error: `Seleccionar un Excel existente en ${config.stockSourceDir}` });
    }
    const fullPath = selected.fullPath;
    const selectedYear = selected.anio || anio || null;
    const parsed = parseConsumoReport(fullPath, { periodo });
    if (!parsed.items.length) {
      return res.status(400).json({ error: `El Excel ${selected.name} no tiene productos de consumo para importar.` });
    }
    const result = await guardarConsumoImportacion({
      archivoNombre: selected.name,
      sourcePath: fullPath,
      anio: selectedYear,
      periodo,
      parsed,
      usuarioId: req.user.sub
    });
    await audit(req.user.sub, 'importar_consumo_fuente_stock', 'consumo_importaciones', result.consumoImportacionId, {
      archivo: selected.name,
      sourcePath: fullPath,
      anio: selectedYear,
      periodo,
      totalItems: parsed.totalItems,
      mesesUsados: parsed.mesesUsados.map((month) => month.label)
    });
    res.status(201).json({
      id: result.consumoImportacionId,
      archivoNombre: selected.name,
      sourcePath: fullPath,
      anio: selectedYear,
      periodo,
      hospital: parsed.hospital,
      sector: parsed.sector,
      totalItems: parsed.totalItems,
      mesesUsados: parsed.mesesUsados
    });
  } catch (error) {
    next(error);
  }
});

function listSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(xls|xlsx|html)$/i.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      const yearMatch = entry.name.match(/(\d{4})/);
      return {
        name: entry.name,
        fullPath,
        anio: yearMatch ? Number(yearMatch[1]) : null,
        bytes: stat.size,
        modifiedAt: stat.mtime
      };
    })
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

async function guardarStockImportacion({ archivoNombre, archivoHash = null, sourcePath, parsed, usuarioId }) {
  return transaction(async (conn) => {
    const [insert] = await conn.execute(
      `INSERT INTO stock_importaciones
        (archivo_nombre, archivo_hash, hospital, sector, source_path, fecha_emision, total_items, items_con_guion, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        archivoNombre,
        archivoHash,
        parsed.hospital || null,
        parsed.sector || null,
        sourcePath || null,
        parsed.fechaEmision,
        parsed.totalItems,
        parsed.itemsConGuion,
        usuarioId
      ]
    );
    const importacionId = insert.insertId;
    for (const item of parsed.items) {
      const [itemInsert] = await conn.execute(
        `INSERT INTO stock_items
          (importacion_id, fila_reporte, codigo_articulo, descripcion, stock_minimo_actual,
           stock_maximo_actual, stock_actual, minimo_con_guion, maximo_con_guion, requiere_carga)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importacionId,
          item.filaReporte,
          item.codigoArticulo,
          item.descripcion,
          item.stockMinimoActual,
          item.stockMaximoActual,
          item.stockActual,
          item.minimoConGuion ? 1 : 0,
          item.maximoConGuion ? 1 : 0,
          item.requiereCarga ? 1 : 0
        ]
      );
      if (item.requiereCarga) {
        await conn.execute(
          `INSERT INTO stock_valores_carga (item_id, codigo_articulo, estado)
           VALUES (?, ?, 'pendiente')`,
          [itemInsert.insertId, item.codigoArticulo]
        );
      }
    }
    return { importacionId };
  });
}

// Estado del sondeo automatico de stock critico (se actualiza en sondearCritico()).
let criticoUltimoSondeo = null;
let criticoUltimoResumen = { archivos: 0, nuevos: 0 };

function estadoSondeoCritico() {
  return {
    enabled: config.criticoWatch.enabled,
    intervalMs: config.criticoWatch.intervalMs,
    ultimoSondeo: criticoUltimoSondeo,
    importadosUltimo: criticoUltimoResumen.nuevos,
    archivosUltimo: criticoUltimoResumen.archivos
  };
}

app.get('/api/critico-source', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const watch = estadoSondeoCritico();
    const files = listSourceFiles(config.criticoSourceDir);
    const rows = await query('SELECT archivo_hash, id FROM stock_importaciones WHERE archivo_hash IS NOT NULL');
    const hashMap = new Map(rows.map((row) => [row.archivo_hash, row.id]));
    const data = files.map((f) => {
      let hash = null;
      try { hash = crypto.createHash('sha256').update(fs.readFileSync(f.fullPath)).digest('hex'); } catch { /* archivo bloqueado */ }
      return { ...f, leido: hash ? hashMap.has(hash) : false, importacionId: hash ? (hashMap.get(hash) || null) : null };
    });
    res.json({ dir: config.criticoSourceDir, watch, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/consumos', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await query(`
    SELECT id, archivo_nombre, hospital, sector, source_path, anio, periodo, total_items, meses_usados, created_at
    FROM consumo_importaciones
    ORDER BY id DESC
    LIMIT 50
  `);
  res.json({ data: rows });
});

function anioDeImportacion(row) {
  if (row.anio) return Number(row.anio);
  const match = String(row.archivo_nombre || '').match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

// Para cada anio se usa SIEMPRE la ultima importacion cargada de ese anio.
async function ultimaImportacionPorAnio() {
  const rows = await query(`
    SELECT id, archivo_nombre, anio, periodo, total_items, created_at
    FROM consumo_importaciones
    ORDER BY created_at DESC, id DESC
  `);
  const porAnio = new Map();
  for (const row of rows) {
    const anio = anioDeImportacion(row);
    if (!anio || porAnio.has(anio)) continue;
    porAnio.set(anio, row);
  }
  return porAnio;
}

app.get('/api/consumos/anios', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const porAnio = await ultimaImportacionPorAnio();
    const data = Array.from(porAnio.values())
      .map((row) => ({
        anio: anioDeImportacion(row),
        importacion_id: row.id,
        archivo_nombre: row.archivo_nombre,
        periodo: row.periodo,
        total_items: row.total_items,
        created_at: row.created_at
      }))
      .sort((a, b) => b.anio - a.anio);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/consumos/comparacion', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const porAnio = await ultimaImportacionPorAnio();
    let anios = Array.from(porAnio.keys());
    const pedido = String(req.query.anios || '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter(Boolean);
    if (pedido.length) anios = anios.filter((anio) => pedido.includes(anio));
    anios.sort((a, b) => a - b);
    if (!anios.length) {
      return res.json({ anios: [], importaciones: {}, meses: MONTHS, data: [] });
    }

    const impIds = anios.map((anio) => porAnio.get(anio).id);
    const impToAnio = new Map();
    anios.forEach((anio) => impToAnio.set(porAnio.get(anio).id, anio));

    const placeholders = impIds.map((_, i) => `:id${i}`).join(', ');
    const params = {};
    impIds.forEach((id, i) => { params[`id${i}`] = id; });
    const items = await query(`
      SELECT consumo_importacion_id, codigo_articulo, nombre_generico,
             enero, febrero, marzo, abril, mayo, junio, julio, agosto,
             septiembre, octubre, noviembre, diciembre
      FROM consumo_items
      WHERE consumo_importacion_id IN (${placeholders})
    `, params);

    const productos = new Map();
    for (const it of items) {
      const anio = impToAnio.get(it.consumo_importacion_id);
      if (!anio) continue;
      let prod = productos.get(it.codigo_articulo);
      if (!prod) {
        prod = { codigo_articulo: it.codigo_articulo, nombre: it.nombre_generico || null, porAnio: {} };
        productos.set(it.codigo_articulo, prod);
      }
      if (!prod.nombre && it.nombre_generico) prod.nombre = it.nombre_generico;
      const meses = {};
      let total = 0;
      for (const month of MONTHS) {
        const value = Number(it[month.key] || 0);
        meses[month.key] = value;
        total += value;
      }
      prod.porAnio[anio] = { meses, total: Math.round(total * 100) / 100 };
    }

    const data = Array.from(productos.values())
      .sort((a, b) => String(a.nombre || a.codigo_articulo)
        .localeCompare(String(b.nombre || b.codigo_articulo), 'es'));

    const importaciones = {};
    anios.forEach((anio) => {
      const row = porAnio.get(anio);
      importaciones[anio] = { id: row.id, archivo_nombre: row.archivo_nombre, periodo: row.periodo };
    });

    res.json({ anios, importaciones, meses: MONTHS, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/consumos/:id/items', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const search = `%${String(req.query.search || '').trim()}%`;
  const where = ['consumo_importacion_id = :id'];
  const params = { id, search };
  if (String(req.query.search || '').trim()) {
    where.push('(codigo_articulo LIKE :search OR nombre_generico LIKE :search)');
  }
  const rows = await query(`
    SELECT *
    FROM consumo_items
    WHERE ${where.join(' AND ')}
    ORDER BY codigo_articulo
    LIMIT 1000
  `, params);
  res.json({ data: rows });
});

app.get('/api/consumos/:id/cruce', requireAuth, requireAdmin, async (req, res) => {
  const consumoId = Number(req.params.id);
  const importacionId = Number(req.query.importacionId || 0);
  if (!importacionId) {
    return res.status(400).json({ error: 'Seleccionar una importacion de stock critico' });
  }
  const rows = await query(`
    SELECT
      c.id consumo_item_id,
      c.codigo_articulo,
      c.nombre_generico,
      c.concentracion,
      c.presentacion,
      c.forma,
      c.sector consumo_sector,
      c.enero, c.febrero, c.marzo, c.abril, c.mayo, c.junio,
      c.julio, c.agosto, c.septiembre, c.octubre, c.noviembre, c.diciembre,
      c.suma_6, c.promedio_6, c.minimo_sugerido, c.maximo_sugerido,
      c.meses_minimos, c.meses_maximos,
      i.id stock_item_id,
      i.descripcion stock_descripcion,
      i.stock_minimo_actual,
      i.stock_maximo_actual,
      i.stock_actual,
      i.minimo_con_guion,
      i.maximo_con_guion,
      i.requiere_carga,
      v.estado,
      v.tipo_operacion,
      v.stock_minimo_nuevo,
      v.stock_maximo_nuevo
    FROM consumo_items c
    LEFT JOIN stock_items i
      ON i.codigo_articulo = c.codigo_articulo
     AND i.importacion_id = :importacionId
    LEFT JOIN stock_valores_carga v ON v.item_id = i.id
    WHERE c.consumo_importacion_id = :consumoId
    ORDER BY c.codigo_articulo
    LIMIT 1000
  `, { consumoId, importacionId });
  const resumen = {
    consumoItems: rows.length,
    cruzados: rows.filter((row) => row.stock_item_id).length,
    conGuion: rows.filter((row) => row.stock_item_id && row.requiere_carga).length,
    listosAplicables: rows.filter((row) => row.stock_item_id && row.requiere_carga && row.promedio_6 > 0).length
  };
  res.json({ data: rows, resumen });
});

app.post('/api/consumos/:id/aplicar', requireAuth, requireAdmin, async (req, res) => {
  const consumoId = Number(req.params.id);
  const importacionId = Number(req.body.importacionId || 0);
  if (!importacionId) {
    return res.status(400).json({ error: 'Seleccionar una importacion de stock critico' });
  }
  const rows = await query(`
    SELECT
      c.codigo_articulo,
      c.minimo_sugerido,
      c.maximo_sugerido,
      i.id item_id,
      i.requiere_carga,
      v.estado valor_estado
    FROM consumo_items c
    JOIN stock_items i
      ON i.codigo_articulo = c.codigo_articulo
     AND i.importacion_id = :importacionId
    LEFT JOIN stock_valores_carga v ON v.item_id = i.id
    WHERE c.consumo_importacion_id = :consumoId
      AND i.requiere_carga = 1
      AND c.promedio_6 > 0
  `, { consumoId, importacionId });

  for (const row of rows) {
    const tipoOperacion = row.valor_estado === 'cargado' ? 'actualizacion' : 'carga_inicial';
    await query(
      `INSERT INTO stock_valores_carga
        (item_id, codigo_articulo, stock_minimo_nuevo, stock_maximo_nuevo, estado, tipo_operacion, actualizado_por)
       VALUES (:itemId, :codigo, :minimo, :maximo, 'listo', :tipoOperacion, :usuario)
       ON DUPLICATE KEY UPDATE
         stock_minimo_nuevo = VALUES(stock_minimo_nuevo),
         stock_maximo_nuevo = VALUES(stock_maximo_nuevo),
         estado = 'listo',
         tipo_operacion = VALUES(tipo_operacion),
         mensaje_error = NULL,
         actualizado_por = VALUES(actualizado_por)`,
      {
        itemId: row.item_id,
        codigo: row.codigo_articulo,
        minimo: row.minimo_sugerido,
        maximo: row.maximo_sugerido,
        tipoOperacion,
        usuario: req.user.sub
      }
    );
  }

  await audit(req.user.sub, 'aplicar_consumo_stock', 'consumo_importaciones', consumoId, {
    importacionId,
    aplicados: rows.length
  });
  res.json({ ok: true, aplicados: rows.length });
});

app.post('/api/importaciones', requireAuth, requireAdmin, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo requerido' });
    }
    const parsed = parseStockReport(req.file.path);
    if (!parsed.items.length) {
      return res.status(400).json({ error: 'No se detectaron filas de stock critico' });
    }

    const result = await guardarStockImportacion({
      archivoNombre: req.file.originalname,
      sourcePath: req.file.path,
      parsed,
      usuarioId: req.user.sub
    });

    await audit(req.user.sub, 'importar_reporte', 'stock_importaciones', result.importacionId, {
      archivo: req.file.originalname,
      sourcePath: req.file.path,
      totalItems: parsed.totalItems,
      itemsConGuion: parsed.itemsConGuion
    });

    res.status(201).json({ id: result.importacionId, ...parsed, items: undefined });
  } catch (error) {
    next(error);
  }
});

// Importa un reporte de stock critico desde la carpeta. Reutilizado por el endpoint
// manual y por el sondeo automatico. Lanza Error con .status para mapear a HTTP.
async function procesarArchivoCritico(fileName, usuarioId) {
  const files = listSourceFiles(config.criticoSourceDir);
  const selected = fileName ? files.find((file) => file.name === fileName) : files[0];
  if (!selected) { const e = new Error(`No hay archivos .xls/.xlsx/.html en ${config.criticoSourceDir}`); e.status = 404; throw e; }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(selected.fullPath)).digest('hex');
  const parsed = parseStockReport(selected.fullPath);
  if (!parsed.items.length) { const e = new Error('No se detectaron filas de stock critico en el archivo seleccionado'); e.status = 400; throw e; }
  const result = await guardarStockImportacion({
    archivoNombre: selected.name, archivoHash: hash, sourcePath: selected.fullPath, parsed, usuarioId
  });
  await audit(usuarioId, 'importar_reporte_fuente_critico', 'stock_importaciones', result.importacionId, {
    archivo: selected.name, sourcePath: selected.fullPath, totalItems: parsed.totalItems,
    itemsConGuion: parsed.itemsConGuion, origen: usuarioId ? 'manual' : 'sondeo'
  });
  return { result, selected, parsed, hash };
}

app.post('/api/importaciones/desde-critico', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const fileName = String(req.body.fileName || '').trim();
    const { result, selected, parsed } = await procesarArchivoCritico(fileName, req.user.sub);
    res.status(201).json({ id: result.importacionId, archivoNombre: selected.name, sourcePath: selected.fullPath, ...parsed, items: undefined });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

app.get('/api/importaciones', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await query(`
    SELECT id, archivo_nombre, hospital, sector, source_path, fecha_emision, total_items, items_con_guion, estado, created_at
    FROM stock_importaciones
    ORDER BY id DESC
    LIMIT 50
  `);
  res.json({ data: rows });
});

app.get('/api/importaciones/:id/resumen', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [imp] = await query('SELECT * FROM stock_importaciones WHERE id = :id', { id });
  if (!imp) return res.status(404).json({ error: 'Importacion no encontrada' });
  const [counts] = await query(
    `SELECT
       COUNT(*) total,
       SUM(requiere_carga = 1) pendientes_originales,
       SUM(v.estado = 'listo') listos,
       SUM(v.estado = 'listo' AND v.tipo_operacion = 'actualizacion') listos_actualizacion,
       SUM(v.estado = 'cargado') cargados,
       SUM(v.estado = 'error') errores,
       SUM(v.estado = 'pendiente') pendientes
     FROM stock_items i
     LEFT JOIN stock_valores_carga v ON v.item_id = i.id
     WHERE i.importacion_id = :id`,
    { id }
  );
  res.json({ importacion: imp, resumen: counts });
});

app.get('/api/items', requireAuth, requireAdmin, async (req, res) => {
  const importacionId = Number(req.query.importacionId || 0);
  const soloPendientes = String(req.query.soloPendientes || 'true') !== 'false';
  const search = `%${String(req.query.search || '').trim()}%`;
  const params = { importacionId, search };
  const where = [
    importacionId ? 'i.importacion_id = :importacionId' : 'i.importacion_id = (SELECT MAX(id) FROM stock_importaciones)'
  ];
  if (soloPendientes) where.push('i.requiere_carga = 1');
  if (String(req.query.search || '').trim()) {
    where.push('(i.codigo_articulo LIKE :search OR i.descripcion LIKE :search)');
  }
  const rows = await query(
    `SELECT i.*, v.stock_minimo_nuevo, v.stock_maximo_nuevo, v.estado, v.tipo_operacion, v.mensaje_error, v.updated_at
     FROM stock_items i
     LEFT JOIN stock_valores_carga v ON v.item_id = i.id
     WHERE ${where.join(' AND ')}
     ORDER BY i.fila_reporte
     LIMIT 1000`,
    params
  );
  res.json({ data: rows });
});

app.put('/api/items/:id/valores', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const minimo = req.body.stockMinimoNuevo === '' || req.body.stockMinimoNuevo == null
    ? null
    : Number(req.body.stockMinimoNuevo);
  const maximo = req.body.stockMaximoNuevo === '' || req.body.stockMaximoNuevo == null
    ? null
    : Number(req.body.stockMaximoNuevo);
  if ((minimo == null || !Number.isInteger(minimo) || minimo < 0) && (maximo == null || !Number.isInteger(maximo) || maximo < 0)) {
    return res.status(400).json({ error: 'Cargar al menos un valor numerico valido' });
  }
  if (minimo != null && maximo != null && maximo < minimo) {
    return res.status(400).json({ error: 'El stock maximo no puede ser menor al minimo' });
  }
  const [item] = await query(`
    SELECT i.*, v.estado AS valor_estado, v.tipo_operacion AS valor_tipo_operacion
    FROM stock_items i
    LEFT JOIN stock_valores_carga v ON v.item_id = i.id
    WHERE i.id = :id
  `, { id });
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  const tipoOperacion = item.valor_estado === 'cargado' || !item.requiere_carga
    ? 'actualizacion'
    : 'carga_inicial';
  await query(
    `INSERT INTO stock_valores_carga
      (item_id, codigo_articulo, stock_minimo_nuevo, stock_maximo_nuevo, estado, tipo_operacion, actualizado_por)
     VALUES (:id, :codigo, :minimo, :maximo, 'listo', :tipoOperacion, :usuario)
     ON DUPLICATE KEY UPDATE
       stock_minimo_nuevo = VALUES(stock_minimo_nuevo),
       stock_maximo_nuevo = VALUES(stock_maximo_nuevo),
       estado = 'listo',
       tipo_operacion = VALUES(tipo_operacion),
       mensaje_error = NULL,
       actualizado_por = VALUES(actualizado_por)`,
    { id, codigo: item.codigo_articulo, minimo, maximo, tipoOperacion, usuario: req.user.sub }
  );
  await audit(req.user.sub, 'guardar_valores', 'stock_items', id, {
    codigo: item.codigo_articulo,
    minimo,
    maximo,
    tipoOperacion,
    estadoAnterior: item.valor_estado || null
  });
  res.json({ ok: true, tipoOperacion });
});

app.get('/api/script/pendientes', async (req, res) => {
  if (!config.scriptToken || req.headers['x-script-token'] !== config.scriptToken) {
    return res.status(401).json({ error: 'Token de script invalido' });
  }
  const importacionId = Number(req.query.importacionId || 0);
  const where = ["v.estado = 'listo'"];
  const params = {};
  if (importacionId) {
    where.push('i.importacion_id = :importacionId');
    params.importacionId = importacionId;
  }
  const rows = await query(`
    SELECT v.id valor_id, i.id item_id, i.codigo_articulo, i.descripcion,
           v.stock_minimo_nuevo, v.stock_maximo_nuevo, v.tipo_operacion
    FROM stock_valores_carga v
    JOIN stock_items i ON i.id = v.item_id
    WHERE ${where.join(' AND ')}
    ORDER BY i.fila_reporte
    LIMIT 500
  `, params);
  res.json({ data: rows });
});

app.patch('/api/script/resultado/:valorId', async (req, res) => {
  if (!config.scriptToken || req.headers['x-script-token'] !== config.scriptToken) {
    return res.status(401).json({ error: 'Token de script invalido' });
  }
  const valorId = Number(req.params.valorId);
  const estado = req.body.estado === 'cargado' ? 'cargado' : 'error';
  await query(
    `UPDATE stock_valores_carga
     SET estado = :estado, mensaje_error = :mensaje
     WHERE id = :valorId`,
    { estado, mensaje: req.body.mensaje || null, valorId }
  );
  res.json({ ok: true });
});

app.get('/api/script/runs', requireAuth, requireAdmin, async (req, res) => {
  const importacionId = Number(req.query.importacionId || 0);
  const where = importacionId ? 'WHERE r.importacion_id = :importacionId' : '';
  const rows = await query(`
    SELECT r.id, r.importacion_id, i.archivo_nombre, r.estado, r.procesados, r.cargados, r.errores,
           r.mensaje, r.started_at, r.finished_at
    FROM stock_script_runs r
    LEFT JOIN stock_importaciones i ON i.id = r.importacion_id
    ${where}
    ORDER BY r.id DESC
    LIMIT 20
  `, { importacionId });
  res.json({ data: rows });
});

app.post('/api/script/ejecutar', requireAuth, requireAdmin, async (req, res) => {
  const importacionId = Number(req.body.importacionId || 0);
  if (!importacionId) {
    return res.status(400).json({ error: 'Seleccionar una importacion antes de ejecutar el script' });
  }
  const [importacion] = await query('SELECT id, archivo_nombre FROM stock_importaciones WHERE id = :importacionId', { importacionId });
  if (!importacion) {
    return res.status(404).json({ error: 'Importacion no encontrada' });
  }
  if (!config.farmacia.user || !config.farmacia.password) {
    return res.status(400).json({ error: 'Faltan FARMACIA_WEB_USER/FARMACIA_WEB_PASSWORD en el .env del ambiente' });
  }

  const [running] = await query(`
    SELECT id
    FROM stock_script_runs
    WHERE estado = 'iniciado' AND finished_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `);
  if (running) {
    return res.status(409).json({ error: `Ya hay una carga de script en ejecucion (#${running.id})` });
  }

  const [pending] = await query(`
    SELECT COUNT(*) AS total
    FROM stock_valores_carga v
    JOIN stock_items i ON i.id = v.item_id
    WHERE v.estado = 'listo'
      AND i.importacion_id = :importacionId
  `, { importacionId });
  if (!pending.total) {
    return res.status(400).json({ error: 'No hay productos listos para cargar por script en esta importacion' });
  }

  const insert = await query(
    `INSERT INTO stock_script_runs (importacion_id, estado, mensaje)
     VALUES (:importacionId, 'iniciado', :mensaje)`,
    { importacionId, mensaje: `Ejecucion solicitada por ${req.user.username} para importacion #${importacionId}` }
  );
  const runId = insert.insertId;
  const scriptPath = path.resolve(__dirname, '../scripts/cargar-stock-web.js');
  const logDir = path.resolve(__dirname, '../../logs');
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, `script-run-${runId}.log`), 'a');
  const err = fs.openSync(path.join(logDir, `script-run-${runId}.err.log`), 'a');

  const child = spawn(process.execPath, [scriptPath], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: config.envName,
      SCRIPT_RUN_ID: String(runId),
      SCRIPT_IMPORTACION_ID: String(importacionId)
    },
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: false
  });
  child.unref();

  await audit(req.user.sub, 'ejecutar_script', 'stock_script_runs', runId, { importacionId, pendientes: pending.total });
  res.status(202).json({ ok: true, runId, importacionId, pendientes: pending.total });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Error interno' });
});

// --- Sondeo automatico de la carpeta de trimestre ---
let sondeoTrimestreEnCurso = false;
const trimestreHashesFallidos = new Set();

async function sondearTrimestre() {
  if (sondeoTrimestreEnCurso) return;
  sondeoTrimestreEnCurso = true;
  try {
    const dir = config.trimestreSourceDir;
    if (!fs.existsSync(dir)) return;
    const rows = await query('SELECT archivo_hash FROM trimestre_importaciones');
    const conocidos = new Set(rows.map((r) => r.archivo_hash));
    const archivos = fs.readdirSync(dir).filter((f) => /\.(xls|xlsx)$/i.test(f));
    let nuevos = 0;
    for (const name of archivos) {
      let hash;
      try {
        hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
      } catch { continue; } // archivo en uso / bloqueado; se reintenta en el proximo sondeo
      if (conocidos.has(hash) || trimestreHashesFallidos.has(hash)) continue;
      try {
        const { parsed } = await procesarArchivoTrimestre(name, null);
        conocidos.add(hash);
        nuevos += 1;
        console.log(`[trimestre-watch] importado "${name}" -> T${parsed.trimestre} ${parsed.anio} (${parsed.totalItems} items)`);
      } catch (err) {
        trimestreHashesFallidos.add(hash); // no reintentar hasta que cambie el archivo
        console.warn(`[trimestre-watch] "${name}" omitido: ${err.message}`);
      }
    }
    trimestreUltimoResumen = { archivos: archivos.length, nuevos };
  } catch (err) {
    console.error('[trimestre-watch] error de sondeo:', err.message);
  } finally {
    trimestreUltimoSondeo = new Date().toISOString();
    sondeoTrimestreEnCurso = false;
  }
}

function iniciarSondeoTrimestre() {
  if (!config.trimestreWatch.enabled) {
    console.log('[trimestre-watch] deshabilitado (TRIMESTRE_WATCH=off)');
    return;
  }
  const { intervalMs } = config.trimestreWatch;
  console.log(`[trimestre-watch] activo. Carpeta: ${config.trimestreSourceDir} · cada ${Math.round(intervalMs / 1000)}s`);
  setTimeout(sondearTrimestre, 4000); // primera corrida poco despues de arrancar
  setInterval(sondearTrimestre, intervalMs);
}

// --- Sondeo automatico de la carpeta de stock critico ---
let sondeoCriticoEnCurso = false;
const criticoHashesFallidos = new Set();

async function sondearCritico() {
  if (sondeoCriticoEnCurso) return;
  sondeoCriticoEnCurso = true;
  try {
    const dir = config.criticoSourceDir;
    if (!fs.existsSync(dir)) return;
    const rows = await query('SELECT archivo_hash FROM stock_importaciones WHERE archivo_hash IS NOT NULL');
    const conocidos = new Set(rows.map((r) => r.archivo_hash));
    const files = listSourceFiles(dir);
    let nuevos = 0;
    for (const f of files) {
      let hash;
      try {
        hash = crypto.createHash('sha256').update(fs.readFileSync(f.fullPath)).digest('hex');
      } catch { continue; } // archivo en uso / bloqueado; se reintenta en el proximo sondeo
      if (conocidos.has(hash) || criticoHashesFallidos.has(hash)) continue;
      try {
        const { result, parsed } = await procesarArchivoCritico(f.name, null);
        conocidos.add(hash);
        nuevos += 1;
        console.log(`[critico-watch] importado "${f.name}" -> importacion #${result.importacionId} (${parsed.totalItems} items, ${parsed.itemsConGuion} con guion)`);
      } catch (err) {
        criticoHashesFallidos.add(hash); // no reintentar hasta que cambie el archivo
        console.warn(`[critico-watch] "${f.name}" omitido: ${err.message}`);
      }
    }
    criticoUltimoResumen = { archivos: files.length, nuevos };
  } catch (err) {
    console.error('[critico-watch] error de sondeo:', err.message);
  } finally {
    criticoUltimoSondeo = new Date().toISOString();
    sondeoCriticoEnCurso = false;
  }
}

function iniciarSondeoCritico() {
  if (!config.criticoWatch.enabled) {
    console.log('[critico-watch] deshabilitado (CRITICO_WATCH=off)');
    return;
  }
  const { intervalMs } = config.criticoWatch;
  console.log(`[critico-watch] activo. Carpeta: ${config.criticoSourceDir} · cada ${Math.round(intervalMs / 1000)}s`);
  setTimeout(sondearCritico, 6000); // primera corrida poco despues de arrancar
  setInterval(sondearCritico, intervalMs);
}

app.listen(config.port, () => {
  console.log(`${config.appName} backend ${config.envName} escuchando en ${config.port}`);
  iniciarSondeoTrimestre();
  iniciarSondeoCritico();
});

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
