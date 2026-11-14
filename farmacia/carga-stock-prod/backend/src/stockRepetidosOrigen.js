// Rastrea de donde salio cada codigo de los farmacos repetidos (stockRepetidos.js):
//  - Ingresos Detallados de Farmacia MS (stock_actual_ingresos): tipo de ingreso y origen
//    (O.C. SIPACH, entrega/prestamo de otra institucion, otro sector, donacion, otros ingresos...).
//  - Ordenes de Compra cargadas en el sistema (oc_renglones): numero y proveedor de la O.C. con ese codigo.
//  - Vencimientos (venc_items, ultima descarga): stock por lote, para avisar si el mismo lote
//    tiene stock en los dos codigos / sectores (posible stock contado dos veces).
const { query } = require('./db');

const fmtFecha = (d) => {
  if (!d) return '';
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const [a, m, dd] = iso.split('-');
  return `${dd}/${m}/${a}`;
};
const cant = (n) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const loteClave = (l) => norm(l).replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');

// "HOSPITAL INTERZONAL GENERAL DE AGUDOS DR. PAROISSIEN" -> "Hosp. DR. PAROISSIEN"
function corto(nombre) {
  return String(nombre || '').replace(/^HOSPITAL\s+(INTERZONAL\s+|ZONAL\s+|SUBZONAL\s+)?(GENERAL\s+)?(DE\s+AGUDOS\s+)?/i, 'Hosp. ').trim();
}

function categoria(tipo) {
  const t = norm(tipo);
  if (/ORDEN DE COMPRA|PROVEEDOR|COMPRA MENOR/.test(t)) return 'oc';
  if (/OTRA INSTITUCION|OTRAS INSTITUCIONES|PRESTAMO/.test(t)) return 'hospital';
  if (/OTRO SECTOR/.test(t)) return 'sector';
  if (/DONACION/.test(t)) return 'donacion';
  if (/DEVOLUCION/.test(t)) return 'devolucion';
  if (/RECUENTO/.test(t)) return 'recuento';
  return 'manual';
}

// Descarga de ingresos a usar: la vista o, si no tiene, la ultima anterior que si tenga
async function descargaConIngresos(descargaId) {
  const [row] = await query(
    'SELECT MAX(descarga_id) id FROM stock_actual_ingresos WHERE descarga_id <= :id',
    { id: descargaId || 2147483647 }
  );
  return row?.id || null;
}

function resumirCodigo(item, ingresos, ocs) {
  const propios = ingresos.filter((x) => x.codigo === item.codigo && x.sector === item.sector);
  const porCat = (c) => propios.filter((x) => categoria(x.tipo) === c);
  const hospitales = porCat('hospital');
  const conOc = porCat('oc');
  const sectores = porCat('sector');
  const donaciones = porCat('donacion');
  const manuales = [...porCat('manual'), ...porCat('recuento')];
  const ocsCodigo = ocs.filter((o) => o.codigo === item.codigo);

  // Fuentes ordenadas por cantidad: la primera define el color; todas se muestran
  const suma = (arr) => arr.reduce((acc, x) => acc + Number(x.cantidad || 0), 0);
  const nombres = (arr, quitar) => Array.from(new Set(arr.map((x) => corto(String(x.origen || '').replace(quitar, ''))).filter(Boolean))).join(', ');
  const fuentes = [];
  if (conOc.length || ocsCodigo.length) {
    const nums = ocsCodigo.map((o) => `${o.numero} ${o.proveedor || ''}`.trim()).join(', ');
    fuentes.push({ clase: 'oc', cantidad: suma(conOc), texto: `O.C. ${nums || 'SIPACH'}` });
  }
  if (hospitales.length) fuentes.push({ clase: 'hospital', cantidad: suma(hospitales), texto: `Otro hospital: ${nombres(hospitales, /^$/)}` });
  if (sectores.length) fuentes.push({ clase: 'sector', cantidad: suma(sectores), texto: `Otro sector: ${nombres(sectores, /^Sector:\s*/i)}` });
  if (donaciones.length) fuentes.push({ clase: 'donacion', cantidad: suma(donaciones), texto: 'Donación' });
  if (manuales.length) fuentes.push({ clase: 'manual', cantidad: suma(manuales), texto: `Carga manual (${Array.from(new Set(manuales.map((x) => x.tipo))).join(', ')})` });
  fuentes.sort((a, b) => b.cantidad - a.cantidad);
  fuentes.forEach((f) => { f.texto = `${f.texto}${f.cantidad ? `: ${cant(f.cantidad)} u` : ''}`; });
  const clase = fuentes[0]?.clase || 'sin-dato';
  const resumen = fuentes.length ? fuentes.map((f) => f.texto).join(' · ') : 'Sin ingresos registrados en el período bajado';

  const lineas = [];
  // Detalle de ingresos agrupado por tipo + origen (sin devoluciones de salas, que no explican el origen)
  const grupos = new Map();
  for (const x of propios) {
    if (categoria(x.tipo) === 'devolucion') continue;
    const k = `${x.tipo}|${x.origen || ''}`;
    if (!grupos.has(k)) grupos.set(k, { tipo: x.tipo, origen: x.origen, cantidad: 0, fechas: [], lotes: new Set() });
    const g = grupos.get(k);
    g.cantidad += Number(x.cantidad || 0);
    g.fechas.push(x.fecha);
    if (x.lote) g.lotes.add(x.lote);
  }
  for (const g of grupos.values()) {
    const fechas = g.fechas.filter(Boolean).map((f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10))).sort();
    const rango = fechas.length ? (fechas[0] === fechas[fechas.length - 1] ? fmtFecha(fechas[0]) : `${fmtFecha(fechas[0])} a ${fmtFecha(fechas[fechas.length - 1])}`) : '';
    lineas.push(`${g.tipo}${g.origen ? ` (${g.origen})` : ''}: ${cant(g.cantidad)} u${rango ? `, ${rango}` : ''}${g.lotes.size ? ` · lote ${Array.from(g.lotes).slice(0, 4).join(', ')}` : ''}`);
  }
  return { clase, resumen, fuentes, detalle: lineas };
}

