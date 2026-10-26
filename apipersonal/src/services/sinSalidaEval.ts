// src/services/sinSalidaEval.ts
//
// Evaluación de "sin salida" con el criterio CORREGIDO (por reloj/día, no por las
// horas del Excel, que están mal cargadas para parte del personal).
//
// Objetivo: que el agente fiche ENTRADA y SALIDA, y que lo haga EN SU HORARIO.
//
// Ejes:
//  1) ¿Fichó entrada y salida? -> por HORA + patrón: guardia = sale al día siguiente
//     (salida <= entrada: 24h, nocturnas, salida 00:00). Cada marca se usa para UN solo
//     turno (turnos pegados no comparten marcas).
//  2) ¿Fichó en horario?       -> tolerancia de 30 min en entrada y salida. Fuera de eso
//     => FUERA_HORARIO (entró tarde, salió antes o después; entrar antes no es falta), pero cuenta la marca.
//     Reloj equivocado sin problema de hora => MAL_FICHADO.
//  3) Si da "sin salida" pero tiene una marca de salida más tarde (fuera de la ventana)
//     => REVISAR_HORARIO (ficha otro horario, NO es sin-salida real).
//  4) Semana alternada (una semana L-X-V, la otra M-J[-S]): se deduce de los fichajes de
//     las 8 semanas anteriores y solo se controlan los días de la semana que le toca.
//
// Este módulo es autocontenido a propósito (lee el Excel de horarios + la DB
// biométrica directamente) para poder usarse tanto en el reporte como en el
// módulo de notificaciones sin depender del estado interno de la ruta.

import fs from 'fs';
import path from 'path';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { QueryTypes } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let ExcelJS: any;
try { ExcelJS = require('exceljs'); } catch { ExcelJS = null; }

const DOW_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const;

export type Turno = 'MANIANA' | 'TARDE' | 'NOCHE' | 'GUARDIA';
export type EstadoTurno = 'OK' | 'FUERA_HORARIO' | 'MAL_FICHADO' | 'SIN_SALIDA' | 'REVISAR_HORARIO' | 'SOLO_SALIDA' | 'SIN_FICHAJE';

export interface DiaSinSalida { fecha: string; turno: Turno; entrada: string | null; horaEntrada: string; horaSalida: string; }

// Día fichado fuera de horario (o fuera de su semana): se informa, NO se notifica por mail.
export interface DiaFueraHorario {
  fecha: string; turno: Turno; horario: string;          // "08:00-14:00"
  entrada: string | null; salida: string | null;         // "07:55" / "17:40 (+1)"
  estado: 'FUERA_HORARIO' | 'MAL_FICHADO' | 'REVISAR_HORARIO' | 'FUERA_SEMANA';
  motivos: string[];                                     // "salió 3 h 40 min después", ...
}

export interface Alternancia { semanaA: string; semanaB: string; semanaHasta: string }

export interface HorarioDiaResumen { dia: string; entrada: string; salida: string; horas: number; turno: Turno; }
export type TipoHorario = 'Guardia' | 'Semana' | 'Franquero' | 'Rotativo';
export interface HorarioResumen {
  tipo: TipoHorario;               // Guardia (sale al día siguiente) | Semana (L-V) | Franquero (finde+fijo) | Rotativo
  alterna: Alternancia | null;     // semana A/B deducida de los fichajes
  resumen: string;                 // texto legible: "LMXJV 12:00-18:00 (6h Tarde)"
  porDia: HorarioDiaResumen[];
  esFranquero: boolean;
  diasSemana: number;             // cantidad de días que trabaja
  horasSemana: number;            // total de horas semanales
}

export interface Coincidencia {
  estado: 'coincide' | 'parcial' | 'no' | 'sin_datos';
  dias: boolean;                 // los días que ficha ⊆ días declarados
  hora: boolean;                 // hora de entrada real ≈ declarada
  declara: string;               // "Noche · LMXJV"
  ficha: string;                 // "Mañana · LMXJV"
}

export interface AgenteSinSalida {
  dni: string;
  nombre: string;      // apellido, nombre (personalv5)
  servicio: string;
  ley: string;
  profesion: string;
  ubicacion: string;   // HOSPITAL | UPA n
  email: string | null;
  emailValido: boolean;
  dias: DiaSinSalida[];
  fueraHorario: DiaFueraHorario[];
  horario: HorarioResumen;
  coincidencia: Coincidencia;
}

function mediana(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const ORD_IDX: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 }; // L..D para ordenar
const DOW_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const diasStr = (idxs: number[]) => [...new Set(idxs)].sort((a, b) => ORD_IDX[a] - ORD_IDX[b]).map(i => DOW_CORTO[i]).join('');
const turnoPorMin = (min: number): Turno => min < 360 ? 'NOCHE' : min < 720 ? 'MANIANA' : min < 1080 ? 'TARDE' : 'NOCHE';

