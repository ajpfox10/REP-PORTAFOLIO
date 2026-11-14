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

// ---------------- Comparacion estricta: droga, concentracion y presentacion ----------------
// Dos codigos son el mismo producto solo si coinciden las tres cosas. Si alguna NO coincide no se
// sugiere y para unificarlos igual hay que confirmarlo a mano.
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const norm = (s) => sinAcentos(s).replace(/[^A-Z0-9.,%/+ -]/g, ' ').replace(/\s+/g, ' ').trim();
// Sales, conectores y accesorios que no cambian la droga (ej. "GENTAMICINA SULFATO" = "GENTAMICINA")
const PALABRAS_SAL = new Set(['CLORHIDRATO', 'DICLORHIDRATO', 'SODICO', 'SODICA', 'POTASICO', 'POTASICA', 'CALCICO', 'CALCICA',
  'DE', 'DEL', 'LA', 'EL', 'COMO', 'Y', 'CON', 'BASE', 'HUMANA', 'HUMANO', 'MALEATO', 'BROMHIDRATO', 'MESILATO', 'TARTRATO',
  'FOSFATO', 'SUCCINATO', 'SULFATO', 'ACETATO', 'PROPIONATO', 'CLORURO', 'AEROCAMARA', 'FCO', 'FRASCO', 'AMPOLLA', 'AMPOLLAS',
  'COMPRIMIDO', 'COMPRIMIDOS', 'INYECTABLE', 'SOLUCION', 'SUSPENSION', 'ORAL', 'JARABE', 'GOTAS', 'POLVO', 'PARA',
  'DOSIS', 'DOSISX', 'MCG', 'MGRS', 'VTO', 'SIN', 'CANJE', 'PRELLENADA', 'JERINGA', 'VIAL', 'ENVASE', 'POMO', 'UNIDADES',
  'AEROSOL', 'INHALADOR', 'CREMA', 'LOCION', 'UNGUENTO', 'COLIRIO', 'CAPSULA', 'CAPSULAS', 'GEL', 'RENGLON',
  'OFTALMICO', 'OFTALMICA', 'OFTALMICAS', 'NEBULIZAR', 'NEBULIZACION', 'INHALACION', 'INHALATORIO', 'INHALATORIA', 'PRESURIZADA',
  'PROPINATO', 'UNIDAD', 'BOLSA', 'SACHET', 'ALTERNATIVO', 'BRONCODILATADOR', 'ANALGESICO']);
// Nombres distintos de la misma droga
const SINONIMOS = { DEXTROSA: 'GLUCOSA', DEXTROSADA: 'GLUCOSA', GLUCOSADA: 'GLUCOSA', DIFENILHIDANTOINA: 'FENITOINA' };

// Misma palabra aunque tenga un error de tipeo: PROPANOLOL = PROPRANOLOL, ATORVASTATIN = ATORVASTATINA
function mismaPalabra(x, y) {
  if (x === y) return true;
  if (x.length < 7 || y.length < 7) return false;
  if (Math.abs(x.length - y.length) === 1 && (x.startsWith(y) || y.startsWith(x))) return true;
  if (Math.abs(x.length - y.length) > 1) return false;
  // distancia de edicion <= 1
  let i = 0; let j = 0; let dif = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { i += 1; j += 1; continue; }
    dif += 1;
    if (dif > 1) return false;
    if (x.length > y.length) i += 1; else if (y.length > x.length) j += 1; else { i += 1; j += 1; }
  }
  return dif + (x.length - i) + (y.length - j) <= 1;
}
const tieneParecida = (set, t) => [...set].some((u) => mismaPalabra(t, u));

// Palabras de la droga: las de afuera de los parentesis (tok) y las de adentro (alt, ej. "(HIERRO)", "(ENOXAPARINA)").
// "S/EPINEFRINA" o "SIN CONSERVADORES" dicen lo que NO tiene: se sacan.
function partesDroga(droga) {
  let t = sinAcentos(droga).replace(/(^|[^A-Z])(S\/|SIN )\s*[A-Z]+/g, '$1 ');
  const alt = [];
  t = t.replace(/\(([^)]*)\)/g, (_, x) => { alt.push(x); return ' '; });
  const tk = (x) => new Set(x.replace(/[^A-Z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !PALABRAS_SAL.has(w) && !/^\d/.test(w))
    .map((w) => SINONIMOS[w] || w));
  return { tok: tk(t), alt: tk(alt.join(' ')) };
}
function tokensDroga(droga) {
  return partesDroga(droga).tok;
}

