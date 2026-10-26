// src/services/certificadoDiferencialDoc.ts
// Certificado "Diferencial 2%" (Redaccion → tarjeta 19). Certifica que desde el
// nombramiento hasta el 30/06/2015 el agente aporto el 14 % al IPS, con las
// licencias sin goce y las jefaturas de ese periodo.
//
// La base no tiene licencias SIAPE anteriores a 2016 ni jefaturas historicas:
// /datos devuelve sugerencias y el operador completa las grillas a mano. Sin
// la tilde "verificado" el texto no afirma que NO hubo licencias ni jefaturas.

import { Sequelize, QueryTypes } from 'sequelize';
import { historialLaboral, toYMD, ymdToDMY } from './certificadoLaboral';
import {
  titulo, fechaLarga, esc, run, par, celda, tabla, empaquetarDocx,
  AZUL, GRIS, SIN_BORDES,
} from './certificadoLaboralDoc';

export const CORTE_14 = '2015-06-30';

export interface Lapso { desde: string; hasta: string }
export interface LicenciaSinGoce extends Lapso { expediente: string }
export interface Jefatura extends Lapso { cargo: string; acto: string }
export interface Reconocimiento extends Lapso { acto: string }

export interface Diferencial2pctDatos {
  apellidoNombre: string;
  dni: string;
  legajo: string;
  dependencia: string;
  cargo: string;
  ley: string;
  desde: string;            // YYYY-MM-DD (nombramiento) o ''
  hasta: string;            // YYYY-MM-DD (30/06/2015)
  reconocimientos: Reconocimiento[];   // 16 % por acto, del ultimo calculo de jubilacion
  diferencialPagado: boolean;
  esInsalubreIps: boolean;
  licencias: LicenciaSinGoce[];        // sugeridas (SIAPE historial)
  expedientesSinGoce: Array<{ numero: string; anio: string; caratula: string }>;
  resolucionesSinGoce: Array<{ numero: string; fecha: string; detalle: string }>;
  jefaturas: Jefatura[];               // sugeridas (tabla jefaturas, sin fechas)
  avisos: string[];
}

export interface Diferencial2pctInput {
  dni: number;
  desde: string;
  hasta: string;
  licencias: LicenciaSinGoce[];
  jefaturas: Jefatura[];
  reconocimientos: Reconocimiento[];
  verificado: boolean;
  destino: string;
}

const RE_SIN_GOCE = 'sin (goce|sueldo|haberes)';

