const { query, transaction } = require('./db');
const { audit } = require('./audit');

// Historial de cambios de codigo: el Ministerio fue cambiando los codigos de los productos
// (ej. CEFOTAXIMA 1 GR frasco ampolla M0724122 -> CEFOTAXIMA 1 G vial M0724164). Cada fuente
// (stock, consumo, O.C., requerimientos) trae el que tenia en su momento. Aca se guarda que dos
// codigos son el mismo producto ('igual') o que se reviso y no lo son ('distinto', para no volver
// a sugerirlos). Los 'igual' arman familias: los datos de todos los codigos de una familia se suman.
async function ensureEquivTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS codigo_equivalencias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo_a VARCHAR(20) NOT NULL,
      codigo_b VARCHAR(20) NOT NULL,
      estado VARCHAR(10) NOT NULL,
      nota VARCHAR(255) NULL,
      detalle JSON NULL,
      usuario_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_codigo_equiv (codigo_a, codigo_b),
      KEY idx_codigo_equiv_b (codigo_b)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

const par = (x, y) => (x < y ? [x, y] : [y, x]);

// Mapa codigo -> [codigos de la misma familia, incluido el mismo] (solo codigos con equivalencias)
async function familias() {
  const rows = await query("SELECT codigo_a, codigo_b FROM codigo_equivalencias WHERE estado = 'igual'");
  const padre = new Map();
  const raiz = (c) => {
    while (padre.get(c) !== c) { padre.set(c, padre.get(padre.get(c))); c = padre.get(c); }
    return c;
  };
  for (const r of rows) {
    for (const c of [r.codigo_a, r.codigo_b]) if (!padre.has(c)) padre.set(c, c);
    const a = raiz(r.codigo_a);
    const b = raiz(r.codigo_b);
    if (a !== b) padre.set(a, b);
  }
  const grupos = new Map();
  for (const c of padre.keys()) {
    const k = raiz(c);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  const out = new Map();
  for (const g of grupos.values()) { g.sort(); for (const c of g) out.set(c, g); }
  return out;
}

// Para sumar datos de toda la familia: dado los codigos pedidos, devuelve todos los codigos a
// consultar y, para cada uno, a que codigos pedidos se le suman sus datos.
async function expandirCodigos(codigos) {
  const fam = await familias();
  const destinos = new Map();
  for (const c of codigos) {
    for (const x of fam.get(c) || [c]) {
      if (!destinos.has(x)) destinos.set(x, []);
      if (!destinos.get(x).includes(c)) destinos.get(x).push(c);
    }
  }
  return { todos: Array.from(destinos.keys()), destinos, fam };
}

// ---------------- Sugerencias ----------------
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const norm = (s) => sinAcentos(s).replace(/[^A-Z0-9.,%/+ -]/g, ' ').replace(/\s+/g, ' ').trim();
const PALABRAS_SAL = new Set(['CLORHIDRATO', 'DICLORHIDRATO', 'SODICO', 'SODICA', 'POTASICO', 'POTASICA', 'CALCICO', 'CALCICA',
  'DE', 'DEL', 'LA', 'EL', 'COMO', 'Y', 'CON', 'BASE', 'HUMANA', 'HUMANO', 'MALEATO', 'BROMHIDRATO', 'MESILATO', 'TARTRATO', 'FOSFATO', 'SUCCINATO']);

function tokensDroga(droga) {
  return new Set(sinAcentos(droga).replace(/[^A-Z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length > 2 && !PALABRAS_SAL.has(t) && !/^\d/.test(t)));
}

function mismaDroga(a, b) {
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const t of a) if (b.has(t)) comunes += 1;
  if (!comunes) return 0;
  // Todas las palabras de una estan en la otra (ej. "MORFINA" vs "MORFINA CLORHIDRATO")
  if (comunes === Math.min(a.size, b.size)) return comunes === Math.max(a.size, b.size) ? 1 : 0.8;
  return comunes / Math.max(a.size, b.size) >= 0.5 ? 0.6 : 0;
}

const FORMAS = [
  ['OFT', /OFTALM|COLIRIO/],
  ['INH', /INHALA|AEROSOL|NEBULIZ|PRESURIZ|AEROCAMARA/],
  ['TOP', /CREMA|UNGUENTO|LOCION|GEL\b|POMADA|CUTANE|TOPIC|DERMIC/],
  ['VAG', /VAGINAL|OVULO/],
  ['INY', /INYECT|AMPOLLA|VIAL|FRASCO AMPOLLA|F\.?A\.?\b|PARENTERAL|JERINGA|E\.?V\.?\b/],
  ['LIQ', /JARABE|SUSPENSION|SOLUCION ORAL|GOTAS|GOTA\b|ELIXIR|POLVO P\/?SUSP|POLVO PARA SUSP/],
  ['SOL', /COMPRIMID|CAPSULA|GRAGEA|TABLETA|SOFTGEL|\bCOMP\b|\bCAPS\b/]
];
function formaDe(desc) {
  const t = norm(desc);
  for (const [k, re] of FORMAS) if (re.test(t)) return k;
  return null;
}

// Numeros de la concentracion, con equivalencias simples (1 G = 1000 MG, 500 MG - 10 ML = 50 MG/ML)
function numerosDe(desc) {
  const t = norm(desc).replace(/(\d),(\d)/g, '$1.$2');
  const out = new Set();
  const add = (v) => { if (Number.isFinite(v) && v > 0) out.add(Math.round(v * 1000) / 1000); };
  // Solo numeros con unidad de dosis (los volumenes sueltos, "5 ML", "100 ML", no cuentan)
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(MG|MCG|UG|G|GR|UI|U\.I\.|%)(?![A-Z])/g)) {
    const v = Number(m[1]);
    add(v);
    if (m[2] === 'G' || m[2] === 'GR') add(v * 1000);
    if (m[2] === 'MCG' || m[2] === 'UG') add(v / 1000);
    if (m[2] === '%') add(v * 10); // 1% = 10 mg/ml
  }
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(MG|MCG|G|GR|UI)\s*[-/]\s*(\d+(?:\.\d+)?)\s*ML/g)) {
    let v = Number(m[1]);
    if (m[2] === 'G' || m[2] === 'GR') v *= 1000;
    if (m[2] === 'MCG') v /= 1000;
    add(v / Number(m[3]));
  }
  return out;
}