// Forma farmaceutica. Las del mismo grupo ("liquido oral") son parecidas, no iguales.
const FORMAS = [
  ['ungüento oftálmico', /UNGUENTO OFTALM/],
  ['oftálmico', /OFTALM|COLIRIO/],
  ['nebulización', /NEBULIZ/],
  ['aerosol / inhalador', /INHALA|AEROSOL|PRESURIZ|INHALADOR/],
  ['vaginal', /VAGINAL|OVULO/],
  ['inyectable', /INYECT|AMPOLLA|VIAL|JERINGA|PARENTERAL|\bI\.?V\.?\b/],
  ['crema', /CREMA/],
  ['ungüento', /UNGUENTO|POMADA/],
  ['loción', /LOCION/],
  ['gel', /\bGEL\b/],
  ['gotas', /GOTAS|\bGOTA\b/],
  ['jarabe', /JARABE|ELIXIR/],
  ['suspensión oral', /SUSPENSION|P\/ ?SUSP|PARA SUSP/],
  ['solución oral', /SOLUCION ORAL/],
  ['cápsula', /CAPSULA|SOFTGEL|\bCAPS\b/],
  ['comprimido', /COMPRIMID|\bCOMP\b|TABLETA|GRAGEA/]
];
const LIQUIDO_ORAL = new Set(['jarabe', 'suspensión oral', 'solución oral']);
// Formas que en Farmacia se toman como el mismo producto: capsula = comprimido, gotas = solucion oral
const MISMA_FORMA = { 'cápsula': 'comprimido', gotas: 'solución oral' };
const grupoForma = (f) => MISMA_FORMA[f] || f;
const TOPICO = new Set(['crema', 'ungüento', 'loción', 'gel', 'oftálmico', 'ungüento oftálmico']);
function formaDe(desc) {
  const t = norm(desc);
  for (const [k, re] of FORMAS) if (re.test(t)) return k;
  return null;
}
// Envase de los inyectables: frasco ampolla/vial, ampolla o jeringa prellenada
function envaseDe(desc) {
  const t = norm(desc);
  if (/JERINGA/.test(t)) return 'jeringa';
  if (/(FRASCO|FCO\.?) ?AMPOLLA|VIAL|\bF\.?A\.?\b|POLVO (PARA|P\/) ?SOL|LIOFILIZ/.test(t)) return 'frasco ampolla';
  if (/AMPOLLA/.test(t)) return 'ampolla';
  return null;
}

// Contenido de cada unidad en ml (ampolla de 1 ml / 5 ml, frasco de 30 ml, envase 10/15 ml).
// No cuenta el ml de una concentracion ("10 MG/ML", "50MG/100ML"): solo el volumen que no va despues de "/".
// Un conjunto vacio = la descripcion no dice el volumen.
function volumenDe(desc) {
  const t = norm(desc).replace(/(\d),(\d)/g, '$1.$2');
  const V = new Set();
  const r = (v) => Math.round(v * 1000) / 1000;
  // "10/15 ML" (envase de 10 o de 15 ml): son los dos volumenes posibles
  const resto = t.replace(/(^|[^/\d.])\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(ML|CC)\b/g, (m, pre, v1, v2) => {
    V.add(r(Number(v1))); V.add(r(Number(v2)));
    return `${pre} `;
  });
  for (const m of resto.matchAll(/(\d+(?:\.\d+)?)\s*(ML|CC)\b/g)) {
    const antes = resto.slice(0, m.index);
    if (/\/\s*$/.test(antes)) continue; // denominador de una concentracion
    const v = Number(m[1]);
    if (v > 0) V.add(r(v));
  }
  return V;
}

