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
import { can }                        from '../middlewares/rbacCrud';
import { env }                        from '../config/env';
import { logger }                     from '../logging/logger';
import { leerListadoANSES }           from '../services/ansesPdf.service';

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
                  estado, observaciones, jubilacion_calculo_id,
                  creado_por_nombre, modificado_por_nombre, created_at, updated_at
           FROM posibles_jubilados
           WHERE ${where.join(' AND ')}
           ORDER BY estado ASC, apellido ASC, nombre ASC`,
          { replacements: repl, type: QueryTypes.SELECT },
        );
        return res.json({ ok: true, data: rows, total: (rows as any[]).length });
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
        mes_corte:             z.enum(['MARZO','JUNIO','SEPTIEMBRE','DICIEMBRE']),
        estado:                z.enum(['IDENTIFICADO','EN_TRAMITE','JUBILADO','DESCARTADO']).default('IDENTIFICADO'),
        fecha_presentacion_papeles: dateStr.optional().nullable(),
        fecha_jubilacion:           dateStr.optional().nullable(),
        observaciones:         z.string().max(2000).optional().nullable(),
        jubilacion_calculo_id: z.number().int().positive().optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

      const body     = parsed.data;
      const authUser = (req as any).auth;
      const userId   = authUser?.principalId ?? null;
      const userName = authUser?.nombre ? `${authUser.apellido ?? ''} ${authUser.nombre}`.trim() : null;

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
              estado, observaciones, jubilacion_calculo_id,
              creado_por, creado_por_nombre)
           VALUES
             (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso, :ley_nombre, :ocupacion_nombre,
              :es_insalubre, :tipo_jubilacion, :mes_corte, :fecha_presentacion_papeles, :fecha_jubilacion,
              :estado, :observaciones, :jubilacion_calculo_id,
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
              mes_corte:              body.mes_corte,
              fecha_presentacion_papeles: body.fecha_presentacion_papeles ?? null,
              fecha_jubilacion:           body.fecha_jubilacion           ?? null,
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

      if (body.estado               !== undefined) { sets.push('estado = :estado');                              repl.estado = body.estado; }
      if (body.tipo_jubilacion      !== undefined) { sets.push('tipo_jubilacion = :tipo_jubilacion');            repl.tipo_jubilacion = body.tipo_jubilacion; }
      if (body.mes_corte            !== undefined) { sets.push('mes_corte = :mes_corte');                        repl.mes_corte = body.mes_corte; }
      if (body.fecha_presentacion_papeles !== undefined) { sets.push('fecha_presentacion_papeles = :fecha_presentacion_papeles'); repl.fecha_presentacion_papeles = body.fecha_presentacion_papeles; }
      if (body.fecha_jubilacion     !== undefined) { sets.push('fecha_jubilacion = :fecha_jubilacion');          repl.fecha_jubilacion = body.fecha_jubilacion; }
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

      try {
        await ensureCitasTable(sequelize);

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
                es_insalubre, tipo_jubilacion, mes_corte, estado, observaciones,
                creado_por, creado_por_nombre)
             VALUES
               (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso, :ley_nombre, :ocupacion_nombre,
                :es_insalubre, :tipo_jubilacion, :mes_corte, 'IDENTIFICADO', :observaciones,
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
                mes_corte:         body.mes_corte       ?? null,
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