// Compara el horario DECLARADO (Excel) con lo que el agente REALMENTE ficha en el período.
function analizarCoincidencia(
  schedule: Record<string, { e: string; s: string }>,
  punchesArr: Array<{ ts: number; sn: string }>,
  fechasSet: Set<string>,
  lector: Record<string, 'ENT' | 'SAL' | 'BIDI'>,
): Coincidencia {
  const declKeys = Object.keys(schedule);
  const declDows = declKeys.map(k => (DOW_KEYS as readonly string[]).indexOf(k));
  const declEntradasMin = declKeys.map(k => toMin(schedule[k].e));
  const declEntradaMin = mediana(declEntradasMin);
  // turno declarado dominante
  const declTurnoCount: Record<string, number> = {};
  for (const k of declKeys) { const t = turnoDe(schedule[k].e, schedule[k].s); declTurnoCount[t] = (declTurnoCount[t] || 0) + 1; }
  const declTurno = (Object.entries(declTurnoCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MANIANA') as Turno;

  // real: primera marca de ENTRADA (reloj ENT/BIDI) por día del período
  const byDay: Record<string, number> = {};
  const p2 = (n: number) => String(n).padStart(2, '0');
  for (const p of punchesArr) {
    if (lector[p.sn] === 'SAL') continue; // ignorar marcas en reloj de salida para estimar la entrada
    const d = new Date(p.ts);
    const f = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    if (!fechasSet.has(f)) continue;
    const min = d.getHours() * 60 + d.getMinutes();
    if (byDay[f] == null || min < byDay[f]) byDay[f] = min;
  }
  const realFechas = Object.keys(byDay);
  if (realFechas.length === 0) {
    return { estado: 'sin_datos', dias: false, hora: false, declara: `${TURNO_TXT[declTurno]} · ${diasStr(declDows)}`, ficha: '—' };
  }
  const realDows = realFechas.map(f => new Date(f + 'T00:00:00Z').getUTCDay());
  const realEntradaMin = mediana(Object.values(byDay));
  const realTurno = turnoPorMin(realEntradaMin);

  // eje días: fracción de días fichados que caen en días declarados
  const declSet = new Set(declDows);
  const enDeclarados = realDows.filter(d => declSet.has(d)).length / realDows.length;
  const diasOk = enDeclarados >= 0.7;
  const diasParcial = enDeclarados >= 0.4;

  // eje hora: diferencia circular entre entrada real y declarada
  const diff = Math.abs(realEntradaMin - declEntradaMin);
  const diffCirc = Math.min(diff, 1440 - diff);
  const horaOk = diffCirc <= 60;
  const horaParcial = diffCirc <= 180;

  let estado: Coincidencia['estado'];
  if (diasOk && horaOk) estado = 'coincide';
  else if (!diasParcial || !horaParcial) estado = 'no';
  else estado = 'parcial';

  return {
    estado, dias: diasOk, hora: horaOk,
    declara: `${TURNO_TXT[declTurno]} · ${diasStr(declDows)}`,
    ficha: `${TURNO_TXT[realTurno]} · ${diasStr(realDows)} (entra ~${p2(Math.floor(realEntradaMin / 60))}:${p2(realEntradaMin % 60)})`,
  };
}

const TURNO_TXT: Record<Turno, string> = { MANIANA: 'Mañana', TARDE: 'Tarde', NOCHE: 'Noche', GUARDIA: 'Guardia' };
const DIA_LARGO: Record<string, string> = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom' };
const DIA_CORTO: Record<string, string> = { lunes: 'L', martes: 'M', miercoles: 'X', jueves: 'J', viernes: 'V', sabado: 'S', domingo: 'D' };
const ORD_DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

function durHoras(e: string, s: string): number {
  const [eh, em] = e.split(':').map(Number), [sh, sm] = s.split(':').map(Number);
  let m = (sh * 60 + sm) - (eh * 60 + em);
  if (m <= 0) m += 1440;            // cruza medianoche / 24h
  return Math.round((m / 60) * 10) / 10;
}

function resumenHorario(dias: Record<string, { e: string; s: string }>, alterna: Alternancia | null = null): HorarioResumen {
  const trabaja = ORD_DIAS.filter(k => dias[k]);
  const groups: Record<string, string[]> = {};
  for (const k of ORD_DIAS) { if (!dias[k]) continue; const key = `${dias[k].e}-${dias[k].s}`; (groups[key] = groups[key] || []).push(k); }
  const partes = Object.entries(groups).map(([hr, ds]) => {
    const [e, s] = hr.split('-'); const h = durHoras(e, s); const turno = turnoDe(e, s);
    return `${ds.map(d => DIA_CORTO[d]).join('')} ${hr} (${h}h ${TURNO_TXT[turno]})`;
  });
  // ── Tipo de horario (reglas fijadas con el usuario) ──
  //   Guardia   : algún turno entra un día y sale el otro (salida <= entrada: 24h, noche, 00:00).
  //   Semana    : solo lun-vie (ningún finde), sin guardia.
  //   Franquero : toca finde (S/D) y NO es semana completa (finde + día[s] fijo, típico 12h).
  //   Rotativo  : el resto (semana completa + finde, o combinación amplia).
  const tiene24 = trabaja.some(k => dias[k].s <= dias[k].e);
  const tocaFinde = trabaja.some(k => k === 'sabado' || k === 'domingo');
  const semanaCompleta = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].every(k => !!dias[k]);
  let tipo: TipoHorario;
  if (tiene24) tipo = 'Guardia';
  else if (!tocaFinde) tipo = 'Semana';
  else if (!semanaCompleta) tipo = 'Franquero';
  else tipo = 'Rotativo';

  const esFranquero = tipo === 'Franquero';
  const horasSemana = Math.round(ORD_DIAS.reduce((a, k) => dias[k] ? a + durHoras(dias[k].e, dias[k].s) : a, 0) * 10) / 10;
  const resumen = (alterna ? `Alterna semanas ${alterna.semanaA} / ${alterna.semanaB} (la última del período: ${alterna.semanaHasta})  ·  ` : '') + partes.join('  ·  ');
  return {
    tipo, resumen, alterna,
    porDia: trabaja.map(k => ({ dia: DIA_LARGO[k], entrada: dias[k].e, salida: dias[k].s, horas: durHoras(dias[k].e, dias[k].s), turno: turnoDe(dias[k].e, dias[k].s) })),
    esFranquero, diasSemana: trabaja.length, horasSemana,
  };
}

export interface EvalOpts {
  periodo?: string;         // YYYY-MM
  desde?: string;           // YYYY-MM-DD
  hasta?: string;           // YYYY-MM-DD
  servicios?: string[];     // filtra por nombre de servicio (personalv5)
  turnos?: Turno[];         // filtra por turno del día flagueado
  ubicaciones?: string[];   // 'HOSPITAL' | 'UPA 4' ...
  excluirResidentes?: boolean;
  minDias?: number;         // mínimo de días sin salida para incluir al agente
}

export interface EvalResultado {
  agentes: AgenteSinSalida[];
  resumen: {
    turnos: Record<EstadoTurno, number>;
    agentesSinSalida: number;
    agentesFueraHorario: number;
    diasSinSalida: number;
    fechas: string[];
  };
  dbError: string | null;
}

// ── helpers ────────────────────────────────────────────────────────────────
const normHora = (v: any): string | null => {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};
const rawc = (v: any): string => String(v ?? '').trim();
const normDni = (v: any): string => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const addDaysIso = (iso: string, n: number): string => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// datetime LOCAL en ms (las fichadas vienen como string local con dateStrings:true)
const dtLocal = (iso: string, min: number): number => new Date(iso + 'T00:00:00').getTime() + min * 60000;
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emailValido = (e: string): boolean => !!e && emailRe.test(e) && !/^\d+$/.test(e);

function turnoDe(e: string, s: string): Turno {
  if (s <= e) return 'GUARDIA';         // entra un día y sale el otro (24h, nocturna, salida 00:00)
  if (e < '06:00') return 'NOCHE';      // 00:00-06:00
  if (e < '12:00') return 'MANIANA';
  if (e < '18:00') return 'TARDE';
  return 'NOCHE';
}

function resolveUpa(e5: string, e6: string): string {
  const nn = (x: string) => String(x ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const a = nn(e6), b = nn(e5);
  const m = a.match(/UPA\s*(\d+)/) || b.match(/UPA\s*(\d+)/) ||
    a.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/) || b.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  return m ? `UPA ${m[1]}` : 'HOSPITAL';
}

function listarFechas(opts: EvalOpts): string[] {
  const ayer = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const out: string[] = [];
  if (opts.periodo && /^\d{4}-\d{2}$/.test(opts.periodo)) {
    const [y, m] = opts.periodo.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) { const f = `${opts.periodo}-${String(d).padStart(2, '0')}`; if (f > ayer) break; out.push(f); }
  } else if (opts.desde && opts.hasta && /^\d{4}-\d{2}-\d{2}$/.test(opts.desde) && /^\d{4}-\d{2}-\d{2}$/.test(opts.hasta) && opts.desde <= opts.hasta) {
    let cur = opts.desde;
    while (cur <= opts.hasta && cur <= ayer) { out.push(cur); cur = addDaysIso(cur, 1); }
  }
  return out;
}