// Concentracion en unidades comunes: M = dosis (mg), K = concentracion (mg/ml), U = unidades (UI)
function concentracionDe(desc, forma) {
  let t = norm(desc).replace(/(\d),(\d)/g, '$1.$2').replace(/\/ ?DOSIS/g, ' ');
  const M = new Set(); const K = new Set(); const U = new Set();
  const r = (v) => Math.round(v * 10000) / 10000;
  const mg = (v, u) => (/^G/.test(u) ? v * 1000 : /MCG|UG/.test(u) ? v / 1000 : v);
  const iny = /INYECT|AMPOLLA|VIAL|JERINGA/.test(t);
  t = t.replace(/(\d+(?:\.\d+)?)\s*(MGRS|MG|MCG|UG|GRS|GR|G|UI|U\.I\.)\s*(?:\/|-|EN)\s*(\d+(?:\.\d+)?)?\s*ML\b/g, (_, v, u, ml) => {
    const vol = ml ? Number(ml) : 1;
    if (/U/.test(u) && !/UG/.test(u)) U.add(r(Number(v) / vol));
    else {
      K.add(r(mg(Number(v), u) / vol));
      if (ml && iny && vol !== 1) M.add(r(mg(Number(v), u)));
    }
    return ' ';
  });
  t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, v) => { K.add(r(Number(v) * 10)); return ' '; });
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(MGRS|MG|MCG|UG|GRS|GR|G|UI|U\.I\.)(?![A-Z])/g)) {
    if (/U/.test(m[2]) && !/UG/.test(m[2])) U.add(r(Number(m[1])));
    else if (TOPICO.has(forma) && /^G/.test(m[2])) continue; // peso del pomo, no concentracion
    else M.add(r(mg(Number(m[1]), m[2])));
  }
  // Aerosoles: "100 MCG/ML" y "100 MCG/DOSIS" se escriben indistinto: es la dosis por disparo
  if (forma === 'aerosol / inhalador') { for (const v of K) M.add(v); K.clear(); }
  return { M, K, U, vacio: !M.size && !K.size && !U.size };
}

function textoConc(c) {
  const p = [...c.M].map((v) => `${v} mg`).concat([...c.K].map((v) => `${v} mg/ml`), [...c.U].map((v) => `${v} UI`));
  return p.join(' + ');
}

// Un codigo puede tener varias descripciones (stock, consumo, O.C., requerimiento): se usa la mas completa
function perfil(x, drogasSolas) {
  const descs = Array.from(new Set([x.descripcion, ...(x.descripciones || [])].filter(Boolean)));
  let mejor = null;
  for (const d of descs.length ? descs : ['']) {
    const desc = `${x.droga || ''} ${d}`;
    const forma = formaDe(desc);
    const conc = concentracionDe(d || desc, forma);
    const envase = envaseDe(desc);
    const volumen = volumenDe(d || desc);
    const puntos = (conc.M.size + conc.K.size + conc.U.size) * 3 + (forma ? 2 : 0) + (envase ? 1 : 0) + (volumen.size ? 1 : 0) + d.length / 1000;
    if (!mejor || puntos > mejor.puntos) mejor = { descripcion: d, forma, conc, envase, volumen, puntos };
  }
  const { tok, alt } = partesDroga(x.droga || String(mejor.descripcion || '').split(/ - |\d/)[0]);
  return { ...x, descripcion: mejor.descripcion || x.descripcion, tok, alt, forma: mejor.forma, envase: mejor.envase, volumen: mejor.volumen, conc: mejor.conc, drogasSolas };
}

