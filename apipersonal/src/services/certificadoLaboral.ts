// src/services/certificadoLaboral.ts
// Datos compartidos por los certificados laborales:
//   - finResidencia(): fecha de fin de la residencia de un agente residente.
//   - historialLaboral(): tramos de agentes (cargo/ley/planta) con su servicio.
//
// Fin de residencia (mismo criterio de corte que /residencias, RESIDENCIAS_CORTE_MMDD):
//   1) Residencia asignada en residentes_residencia → su duracion del catalogo.
//   2) Si no esta asignada, se deduce de la ocupacion ("RESIDENTE CIRUGIA 1" →
//      CIRUGIA GENERAL) contra el catalogo `residencias`.
//   3) Si no se puede deducir, NO se inventa una fecha (fin = null).
//   Jefe de residentes: la jefatura dura 1 ciclo desde que asumio.
//   fin = corte del (ciclo de inicio + anios). Ej: inicio 01/09/2026, 4 anios → 31/08/2030.

import { Sequelize, QueryTypes } from 'sequelize';
import { env } from '../config/env';

const JEFATURA_ANIOS = 1;

// Ocupacion → residencia del catalogo. Solo aplica a ocupaciones "RESIDENTE ...".
const ALIAS_OCUPACION: Array<[RegExp, string]> = [
  [/\bUTI\b|TERAPIA|CUIDADOS INTENSIVOS/, 'TERAPIA INTENSIVA'],
  [/CIRUGIA/, 'CIRUGIA GENERAL'],
  [/TRAUMATO/, 'TRAUMATOLOGIA'],
  [/CLINICA/, 'CLINICA MEDICA'],
  [/TOCOGINE/, 'TOCOGINECOLOGIA'],
  [/ANESTESI/, 'ANESTESIOLOGIA'],
  [/SERVICIO SOCIAL|TRABAJO SOCIAL/, 'TRABAJO SOCIAL'],
  [/FONOAUDIO/, 'FONOAUDIOLOGIA'],
  [/DERECHO/, 'DERECHO Y SALUD'],
  [/PRE ?RESIDENT/, 'PRE RESIDENTES'],
  [/NEONATO/, 'NEONATOLOGIA'],
  [/OBST/, 'OBSTETRICIA'],
  [/BIOQUIM/, 'BIOQUIMICA'],
  [/ENF?ERMERIA ESPE/, 'ENFERMERIA ESPECIALIZADA'],
  [/ENF?ERMERIA/, 'ENFERMERIA'],
];

export function normalizarTexto(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

function corteMMDD(): { mes: number; dia: number } {
  const raw = String((env as any).RESIDENCIAS_CORTE_MMDD || '08-31').trim();
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw);
  const mes = m ? Number(m[1]) : 8;
  const dia = m ? Number(m[2]) : 31;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return { mes: 8, dia: 31 };
  return { mes, dia };
}

