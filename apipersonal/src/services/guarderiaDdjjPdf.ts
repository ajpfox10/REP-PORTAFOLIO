// src/services/guarderiaDdjjPdf.ts
// DDJJ para Reintegro de Guardería y/o Jardín Maternal impresa sobre el PDF ORIGINAL del
// Ministerio (assets/guarderia/ddjj_guarderia.pdf, IF-2024-18854671-GDEBA, oficio 612x1008):
// se abre la plantilla tal cual (2 hojas + hoja de firmas GDE) y se escriben los datos encima
// de cada línea de guiones. Coordenadas medidas de la plantilla (base de los guiones, en pt).
// Con más de 2 menores se agrega otra copia de la hoja 2 por cada par extra ("planilla anexa").
import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

const NEGRO = rgb(0, 0, 0);

let plantillaCache: Buffer | null = null;
function plantilla(): Buffer {
  if (plantillaCache) return plantillaCache;
  const candidatos = [
    path.resolve(process.cwd(), 'assets/guarderia/ddjj_guarderia.pdf'),
    path.resolve(__dirname, '../../assets/guarderia/ddjj_guarderia.pdf'),
    path.resolve(__dirname, '../../../assets/guarderia/ddjj_guarderia.pdf'),
  ];
  const ruta = candidatos.find(p => fs.existsSync(p));
  if (!ruta) throw new Error('No se encuentra assets/guarderia/ddjj_guarderia.pdf');
  plantillaCache = fs.readFileSync(ruta);
  return plantillaCache;
}

const s = (v: any): string => (v === null || v === undefined ? '' : String(v).trim());
const fecha = (v: any) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s(v);
};

type Ctx = { font: PDFFont };