// Compara dos perfiles. Cada aspecto: 'si' | 'falta' (un codigo no tiene el dato) | 'parecida' | 'no'
function comparar(a, b) {
  const res = { droga: 'no', concentracion: 'falta', presentacion: 'falta', detalle: {} };
  // Droga: las mismas drogas (sin sales). Si a uno le sobra otra droga (combinacion) no es el mismo.
  const dentro = (x, y) => x.size && [...x].every((t) => tieneParecida(y, t));
  const todas = (x) => new Set([...x.tok, ...(x.alt || [])]);
  if (a.tok.size && b.tok.size) {
    const comunes = [...a.tok].filter((t) => tieneParecida(b.tok, t));
    const sobranB = [...b.tok].filter((t) => !tieneParecida(a.tok, t));
    if (comunes.length && comunes.length === a.tok.size && !sobranB.length) res.droga = 'si';
    // El nombre entre parentesis de uno es la droga del otro (ej. "HEPARINA BAJO PESO MOLECULAR (ENOXAPARINA)")
    else if (dentro(a.tok, b.alt || new Set()) || dentro(b.tok, a.alt || new Set()) || (dentro(a.tok, todas(b)) && dentro(b.tok, todas(a)))) res.droga = 'si';
    else if (comunes.length && comunes.length === Math.min(a.tok.size, b.tok.size)) {
      const sobran = [...a.tok].filter((t) => !comunes.includes(t)).concat(sobranB);
      // A uno le sobra algo (otra droga, "DECANOATO", "ACIDO CLAVULANICO"...): no es el mismo producto
      res.droga = 'no';
      res.detalle.droga = `uno tiene además ${sobran.join(', ')}`;
    }
  }
  if (res.droga === 'no' && !res.detalle.droga && a.tok.size && b.tok.size
    && ![...todas(a)].some((t) => tieneParecida(todas(b), t))) res.drogaDistinta = true;
  // Concentracion: en cada tipo de dato que tengan los dos, tienen que coincidir todos los valores
  const ca = a.conc; const cb = b.conc;
  if (!ca.vacio && !cb.vacio) {
    let comparados = 0; let mal = false;
    for (const k of ['M', 'K', 'U']) {
      if (!ca[k].size || !cb[k].size) continue;
      comparados += 1;
      const inter = [...ca[k]].filter((v) => cb[k].has(v)).length;
      if (inter < Math.min(ca[k].size, cb[k].size)) mal = true;
    }
    res.concentracion = mal ? 'no' : comparados ? 'si' : 'falta';
    res.detalle.concentracion = `${textoConc(ca) || '—'} / ${textoConc(cb) || '—'}`;
  }
  // Presentacion: misma forma farmaceutica y, en inyectables, mismo envase
  if (a.forma && b.forma) {
    if (grupoForma(a.forma) === grupoForma(b.forma)) {
      res.presentacion = a.envase && b.envase && a.envase !== b.envase ? 'no' : 'si';
      res.detalle.presentacion = a.envase && b.envase && a.envase !== b.envase ? `${a.envase} / ${b.envase}` : a.forma;
    } else {
      res.presentacion = LIQUIDO_ORAL.has(grupoForma(a.forma)) && LIQUIDO_ORAL.has(grupoForma(b.forma)) ? 'parecida' : 'no';
      res.detalle.presentacion = `${a.forma} / ${b.forma}`;
    }
  }
  // Volumen de cada unidad: ampolla de 1 ml y de 5 ml son productos distintos (el stock cuenta unidades)
  const va = a.volumen || new Set(); const vb = b.volumen || new Set();
  if (va.size && vb.size && ![...va].some((v) => vb.has(v)) && res.presentacion !== 'no') {
    const txt = (s) => `${[...s].sort((x, y) => x - y).join('/')} ml`;
    res.presentacion = 'no';
    res.detalle.presentacion = `${res.detalle.presentacion ? `${res.detalle.presentacion}: ` : ''}${txt(va)} / ${txt(vb)}`;
  }
  const vals = [res.droga, res.concentracion, res.presentacion];
  res.ok = !vals.includes('no');
  res.nivel = !res.ok ? 'no' : vals.every((v) => v === 'si') ? 'alta' : vals.filter((v) => v !== 'si').length === 1 ? 'media' : 'baja';
  return res;
}

