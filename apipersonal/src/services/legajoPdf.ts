// src/services/legajoPdf.ts
// Legajo Personal impreso sobre el PDF ORIGINAL del Ministerio (assets/legajo/plantilla_legajo.pdf):
// se copian sus hojas tal cual (mismo tamaño: A4 apaisada y la hoja 6 en oficio) y se escriben
// los datos encima, en la posición de cada línea de puntos y de cada casillero de las grillas.
// Si una grilla tiene más registros que renglones, se agrega otra copia de esa hoja.
import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { GRILLAS } from './legajoPdfGrillas';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
  'septiembre','octubre','noviembre','diciembre'];
const NEGRO = rgb(0, 0, 0);

let plantillaCache: Buffer | null = null;
function plantilla(): Buffer {
  if (plantillaCache) return plantillaCache;
  const candidatos = [
    path.resolve(process.cwd(), 'assets/legajo/plantilla_legajo.pdf'),
    path.resolve(__dirname, '../../assets/legajo/plantilla_legajo.pdf'),
    path.resolve(__dirname, '../../../assets/legajo/plantilla_legajo.pdf'),
  ];
  const ruta = candidatos.find(p => fs.existsSync(p));
  if (!ruta) throw new Error('No se encuentra assets/legajo/plantilla_legajo.pdf');
  plantillaCache = fs.readFileSync(ruta);
  return plantillaCache;
}

// ── helpers de datos ─────────────────────────────────────────────────────────
const s = (v: any): string => (v === null || v === undefined ? '' : String(v).trim());
function dma(v: any): [string, string, string] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v));
  return m ? [m[3], m[2], m[1]] : ['', '', ''];
}
const fecha = (v: any) => { const [d, m, a] = dma(v); return d ? `${d}/${m}/${a}` : ''; };
const siNo = (v: any) => (v === null || v === undefined || v === '' ? '' : (Number(v) ? 'SI' : 'NO'));
const x = (v: any) => (v ? 'X' : '');
const dinero = (v: any) => (v === null || v === undefined || v === '' ? ''
  : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(v)));
const unir = (...xs: any[]) => xs.map(s).filter(Boolean).join(' — ');

// ── escritura ────────────────────────────────────────────────────────────────
type Ctx = { font: PDFFont; bold: PDFFont };

// Helvetica estándar usa WinAnsi: lo que no entra se reemplaza para que no rompa
function apto(font: PDFFont, t: string): string {
  let out = '';
  for (const ch of t.replace(/\s+/g, ' ')) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

// Escribe `texto` en el ancho [x0, x1] achicando la letra hasta `min`; si igual no entra, corta
function escribir(pg: PDFPage, c: Ctx, texto: any, x0: number, x1: number, base: number,
                  o: { size?: number; min?: number; bold?: boolean; centro?: boolean } = {}) {
  const font = o.bold ? c.bold : c.font;
  let t = apto(font, s(texto));
  if (!t) return;
  const ancho = x1 - x0 - 4;
  let size = o.size ?? 9;
  const min = o.min ?? 5.5;
  while (size > min && font.widthOfTextAtSize(t, size) > ancho) size -= 0.25;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > ancho) t = t.slice(0, -2) + '…';
  const w = font.widthOfTextAtSize(t, size);
  const xi = o.centro ? x0 + (x1 - x0 - w) / 2 : x0 + 2;
  pg.drawText(t, { x: xi, y: base, size, font, color: NEGRO });
}

// Campo sobre línea de puntos: [x0, x1] y la base de los puntos
const campo = (pg: PDFPage, c: Ctx, v: any, x0: number, x1: number, y: number, size = 9.5) =>
  escribir(pg, c, v, x0, x1, y + 3.2, { size, bold: true });

// Marca una opción impresa (estado civil / nivel) con un óvalo
function marcar(pg: PDFPage, x0: number, x1: number, y0: number, y1: number) {
  pg.drawEllipse({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, xScale: (x1 - x0) / 2 + 4, yScale: (y1 - y0) / 2 + 3,
    borderColor: NEGRO, borderWidth: 0.9 });
}

// Celdas de una grilla: `celdas` = valores por columna; `centrar` = índices de columnas angostas
function renglon(pg: PDFPage, c: Ctx, hoja: number, fila: number, celdas: any[], centrar: number[] = []) {
  const g = GRILLAS[hoja];
  const [arriba, abajo] = g.filas[fila];
  const alto = arriba - abajo;
  const size = Math.min(9, alto * 0.42);
  const base = abajo + (alto - size * 0.72) / 2;
  celdas.forEach((v, i) => {
    if (i + 1 >= g.cols.length) return;
    escribir(pg, c, v, g.cols[i], g.cols[i + 1], base, { size, centro: centrar.includes(i) });
  });
}