// ── ventanas y tolerancias ───────────────────────────────────────────────────
const H1 = 3600000, H2 = 2 * H1;
const TOL = 30 * 60000;           // tolerancia de horario en entrada y salida (fijada con el usuario)
const ANTES_ENT = 3 * H1;         // la entrada se busca hasta 3 h antes de la hora programada
const DESPUES_SAL = 6 * H1;       // la salida hasta 6 h después (pasada la tolerancia => FUERA_HORARIO)
const ALT_SEMANAS = 8;            // semanas anteriores al período para deducir la semana A/B

export type Punch = { ts: number; sn: string; ct: string };
// horario semanal (lunes..domingo → entrada/salida); puede variar por fecha (historial de horarios)
// (cruza: sale al día siguiente aunque salida > entrada, ej. 08:00–00:00 + 00:00–12:00 = 28 h)
export type HorarioSemana = Record<string, { e: string; s: string; cruza?: boolean }>;
type HorarioDe = (fecha: string) => HorarioSemana | null;
export const HORARIOS_ARCHIVO = 'HORARIOS.xlsx';
type TurnoExp = { f: string; e: string; s: string; expEnt: number; expSal: number; informar: boolean };

const dowDe = (iso: string): number => new Date(iso + 'T00:00:00Z').getUTCDay();
const lunesDe = (iso: string): string => { const w = dowDe(iso); return addDaysIso(iso, w === 0 ? -6 : 1 - w); };
const semIdx = (iso: string): number => Math.round(new Date(lunesDe(iso) + 'T00:00:00Z').getTime() / (7 * 86400000));
const dur = (ms: number): string => {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
};

