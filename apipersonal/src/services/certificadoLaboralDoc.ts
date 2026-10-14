// src/services/certificadoLaboralDoc.ts
// Certificado de Trabajo (Redaccion → tarjeta 1). Se arma un modelo unico y se
// dibuja como HTML (preview/imprimir) y como DOCX generado desde cero (sin plantilla).
// Incluye la fecha de fin de residencia (residentes) y el historial de
// cargo / ley / servicio de todos los tramos del agente.

import JSZip from 'jszip';
import { Sequelize, QueryTypes } from 'sequelize';
import { finResidencia, historialLaboral, ymdToDMY, FinResidencia, TramoHistorial } from './certificadoLaboral';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

export interface CertificadoLaboral {
  apellidoNombre: string;
  dni: string;
  legajo: string;
  dependencia: string;
  cargo: string;
  ley: string;
  servicio: string;
  hsSemanales: string;
  ingreso: string;          // dd/mm/aaaa
  egreso: string;           // dd/mm/aaaa si ya no esta activo
  activo: boolean;
  residencia: FinResidencia;
  historial: Array<{ desde: string; hasta: string; cargo: string; ley: string; servicio: string }>;
  lugarFecha: string;
  parrafos: string[];
}

const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'en', 'y', 'e', 'a', 'al', 'con', 'para', 'por']);

