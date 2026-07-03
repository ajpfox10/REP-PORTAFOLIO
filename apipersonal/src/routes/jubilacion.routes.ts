/**
 * @file routes/jubilacion.routes.ts
 * Rutas del módulo Jubilación IPS.
 *
 * Endpoints:
 *   GET  /jubilacion/agente-datos/:dni
 *   GET  /jubilacion/agente/:dni
 *   POST /jubilacion/calcular
 *   POST /jubilacion/guardar
 *   PUT  /jubilacion/:id
 *   DELETE /jubilacion/:id
 */

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes }      from 'sequelize';
import { z }                          from 'zod';
import { can }                        from '../middlewares/rbacCrud';
import { env }                        from '../config/env';
import { logger }                     from '../logging/logger';

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
});

const calculoSchema = z.object({
  dni:                     z.number().int().positive(),
  situacion_revista:       z.enum(['NORMAL', 'BECADO', 'RESIDENTE', 'CONCURRENTE', 'ARTICULO_48']),
  beca_aporto:             z.boolean().optional().default(false),
  ips_aporto:              z.boolean().optional(),
  es_insalubre_ips:        z.boolean(),
  diferencial_2pct_pagado: z.boolean(),
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
  servicios_anses:         Array<{ fecha_desde: string; fecha_hasta: string; es_insalubre: boolean }>;
  servicios_externos:      Array<{ organismo: string; fecha_desde: string; fecha_hasta: string; es_insalubre: boolean }>;
  resoluciones_manuales:   Record<string, string>;
}

function calcular(input: CalculoInput) {
  const hoy         = today();
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

  const ipsBecaRange: Rango | null =
    (tieneBeca && input.beca_aporto)
      ? { desde: fechaIngreso!, hasta: fechaNom! }
      : null;

  const fechaInicioNombrado = fechaNom ?? fechaIngreso;
  const ipsNombRange: Rango | null =
    (!sinAportes && fechaInicioNombrado && fechaInicioNombrado < hoy)
      ? { desde: fechaInicioNombrado, hasta: hoy }
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

  // ── Servicios externos (ANSES + municipios/ministerios) ──────────────────────
  const todosExternos: ServicioFechado[] = [
    ...input.servicios_anses.map((a, i) => {
      const desde = parseDate(a.fecha_desde);
      const hasta = parseDate(a.fecha_hasta);
      return desde && hasta && desde < hasta
        ? { id: `ANSES_${i}`, label: `ANSES (${a.fecha_desde} → ${a.fecha_hasta})`, desde, hasta, es_insalubre: a.es_insalubre }
        : null;
    }).filter(Boolean) as ServicioFechado[],
    ...input.servicios_externos.map((e, i) => {
      const desde = parseDate(e.fecha_desde);
      const hasta = parseDate(e.fecha_hasta);
      return desde && hasta && desde < hasta
        ? { id: `EXT_${i}`, label: e.organismo, organismo: e.organismo, desde, hasta, es_insalubre: e.es_insalubre }
        : null;
    }).filter(Boolean) as ServicioFechado[],
  ];

  // ── Prorateado total de cada caja (para criterio ganador) ────────────────────
  // IPS: beca → insalubre, nombAntes15 → comun (salvo esInsalubreEfectivo), nombDesde15 → insalubre
  const ipsBrutoDias =
    (ipsBecaRange ? calDias(ipsBecaRange.desde, ipsBecaRange.hasta) : 0) +
    (ipsNombRange ? calDias(ipsNombRange.desde, ipsNombRange.hasta) : 0);
  const ansesBrutoDias = todosExternos
    .filter(s => s.id.startsWith('ANSES_'))
    .reduce((acc, s) => acc + calDias(s.desde, s.hasta), 0);
  const cajaJubilatoria: 'IPS' | 'ANSES' =
    ansesBrutoDias > ipsBrutoDias ? 'ANSES' : 'IPS';

  function ipsProrDiasTotal(): number {
    let ins = 0;
    let com = 0;
    if (ipsBecaRange) ins += calDias(ipsBecaRange.desde, ipsBecaRange.hasta);
    if (ipsNombRange) {
      if (esInsalubreEfectivo) {
        ins += calDias(ipsNombRange.desde, ipsNombRange.hasta);
      } else {
        if (ipsNombAntes15Range) com += calDias(ipsNombAntes15Range.desde, ipsNombAntes15Range.hasta);
        if (ipsNombDesde15Range) ins += calDias(ipsNombDesde15Range.desde, ipsNombDesde15Range.hasta);
      }
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
    anios: number; meses: number; dias: number;
  };

  const superpuestos: SupResult[] = [];

  // Días de IPS perdidos por sub-rango (cal días)
  let ipsBecaPerdidoCal       = 0;
  let ipsNombAntes15PerdidoCal = 0;
  let ipsNombDesde15PerdidoCal = 0;

  // Días perdidos por cada externo
  const extPerdidoCal: Record<string, number> = {};
  for (const s of todosExternos) extPerdidoCal[s.id] = 0;

  // Rangos IPS como array para iterar
  const ipsSubRangos: Array<{ rango: Rango; tipo: 'beca' | 'antes15' | 'desde15' }> = [];
  if (ipsBecaRange)        ipsSubRangos.push({ rango: ipsBecaRange,        tipo: 'beca' });
  if (ipsNombAntes15Range) ipsSubRangos.push({ rango: ipsNombAntes15Range, tipo: 'antes15' });
  if (ipsNombDesde15Range) ipsSubRangos.push({ rango: ipsNombDesde15Range, tipo: 'desde15' });

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
    // Distribuye los días perdidos por IPS entre sus sub-rangos
    // según cuánto de cada sub-rango se intersecta con extRango
    let restante = diasPerdidos;
    for (const { rango, tipo } of ipsSubRangos) {
      const overlap = intersectRange(rango, extRango);
      if (!overlap) continue;
      const d = Math.min(restante, calDias(overlap.desde, overlap.hasta));
      if (tipo === 'beca')     ipsBecaPerdidoCal       += d;
      if (tipo === 'antes15')  ipsNombAntes15PerdidoCal += d;
      if (tipo === 'desde15')  ipsNombDesde15PerdidoCal += d;
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
      ...fromDias(overlapCal),
    });

    if (!empate) {
      if (ganadorId === 'IPS') {
        extPerdidoCal[ext.id] += overlapCal;
      } else {
        distribuirPerdidaIPS(ext, overlapCal);
      }
    }
  }

  // ── Externo vs externo ───────────────────────────────────────────────────────
  for (let i = 0; i < todosExternos.length; i++) {
    for (let j = i + 1; j < todosExternos.length; j++) {
      const a = todosExternos[i];
      const b = todosExternos[j];
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
        ...fromDias(overlapCal),
      });

      if (!empate) {
        if (ganadorId === a.id) extPerdidoCal[b.id] = Math.min(calDias(b.desde, b.hasta), extPerdidoCal[b.id] + overlapCal);
        else                    extPerdidoCal[a.id] = Math.min(calDias(a.desde, a.hasta), extPerdidoCal[a.id] + overlapCal);
      }
    }
  }

  // ── Días IPS sobrevivientes por sub-rango ────────────────────────────────────
  const ipsBecaCalTotal        = ipsBecaRange        ? calDias(ipsBecaRange.desde,        ipsBecaRange.hasta)        : 0;
  const ipsNombAntes15CalTotal  = ipsNombAntes15Range ? calDias(ipsNombAntes15Range.desde, ipsNombAntes15Range.hasta) : 0;
  const ipsNombDesde15CalTotal  = ipsNombDesde15Range ? calDias(ipsNombDesde15Range.desde, ipsNombDesde15Range.hasta) : 0;

  const ipsBecaSurv        = Math.max(0, ipsBecaCalTotal       - ipsBecaPerdidoCal);
  const ipsNombAntes15Surv = Math.max(0, ipsNombAntes15CalTotal - ipsNombAntes15PerdidoCal);
  const ipsNombDesde15Surv = Math.max(0, ipsNombDesde15CalTotal - ipsNombDesde15PerdidoCal);

  // ── Acumulación insalubre / común ────────────────────────────────────────────
  const insalubrePeriodos: { anios: number; meses: number; dias: number }[] = [];
  const comunPeriodos:     { anios: number; meses: number; dias: number }[] = [];

  const ipsTotalSurv = ipsBecaSurv + ipsNombAntes15Surv + ipsNombDesde15Surv;

  if (ipsTotalSurv > 0) {
    if (esInsalubreEfectivo) {
      insalubrePeriodos.push(fromDias(ipsTotalSurv));
    } else {
      if (ipsBecaSurv        > 0) insalubrePeriodos.push(fromDias(ipsBecaSurv));        // beca → insalubre
      if (ipsNombAntes15Surv > 0) comunPeriodos.push(fromDias(ipsNombAntes15Surv));     // antes 2015 → común
      if (ipsNombDesde15Surv > 0) insalubrePeriodos.push(fromDias(ipsNombDesde15Surv)); // desde 2015 → insalubre
    }
  }

  for (const ext of todosExternos) {
    const surv = Math.max(0, calDias(ext.desde, ext.hasta) - extPerdidoCal[ext.id]);
    if (surv > 0)
      (ext.es_insalubre ? insalubrePeriodos : comunPeriodos).push(fromDias(surv));
  }

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
  const servIPSTotal    = sumPeriodos([servBeca, servNomb]);
  const servIPSAjustado = fromDias(ipsTotalSurv);

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
  let reqServicioDias: number;
  let reqEdadDias: number;
  let baseServicioDias: number;

  if (totalInsalubreDias > 0 && totalComunDias > 0) {
    reqServicioDias  = REQ_ORDINARIA.servicioDias; reqEdadDias = edadRequeridaMixtaDias; baseServicioDias = totalProrateadoDias;
  } else if (totalInsalubreDias > 0) {
    reqServicioDias  = REQ_INSALUBRE.servicioDias; reqEdadDias = REQ_INSALUBRE.edadDias; baseServicioDias = totalInsalubreDias;
  } else {
    reqServicioDias  = REQ_ORDINARIA.servicioDias; reqEdadDias = REQ_ORDINARIA.edadDias; baseServicioDias = totalComunDias;
  }

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
    total_prorateado:             totalProrateado,
    edad_actual:                  edad,
    tipo_jubilacion:              tipoJubilacion,
    cumple_servicio:              cumpleServicio,
    cumple_edad:                  cumpleEdad,
    falta_servicio:               fromDias(Math.max(0, reqServicioDias - baseServicioDias)),
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
                  ley_nombre, situacion_revista, es_insalubre_ips,
                  servicios_anses, servicios_externos, resultado, observaciones,
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
          servicios_anses:         body.servicios_anses,
          servicios_externos:      body.servicios_externos,
          resoluciones_manuales:   body.resoluciones_manuales ?? {},
        });

        const [insertResult] = await sequelize.query(
          `INSERT INTO jubilacion_calculos
             (dni, apellido, nombre, fecha_nacimiento, fecha_ingreso_ips, ley_nombre,
              situacion_revista, es_insalubre_ips,
              anses_anios, anses_meses, anses_dias, anses_insalubre,
              servicios_anses, servicios_externos, resultado, observaciones,
              creado_por, creado_por_nombre)
           VALUES
             (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso_ips, :ley_nombre,
              :situacion_revista, :es_insalubre_ips,
              0, 0, 0, 0,
              :servicios_anses, :servicios_externos, :resultado, :observaciones,
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
              es_insalubre_ips:   body.es_insalubre_ips ? 1 : 0,
              servicios_anses:    JSON.stringify(body.servicios_anses),
              servicios_externos: JSON.stringify(body.servicios_externos),
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
          servicios_anses:         body.servicios_anses,
          servicios_externos:      body.servicios_externos,
          resoluciones_manuales:   body.resoluciones_manuales ?? {},
        });

        await sequelize.query(
          `UPDATE jubilacion_calculos
           SET situacion_revista      = :situacion_revista,
               es_insalubre_ips       = :es_insalubre_ips,
               servicios_anses        = :servicios_anses,
               servicios_externos     = :servicios_externos,
               resultado              = :resultado,
               observaciones          = :observaciones,
               modificado_por         = :modificado_por,
               modificado_por_nombre  = :modificado_por_nombre
           WHERE id = :id AND deleted_at IS NULL`,
          {
            replacements: {
              id,
              situacion_revista:     body.situacion_revista,
              es_insalubre_ips:      body.es_insalubre_ips ? 1 : 0,
              servicios_anses:       JSON.stringify(body.servicios_anses),
              servicios_externos:    JSON.stringify(body.servicios_externos),
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
              es_insalubre, tipo_jubilacion, mes_corte, estado, observaciones, jubilacion_calculo_id,
              creado_por, creado_por_nombre)
           VALUES
             (:dni, :apellido, :nombre, :fecha_nacimiento, :fecha_ingreso, :ley_nombre, :ocupacion_nombre,
              :es_insalubre, :tipo_jubilacion, :mes_corte, :estado, :observaciones, :jubilacion_calculo_id,
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
              estado:                 body.estado,
              observaciones:          body.observaciones         ?? null,
              jubilacion_calculo_id:  body.jubilacion_calculo_id ?? null,
              creado_por:             userId,
              creado_por_nombre:      userName,
            },
            type: QueryTypes.INSERT,
          },
        );
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
      if (body.observaciones        !== undefined) { sets.push('observaciones = :observaciones');                repl.observaciones = body.observaciones; }
      if (body.jubilacion_calculo_id !== undefined) { sets.push('jubilacion_calculo_id = :jubilacion_calculo_id'); repl.jubilacion_calculo_id = body.jubilacion_calculo_id; }

      try {
        await sequelize.query(
          `UPDATE posibles_jubilados SET ${sets.join(', ')} WHERE id = :id AND deleted_at IS NULL`,
          { replacements: repl, type: QueryTypes.UPDATE },
        );
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
        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: '[posibles_jubilados] delete error', err: err?.message });
        return res.status(500).json({ ok: false, error: err?.message });
      }
    },
  );

  return router;
}
