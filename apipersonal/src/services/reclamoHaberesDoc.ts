// src/services/reclamoHaberesDoc.ts
// Formulario de Reclamo de Haberes por Cese del Agente (Redaccion → tarjeta 20).
// Plantilla: templates/reclamoHaberes.docx (marcadores {{CLAVE}} en las celdas).
//
// Solo se genera si el agente esta DE BAJA (ningun tramo ACTIVO en `agentes`)
// y tiene cargada la resolucion de cese con su PDF en RESOLUCIONES Y VARIOS
// (resoluciones.archivo_id → tblarchivos). La fecha de baja sale del ultimo
// tramo de `agentes` (fecha_egreso).

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { Sequelize, QueryTypes } from 'sequelize';
import { toYMD, ymdToDMY } from './certificadoLaboral';

/** Motivos de resolucion que son un cese. */
export const RE_MOTIVO_CESE = 'RENUNCIA|BAJA|CESE|CESANT|FALLEC|JUBILACION|RETIRO|ABANDONO|NO TOMA POSESION|EXONERA|LIMITA';

export const CAMPOS_RECLAMO = [
  'APELLIDO_NOMBRE', 'CUIL', 'LEGAJO', 'DOMICILIO', 'EMAIL', 'TELEFONO', 'CBU', 'REGISTRO',
  'LEY', 'ENCASILLAMIENTO', 'FECHA_BAJA', 'ACTO_CESE', 'ANTIGUEDAD',
  'DIAS_TRABAJADOS', 'SAC', 'LAD_ANT', 'LA_ANT', 'LA_CESE', 'LACD_ANT', 'LAC_ANT', 'LAC_CESE',
  'FIRMA', 'FECHA',
] as const;
export type CampoReclamo = typeof CAMPOS_RECLAMO[number];
export type CamposReclamo = Record<CampoReclamo, string>;

export interface ResolucionCese {
  id: number;
  numero: string;
  fecha: string;      // YYYY-MM-DD
  motivo: string;
  archivo_id: number;
}

export interface ReclamoHaberesDatos {
  dni: string;
  habilitado: boolean;
  motivosNoHabilitado: string[];
  fechaBaja: string;          // YYYY-MM-DD
  anioCese: number | null;
  resoluciones: ResolucionCese[];
  resolucionId: number | null;
  campos: CamposReclamo;
  avisos: string[];
}

const s = (v: unknown) => String(v ?? '').trim();

function antiguedadTexto(tramos: Array<{ desde: string; hasta: string }>): string {
  const iv = tramos
    .filter((t) => t.desde && t.hasta && t.desde <= t.hasta)
    .map((t) => [Date.parse(t.desde + 'T00:00:00Z'), Date.parse(t.hasta + 'T00:00:00Z')])
    .sort((a, b) => a[0] - b[0]);
  const DIA = 86400000;
  let dias = 0;
  let cur: number[] | null = null;
  for (const [a, b] of iv) {
    if (cur && a <= cur[1] + DIA) cur[1] = Math.max(cur[1], b);
    else { if (cur) dias += (cur[1] - cur[0]) / DIA + 1; cur = [a, b]; }
  }
  if (cur) dias += (cur[1] - cur[0]) / DIA + 1;
  if (!dias) return '';
  // Convencion administrativa: año de 365 dias, mes de 30.
  const anios = Math.floor(dias / 365);
  const meses = Math.floor((dias % 365) / 30);
  const d = Math.round((dias % 365) % 30);
  const p = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;
  return [p(anios, 'año', 'años'), p(meses, 'mes', 'meses'), p(d, 'día', 'días')].join(', ');
}