// ── semana alternada (A = L-X-V, B = M-J[-S]) deducida de los fichajes ──────────
// Hay agentes cargados L-V (o L-S) que en realidad trabajan una semana L-X-V y la
// siguiente M-J(-S). Se mira en qué días programados fichó la entrada cada semana;
// si las semanas alternan de forma consistente se fija la "fase" (qué paridad de
// semana es la A) y se usa también para semanas sin fichajes (licencia, vacaciones).
interface Alt { A: number[]; B: number[]; fase: number }
const esSemanaA = (alt: Alt, f: string): boolean => ((semIdx(f) % 2) + 2) % 2 === alt.fase;
const esperaDia = (alt: Alt | null, f: string): boolean => {
  if (!alt) return true;
  const dow = dowDe(f), enA = alt.A.includes(dow), enB = alt.B.includes(dow);
  if (!enA && !enB) return true;          // domingo: no entra en la alternancia
  return esSemanaA(alt, f) ? enA : enB;
};

function detectarAlternancia(
  hDe: HorarioDe, ps: Punch[], desde: string, hasta: string,
  lector: Record<string, 'ENT' | 'SAL' | 'BIDI'>,
): Alt | null {
  const decl = Object.keys(hDe(hasta) || {}).map(k => (DOW_KEYS as readonly string[]).indexOf(k));
  const A = [1, 3, 5].filter(d => decl.includes(d)), B = [2, 4, 6].filter(d => decl.includes(d));
  if (A.length < 2 || B.length < 2) return null;
  const porSemana = new Map<number, Set<number>>();
  for (let f = desde; f <= hasta; f = addDaysIso(f, 1)) {
    const dow = dowDe(f);
    if (!A.includes(dow) && !B.includes(dow)) continue;
    const td = hDe(f)?.[DOW_KEYS[dow]];
    if (!td) continue;
    const e = dtLocal(f, toMin(td.e));
    if (!ps.some(p => lector[p.sn] !== 'SAL' && p.ts >= e - ANTES_ENT && p.ts <= e + ANTES_ENT)) continue;
    const w = semIdx(f);
    if (!porSemana.has(w)) porSemana.set(w, new Set());
    porSemana.get(w)!.add(dow);
  }
  const votos = [0, 0];
  let tipadas = 0, completas = 0;
  for (const [w, s] of porSemana) {
    const a = A.filter(d => s.has(d)).length, b = B.filter(d => s.has(d)).length;
    const par = ((w % 2) + 2) % 2;
    if (a >= 2 && b >= 2) completas++;
    else if (a >= 2 && b === 0) { votos[par]++; tipadas++; }
    else if (b >= 2 && a === 0) { votos[1 - par]++; tipadas++; }
  }
  if (tipadas < 3 || completas > Math.max(1, porSemana.size * 0.2)) return null;
  const fase = votos[0] >= votos[1] ? 0 : 1;
  if (votos[fase] / tipadas < 0.8) return null;
  return { A, B, fase };
}

// ── fichadas del reloj (adms_db.checkinout, cubre todos los relojes) ───────────
// Trae desde 8 semanas antes del período (para la semana A/B) hasta 2 días después.
// tipo de cada reloj (ENT/SAL/BIDI): cambia solo si se agrega o reconfigura un reloj
const LECTOR_CACHE_MS = 30 * 60_000;
let lectorCache: { ts: number; lector: Record<string, 'ENT' | 'SAL' | 'BIDI'> } | null = null;

export async function leerFichadas(
  dnis: string[], desde: string, hasta: string,
): Promise<{ lector: Record<string, 'ENT' | 'SAL' | 'BIDI'>; punches: Record<string, Punch[]> } | { error: string }> {
  const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
  if (!fs.existsSync(cfgPath)) return { error: 'fichero_config.json no encontrado' };
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  const lector: Record<string, 'ENT' | 'SAL' | 'BIDI'> = {};
  const punches: Record<string, Punch[]> = {};
  if (!dnis.length) return { lector, punches };
  try {
    const conn = await mysql.createConnection({
      host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
      user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '', database: cfg.mysqlDb || 'adms_db',
      connectTimeout: 10_000, dateStrings: true,
    });
    try {
      // clasificar relojes por checktype dominante (recorre toda la tabla, ~2 s: se cachea)
      if (lectorCache && Date.now() - lectorCache.ts < LECTOR_CACHE_MS) Object.assign(lector, lectorCache.lector);
      else {
        const [snRows] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(SN,'') SN, checktype, COUNT(*) c FROM checkinout WHERE SN IS NOT NULL AND SN<>'' GROUP BY SN, checktype`
        );
        const agg: Record<string, { e: number; s: number }> = {};
        for (const r of snRows) { const sn = String(r.SN); agg[sn] = agg[sn] || { e: 0, s: 0 }; if (String(r.checktype) === '0') agg[sn].e += Number(r.c); else agg[sn].s += Number(r.c); }
        for (const [sn, { e, s }] of Object.entries(agg)) { const t = e + s; if (!t) continue; const rs = s / t; lector[sn] = rs >= 0.98 ? 'SAL' : rs <= 0.02 ? 'ENT' : 'BIDI'; }
        lectorCache = { ts: Date.now(), lector: { ...lector } };
      }

      const ph = dnis.map(() => '?').join(',');
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ui.badgenumber dni, ci.checktime, ci.checktype, COALESCE(ci.SN,'') SN
           FROM checkinout ci INNER JOIN userinfo ui ON ci.userid=ui.userid
          WHERE ui.badgenumber IN (${ph}) AND ci.checktime>=? AND ci.checktime<?
          ORDER BY ci.checktime ASC`,
        [...dnis, `${addDaysIso(lunesDe(desde), -7 * ALT_SEMANAS)} 00:00:00`, `${addDaysIso(hasta, 2)} 00:00:00`]
      );
      for (const r of rows) {
        const dni = normDni(r.dni);
        const ts = new Date(String(r.checktime).replace(' ', 'T')).getTime();
        (punches[dni] = punches[dni] || []).push({ ts, sn: String(r.SN), ct: String(r.checktype) });
      }
    } finally { await conn.end(); }
  } catch (e: any) {
    return { error: e?.message ?? 'Error al consultar DB biométrica' };
  }
  return { lector, punches };
}