// Donde aparece cada codigo (para seguir el hilo: cual es el viejo y cual el nuevo)
async function huellas(codigos) {
  const out = {};
  for (const c of codigos) out[c] = { codigo: c };
  if (!codigos.length) return out;
  const inCod = codigos.map((_, i) => ':c' + i).join(', ');
  const pc = Object.fromEntries(codigos.map((c, i) => ['c' + i, c]));
  const [stk] = await query("SELECT id FROM stock_actual_descargas WHERE estado = 'ok' ORDER BY id DESC LIMIT 1");
  if (stk) {
    for (const r of await query(`SELECT codigo, SUM(stock) stock, MAX(TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion))) d
      FROM stock_actual_items WHERE descarga_id = :id AND codigo IN (${inCod}) GROUP BY codigo`, { id: stk.id, ...pc })) {
      out[r.codigo].stock = Number(r.stock || 0);
      out[r.codigo].descStock = r.d;
    }
  }
  for (const r of await query(`SELECT ti.codigo_articulo codigo, MIN(i.anio) desde, MAX(i.anio) hasta, SUM(ti.cantidad) cantidad
    FROM trimestre_items ti JOIN trimestre_importaciones i ON i.id = ti.trimestre_importacion_id
    WHERE ti.codigo_articulo IN (${inCod}) GROUP BY ti.codigo_articulo`, pc)) {
    out[r.codigo].consumo = { desde: r.desde, hasta: r.hasta, cantidad: Number(r.cantidad || 0) };
  }
  for (const r of await query(`SELECT codigo, MAX(anio) anio, SUM(total) total FROM consumo_ms_items WHERE codigo IN (${inCod}) GROUP BY codigo`, pc)) {
    out[r.codigo].consumoMs = { anio: r.anio, total: Number(r.total || 0) };
  }
  for (const r of await query(`SELECT codigo, COUNT(*) n, MIN(anio) desde, MAX(anio) hasta, SUM(cantidad) cantidad
    FROM oc_historial WHERE codigo IN (${inCod}) GROUP BY codigo`, pc)) {
    out[r.codigo].oc = { n: Number(r.n), desde: r.desde, hasta: r.hasta, cantidad: Number(r.cantidad || 0) };
  }
  for (const r of await query(`SELECT ri.codigo, MAX(YEAR(i.periodo_desde)) anio, SUM(ri.cantidad) cantidad
    FROM requerimiento_items ri JOIN requerimiento_importaciones i ON i.id = ri.importacion_id
    WHERE ri.codigo IN (${inCod}) GROUP BY ri.codigo`, pc)) {
    out[r.codigo].reqPdf = { anio: r.anio, cantidad: Number(r.cantidad || 0) };
  }
  return out;
}

