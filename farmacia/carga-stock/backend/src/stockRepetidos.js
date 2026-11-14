// Detecta farmacos repetidos en una descarga de Stock Actual (Farmacia MS).
// Tres grupos:
//  - identicos: mismo sector, misma droga + concentracion + forma (texto igual), con distinto codigo.
//  - probables: mismo sector, mismo producto escrito distinto (plurales, "1%" = "10 MG/ML",
//    "CLORHIDRATO DE ...", ampolla/vial/inyectable, etc.) y mismo volumen si ambos lo informan.
//  - entreSectores: el mismo codigo aparece en mas de un sector.

function sinAcentos(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

const SALES = new Set(['CLORHIDRATO', 'DE', 'SODICO', 'SODICA', 'ACETATO', 'BROMURO', 'FOSFATO', 'CITRATO', 'MALEATO', 'TARTRATO']);

function nombreBase(nombre) {
  return sinAcentos(nombre).replace(/[^A-Z0-9+ ]+/g, ' ').split(/\s+/).filter((p) => p && !SALES.has(p)).join(' ');
}

// Distancia de edicion (para errores de tipeo tipo PROPANOLOL / PROPRANOLOL)
function distancia(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Palabras de la droga (sin sales ni parentesis): "BUTIL ESCOPOLAMINA (HIOSCINA)" -> BUTIL, ESCOPOLAMINA, HIOSCINA
function palabrasDroga(nombre) {
  return nombre.split(/[\s+]+/).filter((p) => p.length >= 6);
}

// Mismo nombre, error de tipeo (PROPANOLOL / PROPRANOLOL) o nombre escrito distinto que comparte
// la droga ("BUTIL ESCOPOLAMINA (HIOSCINA)" / "HIOSCINA BUTILBROMURO"), con la misma cantidad de componentes.
// Palabras que hacen otro producto aunque la droga sea la misma (liposomal, con epinefrina, NPH, de deposito...)
const MODIFICADORES = [/LIPOSOM/, /EPINEFRINA|ADRENALINA/, /\bNPH\b|ISOFANA/, /GLARGINA|DETEMIR|LISPRO|ASPART/, /DECANOATO|DEPOT|RETARD/, /\bCON\b/];
function modificadores(nombre) {
  return MODIFICADORES.map((re) => (re.test(nombre) ? '1' : '0')).join('');
}

function mismoNombre(a, b) {
  if (modificadores(a) !== modificadores(b)) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 6 && distancia(a, b) <= 1) return true;
  if ((a.match(/\+/g) || []).length !== (b.match(/\+/g) || []).length) return false;
  const pb = palabrasDroga(b);
  return palabrasDroga(a).some((x) => pb.some((y) => x === y || (Math.min(x.length, y.length) >= 7 && distancia(x, y) <= 1)));
}

// "1.000.000" (miles con punto) -> 1000000; "0,5" -> 0.5
const num = (s) => {
  const t = String(s);
  return Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(',', '.'));
};

// Concentracion normalizada: "1MG/ML - 4 ML" -> "1MG/ML"; "1%" y "0.01" -> "10MG/ML";
// combinaciones conservan todos los valores: "25 MCG. -125MCG" -> "25+125MCG"
function concentracionBase(conc) {
  // "20MG - 1ML" (cantidad en un volumen) -> "20MG/ML"
  const porVolumen = /^(\d+(?:[.,]\d+)?)\s*(MG|G|MCG)\s*-\s*(\d+(?:[.,]\d+)?)\s*ML\b/.exec(sinAcentos(conc));
  if (porVolumen && num(porVolumen[3]) > 0) return `${+(num(porVolumen[1]) / num(porVolumen[3])).toFixed(4)}${porVolumen[2]}/ML`;
  let c = sinAcentos(conc).replace(/\(.*?\)/g, '').split(/\s+-(?:\s+|$)/)[0].replace(/\s+/g, '');
  c = c.replace(/GRS?\b|GR(?=\/)/g, 'G');
  let m = /^(\d+(?:[.,]\d+)?)%$/.exec(c);
  if (m) return `${+(num(m[1]) * 10).toFixed(4)}MG/ML`;
  m = /^0[.,](\d+)$/.exec(c);
  if (m) return `${+(num(c) * 1000).toFixed(4)}MG/ML`;
  const valores = [...c.matchAll(/(\d+(?:[.,]\d+)*)(?!\d|[.,]\d)(?!\/?\d*(?:ML\b|DOSIS))/g)].map((x) => +num(x[1]).toFixed(4));
  const unidad = /(MCG|MG|G|UI|U\.I\.?)(\/ML)?/.exec(c);
  if (valores.length) return `${valores.join('+')}${unidad ? unidad[1].replace(/\./g, '') + (unidad[2] || '') : ''}`;
  return c;
}