// ── armado ───────────────────────────────────────────────────────────────────
export async function generarLegajoPdf(d: any, hojas?: number[]): Promise<Uint8Array> {
  const tpl = await PDFDocument.load(plantilla());
  const doc = await PDFDocument.create();
  const c: Ctx = { font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const quiere = (n: number) => !hojas || !hojas.length || hojas.includes(n);
  const hoja = async (n: number) => { const [p] = await doc.copyPages(tpl, [n - 1]); return doc.addPage(p); };

  const pd = d.datosPersonales ?? {};
  const dl = d.datosLegajo ?? {};
  const ag = d.agente ?? {};
  const inc = d.incompatibilidad ?? {};
  const nombre = [pd.apellido, pd.nombre].filter(Boolean).join(', ');

  // Grilla genérica: reparte las filas en tantas copias de la hoja como hagan falta
  const grilla = async (n: number, filas: any[][], centrar: number[] = [], extra?: (pg: PDFPage) => void) => {
    const cap = GRILLAS[n].filas.length;
    for (let i = 0; i === 0 || i < filas.length; i += cap) {
      const pg = await hoja(n);
      extra?.(pg);
      filas.slice(i, i + cap).forEach((f, k) => renglon(pg, c, n, k, f, centrar));
    }
  };

  // Hoja 1 — Tapa
  if (quiere(1)) {
    const pg = await hoja(1);
    campo(pg, c, dl.reparticion || pd.reparticion || pd.dependencia || ag.reparticion_nombre, 177, 741, 301.8, 12);
    escribir(pg, c, nombre, 72, 752, 68, { size: 15, bold: true, centro: true });
  }

  // Hoja 2 — 1) Datos personales
  if (quiere(2)) {
    const pg = await hoja(2);
    escribir(pg, c, dl.nro_legajo || ag.legajo || pd.legajo, 162, 300, 507.8, { size: 10, bold: true });
    campo(pg, c, pd.apellido, 111, 359, 463.8);
    campo(pg, c, pd.nombre, 409, 712, 463.8);
    campo(pg, c, dl.nac_pais ?? pd.nacionalidad, 137, 263, 412.9);
    campo(pg, c, dl.nac_provincia, 308, 435, 412.9);
    campo(pg, c, dl.nac_partido, 469, 815, 412.9);
    const [nd, nm, na] = dma(pd.fecha_nacimiento ?? pd.p_fecha_nacimiento);
    campo(pg, c, nd, 96, 143, 387.4);
    campo(pg, c, nm ? MESES[Number(nm) - 1] : '', 155, 349, 387.4);
    campo(pg, c, na, 362, 432, 387.4);
    const ec: Record<string, [number, number]> = {
      SOLTERO: [501.8, 542.5], CASADO: [563.5, 604.3], VIUDO: [617.4, 652.3], SEPARADO: [665.7, 716.6] };
    const e = ec[s(dl.estado_civil).toUpperCase()];
    if (e) marcar(pg, e[0], e[1], 385.9, 395.5);
    campo(pg, c, pd.dni, 107, 276, 335.2);
    campo(pg, c, dl.clase, 303, 388, 335.2);
    campo(pg, c, dl.dist_militar, 444, 534, 335.2);
    campo(pg, c, dl.cedula_nro, 619, 815, 335.2);
    campo(pg, c, dl.cedula_expedida_por, 133, 420, 309.8);
    campo(pg, c, dl.carta_ciudadania, 514, 815, 309.8);
    const [cd, cm, ca] = dma(dl.carta_fecha);
    campo(pg, c, dl.carta_otorgada_en, 128, 286, 284.3);
    campo(pg, c, cd, 298, 344, 284.3);
    campo(pg, c, cm ? MESES[Number(cm) - 1] : '', 360, 455, 284.3);
    campo(pg, c, ca, 468, 499, 284.3, 8);
    campo(pg, c, dl.carta_juez_federal, 558, 813, 284.3);
    const niv: Record<string, [number, number]> = {
      PRIMARIO: [190, 227], SECUNDARIO: [238.4, 330.6], UNIVERSITARIO: [342.6, 397] };
    const nv = niv[s(dl.estudios_nivel).toUpperCase()];
    if (nv) marcar(pg, nv[0], nv[1], 231.9, 239.5);
    campo(pg, c, dl.estudios_detalle, 403, 812, 232);
    campo(pg, c, dl.titulo_secundario, 198, 379, 206.5);
    campo(pg, c, dl.titulo_secundario_otorgado, 441, 810, 206.5);
    campo(pg, c, dl.titulo_universitario ?? pd.especialidad_nombre, 160, 374, 181.1);
    campo(pg, c, dl.titulo_universitario_otorgado, 439, 810, 181.1);
    campo(pg, c, dl.aptitud_especial, 227, 810, 155.7);
    campo(pg, c, dl.mil_presto === null || dl.mil_presto === undefined ? '' : (Number(dl.mil_presto) ? 'Sí' : 'No'), 214, 262, 103.3);
    campo(pg, c, dl.mil_arma, 288, 406, 103.3);
    campo(pg, c, dl.mil_especialidad, 465, 565, 103.3);
    campo(pg, c, dl.mil_grado, 594, 811, 103.3);
    campo(pg, c, dl.mil_destino, 106, 399, 77.9);
    campo(pg, c, dl.mil_motivo_excepcion, 504, 809, 77.9);
  }

  // Hoja 3 — Rectificaciones (5 renglones por sección)
  if (quiere(3)) {
    const rect = (d.rectificaciones ?? []) as any[];
    const secciones: [string, number[]][] = [
      ['FILIACION', [501.4, 476.0, 450.5, 425.1, 399.6]],
      ['IDENTIDAD', [348.8, 323.3, 297.8, 272.3, 246.9]],
      ['APTITUD',   [196.0, 170.5, 145.1, 119.6, 94.2]],
    ];
    const items = secciones.map(([sec]) => rect.filter(r => r.seccion === sec)
      .map(r => unir(fecha(r.fecha), r.norma_legal, r.texto)));
    const paginas = Math.max(1, ...items.map(l => Math.ceil(l.length / 5)));
    for (let p = 0; p < paginas; p++) {
      const pg = await hoja(3);
      secciones.forEach(([, ys], i) => items[i].slice(p * 5, p * 5 + 5)
        .forEach((t, k) => campo(pg, c, t, 72, 806, ys[k], 9)));
    }
  }

  // Hoja 4 — 2) Familia
  if (quiere(4)) await grilla(4, (d.familia ?? []).map((f: any) => [
    f.parentesco, f.codigo, unir(f.apellido_nombres, f.dni_familiar ? `DNI ${f.dni_familiar}` : ''), f.sexo, siNo(f.vive),
    ...dma(f.fecha_nacimiento), unir(f.es_empleado, f.es_jubilado)]), [1, 3, 4, 5, 6, 7]);

  // Hoja 5 — 2 bis
  if (quiere(5)) await grilla(5, (d.familiaExpedientes ?? []).map((e: any) => [
    e.expediente, fecha(e.fecha_informe), e.motivo, e.observacion]), [1]);

  // Hoja 6 — 3) Foja de servicios (oficio)
  if (quiere(6)) await grilla(6, (d.fojaServicios ?? []).map((f: any) => [
    f.resolucion, ...dma(f.fecha_ingreso), f.ministerio, f.dependencia, f.cargo, f.grupo_ocupacional,
    f.categoria, f.regimen_horario, ...dma(f.fecha_baja), f.motivo]), [1, 2, 3, 7, 8, 10, 11, 12]);

  // Hoja 7 — 3 bis) Bonificaciones
  if (quiere(7)) await grilla(7, (d.bonificaciones ?? []).map((b: any) => [
    b.norma_legal ?? b.decreto_numero, ...dma(b.fecha), ...dma(b.a_partir), ...dma(b.fecha_baja),
    b.motivo, b.expediente, b.anio, b.observaciones]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]);

  // Hoja 8 — 4) Función y destino
  if (quiere(8)) await grilla(8, (d.funcionDestino ?? []).map((f: any) => [
    f.funcion, f.destino, f.resolucion, fecha(f.fecha_ingreso), fecha(f.fecha_egreso), f.observaciones]), [3, 4]);

  // Hoja 9 — 5) Licencias
  if (quiere(9)) await grilla(9, (d.licencias ?? []).map((l: any) => [
    l.resolucion, ...dma(l.fecha), l.motivo, l.termino, l.a_partir_dia, l.a_partir_mes,
    x(l.con_sueldo), x(l.con_50pct), x(l.sin_sueldo), l.observaciones]), [1, 2, 3, 6, 7, 8, 9, 10]);

  // Hoja 10 — 6) Licencias concepto 06 (55/80)
  if (quiere(10)) await grilla(10, (d.licencias06 ?? []).map((l: any) => [
    l.codigo_trabajo, l.concepto, l.subconcepto, l.inciso, l.legajo_contaduria,
    l.norma_codigo, l.norma_numero, l.norma_anio, ...dma(l.fecha_desde), ...dma(l.fecha_hasta),
    l.dias_con_sueldo, l.dias_50, l.dias_sin_sueldo, l.acum_con_sueldo, l.acum_50, l.acum_sin_sueldo,
    l.observaciones]), Array.from({ length: 20 }, (_, i) => i).filter(i => i !== 4),
    pg => campo(pg, c, nombre, 163, 757, 524.1));

  // Hoja 11 — 7) Concepto y menciones
  if (quiere(11)) await grilla(11, (d.conceptoMenciones ?? []).map((m: any) => [
    ...dma(m.fecha), m.referencias]), [0, 1, 2]);

  // Hoja 12 — 8) Penas disciplinarias
  if (quiere(12)) await grilla(12, (d.penas ?? []).map((p: any) => [
    [p.expediente_letra, p.expediente_nro].map(s).filter(Boolean).join(' '), p.expediente_anio,
    p.decreto_resolucion, fecha(p.fecha), unir(p.calidad_pena, p.motivo), p.observaciones]), [1, 3]);

  // Hoja 13 — 9) Domicilio
  if (quiere(13)) await grilla(13, (d.domicilios ?? []).map((m: any) => [
    m.expediente, fecha(m.fecha), m.calle_numero, m.telefono, unir(m.partido, m.localidad), '',
    m.codigo_partido, m.codigo_localidad]), [1, 6, 7]);

  // Hoja 14 — 10) Incompatibilidad
  if (quiere(14)) {
    const pg = await hoja(14);
    const jub = inc.tiene_jubilacion === null || inc.tiene_jubilacion === undefined ? ''
      : (Number(inc.tiene_jubilacion) ? (s(inc.jubilacion_tipo) || 'Sí') : 'No');
    const nivel = s(inc.otro_cargo_nivel);
    const cargoEn = (k: string, nuevo: any) => s(nuevo) || (nivel === k ? s(inc.otro_cargo_lugar) : '');
    campo(pg, c, jub, 193, 404, 521.3);
    campo(pg, c, inc.jubilacion_ley, 459, 624, 521.3);
    campo(pg, c, inc.jubilacion_caja, 647, 796, 521.3);
    campo(pg, c, dinero(inc.jubilacion_monto), 128, 332, 496.9);
    campo(pg, c, fecha(inc.jubilacion_fecha), 440, 795, 496.9);
    campo(pg, c, inc.otro_cargo === null || inc.otro_cargo === undefined ? '' : (Number(inc.otro_cargo) ? 'Sí' : 'No'), 199, 451, 445.0);
    campo(pg, c, cargoEn('NACIONAL', inc.cargo_nacional), 99, 799, 420.6);
    campo(pg, c, cargoEn('PROVINCIAL', inc.cargo_provincial), 104, 799, 395.1);
    campo(pg, c, cargoEn('MUNICIPAL', inc.cargo_municipal), 104, 802, 369.6);
    campo(pg, c, unir(inc.otro_cargo_lugar, inc.otro_cargo_horario), 224, 799, 344.2);
    campo(pg, c, dinero(inc.otro_cargo_monto), 242, 641, 293.3);
    campo(pg, c, fecha(inc.otro_cargo_fecha_ingreso), 720, 798, 293.3, 8);
    campo(pg, c, inc.otras_actividades, 183, 800, 242.2);
    campo(pg, c, inc.otras_actividades_lugar, 185, 799, 216.9);
    campo(pg, c, dinero(inc.otras_actividades_monto), 244, 643, 191.4);
    campo(pg, c, fecha(inc.otras_actividades_fecha), 720, 797, 191.4, 8);
    campo(pg, c, inc.observaciones, 136, 801, 165.9);
  }

  // Hoja 15 — 11) Embargos
  if (quiere(15)) await grilla(15, (d.embargos ?? []).map((e: any) => [
    e.expediente, ...dma(e.fecha), dinero(e.suma_embargada), e.autoridad, e.ejecutante,
    fecha(e.fecha_levantamiento)]), [1, 2, 3, 7]);

  // Hoja 16 — 12) Declaración de bienes
  if (quiere(16)) await grilla(16, (d.declaracionBienes ?? []).map((b: any) => [
    b.descripcion, '', fecha(b.fecha)]), [2]);

  doc.setTitle(`Legajo Personal — ${nombre} — DNI ${s(pd.dni)}`);
  return doc.save();
}