// Helvetica estándar usa WinAnsi: lo que no entra se reemplaza para que no rompa
function apto(font: PDFFont, t: string): string {
  let out = '';
  for (const ch of t.replace(/\s+/g, ' ')) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

// Escribe sobre la línea de guiones [x0, x1] con base `y`, achicando la letra si no entra
function campo(pg: PDFPage, c: Ctx, texto: any, x0: number, x1: number, y: number,
               o: { size?: number; min?: number } = {}) {
  let t = apto(c.font, s(texto));
  if (!t) return;
  const ancho = x1 - x0 - 4;
  let size = o.size ?? 10;
  const min = o.min ?? 6;
  while (size > min && c.font.widthOfTextAtSize(t, size) > ancho) size -= 0.25;
  while (t.length > 1 && c.font.widthOfTextAtSize(t, size) > ancho) t = t.slice(0, -2) + '…';
  pg.drawText(t, { x: x0 + 3, y: y + 2.5, size, font: c.font, color: NEGRO });
}

// Óvalo sobre la opción impresa (SI / NO)
function marcar(pg: PDFPage, x0: number, x1: number, base: number) {
  pg.drawEllipse({ x: (x0 + x1) / 2, y: base + 3.8, xScale: (x1 - x0) / 2 + 5, yScale: 8,
    borderColor: NEGRO, borderWidth: 1 });
}

export type DdjjMenor = {
  apellido_nombre?: string | null; documento?: string | null; fecha_nacimiento?: string | null;
  patologia?: number | boolean | null; atencion_temporaria?: string | null; atencion_permanente?: string | null;
};

// Bloque de un menor en la hoja 2: `dy` = desplazamiento del 2º bloque respecto del 1º
function menor(pg: PDFPage, c: Ctx, m: DdjjMenor | undefined, dy: number) {
  if (!m) return;
  campo(pg, c, m.apellido_nombre, 205.1, 507.8, 906.1 - dy);
  campo(pg, c, m.documento, 229.2, 509.8, 880.8 - dy);
  campo(pg, c, fecha(m.fecha_nacimiento), 216.8, 508.5, 855.6 - dy);
  if (m.patologia !== null && m.patologia !== undefined && m.patologia !== '' as any) {
    if (Number(m.patologia)) marcar(pg, 214.8, 224.8, 805.0 - dy);
    else marcar(pg, 381.5, 397.4, 805.0 - dy);
  }
  campo(pg, c, m.atencion_temporaria, 162.4, 305.5, 729.0 - dy, { size: 9 });
  campo(pg, c, m.atencion_permanente, 385.1, 506.4, 729.0 - dy, { size: 9 });
}

// Firma / lugar / fecha / certificación (pie de la hoja 2)
function pieFirmas(pg: PDFPage, c: Ctx, d: any) {
  campo(pg, c, d.firma_aclaracion, 371.3, 509.2, 284.5, { size: 9 });
  campo(pg, c, d.lugar, 128.8, 277.4, 246.5);
  campo(pg, c, fecha(d.fecha), 322.1, 509.1, 246.5);
  campo(pg, c, d.certifica_pertenece, 390.2, 505.8, 208.6, { size: 9 });
  campo(pg, c, d.certifica_aclaracion, 371.3, 509.2, 170.6, { size: 9 });
}

export async function generarGuarderiaDdjjPdf(d: any, menores: DdjjMenor[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(plantilla());
  const c: Ctx = { font: await doc.embedFont(StandardFonts.Helvetica) };
  const [p1, p2] = doc.getPages();

  // Hoja 1 — agente
  campo(p1, c, d.reparticion, 163.6, 510.2, 833.9);
  campo(p1, c, d.apellido_nombre, 205.1, 507.8, 783.2);
  campo(p1, c, d.documento, 229.2, 509.8, 758.0);
  campo(p1, c, fecha(d.fecha_nacimiento), 216.7, 508.5, 732.7);
  campo(p1, c, d.estado_civil, 166.2, 507.5, 707.4);
  campo(p1, c, d.nacionalidad, 175.7, 505.9, 682.1);
  campo(p1, c, d.cargo, 196.0, 333.5, 656.8, { size: 9 });
  campo(p1, c, d.horario, 392.2, 507.8, 656.8, { size: 9 });
  campo(p1, c, d.legajo, 200.4, 508.5, 631.6);
  campo(p1, c, d.domicilio, 221.3, 507.6, 606.2);
  campo(p1, c, fecha(d.fecha_reintegro), 85.1, 508.7, 568.3);
  campo(p1, c, d.ninos_a_cargo, 319.9, 507.3, 543.0);
  campo(p1, c, d.condicion_tutela, 85.1, 508.7, 492.2);
  // la línea del motivo es más corta (guiones de 20pt): se deja pasar hasta el margen derecho
  campo(p1, c, d.motivo_no_ingresa, 85.1, 525, 434.5);

  // Hoja 1 — otro progenitor
  campo(p1, c, d.otro_apellido_nombre, 205.1, 507.8, 278.0);
  campo(p1, c, d.otro_domicilio, 221.3, 507.6, 252.7);
  campo(p1, c, d.otro_documento, 229.2, 509.8, 227.5);
  campo(p1, c, fecha(d.otro_fecha_nacimiento), 216.7, 508.5, 202.2);
  campo(p1, c, d.otro_estado_civil, 166.2, 507.5, 176.9);
  campo(p1, c, d.otro_nacionalidad, 175.7, 505.9, 151.6);
  campo(p1, c, d.otro_lugar_trabajo, 198.6, 506.6, 126.2);

  // Hoja 2 — menores de a 2 por hoja; los que sobran van en copias de la hoja 2
  // (las copias se sacan de la plantilla limpia, antes de escribir sobre la hoja 2)
  const DY = 906.1 - 626.2;
  const tpl = await PDFDocument.load(plantilla());
  const hojas2: PDFPage[] = [p2];
  for (let i = 2; i < menores.length; i += 2) {
    const [extra] = await doc.copyPages(tpl, [1]);
    hojas2.push(doc.insertPage(hojas2.length + 1, extra));
  }
  hojas2.forEach((pg, k) => {
    menor(pg, c, menores[k * 2], 0);
    menor(pg, c, menores[k * 2 + 1], DY);
    pieFirmas(pg, c, d);
  });

  doc.setTitle(`DDJJ Guardería — ${s(d.apellido_nombre)} — DNI ${s(d.documento)}`);
  return doc.save();
}