// ── evaluación de los turnos de UN agente ──────────────────────────────────────
// Un resultado por turno programado (y esperado, si alterna semanas) de las fechas
// pedidas. Los turnos que todavía no terminaron (salida + 6 h) van a enCurso.
export interface TurnoEvaluado {
  fecha: string; horaEntrada: string; horaSalida: string; turno: Turno; estado: EstadoTurno;
  entrada: string | null; salida: string | null;   // "07:55" / "06:02 (+1)"
  motivos: string[];
  // instantes (ms) para calcular horas / minutos tarde en otros reportes
  progEntTs: number; progSalTs: number; entradaTs: number | null; salidaTs: number | null;
}
export interface EvalAgente {
  alterna: Alternancia | null;
  turnos: TurnoEvaluado[];
  fueraSemana: DiaFueraHorario[];
  enCurso: string[];
  noToca: string[];        // días con horario cargado que esa semana no le tocan (semana alternada)
  libres: Punch[];         // marcas del período que no son de ningún turno (fichó sin horario)
}

const p2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (ts: number, f: string) => {
  const d = new Date(ts); const fd = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return `${p2(d.getHours())}:${p2(d.getMinutes())}${fd > f ? ' (+1)' : fd < f ? ' (-1)' : ''}`;
};

export function evaluarAgente(
  horario: HorarioSemana | HorarioDe, punchesAgente: Punch[],
  lector: Record<string, 'ENT' | 'SAL' | 'BIDI'>, fechas: string[], ahora: number = Date.now(),
): EvalAgente {
  const rangoMin = fechas[0], rangoMax = fechas[fechas.length - 1];
  const fechasSet = new Set(fechas);
  const hDe: HorarioDe = typeof horario === 'function' ? horario : () => horario;
  const turnoDia = (f: string) => hDe(f)?.[DOW_KEYS[dowDe(f)]];
  const ps = punchesAgente.slice().sort((a, b) => a.ts - b.ts);
  const alt = detectarAlternancia(hDe, ps, addDaysIso(lunesDe(rangoMin), -7 * ALT_SEMANAS), addDaysIso(rangoMax, 1), lector);
  const out: EvalAgente = {
    alterna: alt ? { semanaA: diasStr(alt.A), semanaB: diasStr(alt.B), semanaHasta: diasStr(esSemanaA(alt, rangoMax) ? alt.A : alt.B) } : null,
    turnos: [], fueraSemana: [], enCurso: [], noToca: [], libres: [],
  };
  const esSal = (p: Punch) => lector[p.sn] === 'SAL' || (lector[p.sn] === 'BIDI' && p.ct === '1');

  // turnos esperados (un día antes y uno después del rango para que no "roben" marcas)
  const T: TurnoExp[] = [];
  for (let f = addDaysIso(rangoMin, -1); f <= addDaysIso(rangoMax, 1); f = addDaysIso(f, 1)) {
    const t = turnoDia(f);
    if (!t || !esperaDia(alt, f)) continue;
    const expEnt = dtLocal(f, toMin(t.e));
    const expSal = t.s <= t.e || t.cruza ? dtLocal(addDaysIso(f, 1), toMin(t.s)) : dtLocal(f, toMin(t.s));
    T.push({ f, e: t.e, s: t.s, expEnt, expSal, informar: fechasSet.has(f) && expSal + DESPUES_SAL <= ahora });
  }

  // cada marca se asigna a UN solo turno, recorriendo en orden
  const usada = new Set<number>();
  const res: Array<{ t: TurnoExp; ent: number; sal: number; continuado?: boolean }> = [];
  for (let i = 0; i < T.length; i++) {
    const t = T[i], n = T[i + 1];
    const mid = (t.expEnt + t.expSal) / 2;
    const nLo = n ? n.expEnt - ANTES_ENT : Infinity;
    const ie = ps.findIndex((p, j) => !usada.has(j) && p.ts >= t.expEnt - ANTES_ENT && p.ts <= mid);
    // salida: última marca libre después de la mitad, hasta 6 h tarde; si el turno siguiente
    // está pegado, en la zona compartida solo vale una marca de reloj de salida (si este turno
    // tiene entrada, hasta la mitad del siguiente: el que sale tarde de la guardia no "entra")
    const nTope = n ? (ie >= 0 ? Math.min(n.expEnt + ANTES_ENT, (n.expEnt + n.expSal) / 2) : n.expEnt + TOL) : Infinity;
    let is = -1;
    for (let j = ps.length - 1; j >= 0; j--) {
      const p = ps[j];
      if (usada.has(j) || j === ie || p.ts <= mid || p.ts > t.expSal + DESPUES_SAL) continue;
      if (p.ts < nLo || (esSal(p) && p.ts <= nTope)) { is = j; break; }
    }
    // se fue antes de la mitad del turno: marca de salida al menos 30 min después de entrar
    if (is < 0 && ie >= 0) {
      for (let j = ps.length - 1; j > ie; j--) {
        const p = ps[j];
        if (!usada.has(j) && p.ts <= mid && p.ts >= ps[ie].ts + TOL && esSal(p)) { is = j; break; }
      }
    }
    if (ie >= 0) {
      const hasta = is >= 0 ? ps[is].ts : ps[ie].ts + TOL;   // doble toque en la entrada
      ps.forEach((p, j) => { if (p.ts >= ps[ie].ts && p.ts <= hasta) usada.add(j); });
    } else if (is >= 0) usada.add(is);
    res.push({ t, ent: ie, sal: is });
  }
  // turnos pegados sin marcar en el medio (ej. 24h + 24h seguidas): es un turno continuado
  for (let i = 0; i + 1 < res.length; i++) {
    const a = res[i], b = res[i + 1];
    if (a.ent >= 0 && a.sal < 0 && b.ent < 0 && b.sal >= 0 && Math.abs(b.t.expEnt - a.t.expSal) <= H1) { a.continuado = true; b.continuado = true; }
  }

  for (const r of res) {
    if (!fechasSet.has(r.t.f)) continue;
    if (!r.t.informar) { out.enCurso.push(r.t.f); continue; }
    const { t } = r;
    const ent = r.ent >= 0 ? ps[r.ent] : null, sal = r.sal >= 0 ? ps[r.sal] : null;
    const turno = turnoDe(t.e, t.s), horario = `${t.e}-${t.s}`;
    const motivos: string[] = [];
    // entrar antes NO es falta (decisión del usuario): solo tarde / salió antes / salió después
    if (ent && ent.ts > t.expEnt + TOL) motivos.push(`entró ${dur(ent.ts - t.expEnt)} tarde`);
    if (sal && sal.ts < t.expSal - TOL) motivos.push(`salió ${dur(t.expSal - sal.ts)} antes`);
    if (sal && sal.ts > t.expSal + TOL) motivos.push(`salió ${dur(sal.ts - t.expSal)} después`);
    const push = (estado: EstadoTurno, extra: string[] = [], entrada = ent, salida = sal, mot = motivos) => out.turnos.push({
      fecha: t.f, horaEntrada: t.e, horaSalida: t.s, turno, estado,
      entrada: entrada ? hhmm(entrada.ts, t.f) : null, salida: salida ? hhmm(salida.ts, t.f) : null, motivos: [...mot, ...extra],
      progEntTs: t.expEnt, progSalTs: t.expSal, entradaTs: entrada ? entrada.ts : null, salidaTs: salida ? salida.ts : null,
    });

    if (r.continuado) {
      // la entrada es del primer turno y la salida del segundo: se controla solo la hora
      push(motivos.length ? 'FUERA_HORARIO' : 'OK', ['turno continuado']);
      continue;
    }
    if (!ent && !sal) { push('SIN_FICHAJE'); continue; }
    if (!ent) { push('SOLO_SALIDA'); continue; }
    if (!sal) {
      // la "entrada" es en realidad una SALIDA de otro horario: entró horas antes (fuera de la
      // ventana) y salió cerca de la hora de entrada programada -> ficha otro horario
      const antes = esSal(ent) ? ps.find((p, j) => !usada.has(j) && !esSal(p) && p.ts <= ent.ts - H2 && p.ts >= ent.ts - 16 * H1) : undefined;
      if (antes) {
        push('REVISAR_HORARIO', [], antes, ent,
          [`entró ${dur(Math.abs(antes.ts - t.expEnt))} ${antes.ts < t.expEnt ? 'antes' : 'tarde'} y salió ${dur(Math.abs(t.expSal - ent.ts))} ${ent.ts < t.expSal ? 'antes' : 'después'} (ficha otro horario)`]);
        continue;
      }
      // ¿tiene una marca de salida más tarde, fuera de la ventana? -> ficha otro horario
      const tarde = ps.find((p, j) => !usada.has(j) && esSal(p) && p.ts >= ent.ts + H2 && p.ts <= ent.ts + 20 * H1);
      if (tarde) push('REVISAR_HORARIO', [tarde.ts > t.expSal ? `salió ${dur(tarde.ts - t.expSal)} después (ficha otro horario)` : 'ficha otro horario'], ent, tarde);
      else push('SIN_SALIDA');
      continue;
    }
    const reloj: string[] = [];
    if (lector[ent.sn] === 'SAL') reloj.push('entrada en reloj de salida');
    if (lector[sal.sn] === 'ENT') reloj.push('salida en reloj de entrada');
    push(motivos.length ? 'FUERA_HORARIO' : reloj.length ? 'MAL_FICHADO' : 'OK', reloj);
  }

  // semana alternada: fichó un día que esa semana no le tocaba
  if (alt) {
    for (const f of fechas) {
      const t = turnoDia(f);
      if (!t || esperaDia(alt, f)) continue;
      out.noToca.push(f);
      const e = dtLocal(f, toMin(t.e));
      const j = ps.findIndex((p, k) => !usada.has(k) && lector[p.sn] !== 'SAL' && p.ts >= e - ANTES_ENT && p.ts <= e + ANTES_ENT);
      if (j < 0) continue;
      out.fueraSemana.push({
        fecha: f, turno: turnoDe(t.e, t.s), horario: `${t.e}-${t.s}`, entrada: hhmm(ps[j].ts, f), salida: null, estado: 'FUERA_SEMANA',
        motivos: [`fichó fuera de su semana (esa semana le toca ${diasStr(esSemanaA(alt, f) ? alt.A : alt.B)})`],
      });
    }
  }
  const lo = dtLocal(rangoMin, 0), hi = dtLocal(addDaysIso(rangoMax, 1), 0);
  out.libres = ps.filter((p, j) => !usada.has(j) && p.ts >= lo && p.ts < hi);
  return out;
}