// Para cada renglon "por controlar" con cantidad 0 del semestre, los codigos que podrian ser el mismo producto
async function sugerencias(anio, semestre) {
  const manual = await query('SELECT id, codigo, droga, descripcion, cantidad, controlado FROM requerimiento_manual WHERE anio = :anio AND semestre = :semestre', { anio, semestre });
  const decididos = new Set((await query('SELECT codigo_a, codigo_b FROM codigo_equivalencias')).map((r) => `${r.codigo_a}|${r.codigo_b}`));
  const fam = await familias();
  const catalogo = await query(`
    SELECT codigo, MAX(droga) droga, MAX(descripcion) descripcion FROM (
      SELECT codigo, nombre_generico droga, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) descripcion
        FROM stock_actual_items WHERE codigo <> ''
      UNION ALL SELECT codigo, nombre_generico, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) FROM consumo_ms_items WHERE codigo <> ''
      UNION ALL SELECT codigo_articulo, nombre_generico, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) FROM trimestre_items WHERE codigo_articulo <> ''
      UNION ALL SELECT codigo, droga, LEFT(descripcion, 500) FROM requerimiento_items
      UNION ALL SELECT codigo, NULL, descripcion FROM oc_historial WHERE codigo <> ''
    ) t WHERE codigo IS NOT NULL GROUP BY codigo
  `);
  const manualPorCodigo = new Map(manual.map((m) => [m.codigo, m]));
  const info = new Map();
  for (const c of catalogo) info.set(c.codigo, { codigo: c.codigo, droga: c.droga || '', descripcion: c.descripcion || '' });
  for (const m of manual) info.set(m.codigo, { codigo: m.codigo, droga: m.droga || '', descripcion: m.descripcion || '' });
  const prep = new Map();
  for (const x of info.values()) {
    const desc = `${x.droga} ${x.descripcion}`;
    prep.set(x.codigo, { ...x, tok: tokensDroga(x.droga || x.descripcion.split(/ - |\d/)[0]), tokDesc: tokensDroga(x.descripcion), forma: formaDe(desc), nums: numerosDe(x.descripcion) });
  }

  const pendientes = manual.filter((m) => !Number(m.controlado) && Number(m.cantidad) === 0);
  const resultado = [];
  const codigosHuella = new Set();
  for (const p of pendientes) {
    const a = prep.get(p.codigo);
    const famP = new Set(fam.get(p.codigo) || [p.codigo]);
    const cands = [];
    for (const b of prep.values()) {
      if (famP.has(b.codigo)) continue;
      if (decididos.has(par(p.codigo, b.codigo).join('|'))) continue;
      let d = mismaDroga(a.tok, b.tok);
      if (!d && a.tok.size && b.tokDesc.size) d = mismaDroga(a.tok, b.tokDesc) * 0.9;
      if (!d) continue;
      let score = 40 * d;
      const motivos = [];
      if (a.forma && b.forma) {
        if (a.forma === b.forma) { score += 30; motivos.push('misma forma'); } else continue; // inyectable vs comprimido: no es el mismo
      }
      const comunes = [...a.nums].filter((n) => b.nums.has(n)).length;
      const union = new Set([...a.nums, ...b.nums]).size;
      if (comunes && comunes / union >= 0.5) { score += 25; motivos.push('misma concentración'); }
      else if (comunes) { score += 5; motivos.push('concentración parecida'); }
      else if (a.nums.size && b.nums.size) { score -= 20; motivos.push('concentración distinta'); }
      const enManual = manualPorCodigo.get(b.codigo);
      if (enManual) { score += 5; motivos.push(Number(enManual.controlado) ? 'ya controlado en la carga' : 'en la carga'); }
      if (score < 45) continue;
      cands.push({ codigo: b.codigo, droga: b.droga, descripcion: b.descripcion, score: Math.round(score), motivos,
        manual: enManual ? { id: enManual.id, cantidad: Number(enManual.cantidad), controlado: !!Number(enManual.controlado) } : null });
    }
    cands.sort((x, y) => y.score - x.score || (y.manual ? 1 : 0) - (x.manual ? 1 : 0));
    const top = cands.slice(0, 4);
    for (const c of [p.codigo, ...top.map((t) => t.codigo)]) codigosHuella.add(c);
    resultado.push({ id: p.id, codigo: p.codigo, droga: p.droga, descripcion: p.descripcion, candidatos: top });
  }
  const h = await huellas(Array.from(codigosHuella));
  // Señal extra: uno tiene stock y no consumo, el otro consumo y no stock (codigo viejo -> nuevo)
  for (const r of resultado) {
    const hp = h[r.codigo] || {};
    for (const c of r.candidatos) {
      const hc = h[c.codigo] || {};
      const soloStock = (x) => x.stock != null && !x.consumo && !x.consumoMs;
      const sinStockConHist = (x) => x.stock == null && (x.consumo || x.consumoMs || x.oc);
      if ((soloStock(hp) && sinStockConHist(hc)) || (soloStock(hc) && sinStockConHist(hp))) {
        c.score += 10;
        c.motivos.push('uno tiene stock y el otro el historial');
      }
      c.nivel = c.score >= 90 ? 'alta' : c.score >= 70 ? 'media' : 'baja';
    }
    r.candidatos.sort((x, y) => y.score - x.score);
  }
  // Primero los que tienen la sugerencia mas segura
  resultado.sort((x, y) => (y.candidatos[0]?.score || 0) - (x.candidatos[0]?.score || 0) || String(x.droga).localeCompare(String(y.droga)));
  return { pendientes: resultado, huellas: h };
}