async function datosPersona(sequelize: Sequelize, dni: number) {
  const [p] = await sequelize.query<any>(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.dependencia,
            COALESCE(pd.legajo, (SELECT a.legajo FROM agentes a WHERE a.dni = pd.dni AND a.deleted_at IS NULL
                                  ORDER BY a.id DESC LIMIT 1)) AS legajo,
            (SELECT MIN(a.fecha_de_nombramiento) FROM agentes a
              WHERE a.dni = pd.dni AND a.deleted_at IS NULL AND a.fecha_de_nombramiento > '1900-01-01') AS nombramiento
       FROM personaldetalle pd
      WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  return p ?? null;
}

// Cargo y ley del tramo que contiene la fecha (o el primero posterior).
async function cargoAl(sequelize: Sequelize, dni: number, fecha: string) {
  const tramos = await historialLaboral(sequelize, dni);
  const t = tramos.find((x) => (!x.desde || x.desde <= fecha) && (!x.hasta || x.hasta >= fecha))
    ?? tramos.find((x) => x.desde && x.desde >= fecha)
    ?? null;
  return { cargo: t?.cargo ?? '', ley: t?.ley ?? '' };
}

function cruza(a: Lapso, desde: string, hasta: string): boolean {
  return (!a.desde || a.desde <= hasta) && (!a.hasta || a.hasta >= desde);
}

export async function datosDiferencial2pct(sequelize: Sequelize, dni: number): Promise<Diferencial2pctDatos | null> {
  const p = await datosPersona(sequelize, dni);
  if (!p) return null;

  const desde = toYMD(p.nombramiento) ?? '';
  const hasta = CORTE_14;
  const avisos: string[] = [];
  if (!desde) avisos.push('No hay fecha de nombramiento cargada: completala a mano.');
  else if (desde > hasta) avisos.push('El nombramiento es posterior al 30/06/2015: no hay período al 14 %.');

  const { cargo, ley } = desde ? await cargoAl(sequelize, dni, desde) : { cargo: '', ley: '' };
  const rangoDesde = desde || '1900-01-01';

  // Ultimo calculo de jubilacion guardado: actos que reconocen 16 % y flags del IPS.
  const [calc] = await sequelize.query<any>(
    `SELECT es_insalubre_ips, diferencial_2pct_pagado, reconocimientos_insalubre
       FROM jubilacion_calculos
      WHERE dni = :dni AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  let recos: any[] = [];
  try {
    const raw = calc?.reconocimientos_insalubre;
    recos = Array.isArray(raw) ? raw : raw ? JSON.parse(raw) : [];
  } catch { recos = []; }
  const reconocimientos: Reconocimiento[] = recos
    .map((r: any) => ({ desde: toYMD(r.fecha_desde) ?? '', hasta: toYMD(r.fecha_hasta) ?? '', acto: String(r.acto ?? '').trim() }))
    .filter((r) => r.desde && cruza(r, rangoDesde, hasta));
  if (calc?.es_insalubre_ips) avisos.push('El último cálculo de jubilación marca profesión insalubre en el IPS (aporte 16 %).');
  if (calc?.diferencial_2pct_pagado) avisos.push('El último cálculo de jubilación marca el diferencial del 2 % como ya pagado.');

  const novedades = await sequelize.query<any>(
    `SELECT novedad, fecha_desde, fecha_hasta FROM historial
      WHERE dni = :dni AND novedad RLIKE :re AND fecha_desde <= :hasta
        AND (fecha_hasta IS NULL OR fecha_hasta >= :desde)
      ORDER BY fecha_desde`,
    { replacements: { dni, re: RE_SIN_GOCE, desde: rangoDesde, hasta }, type: QueryTypes.SELECT },
  );
  const licencias: LicenciaSinGoce[] = novedades.map((n: any) => ({
    desde: toYMD(n.fecha_desde) ?? '', hasta: toYMD(n.fecha_hasta) ?? '', expediente: '',
  }));

  const expedientes = await sequelize.query<any>(
    `SELECT numero, anio, caratula FROM expedientes
      WHERE dni = :dni AND deleted_at IS NULL AND caratula RLIKE :re
      ORDER BY anio IS NULL, anio, id`,
    { replacements: { dni, re: RE_SIN_GOCE }, type: QueryTypes.SELECT },
  );
  const resoluciones = await sequelize.query<any>(
    `SELECT numero, fecha, CONCAT_WS(' · ', NULLIF(TRIM(motivo), ''), NULLIF(TRIM(observaciones), '')) AS detalle
       FROM resoluciones
      WHERE dni = :dni AND deleted_at IS NULL AND (motivo RLIKE :re OR observaciones RLIKE :re)
      ORDER BY fecha`,
    { replacements: { dni, re: RE_SIN_GOCE }, type: QueryTypes.SELECT },
  );

  const jefes = await sequelize.query<any>(
    `SELECT s.nombre AS servicio, j.fecha_desde, j.fecha_hasta
       FROM jefaturas j LEFT JOIN servicios s ON s.id = j.servicio_id
      WHERE j.dni = :dni AND j.deleted_at IS NULL`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  const jefaturas: Jefatura[] = jefes
    .map((j: any) => ({
      cargo: j.servicio ? `Jefe/a de ${titulo(String(j.servicio))}` : 'Jefe/a de Servicio',
      desde: toYMD(j.fecha_desde) ?? '', hasta: toYMD(j.fecha_hasta) ?? '', acto: '',
    }))
    .filter((j) => cruza(j, rangoDesde, hasta));

  avisos.push('El sistema no tiene licencias de SIAPE anteriores a 2016 ni jefaturas históricas: verificá el legajo.');

  return {
    apellidoNombre: `${p.apellido ?? ''} ${p.nombre ?? ''}`.trim().toLocaleUpperCase('es-AR'),
    dni: String(p.dni),
    legajo: String(p.legajo ?? '').trim(),
    dependencia: String(p.dependencia ?? '').trim(),
    cargo,
    ley,
    desde,
    hasta,
    reconocimientos,
    diferencialPagado: !!calc?.diferencial_2pct_pagado,
    esInsalubreIps: !!calc?.es_insalubre_ips,
    licencias,
    expedientesSinGoce: expedientes.map((e: any) => ({
      numero: String(e.numero ?? '').trim(), anio: e.anio ? String(e.anio) : '', caratula: String(e.caratula ?? '').trim(),
    })),
    resolucionesSinGoce: resoluciones.map((r: any) => ({
      numero: String(r.numero ?? '').trim(), fecha: toYMD(r.fecha) ?? '', detalle: String(r.detalle ?? '').trim(),
    })),
    jefaturas,
    avisos,
  };
}

// ─── Modelo del documento ────────────────────────────────────────────────────

// Anios/meses/dias entre dos fechas, ambas inclusive.
export function periodo(desde: string, hasta: string): { anios: number; meses: number; dias: number } {
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const fin = new Date(Date.UTC(y2, m2 - 1, d2));
  fin.setUTCDate(fin.getUTCDate() + 1);
  let anios = fin.getUTCFullYear() - y1;
  let meses = fin.getUTCMonth() + 1 - m1;
  let dias = fin.getUTCDate() - d1;
  if (dias < 0) {
    meses -= 1;
    dias += new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), 0)).getUTCDate();
  }
  if (meses < 0) { anios -= 1; meses += 12; }
  return { anios, meses, dias };
}

function periodoTxt(desde: string, hasta: string): string {
  const { anios, meses, dias } = periodo(desde, hasta);
  const partes = [
    anios ? `${anios} ${anios === 1 ? 'año' : 'años'}` : '',
    meses ? `${meses} ${meses === 1 ? 'mes' : 'meses'}` : '',
    dias ? `${dias} ${dias === 1 ? 'día' : 'días'}` : '',
  ].filter(Boolean);
  if (!partes.length) return '0 días';
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

function lapsoTxt(l: Lapso): string {
  if (l.desde && l.hasta) return `desde el ${ymdToDMY(l.desde)} hasta el ${ymdToDMY(l.hasta)}`;
  if (l.desde) return `desde el ${ymdToDMY(l.desde)}`;
  if (l.hasta) return `hasta el ${ymdToDMY(l.hasta)}`;
  return '';
}

function enumerar(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join('; ')} y ${items[items.length - 1]}`;
}

export interface CertificadoDiferencial {
  datos: Diferencial2pctDatos;
  ficha: Array<[string, string]>;
  parrafos: string[];
  cierre: string;
  lugarFecha: string;
}

const esFecha = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function armarCertificadoDiferencial(sequelize: Sequelize, input: Diferencial2pctInput): Promise<CertificadoDiferencial | null> {
  const d = await datosDiferencial2pct(sequelize, input.dni);
  if (!d) return null;

  const desde = esFecha(input.desde) ? input.desde : d.desde;
  const hasta = esFecha(input.hasta) ? input.hasta : d.hasta;
  const { cargo, ley } = desde && desde !== d.desde ? await cargoAl(sequelize, input.dni, desde) : d;
  const limpiar = <T extends Lapso>(xs: T[] | undefined) => (xs ?? [])
    .map((x) => ({ ...x, desde: esFecha(x.desde) ? x.desde : '', hasta: esFecha(x.hasta) ? x.hasta : '' }))
    .sort((a, b) => (a.desde || '9').localeCompare(b.desde || '9'));
  const licencias = limpiar(input.licencias).filter((l) => l.desde || l.hasta || l.expediente?.trim());
  const jefaturas = limpiar(input.jefaturas).filter((j) => j.cargo?.trim());
  const recos = limpiar(input.reconocimientos).filter((r) => r.desde && r.hasta);

  const ident = `${d.apellidoNombre}, DNI N° ${d.dni}${d.legajo ? `, Legajo N° ${d.legajo}` : ''}`;
  const comoCargo = cargo ? ` como ${titulo(cargo)}${ley ? ` (${ley})` : ''}` : '';
  const largo = desde && hasta && desde <= hasta ? `, lo que totaliza ${periodoTxt(desde, hasta)}` : '';
  const parrafos = [
    `Se certifica que ${ident}, ingresó por nombramiento el ${ymdToDMY(desde) || '___/___/______'}${comoCargo} y que, ` +
    `desde esa fecha hasta el ${ymdToDMY(hasta)}, se le practicó sobre sus haberes el descuento previsional del ` +
    `14 % (catorce por ciento) con destino al Instituto de Previsión Social${largo}.`,
  ];

  if (recos.length) {
    parrafos.push(`Se exceptúa${recos.length > 1 ? 'n los lapsos' : ' el lapso'} ` +
      enumerar(recos.map((r) => `${lapsoTxt(r)}${r.acto?.trim() ? `, reconocido por ${r.acto.trim()}` : ''}`)) +
      `, en que se le aplicó el descuento del 16 % (dieciséis por ciento).`);
  }

  if (licencias.length) {
    const items = licencias.map((l) => [lapsoTxt(l), l.expediente?.trim() ? `según Expediente N° ${l.expediente.trim()}` : '']
      .filter(Boolean).join(', '));
    parrafos.push(`Durante dicho período gozó de licencia sin goce de haberes ${enumerar(items)}.`);
  } else if (input.verificado) {
    parrafos.push('Durante dicho período no registra licencias sin goce de haberes.');
  }

  if (jefaturas.length) {
    const items = jefaturas.map((j) => [`la función de ${j.cargo.trim()} ${lapsoTxt(j)}`.trim(), j.acto?.trim() ? `según ${j.acto.trim()}` : '']
      .filter(Boolean).join(', '));
    parrafos.push(`Asimismo, durante dicho período desempeñó ${enumerar(items)}.`);
  } else if (input.verificado) {
    parrafos.push('Durante dicho período no registra jefaturas asignadas.');
  }

  const ficha: Array<[string, string]> = [
    ['Apellido y nombre', d.apellidoNombre],
    ['DNI', d.dni],
    ['Legajo', d.legajo || '—'],
    ['Fecha de nombramiento', ymdToDMY(desde) || '—'],
    ['Período al 14 %', desde ? `${ymdToDMY(desde)} al ${ymdToDMY(hasta)}` : '—'],
    ['Cargo', cargo ? titulo(cargo) : '—'],
  ];

  const destino = String(input.destino ?? '').trim();
  return {
    datos: { ...d, desde, hasta, cargo, ley },
    ficha,
    parrafos,
    cierre: `Se extiende el presente a solicitud del/de la interesado/a para ser presentado ante ${destino || 'quien corresponda'}.`,
    lugarFecha: `González Catán, ${fechaLarga(new Date())}`,
  };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

export function renderCertificadoDiferencialHtml(c: CertificadoDiferencial): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Certificado Diferencial 2%</title>
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
  .fecha { text-align: right; margin-top: 18px; }
  .firma { margin: 80px 0 0 auto; width: 260px; border-top: 1px solid #334155; text-align: center; padding-top: 6px; font-size: 10.5px; color: #475569; }
</style></head>
<body>
  <div class="org"><strong>Provincia de Buenos Aires</strong> · Ministerio de Salud</div>
  <div class="org">${esc(c.datos.dependencia || 'H.I.G.A. Simplemente Evita')} · González Catán, La Matanza</div>
  <h1>CERTIFICADO</h1>
  <div class="rule"></div>
  <div class="ficha">${c.ficha.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
  ${c.parrafos.map((t) => `<p>${esc(t)}</p>`).join('\n  ')}
  <p>${esc(c.cierre)}</p>
  <p class="fecha">${esc(c.lugarFecha)}</p>
  <div class="firma">Firma y sello</div>
</body></html>`;
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

export async function renderCertificadoDiferencialDocx(c: CertificadoDiferencial): Promise<Buffer> {
  const mitad = 9020 / 2;
  const filasFicha: string[] = [];
  for (let i = 0; i < c.ficha.length; i += 2) {
    const par2 = c.ficha.slice(i, i + 2);
    while (par2.length < 2) par2.push(['', '']);
    filasFicha.push(`<w:tr>${par2.map(([k, v]) => celda(
      par(run(k.toLocaleUpperCase('es-AR'), { size: 15, color: GRIS, spacing: 10 }), { after: 0, align: 'left' }) +
      par(run(v, { size: 21, bold: true, color: '0F172A' }), { after: 40, align: 'left' }),
      mitad, 'F1F5F9')).join('')}</w:tr>`);
  }

  const body = [
    par(run('Provincia de Buenos Aires', { size: 16, bold: true, color: AZUL, caps: true, spacing: 20 }) +
        run('  ·  Ministerio de Salud', { size: 16, color: GRIS, caps: true, spacing: 20 }), { after: 0, align: 'left' }),
    par(run(`${c.datos.dependencia || 'H.I.G.A. Simplemente Evita'}  ·  González Catán, La Matanza`, { size: 16, color: GRIS, caps: true, spacing: 20 }), { after: 280, align: 'left' }),
    par(run('CERTIFICADO', { size: 40, bold: true, color: AZUL, spacing: 30 }), { after: 320, align: 'left', borderBottom: '2563EB' }),
    tabla([mitad, mitad], filasFicha, SIN_BORDES),
    par('', { after: 200 }),
    ...c.parrafos.map((t) => par(run(t))),
    par(run(c.cierre)),
    par(run(c.lugarFecha), { align: 'right', before: 200 }),
    par('', { after: 1400 }),
    `<w:p><w:pPr><w:ind w:left="5600"/><w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="334155"/></w:pBdr><w:jc w:val="center"/></w:pPr>${run('Firma y sello', { size: 18, color: GRIS })}</w:p>`,
  ].join('');

  return empaquetarDocx(body);
}