function fechaLocal(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** YYYY-MM-DD en hora local (los DATE de mysql llegan como Date a medianoche local). */
export function toYMD(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const ymd = fechaLocal(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return ymd.startsWith('1111') ? null : ymd;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m || m[1] === '1111' || m[1] === '0000') return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function ymdToDMY(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function cicloDeInicio(ymd: string): number {
  const { mes, dia } = corteMMDD();
  const anio = Number(ymd.slice(0, 4));
  return ymd >= fechaLocal(anio, mes, dia) ? anio : anio - 1;
}

function fechaCorte(ciclo: number): string {
  const { mes, dia } = corteMMDD();
  return fechaLocal(ciclo, mes, dia);
}

function esOcupacionResidente(ocupacion: string): boolean {
  return /RESIDENT/.test(ocupacion);
}

function esOcupacionJefe(ocupacion: string): boolean {
  return /^JEFE/.test(ocupacion) && esOcupacionResidente(ocupacion);
}

export type OrigenResidencia = 'ASIGNADA' | 'OCUPACION' | 'JEFATURA' | null;

export interface FinResidencia {
  esResidente: boolean;
  residencia: string | null;
  anios: number | null;
  origen: OrigenResidencia;
  inicio: string | null;   // YYYY-MM-DD
  fin: string | null;      // YYYY-MM-DD
  finTxt: string;          // dd/mm/aaaa ('' si no se pudo calcular)
}

/** Deduce la residencia del catalogo a partir del nombre de la ocupacion. */
export function deducirResidencia(
  ocupacion: unknown,
  catalogo: Array<{ nombre: string; anios: number }>,
): { nombre: string; anios: number } | null {
  const oc = normalizarTexto(ocupacion);
  if (!esOcupacionResidente(oc)) return null;
  const porNombre = new Map(catalogo.map((r) => [normalizarTexto(r.nombre), r]));
  for (const [re, nombre] of ALIAS_OCUPACION) {
    if (re.test(oc) && porNombre.has(nombre)) return porNombre.get(nombre)!;
  }
  // Residencias agregadas al catalogo despues: por nombre contenido en la ocupacion.
  for (const [nombre, r] of porNombre) {
    if (oc.includes(nombre)) return r;
  }
  return null;
}

export async function finResidencia(sequelize: Sequelize, dni: number): Promise<FinResidencia> {
  const vacio: FinResidencia = {
    esResidente: false, residencia: null, anios: null, origen: null, inicio: null, fin: null, finTxt: '',
  };

  const tramos = await sequelize.query<any>(
    `SELECT a.id, a.fecha_ingreso, a.fecha_egreso, a.estado_empleo, a.ley_id, a.ocupacion_id,
            l.nombre AS ley_nombre, oc.nombre AS ocupacion_nombre
       FROM agentes a
       LEFT JOIN ley l ON l.id = a.ley_id
       LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id
      WHERE a.dni = :dni AND a.deleted_at IS NULL
      ORDER BY a.fecha_ingreso ASC, a.id ASC`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  if (!tramos.length) return vacio;

  const esTramoResidente = (t: any) =>
    Number(t.ley_id) === 11 || Number(t.ocupacion_id) === 132 ||
    /RESIDENT/.test(normalizarTexto(t.ley_nombre)) || esOcupacionResidente(normalizarTexto(t.ocupacion_nombre));

  const vigente =
    tramos.filter((t) => t.estado_empleo === 'ACTIVO' && !t.fecha_egreso).pop() ??
    tramos.filter((t) => t.estado_empleo === 'ACTIVO').pop() ??
    null;
  if (!vigente || !esTramoResidente(vigente)) return vacio;

  const [asig] = await sequelize.query<any>(
    `SELECT rr.fecha_inicio, rr.jefatura_desde, r.nombre, r.anios
       FROM residentes_residencia rr
       JOIN residencias r ON r.id = rr.residencia_id
      WHERE rr.dni = :dni
      LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );

  const ocVigente = normalizarTexto(vigente.ocupacion_nombre);
  const base: FinResidencia = { ...vacio, esResidente: true };

  // Jefe de residentes: 1 ciclo desde que asumio.
  const jefaturaDesde = toYMD(asig?.jefatura_desde) ?? (esOcupacionJefe(ocVigente) ? toYMD(vigente.fecha_ingreso) : null);
  if (jefaturaDesde) {
    const fin = fechaCorte(cicloDeInicio(jefaturaDesde) + JEFATURA_ANIOS);
    return {
      ...base,
      residencia: asig?.nombre ?? null,
      anios: JEFATURA_ANIOS,
      origen: 'JEFATURA',
      inicio: jefaturaDesde,
      fin,
      finTxt: ymdToDMY(fin),
    };
  }

  let residencia: { nombre: string; anios: number } | null = null;
  let origen: OrigenResidencia = null;
  if (asig?.nombre && asig?.anios != null) {
    residencia = { nombre: String(asig.nombre), anios: Number(asig.anios) };
    origen = 'ASIGNADA';
  } else {
    const catalogo = await sequelize.query<any>(
      `SELECT nombre, anios FROM residencias WHERE activa = 1 AND anios IS NOT NULL`,
      { type: QueryTypes.SELECT },
    );
    residencia = deducirResidencia(
      vigente.ocupacion_nombre,
      catalogo.map((c: any) => ({ nombre: String(c.nombre), anios: Number(c.anios) })),
    );
    if (residencia) origen = 'OCUPACION';
  }
  if (!residencia) return base;

  // Inicio: fecha_inicio asignada, o el primer tramo de residente (no jefe) del agente.
  const primerTramo = tramos.find(
    (t) => esTramoResidente(t) && !esOcupacionJefe(normalizarTexto(t.ocupacion_nombre)) && toYMD(t.fecha_ingreso),
  );
  const inicio = toYMD(asig?.fecha_inicio) ?? toYMD(primerTramo?.fecha_ingreso) ?? toYMD(vigente.fecha_ingreso);
  if (!inicio) return { ...base, residencia: residencia.nombre, anios: residencia.anios, origen };

  const fin = fechaCorte(cicloDeInicio(inicio) + residencia.anios);
  return {
    ...base,
    residencia: residencia.nombre,
    anios: residencia.anios,
    origen,
    inicio,
    fin,
    finTxt: ymdToDMY(fin),
  };
}

export interface TramoHistorial {
  desde: string | null;    // YYYY-MM-DD
  hasta: string | null;    // YYYY-MM-DD (null = continua)
  cargo: string;
  ley: string;
  planta: string;
  servicio: string;
  estado: string;
}

/**
 * Historial de cargo/ley/servicio: un renglon por tramo de `agentes`, con los
 * servicios de `agentes_servicios` que se superponen con ese tramo. Al tramo
 * vigente sin servicio superpuesto se le asigna el servicio vigente.
 */
export async function historialLaboral(sequelize: Sequelize, dni: number): Promise<TramoHistorial[]> {
  const tramos = await sequelize.query<any>(
    `SELECT a.id, a.fecha_ingreso, a.fecha_egreso, a.estado_empleo,
            oc.nombre AS cargo, l.nombre AS ley, pl.nombre AS planta
       FROM agentes a
       LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id
       LEFT JOIN ley l ON l.id = a.ley_id
       LEFT JOIN plantas pl ON pl.id = a.planta_id
      WHERE a.dni = :dni AND a.deleted_at IS NULL
      ORDER BY a.fecha_ingreso IS NULL, a.fecha_ingreso ASC, a.id ASC`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  const servicios = await sequelize.query<any>(
    `SELECT COALESCE(NULLIF(TRIM(s.nombre), ''), NULLIF(TRIM(ags.nombre), '')) AS nombre,
            ags.fecha_desde, ags.fecha_hasta
       FROM agentes_servicios ags
       LEFT JOIN servicios s ON s.id = ags.servicio_id
      WHERE ags.dni = :dni AND ags.deleted_at IS NULL
      ORDER BY ags.fecha_desde IS NULL, ags.fecha_desde ASC, ags.id ASC`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );

  const srv = servicios
    .filter((s: any) => s.nombre)
    .map((s: any) => ({ nombre: String(s.nombre).trim(), desde: toYMD(s.fecha_desde), hasta: toYMD(s.fecha_hasta) }));
  const srvVigente = srv.filter((s) => !s.hasta).pop()?.nombre ?? '';

  return tramos.map((t: any) => {
    const desde = toYMD(t.fecha_ingreso);
    const hasta = toYMD(t.fecha_egreso);
    const vigente = t.estado_empleo === 'ACTIVO' && !hasta;
    const nombres: string[] = [];
    for (const s of srv) {
      const empiezaAntesDelFin = !s.desde || !hasta || s.desde <= hasta;
      const terminaDespuesDelInicio = !s.hasta || !desde || s.hasta >= desde;
      if (empiezaAntesDelFin && terminaDespuesDelInicio && !nombres.includes(s.nombre)) nombres.push(s.nombre);
    }
    if (!nombres.length && vigente && srvVigente) nombres.push(srvVigente);
    return {
      desde,
      hasta: vigente ? null : hasta,
      cargo: String(t.cargo ?? '').trim(),
      ley: String(t.ley ?? '').trim(),
      planta: String(t.planta ?? '').trim(),
      servicio: nombres.join(' / '),
      estado: String(t.estado_empleo ?? ''),
    };
  });
}