// Descripcion de cada codigo en todas las fuentes + perfiles listos para comparar
async function cargarPerfiles(extraManual = []) {
  const catalogo = await query(`
    SELECT codigo, MAX(droga) droga, MAX(descripcion) descripcion, SUBSTRING(GROUP_CONCAT(DISTINCT descripcion SEPARATOR '||'), 1, 8000) descripciones FROM (
      SELECT codigo, nombre_generico droga, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) descripcion
        FROM stock_actual_items WHERE codigo <> ''
      UNION ALL SELECT codigo, nombre_generico, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) FROM consumo_ms_items WHERE codigo <> ''
      UNION ALL SELECT codigo_articulo, nombre_generico, TRIM(CONCAT_WS(' ', nombre_generico, concentracion, forma, presentacion)) FROM trimestre_items WHERE codigo_articulo <> ''
      UNION ALL SELECT codigo, droga, LEFT(descripcion, 500) FROM requerimiento_items
      UNION ALL SELECT codigo, droga, descripcion FROM requerimiento_manual
      UNION ALL SELECT codigo, NULL, descripcion FROM oc_historial WHERE codigo <> ''
    ) t WHERE codigo IS NOT NULL GROUP BY codigo
  `);
  const info = new Map();
  for (const c of catalogo) info.set(c.codigo, { codigo: c.codigo, droga: c.droga || '', descripcion: c.descripcion || '', descripciones: String(c.descripciones || '').split('||') });
  for (const m of extraManual) {
    const prev = info.get(m.codigo);
    info.set(m.codigo, { codigo: m.codigo, droga: m.droga || prev?.droga || '', descripcion: m.descripcion || '', descripciones: prev?.descripciones || [] });
  }
  // Nombres de droga que existen solos (para detectar combinaciones: "LORATADINA" vs "LORATADINA + BETAMETASONA")
  const drogasSolas = new Set();
  for (const x of info.values()) {
    const t = tokensDroga(x.droga || '');
    if (t.size === 1) drogasSolas.add([...t][0]);
  }
  const prep = new Map();
  for (const x of info.values()) prep.set(x.codigo, perfil(x, drogasSolas));
  return prep;
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
  // Detalle chiquito: consumo de cada año y cada O.C. con su numero
  for (const r of await query(`SELECT ti.codigo_articulo codigo, i.anio, SUM(ti.cantidad) cantidad
    FROM trimestre_items ti JOIN trimestre_importaciones i ON i.id = ti.trimestre_importacion_id
    WHERE ti.codigo_articulo IN (${inCod}) GROUP BY ti.codigo_articulo, i.anio ORDER BY i.anio`, pc)) {
    (out[r.codigo].consumoAnios ||= []).push({ anio: r.anio, cantidad: Number(r.cantidad || 0) });
  }
  // Años que no estan en los trimestres: consumo de Farmacia MS (ultima descarga de cada sector + año)
  for (const r of await query(`SELECT c.codigo, c.anio, SUM(c.total) cantidad FROM consumo_ms_items c
    JOIN (SELECT sector, anio, MAX(descarga_id) descarga_id FROM consumo_ms_items GROUP BY sector, anio) u
      ON u.descarga_id = c.descarga_id AND u.sector = c.sector AND u.anio = c.anio
    WHERE c.codigo IN (${inCod}) GROUP BY c.codigo, c.anio ORDER BY c.anio`, pc)) {
    const l = (out[r.codigo].consumoAnios ||= []);
    if (!l.some((x) => x.anio === r.anio)) l.push({ anio: r.anio, cantidad: Number(r.cantidad || 0), ms: true });
    l.sort((a, b) => a.anio - b.anio);
  }
  for (const r of await query(`SELECT codigo, oc_numero, proveedor, anio, semestre, SUM(cantidad) cantidad, SUM(entregada) entregada
    FROM oc_historial WHERE codigo IN (${inCod})
    GROUP BY codigo, oc_numero, proveedor, anio, semestre ORDER BY anio DESC, semestre DESC`, pc)) {
    (out[r.codigo].ocs ||= []).push({ numero: r.oc_numero, proveedor: r.proveedor, anio: r.anio, semestre: r.semestre,
      cantidad: r.cantidad == null ? null : Number(r.cantidad), entregada: r.entregada == null ? null : Number(r.entregada) });
  }
  return out;
}

