/**
 * @file routes/jubilacion.routes.ts
 * Rutas del módulo Jubilación IPS.
 *
 * Endpoints:
 *   GET  /jubilacion/agente-datos/:dni
 *   GET  /jubilacion/agente/:dni
 *   POST /jubilacion/calcular
 *   POST /jubilacion/parse-anses-pdf
 *   POST /jubilacion/guardar
 *   PUT  /jubilacion/:id
 *   DELETE /jubilacion/:id
 *   GET/POST/PATCH/DELETE /jubilacion/posibles
 *   PUT  /jubilacion/posibles/:id/checklist
 *   POST /jubilacion/posibles/:id/alerta-ok
 *   GET  /jubilacion/alerta-carga
 *   GET/PUT /jubilacion/anses/:dni
 *   GET  /jubilacion/proyeccion
 *   GET  /jubilacion/proyeccion/estructura
 *   GET  /jubilacion/cortes
 *   GET/POST/PATCH/DELETE /jubilacion/citas
 *   POST /jubilacion/citas/:id/promover
 */

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes }      from 'sequelize';
import { z }                          from 'zod';
import multer                         from 'multer';
import fs                             from 'fs';
import os                             from 'os';
import path                           from 'path';
import { can, requireAny }            from '../middlewares/rbacCrud';
import { env }                        from '../config/env';
import { logger }                     from '../logging/logger';
import { leerListadoANSES }           from '../services/ansesPdf.service';
import {
  ITEMS_CHECKLIST, periodoVigente, alertaVencida, itemsFaltantes, fechaLocalISO,
  corteVigente, corteSugerido, opcionesCorte, corteEsPosteriorAlVigente,
  type MesCorte,
} from '../services/jubilacionCarga.service';

// ── RBAC ──────────────────────────────────────────────────────────────────────
function rbac(table: string, action: 'read' | 'create' | 'update' | 'delete') {
  return (req: Request, res: Response, next: any) => {
    if (!env.RBAC_ENABLE || !env.AUTH_ENABLE) return next();
    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (!can(auth.permissions || [], table, action))
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    return next();
  };
}

// ── Zod schemas ───────────────────────────────────────────────────────────────
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido');
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato HH:MM requerido');

// 'HH:MM' → 'HH:MM:00' (MySQL TIME)
const normHora = (h: string) => (h.length === 5 ? `${h}:00` : h);

const servicioANSESSchema = z.object({
  fecha_desde:  dateStr,
  fecha_hasta:  dateStr,
  es_insalubre: z.boolean(),
});

const servicioExternoSchema = z.object({
  organismo:    z.string().min(1).max(200),
  fecha_desde:  dateStr,
  fecha_hasta:  dateStr,
  es_insalubre: z.boolean(),
  // 'IPS' = municipio / ministerio provincial (aporta a IPS, se integra a la caja IPS).
  // 'EXTERNA' = otra provincia / caja profesional (compite en superposiciones).
  caja:         z.enum(['IPS', 'EXTERNA']).optional().default('IPS'),
});

const calculoSchema = z.object({
  dni:                     z.number().int().positive(),
  situacion_revista:       z.enum(['NORMAL', 'BECADO', 'RESIDENTE', 'CONCURRENTE', 'ARTICULO_48']),
  beca_aporto:             z.boolean().optional().default(false),
  ips_aporto:              z.boolean().optional(),
  es_insalubre_ips:        z.boolean(),
  diferencial_2pct_pagado: z.boolean(),
  // Fecha a la que se para el cálculo. Vacío = hoy.
  fecha_calculo:           dateStr.optional().nullable(),
  servicios_anses:         z.array(servicioANSESSchema).max(20).default([]),
  servicios_externos:      z.array(servicioExternoSchema).max(20).default([]),
  resoluciones_manuales:   z.record(z.string()).optional().default({}),
  observaciones:           z.string().max(2000).optional().nullable(),
});

// ── Helpers de fecha (sin timezone) ──────────────────────────────────────────