function tipoForma(it) {
  const t = sinAcentos(`${it.forma} ${it.presentacion}`);
  if (/COMPRIM|CAPSUL|TABLET|GRAGEA/.test(t)) return 'SOLIDO_ORAL';
  if (/AMPOLL|INYECT|VIAL|FCO\.? ?AMP|FRASCO AMP|JERINGA/.test(t)) return 'INYECTABLE';
  if (/CREMA|POMADA|UNGUENTO|GEL/.test(t)) return 'TOPICO';
  if (/LOCION/.test(t)) return 'LOCION';
  if (/GOTA/.test(t)) return 'GOTAS';
  if (/JARABE|SUSPEN|SOLUCION ORAL/.test(t)) return 'LIQUIDO_ORAL';
  if (/AEROSOL|INHAL/.test(t)) return 'INHALATORIO';
  if (/SUPOSIT/.test(t)) return 'SUPOSITORIO';
  return sinAcentos(it.forma);
}

// Volumen / cantidad del envase si se informa: "4 ML", "200 DOSIS"
function volumen(it) {
  const t = sinAcentos(`${it.concentracion} ${it.presentacion}`);
  const ml = [...t.matchAll(/(\d+(?:[.,]\d+)?) ?ML\b(?!\))/g)].map((m) => num(m[1]))
    .filter((v, _i, arr) => !(arr.length > 1 && /\/ML/.test(t) && v === 1));
  const dosis = /(\d+) ?DOSIS/.exec(t);
  return { ml: ml.length ? ml[ml.length - 1] : null, dosis: dosis ? Number(dosis[1]) : null };
}

// Mismo texto de droga + concentracion + forma; si informan volumen distinto (frasco 60 ml / 90 ml) no son el mismo
function claveIdentica(it) {
  return [it.sector, it.nombre_generico, it.concentracion, it.forma].map(sinAcentos).join('|') + `|${volumen(it).ml ?? ''}`;
}

function itemResumen(it) {
  return {
    sector: it.sector,
    codigo: it.codigo,
    nombre: it.nombre_generico,
    concentracion: it.concentracion,
    presentacion: it.presentacion,
    forma: it.forma,
    stock: it.stock == null ? null : Number(it.stock)
  };
}

function descripcion(it) {
  return [it.nombre_generico, it.concentracion, it.presentacion, it.forma].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function detectarRepetidos(items) {
  // 1) Identicos
  const porClave = new Map();
  for (const it of items) {
    const k = claveIdentica(it);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k).push(it);
  }
  const identicos = [];
  const yaAgrupados = new Set();
  for (const grupo of porClave.values()) {
    const codigos = new Set(grupo.map((x) => x.codigo));
    if (codigos.size < 2) continue;
    grupo.forEach((x) => yaAgrupados.add(`${x.sector}|${x.codigo}`));
    identicos.push({ sector: grupo[0].sector, descripcion: descripcion(grupo[0]), items: grupo.map(itemResumen) });
  }

  // 2) Probables (mismo sector, distinta escritura)
  const probables = [];
  const sectores = Array.from(new Set(items.map((x) => x.sector)));
  for (const sector of sectores) {
    const lista = items
      .filter((x) => x.sector === sector)
      .map((x) => ({ it: x, nombre: nombreBase(x.nombre_generico), conc: concentracionBase(x.concentracion), tipo: tipoForma(x), vol: volumen(x) }));
    const usados = new Set();
    for (let i = 0; i < lista.length; i += 1) {
      if (usados.has(i)) continue;
      const grupo = [lista[i]];
      for (let j = i + 1; j < lista.length; j += 1) {
        if (usados.has(j)) continue;
        const a = lista[i];
        const b = lista[j];
        if (a.it.codigo === b.it.codigo) continue;
        if (!a.conc || a.conc !== b.conc || a.tipo !== b.tipo || !mismoNombre(a.nombre, b.nombre)) continue;
        if (a.vol.ml != null && b.vol.ml != null && a.vol.ml !== b.vol.ml) continue;
        if (a.vol.dosis != null && b.vol.dosis != null && a.vol.dosis !== b.vol.dosis) continue;
        grupo.push(b);
        usados.add(j);
      }
      if (grupo.length < 2) continue;
      // Si todos ya estan como identicos, no se repiten aca
      if (grupo.every((g) => yaAgrupados.has(`${sector}|${g.it.codigo}`))) continue;
      usados.add(i);
      probables.push({ sector, descripcion: descripcion(grupo[0].it), items: grupo.map((g) => itemResumen(g.it)) });
    }
  }

  // 3) Mismo codigo en mas de un sector
  const porCodigo = new Map();
  for (const it of items) {
    if (!porCodigo.has(it.codigo)) porCodigo.set(it.codigo, []);
    porCodigo.get(it.codigo).push(it);
  }
  const entreSectores = [];
  for (const [codigo, grupo] of porCodigo) {
    if (new Set(grupo.map((x) => x.sector)).size < 2) continue;
    entreSectores.push({ codigo, descripcion: descripcion(grupo[0]), items: grupo.map(itemResumen) });
  }

  const orden = (a, b) => a.descripcion.localeCompare(b.descripcion, 'es');
  return { identicos: identicos.sort(orden), probables: probables.sort(orden), entreSectores: entreSectores.sort(orden) };
}

module.exports = { detectarRepetidos };