// Para cada renglon "por controlar" con cantidad 0 del semestre, los codigos que son el mismo producto:
// misma droga, misma concentracion y misma presentacion. Si algo no coincide, no se sugiere.
async function sugerencias(anio, semestre) {
  const manual = await query('SELECT id, codigo, droga, descripcion, cantidad, controlado FROM requerimiento_manual WHERE anio = :anio AND semestre = :semestre', { anio, semestre });
  const decididos = new Set((await query('SELECT codigo_a, codigo_b FROM codigo_equivalencias')).map((r) => `${r.codigo_a}|${r.codigo_b}`));
  const fam = await familias();
  const manualPorCodigo = new Map(manual.map((m) => [m.codigo, m]));
  const prep = await cargarPerfiles(manual);
  const PUNTOS = { alta: 100, media: 70, baja: 50 };

  // Los que ya estan unificados con otro codigo tambien se revisan (un producto puede tener 3 codigos:
  // el viejo, el del requerimiento y el que usa MS hoy), pero solo se muestran si aparece otro candidato.
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
      if (![...a.tok].some((t) => tieneParecida(b.tok, t))) continue;
      const cmp = comparar(a, b);
      // Solo se sugiere si coinciden droga, concentracion y presentacion (sin datos faltantes)
      if (cmp.nivel !== 'alta') continue;
      const enManual = manualPorCodigo.get(b.codigo);
      cands.push({ codigo: b.codigo, droga: b.droga, descripcion: b.descripcion, score: PUNTOS[cmp.nivel] + (enManual ? 5 : 0), nivel: cmp.nivel,
        comparacion: cmp, motivos: enManual ? [Number(enManual.controlado) ? 'ya controlado en la carga' : 'en la carga'] : [],
        manual: enManual ? { id: enManual.id, cantidad: Number(enManual.cantidad), controlado: !!Number(enManual.controlado) } : null });
    }
    cands.sort((x, y) => y.score - x.score);
    if (famP.size > 1 && !cands.length) continue;
    const top = cands.slice(0, 4);
    for (const c of [p.codigo, ...top.map((t) => t.codigo)]) codigosHuella.add(c);
    resultado.push({ id: p.id, codigo: p.codigo, droga: p.droga, descripcion: p.descripcion, candidatos: top });
  }
  const h = await huellas(Array.from(codigosHuella));
  // Señal extra para ordenar: uno tiene stock y no consumo, el otro consumo y no stock (codigo viejo -> nuevo)
  for (const r of resultado) {
    const hp = h[r.codigo] || {};
    for (const c of r.candidatos) {
      const hc = h[c.codigo] || {};
      const soloStock = (x) => x.stock != null && !x.consumo && !x.consumoMs;
      const sinStockConHist = (x) => x.stock == null && (x.consumo || x.consumoMs || x.oc);
      if ((soloStock(hp) && sinStockConHist(hc)) || (soloStock(hc) && sinStockConHist(hp))) {
        c.score += 3;
        c.motivos.push('uno tiene stock y el otro el historial');
      }
    }
    r.candidatos.sort((x, y) => y.score - x.score);
  }
  // Primero los que tienen la sugerencia mas segura
  resultado.sort((x, y) => (y.candidatos[0]?.score || 0) - (x.candidatos[0]?.score || 0) || String(x.droga).localeCompare(String(y.droga)));
  return { pendientes: resultado, huellas: h };
}

// Comparacion de dos codigos cualesquiera (para el codigo elegido a mano)
async function compararCodigos(codigo, con) {
  const prep = await cargarPerfiles();
  const a = prep.get(codigo);
  const b = prep.get(con);
  if (!a || !b) return null;
  return comparar(a, b);
}

// Revisa las equivalencias ya guardadas con la regla estricta: devuelve las que no la cumplen
async function auditar() {
  const rows = await query("SELECT id, codigo_a, codigo_b, usuario_id, created_at, detalle FROM codigo_equivalencias WHERE estado = 'igual' ORDER BY id");
  const prep = await cargarPerfiles();
  return rows.map((r) => {
    const a = prep.get(r.codigo_a);
    const b = prep.get(r.codigo_b);
    return { ...r, desc_a: a?.descripcion, desc_b: b?.descripcion, comparacion: a && b ? comparar(a, b) : null };
  });
}

// ---------------- Acciones ----------------
function errorStatus(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// Marca dos codigos como el mismo producto. Si los dos estan en la carga del semestre, deja un solo
// renglon: el que tenia trabajo (cantidad o tilde), con el codigo elegido en "queda".
async function unificar({ codigo, con, queda, anio, semestre, nota, forzar }, usuarioId) {
  codigo = String(codigo || '').trim();
  con = String(con || '').trim();
  if (!codigo || !con || codigo === con) throw errorStatus('Elegí dos códigos distintos');
  // Droga, concentracion y presentacion tienen que coincidir; si no, solo con confirmacion explicita
  const cmp = await compararCodigos(codigo, con);
  if (cmp?.drogaDistinta) {
    throw errorStatus(`No se puede unificar: ${codigo} y ${con} son drogas distintas.`, 409);
  }
  if (cmp && !cmp.ok && !forzar) {
    const mal = ['droga', 'concentracion', 'presentacion'].filter((k) => cmp[k] === 'no')
      .map((k) => `${k === 'concentracion' ? 'concentración' : k === 'presentacion' ? 'presentación' : 'droga'}${cmp.detalle[k] ? ` (${cmp.detalle[k]})` : ''}`);
    const e = errorStatus(`No coincide: ${mal.join(', ')}.`, 422);
    e.comparacion = cmp;
    throw e;
  }
  queda = queda === con ? con : codigo;
  const [a, b] = par(codigo, con);
  const detalle = { anio, semestre, queda, ...(cmp && !cmp.ok ? { forzado: true } : {}) };
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

module.exports = { ensureEquivTables, familias, expandirCodigos, sugerencias, huellas, unificar, descartar, deshacer, historial, compararCodigos, auditar };