function today(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const parts = String(s).split('T')[0].split('-').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// Las planillas viejas usan 01/11/1111 (y variantes) como centinela de "no se
// sabe". Tomarlas como fecha real haría, por ejemplo, que un agente figure
// nombrado desde el año 1111 y aparezca con 900 años de servicio.
function fechaLegajo(v: any): string | null {
  if (!v) return null;
  const d = parseDate(String(v));
  return d && d.getFullYear() >= 1900 ? String(v).split('T')[0] : null;
}

// Fecha local a ISO (YYYY-MM-DD) sin pasar por UTC.
function fechaISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDias(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Las fechas de baja de los certificados son INCLUSIVAS: del 01/04/1982 al
// 31/12/1982 son 9 meses justos, no 9 meses menos un día. Internamente los
// tramos se manejan medio abiertos [desde, hasta) — así las uniones e
// intersecciones son directas — así que el fin inclusivo se convierte al
// borde exclusivo sumándole un día.
function finExclusivo(hastaInclusive: Date): Date {
  return addDias(hastaInclusive, 1);
}

function diffFechas(desde: Date, hasta: Date): { anios: number; meses: number; dias: number } {
  let anios = hasta.getFullYear() - desde.getFullYear();
  let meses = hasta.getMonth()    - desde.getMonth();
  let dias  = hasta.getDate()     - desde.getDate();
  if (dias  < 0) { meses--; dias  += new Date(hasta.getFullYear(), hasta.getMonth(), 0).getDate(); }
  if (meses < 0) { anios--; meses += 12; }
  return { anios: Math.max(0, anios), meses: Math.max(0, meses), dias: Math.max(0, dias) };
}

function calDias(desde: Date, hasta: Date): number {
  return Math.round((hasta.getTime() - desde.getTime()) / 86400000);
}

function intersectDias(a: { desde: Date; hasta: Date }, b: { desde: Date; hasta: Date }): number {
  const s = a.desde > b.desde ? a.desde : b.desde;
  const e = a.hasta < b.hasta ? a.hasta : b.hasta;
  return s < e ? calDias(s, e) : 0;
}

function intersectRange(
  a: { desde: Date; hasta: Date },
  b: { desde: Date; hasta: Date },
): { desde: Date; hasta: Date } | null {
  const s = a.desde > b.desde ? a.desde : b.desde;
  const e = a.hasta < b.hasta ? a.hasta : b.hasta;
  return s < e ? { desde: s, hasta: e } : null;
}

// Parte una lista de tramos en sub-tramos disjuntos (barrido por los bordes).
// Cada sub-tramo devuelve qué tramos originales lo cubren, para poder resolver
// tipo e insalubridad del pedazo compartido sin contar el tiempo dos veces.
function segmentar<T extends { desde: Date; hasta: Date }>(
  items: T[],
): Array<{ desde: Date; hasta: Date; cubren: T[] }> {
  const puntos = Array.from(
    new Set(items.flatMap(i => [i.desde.getTime(), i.hasta.getTime()])),
  ).sort((a, b) => a - b);

  const out: Array<{ desde: Date; hasta: Date; cubren: T[] }> = [];
  for (let k = 0; k < puntos.length - 1; k++) {
    const ini = puntos[k];
    const fin = puntos[k + 1];
    const cubren = items.filter(i => i.desde.getTime() <= ini && i.hasta.getTime() >= fin);
    if (cubren.length) out.push({ desde: new Date(ini), hasta: new Date(fin), cubren });
  }
  return out;
}

// Une tramos de UNA MISMA caja: el tiempo pisado se cuenta una sola vez
// (ene-abr + feb-may = ene-may, no ocho meses) y, si alguno de los tramos que
// cubren el pedazo compartido es insalubre, ese pedazo queda insalubre.
// No hay ganador ni perdedor: dentro de la misma caja no hay superposición.
function unirMismaCaja<T extends { desde: Date; hasta: Date; es_insalubre: boolean }>(
  items: T[],
): Array<{ desde: Date; hasta: Date; es_insalubre: boolean }> {
  const out: Array<{ desde: Date; hasta: Date; es_insalubre: boolean }> = [];
  for (const s of segmentar(items)) {
    const es_insalubre = s.cubren.some(c => c.es_insalubre);
    const last = out[out.length - 1];
    // Fusiona sub-tramos contiguos con la misma marca para no fragmentar el listado.
    if (last && last.es_insalubre === es_insalubre && last.hasta.getTime() === s.desde.getTime()) {
      last.hasta = s.hasta;
    } else {
      out.push({ desde: s.desde, hasta: s.hasta, es_insalubre });
    }
  }
  return out;
}

function toDias(p: { anios: number; meses: number; dias: number }) {
  return p.anios * 365 + p.meses * 30 + p.dias;
}

function fromDias(d: number): { anios: number; meses: number; dias: number } {
  const anios = Math.floor(d / 365);
  const rem   = d - anios * 365;
  const meses = Math.floor(rem / 30);
  return { anios, meses, dias: rem - meses * 30 };
}

function sumPeriodos(ps: { anios: number; meses: number; dias: number }[]) {
  return fromDias(ps.reduce((acc, p) => acc + toDias(p), 0));
}

type Periodo = { anios: number; meses: number; dias: number };

const PRORRATEO_ANIOS: Record<number, Periodo> = {
  1: { anios: 1, meses: 4, dias: 24 },
  2: { anios: 2, meses: 9, dias: 18 },
  3: { anios: 4, meses: 2, dias: 12 },
  4: { anios: 5, meses: 7, dias: 6 },
  5: { anios: 7, meses: 0, dias: 0 },
  6: { anios: 8, meses: 4, dias: 24 },
  7: { anios: 9, meses: 9, dias: 18 },
  8: { anios: 11, meses: 2, dias: 12 },
  9: { anios: 12, meses: 7, dias: 6 },
  10: { anios: 14, meses: 0, dias: 0 },
  11: { anios: 15, meses: 4, dias: 24 },
  12: { anios: 16, meses: 9, dias: 18 },
  13: { anios: 18, meses: 2, dias: 12 },
  14: { anios: 19, meses: 7, dias: 6 },
  15: { anios: 21, meses: 0, dias: 0 },
  16: { anios: 22, meses: 4, dias: 24 },
  17: { anios: 23, meses: 9, dias: 18 },
  18: { anios: 25, meses: 2, dias: 12 },
  19: { anios: 26, meses: 7, dias: 6 },
  20: { anios: 28, meses: 0, dias: 0 },
  21: { anios: 29, meses: 4, dias: 24 },
  22: { anios: 30, meses: 9, dias: 18 },
  23: { anios: 32, meses: 2, dias: 12 },
  24: { anios: 33, meses: 7, dias: 6 },
  25: { anios: 35, meses: 0, dias: 0 },
};

const PRORRATEO_MESES: Record<number, Periodo> = {
  1: { anios: 0, meses: 1, dias: 12 },
  2: { anios: 0, meses: 2, dias: 24 },
  3: { anios: 0, meses: 4, dias: 6 },
  4: { anios: 0, meses: 5, dias: 18 },
  5: { anios: 0, meses: 7, dias: 0 },
  6: { anios: 0, meses: 8, dias: 12 },
  7: { anios: 0, meses: 9, dias: 24 },
  8: { anios: 0, meses: 11, dias: 6 },
  9: { anios: 1, meses: 0, dias: 18 },
  10: { anios: 1, meses: 2, dias: 0 },
  11: { anios: 1, meses: 3, dias: 12 },
  12: { anios: 1, meses: 4, dias: 24 },
};

const PRORRATEO_DIAS: Record<number, number> = {
  1: 1.2, 2: 2.8, 3: 4.2, 4: 5, 5: 7.6, 6: 8.4, 7: 9.8, 8: 11.2, 9: 12.6, 10: 14,
  11: 15.4, 12: 16.8, 13: 18.2, 14: 19.6, 15: 21, 16: 22.4, 17: 23.8, 18: 25.2,
  19: 26.6, 20: 28.2, 21: 29.4, 22: 30.8, 23: 32.2, 24: 33.5, 25: 35, 26: 36.4,
  27: 37.8, 28: 39.2, 29: 40.6, 30: 42,
};

function aplicarProrrateo(p: { anios: number; meses: number; dias: number }) {
  const partes: Periodo[] = [];
  const anios = Math.max(0, Math.floor(p.anios));
  const meses = Math.max(0, Math.floor(p.meses));
  const dias  = Math.max(0, Math.round(p.dias));

  for (let y = 0; y < anios; y += 25) {
    const tramo = Math.min(25, anios - y);
    if (PRORRATEO_ANIOS[tramo]) partes.push(PRORRATEO_ANIOS[tramo]);
  }
  if (meses > 0 && PRORRATEO_MESES[meses]) partes.push(PRORRATEO_MESES[meses]);
  if (dias > 0 && PRORRATEO_DIAS[dias] !== undefined) partes.push({ anios: 0, meses: 0, dias: PRORRATEO_DIAS[dias] });

  return fromDias(Math.round(partes.reduce((acc, x) => acc + toDias(x), 0)));
}

const FECHA_CORTE = new Date(2015, 5, 1); // 2015-06-01

const REQ_ORDINARIA = { edadDias: 60 * 365, servicioDias: 35 * 365 };
const REQ_INSALUBRE = { edadDias: 50 * 365, servicioDias: 25 * 365 };

function defaultIpsAporto(situacion: string, value?: boolean) {
  if (value !== undefined) return value;
  return !['RESIDENTE', 'CONCURRENTE', 'ARTICULO_48'].includes(situacion);
}

// ── Motor de cálculo ──────────────────────────────────────────────────────────

interface ServicioFechado {
  id:           string;
  label:        string;
  organismo?:   string;
  // Caja a la que pertenece el tramo ('ANSES' o 'EXT:<organismo>'). Dos tramos
  // de la misma caja no compiten: ya vienen unidos.
  caja:         string;
  desde:        Date;
  hasta:        Date;
  es_insalubre: boolean;
}

interface CalculoInput {
  fecha_nacimiento:        string | null;
  fecha_ingreso_ips:       string | null;
  fecha_nombramiento_ips:  string | null;
  situacion_revista:       string;
  beca_aporto:             boolean;
  ips_aporto:              boolean;
  es_insalubre_ips:        boolean;
  diferencial_2pct_pagado: boolean;
  fecha_calculo?:          string | null;
  servicios_anses:         Array<{ fecha_desde: string; fecha_hasta: string; es_insalubre: boolean }>;
  servicios_externos:      Array<{ organismo: string; fecha_desde: string; fecha_hasta: string; es_insalubre: boolean; caja?: 'IPS' | 'EXTERNA' }>;
  resoluciones_manuales:   Record<string, string>;
}

function calcular(input: CalculoInput) {
  // Todo el cálculo se para en esta fecha: la edad, el cierre del tramo de
  // nombrado y el recorte de los servicios cargados. Vacío = hoy.
  const hoy         = parseDate(input.fecha_calculo) ?? today();
  // Borde exclusivo del día de cálculo: ese día también computa.
  const hoyFin      = finExclusivo(hoy);
  const fechaNac    = parseDate(input.fecha_nacimiento);
  const fechaIngreso = parseDate(input.fecha_ingreso_ips);
  const fechaNom    = parseDate(input.fecha_nombramiento_ips);

  const edad     = fechaNac ? diffFechas(fechaNac, hoy) : null;
  const edadDias = edad ? toDias(edad) : 0;

  // ── Beca y sin aportes ───────────────────────────────────────────────────────
  const tieneBeca = !!(fechaIngreso && fechaNom && fechaIngreso < fechaNom);
  const requierePreguntaAportes =
    input.situacion_revista === 'RESIDENTE' ||
    input.situacion_revista === 'CONCURRENTE' ||
    input.situacion_revista === 'ARTICULO_48';
  const sinAportes =
    (requierePreguntaAportes && !input.ips_aporto) ||
    (input.situacion_revista === 'BECADO' && !input.beca_aporto && !fechaNom);

  const esInsalubreEfectivo = input.es_insalubre_ips || input.diferencial_2pct_pagado;

  // ── Rangos IPS ───────────────────────────────────────────────────────────────
  type Rango = { desde: Date; hasta: Date };

  // Recorta un tramo a la fecha de cálculo: lo posterior todavía no ocurrió.
  const recortar = (r: Rango): Rango | null =>
    r.desde >= hoyFin ? null : { desde: r.desde, hasta: r.hasta > hoyFin ? hoyFin : r.hasta };

  const ipsBecaRange: Rango | null =
    (tieneBeca && input.beca_aporto)
      ? recortar({ desde: fechaIngreso!, hasta: fechaNom! })
      : null;

  const fechaInicioNombrado = fechaNom ?? fechaIngreso;
  const ipsNombRange: Rango | null =
    (!sinAportes && fechaInicioNombrado && fechaInicioNombrado <= hoy)
      ? { desde: fechaInicioNombrado, hasta: hoyFin }
      : null;

  // Sub-rangos nombrado respecto de FECHA_CORTE
  let ipsNombAntes15Range: Rango | null = null;
  let ipsNombDesde15Range: Rango | null = null;
  if (ipsNombRange) {
    if (ipsNombRange.desde < FECHA_CORTE) {
      ipsNombAntes15Range = {
        desde: ipsNombRange.desde,
        hasta: ipsNombRange.hasta < FECHA_CORTE ? ipsNombRange.hasta : FECHA_CORTE,
      };
    }
    if (ipsNombRange.hasta > FECHA_CORTE) {
      ipsNombDesde15Range = {
        desde: ipsNombRange.desde > FECHA_CORTE ? ipsNombRange.desde : FECHA_CORTE,
        hasta: ipsNombRange.hasta,
      };
    }
  }

  // ── Servicios IPS-extra (municipio / ministerio provincial → misma caja IPS) ──
  // Aportan a IPS: son la misma caja, así que se unen con beca/nombrado en vez
  // de competir contra ellos. El tiempo pisado se cuenta una sola vez.
  const ipsExtrasRaw = input.servicios_externos
    .filter(e => (e.caja ?? 'IPS') === 'IPS')
    .map(e => {
      const desde = parseDate(e.fecha_desde);
      const hasta = parseDate(e.fecha_hasta);
      const r     = desde && hasta && desde <= hasta ? recortar({ desde, hasta: finExclusivo(hasta) }) : null;
      return r ? { label: e.organismo, desde: r.desde, hasta: r.hasta, es_insalubre: e.es_insalubre } : null;
    })
    .filter(Boolean) as Array<{ label: string; desde: Date; hasta: Date; es_insalubre: boolean }>;

  // ── Unión interna de la caja IPS ─────────────────────────────────────────────
  // Todos los tramos que aportan a IPS (beca, nombrado partido por FECHA_CORTE y
  // municipios/ministerios) se parten en sub-tramos disjuntos. El `tipo` lo define
  // el tramo base que lo cubre (beca/antes15/desde15 nunca se pisan entre sí) y la
  // insalubridad la gana cualquier tramo insalubre que lo cubra.
  type IpsFuente = {
    desde: Date; hasta: Date; es_insalubre: boolean;
    tipo: 'beca' | 'antes15' | 'desde15' | 'extra';
    label: string;
  };
  const ipsFuentes: IpsFuente[] = [];
  if (ipsBecaRange)        ipsFuentes.push({ ...ipsBecaRange,        es_insalubre: true,                 tipo: 'beca',    label: 'Beca' });
  if (ipsNombAntes15Range) ipsFuentes.push({ ...ipsNombAntes15Range, es_insalubre: esInsalubreEfectivo,  tipo: 'antes15', label: 'Nombrado antes 2015' });
  if (ipsNombDesde15Range) ipsFuentes.push({ ...ipsNombDesde15Range, es_insalubre: true,                 tipo: 'desde15', label: 'Nombrado desde 2015' });
  for (const ex of ipsExtrasRaw) {
    ipsFuentes.push({ desde: ex.desde, hasta: ex.hasta, es_insalubre: ex.es_insalubre, tipo: 'extra', label: ex.label });
  }

  type IpsSubRango = {
    id: string; rango: Rango;
    tipo: 'beca' | 'antes15' | 'desde15' | 'extra';
    label: string; es_insalubre: boolean; perdidoCal: number;
  };
  const ipsSubRangos: IpsSubRango[] = segmentar(ipsFuentes).map((s, i) => {
    const base   = s.cubren.find(c => c.tipo !== 'extra');
    const duenio = base ?? s.cubren[0];
    return {
      id: `IPS_${i}`,
      rango: { desde: s.desde, hasta: s.hasta },
      tipo: duenio.tipo,
      label: duenio.label,
      es_insalubre: s.cubren.some(c => c.es_insalubre),
      perdidoCal: 0,
    };
  });

  const ipsExtraBrutoDias = ipsSubRangos
    .filter(s => s.tipo === 'extra')
    .reduce((acc, s) => acc + calDias(s.rango.desde, s.rango.hasta), 0);

  // ── Servicios externos reales (ANSES + otras cajas) ──────────────────────────
  // Solo compiten cajas distintas. Los municipios/ministerios provinciales ya
  // fueron absorbidos por IPS arriba, y las líneas de una misma caja externa se
  // unen entre sí (no se pelean por el tramo pisado).
  const fmtISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const ansesLineas = input.servicios_anses
    .map(a => {
      const desde = parseDate(a.fecha_desde);
      const hasta = parseDate(a.fecha_hasta);
      const r     = desde && hasta && desde <= hasta ? recortar({ desde, hasta: finExclusivo(hasta) }) : null;
      return r ? { desde: r.desde, hasta: r.hasta, es_insalubre: a.es_insalubre } : null;
    })
    .filter(Boolean) as Array<{ desde: Date; hasta: Date; es_insalubre: boolean }>;

  const ansesTramos: ServicioFechado[] = unirMismaCaja(ansesLineas).map((t, i) => ({
    id: `ANSES_${i}`,
    label: `ANSES (${fmtISO(t.desde)} → ${fmtISO(t.hasta)})`,
    caja: 'ANSES',
    desde: t.desde,
    hasta: t.hasta,
    es_insalubre: t.es_insalubre,
  }));

  // Cada organismo externo es una caja: se unen sus propias líneas, y recién
  // organismos distintos compiten entre sí.
  const externosReales = input.servicios_externos.filter(e => (e.caja ?? 'IPS') === 'EXTERNA');
  const porOrganismo = new Map<string, { organismo: string; lineas: Array<{ desde: Date; hasta: Date; es_insalubre: boolean }> }>();
  for (const e of externosReales) {
    const desde = parseDate(e.fecha_desde);
    const hasta = parseDate(e.fecha_hasta);
    const r     = desde && hasta && desde <= hasta ? recortar({ desde, hasta: finExclusivo(hasta) }) : null;
    if (!r) continue;
    const clave = e.organismo.trim().toLowerCase();
    if (!porOrganismo.has(clave)) porOrganismo.set(clave, { organismo: e.organismo, lineas: [] });
    porOrganismo.get(clave)!.lineas.push({ desde: r.desde, hasta: r.hasta, es_insalubre: e.es_insalubre });
  }

  const extTramos: ServicioFechado[] = [];
  let extSeq = 0;
  for (const [clave, grupo] of porOrganismo) {
    for (const t of unirMismaCaja(grupo.lineas)) {
      extTramos.push({
        id: `EXT_${extSeq++}`,
        label: grupo.organismo,
        organismo: grupo.organismo,
        caja: `EXT:${clave}`,
        desde: t.desde,
        hasta: t.hasta,
        es_insalubre: t.es_insalubre,
      });
    }
  }

  const todosExternos: ServicioFechado[] = [...ansesTramos, ...extTramos];

  // ── Prorateado total de cada caja (para criterio ganador) ────────────────────
  // Ambas cajas se miden ya unidas: el tiempo pisado dentro de una misma caja
  // cuenta una sola vez, así que el bruto no queda inflado por líneas repetidas.
  const ipsBrutoDias = ipsSubRangos.reduce((acc, s) => acc + calDias(s.rango.desde, s.rango.hasta), 0);
  const ansesBrutoDias = todosExternos
    .filter(s => s.caja === 'ANSES')
    .reduce((acc, s) => acc + calDias(s.desde, s.hasta), 0);
  const cajaJubilatoria: 'IPS' | 'ANSES' =
    ansesBrutoDias > ipsBrutoDias ? 'ANSES' : 'IPS';

  function ipsProrDiasTotal(): number {
    let ins = 0;
    let com = 0;
    for (const s of ipsSubRangos) {
      const d = calDias(s.rango.desde, s.rango.hasta);
      if (s.es_insalubre) ins += d; else com += d;
    }
    return toDias(aplicarProrrateo(fromDias(ins))) + com;
  }

  function extProrDiasTotal(s: ServicioFechado): number {
    const d = calDias(s.desde, s.hasta);
    return s.es_insalubre ? toDias(aplicarProrrateo(fromDias(d))) : d;
  }

  const ipsProrTotal = ipsProrDiasTotal();

  // ── Resolución de superposiciones ────────────────────────────────────────────
  type SupResult = {
    organismo: string;
    ganador:   string | null;
    motivo:    string;
    empate:    boolean;
    // Ids de los dos contendientes y la clave de resolución manual, para que el
    // front no tenga que deducirlos del texto de `organismo`.
    key:    string;
    id_a:   string; label_a: string;
    id_b:   string; label_b: string;
    anios: number; meses: number; dias: number;
  };

  const superpuestos: SupResult[] = [];

  // Días perdidos por cada externo
  const extPerdidoCal: Record<string, number> = {};
  for (const s of todosExternos) extPerdidoCal[s.id] = 0;

  function resolverGanador(
    aId: string, aLabel: string, aPror: number,
    bId: string, bLabel: string, bPror: number,
    key: string,
  ): { ganadorId: string | null; ganadorLabel: string | null; motivo: string; empate: boolean } {
    if (aId === 'IPS' && bId.startsWith('ANSES_')) {
      if (ipsBrutoDias > ansesBrutoDias) return {
        ganadorId: aId, ganadorLabel: aLabel,
        motivo: `IPS mayor aporte bruto (${(ipsBrutoDias / 365).toFixed(1)}a vs ${(ansesBrutoDias / 365).toFixed(1)}a ANSES)`,
        empate: false,
      };
      if (ansesBrutoDias > ipsBrutoDias) return {
        ganadorId: bId, ganadorLabel: bLabel,
        motivo: `ANSES mayor aporte bruto (${(ansesBrutoDias / 365).toFixed(1)}a vs ${(ipsBrutoDias / 365).toFixed(1)}a IPS)`,
        empate: false,
      };
    }
    if (aPror > bPror) return {
      ganadorId: aId, ganadorLabel: aLabel,
      motivo:  `${aLabel} mayor servicio prorateado (${(aPror/365).toFixed(1)}a vs ${(bPror/365).toFixed(1)}a)`,
      empate: false,
    };
    if (bPror > aPror) return {
      ganadorId: bId, ganadorLabel: bLabel,
      motivo:  `${bLabel} mayor servicio prorateado (${(bPror/365).toFixed(1)}a vs ${(aPror/365).toFixed(1)}a)`,
      empate: false,
    };
    // Empate
    const manual = (input.resoluciones_manuales ?? {})[key];
    if (manual) {
      const label = manual === aId ? aLabel : bLabel;
      return { ganadorId: manual, ganadorLabel: label, motivo: 'Resolución manual', empate: false };
    }
    return { ganadorId: null, ganadorLabel: null, motivo: 'Empate en servicio prorateado — selección manual requerida', empate: true };
  }

  function distribuirPerdidaIPS(extRango: Rango, diasPerdidos: number) {
    // Distribuye los días perdidos por IPS entre sus sub-tramos
    // según cuánto de cada sub-tramo se intersecta con extRango
    let restante = diasPerdidos;
    for (const sub of ipsSubRangos) {
      const overlap = intersectRange(sub.rango, extRango);
      if (!overlap) continue;
      const d = Math.min(restante, calDias(overlap.desde, overlap.hasta));
      sub.perdidoCal += d;
      restante -= d;
      if (restante <= 0) break;
    }
  }

  // ── IPS vs cada externo ──────────────────────────────────────────────────────
  for (const ext of todosExternos) {
    let overlapCal = 0;
    for (const { rango } of ipsSubRangos) overlapCal += intersectDias(rango, ext);
    if (overlapCal === 0) continue;

    const key = `IPS|${ext.id}`;
    const { ganadorId, ganadorLabel, motivo, empate } = resolverGanador(
      'IPS', 'IPS', ipsProrTotal,
      ext.id, ext.label, extProrDiasTotal(ext),
      key,
    );

    superpuestos.push({
      organismo: `IPS ↔ ${ext.label}`,
      ganador: ganadorId === 'IPS' ? 'IPS' : ganadorLabel,
      motivo, empate,
      key, id_a: 'IPS', label_a: 'IPS', id_b: ext.id, label_b: ext.label,
      ...fromDias(overlapCal),
    });

    if (!empate) {
      if (ganadorId === 'IPS') {
        extPerdidoCal[ext.id] = Math.min(calDias(ext.desde, ext.hasta), extPerdidoCal[ext.id] + overlapCal);
      } else {
        distribuirPerdidaIPS(ext, overlapCal);
      }
    }
  }

  // ── Externo vs externo ───────────────────────────────────────────────────────
  // Solo entre cajas distintas: dos tramos de la misma caja ya vinieron unidos
  // y no se pisan, así que no hay ganador ni perdedor que resolver.
  for (let i = 0; i < todosExternos.length; i++) {
    for (let j = i + 1; j < todosExternos.length; j++) {
      const a = todosExternos[i];
      const b = todosExternos[j];
      if (a.caja === b.caja) continue;
      const overlapCal = intersectDias(a, b);
      if (overlapCal === 0) continue;

      const key = `${a.id}|${b.id}`;
      const { ganadorId, ganadorLabel, motivo, empate } = resolverGanador(
        a.id, a.label, extProrDiasTotal(a),
        b.id, b.label, extProrDiasTotal(b),
        key,
      );

      superpuestos.push({
        organismo: `${a.label} ↔ ${b.label}`,
        ganador: ganadorId === a.id ? a.label : ganadorLabel,
        motivo, empate,
        key, id_a: a.id, label_a: a.label, id_b: b.id, label_b: b.label,
        ...fromDias(overlapCal),
      });

      if (!empate) {
        if (ganadorId === a.id) extPerdidoCal[b.id] = Math.min(calDias(b.desde, b.hasta), extPerdidoCal[b.id] + overlapCal);
        else                    extPerdidoCal[a.id] = Math.min(calDias(a.desde, a.hasta), extPerdidoCal[a.id] + overlapCal);
      }
    }
  }

  // ── Acumulación insalubre / común ────────────────────────────────────────────
  // Cada sub-tramo de IPS aporta sus días sobrevivientes según su propia marca,
  // que ya resolvió la unión (si algo insalubre lo cubría, va como insalubre).
  const insalubrePeriodos: { anios: number; meses: number; dias: number }[] = [];
  const comunPeriodos:     { anios: number; meses: number; dias: number }[] = [];

  // Desglose por caja: los mismos días sobrevivientes, agrupados por de dónde
  // vienen. Suma exactamente los totales generales.
  const desglose = new Map<string, { label: string; insDias: number; comDias: number }>();
  const acumular = (caja: string, label: string, dias: number, insalubre: boolean) => {
    if (dias <= 0) return;
    if (!desglose.has(caja)) desglose.set(caja, { label, insDias: 0, comDias: 0 });
    const d = desglose.get(caja)!;
    if (insalubre) d.insDias += dias; else d.comDias += dias;
  };

  let ipsSurvTotal = 0;
  for (const sub of ipsSubRangos) {
    const surv = Math.max(0, calDias(sub.rango.desde, sub.rango.hasta) - sub.perdidoCal);
    if (surv <= 0) continue;
    ipsSurvTotal += surv;
    (sub.es_insalubre ? insalubrePeriodos : comunPeriodos).push(fromDias(surv));
    acumular('IPS', 'IPS', surv, sub.es_insalubre);
  }

  for (const ext of todosExternos) {
    const surv = Math.max(0, calDias(ext.desde, ext.hasta) - extPerdidoCal[ext.id]);
    if (surv <= 0) continue;
    (ext.es_insalubre ? insalubrePeriodos : comunPeriodos).push(fromDias(surv));
    acumular(ext.caja, ext.caja === 'ANSES' ? 'ANSES' : (ext.organismo ?? ext.label), surv, ext.es_insalubre);
  }

  // Orden fijo para la vista: IPS, ANSES y después los organismos externos.
  const ordenCaja = (c: string) => (c === 'IPS' ? 0 : c === 'ANSES' ? 1 : 2);
  const desgloseCajas = Array.from(desglose.entries())
    .sort((a, b) => ordenCaja(a[0]) - ordenCaja(b[0]) || a[1].label.localeCompare(b[1].label))
    .map(([caja, d]) => ({
      caja,
      label:     d.label,
      insalubre: fromDias(d.insDias),
      comun:     fromDias(d.comDias),
      total:     fromDias(d.insDias + d.comDias),
    }));

  const totalInsalubre            = sumPeriodos(insalubrePeriodos);
  const totalInsalubreProrateado  = aplicarProrrateo(totalInsalubre);
  const totalComun                = sumPeriodos(comunPeriodos);
  const totalProrateado           = sumPeriodos([totalInsalubreProrateado, totalComun]);

  // ── Cargo deudor 2% ──────────────────────────────────────────────────────────
  let cargDeudor2pct    = false;
  let cargDeudorPeriodo = { anios: 0, meses: 0, dias: 0 };
  if (!input.es_insalubre_ips && !input.diferencial_2pct_pagado && ipsNombAntes15Range) {
    cargDeudor2pct    = true;
    cargDeudorPeriodo = diffFechas(ipsNombAntes15Range.desde, ipsNombAntes15Range.hasta);
  }

  // ── Períodos IPS para display ─────────────────────────────────────────────────
  const servBeca       = ipsBecaRange        ? diffFechas(ipsBecaRange.desde,        ipsBecaRange.hasta)        : { anios:0,meses:0,dias:0 };
  const servNomb       = ipsNombRange        ? diffFechas(ipsNombRange.desde,        ipsNombRange.hasta)        : { anios:0,meses:0,dias:0 };
  const servNombAntes15 = ipsNombAntes15Range ? diffFechas(ipsNombAntes15Range.desde, ipsNombAntes15Range.hasta) : { anios:0,meses:0,dias:0 };
  const servNombDesde15 = ipsNombDesde15Range ? diffFechas(ipsNombDesde15Range.desde, ipsNombDesde15Range.hasta) : { anios:0,meses:0,dias:0 };
  const servIPSTotal    = sumPeriodos([servBeca, servNomb, fromDias(ipsExtraBrutoDias)]);
  const servIPSAjustado = fromDias(ipsSurvTotal);

  const ansesNeto = fromDias(
    todosExternos
      .filter(s => s.id.startsWith('ANSES_'))
      .reduce((acc, s) => acc + Math.max(0, calDias(s.desde, s.hasta) - extPerdidoCal[s.id]), 0),
  );

  // ── Elegibilidad ──────────────────────────────────────────────────────────────
  const hayEmpates          = superpuestos.some(s => s.empate);
  const totalInsalubreDias  = toDias(totalInsalubre);
  const totalComunDias      = toDias(totalComun);
  const totalProrateadoDias = toDias(totalProrateado);

  const descuentoEdadInsalubreDias = Math.max(0, toDias(totalInsalubreProrateado) - totalInsalubreDias);
  const edadRequeridaMixtaDias  = Math.max(
    REQ_INSALUBRE.edadDias,
    REQ_ORDINARIA.edadDias - descuentoEdadInsalubreDias,
  );

  let tipoJubilacion: string | null = null;

  if (!hayEmpates && cajaJubilatoria === 'IPS') {
    if (totalInsalubreDias >= REQ_INSALUBRE.servicioDias && edadDias >= REQ_INSALUBRE.edadDias) {
      tipoJubilacion = 'AGOTAMIENTO_PREMATURO';
    } else if (totalComunDias >= REQ_ORDINARIA.servicioDias && edadDias >= REQ_ORDINARIA.edadDias) {
      tipoJubilacion = 'ORDINARIA';
    } else if (totalProrateadoDias >= REQ_ORDINARIA.servicioDias && edadDias >= edadRequeridaMixtaDias) {
      tipoJubilacion = 'PRORRATEO';
    }
  }

  // ── Falta ────────────────────────────────────────────────────────────────────
  // Qué régimen aplica y cuánto servicio hace falta, para una mezcla dada de
  // días insalubres y comunes. Se usa igual para la situación actual y para
  // simular cuánto faltaría trabajando de una u otra forma.
  function evaluarServicio(insDias: number, comDias: number) {
    const insPror   = toDias(aplicarProrrateo(fromDias(insDias)));
    const prorDias  = insPror + comDias;
    const descuento = Math.max(0, insPror - insDias);
    const edadMixta = Math.max(REQ_INSALUBRE.edadDias, REQ_ORDINARIA.edadDias - descuento);

    if (insDias > 0 && comDias > 0) {
      return { req: REQ_ORDINARIA.servicioDias, base: prorDias,  reqEdad: edadMixta };
    }
    if (insDias > 0) {
      return { req: REQ_INSALUBRE.servicioDias, base: insDias,   reqEdad: REQ_INSALUBRE.edadDias };
    }
    return { req: REQ_ORDINARIA.servicioDias,   base: comDias,   reqEdad: REQ_ORDINARIA.edadDias };
  }

  const actual = evaluarServicio(totalInsalubreDias, totalComunDias);
  const reqServicioDias  = actual.req;
  const reqEdadDias      = actual.reqEdad;
  const baseServicioDias = actual.base;

  // Días reales de trabajo que faltan según cómo se sigan prestando los
  // servicios. Un día insalubre computa más que uno común (la tabla de
  // prorrateo), así que en insalubre siempre faltan menos días de almanaque.
  // Se busca el mínimo por bisección sobre la misma tabla, sin inventar un
  // factor fijo: agregar días nunca puede alejar del requisito, así que la
  // condición es monótona y la búsqueda es válida.
  const TOPE_BUSQUEDA_DIAS = 60 * 365;
  function faltanDias(insalubre: boolean): number {
    if (baseServicioDias >= reqServicioDias) return 0;
    const cumpleCon = (x: number) => {
      const e = insalubre
        ? evaluarServicio(totalInsalubreDias + x, totalComunDias)
        : evaluarServicio(totalInsalubreDias, totalComunDias + x);
      return e.base >= e.req;
    };
    if (!cumpleCon(TOPE_BUSQUEDA_DIAS)) return TOPE_BUSQUEDA_DIAS;
    let lo = 0;
    let hi = TOPE_BUSQUEDA_DIAS;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumpleCon(mid)) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  const faltaComunDias     = faltanDias(false);
  const faltaInsalubreDias = faltanDias(true);

  const cumpleServicio = baseServicioDias >= reqServicioDias;
  const cumpleEdad     = edadDias >= reqEdadDias;

  return {
    tiene_beca:                   tieneBeca,
    beca_aporto:                  input.beca_aporto,
    ips_aporto:                   input.ips_aporto,
    sin_aportes:                  sinAportes,
    caja_jubilatoria:             cajaJubilatoria,
    corresponde_anses:            cajaJubilatoria === 'ANSES',
    ips_bruto:                    fromDias(ipsBrutoDias),
    anses_bruto:                  fromDias(ansesBrutoDias),
    servicio_beca:                servBeca,
    servicio_nombrado:            servNomb,
    servicio_nombrado_antes_2015: servNombAntes15,
    servicio_nombrado_desde_2015: servNombDesde15,
    servicio_ips:                 servIPSTotal,
    servicio_ips_ajustado:        servIPSAjustado,
    servicio_ips_extra:           fromDias(ipsExtraBrutoDias),
    es_insalubre_efectivo:        esInsalubreEfectivo,
    diferencial_2pct_pagado:      input.diferencial_2pct_pagado,
    cargo_deudor_2pct:            cargDeudor2pct,
    cargo_deudor_periodo:         cargDeudorPeriodo,
    anses_neto:                   ansesNeto,
    superpuestos,
    hay_empates:                  hayEmpates,
    total_insalubre:              totalInsalubre,
    total_insalubre_prorateado:   totalInsalubreProrateado,
    total_comun:                  totalComun,
    desglose_cajas:               desgloseCajas,
    total_prorateado:             totalProrateado,
    edad_actual:                  edad,
    fecha_calculo:                fmtISO(hoy),
    es_fecha_hoy:                 fmtISO(hoy) === fmtISO(today()),
    tipo_jubilacion:              tipoJubilacion,
    cumple_servicio:              cumpleServicio,
    cumple_edad:                  cumpleEdad,
    falta_servicio:               fromDias(Math.max(0, reqServicioDias - baseServicioDias)),
    // Días reales de trabajo que faltan según se sigan prestando como comunes
    // o como insalubres (en insalubre siempre son menos: computan 1,4 a 1).
    falta_servicio_comun:         fromDias(faltaComunDias),
    falta_servicio_insalubre:     fromDias(faltaInsalubreDias),
    falta_edad:                   fromDias(Math.max(0, reqEdadDias - edadDias)),
    pct_servicio_completado:      reqServicioDias > 0 ? Math.min(100, Math.round(baseServicioDias / reqServicioDias * 100)) : 0,
    pct_edad_completada:          reqEdadDias    > 0 ? Math.min(100, Math.round(edadDias        / reqEdadDias    * 100)) : 0,
  };
}

// ── SQL helper ────────────────────────────────────────────────────────────────
const SQL_AGENTE = `
  SELECT p.dni, p.apellido, p.nombre, p.fecha_nacimiento,
         a.fecha_ingreso, a.fecha_de_nombramiento, l.nombre AS ley_nombre,
         o.nombre AS ocupacion_nombre,
         COALESCE(o.es_insalubre, 0) AS ocupacion_es_insalubre,
         CASE
           WHEN l.nombre LIKE '%[Bb]eca%' OR l.nombre LIKE '%beca%' OR l.nombre LIKE '%Beca%' THEN 'BECADO'
           WHEN l.nombre LIKE '%[Rr]esidente%' OR l.nombre LIKE '%residente%' THEN 'RESIDENTE'
           WHEN l.nombre LIKE '%[Cc]oncurrente%' OR l.nombre LIKE '%concurrente%' THEN 'CONCURRENTE'
           WHEN l.id = 14 THEN 'ARTICULO_48'
           ELSE 'NORMAL'
         END AS situacion_sugerida
  FROM personal p
  LEFT JOIN agentes a   ON a.dni = p.dni AND a.deleted_at IS NULL
  LEFT JOIN ley l       ON l.id  = a.ley_id
  LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id AND o.deleted_at IS NULL
  WHERE p.dni = :dni AND p.deleted_at IS NULL
  LIMIT 1`;

// ── Agenda de citas: creación idempotente de la tabla en runtime ──────────────
// (mismo patrón que app_runtime_config: la tabla se crea sola al primer request,
//  la DDL canónica vive en scripts/migrations/041__jubilacion_citas.sql)
const citasTableReady = new WeakSet<Sequelize>();

async function ensureCitasTable(sequelize: Sequelize) {
  if (citasTableReady.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS jubilacion_citas (
      id                    bigint unsigned NOT NULL AUTO_INCREMENT,
      dni                   int             NOT NULL,
      apellido              varchar(100)    NOT NULL,
      nombre                varchar(100)    NOT NULL,
      ley_nombre            varchar(200)    NULL,
      ocupacion_nombre      varchar(200)    NULL,
      fecha_cita            date            NOT NULL,
      hora_cita             time            NOT NULL,
      motivo                varchar(200)    NULL,
      estado                enum('AGENDADA','ATENDIDA','AUSENTE','REPROGRAMADA','CANCELADA') NOT NULL DEFAULT 'AGENDADA',
      observaciones         text            NULL,
      posible_jubilado_id   bigint unsigned NULL,
      creado_por            bigint unsigned NULL,
      creado_por_nombre     varchar(190)    NULL,
      modificado_por        bigint unsigned NULL,
      modificado_por_nombre varchar(190)    NULL,
      created_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at            datetime        NULL,
      PRIMARY KEY (id),
      INDEX idx_jub_citas_dni        (dni),
      INDEX idx_jub_citas_fecha      (fecha_cita, hora_cita),
      INDEX idx_jub_citas_estado     (estado),
      INDEX idx_jub_citas_deleted_at (deleted_at),
      INDEX idx_jub_citas_posible    (posible_jubilado_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  citasTableReady.add(sequelize);
}

// ── Fechas del trámite en posibles_jubilados: ALTER idempotente en runtime ────
// (DDL canónica en scripts/migrations/042__posibles_jubilados_fechas.sql)
const posiblesColsReady = new WeakSet<Sequelize>();

async function ensurePosiblesColumns(sequelize: Sequelize) {
  if (posiblesColsReady.has(sequelize)) return;
  const cols: [string, string][] = [
    ['fecha_presentacion_papeles', 'date NULL AFTER mes_corte'],
    ['fecha_jubilacion',           'date NULL AFTER fecha_presentacion_papeles'],
    ['expediente_ips',             'varchar(60) NULL AFTER fecha_jubilacion'],
    ['expediente_gdeba',           'varchar(60) NULL AFTER expediente_ips'],
    ['ifgra_1',                    'varchar(60) NULL AFTER expediente_gdeba'],
    ['ifgra_2',                    'varchar(60) NULL AFTER ifgra_1'],
  ];
  for (const [column, definition] of cols) {
    const found = await sequelize.query(
      `SHOW COLUMNS FROM posibles_jubilados LIKE :column`,
      { replacements: { column }, type: QueryTypes.SELECT },
    );
    if (!(found as any[]).length) {
      await sequelize.query(`ALTER TABLE posibles_jubilados ADD COLUMN ${column} ${definition}`);
    }
  }
  posiblesColsReady.add(sequelize);
}

// ── Checklist de carga + OK de la alerta: tablas idempotentes en runtime ──────
// (DDL canónica en scripts/migrations/045__jubilacion_checklist_carga.sql)
//
// posibles_jubilados_checklist: una fila por paso TILDADO. Destildar borra la
// fila, así el estado es siempre "lo que está hecho" y queda quién lo hizo.
//
// posibles_jubilados_alerta_ok: los acuses de la alerta de carga. Se guardan
// todos (varios usuarios pueden dar OK del mismo período); el OK esconde el
// banner sólo para quien lo dio y sólo por ese día. La alerta se cierra de
// verdad cuando están todos los pasos tildados.
const checklistTablesReady = new WeakSet<Sequelize>();

async function ensureChecklistTables(sequelize: Sequelize) {
  if (checklistTablesReady.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS posibles_jubilados_checklist (
      id                  bigint unsigned NOT NULL AUTO_INCREMENT,
      posible_jubilado_id bigint unsigned NOT NULL,
      item                enum('DOCUMENTACION','IFGRA','EXPEDIENTE_GDEBA','SIAPE','INTRANET','RESOLUCION','EXPEDIENTE_IPS') NOT NULL,
      tildado_por         bigint unsigned NULL,
      tildado_por_nombre  varchar(190)    NULL,
      created_at          timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_pj_checklist (posible_jubilado_id, item),
      INDEX idx_pj_checklist_pj (posible_jubilado_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS posibles_jubilados_alerta_ok (
      id                  bigint unsigned NOT NULL AUTO_INCREMENT,
      posible_jubilado_id bigint unsigned NOT NULL,
      periodo             varchar(24)     NOT NULL,
      usuario_id          bigint unsigned NULL,
      usuario_nombre      varchar(190)    NULL,
      created_at          timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_pj_ok_pj      (posible_jubilado_id, periodo),
      INDEX idx_pj_ok_usuario (usuario_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // La tabla puede venir de antes de los pasos EXPEDIENTE_IPS / EXPEDIENTE_GDEBA:
  // el CREATE IF NOT EXISTS no la toca, así que se amplía el enum a mano. Se
  // compara contra el último valor agregado, que es el que falta en las viejas.
  const colItem = await sequelize.query(
    `SHOW COLUMNS FROM posibles_jubilados_checklist LIKE 'item'`,
    { type: QueryTypes.SELECT },
  ) as any[];
  if (colItem.length && !String(colItem[0].Type ?? '').includes('EXPEDIENTE_GDEBA')) {
    await sequelize.query(
      `ALTER TABLE posibles_jubilados_checklist
         MODIFY item enum('DOCUMENTACION','IFGRA','EXPEDIENTE_GDEBA','SIAPE','INTRANET','RESOLUCION','EXPEDIENTE_IPS') NOT NULL`,
    );
  }
  checklistTablesReady.add(sequelize);
}

// ── Pasos del checklist que piden número al tildarse ─────────────────────────
// Cada número va a dos lados: la columna de posibles_jubilados (el dato del
// trámite, el que se ve en la ficha) y una fila en `expedientes` del agente,
// que es donde los mira la página de Resoluciones/Expedientes.
const CAMPOS_NUMERO: Record<string, Array<{ columna: string; caratula: string }>> = {
  IFGRA: [
    { columna: 'ifgra_1', caratula: 'JUBILACION - INFORME GRAFICO 1' },
    { columna: 'ifgra_2', caratula: 'JUBILACION - INFORME GRAFICO 2' },
  ],
  EXPEDIENTE_GDEBA: [{ columna: 'expediente_gdeba', caratula: 'JUBILACION - EXPEDIENTE GDEBA' }],
  EXPEDIENTE_IPS:   [{ columna: 'expediente_ips',   caratula: 'JUBILACION - EXPEDIENTE IPS'   }],
};

// Alta idempotente en `expedientes`: si el agente ya tiene ese número cargado
// no se duplica (mismo criterio que los trámites documentales).
async function registrarExpedienteAgente(
  sequelize: Sequelize,
  opts: { dni: number; numero: string; caratula: string; userId: number | null },
) {
  const numero = opts.numero.trim();
  if (!numero) return;
  const existe = await sequelize.query(
    `SELECT id FROM expedientes
      WHERE dni = :dni AND numero = :numero AND deleted_at IS NULL LIMIT 1`,
    { replacements: { dni: opts.dni, numero }, type: QueryTypes.SELECT },
  ) as any[];
  if (existe.length) return;
  await sequelize.query(
    `INSERT INTO expedientes (dni, numero, caratula, fecha, estado, created_by, created_at)
     VALUES (:dni, :numero, :caratula, CURDATE(), 'En trámite', :userId, NOW())`,
    {
      replacements: { dni: opts.dni, numero, caratula: opts.caratula, userId: opts.userId },
      type: QueryTypes.INSERT,
    },
  );
}

// Ítems tildados de varios registros de una: id → [{ item, por, cuando }]
async function traerChecklist(sequelize: Sequelize, ids: number[]) {
  const mapa: Record<number, any[]> = {};
  if (!ids.length) return mapa;
  const rows = await sequelize.query(
    `SELECT posible_jubilado_id, item, tildado_por_nombre,
            DATE_FORMAT(created_at, '%Y-%m-%d') AS tildado_el
     FROM posibles_jubilados_checklist
     WHERE posible_jubilado_id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  ) as any[];
  for (const r of rows) {
    (mapa[Number(r.posible_jubilado_id)] ??= []).push({
      item: r.item, por: r.tildado_por_nombre, el: r.tildado_el,
    });
  }
  return mapa;
}

// ── Alertas del trámite jubilatorio ───────────────────────────────────────────
// Cada fecha cargada en posibles_jubilados genera una alerta en el banner del
// agente (alertas_agente). Se pone urgente cuando faltan 15 días o menos y, si la
// fecha pasa sin que el trámite se cierre, la alerta NO se va: queda marcada como
// VENCIDA hasta que alguien la baje a mano (DELETE /alertas-agente/:id).
// Baja automática sólo si se borra la fecha, se elimina el registro o el agente
// pasa a Jubilado / Descartado.
//
// La sincronización vive en un procedure + un EVENT diario de MySQL (mismo
// esquema que ev_sembrar_cumpleanos_diario): así las alertas se actualizan aunque
// nadie abra la pestaña. El procedure se recrea desde el código en cada arranque,
// para que prod quede siempre con la versión que dice el código.
const TIT_PAPELES    = 'Jubilación · Presentación de papeles';
const TIT_JUBILACION = 'Jubilación · Fecha prevista';
const alertasJobReady = new WeakSet<Sequelize>();

// Textos: uno mientras falta para la fecha y otro cuando ya se venció
const MSG_PAPELES_OK  = `CONCAT('Presentación de papeles de la jubilación: ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), '.')`;
const MSG_PAPELES_VTO = `CONCAT('VENCIDA — debía presentar los papeles de la jubilación el ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), ' (', ${hace('fecha_presentacion_papeles')}, ').')`;
const MSG_JUBIL_OK    = `CONCAT('Fecha prevista de jubilación: ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), '.')`;
const MSG_JUBIL_VTO   = `CONCAT('VENCIDA — la fecha prevista de jubilación era el ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), ' (', ${hace('fecha_jubilacion')}, ').')`;

// 'hace 1 día' / 'hace N días'
function hace(columna: string): string {
  return `IF(DATEDIFF(CURDATE(), p.${columna}) = 1, 'hace 1 día', CONCAT('hace ', DATEDIFF(CURDATE(), p.${columna}), ' días'))`;
}

// Bloque de sincronización para una de las dos fechas (refresco / alta / baja)
function bloqueSyncAlerta(titulo: string, columna: string, msgOk: string, msgVto: string): string {
  // El trámite está abierto mientras haya fecha cargada y no se haya cerrado.
  // Que la fecha ya haya pasado NO lo cierra: la alerta queda (vencida) hasta
  // que alguien la baje a mano desde la gestión de alertas.
  const abierto = `p.deleted_at IS NULL
       AND p.estado IN ('IDENTIFICADO','EN_TRAMITE')
       AND p.${columna} IS NOT NULL`;
  const mensaje = `IF(p.${columna} >= CURDATE(), ${msgOk}, ${msgVto})`;
  const urgente = `IF(p.${columna} <= CURDATE() + INTERVAL 15 DAY, 1, 0)`;

  return `
  -- ${titulo}: refrescar texto y urgencia (cambió la fecha, o se venció hoy)
  UPDATE alertas_agente a
    JOIN posibles_jubilados p ON p.dni = a.dni AND ${abierto}
  SET a.mensaje = ${mensaje}, a.urgente = ${urgente}
  WHERE a.titulo = '${titulo}' AND a.activa = 1 AND a.deleted_at IS NULL
    AND (a.mensaje <> ${mensaje} OR a.urgente <> ${urgente});

  -- ${titulo}: alta de las que faltan. No revive una alerta que ya se cerró a
  -- mano para esa misma fecha (se la reconoce porque la fecha va en el texto).
  INSERT INTO alertas_agente (dni, titulo, mensaje, urgente, activa, creado_por)
  SELECT p.dni, '${titulo}', ${mensaje}, ${urgente}, 1, NULL
  FROM posibles_jubilados p
  WHERE ${abierto}
    AND NOT EXISTS (
      SELECT 1 FROM alertas_agente a
      WHERE a.dni = p.dni AND a.titulo = '${titulo}'
        AND a.mensaje LIKE CONCAT('%', DATE_FORMAT(p.${columna}, '%d/%m/%Y'), '%'));

  -- ${titulo}: baja sólo si se borró la fecha, se eliminó el registro o el
  -- trámite se cerró (Jubilado / Descartado). Vencida NO da de baja.
  UPDATE alertas_agente a
  SET a.activa = 0
  WHERE a.titulo = '${titulo}' AND a.activa = 1 AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM posibles_jubilados p
      WHERE p.dni = a.dni AND ${abierto});
`;
}

// Exportado para poder verificarlo contra la copia de referencia
// (scripts/migrations/043__alertas_jubilacion_event.sql) sin levantar la API.
export function buildSyncAlertasJubilacionProcedure(): string {
  return `
    CREATE PROCEDURE sp_sync_alertas_jubilacion()
    BEGIN
      ${bloqueSyncAlerta(TIT_PAPELES,    'fecha_presentacion_papeles', MSG_PAPELES_OK, MSG_PAPELES_VTO)}
      ${bloqueSyncAlerta(TIT_JUBILACION, 'fecha_jubilacion',           MSG_JUBIL_OK,   MSG_JUBIL_VTO)}
    END
  `;
}

async function ensureAlertasJubilacionJob(sequelize: Sequelize) {
  if (alertasJobReady.has(sequelize)) return;
  await sequelize.query('DROP PROCEDURE IF EXISTS sp_sync_alertas_jubilacion');
  await sequelize.query(buildSyncAlertasJubilacionProcedure());
  await sequelize.query(`
    CREATE EVENT IF NOT EXISTS ev_sync_alertas_jubilacion
      ON SCHEDULE EVERY 1 DAY
      STARTS DATE_ADD(CURDATE(), INTERVAL 1 DAY) + INTERVAL 10 MINUTE
      DO CALL sp_sync_alertas_jubilacion()
  `);
  alertasJobReady.add(sequelize);
}

// Sincroniza en el momento (al listar o al tocar un registro). Nunca rompe el
// endpoint: si la DB no permite crear procedures/eventos, sólo queda logueado.
async function sincronizarAlertasJubilacion(sequelize: Sequelize) {
  try {
    await ensureAlertasJubilacionJob(sequelize);
    await sequelize.query('CALL sp_sync_alertas_jubilacion()');
  } catch (err: any) {
    logger.warn({ msg: '[jubilacion] no se pudieron sincronizar las alertas del trámite', err: err?.message });
  }
}

// ── Lectura del PDF de ANSES ──────────────────────────────────────────────────
// El operador puede subir el archivo desde su PC o pasar la ruta de un PDF que ya
// está en el servidor (los escaneos viven en D:\G\...). Sólo se lee y se parsea:
// no se guarda nada, la carga la confirma el operador en pantalla.

const EXT_PDF_ANSES = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const ANSES_PDF_MAX_BYTES = 30 * 1024 * 1024;
const ANSES_PDF_TIMEOUT_MS = 180_000;

const ansesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ANSES_PDF_MAX_BYTES, files: 1 },
});

const rutaAnsesSchema = z.object({ ruta: z.string().min(3).max(500) });

/** Carpetas del servidor habilitadas para leer PDFs por ruta. */
function raicesPdfPermitidas(): string[] {
  const explicitas = (env.JUBILACION_PDF_DIRS || []).filter(Boolean);
  if (explicitas.length) return explicitas.map((d) => path.resolve(d));

  // Los escaneos quedan en carpetas hermanas de DOCU (D:\G\DESPAPELIZACION, etc.),
  // así que se habilita el directorio padre de las bases configuradas.
  const bases = [env.TRAMITES_DOCU_BASE_DIR, env.DOCUMENTS_SCAN_DIR, env.DOCUMENTS_BASE_DIR]
    .filter((d): d is string => !!d && d.trim().length > 0);
  return [...new Set(bases.map((b) => path.dirname(path.resolve(b))))];
}

function resolverRutaServidor(ruta: string): { ok: true; path: string } | { ok: false; error: string } {
  const abs = path.resolve(ruta.trim().replace(/^"|"$/g, ''));
  if (!EXT_PDF_ANSES.has(path.extname(abs).toLowerCase()))
    return { ok: false, error: 'La ruta debe apuntar a un PDF o a una imagen (.pdf, .jpg, .png)' };

  const raices = raicesPdfPermitidas();
  if (!raices.length) return { ok: false, error: 'No hay carpetas del servidor habilitadas para leer PDFs' };

  const dentro = raices.some((raiz) => {
    const rel = path.relative(raiz.toLowerCase(), abs.toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
  if (!dentro) return { ok: false, error: `La ruta debe estar dentro de: ${raices.join(' · ')}` };
  if (!fs.existsSync(abs)) return { ok: false, error: 'El archivo no existe en el servidor' };

  return { ok: true, path: abs };
}

function conTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: se agotó el tiempo (${ms}ms)`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ── Ficha ANSES por agente ────────────────────────────────────────────────────
// Los tramos de ANSES se guardaban sólo adentro de cada cálculo. Para poder
// proyectar el padrón entero hace falta tenerlos por agente, así que viven en
// jubilacion_anses (DDL canónica en scripts/migrations/049__jubilacion_anses.sql,
// creación idempotente en runtime como el resto del módulo).
const ansesTableReady = new WeakSet<Sequelize>();

async function ensureAnsesTable(sequelize: Sequelize) {
  if (ansesTableReady.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS jubilacion_anses (
      id                    bigint unsigned NOT NULL AUTO_INCREMENT,
      dni                   int             NOT NULL,
      servicios             json            NULL,
      tiene_datos           tinyint(1)      NOT NULL DEFAULT 1,
      origen                enum('PDF','MANUAL') NOT NULL DEFAULT 'MANUAL',
      archivo_origen        varchar(500)    NULL,
      fecha_lectura         date            NULL,
      observaciones         text            NULL,
      creado_por            bigint unsigned NULL,
      creado_por_nombre     varchar(190)    NULL,
      modificado_por        bigint unsigned NULL,
      modificado_por_nombre varchar(190)    NULL,
      created_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at            datetime        NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_jub_anses_dni (dni),
      INDEX idx_jub_anses_deleted_at (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ansesTableReady.add(sequelize);
}

const ansesFichaSchema = z.object({
  servicios:      z.array(servicioANSESSchema).max(40).default([]),
  tiene_datos:    z.boolean().optional(),
  origen:         z.enum(['PDF', 'MANUAL']).optional().default('MANUAL'),
  archivo_origen: z.string().max(500).optional().nullable(),
  observaciones:  z.string().max(2000).optional().nullable(),
});

// MySQL devuelve JSON ya parseado o como string según driver/versión.
function parseJSON<T>(v: any, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

// ── Servicios controlados ─────────────────────────────────────────────────────
// Un control vigente por servicio (deleted_at NULL); los anteriores quedan como
// historial. Creación idempotente en runtime como el resto del módulo.
const controladosTableReady = new WeakSet<Sequelize>();

async function ensureServiciosControladosTable(sequelize: Sequelize) {
  if (controladosTableReady.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS jubilacion_servicios_controlados (
      id                    int          NOT NULL AUTO_INCREMENT,
      servicio_id           int          NOT NULL,
      nota                  varchar(255) NULL,
      controlado_por        int          NULL,
      controlado_por_nombre varchar(255) NULL,
      created_at            timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at            datetime     NULL,
      deleted_by            int          NULL,
      PRIMARY KEY (id),
      INDEX idx_jub_srv_ctrl (servicio_id, deleted_at),
      CONSTRAINT fk_jub_srv_ctrl_servicio FOREIGN KEY (servicio_id) REFERENCES servicios (id),
      CONSTRAINT fk_jub_srv_ctrl_usuario  FOREIGN KEY (controlado_por) REFERENCES usuarios (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  controladosTableReady.add(sequelize);
}

// ── Proyección por servicio ───────────────────────────────────────────────────
// Padrón activo con su destino actual (servicio → repartición → dependencia) y
// todo lo que necesita el motor de cálculo. El tramo de agentes es el último
// abierto; el pase de servicio, el último sin fecha_hasta.
const SQL_PROYECCION_BASE = `
  SELECT p.dni, p.apellido, p.nombre, p.fecha_nacimiento,
         a.id AS agente_id, a.fecha_ingreso, a.fecha_de_nombramiento,
         (jf.id IS NOT NULL) AS es_jefe,
         l.id AS ley_id, l.nombre AS ley_nombre,
         o.nombre AS ocupacion_nombre,
         COALESCE(o.es_insalubre, 0) AS ocupacion_es_insalubre,
         srv.id AS servicio_id, srv.nombre AS servicio_nombre,
         rep.id AS reparticion_id, rep.reparticion_nombre AS reparticion_nombre,
         dep.id AS dependencia_id, dep.nombre AS dependencia_nombre,
         CASE
           WHEN l.nombre LIKE '%beca%'        THEN 'BECADO'
           WHEN l.nombre LIKE '%residente%'   THEN 'RESIDENTE'
           WHEN l.nombre LIKE '%concurrente%' THEN 'CONCURRENTE'
           WHEN l.id = 14                     THEN 'ARTICULO_48'
           ELSE 'NORMAL'
         END AS situacion_sugerida
  FROM personal p
  -- El tramo activo, no el de id más alto: los tramos de BAJA de la carrera
  -- se cargan después y a veces tienen id mayor que el activo.
  JOIN agentes a ON a.id = (
    SELECT id FROM agentes
    WHERE dni = p.dni AND deleted_at IS NULL
    ORDER BY (estado_empleo = 'ACTIVO') DESC, fecha_ingreso DESC, id DESC LIMIT 1)
  LEFT JOIN ley l          ON l.id = a.ley_id
  LEFT JOIN ocupaciones o  ON o.id = a.ocupacion_id AND o.deleted_at IS NULL
  LEFT JOIN agentes_servicios ags ON ags.id = (
    SELECT id FROM agentes_servicios
    WHERE dni = p.dni AND deleted_at IS NULL AND fecha_hasta IS NULL
    ORDER BY id DESC LIMIT 1)
  -- El jefe cuenta en el servicio que conduce aunque su pase figure en otro
  -- (p. ej. jefa de Farmacia asignada a Dirección Asociada).
  LEFT JOIN jefaturas jf ON jf.id = (
    SELECT id FROM jefaturas
    WHERE dni = p.dni AND deleted_at IS NULL AND servicio_id IS NOT NULL
      AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
    ORDER BY id DESC LIMIT 1)
  LEFT JOIN servicios     srv ON srv.id = COALESCE(jf.servicio_id, ags.servicio_id) AND srv.deleted_at IS NULL
  LEFT JOIN reparticiones rep ON rep.id = srv.reparticion_id  AND rep.deleted_at IS NULL
  LEFT JOIN dependencias  dep ON dep.id = rep.dependencia_id  AND dep.deleted_at IS NULL
  WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'`;

type ResultadoCalculo = ReturnType<typeof calcular>;

type CorteProyeccion = 'CUMPLE' | 'HASTA_6M' | 'HASTA_12M' | 'MAS_ADELANTE' | 'NO_COMPUTA' | 'SIN_DATOS';

// Primera fecha en la que el agente cumple edad + servicios.
//
// El requisito es monótono en el tiempo (un día más nunca aleja de cumplirlo:
// suma edad y suma servicio), así que se puede bisecar. El límite superior sale
// de lo que el propio motor dice que falta — edad y servicio en días reales —
// y se duplica si se quedó corto (el prorrateo puede mover el requisito).
const TOPE_PROYECCION_DIAS = 40 * 365;

function proyectarFechaCumple(
  base: Date,
  calcEn: (fecha: Date) => ResultadoCalculo,
  resBase: ResultadoCalculo,
): { fecha: Date | null; resultado: ResultadoCalculo } {
  const cumple = (r: ResultadoCalculo) => !!r.tipo_jubilacion;
  if (cumple(resBase)) return { fecha: base, resultado: resBase };

  const faltaEdad = toDias(resBase.falta_edad);
  const faltaServ = toDias(resBase.falta_servicio_comun);
  let span = Math.max(faltaEdad, faltaServ, 30) + 60;

  let hiRes = calcEn(addDias(base, Math.min(span, TOPE_PROYECCION_DIAS)));
  while (!cumple(hiRes) && span < TOPE_PROYECCION_DIAS) {
    span = Math.min(span * 2, TOPE_PROYECCION_DIAS);
    hiRes = calcEn(addDias(base, span));
  }
  if (!cumple(hiRes)) return { fecha: null, resultado: resBase };

  let lo = 0;
  let hi = span;
  let mejor = hiRes;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r   = calcEn(addDias(base, mid));
    if (cumple(r)) { hi = mid; mejor = r; } else { lo = mid + 1; }
  }
  return { fecha: addDias(base, lo), resultado: mejor };
}

function mesesDespues(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

// ── Router ────────────────────────────────────────────────────────────────────
export function buildJubilacionRouter(sequelize: Sequelize): Router {
  const router = Router();

  // GET /jubilacion/agente-datos/:dni
  router.get(
    '/agente-datos/:dni',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });
        return res.json({ ok: true, data: (rows as any[])[0] });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] agente-datos error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // GET /jubilacion/agente/:dni
  router.get(
    '/agente/:dni',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      try {
        const rows = await sequelize.query(
          `SELECT id, apellido, nombre, fecha_nacimiento, fecha_ingreso_ips,
                  ley_nombre, situacion_revista, beca_aporto, ips_aporto,
                  es_insalubre_ips, diferencial_2pct_pagado, fecha_calculo,
                  servicios_anses, servicios_externos, resoluciones_manuales,
                  resultado, observaciones,
                  creado_por_nombre, modificado_por_nombre, created_at, updated_at
           FROM jubilacion_calculos
           WHERE dni = :dni AND deleted_at IS NULL
           ORDER BY created_at DESC`,
          { replacements: { dni }, type: QueryTypes.SELECT },
        );
        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] list error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/calcular
  router.post(
    '/calcular',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const parsed = calculoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
      const body = parsed.data;
      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: `Agente DNI ${body.dni} no encontrado` });

        const ag = (rows as any[])[0];
        const resultado = calcular({
          fecha_nacimiento:        ag.fecha_nacimiento,
          fecha_ingreso_ips:       ag.fecha_ingreso,
          fecha_nombramiento_ips:  ag.fecha_de_nombramiento,
          situacion_revista:       body.situacion_revista,
          beca_aporto:             body.beca_aporto ?? false,
          ips_aporto:              defaultIpsAporto(body.situacion_revista, body.ips_aporto),
          es_insalubre_ips:        body.es_insalubre_ips,
          diferencial_2pct_pagado: body.diferencial_2pct_pagado,
          fecha_calculo:           body.fecha_calculo ?? null,
          servicios_anses:         body.servicios_anses,
          servicios_externos:      body.servicios_externos,
          resoluciones_manuales:   body.resoluciones_manuales ?? {},
        });
        return res.json({ ok: true, agente: ag, resultado });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] calcular error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/parse-anses-pdf
  // Sube el PDF (campo `archivo`) o manda { ruta } de un archivo del servidor.
  // Devuelve las líneas detectadas para que el operador las revise antes de cargarlas.
  router.post(
    '/parse-anses-pdf',
    rbac('jubilacion_calculos', 'read'),
    ansesUpload.single('archivo'),
    async (req: Request, res: Response) => {
      const file = (req as any).file as Express.Multer.File | undefined;
      let tempPath: string | null = null;

      try {
        let filePath: string;

        if (file) {
          const ext = path.extname(file.originalname || '').toLowerCase();
          if (!EXT_PDF_ANSES.has(ext))
            return res.status(400).json({ ok: false, error: 'El archivo debe ser PDF o imagen (.pdf, .jpg, .png)' });
          tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anses-in-')), `entrada${ext}`);
          fs.writeFileSync(tempPath, file.buffer);
          filePath = tempPath;
        } else {
          const parsed = rutaAnsesSchema.safeParse(req.body);
          if (!parsed.success)
            return res.status(400).json({ ok: false, error: 'Subí un archivo o indicá la ruta del PDF en el servidor' });
          const r = resolverRutaServidor(parsed.data.ruta);
          if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
          filePath = r.path;
        }

        const data = await conTimeout(leerListadoANSES(filePath), ANSES_PDF_TIMEOUT_MS, 'Lectura del PDF de ANSES');
        logger.info({
          msg: '[jubilacion] PDF ANSES leído',
          origen: data.origen,
          lineas: data.lineas.length,
          cuil: data.cuil,
        });
        // El texto crudo va recortado: le sirve al operador para ver qué leyó el OCR
        // cuando la resolución trae un formato de tabla que el parser no reconoce.
        const { texto, ...resto } = data;
        return res.json({ ok: true, data: { ...resto, texto_crudo: (texto || '').slice(0, 8000) } });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] parse-anses-pdf error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message || 'No se pudo leer el PDF' });
      } finally {
        if (tempPath) {
          try { fs.rmSync(path.dirname(tempPath), { recursive: true, force: true }); } catch { /* noop */ }
        }
      }
    },
  );

  // POST /jubilacion/guardar
  router.post(
    '/guardar',
    rbac('jubilacion_calculos', 'create'),
    async (req: Request, res: Response) => {
      const parsed = calculoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.id ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: `Agente DNI ${body.dni} no encontrado` });

        const ag = (rows as any[])[0];
        const resultado = calcular({
          fecha_nacimiento:        ag.fecha_nacimiento,
          fecha_ingreso_ips:       ag.fecha_ingreso,
          fecha_nombramiento_ips:  ag.fecha_de_nombramiento,
          situacion_revista:       body.situacion_revista,
          beca_aporto:             body.beca_aporto ?? false,
          ips_aporto:              defaultIpsAporto(body.situacion_revista, body.ips_aporto),
          es_insalubre_ips:        body.es_insalubre_ips,
          diferencial_2pct_pagado: body.diferencial_2pct_pagado,
          fecha_calculo:           body.fecha_calculo ?? null,
          servicios_anses:         body.servicios_anses,
          servicios_externos:      body.servicios_externos,
          resoluciones_manuales:   body.resoluciones_manuales ?? {},
        });

        const [insertResult] = await sequelize.query(
          `INSERT INTO jubilacion_calculos
             (dni, apellido, nombre, fecha_nacimiento, fecha_ingreso_ips, ley_nombre,
              situacion_revista, beca_aporto, ips_aporto,
              es_insalubre_ips, diferencial_2pct_pagado, fecha_calculo,
              anses_anios, anses_meses, anses_dias, anses_insalubre,
              servicios_anses, servicios_externos, resoluciones_manuales,
              resultado, observaciones,
              creado_por, creado_por_nombre)
           VALUES
             (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso_ips, :ley_nombre,
              :situacion_revista, :beca_aporto, :ips_aporto,
              :es_insalubre_ips, :diferencial_2pct_pagado, :fecha_calculo,
              0, 0, 0, 0,
              :servicios_anses, :servicios_externos, :resoluciones_manuales,
              :resultado, :observaciones,
              :creado_por, :creado_por_nombre)`,
          {
            replacements: {
              dni:                body.dni,
              apellido:           ag.apellido,
              nombre:             ag.nombre,
              fecha_nacimiento:   ag.fecha_nacimiento   ?? null,
              fecha_ingreso_ips:  ag.fecha_ingreso      ?? null,
              ley_nombre:         ag.ley_nombre         ?? null,
              situacion_revista:  body.situacion_revista,
              beca_aporto:        body.beca_aporto ? 1 : 0,
              ips_aporto:         defaultIpsAporto(body.situacion_revista, body.ips_aporto) ? 1 : 0,
              es_insalubre_ips:   body.es_insalubre_ips ? 1 : 0,
              diferencial_2pct_pagado: body.diferencial_2pct_pagado ? 1 : 0,
              fecha_calculo:      body.fecha_calculo ?? null,
              servicios_anses:    JSON.stringify(body.servicios_anses),
              servicios_externos: JSON.stringify(body.servicios_externos),
              resoluciones_manuales: JSON.stringify(body.resoluciones_manuales ?? {}),
              resultado:          JSON.stringify(resultado),
              observaciones:      body.observaciones ?? null,
              creado_por:         userId,
              creado_por_nombre:  userName,
            },
            type: QueryTypes.INSERT,
          },
        );

        return res.status(201).json({ ok: true, id: insertResult, resultado });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] guardar error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // PUT /jubilacion/:id
  router.put(
    '/:id',
    rbac('jubilacion_calculos', 'update'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const parsed = calculoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.id ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      try {
        const rows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT });
        if (!(rows as any[]).length)
          return res.status(404).json({ ok: false, error: 'Agente no encontrado' });

        const ag = (rows as any[])[0];
        const resultado = calcular({
          fecha_nacimiento:        ag.fecha_nacimiento,
          fecha_ingreso_ips:       ag.fecha_ingreso,
          fecha_nombramiento_ips:  ag.fecha_de_nombramiento,
          situacion_revista:       body.situacion_revista,
          beca_aporto:             body.beca_aporto ?? false,
          ips_aporto:              defaultIpsAporto(body.situacion_revista, body.ips_aporto),
          es_insalubre_ips:        body.es_insalubre_ips,
          diferencial_2pct_pagado: body.diferencial_2pct_pagado,
          fecha_calculo:           body.fecha_calculo ?? null,
          servicios_anses:         body.servicios_anses,
          servicios_externos:      body.servicios_externos,
          resoluciones_manuales:   body.resoluciones_manuales ?? {},
        });

        await sequelize.query(
          `UPDATE jubilacion_calculos
           SET situacion_revista      = :situacion_revista,
               beca_aporto            = :beca_aporto,
               ips_aporto             = :ips_aporto,
               es_insalubre_ips       = :es_insalubre_ips,
               diferencial_2pct_pagado = :diferencial_2pct_pagado,
               fecha_calculo          = :fecha_calculo,
               servicios_anses        = :servicios_anses,
               servicios_externos     = :servicios_externos,
               resoluciones_manuales  = :resoluciones_manuales,
               resultado              = :resultado,
               observaciones          = :observaciones,
               modificado_por         = :modificado_por,
               modificado_por_nombre  = :modificado_por_nombre
           WHERE id = :id AND deleted_at IS NULL`,
          {
            replacements: {
              id,
              situacion_revista:     body.situacion_revista,
              beca_aporto:           body.beca_aporto ? 1 : 0,
              ips_aporto:            defaultIpsAporto(body.situacion_revista, body.ips_aporto) ? 1 : 0,
              es_insalubre_ips:      body.es_insalubre_ips ? 1 : 0,
              diferencial_2pct_pagado: body.diferencial_2pct_pagado ? 1 : 0,
              fecha_calculo:         body.fecha_calculo ?? null,
              servicios_anses:       JSON.stringify(body.servicios_anses),
              servicios_externos:    JSON.stringify(body.servicios_externos),
              resoluciones_manuales: JSON.stringify(body.resoluciones_manuales ?? {}),
              resultado:             JSON.stringify(resultado),
              observaciones:         body.observaciones ?? null,
              modificado_por:        userId,
              modificado_por_nombre: userName,
            },
            type: QueryTypes.UPDATE,
          },
        );

        return res.json({ ok: true, resultado });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] update error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // DELETE /jubilacion/:id
  router.delete(
    '/:id',
    rbac('jubilacion_calculos', 'delete'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
      try {
        await sequelize.query(
          `UPDATE jubilacion_calculos SET deleted_at = NOW() WHERE id = :id AND deleted_at IS NULL`,
          { replacements: { id }, type: QueryTypes.UPDATE },
        );
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] delete error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // ── POSIBLES JUBILADOS ────────────────────────────────────────────────────────

  // El corte no se elige libre: se puede atrasar, nunca adelantar respecto del
  // que corresponde hoy. El anio sale de fecha_jubilacion (fin del trimestre).
  function corteFueraDeRango(mesCorte: any, fechaJubilacion: any): string | null {
    if (!mesCorte) return null;
    const anio = fechaJubilacion
      ? Number(String(fechaJubilacion).slice(0, 4))
      : corteVigente().anioBaja;
    if (!Number.isFinite(anio)) return null;
    if (!corteEsPosteriorAlVigente(mesCorte as MesCorte, anio, new Date())) return null;
    const vig = corteVigente();
    return `El corte ${mesCorte} ${anio} es posterior al que corresponde hoy `
         + `(${vig.mesCorte} ${vig.anioBaja}, papeles del ${vig.papelesDesde} al ${vig.papelesHasta}). `
         + `Se puede atrasar, no adelantar.`;
  }

  // GET /jubilacion/anses/:dni - ficha ANSES guardada del agente
  router.get(
    '/anses/:dni',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      try {
        await ensureAnsesTable(sequelize);
        const rows = await sequelize.query(
          `SELECT id, dni, servicios, tiene_datos, origen, archivo_origen,
                  DATE_FORMAT(fecha_lectura, '%Y-%m-%d') AS fecha_lectura,
                  observaciones, creado_por_nombre, modificado_por_nombre, updated_at
           FROM jubilacion_anses WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
          { replacements: { dni }, type: QueryTypes.SELECT },
        );
        const row = (rows as any[])[0] ?? null;
        return res.json({
          ok: true,
          data: row ? { ...row, servicios: parseJSON(row.servicios, []) } : null,
        });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] anses get error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // PUT /jubilacion/anses/:dni - guarda (o pisa) la ficha ANSES del agente.
  // Es lo que alimenta la proyección del padrón: sin esto los tramos de ANSES
  // sólo existen adentro de un cálculo guardado.
  router.put(
    '/anses/:dni',
    rbac('jubilacion_calculos', 'update'),
    async (req: Request, res: Response) => {
      const dni = parseInt(req.params.dni, 10);
      if (!dni || isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      const parsed = ansesFichaSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.id ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;
      const tieneDatos = body.tiene_datos ?? body.servicios.length > 0;

      try {
        await ensureAnsesTable(sequelize);
        const existe = await sequelize.query(
          `SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
          { replacements: { dni }, type: QueryTypes.SELECT },
        );
        if (!(existe as any[]).length)
          return res.status(404).json({ ok: false, error: `Agente DNI ${dni} no encontrado` });

        await sequelize.query(
          `INSERT INTO jubilacion_anses
             (dni, servicios, tiene_datos, origen, archivo_origen, fecha_lectura,
              observaciones, creado_por, creado_por_nombre, modificado_por, modificado_por_nombre)
           VALUES (:dni, :servicios, :tiene_datos, :origen, :archivo, CURDATE(),
              :obs, :uid, :uname, :uid, :uname)
           ON DUPLICATE KEY UPDATE
             servicios = VALUES(servicios), tiene_datos = VALUES(tiene_datos),
             origen = VALUES(origen), archivo_origen = VALUES(archivo_origen),
             fecha_lectura = VALUES(fecha_lectura), observaciones = VALUES(observaciones),
             modificado_por = VALUES(modificado_por), modificado_por_nombre = VALUES(modificado_por_nombre),
             deleted_at = NULL`,
          {
            replacements: {
              dni,
              servicios:   JSON.stringify(body.servicios),
              tiene_datos: tieneDatos ? 1 : 0,
              origen:      body.origen,
              archivo:     body.archivo_origen ?? null,
              obs:         body.observaciones ?? null,
              uid:         userId,
              uname:       userName,
            },
          },
        );
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] anses put error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // GET /jubilacion/proyeccion/estructura
  // Catálogos para los selectores de la pestaña Proyección. Van por acá (y no
  // por /dependencias) para que no haga falta permiso de CRUD de catálogos.
  router.get(
    '/proyeccion/estructura',
    // Sólo catálogos: también la usa la página de estadística de jubilables.
    requireAny(['app:jubilables-estadistica:access', 'crud:jubilacion_calculos:read', 'crud:*:*']),
    async (_req: Request, res: Response) => {
      try {
        const [dependencias, reparticiones, servicios, leyes] = await Promise.all([
          sequelize.query(
            `SELECT id, nombre FROM dependencias WHERE deleted_at IS NULL ORDER BY nombre`,
            { type: QueryTypes.SELECT }),
          sequelize.query(
            `SELECT id, reparticion_nombre AS nombre, dependencia_id
             FROM reparticiones WHERE deleted_at IS NULL ORDER BY reparticion_nombre`,
            { type: QueryTypes.SELECT }),
          sequelize.query(
            `SELECT id, nombre, reparticion_id FROM servicios WHERE deleted_at IS NULL ORDER BY nombre`,
            { type: QueryTypes.SELECT }),
          sequelize.query(
            `SELECT id, nombre FROM ley WHERE deleted_at IS NULL ORDER BY nombre`,
            { type: QueryTypes.SELECT }),
        ]);
        return res.json({ ok: true, data: { dependencias, reparticiones, servicios, leyes } });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] estructura error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // ── Servicios controlados ──────────────────────────────────────────────────
  // Marca de admin "este servicio está controlado" (los cálculos de su gente se
  // revisaron). Se ve con un ✔ y tooltip en Herramientas y en la página de
  // estadística. Desmarcar no borra: queda el historial con deleted_at.
  async function leerServiciosControlados() {
    await ensureServiciosControladosTable(sequelize);
    return sequelize.query(
      `SELECT servicio_id, nota, controlado_por_nombre AS por,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS en
       FROM jubilacion_servicios_controlados WHERE deleted_at IS NULL`,
      { type: QueryTypes.SELECT }) as Promise<Array<{ servicio_id: number; nota: string | null; por: string | null; en: string }>>;
  }

  const soloAdmin = requireAny(['crud:*:*']);

  // POST /jubilacion/servicios-controlados/:servicioId  { nota? }
  router.post(
    '/servicios-controlados/:servicioId',
    soloAdmin,
    async (req: Request, res: Response) => {
      const servicioId = parseInt(req.params.servicioId, 10);
      if (!servicioId) return res.status(400).json({ ok: false, error: 'Servicio inválido' });
      const nota   = String(req.body?.nota ?? '').trim().slice(0, 255) || null;
      const userId = (req as any).auth?.principalId ?? null;
      try {
        await ensureServiciosControladosTable(sequelize);
        const [u] = userId ? await sequelize.query(
          `SELECT COALESCE(NULLIF(nombre, ''), email) AS nombre FROM usuarios WHERE id = :userId`,
          { replacements: { userId }, type: QueryTypes.SELECT }) as any[] : [];
        // Un control vigente por servicio: re-marcar reemplaza al anterior.
        await sequelize.query(
          `UPDATE jubilacion_servicios_controlados SET deleted_at = NOW(), deleted_by = :userId
           WHERE servicio_id = :servicioId AND deleted_at IS NULL`,
          { replacements: { servicioId, userId } });
        await sequelize.query(
          `INSERT INTO jubilacion_servicios_controlados (servicio_id, nota, controlado_por, controlado_por_nombre)
           VALUES (:servicioId, :nota, :userId, :nombre)`,
          { replacements: { servicioId, nota, userId, nombre: u?.nombre ?? null } });
        return res.json({ ok: true, servicios_controlados: await leerServiciosControlados() });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] servicio controlado error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // DELETE /jubilacion/servicios-controlados/:servicioId
  router.delete(
    '/servicios-controlados/:servicioId',
    soloAdmin,
    async (req: Request, res: Response) => {
      const servicioId = parseInt(req.params.servicioId, 10);
      if (!servicioId) return res.status(400).json({ ok: false, error: 'Servicio inválido' });
      const userId = (req as any).auth?.principalId ?? null;
      try {
        await ensureServiciosControladosTable(sequelize);
        await sequelize.query(
          `UPDATE jubilacion_servicios_controlados SET deleted_at = NOW(), deleted_by = :userId
           WHERE servicio_id = :servicioId AND deleted_at IS NULL`,
          { replacements: { servicioId, userId } });
        return res.json({ ok: true, servicios_controlados: await leerServiciosControlados() });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] servicio controlado delete error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // Proyección del padrón entero, parada en `fechaBase`. La usan /proyeccion
  // (agente por agente) y /proyeccion/estadistica (sólo agregados).
  type FiltrosProyeccion = {
    dependenciaId: number | null; reparticionId: number | null;
    servicioId: number | null; leyId: number | null; q: string;
  };
  async function armarProyeccion(fechaBase: Date, filtros: FiltrosProyeccion) {
    const { dependenciaId, reparticionId, servicioId, leyId, q } = filtros;
    const where: string[] = [];
    const repl: Record<string, any> = {};
    if (dependenciaId) { where.push('dep.id = :dependenciaId'); repl.dependenciaId = dependenciaId; }
    if (reparticionId) { where.push('rep.id = :reparticionId'); repl.reparticionId = reparticionId; }
    if (servicioId)    { where.push('srv.id = :servicioId');    repl.servicioId    = servicioId; }
    if (leyId)         { where.push('l.id = :leyId');           repl.leyId         = leyId; }
    if (q) {
      where.push('(p.apellido LIKE :q OR p.nombre LIKE :q OR CONCAT(p.apellido, " ", p.nombre) LIKE :q OR p.dni LIKE :q)');
      repl.q = `%${q}%`;
    }

    await ensureAnsesTable(sequelize);

    const agentes = await sequelize.query(
      `${SQL_PROYECCION_BASE}${where.length ? ` AND ${where.join(' AND ')}` : ''}
       ORDER BY dep.nombre, rep.reparticion_nombre, srv.nombre, p.apellido, p.nombre`,
      { replacements: repl, type: QueryTypes.SELECT },
    ) as any[];

    // Fichas ANSES y últimos cálculos: dos lecturas para todo el padrón,
    // no una por agente.
    const [fichas, calculos, enPosibles] = await Promise.all([
      sequelize.query(
        `SELECT dni, servicios, tiene_datos, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS actualizado
         FROM jubilacion_anses WHERE deleted_at IS NULL`,
        { type: QueryTypes.SELECT }) as Promise<any[]>,
      sequelize.query(
        `SELECT c.dni, c.situacion_revista, c.beca_aporto, c.ips_aporto,
                c.es_insalubre_ips, c.diferencial_2pct_pagado,
                c.servicios_anses, c.servicios_externos, c.resoluciones_manuales,
                DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') AS actualizado
         FROM jubilacion_calculos c
         JOIN (SELECT dni, MAX(id) AS mx FROM jubilacion_calculos
               WHERE deleted_at IS NULL GROUP BY dni) u ON u.mx = c.id`,
        { type: QueryTypes.SELECT }) as Promise<any[]>,
      sequelize.query(
        `SELECT dni, estado FROM posibles_jubilados WHERE deleted_at IS NULL`,
        { type: QueryTypes.SELECT }) as Promise<any[]>,
    ]);

    const fichaPorDni    = new Map(fichas.map((f) => [Number(f.dni), f]));
    const calculoPorDni  = new Map(calculos.map((c) => [Number(c.dni), c]));
    const posiblePorDni  = new Map(enPosibles.map((r) => [Number(r.dni), String(r.estado)]));

    // Toda la carrera, no sólo el tramo activo: los tramos cerrados (BAJA)
    // también son servicio en la caja IPS.
    const dnis = agentes.map((ag) => Number(ag.dni));
    const tramos = dnis.length ? await sequelize.query(
      `SELECT a.id, a.dni, a.fecha_ingreso, a.fecha_de_nombramiento, a.fecha_egreso,
              COALESCE(o.es_insalubre, 0) AS es_insalubre, l.nombre AS ley_nombre
       FROM agentes a
       LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id AND o.deleted_at IS NULL
       LEFT JOIN ley l ON l.id = a.ley_id
       WHERE a.deleted_at IS NULL AND a.dni IN (:dnis)
       ORDER BY a.dni, a.fecha_ingreso`,
      { replacements: { dnis }, type: QueryTypes.SELECT }) as any[] : [];
    const tramosPorDni = new Map<number, any[]>();
    for (const t of tramos) {
      const k = Number(t.dni);
      if (!tramosPorDni.has(k)) tramosPorDni.set(k, []);
      tramosPorDni.get(k)!.push(t);
    }

    const corte6  = mesesDespues(fechaBase, 6);
    const corte12 = mesesDespues(fechaBase, 12);

    const data = agentes.map((ag) => {
      const dni   = Number(ag.dni);
      const calc  = calculoPorDni.get(dni) ?? null;
      const ficha = fichaPorDni.get(dni) ?? null;

      // Tramos ANSES: el cálculo guardado manda; si no hay, la ficha.
      const ansesCalc  = calc ? parseJSON<any[]>(calc.servicios_anses, []) : [];
      const ansesFicha = ficha ? parseJSON<any[]>(ficha.servicios, []) : [];
      const serviciosAnses = ansesCalc.length ? ansesCalc : ansesFicha;
      // "Sin datos" es no haberlo mirado nunca. Una ficha con tiene_datos=0
      // es un agente que ya se revisó y no tiene aportes en ANSES.
      const tieneAnses = serviciosAnses.length > 0 || (ficha ? !ficha.tiene_datos : false);

      // Centinelas del legajo (01/11/1111) fuera: si entran, el motor toma
      // al agente como nombrado hace nueve siglos.
      const fNacimiento  = fechaLegajo(ag.fecha_nacimiento);
      const fIngreso     = fechaLegajo(ag.fecha_ingreso);
      const fNombramiento = fechaLegajo(ag.fecha_de_nombramiento);

      const situacion = String(calc?.situacion_revista ?? ag.situacion_sugerida ?? 'NORMAL');

      // Tramos anteriores al activo → servicios IPS. Mismas reglas que el
      // tramo activo: la beca (ingreso → nombramiento) sólo si está pagada;
      // antes de Jun/2015 común salvo ocupación insalubre o 2% pagado;
      // desde Jun/2015 insalubre.
      const agenteId = Number(ag.agente_id);
      const anteriores = (tramosPorDni.get(dni) ?? []).filter((t) => Number(t.id) !== agenteId);
      const tramosAnteriores = (conPago: boolean) => {
        const becaPagada = conPago || (calc ? !!calc.beca_aporto : false);
        const dosPct     = conPago || (calc ? !!calc.diferencial_2pct_pagado : false);
        const out: Array<{ organismo: string; fecha_desde: string; fecha_hasta: string; es_insalubre: boolean; caja: 'IPS' }> = [];
        for (const t of anteriores) {
          const ing = parseDate(fechaLegajo(t.fecha_ingreso));
          const nom = parseDate(fechaLegajo(t.fecha_de_nombramiento));
          let hasta = parseDate(fechaLegajo(t.fecha_egreso));
          // Sin egreso: la carrera se encadena, cierra el día antes del activo.
          if (!hasta && fIngreso) {
            const sig = parseDate(fIngreso)!;
            hasta = new Date(sig.getFullYear(), sig.getMonth(), sig.getDate() - 1);
          }
          if (!ing || !hasta || hasta < ing) continue;
          const ley = String(t.ley_nombre ?? '');
          const esBecaLey = /beca|residente|concurrente/i.test(ley);
          if (esBecaLey && !becaPagada) continue;
          const insalOcup = !!Number(t.es_insalubre) || (calc ? !!calc.es_insalubre_ips : false);
          const label = `Tramo anterior${ley ? ` (${ley})` : ''}`;
          const push = (d: Date, h: Date, insal: boolean) => {
            if (h >= d) out.push({ organismo: label, fecha_desde: fechaISO(d), fecha_hasta: fechaISO(h), es_insalubre: insal, caja: 'IPS' });
          };
          let desdeNomb = ing;
          if (nom && nom > ing) {
            const finBeca = nom <= hasta ? new Date(nom.getFullYear(), nom.getMonth(), nom.getDate() - 1) : hasta;
            if (becaPagada) push(ing, finBeca, true);
            desdeNomb = nom;
          }
          if (desdeNomb > hasta) continue;
          const finAntes15 = new Date(FECHA_CORTE.getFullYear(), FECHA_CORTE.getMonth(), FECHA_CORTE.getDate() - 1);
          if (desdeNomb < FECHA_CORTE) push(desdeNomb, hasta < FECHA_CORTE ? hasta : finAntes15, insalOcup || dosPct);
          if (hasta >= FECHA_CORTE) push(desdeNomb > FECHA_CORTE ? desdeNomb : FECHA_CORTE, hasta, true);
        }
        return out;
      };
      // `conPago` simula el reconocimiento de servicios, con los mismos flags
      // que se tildan a mano en la calculadora:
      //   · beca_aporto / ips_aporto → el tiempo de beca, residencia o
      //     concurrencia pasa a computar;
      //   · diferencial_2pct_pagado → el tramo anterior a Jun/2015 pasa de
      //     común a insalubre (el cargo deudor del 2%).
      // La insalubridad no se supone: sale de la ocupación del legajo (o del
      // cálculo guardado, si el operador la corrigió). Si la ocupación ya es
      // insalubre el 2% no aplica — ese tiempo computa insalubre igual — así
      // que el flag queda sin efecto y no infla la proyección.
      const armarInput = (fecha: Date, conPago = false) => ({
        fecha_nacimiento:        fNacimiento,
        fecha_ingreso_ips:       fIngreso,
        fecha_nombramiento_ips:  fNombramiento,
        situacion_revista:       situacion,
        beca_aporto:             conPago ? true : (calc ? !!calc.beca_aporto : false),
        ips_aporto:              conPago ? true : defaultIpsAporto(situacion, calc ? !!calc.ips_aporto : undefined),
        es_insalubre_ips:        calc ? !!calc.es_insalubre_ips : !!Number(ag.ocupacion_es_insalubre),
        diferencial_2pct_pagado: conPago ? true : (calc ? !!calc.diferencial_2pct_pagado : false),
        fecha_calculo:           fechaISO(fecha),
        servicios_anses:         serviciosAnses,
        servicios_externos:      [
          ...(calc ? parseJSON<any[]>(calc.servicios_externos, []) : []),
          ...tramosAnteriores(conPago),
        ],
        resoluciones_manuales:   calc ? parseJSON<Record<string, string>>(calc.resoluciones_manuales, {}) : {},
      });

      const resBase = calcular(armarInput(fechaBase) as any);

      // Sin fecha de nacimiento o sin ingreso no hay nada que proyectar:
      // el motor no puede resolver ni la edad ni los servicios.
      const proyectable = !!fNacimiento && !!(fIngreso || fNombramiento);
      // Beca / residencia / concurrencia sin aportes: no acumulan servicio
      // para IPS, así que no hay fecha que proyectar. Van a su propio grupo
      // en vez de caer en "más adelante", que sugeriría que algún día llegan.
      const sinAportes = resBase.sin_aportes;
      const proy = proyectable && !sinAportes
        ? proyectarFechaCumple(fechaBase, (f) => calcular(armarInput(f) as any), resBase)
        : { fecha: null, resultado: resBase };

      const fechaCumple = proy.fecha;
      const clasificar = (f: Date | null, noComputa: boolean): CorteProyeccion => {
        if (!proyectable)        return 'SIN_DATOS';
        if (noComputa)           return 'NO_COMPUTA';
        if (!f)                  return 'MAS_ADELANTE';
        if (f <= fechaBase)      return 'CUMPLE';
        if (f <= corte6)         return 'HASTA_6M';
        if (f <= corte12)        return 'HASTA_12M';
        return 'MAS_ADELANTE';
      };
      const corte = clasificar(fechaCumple, sinAportes);

      // ── Escenario "si paga los aportes" ────────────────────────────────
      // Tiene sentido calcularlo cuando hay tiempo que hoy no computa como
      // debería. Son dos deudas distintas y pueden darse juntas:
      //   · aportes de beca / residencia / concurrencia: ese tiempo no
      //     computa como servicio hasta que se reconoce;
      //   · cargo deudor del 2%: el tiempo anterior a Jun/2015 computa, pero
      //     como común. Pagando el diferencial pasa a insalubre y entra en el
      //     prorrateo, así que no suma días de almanaque pero sí acerca la
      //     fecha. Sólo existe en ocupaciones NO insalubres — si la ocupación
      //     es insalubre el motor no genera cargo deudor.
      // Por eso la ganancia se mide en los dos ejes: días crudos de servicio
      // y días prorrateados. Con mirar sólo los crudos el 2% nunca aparecía.
      const cargoDeudor2pct = !!resBase.cargo_deudor_2pct;
      const hayTiempoImpago = sinAportes || (resBase.tiene_beca && !resBase.beca_aporto) || cargoDeudor2pct;
      const servicioDias = (r: ResultadoCalculo) =>
        toDias(r.total_comun) + toDias(r.total_insalubre);

      let pagoPosible        = false;
      let periodoAReconocer: { anios: number; meses: number; dias: number } | null = null;
      let fechaCumpleConPago: Date | null = null;
      let corteConPago: CorteProyeccion | null = null;
      let tipoConPago: string | null = null;

      if (proyectable && hayTiempoImpago) {
        const resPago     = calcular(armarInput(fechaBase, true) as any);
        const ganancia    = servicioDias(resPago) - servicioDias(resBase);
        const gananciaPro = toDias(resPago.total_prorateado) - toDias(resBase.total_prorateado);
        if (ganancia > 0 || gananciaPro > 0) {
          pagoPosible       = true;
          // Lo que se reconoce como servicio nuevo. El 2% no suma acá: lo que
          // aporta es el período del cargo deudor, que viaja aparte.
          periodoAReconocer = ganancia > 0 ? fromDias(ganancia) : null;
          const proyPago = proyectarFechaCumple(
            fechaBase, (f) => calcular(armarInput(f, true) as any), resPago);
          fechaCumpleConPago = proyPago.fecha;
          corteConPago       = clasificar(proyPago.fecha, false);
          tipoConPago        = proyPago.resultado.tipo_jubilacion;
        }
      }

      return {
        dni,
        apellido:            ag.apellido,
        nombre:              ag.nombre,
        fecha_nacimiento:    fNacimiento,
        fecha_ingreso:       fIngreso,
        fecha_nombramiento:  fNombramiento,
        // Beca = ingreso → nombramiento. Computa sólo si figura como pagada
        // (cálculo guardado) o en el escenario "con pago".
        tiene_beca:          !!resBase.tiene_beca,
        beca_aporto:         !!resBase.beca_aporto,
        es_jefe:             !!Number(ag.es_jefe),
        tramos_anteriores:   anteriores
          .map((t) => ({
            desde: fechaLegajo(t.fecha_ingreso),
            hasta: fechaLegajo(t.fecha_egreso),
            ley:   t.ley_nombre ?? null,
          }))
          .filter((t) => t.desde),
        ley_id:              ag.ley_id,
        ley_nombre:          ag.ley_nombre,
        ocupacion_nombre:    ag.ocupacion_nombre,
        servicio_id:         ag.servicio_id,
        servicio_nombre:     ag.servicio_nombre,
        reparticion_id:      ag.reparticion_id,
        reparticion_nombre:  ag.reparticion_nombre,
        dependencia_id:      ag.dependencia_id,
        dependencia_nombre:  ag.dependencia_nombre,
        situacion_revista:   situacion,
        edad:                resBase.edad_actual,
        antiguedad_ips:      resBase.servicio_ips_ajustado,
        total_comun:         resBase.total_comun,
        total_insalubre:     resBase.total_insalubre,
        total_prorateado:    resBase.total_prorateado,
        cumple_edad:         resBase.cumple_edad,
        cumple_servicio:     resBase.cumple_servicio,
        falta_edad:          resBase.falta_edad,
        falta_servicio:      resBase.falta_servicio,
        tipo_jubilacion:     resBase.tipo_jubilacion,
        // Régimen con el que llegaría a cumplir (el de la fecha proyectada).
        tipo_al_cumplir:     proy.resultado.tipo_jubilacion,
        caja_jubilatoria:    resBase.caja_jubilatoria,
        fecha_cumple:        fechaCumple ? fechaISO(fechaCumple) : null,
        dias_para_cumplir:   fechaCumple ? Math.max(0, calDias(fechaBase, fechaCumple)) : null,
        corte,
        // Reconocimiento de servicios: qué pasaría si paga los aportes del
        // tiempo de beca / residencia / concurrencia.
        pago_posible:          pagoPosible,
        periodo_a_reconocer:   periodoAReconocer,
        // Cargo deudor del 2%: la insalubridad sale de la ocupación, así que
        // esto sólo aparece en ocupaciones comunes con servicio anterior a
        // Jun/2015. Es lo mismo que la calculadora muestra como
        // "puede pagar el 2%".
        cargo_deudor_2pct:     cargoDeudor2pct,
        cargo_deudor_periodo:  cargoDeudor2pct ? resBase.cargo_deudor_periodo : null,
        es_insalubre_ocupacion: !!Number(ag.ocupacion_es_insalubre),
        es_insalubre_efectivo:  !!resBase.es_insalubre_efectivo,
        fecha_cumple_con_pago: fechaCumpleConPago ? fechaISO(fechaCumpleConPago) : null,
        corte_con_pago:        corteConPago,
        tipo_al_cumplir_con_pago: tipoConPago,
        sin_aportes:         sinAportes,
        sin_datos_anses:     !tieneAnses,
        origen_datos:        calc ? 'CALCULO' : 'ESTIMADO',
        // Último cambio de datos cargados a mano (cálculo guardado o ficha
        // ANSES): sirve para avisar si el servicio cambió después de controlarlo.
        datos_actualizados_en: ([calc?.actualizado, ficha?.actualizado]
          .filter(Boolean) as string[]).sort().pop() ?? null,
        estado_posible:      posiblePorDni.get(dni) ?? null,
      };
    });

    return { data, corte6, corte12 };
  }

  // GET /jubilacion/proyeccion
  // Barre el padrón activo y proyecta, agente por agente, cuándo cumple los
  // requisitos jubilatorios. Usa el MISMO motor que la calculadora: por cada
  // agente se corre el cálculo parado en la fecha elegida y después se bisecta
  // la primera fecha en la que da positivo.
  //
  // De dónde salen los datos de cada agente, en orden de preferencia:
  //   1. su último cálculo guardado (lo que el operador confirmó a mano),
  //   2. la ficha ANSES (jubilacion_anses) + lo que se deduce del legajo,
  //   3. sólo el legajo (marca `sin_datos_anses`: la proyección puede ser tardía,
  //      nunca temprana, porque los aportes de ANSES sólo suman).
  router.get(
    '/proyeccion',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const num = (v: any) => {
        const n = parseInt(String(v ?? ''), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const dependenciaId = num(req.query.dependencia_id);
      const reparticionId = num(req.query.reparticion_id);
      const servicioId    = num(req.query.servicio_id);
      const leyId         = num(req.query.ley_id);
      const q             = String(req.query.q ?? '').trim();
      const fechaParam    = String(req.query.fecha ?? '').trim();
      const fechaBase     = (/^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? parseDate(fechaParam) : null) ?? today();

      try {
        const { data, corte6, corte12 } = await armarProyeccion(
          fechaBase, { dependenciaId, reparticionId, servicioId, leyId, q });

        // Totales generales y por servicio, sobre el conjunto ya filtrado.
        const vacio = () => ({
          cumple: 0, hasta_6m: 0, hasta_12m: 0, mas_adelante: 0,
          no_computa: 0, sin_datos: 0, total: 0,
        });
        const sumar = (acc: ReturnType<typeof vacio>, corte: string) => {
          acc.total++;
          if (corte === 'CUMPLE')          acc.cumple++;
          else if (corte === 'HASTA_6M')   acc.hasta_6m++;
          else if (corte === 'HASTA_12M')  acc.hasta_12m++;
          else if (corte === 'NO_COMPUTA') acc.no_computa++;
          else if (corte === 'SIN_DATOS')  acc.sin_datos++;
          else                             acc.mas_adelante++;
          return acc;
        };

        const resumen = data.reduce((acc, r) => sumar(acc, r.corte), vacio());
        const porServicioMap = new Map<string, any>();
        for (const r of data) {
          const key = String(r.servicio_id ?? 'SIN');
          if (!porServicioMap.has(key)) {
            porServicioMap.set(key, {
              servicio_id:        r.servicio_id,
              servicio_nombre:    r.servicio_nombre ?? '(sin servicio asignado)',
              reparticion_nombre: r.reparticion_nombre,
              dependencia_nombre: r.dependencia_nombre,
              ...vacio(),
            });
          }
          sumar(porServicioMap.get(key), r.corte);
        }
        const porServicio = Array.from(porServicioMap.values()).sort(
          (a, b) => (b.cumple + b.hasta_6m) - (a.cumple + a.hasta_6m) ||
                    String(a.servicio_nombre).localeCompare(String(b.servicio_nombre)),
        );

        return res.json({
          ok: true,
          fecha:     fechaISO(fechaBase),
          fecha_6m:  fechaISO(corte6),
          fecha_12m: fechaISO(corte12),
          total: data.length,
          resumen,
          por_servicio: porServicio,
          servicios_controlados: await leerServiciosControlados(),
          data,
        });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] proyeccion error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // GET /jubilacion/proyeccion/estadistica
  // La misma proyección, pero sólo en agregados: para Dirección Ejecutiva y
  // Docencia, que ven porcentajes y gráficos y nunca datos de un agente. Por
  // eso no viaja ni DNI, ni nombre, ni edad: cada grupo servicio+ley trae
  // cuántos agentes tiene y cuántos llegan a cumplir en cada fecha.
  //
  // El escenario es fijo, "con pago": la beca / residencia / concurrencia
  // computa (como insalubre) y lo anterior a Jun/2015 pasa a insalubre por el
  // 2%. Quedan afuera los de ocupación "a asignar" (ASIGANAR en el catálogo),
  // los del servicio "A UBICAR" y los que no tienen servicio asignado.
  router.get(
    '/proyeccion/estadistica',
    requireAny(['app:jubilables-estadistica:access', 'crud:jubilacion_calculos:read', 'crud:*:*']),
    async (req: Request, res: Response) => {
      const fechaParam = String(req.query.fecha ?? '').trim();
      const fechaBase  = (/^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? parseDate(fechaParam) : null) ?? today();
      const esAAsignar = (ocup: unknown) => /^\s*(A\s+)?ASIG/i.test(String(ocup ?? ''));
      const esAUbicar  = (srv: unknown)  => /^\s*A\s+UBICAR\s*$/i.test(String(srv ?? ''));

      try {
        const { data } = await armarProyeccion(fechaBase, {
          dependenciaId: null, reparticionId: null, servicioId: null, leyId: null, q: '',
        });

        const grupos = new Map<string, {
          servicio_id: number | null; servicio_nombre: string;
          reparticion_id: number | null; dependencia_id: number | null; dependencia_nombre: string | null;
          ley_id: number | null;
          total: number; excluidos: number; fechas: Record<string, number>;
          ultimo_cambio: string | null;
        }>();
        for (const r of data) {
          // Fuera: ocupación "a asignar", servicio "A UBICAR" y sin servicio.
          if (esAAsignar(r.ocupacion_nombre) || esAUbicar(r.servicio_nombre) || !r.servicio_id) continue;
          const key = `${r.servicio_id ?? 'SIN'}|${r.ley_id ?? ''}`;
          if (!grupos.has(key)) {
            grupos.set(key, {
              servicio_id:        r.servicio_id ?? null,
              servicio_nombre:    r.servicio_nombre ?? '(sin servicio asignado)',
              reparticion_id:     r.reparticion_id ?? null,
              dependencia_id:     r.dependencia_id ?? null,
              dependencia_nombre: r.dependencia_nombre ?? null,
              ley_id:             r.ley_id ?? null,
              total: 0, excluidos: 0, fechas: {}, ultimo_cambio: null,
            });
          }
          const g = grupos.get(key)!;
          g.total++;
          if (r.datos_actualizados_en && (!g.ultimo_cambio || r.datos_actualizados_en > g.ultimo_cambio))
            g.ultimo_cambio = r.datos_actualizados_en;
          const corte = r.pago_posible && r.corte_con_pago ? r.corte_con_pago : r.corte;
          const fecha = r.pago_posible ? r.fecha_cumple_con_pago : r.fecha_cumple;
          if (corte === 'NO_COMPUTA' || corte === 'SIN_DATOS' || !fecha) g.excluidos++;
          else g.fechas[fecha] = (g.fechas[fecha] ?? 0) + 1;
        }

        return res.json({
          ok: true, fecha: fechaISO(fechaBase), grupos: Array.from(grupos.values()),
          servicios_controlados: await leerServiciosControlados(),
        });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion] proyeccion estadistica error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // GET /jubilacion/cortes - opciones para los selectores del front.
  // Devuelve el corte que corresponde hoy y los cuatro anteriores, cada uno con
  // su fecha de baja y su ventana de papeles ya calculadas.
  router.get(
    '/cortes',
    rbac('jubilacion_calculos', 'read'),
    async (_req: Request, res: Response) => {
      const opciones = opcionesCorte(new Date());
      const sug      = corteSugerido(new Date());
      return res.json({
        ok: true,
        data: opciones,
        vigente:  opciones.find((o) => o.vigente),
        // El que arranca elegido en el selector: normalmente el vigente, salvo
        // que corra una excepcion con fecha de vencimiento.
        sugerido: { mesCorte: sug.mesCorte, anioBaja: sug.anioBaja },
      });
    },
  );

  // GET /jubilacion/posibles
  router.get(
    '/posibles',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      try {
        await ensurePosiblesColumns(sequelize);
        await sincronizarAlertasJubilacion(sequelize);

        const q      = String(req.query.q   ?? '').trim();
        const dni    = String(req.query.dni  ?? '').replace(/\D/g, '');
        const estado = String(req.query.estado ?? '').trim();

        const where: string[] = ['deleted_at IS NULL'];
        const repl: Record<string, any> = {};

        if (dni) {
          where.push('dni = :dni');
          repl.dni = Number(dni);
        } else if (q) {
          where.push('(apellido LIKE :q OR nombre LIKE :q OR CONCAT(apellido, " ", nombre) LIKE :q)');
          repl.q = `%${q}%`;
        }
        if (estado) {
          where.push('estado = :estado');
          repl.estado = estado;
        }

        const rows = await sequelize.query(
          `SELECT id, dni, apellido, nombre, fecha_nacimiento, fecha_ingreso,
                  ley_nombre, ocupacion_nombre, es_insalubre, tipo_jubilacion, mes_corte,
                  DATE_FORMAT(fecha_presentacion_papeles, '%Y-%m-%d') AS fecha_presentacion_papeles,
                  DATE_FORMAT(fecha_jubilacion,           '%Y-%m-%d') AS fecha_jubilacion,
                  expediente_ips, expediente_gdeba, ifgra_1, ifgra_2,
                  estado, observaciones, jubilacion_calculo_id,
                  creado_por_nombre, modificado_por_nombre, created_at, updated_at
           FROM posibles_jubilados
           WHERE ${where.join(' AND ')}
           ORDER BY estado ASC, apellido ASC, nombre ASC`,
          { replacements: repl, type: QueryTypes.SELECT },
        );
        // Checklist de carga de cada registro (Documentación → Resolución)
        await ensureChecklistTables(sequelize);
        const checklist = await traerChecklist(sequelize, (rows as any[]).map((r) => Number(r.id)));
        const data = (rows as any[]).map((r) => {
          const tildados = checklist[Number(r.id)] ?? [];
          return { ...r, checklist: tildados, items_faltantes: itemsFaltantes(tildados.map((t: any) => t.item)) };
        });

        return res.json({ ok: true, data, total: data.length });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] list error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/posibles
  router.post(
    '/posibles',
    rbac('jubilacion_calculos', 'create'),
    async (req: Request, res: Response) => {
      const schema = z.object({
        dni:                   z.number().int().positive(),
        tipo_jubilacion:       z.string().max(50).optional().nullable(),
        mes_corte:             z.enum(['MARZO','JUNIO','SEPTIEMBRE','DICIEMBRE']).optional(),
        estado:                z.enum(['IDENTIFICADO','EN_TRAMITE','JUBILADO','DESCARTADO']).default('IDENTIFICADO'),
        fecha_presentacion_papeles: dateStr.optional().nullable(),
        fecha_jubilacion:           dateStr.optional().nullable(),
        expediente_ips:        z.string().max(60).optional().nullable(),
        expediente_gdeba:      z.string().max(60).optional().nullable(),
        ifgra_1:               z.string().max(60).optional().nullable(),
        ifgra_2:               z.string().max(60).optional().nullable(),
        observaciones:         z.string().max(2000).optional().nullable(),
        jubilacion_calculo_id: z.number().int().positive().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      // Sin mes de corte, va al que corresponde hoy. Las dos fechas del tramite
      // salen del cronograma y quedan editables despues.
      const sug = corteSugerido();
      const mesCorte = body.mes_corte ?? sug.mesCorte;
      const opcion   = body.mes_corte
        ? opcionesCorte(new Date()).find((o) => o.mesCorte === body.mes_corte)
        : sug;
      const fPapeles = body.fecha_presentacion_papeles ?? opcion?.papelesDesde ?? null;
      const fJubil   = body.fecha_jubilacion           ?? opcion?.fechaBaja    ?? null;

      const fueraDeRango = corteFueraDeRango(mesCorte, fJubil);
      if (fueraDeRango) return res.status(400).json({ ok: false, error: fueraDeRango });

      try {
        await ensurePosiblesColumns(sequelize);

        // Verificar que no exista ya (activo) para ese DNI
        const existe = await sequelize.query(
          `SELECT id FROM posibles_jubilados WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
          { replacements: { dni: body.dni }, type: QueryTypes.SELECT },
        ) as any[];
        if (existe.length) {
          return res.status(409).json({ ok: false, error: 'El agente ya está en la lista de posibles jubilados' });
        }

        // Traer datos del agente
        const agRows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT }) as any[];
        if (!agRows.length) return res.status(404).json({ ok: false, error: `Agente DNI ${body.dni} no encontrado` });
        const ag = agRows[0];

        const [insertResult] = await sequelize.query(
          `INSERT INTO posibles_jubilados
             (dni, apellido, nombre, fecha_nacimiento, fecha_ingreso, ley_nombre, ocupacion_nombre,
              es_insalubre, tipo_jubilacion, mes_corte, fecha_presentacion_papeles, fecha_jubilacion,
              expediente_ips, expediente_gdeba, estado, observaciones, jubilacion_calculo_id,
              creado_por, creado_por_nombre)
           VALUES
             (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso, :ley_nombre, :ocupacion_nombre,
              :es_insalubre, :tipo_jubilacion, :mes_corte, :fecha_presentacion_papeles, :fecha_jubilacion,
              :expediente_ips, :expediente_gdeba, :estado, :observaciones, :jubilacion_calculo_id,
              :creado_por, :creado_por_nombre)`,
          {
            replacements: {
              dni:                    body.dni,
              apellido:               ag.apellido,
              nombre:                 ag.nombre,
              fecha_nacimiento:       ag.fecha_nacimiento ?? null,
              fecha_ingreso:          ag.fecha_ingreso    ?? null,
              ley_nombre:             ag.ley_nombre       ?? null,
              ocupacion_nombre:       ag.ocupacion_nombre ?? null,
              es_insalubre:           ag.ocupacion_es_insalubre ? 1 : 0,
              tipo_jubilacion:        body.tipo_jubilacion       ?? null,
              mes_corte:              mesCorte,
              fecha_presentacion_papeles: fPapeles,
              fecha_jubilacion:           fJubil,
              expediente_ips:         body.expediente_ips        ?? null,
              expediente_gdeba:       body.expediente_gdeba      ?? null,
              estado:                 body.estado,
              observaciones:          body.observaciones         ?? null,
              jubilacion_calculo_id:  body.jubilacion_calculo_id ?? null,
              creado_por:             userId,
              creado_por_nombre:      userName,
            },
            type: QueryTypes.INSERT,
          },
        );
        await sincronizarAlertasJubilacion(sequelize);
        return res.status(201).json({ ok: true, id: insertResult });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] create error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // PATCH /jubilacion/posibles/:id
  router.patch(
    '/posibles/:id',
    rbac('jubilacion_calculos', 'update'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const schema = z.object({
        estado:                z.enum(['IDENTIFICADO','EN_TRAMITE','JUBILADO','DESCARTADO']).optional(),
        tipo_jubilacion:       z.string().max(50).optional().nullable(),
        mes_corte:             z.enum(['MARZO','JUNIO','SEPTIEMBRE','DICIEMBRE']).optional().nullable(),
        fecha_presentacion_papeles: dateStr.optional().nullable(),
        fecha_jubilacion:           dateStr.optional().nullable(),
        expediente_ips:        z.string().max(60).optional().nullable(),
        expediente_gdeba:      z.string().max(60).optional().nullable(),
        ifgra_1:               z.string().max(60).optional().nullable(),
        ifgra_2:               z.string().max(60).optional().nullable(),
        observaciones:         z.string().max(2000).optional().nullable(),
        jubilacion_calculo_id: z.number().int().positive().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      const sets: string[] = ['modificado_por = :modificado_por', 'modificado_por_nombre = :modificado_por_nombre'];
      const repl: Record<string, any> = { id, modificado_por: userId, modificado_por_nombre: userName };

      if (body.mes_corte) {
        const fueraDeRango = corteFueraDeRango(body.mes_corte, body.fecha_jubilacion);
        if (fueraDeRango) return res.status(400).json({ ok: false, error: fueraDeRango });
      }

      if (body.estado               !== undefined) { sets.push('estado = :estado');                              repl.estado = body.estado; }
      if (body.tipo_jubilacion      !== undefined) { sets.push('tipo_jubilacion = :tipo_jubilacion');            repl.tipo_jubilacion = body.tipo_jubilacion; }
      if (body.mes_corte            !== undefined) { sets.push('mes_corte = :mes_corte');                        repl.mes_corte = body.mes_corte; }
      if (body.fecha_presentacion_papeles !== undefined) { sets.push('fecha_presentacion_papeles = :fecha_presentacion_papeles'); repl.fecha_presentacion_papeles = body.fecha_presentacion_papeles; }
      if (body.fecha_jubilacion     !== undefined) { sets.push('fecha_jubilacion = :fecha_jubilacion');          repl.fecha_jubilacion = body.fecha_jubilacion; }
      if (body.expediente_ips       !== undefined) { sets.push('expediente_ips = :expediente_ips');              repl.expediente_ips = body.expediente_ips || null; }
      if (body.expediente_gdeba     !== undefined) { sets.push('expediente_gdeba = :expediente_gdeba');          repl.expediente_gdeba = body.expediente_gdeba || null; }
      if (body.ifgra_1              !== undefined) { sets.push('ifgra_1 = :ifgra_1');                            repl.ifgra_1 = body.ifgra_1 || null; }
      if (body.ifgra_2              !== undefined) { sets.push('ifgra_2 = :ifgra_2');                            repl.ifgra_2 = body.ifgra_2 || null; }
      if (body.observaciones        !== undefined) { sets.push('observaciones = :observaciones');                repl.observaciones = body.observaciones; }
      if (body.jubilacion_calculo_id !== undefined) { sets.push('jubilacion_calculo_id = :jubilacion_calculo_id'); repl.jubilacion_calculo_id = body.jubilacion_calculo_id; }

      try {
        await ensurePosiblesColumns(sequelize);
        await sequelize.query(
          `UPDATE posibles_jubilados SET ${sets.join(', ')} WHERE id = :id AND deleted_at IS NULL`,
          { replacements: repl, type: QueryTypes.UPDATE },
        );
        await sincronizarAlertasJubilacion(sequelize);
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] patch error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // DELETE /jubilacion/posibles/:id
  router.delete(
    '/posibles/:id',
    rbac('jubilacion_calculos', 'delete'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
      try {
        await sequelize.query(
          `UPDATE posibles_jubilados SET deleted_at = NOW() WHERE id = :id AND deleted_at IS NULL`,
          { replacements: { id }, type: QueryTypes.UPDATE },
        );
        await sincronizarAlertasJubilacion(sequelize);
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] delete error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // PUT /jubilacion/posibles/:id/checklist - tilda o destilda un paso del tramite
  router.put(
    '/posibles/:id/checklist',
    rbac('jubilacion_calculos', 'update'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID invalido' });

      const schema = z.object({
        item:    z.enum(ITEMS_CHECKLIST),
        tildado: z.boolean(),
        // Solo para los pasos con numero (IFGRA y los dos expedientes):
        // { <columna de posibles_jubilados>: '<numero>' }.
        numeros: z.record(z.string().max(60)).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const { item, tildado, numeros } = parsed.data;
      const campos = CAMPOS_NUMERO[item] ?? [];
      // Lo tipeado, ya limpio, columna por columna.
      const valores: Record<string, string> = {};
      for (const c of campos) valores[c.columna] = String((numeros ?? {})[c.columna] ?? '').trim();
      if (campos.length && tildado && campos.some(c => !valores[c.columna])) {
        return res.status(400).json({ ok: false, error: `Faltan los numeros de ${item}` });
      }
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      try {
        await ensureChecklistTables(sequelize);
        await ensurePosiblesColumns(sequelize);

        const existe = await sequelize.query(
          `SELECT id, dni FROM posibles_jubilados WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
          { replacements: { id }, type: QueryTypes.SELECT },
        ) as any[];
        if (!existe.length) return res.status(404).json({ ok: false, error: 'Registro no encontrado' });

        if (tildado) {
          // Re-tildar no pisa quien lo hizo la primera vez.
          await sequelize.query(
            `INSERT IGNORE INTO posibles_jubilados_checklist
               (posible_jubilado_id, item, tildado_por, tildado_por_nombre)
             VALUES (:id, :item, :userId, :userName)`,
            { replacements: { id, item, userId, userName }, type: QueryTypes.INSERT },
          );
        } else {
          await sequelize.query(
            `DELETE FROM posibles_jubilados_checklist
             WHERE posible_jubilado_id = :id AND item = :item`,
            { replacements: { id, item }, type: QueryTypes.DELETE },
          );
        }

        // Los pasos con numero lo llevan a la ficha y, al tildar, tambien a
        // `expedientes` del agente. Destildar limpia la ficha; la fila de
        // expedientes queda (es el registro del agente, se borra desde ahi).
        if (campos.length) {
          const sets = campos.map(c => `${c.columna} = :${c.columna}`).join(', ');
          const repl: any = { id };
          for (const c of campos) repl[c.columna] = tildado ? valores[c.columna] : null;
          await sequelize.query(
            `UPDATE posibles_jubilados SET ${sets} WHERE id = :id`,
            { replacements: repl, type: QueryTypes.UPDATE },
          );
          if (tildado) {
            const dni = Number(existe[0].dni);
            for (const c of campos) {
              await registrarExpedienteAgente(sequelize, {
                dni, numero: valores[c.columna], caratula: c.caratula, userId,
              });
            }
          }
        }

        const mapa = await traerChecklist(sequelize, [id]);
        const tildados = mapa[id] ?? [];
        return res.json({
          ok: true,
          checklist: tildados,
          items_faltantes: itemsFaltantes(tildados.map((t: any) => t.item)),
          ...Object.fromEntries(campos.map(c => [c.columna, tildado ? valores[c.columna] : null])),
        });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] checklist error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/posibles/:id/alerta-ok - acuse de la alerta de carga.
  // No cierra la alerta: solo la esconde para quien dio OK y solo hasta manana.
  router.post(
    '/posibles/:id/alerta-ok',
    rbac('jubilacion_calculos', 'update'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID invalido' });

      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      try {
        await ensurePosiblesColumns(sequelize);
        await ensureChecklistTables(sequelize);

        const rows = await sequelize.query(
          `SELECT id, mes_corte, DATE_FORMAT(fecha_jubilacion, '%Y-%m-%d') AS fecha_jubilacion
           FROM posibles_jubilados WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
          { replacements: { id }, type: QueryTypes.SELECT },
        ) as any[];
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Registro no encontrado' });
        if (!rows[0].mes_corte) {
          return res.status(400).json({ ok: false, error: 'El registro no tiene mes de corte cargado' });
        }

        const per = periodoVigente(rows[0].mes_corte as MesCorte, new Date(), rows[0].fecha_jubilacion);
        await sequelize.query(
          `INSERT INTO posibles_jubilados_alerta_ok
             (posible_jubilado_id, periodo, usuario_id, usuario_nombre)
           VALUES (:id, :periodo, :userId, :userName)`,
          { replacements: { id, periodo: per.periodo, userId, userName }, type: QueryTypes.INSERT },
        );
        return res.json({ ok: true, periodo: per.periodo });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] alerta-ok error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // GET /jubilacion/alerta-carga - alimenta el banner del dashboard.
  // Entra un agente cuando: el tramite sigue abierto, tiene mes de corte, el
  // periodo vigente ya paso su punto medio y le falta tildar algun paso.
  // El OK del usuario que mira lo saca de SU banner hasta el dia siguiente.
  router.get(
    '/alerta-carga',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;

      try {
        await ensurePosiblesColumns(sequelize);
        await ensureChecklistTables(sequelize);

        const rows = await sequelize.query(
          `SELECT id, dni, apellido, nombre, mes_corte, estado,
                  DATE_FORMAT(fecha_jubilacion, '%Y-%m-%d') AS fecha_jubilacion
           FROM posibles_jubilados
           WHERE deleted_at IS NULL
             AND estado IN ('IDENTIFICADO','EN_TRAMITE')
           ORDER BY apellido ASC, nombre ASC`,
          { type: QueryTypes.SELECT },
        ) as any[];
        if (!rows.length) return res.json({ ok: true, data: [], total: 0 });

        const ids = rows.map((r) => Number(r.id));
        const checklist = await traerChecklist(sequelize, ids);

        // OK del periodo: todos (para mostrar quienes avisaron) y los de hoy del
        // usuario que consulta (para esconderle el banner).
        const oks = await sequelize.query(
          `SELECT posible_jubilado_id, periodo, usuario_id, usuario_nombre,
                  DATE_FORMAT(created_at, '%Y-%m-%d') AS dia
           FROM posibles_jubilados_alerta_ok
           WHERE posible_jubilado_id IN (:ids)`,
          { replacements: { ids }, type: QueryTypes.SELECT },
        ) as any[];

        const hoyISO = fechaLocalISO();
        const data: any[] = [];

        for (const r of rows) {
          const tildados = checklist[Number(r.id)] ?? [];
          const hechos   = tildados.map((t: any) => t.item);
          const faltan   = itemsFaltantes(hechos);
          if (!faltan.length) continue; // tramite cargado completo: no molesta mas

          // Dos motivos distintos para entrar al banner:
          //   IFGRA → apenas se agrega el agente, hasta que se carguen los dos
          //           informes graficos. No espera al cronograma.
          //   CARGA → el resto de los pasos, cuando el periodo vigente ya paso
          //           su punto medio (esto necesita mes de corte).
          const faltaIfgra = faltan.includes('IFGRA');
          const per = r.mes_corte
            ? periodoVigente(r.mes_corte as MesCorte, new Date(), r.fecha_jubilacion)
            : null;
          if (!faltaIfgra && (!per || !alertaVencida(per))) continue;
          const motivo  = faltaIfgra ? 'IFGRA' : 'CARGA';
          const periodo = per?.periodo ?? 'SIN-CORTE';

          const delPeriodo = oks.filter((o) => Number(o.posible_jubilado_id) === Number(r.id)
                                            && o.periodo === periodo);
          // El propio OK de hoy esconde la fila para este usuario, no para el resto.
          const yoAviseHoy = userId != null
            && delPeriodo.some((o) => Number(o.usuario_id) === Number(userId) && o.dia === hoyISO);
          if (yoAviseHoy) continue;

          data.push({
            id: r.id, dni: r.dni, apellido: r.apellido, nombre: r.nombre,
            mes_corte: r.mes_corte, estado: r.estado,
            motivo,
            periodo,
            fecha_alerta: per?.fechaAlerta ?? null,
            items_faltantes: faltan,
            items_hechos: hechos,
            ok_dados: delPeriodo.map((o) => ({ por: o.usuario_nombre, el: o.dia })),
          });
        }

        return res.json({ ok: true, data, total: data.length });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] alerta-carga error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // ── AGENDA DE CITAS ───────────────────────────────────────────────────────────

  // GET /jubilacion/citas?desde=&hasta=&estado=&dni=
  router.get(
    '/citas',
    rbac('jubilacion_calculos', 'read'),
    async (req: Request, res: Response) => {
      try {
        await ensureCitasTable(sequelize);

        const desde  = String(req.query.desde  ?? '').trim();
        const hasta  = String(req.query.hasta  ?? '').trim();
        const estado = String(req.query.estado ?? '').trim();
        const dni    = String(req.query.dni    ?? '').replace(/\D/g, '');

        const where: string[] = ['c.deleted_at IS NULL'];
        const repl: Record<string, any> = {};

        if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) { where.push('c.fecha_cita >= :desde'); repl.desde = desde; }
        if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) { where.push('c.fecha_cita <= :hasta'); repl.hasta = hasta; }
        if (estado) { where.push('c.estado = :estado'); repl.estado = estado; }
        if (dni)    { where.push('c.dni = :dni');       repl.dni    = Number(dni); }

        const rows = await sequelize.query(
          `SELECT c.id, c.dni, c.apellido, c.nombre, c.ley_nombre, c.ocupacion_nombre,
                  DATE_FORMAT(c.fecha_cita, '%Y-%m-%d') AS fecha_cita,
                  TIME_FORMAT(c.hora_cita, '%H:%i')     AS hora_cita,
                  c.motivo, c.estado, c.observaciones, c.posible_jubilado_id,
                  c.creado_por_nombre, c.modificado_por_nombre, c.created_at, c.updated_at,
                  (SELECT pj.id     FROM posibles_jubilados pj
                    WHERE pj.dni = c.dni AND pj.deleted_at IS NULL LIMIT 1) AS registro_id,
                  (SELECT pj.estado FROM posibles_jubilados pj
                    WHERE pj.dni = c.dni AND pj.deleted_at IS NULL LIMIT 1) AS registro_estado
           FROM jubilacion_citas c
           WHERE ${where.join(' AND ')}
           ORDER BY c.fecha_cita ASC, c.hora_cita ASC, c.apellido ASC`,
          { replacements: repl, type: QueryTypes.SELECT },
        );
        return res.json({ ok: true, data: rows, total: (rows as any[]).length });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion_citas] list error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/citas
  router.post(
    '/citas',
    rbac('jubilacion_calculos', 'create'),
    async (req: Request, res: Response) => {
      const schema = z.object({
        dni:           z.number().int().positive(),
        fecha_cita:    dateStr,
        hora_cita:     timeStr,
        motivo:        z.string().max(200).optional().nullable(),
        observaciones: z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      try {
        await ensureCitasTable(sequelize);

        // El agente debe existir en el sistema (la cita guarda un snapshot de sus datos)
        const agRows = await sequelize.query(SQL_AGENTE, { replacements: { dni: body.dni }, type: QueryTypes.SELECT }) as any[];
        if (!agRows.length) return res.status(404).json({ ok: false, error: `Agente DNI ${body.dni} no encontrado` });
        const ag = agRows[0];

        // Evitar la misma cita cargada dos veces
        const dup = await sequelize.query(
          `SELECT id FROM jubilacion_citas
           WHERE dni = :dni AND fecha_cita = :fecha_cita AND hora_cita = :hora_cita
             AND deleted_at IS NULL LIMIT 1`,
          {
            replacements: { dni: body.dni, fecha_cita: body.fecha_cita, hora_cita: normHora(body.hora_cita) },
            type: QueryTypes.SELECT,
          },
        ) as any[];
        if (dup.length) return res.status(409).json({ ok: false, error: 'Ya existe una cita para ese agente en esa fecha y hora' });

        const [insertResult] = await sequelize.query(
          `INSERT INTO jubilacion_citas
             (dni, apellido, nombre, ley_nombre, ocupacion_nombre,
              fecha_cita, hora_cita, motivo, estado, observaciones,
              creado_por, creado_por_nombre)
           VALUES
             (:dni, :apellido, :nombre, :ley_nombre, :ocupacion_nombre,
              :fecha_cita, :hora_cita, :motivo, 'AGENDADA', :observaciones,
              :creado_por, :creado_por_nombre)`,
          {
            replacements: {
              dni:               body.dni,
              apellido:          ag.apellido,
              nombre:            ag.nombre,
              ley_nombre:        ag.ley_nombre       ?? null,
              ocupacion_nombre:  ag.ocupacion_nombre ?? null,
              fecha_cita:        body.fecha_cita,
              hora_cita:         normHora(body.hora_cita),
              motivo:            body.motivo        ?? null,
              observaciones:     body.observaciones ?? null,
              creado_por:        userId,
              creado_por_nombre: userName,
            },
            type: QueryTypes.INSERT,
          },
        );
        return res.status(201).json({ ok: true, id: insertResult });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion_citas] create error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // PATCH /jubilacion/citas/:id
  router.patch(
    '/citas/:id',
    rbac('jubilacion_calculos', 'update'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const schema = z.object({
        fecha_cita:    dateStr.optional(),
        hora_cita:     timeStr.optional(),
        estado:        z.enum(['AGENDADA', 'ATENDIDA', 'AUSENTE', 'REPROGRAMADA', 'CANCELADA']).optional(),
        motivo:        z.string().max(200).optional().nullable(),
        observaciones: z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      const sets: string[] = ['modificado_por = :modificado_por', 'modificado_por_nombre = :modificado_por_nombre'];
      const repl: Record<string, any> = { id, modificado_por: userId, modificado_por_nombre: userName };

      if (body.fecha_cita    !== undefined) { sets.push('fecha_cita = :fecha_cita');       repl.fecha_cita    = body.fecha_cita; }
      if (body.hora_cita     !== undefined) { sets.push('hora_cita = :hora_cita');         repl.hora_cita     = normHora(body.hora_cita); }
      if (body.estado        !== undefined) { sets.push('estado = :estado');               repl.estado        = body.estado; }
      if (body.motivo        !== undefined) { sets.push('motivo = :motivo');               repl.motivo        = body.motivo; }
      if (body.observaciones !== undefined) { sets.push('observaciones = :observaciones'); repl.observaciones = body.observaciones; }

      try {
        await ensureCitasTable(sequelize);
        await sequelize.query(
          `UPDATE jubilacion_citas SET ${sets.join(', ')} WHERE id = :id AND deleted_at IS NULL`,
          { replacements: repl, type: QueryTypes.UPDATE },
        );
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion_citas] patch error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // DELETE /jubilacion/citas/:id
  router.delete(
    '/citas/:id',
    rbac('jubilacion_calculos', 'delete'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });
      try {
        await ensureCitasTable(sequelize);
        await sequelize.query(
          `UPDATE jubilacion_citas SET deleted_at = NOW() WHERE id = :id AND deleted_at IS NULL`,
          { replacements: { id }, type: QueryTypes.UPDATE },
        );
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion_citas] delete error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  // POST /jubilacion/citas/:id/promover
  // Cierra la cita como ATENDIDA y da de alta al agente en posibles_jubilados.
  // Si el agente ya está en el registro, no duplica: vincula la cita al registro existente.
  router.post(
    '/citas/:id/promover',
    rbac('jubilacion_calculos', 'create'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const schema = z.object({
        mes_corte:       z.enum(['MARZO', 'JUNIO', 'SEPTIEMBRE', 'DICIEMBRE']).optional().nullable(),
        tipo_jubilacion: z.string().max(50).optional().nullable(),
        observaciones:   z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

      // Mismo criterio que el alta manual: corte automatico y fechas del
      // cronograma, salvo que manden un corte anterior a proposito.
      const sugProm      = corteSugerido();
      const mesCorteProm = body.mes_corte ?? sugProm.mesCorte;
      const opcionProm   = body.mes_corte
        ? opcionesCorte(new Date()).find((o) => o.mesCorte === body.mes_corte)
        : sugProm;

      const fueraDeRangoProm = corteFueraDeRango(mesCorteProm, opcionProm?.fechaBaja ?? null);
      if (fueraDeRangoProm) return res.status(400).json({ ok: false, error: fueraDeRangoProm });

      try {
        await ensureCitasTable(sequelize);
        await ensurePosiblesColumns(sequelize);

        const citaRows = await sequelize.query(
          `SELECT id, dni, apellido, nombre, observaciones
           FROM jubilacion_citas WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
          { replacements: { id }, type: QueryTypes.SELECT },
        ) as any[];
        if (!citaRows.length) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
        const cita = citaRows[0];

        // ¿Ya está en el registro de posibles jubilados?
        const existe = await sequelize.query(
          `SELECT id FROM posibles_jubilados WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
          { replacements: { dni: cita.dni }, type: QueryTypes.SELECT },
        ) as any[];

        let posibleId: number;
        let yaExistia = false;

        if (existe.length) {
          posibleId = Number(existe[0].id);
          yaExistia = true;
        } else {
          const agRows = await sequelize.query(SQL_AGENTE, { replacements: { dni: cita.dni }, type: QueryTypes.SELECT }) as any[];
          const ag = agRows[0] ?? {};
          const [insertResult] = await sequelize.query(
            `INSERT INTO posibles_jubilados
               (dni, apellido, nombre, fecha_nacimiento, fecha_ingreso, ley_nombre, ocupacion_nombre,
                es_insalubre, tipo_jubilacion, mes_corte,
                fecha_presentacion_papeles, fecha_jubilacion, estado, observaciones,
                creado_por, creado_por_nombre)
             VALUES
               (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso, :ley_nombre, :ocupacion_nombre,
                :es_insalubre, :tipo_jubilacion, :mes_corte,
                :fecha_presentacion_papeles, :fecha_jubilacion, 'IDENTIFICADO', :observaciones,
                :creado_por, :creado_por_nombre)`,
            {
              replacements: {
                dni:               cita.dni,
                apellido:          ag.apellido ?? cita.apellido,
                nombre:            ag.nombre   ?? cita.nombre,
                fecha_nacimiento:  ag.fecha_nacimiento ?? null,
                fecha_ingreso:     ag.fecha_ingreso    ?? null,
                ley_nombre:        ag.ley_nombre       ?? null,
                ocupacion_nombre:  ag.ocupacion_nombre ?? null,
                es_insalubre:      ag.ocupacion_es_insalubre ? 1 : 0,
                tipo_jubilacion:   body.tipo_jubilacion ?? null,
                mes_corte:         mesCorteProm,
                fecha_presentacion_papeles: opcionProm?.papelesDesde ?? null,
                fecha_jubilacion:           opcionProm?.fechaBaja    ?? null,
                observaciones:     body.observaciones   ?? cita.observaciones ?? null,
                creado_por:        userId,
                creado_por_nombre: userName,
              },
              type: QueryTypes.INSERT,
            },
          );
          posibleId = Number(insertResult);
        }

        await sequelize.query(
          `UPDATE jubilacion_citas
           SET estado = 'ATENDIDA', posible_jubilado_id = :posible_id,
               modificado_por = :modificado_por, modificado_por_nombre = :modificado_por_nombre
           WHERE id = :id AND deleted_at IS NULL`,
          {
            replacements: { id, posible_id: posibleId, modificado_por: userId, modificado_por_nombre: userName },
            type: QueryTypes.UPDATE,
          },
        );

        return res.json({ ok: true, posible_jubilado_id: posibleId, ya_existia: yaExistia });
      } catch (err: any) {
        logger.error({ msg: '[jubilacion_citas] promover error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  return router;
}