export async function datosReclamoHaberes(sequelize: Sequelize, dni: number): Promise<ReclamoHaberesDatos | null> {
  const [p] = await sequelize.query<any>(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.cuil, pd.legajo, pd.telefono, pd.email,
            pd.domicilio AS pd_domicilio, pd.localidad AS pd_localidad, pd.fecha_baja,
            p.domicilio, p.numerodomicilio, p.piso, p.depto, p.cp,
            p.cuil AS p_cuil, p.telefono AS p_telefono, p.email AS p_email,
            loc.localidad_nombre
       FROM personaldetalle pd
       LEFT JOIN personal p ON p.dni = pd.dni AND p.deleted_at IS NULL
       LEFT JOIN localidades loc ON loc.id = p.localidad_id AND loc.deleted_at IS NULL
      WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  if (!p) return null;

  const tramos = await sequelize.query<any>(
    `SELECT a.fecha_ingreso, a.fecha_egreso, a.estado_empleo, a.legajo,
            oc.nombre AS ocupacion, l.nombre AS ley, cat.nombre AS categoria
       FROM agentes a
       LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id
       LEFT JOIN ley l ON l.id = a.ley_id
       LEFT JOIN categorias cat ON cat.ID = a.categoria_id
      WHERE a.dni = :dni AND a.deleted_at IS NULL
      ORDER BY a.fecha_ingreso IS NULL, a.fecha_ingreso ASC, a.id ASC`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );

  const motivos: string[] = [];
  const avisos: string[] = [];

  // ── Baja ──
  const activo = tramos.some((t: any) => s(t.estado_empleo).toUpperCase() === 'ACTIVO');
  const ultimo = tramos[tramos.length - 1];
  if (!tramos.length) motivos.push('No tiene tramos cargados en Agentes.');
  else if (activo) motivos.push('El agente no está dado de baja (tiene un tramo ACTIVO).');
  const egresos = tramos.map((t: any) => toYMD(t.fecha_egreso)).filter(Boolean) as string[];
  const fechaBaja = toYMD(ultimo?.fecha_egreso) ?? egresos.sort().pop() ?? toYMD(p.fecha_baja) ?? '';
  if (!activo && tramos.length && !fechaBaja) motivos.push('No hay fecha de baja cargada en el último tramo.');
  const anioCese = fechaBaja ? Number(fechaBaja.slice(0, 4)) : null;

  // ── Resolucion de cese con PDF en RESOLUCIONES Y VARIOS ──
  const resos = await sequelize.query<any>(
    `SELECT r.id, r.numero, r.fecha, r.motivo, r.archivo_id
       FROM resoluciones r
       JOIN tblarchivos t ON t.id = r.archivo_id AND t.deleted_at IS NULL
      WHERE r.dni = :dni AND r.deleted_at IS NULL AND r.motivo RLIKE :re
      ORDER BY r.fecha DESC, r.id DESC`,
    { replacements: { dni, re: RE_MOTIVO_CESE }, type: QueryTypes.SELECT },
  );
  const resoluciones: ResolucionCese[] = resos.map((r: any) => ({
    id: Number(r.id), numero: s(r.numero), fecha: toYMD(r.fecha) ?? '', motivo: s(r.motivo), archivo_id: Number(r.archivo_id),
  }));
  if (!resoluciones.length) {
    const [sinPdf] = await sequelize.query<any>(
      `SELECT COUNT(*) n FROM resoluciones WHERE dni = :dni AND deleted_at IS NULL AND motivo RLIKE :re`,
      { replacements: { dni, re: RE_MOTIVO_CESE }, type: QueryTypes.SELECT },
    );
    motivos.push(Number(sinPdf?.n) > 0
      ? 'La resolución de cese está cargada pero sin el PDF en Resoluciones y Varios.'
      : 'No tiene cargada la resolución de cese (renuncia, baja, jubilación, etc.).');
  }
  // La resolucion mas cercana a la fecha de baja
  const elegida = fechaBaja && resoluciones.length
    ? [...resoluciones].sort((a, b) =>
        Math.abs(Date.parse(a.fecha || '1900-01-01') - Date.parse(fechaBaja)) -
        Math.abs(Date.parse(b.fecha || '1900-01-01') - Date.parse(fechaBaja)))[0]
    : resoluciones[0] ?? null;

  // ── Domicilio ──
  let domicilio = '';
  if (s(p.domicilio)) {
    domicilio = [s(p.domicilio), s(p.numerodomicilio)].filter(Boolean).join(' ');
    if (s(p.piso) && s(p.piso) !== '-') domicilio += ` Piso ${s(p.piso)}`;
    if (s(p.depto) && s(p.depto) !== '-') domicilio += ` Dto. ${s(p.depto)}`;
    const loc = s(p.localidad_nombre) || s(p.pd_localidad);
    if (loc) domicilio += `, ${loc}`;
    if (s(p.cp)) domicilio += ` (CP ${s(p.cp)})`;
  } else {
    domicilio = [s(p.pd_domicilio), s(p.pd_localidad)].filter(Boolean).join(', ');
  }

  // ── Cargo / ley del ultimo tramo ──
  const encas = [s(ultimo?.categoria), s(ultimo?.ocupacion)].filter(Boolean).join(' / ');
  const antig = antiguedadTexto(tramos.map((t: any) => ({
    desde: toYMD(t.fecha_ingreso) ?? '',
    hasta: toYMD(t.fecha_egreso) ?? (fechaBaja || ''),
  })));
  if (!antig) avisos.push('No se pudo calcular la antigüedad (faltan fechas de ingreso/egreso).');

  const cuil = s(p.cuil) || s(p.p_cuil);
  if (!cuil || /^1+$/.test(cuil)) avisos.push('El CUIL no está cargado: completalo a mano.');
  avisos.push('El CBU no está en la base: completalo a mano.');

  const diaBaja = fechaBaja ? Number(fechaBaja.slice(8, 10)) : 0;
  const mesAnioBaja = fechaBaja ? `${fechaBaja.slice(5, 7)}/${fechaBaja.slice(0, 4)}` : '';
  const hoy = new Date();

  const campos: CamposReclamo = {
    APELLIDO_NOMBRE: `${s(p.apellido)} ${s(p.nombre)}`.trim().toUpperCase(),
    CUIL: /^1+$/.test(cuil) ? '' : cuil,
    LEGAJO: s(p.legajo) || s(ultimo?.legajo),
    DOMICILIO: domicilio.toUpperCase(),
    EMAIL: s(p.email) || s(p.p_email),
    TELEFONO: s(p.telefono) || s(p.p_telefono),
    CBU: '',
    REGISTRO: '',
    LEY: s(ultimo?.ley),
    ENCASILLAMIENTO: encas,
    FECHA_BAJA: ymdToDMY(fechaBaja || null),
    ACTO_CESE: elegida
      ? `${elegida.numero}${elegida.fecha ? ` del ${ymdToDMY(elegida.fecha)}` : ''} – ${elegida.motivo}`
      : '',
    ANTIGUEDAD: antig,
    DIAS_TRABAJADOS: diaBaja ? `${diaBaja} ${diaBaja === 1 ? 'día' : 'días'} (${mesAnioBaja})` : '',
    SAC: anioCese ? `PROPORCIONAL ${anioCese}` : '',
    LAD_ANT: '',
    LA_ANT: '',
    LA_CESE: anioCese ? String(anioCese) : '',
    LACD_ANT: '',
    LAC_ANT: '',
    LAC_CESE: '',
    FIRMA: '',
    FECHA: `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`,
  };

  return {
    dni: String(p.dni ?? dni),
    habilitado: motivos.length === 0,
    motivosNoHabilitado: motivos,
    fechaBaja,
    anioCese,
    resoluciones,
    resolucionId: elegida?.id ?? null,
    campos,
    avisos,
  };
}

/** Datos de la base + lo que cargo el operador (solo claves conocidas). */
export async function armarReclamoHaberes(
  sequelize: Sequelize,
  dni: number,
  input: { campos?: Partial<Record<string, unknown>>; resolucionId?: number | null } = {},
): Promise<{ datos: ReclamoHaberesDatos; campos: CamposReclamo } | null> {
  const datos = await datosReclamoHaberes(sequelize, dni);
  if (!datos) return null;
  const campos = { ...datos.campos };
  if (input.resolucionId) {
    const r = datos.resoluciones.find((x) => x.id === Number(input.resolucionId));
    if (r) campos.ACTO_CESE = `${r.numero}${r.fecha ? ` del ${ymdToDMY(r.fecha)}` : ''} – ${r.motivo}`;
  }
  for (const k of CAMPOS_RECLAMO) {
    const v = input.campos?.[k];
    if (v !== undefined && v !== null) campos[k] = String(v).trim();
  }
  return { datos, campos };
}

function xmlEsc(v: string): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function templatePath(): string {
  const prod = path.join(process.cwd(), 'templates', 'reclamoHaberes.docx');
  const dev = path.join(process.cwd(), 'src', 'templates', 'reclamoHaberes.docx');
  return fs.existsSync(prod) ? prod : dev;
}

export async function renderReclamoHaberesDocx(campos: CamposReclamo): Promise<Buffer> {
  const tp = templatePath();
  if (!fs.existsSync(tp)) throw new Error('Plantilla reclamoHaberes.docx no encontrada');
  const zip = await JSZip.loadAsync(fs.readFileSync(tp));
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('Plantilla reclamoHaberes.docx inválida');
  let xml = await f.async('string');
  xml = xml.replace(/\{\{([A-Z_]+)\}\}/g, (_m, k: string) => xmlEsc((campos as any)[k] ?? ''));
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