// ── evaluación principal ─────────────────────────────────────────────────────
export async function evaluarSinSalida(
  opts: EvalOpts,
  sequelize: import('sequelize').Sequelize,
): Promise<EvalResultado> {
  const empty = (dbError: string | null): EvalResultado => ({
    agentes: [], resumen: { turnos: { OK: 0, FUERA_HORARIO: 0, MAL_FICHADO: 0, SIN_SALIDA: 0, REVISAR_HORARIO: 0, SOLO_SALIDA: 0, SIN_FICHAJE: 0 }, agentesSinSalida: 0, agentesFueraHorario: 0, diasSinSalida: 0, fechas: [] }, dbError,
  });
  if (!ExcelJS) return empty('Falta dependencia exceljs');

  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir || !fs.existsSync(dir)) return empty('EXCEL_ASISTENCIA_DIR no configurado o inexistente');

  const fechas = listarFechas(opts);
  if (fechas.length === 0) return empty(null);

  // ── horarios: SOLO HORARIOS.xlsx (horario completo del día, lo baja el robot a las 05:50).
  // HORARIO_GUARDIA trae solo los días de guardia de SIAPE y HORARIO_CONSOLIDADO no trae horas:
  // mezclarlos pisaba el horario completo con uno parcial o viejo.
  const horarioFiles = fs.existsSync(path.join(dir, HORARIOS_ARCHIVO)) ? [HORARIOS_ARCHIVO] : [];
  const H: Record<string, Record<string, { e: string; s: string }>> = {};
  const UPA: Record<string, string> = {};
  const cols: Record<string, [number, number]> = { lunes: [5, 6], martes: [7, 8], miercoles: [9, 10], jueves: [11, 12], viernes: [13, 14], sabado: [15, 16], domingo: [17, 18] };
  for (const fn of horarioFiles) {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(path.join(dir, fn));
      const ws = wb.worksheets[0];
      if (!ws) continue;
      ws.eachRow((r: any, rn: number) => {
        if (rn === 1) return;
        const dni = normDni(r.getCell(4).value);
        if (!dni) return;
        const dias: Record<string, { e: string; s: string }> = {};
        for (const [k, [ce, cs]] of Object.entries(cols)) {
          const e = normHora(r.getCell(ce).value), s = normHora(r.getCell(cs).value);
          if (e && s) dias[k] = { e, s };
        }
        if (Object.keys(dias).length) H[dni] = dias;
        UPA[dni] = resolveUpa(rawc(r.getCell(27).value), rawc(r.getCell(28).value));
      });
    } catch (e: any) {
      logger.warn({ msg: 'sinSalidaEval: error leyendo horarios', file: fn, error: e?.message });
    }
  }
  if (Object.keys(H).length === 0) return empty(`No se encontraron horarios en ${HORARIOS_ARCHIVO}`);

  // ── DB biométrica (todos los agentes con horario; desde 8 semanas antes para deducir la semana A/B) ──
  const allDnis = Object.keys(H);
  const rangoMax = fechas[fechas.length - 1];
  const fich = await leerFichadas(allDnis, fechas[0], rangoMax);
  if ('error' in fich) return empty(fich.error);
  const { lector, punches } = fich;
  const dbError: string | null = null;

  // ── clasificar cada turno ──
  const turnosCont: Record<EstadoTurno, number> = { OK: 0, FUERA_HORARIO: 0, MAL_FICHADO: 0, SIN_SALIDA: 0, REVISAR_HORARIO: 0, SOLO_SALIDA: 0, SIN_FICHAJE: 0 };
  const sinSalidaPorDni: Record<string, DiaSinSalida[]> = {};
  const fueraPorDni: Record<string, DiaFueraHorario[]> = {};
  const alternaPorDni: Record<string, Alternancia> = {};
  const fechasSet = new Set(fechas);
  for (const dni of allDnis) {
    const ev = evaluarAgente(H[dni], punches[dni] || [], lector, fechas);
    if (ev.alterna) alternaPorDni[dni] = ev.alterna;
    const fuera: DiaFueraHorario[] = [...ev.fueraSemana];
    for (const t of ev.turnos) {
      turnosCont[t.estado]++;
      if (t.estado === 'SIN_SALIDA') (sinSalidaPorDni[dni] = sinSalidaPorDni[dni] || []).push({ fecha: t.fecha, turno: t.turno, entrada: t.entrada, horaEntrada: t.horaEntrada, horaSalida: t.horaSalida });
      else if (t.estado === 'FUERA_HORARIO' || t.estado === 'MAL_FICHADO' || t.estado === 'REVISAR_HORARIO') {
        fuera.push({ fecha: t.fecha, turno: t.turno, horario: `${t.horaEntrada}-${t.horaSalida}`, entrada: t.entrada, salida: t.salida, estado: t.estado, motivos: t.motivos });
      }
    }
    if (fuera.length) fueraPorDni[dni] = fuera.sort((x, y) => x.fecha.localeCompare(y.fecha));
  }

  // ── enriquecer con personalv5 + filtros ──
  const dnisSS = [...new Set([...Object.keys(sinSalidaPorDni), ...Object.keys(fueraPorDni)])];
  const info: Record<string, any> = {};
  if (dnisSS.length) {
    const rows = await sequelize.query<any>(
      `SELECT p.dni, p.apellido, p.nombre, p.email, l.nombre AS ley, oc.nombre AS profesion,
              (SELECT s.nombre FROM agentes_servicios asv JOIN servicios s ON s.id=asv.servicio_id AND s.deleted_at IS NULL
                WHERE asv.dni=p.dni AND asv.deleted_at IS NULL AND (asv.fecha_hasta IS NULL OR asv.fecha_hasta>=CURDATE())
                ORDER BY asv.fecha_desde DESC LIMIT 1) AS servicio
         FROM personal p
         LEFT JOIN agentes a ON a.dni=p.dni AND a.deleted_at IS NULL
         LEFT JOIN ley l ON l.id=a.ley_id
         LEFT JOIN ocupaciones oc ON oc.id=a.ocupacion_id
        WHERE p.dni IN (:dnis)`,
      { type: QueryTypes.SELECT, replacements: { dnis: dnisSS.map(Number) } }
    );
    for (const r of rows) info[String(r.dni)] = r;
  }

  const servFilter = opts.servicios && opts.servicios.length ? new Set(opts.servicios.map(s => s.toUpperCase().trim())) : null;
  const turnoFilter = opts.turnos && opts.turnos.length ? new Set(opts.turnos) : null;
  const ubicFilter = opts.ubicaciones && opts.ubicaciones.length ? new Set(opts.ubicaciones.map(u => u.toUpperCase().trim())) : null;
  const minDias = Math.max(1, Number(opts.minDias) || 1);

  const agentes: AgenteSinSalida[] = [];
  for (const dni of dnisSS) {
    const i = info[dni] || {};
    const ley = String(i.ley || '');
    if (opts.excluirResidentes && /RESIDENTE/i.test(ley)) continue;
    const servicio = String(i.servicio || '');
    if (servFilter && !servFilter.has(servicio.toUpperCase().trim())) continue;
    const ubicacion = UPA[dni] || 'HOSPITAL';
    if (ubicFilter && !ubicFilter.has(ubicacion.toUpperCase().trim())) continue;

    let dias = sinSalidaPorDni[dni] || [];
    let fuera = fueraPorDni[dni] || [];
    if (turnoFilter) { dias = dias.filter(d => turnoFilter.has(d.turno)); fuera = fuera.filter(d => turnoFilter.has(d.turno)); }
    if (dias.length < minDias && fuera.length === 0) continue;

    const email = String(i.email || '').trim() || null;
    agentes.push({
      dni,
      nombre: `${String(i.apellido || '').trim()}, ${String(i.nombre || '').trim()}`.replace(/^, |, $/g, ''),
      servicio: servicio || '-',
      ley: ley || '-',
      profesion: String(i.profesion || '-'),
      ubicacion,
      email,
      emailValido: !!email && emailValido(email),
      dias: dias.sort((a, b) => a.fecha.localeCompare(b.fecha)),
      fueraHorario: fuera,
      horario: resumenHorario(H[dni] || {}, alternaPorDni[dni] || null),
      coincidencia: analizarCoincidencia(H[dni] || {}, punches[dni] || [], fechasSet, lector),
    });
  }
  agentes.sort((a, b) => b.dias.length - a.dias.length || a.nombre.localeCompare(b.nombre));

  return {
    agentes,
    resumen: {
      turnos: turnosCont,
      agentesSinSalida: agentes.filter(a => a.dias.length > 0).length,
      agentesFueraHorario: agentes.filter(a => a.fueraHorario.length > 0).length,
      diasSinSalida: agentes.reduce((a, b) => a + b.dias.length, 0),
      fechas,
    },
    dbError,
  };
}