// Mismo lote con stock (segun Vencimientos) en dos miembros del grupo -> posible doble conteo
function alertasLote(grupo, stockLotes, ingresos) {
  const alertas = [];
  const porLote = new Map();
  for (const it of grupo.items) {
    for (const l of stockLotes.filter((x) => x.codigo === it.codigo && norm(x.sector) === norm(it.sector) && Number(x.stock) > 0)) {
      const k = loteClave(l.lote);
      if (!k) continue;
      if (!porLote.has(k)) porLote.set(k, { lote: l.lote, miembros: [] });
      porLote.get(k).miembros.push({ codigo: it.codigo, sector: it.sector, stock: Number(l.stock) });
    }
  }
  for (const { lote, miembros } of porLote.values()) {
    if (miembros.length < 2) continue;
    const entradas = miembros.map((m) => {
      const ing = ingresos.filter((x) => x.codigo === m.codigo && x.sector === m.sector && loteClave(x.lote) === loteClave(lote));
      const como = Array.from(new Set(ing.map((x) => x.tipo))).join(' + ') || 'sin ingreso registrado';
      return `${m.codigo}${grupo.codigo ? ` en ${m.sector}` : ''}: ${cant(m.stock)} u (entró por ${como})`;
    });
    alertas.push(`El lote ${lote} tiene stock en los dos: ${entradas.join(' · ')}. Revisar si se contó dos veces.`);
  }
  return alertas;
}

const parClave = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);

// Estado de cada grupo (identicos / probables) segun la tabla de Codigos equivalentes:
//  unido     = todos sus codigos ya son de la misma familia ('igual')
//  distinto  = se marcaron como productos distintos
//  pendiente = falta decidir algun par (estos son los "sin unir")
// Los de "mismo codigo en otro sector" no se unen: quedan sin estado.
async function marcarEquivalencias(repetidos) {
  const rows = await query('SELECT codigo_a, codigo_b, estado FROM codigo_equivalencias');
  const estadoPar = new Map(rows.map((r) => [parClave(r.codigo_a, r.codigo_b), r.estado]));
  const padre = new Map();
  const raiz = (c) => { if (!padre.has(c)) padre.set(c, c); while (padre.get(c) !== c) c = padre.get(c); return c; };
  for (const r of rows) if (r.estado === 'igual') padre.set(raiz(r.codigo_a), raiz(r.codigo_b));
  for (const g of [...repetidos.identicos, ...repetidos.probables]) {
    const cods = Array.from(new Set(g.items.map((i) => i.codigo)));
    const pendientes = [];
    let distintos = 0;
    for (let i = 0; i < cods.length; i += 1) {
      for (let j = i + 1; j < cods.length; j += 1) {
        if (raiz(cods[i]) === raiz(cods[j])) continue;
        if (estadoPar.get(parClave(cods[i], cods[j])) === 'distinto') { distintos += 1; continue; }
        pendientes.push([cods[i], cods[j]]);
      }
    }
    g.paresPendientes = pendientes;
    g.equivalencia = pendientes.length ? 'pendiente' : distintos ? 'distinto' : 'unido';
  }
  repetidos.sinUnir = [...repetidos.identicos, ...repetidos.probables].filter((g) => g.equivalencia === 'pendiente').length;
}

async function analizarOrigen(repetidos, descargaId) {
  const grupos = [...repetidos.identicos, ...repetidos.probables, ...repetidos.entreSectores];
  const codigos = Array.from(new Set(grupos.flatMap((g) => g.items.map((i) => i.codigo))));
  const idIngresos = await descargaConIngresos(descargaId);
  repetidos.conIngresos = Boolean(idIngresos);
  if (!codigos.length) return repetidos;

  // pool.execute no expande arrays: un placeholder por codigo
  const params = { id: idIngresos || 0 };
  codigos.forEach((c, i) => { params[`c${i}`] = c; });
  const lista = codigos.map((_c, i) => `:c${i}`).join(', ');
  const [ingresos, ocs, stockLotes] = await Promise.all([
    idIngresos
      ? query(`SELECT sector, nro_ingreso, tipo, fecha, codigo, lote, cantidad, origen FROM stock_actual_ingresos WHERE descarga_id = :id AND codigo IN (${lista}) ORDER BY fecha`, params)
      : [],
    query(`SELECT DISTINCT r.codigo, o.numero, o.proveedor FROM oc_renglones r JOIN oc_ordenes o ON o.id = r.orden_id
           WHERE r.codigo IN (${lista}) ORDER BY o.numero`, params).catch(() => []),
    query(`SELECT sector, codigo, lote, stock FROM venc_items
           WHERE descarga_id = (SELECT MAX(descarga_id) FROM venc_items) AND codigo IN (${lista})`, params).catch(() => [])
  ]);

  for (const g of grupos) {
    for (const it of g.items) it.origen = resumirCodigo(it, ingresos, ocs);
    g.alertas = alertasLote(g, stockLotes, ingresos);
  }
  await marcarEquivalencias(repetidos);
  return repetidos;
}

module.exports = { analizarOrigen };