function titulo(v: string): string {
  return v.toLocaleLowerCase('es-AR')
    .replace(/(^|[\s(/-])(\p{L})/gu, (_m, a, b) => a + b.toLocaleUpperCase('es-AR'))
    .replace(/(?<=\s)(\p{L}+)/gu, (w) => (MINUSCULAS.has(w.toLocaleLowerCase('es-AR')) ? w.toLocaleLowerCase('es-AR') : w));
}

function fechaLarga(d: Date): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function leyPlanta(t: TramoHistorial): string {
  return [t.ley, t.planta && !t.ley.toUpperCase().includes(t.planta.toUpperCase()) ? `Planta ${titulo(t.planta)}` : '']
    .filter(Boolean).join(' · ');
}

export async function armarCertificadoLaboral(sequelize: Sequelize, dni: number): Promise<CertificadoLaboral | null> {
  const [p] = await sequelize.query<any>(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.dependencia, pd.fecha_ingreso,
            COALESCE(pd.legajo, (SELECT a.legajo FROM agentes a WHERE a.dni = pd.dni AND a.deleted_at IS NULL
                                  ORDER BY a.id DESC LIMIT 1)) AS legajo,
            (SELECT rh.nombre FROM agentes a JOIN regimenes_horarios rh ON rh.id = a.regimen_horario_id
              WHERE a.dni = pd.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'
              ORDER BY a.fecha_egreso IS NULL DESC, a.id DESC LIMIT 1) AS hs_semanales
       FROM personaldetalle pd
      WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  if (!p) return null;

  const tramos = await historialLaboral(sequelize, dni);
  const residencia = await finResidencia(sequelize, dni);

  const vigente = [...tramos].reverse().find((t) => t.estado === 'ACTIVO' && !t.hasta) ?? null;
  const ultimo = vigente ?? tramos[tramos.length - 1] ?? null;
  const activo = !!vigente;
  const primerDesde = tramos.find((t) => t.desde)?.desde ?? null;
  const ingreso = ymdToDMY(primerDesde) || ymdToDMY(String(p.fecha_ingreso ?? '').slice(0, 10) || null);
  const egreso = activo ? '' : ymdToDMY(ultimo?.hasta ?? null);

  const apellidoNombre = `${p.apellido ?? ''} ${p.nombre ?? ''}`.trim().toLocaleUpperCase('es-AR');
  const dependencia = String(p.dependencia ?? '').trim();
  const cargo = ultimo?.cargo ?? '';
  const ley = ultimo?.ley ?? '';
  const servicio = ultimo?.servicio ?? '';
  const hs = String(p.hs_semanales ?? '').trim();
  const hsSemanales = /^\d+$/.test(hs) ? hs : '';
  const legajo = String(p.legajo ?? '').trim();

  // Texto principal
  const ident = `${apellidoNombre}, DNI N° ${p.dni}${legajo ? `, Legajo N° ${legajo}` : ''}`;
  const lugar = dependencia ? ` en ${dependencia}` : '';
  let principal: string;
  if (activo) {
    principal = `Se certifica que ${ident}, presta servicios${lugar}, dependiente del Ministerio de Salud de la Provincia de Buenos Aires, desde el ${ingreso}`;
    const detalle: string[] = [];
    if (cargo) detalle.push(`desempeñándose actualmente como ${titulo(cargo)}${ley ? ` (${ley})` : ''}`);
    if (servicio) detalle.push(`en ${titulo(servicio)}`);
    if (hsSemanales) detalle.push(`con una carga horaria de ${hsSemanales} horas semanales`);
    principal += detalle.length ? `, ${detalle.join(', ')}.` : '.';
  } else {
    principal = `Se certifica que ${ident}, prestó servicios${lugar}, dependiente del Ministerio de Salud de la Provincia de Buenos Aires, desde el ${ingreso}${egreso ? ` hasta el ${egreso}` : ''}${cargo ? `, siendo su último cargo ${titulo(cargo)}${ley ? ` (${ley})` : ''}` : ''}.`;
  }

  const parrafos = [principal];
  if (activo && residencia.esResidente && residencia.finTxt) {
    const nombreRes = residencia.residencia ? ` de ${titulo(residencia.residencia)}` : '';
    parrafos.push(
      residencia.origen === 'JEFATURA'
        ? `Se desempeña como Jefe/a de Residentes${nombreRes}, función que finaliza el ${residencia.finTxt}.`
        : `Cursa la Residencia${nombreRes}, de ${residencia.anios} años de duración, con fecha de finalización el ${residencia.finTxt}.`,
    );
  }
  if (tramos.length) parrafos.push('Se detalla a continuación su historial de revista:');

  return {
    apellidoNombre,
    dni: String(p.dni),
    legajo,
    dependencia,
    cargo,
    ley,
    servicio,
    hsSemanales,
    ingreso,
    egreso,
    activo,
    residencia,
    historial: tramos.map((t) => ({
      desde: ymdToDMY(t.desde) || '—',
      hasta: t.hasta ? ymdToDMY(t.hasta) : (t.estado === 'ACTIVO' ? 'A la fecha' : '—'),
      cargo: t.cargo ? titulo(t.cargo) : '—',
      ley: leyPlanta(t) || '—',
      servicio: t.servicio ? titulo(t.servicio) : '—',
    })),
    lugarFecha: `González Catán, ${fechaLarga(new Date())}`,
    parrafos,
  };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function esc(v: string): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderCertificadoLaboralHtml(c: CertificadoLaboral): string {
  const filas = c.historial.map((h) => `
        <tr><td>${esc(h.desde)}</td><td>${esc(h.hasta)}</td><td>${esc(h.cargo)}</td><td>${esc(h.ley)}</td><td>${esc(h.servicio)}</td></tr>`).join('');
  const ficha: Array<[string, string]> = [
    ['Apellido y nombre', c.apellidoNombre],
    ['DNI', c.dni],
    ['Legajo', c.legajo || '—'],
    ['Dependencia', c.dependencia || '—'],
    ['Fecha de ingreso', c.ingreso || '—'],
    [c.activo ? 'Situación' : 'Fecha de egreso', c.activo ? 'En actividad' : (c.egreso || '—')],
  ];
  if (c.activo && c.residencia.esResidente && c.residencia.finTxt) ficha.push(['Fin de residencia', c.residencia.finTxt]);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Certificado de Trabajo</title>
<style>
  @page { size: A4; margin: 18mm 18mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12.5px; line-height: 1.6; margin: 0; padding: 36px 48px; background: #fff; max-width: 820px; margin: 0 auto; }
  .org { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #64748b; }
  .org strong { color: #1e3a5f; }
  h1 { font-size: 22px; letter-spacing: .08em; color: #1e3a5f; margin: 18px 0 4px; }
  .rule { height: 3px; width: 64px; background: #2563eb; border-radius: 2px; margin-bottom: 22px; }
  .ficha { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; background: #f1f5f9; border-radius: 8px; padding: 14px 18px; margin-bottom: 22px; }
  .ficha div span { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; }
  .ficha div b { font-size: 12.5px; color: #0f172a; }
  p { margin: 0 0 12px; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 22px; font-size: 11px; }
  th { background: #1e3a5f; color: #fff; text-align: left; padding: 7px 8px; font-weight: 600; letter-spacing: .03em; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .cierre { margin-top: 8px; }
  .fecha { text-align: right; margin-top: 18px; }
  .firma { margin: 80px 0 0 auto; width: 260px; border-top: 1px solid #334155; text-align: center; padding-top: 6px; font-size: 10.5px; color: #475569; }
</style></head>
<body>
  <div class="org"><strong>Provincia de Buenos Aires</strong> · Ministerio de Salud</div>
  <div class="org">${esc(c.dependencia || 'H.I.G.A. Simplemente Evita')} · González Catán, La Matanza</div>
  <h1>CERTIFICADO DE TRABAJO</h1>
  <div class="rule"></div>
  <div class="ficha">${ficha.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
  ${c.parrafos.map((t) => `<p>${esc(t)}</p>`).join('\n  ')}
  ${c.historial.length ? `<table>
    <thead><tr><th>Desde</th><th>Hasta</th><th>Cargo</th><th>Ley / Planta</th><th>Servicio</th></tr></thead>
    <tbody>${filas}
    </tbody>
  </table>` : ''}
  <p class="cierre">Se extiende el presente a solicitud del/de la interesado/a para ser presentado ante quien corresponda.</p>
  <p class="fecha">${esc(c.lugarFecha)}</p>
  <div class="firma">Firma y sello</div>
</body></html>`;
}

// ─── DOCX (generado desde cero) ──────────────────────────────────────────────

const AZUL = '1E3A5F';
const GRIS = '64748B';

function x(v: string): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface RunOpts { bold?: boolean; size?: number; color?: string; caps?: boolean; spacing?: number }
function run(text: string, o: RunOpts = {}): string {
  const rpr = [
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>',
    o.bold ? '<w:b/>' : '',
    o.caps ? '<w:caps/>' : '',
    o.color ? `<w:color w:val="${o.color}"/>` : '',
    o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : '',
    `<w:sz w:val="${o.size ?? 22}"/><w:szCs w:val="${o.size ?? 22}"/>`,
  ].join('');
  return `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
}

interface ParOpts { align?: 'left' | 'right' | 'center' | 'both'; after?: number; before?: number; borderBottom?: string; shade?: string }
function par(runs: string, o: ParOpts = {}): string {
  const ppr = [
    o.borderBottom ? `<w:pBdr><w:bottom w:val="single" w:sz="18" w:space="4" w:color="${o.borderBottom}"/></w:pBdr>` : '',
    o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '',
    `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 160}" w:line="300" w:lineRule="auto"/>`,
    `<w:jc w:val="${o.align ?? 'both'}"/>`,
  ].join('');
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

function celda(contenido: string, ancho: number, fill?: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}` +
    `<w:tcMar><w:top w:w="70" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/></w:tcMar></w:tcPr>${contenido}</w:tc>`;
}

function tabla(anchos: number[], filas: string[], bordes: string): string {
  return `<w:tbl><w:tblPr><w:tblW w:w="${anchos.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${bordes}</w:tblBorders>` +
    `<w:tblCellMar><w:left w:w="110" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${anchos.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${filas.join('')}</w:tbl>`;
}

const SIN_BORDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="nil"/>`).join('');
const BORDES_HIST = '<w:top w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/><w:insideV w:val="nil"/>' +
  '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>';

export async function renderCertificadoLaboralDocx(c: CertificadoLaboral): Promise<Buffer> {
  const ANCHO = 9020; // A4 con margenes de 1440

  const ficha: Array<[string, string]> = [
    ['APELLIDO Y NOMBRE', c.apellidoNombre],
    ['DNI', c.dni],
    ['LEGAJO', c.legajo || '—'],
    ['DEPENDENCIA', c.dependencia || '—'],
    ['FECHA DE INGRESO', c.ingreso || '—'],
    [c.activo ? 'SITUACIÓN' : 'FECHA DE EGRESO', c.activo ? 'En actividad' : (c.egreso || '—')],
  ];
  if (c.activo && c.residencia.esResidente && c.residencia.finTxt) ficha.push(['FIN DE RESIDENCIA', c.residencia.finTxt]);

  const mitad = ANCHO / 2;
  const filasFicha: string[] = [];
  for (let i = 0; i < ficha.length; i += 2) {
    const par2 = ficha.slice(i, i + 2);
    while (par2.length < 2) par2.push(['', '']);
    filasFicha.push(`<w:tr>${par2.map(([k, v]) => celda(
      par(run(k, { size: 15, color: GRIS, spacing: 10 }), { after: 0, align: 'left' }) +
      par(run(v, { size: 21, bold: true, color: '0F172A' }), { after: 40, align: 'left' }),
      mitad, 'F1F5F9')).join('')}</w:tr>`);
  }

  const anchosHist = [1150, 1150, 2420, 1900, 2400];
  const encabezado = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${['Desde', 'Hasta', 'Cargo', 'Ley / Planta', 'Servicio']
    .map((h, i) => celda(par(run(h, { size: 17, bold: true, color: 'FFFFFF' }), { after: 0, align: 'left' }), anchosHist[i], AZUL)).join('')}</w:tr>`;
  const filasHist = c.historial.map((h, idx) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${[h.desde, h.hasta, h.cargo, h.ley, h.servicio]
    .map((v, i) => celda(par(run(v, { size: 17 }), { after: 0, align: 'left' }), anchosHist[i], idx % 2 ? 'F8FAFC' : undefined)).join('')}</w:tr>`);

  const body = [
    par(run('Provincia de Buenos Aires', { size: 16, bold: true, color: AZUL, caps: true, spacing: 20 }) +
        run('  ·  Ministerio de Salud', { size: 16, color: GRIS, caps: true, spacing: 20 }), { after: 0, align: 'left' }),
    par(run(`${c.dependencia || 'H.I.G.A. Simplemente Evita'}  ·  González Catán, La Matanza`, { size: 16, color: GRIS, caps: true, spacing: 20 }), { after: 280, align: 'left' }),
    par(run('CERTIFICADO DE TRABAJO', { size: 40, bold: true, color: AZUL, spacing: 30 }), { after: 320, align: 'left', borderBottom: '2563EB' }),
    tabla([mitad, mitad], filasFicha, SIN_BORDES),
    par('', { after: 200 }),
    ...c.parrafos.map((t) => par(run(t))),
    ...(c.historial.length ? [tabla(anchosHist, [encabezado, ...filasHist], BORDES_HIST), par('', { after: 200 })] : []),
    par(run('Se extiende el presente a solicitud del/de la interesado/a para ser presentado ante quien corresponda.')),
    par(run(c.lugarFecha), { align: 'right', before: 200 }),
    par('', { after: 1400 }),
    `<w:p><w:pPr><w:ind w:left="5600"/><w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="334155"/></w:pBdr><w:jc w:val="center"/></w:pPr>${run('Firma y sello', { size: 18, color: GRIS })}</w:p>`,
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1440" w:bottom="1300" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}
