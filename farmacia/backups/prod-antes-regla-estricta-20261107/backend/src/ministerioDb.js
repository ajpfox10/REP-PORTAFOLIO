const crypto = require('crypto');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { query, transaction } = require('./db');

// Comunicacion de compra del Ministerio (PDF "Adjudicaciones MB ... COMUNICACIÓN COMPRA 1ER SEMESTRE 2027"):
// lista de codigos con "HABILITADO COMPRA" = COMPRAR / NO / COMPRAR POR 3 MESES...
// Se cruza con los requerimientos para ver que se pidio y el Ministerio no habilito.
async function ensureMinisterioTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS ministerio_comunicaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      archivo_nombre VARCHAR(255) NOT NULL,
      archivo_hash CHAR(64) NOT NULL,
      periodo_texto VARCHAR(120) NULL,
      anio INT NULL,
      semestre TINYINT NULL,
      total_items INT NOT NULL DEFAULT 0,
      creado_por INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ministerio_hash (archivo_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS ministerio_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      comunicacion_id INT NOT NULL,
      fila INT NOT NULL,
      codigo VARCHAR(40) NOT NULL,
      medicamento TEXT NULL,
      habilitado VARCHAR(120) NULL,
      decision ENUM('comprar','parcial','no','otro') NOT NULL DEFAULT 'otro',
      INDEX idx_ministerio_items_codigo (codigo),
      CONSTRAINT fk_ministerio_items_comunicacion FOREIGN KEY (comunicacion_id) REFERENCES ministerio_comunicaciones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function limpiar(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// "NO" -> no; "COMPRAR" -> comprar; "COMPRAR POR 3 MESES" -> parcial
function decisionDe(habilitado) {
  const t = limpiar(habilitado).toUpperCase();
  if (!t) return 'otro';
  if (/^NO\b/.test(t)) return 'no';
  if (/^COMPRAR$/.test(t)) return 'comprar';
  if (/COMPRAR/.test(t)) return 'parcial';
  return 'otro';
}

// "… COMPRA 1ER SEMESTRE 2027" en el nombre del archivo -> { texto: '1er semestre 2027', anio: 2027, semestre: 1 }
function periodoDeNombre(nombre) {
  const t = String(nombre || '').toUpperCase();
  const m = /(1|2|PRIMER|SEGUNDO)\s*(?:ER|DO|º|°)?\s*SEMESTRE\s*(\d{4})/.exec(t);
  if (!m) return { texto: null, anio: null, semestre: null };
  const semestre = /^(1|PRIMER)$/.test(m[1]) ? 1 : 2;
  return { texto: `${semestre === 1 ? '1er' : '2do'} semestre ${m[2]}`, anio: Number(m[2]), semestre };
}

// Columnas por posicion X: codigo (x<110), medicamento (110-430), habilitado compra (>=430)
async function parseComunicacion(buffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false }).promise;
  const filas = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const lineas = new Map();
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const clave = Array.from(lineas.keys()).find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!lineas.has(clave)) lineas.set(clave, { codigo: '', medicamento: [], habilitado: [] });
      const l = lineas.get(clave);
      const x = it.transform[4];
      if (x < 110) l.codigo += it.str.trim();
      else if (x < 430) l.medicamento.push(it.str);
      else l.habilitado.push(it.str);
    }
    for (const y of Array.from(lineas.keys()).sort((a, b) => b - a)) {
      const l = lineas.get(y);
      const codigo = limpiar(l.codigo).toUpperCase();
      if (!/^[A-Z]\d{5,}/.test(codigo)) continue; // encabezado u otras lineas
      const habilitado = limpiar(l.habilitado.join(' ')).toUpperCase();
      filas.push({ codigo, medicamento: limpiar(l.medicamento.join(' ')), habilitado, decision: decisionDe(habilitado) });
    }
  }
  return filas;
}

async function importarComunicacion(buffer, nombre, usuarioId) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const [existe] = await query('SELECT id FROM ministerio_comunicaciones WHERE archivo_hash = :hash', { hash });
  if (existe) return { id: existe.id, duplicado: true };
  const filas = await parseComunicacion(buffer);
  if (!filas.length) throw Object.assign(new Error('No se encontraron códigos en el PDF (se esperaba la tabla CÓDIGO / MEDICAMENTO / HABILITADO COMPRA)'), { status: 400 });
  const periodo = periodoDeNombre(nombre);
  const id = await transaction(async (conn) => {
    // Una nueva version de la comunicacion del mismo semestre reemplaza a la anterior
    if (periodo.anio) {
      await conn.execute('DELETE FROM ministerio_comunicaciones WHERE anio = ? AND semestre = ?', [periodo.anio, periodo.semestre]);
    }
    const [ins] = await conn.execute(
      `INSERT INTO ministerio_comunicaciones (archivo_nombre, archivo_hash, periodo_texto, anio, semestre, total_items, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nombre, hash, periodo.texto, periodo.anio, periodo.semestre, filas.length, usuarioId || null]
    );
    let fila = 0;
    for (const f of filas) {
      fila += 1;
      await conn.execute(
        'INSERT INTO ministerio_items (comunicacion_id, fila, codigo, medicamento, habilitado, decision) VALUES (?, ?, ?, ?, ?, ?)',
        [ins.insertId, fila, f.codigo, f.medicamento, f.habilitado, f.decision]
      );
    }
    return ins.insertId;
  });
  return { id, duplicado: false, periodo: periodo.texto, items: filas.length };
}

async function listarComunicaciones() {
  return query(`
    SELECT c.id, c.archivo_nombre, c.periodo_texto, c.anio, c.semestre, c.total_items, c.created_at,
           SUM(i.decision = 'comprar') comprar, SUM(i.decision = 'parcial') parcial, SUM(i.decision = 'no') no_comprar
    FROM ministerio_comunicaciones c
    LEFT JOIN ministerio_items i ON i.comunicacion_id = c.id
    GROUP BY c.id
    ORDER BY c.anio DESC, c.semestre DESC, c.id DESC
  `);
}

async function itemsComunicacion(id) {
  return query(`
    SELECT id, fila, codigo, medicamento, habilitado, decision
    FROM ministerio_items WHERE comunicacion_id = :id ORDER BY fila
  `, { id });
}

async function eliminarComunicacion(id) {
  const r = await query('DELETE FROM ministerio_comunicaciones WHERE id = :id', { id });
  return r.affectedRows;
}

module.exports = {
  ensureMinisterioTables,
  parseComunicacion,
  importarComunicacion,
  listarComunicaciones,
  itemsComunicacion,
  eliminarComunicacion
};