// ---------------- Acciones ----------------
function errorStatus(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// Marca dos codigos como el mismo producto. Si los dos estan en la carga del semestre, deja un solo
// renglon: el que tenia trabajo (cantidad o tilde), con el codigo elegido en "queda".
async function unificar({ codigo, con, queda, anio, semestre, nota }, usuarioId) {
  codigo = String(codigo || '').trim();
  con = String(con || '').trim();
  if (!codigo || !con || codigo === con) throw errorStatus('Elegí dos códigos distintos');
  queda = queda === con ? con : codigo;
  const [a, b] = par(codigo, con);
  const detalle = { anio, semestre, queda };
  await transaction(async (conn) => {
    const [filas] = await conn.execute(
      'SELECT * FROM requerimiento_manual WHERE anio = ? AND semestre = ? AND codigo IN (?, ?)',
      [anio, semestre, codigo, con]
    );
    if (filas.length === 2) {
      const trabajo = (f) => Number(f.cantidad) > 0 || Number(f.controlado);
      const [f1, f2] = filas;
      if (Number(f1.cantidad) > 0 && Number(f2.cantidad) > 0) {
        throw errorStatus(`Los dos renglones tienen cantidad (${f1.codigo}: ${Number(f1.cantidad)}, ${f2.codigo}: ${Number(f2.cantidad)}). Dejá en 0 el que sobra y volvé a unificar.`, 409);
      }
      const sigue = trabajo(f2) && !trabajo(f1) ? f2 : f1;
      const sale = sigue === f1 ? f2 : f1;
      await conn.execute('DELETE FROM requerimiento_manual WHERE id = ?', [sale.id]);
      const quedaFila = filas.find((f) => f.codigo === queda);
      if (sigue.codigo !== queda) {
        await conn.execute('UPDATE requerimiento_manual SET codigo = ?, droga = ?, descripcion = ? WHERE id = ?',
          [queda, quedaFila.droga, quedaFila.descripcion, sigue.id]);
      }
      if (Number(sale.controlado) && !Number(sigue.controlado)) {
        await conn.execute('UPDATE requerimiento_manual SET controlado = 1 WHERE id = ?', [sigue.id]);
      }
      detalle.sacado = { ...sale, created_at: undefined, updated_at: undefined };
      detalle.renglon = { id: sigue.id, codigoAntes: sigue.codigo, drogaAntes: sigue.droga, descripcionAntes: sigue.descripcion, controladoAntes: Number(sigue.controlado) };
    }
    await conn.execute(
      `INSERT INTO codigo_equivalencias (codigo_a, codigo_b, estado, nota, detalle, usuario_id) VALUES (?, ?, 'igual', ?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE estado = 'igual', nota = VALUES(nota), detalle = VALUES(detalle), usuario_id = VALUES(usuario_id), created_at = CURRENT_TIMESTAMP`,
      [a, b, nota || null, JSON.stringify(detalle), usuarioId || null]
    );
  });
  await audit(usuarioId, 'unificar_codigos', 'codigo_equivalencias', `${a}|${b}`, detalle);
  return detalle;
}

async function descartar({ codigo, con }, usuarioId) {
  const [a, b] = par(String(codigo || '').trim(), String(con || '').trim());
  if (!a || !b || a === b) throw errorStatus('Elegí dos códigos distintos');
  await query(
    `INSERT INTO codigo_equivalencias (codigo_a, codigo_b, estado, usuario_id) VALUES (:a, :b, 'distinto', :u)
     ON DUPLICATE KEY UPDATE estado = 'distinto', usuario_id = VALUES(usuario_id), created_at = CURRENT_TIMESTAMP`,
    { a, b, u: usuarioId || null }
  );
  await audit(usuarioId, 'descartar_equivalencia', 'codigo_equivalencias', `${a}|${b}`, {});
}

// Deshace un vinculo: si al unificar se saco un renglon de la carga, se vuelve a poner como estaba
async function deshacer(id, usuarioId) {
  const [eq] = await query('SELECT * FROM codigo_equivalencias WHERE id = :id', { id });
  if (!eq) throw errorStatus('No existe ese vínculo', 404);
  const det = typeof eq.detalle === 'string' ? JSON.parse(eq.detalle || 'null') : eq.detalle;
  await transaction(async (conn) => {
    if (det?.renglon) {
      const [r] = await conn.execute('SELECT id FROM requerimiento_manual WHERE id = ?', [det.renglon.id]);
      if (r.length) {
        await conn.execute('UPDATE requerimiento_manual SET controlado = ? WHERE id = ?', [det.renglon.controladoAntes, det.renglon.id]);
        if (det.renglon.codigoAntes) {
          await conn.execute('UPDATE IGNORE requerimiento_manual SET codigo = ?, droga = COALESCE(?, droga), descripcion = COALESCE(?, descripcion) WHERE id = ?',
            [det.renglon.codigoAntes, det.renglon.drogaAntes ?? null, det.renglon.descripcionAntes ?? null, det.renglon.id]);
        }
      }
    }
    if (det?.sacado) {
      const s = det.sacado;
      await conn.execute(
        `INSERT IGNORE INTO requerimiento_manual (anio, semestre, codigo, droga, descripcion, cantidad, controlado, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.anio, s.semestre, s.codigo, s.droga, s.descripcion, s.cantidad, s.controlado, s.creado_por]
      );
    }
    await conn.execute('DELETE FROM codigo_equivalencias WHERE id = ?', [id]);
  });
  await audit(usuarioId, 'deshacer_equivalencia', 'codigo_equivalencias', `${eq.codigo_a}|${eq.codigo_b}`, { estado: eq.estado });
}

async function historial() {
  const rows = await query(`
    SELECT e.id, e.codigo_a, e.codigo_b, e.estado, e.nota, e.detalle, e.created_at, u.username usuario
    FROM codigo_equivalencias e LEFT JOIN usuarios u ON u.id = e.usuario_id
    ORDER BY e.created_at DESC, e.id DESC
  `);
  const codigos = Array.from(new Set(rows.flatMap((r) => [r.codigo_a, r.codigo_b])));
  const desc = new Map();
  if (codigos.length) {
    const inCod = codigos.map((_, i) => ':c' + i).join(', ');
    const pc = Object.fromEntries(codigos.map((c, i) => ['c' + i, c]));
    const fuentes = await query(`
      SELECT codigo, MAX(d) d FROM (
        SELECT codigo, descripcion d FROM requerimiento_manual WHERE codigo IN (${inCod})
        UNION ALL SELECT codigo, LEFT(descripcion, 300) FROM requerimiento_items WHERE codigo IN (${inCod})
        UNION ALL SELECT codigo, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) FROM stock_actual_items WHERE codigo IN (${inCod})
        UNION ALL SELECT codigo_articulo, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) FROM trimestre_items WHERE codigo_articulo IN (${inCod})
        UNION ALL SELECT codigo, descripcion FROM oc_historial WHERE codigo IN (${inCod})
      ) t GROUP BY codigo`, pc);
    for (const f of fuentes) desc.set(f.codigo, f.d);
  }
  return rows.map((r) => ({ ...r, detalle: typeof r.detalle === 'string' ? JSON.parse(r.detalle || 'null') : r.detalle, desc_a: desc.get(r.codigo_a) || null, desc_b: desc.get(r.codigo_b) || null }));
}

module.exports = { ensureEquivTables, familias, expandirCodigos, sugerencias, huellas, unificar, descartar, deshacer, historial };
