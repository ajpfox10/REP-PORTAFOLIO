// src/services/sinSalidaEval.ts
//
// Evaluación de "sin salida" con el criterio CORREGIDO (por reloj/día, no por las
// horas del Excel, que están mal cargadas para parte del personal).
//
// Ejes:
//  1) ¿Fichó la salida?  -> por HORA + patrón (mismo día / cruza / 24h), sin corte fijo.
//  2) ¿Fichó bien?       -> por RELOJ (entrada/salida dedicados). Reloj equivocado o
//                           fuera de rango => MAL_FICHADO (a evaluar), pero cuenta la salida.
//  3) Si da "sin salida" pero el agente SÍ tiene una salida real ese día
//     (>=2h después de la entrada, en reloj de salida/bidi) => REVISAR_HORARIO
//     (horario mal cargado, NO es sin-salida real).
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
export type EstadoTurno = 'OK' | 'MAL_FICHADO' | 'SIN_SALIDA' | 'REVISAR_HORARIO' | 'SOLO_SALIDA' | 'SIN_FICHAJE';

export interface DiaSinSalida { fecha: string; turno: Turno; entrada: string | null; horaEntrada: string; horaSalida: string; }

export interface HorarioDiaResumen { dia: string; entrada: string; salida: string; horas: number; turno: Turno; }
export type TipoHorario = 'Guardia' | 'Semana' | 'Franquero' | 'Rotativo';
export interface HorarioResumen {
  tipo: TipoHorario;               // Guardia (24h) | Semana (L-V) | Franquero (finde+fijo) | Rotativo
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

function resumenHorario(dias: Record<string, { e: string; s: string }>): HorarioResumen {
  const trabaja = ORD_DIAS.filter(k => dias[k]);
  const groups: Record<string, string[]> = {};
  for (const k of ORD_DIAS) { if (!dias[k]) continue; const key = `${dias[k].e}-${dias[k].s}`; (groups[key] = groups[key] || []).push(k); }
  const partes = Object.entries(groups).map(([hr, ds]) => {
    const [e, s] = hr.split('-'); const h = durHoras(e, s); const turno = turnoDe(e, s);
    return `${ds.map(d => DIA_CORTO[d]).join('')} ${hr} (${h}h ${TURNO_TXT[turno]})`;
  });
  // ── Tipo de horario (reglas fijadas con el usuario) ──
  //   Guardia   : tiene algún turno de 24h (entrada = salida), en el día que sea.
  //   Semana    : solo lun-vie (ningún finde), sin 24h.
  //   Franquero : toca finde (S/D) y NO es semana completa (finde + día[s] fijo, típico 12h).
  //   Rotativo  : el resto (semana completa + finde, o combinación amplia).
  const tiene24 = trabaja.some(k => dias[k].e === dias[k].s);
  const tocaFinde = trabaja.some(k => k === 'sabado' || k === 'domingo');
  const semanaCompleta = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].every(k => !!dias[k]);
  let tipo: TipoHorario;
  if (tiene24) tipo = 'Guardia';
  else if (!tocaFinde) tipo = 'Semana';
  else if (!semanaCompleta) tipo = 'Franquero';
  else tipo = 'Rotativo';

  const esFranquero = tipo === 'Franquero';
  const horasSemana = Math.round(ORD_DIAS.reduce((a, k) => dias[k] ? a + durHoras(dias[k].e, dias[k].s) : a, 0) * 10) / 10;
  const resumen = partes.join('  ·  ');
  return {
    tipo, resumen,
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
  if (e === s) return 'GUARDIA';        // 24h
  if (s < e) return 'NOCHE';            // cruza medianoche
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

// ── evaluación principal ─────────────────────────────────────────────────────
export async function evaluarSinSalida(
  opts: EvalOpts,
  sequelize: import('sequelize').Sequelize,
): Promise<EvalResultado> {
  const empty = (dbError: string | null): EvalResultado => ({
    agentes: [], resumen: { turnos: { OK: 0, MAL_FICHADO: 0, SIN_SALIDA: 0, REVISAR_HORARIO: 0, SOLO_SALIDA: 0, SIN_FICHAJE: 0 }, agentesSinSalida: 0, diasSinSalida: 0, fechas: [] }, dbError,
  });
  if (!ExcelJS) return empty('Falta dependencia exceljs');

  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir || !fs.existsSync(dir)) return empty('EXCEL_ASISTENCIA_DIR no configurado o inexistente');

  const fechas = listarFechas(opts);
  if (fechas.length === 0) return empty(null);

  // ── horarios (todos los .xlsx con "horario" en el nombre, merge por DNI) ──
  const horarioFiles = fs.readdirSync(dir).filter(f => /\.xls[xm]?$/i.test(f) && f.toLowerCase().includes('horario'));
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
  if (Object.keys(H).length === 0) return empty('No se encontraron horarios en el Excel');

  // ── expandir agente×día programado ──
  type Turnoexp = { dni: string; f: string; e: string; s: string };
  const expanded: Turnoexp[] = [];
  for (const f of fechas) {
    const k = DOW_KEYS[new Date(f + 'T00:00:00Z').getUTCDay()];
    for (const [dni, dias] of Object.entries(H)) if (dias[k]) expanded.push({ dni, f, e: dias[k].e, s: dias[k].s });
  }
  if (expanded.length === 0) return empty(null);
  const allDnis = [...new Set(expanded.map(x => x.dni))];

  // ── DB biométrica ──
  const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
  if (!fs.existsSync(cfgPath)) return empty('fichero_config.json no encontrado');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));

  const rangoMin = fechas[0], rangoMax = fechas[fechas.length - 1];
  const rangoMaxPlus1 = addDaysIso(rangoMax, 1);

  const lector: Record<string, 'ENT' | 'SAL' | 'BIDI'> = {};
  const punches: Record<string, Array<{ ts: number; sn: string }>> = {};
  let dbError: string | null = null;
  try {
    const conn = await mysql.createConnection({
      host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
      user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '', database: cfg.mysqlDb || 'adms_db',
      connectTimeout: 10_000, dateStrings: true,
    });
    // clasificar relojes por checktype dominante
    const [snRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SN,'') SN, checktype, COUNT(*) c FROM checkinout WHERE SN IS NOT NULL AND SN<>'' GROUP BY SN, checktype`
    );
    const agg: Record<string, { e: number; s: number }> = {};
    for (const r of snRows) { const sn = String(r.SN); agg[sn] = agg[sn] || { e: 0, s: 0 }; if (String(r.checktype) === '0') agg[sn].e += Number(r.c); else agg[sn].s += Number(r.c); }
    for (const [sn, { e, s }] of Object.entries(agg)) { const t = e + s; if (!t) continue; const rs = s / t; lector[sn] = rs >= 0.98 ? 'SAL' : rs <= 0.02 ? 'ENT' : 'BIDI'; }

    const ph = allDnis.map(() => '?').join(',');
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ui.badgenumber dni, ci.checktime, COALESCE(ci.SN,'') SN
         FROM checkinout ci INNER JOIN userinfo ui ON ci.userid=ui.userid
        WHERE ui.badgenumber IN (${ph}) AND ci.checktime>=? AND ci.checktime<=?
        ORDER BY ci.checktime ASC`,
      [...allDnis, `${rangoMin} 00:00:00`, `${rangoMaxPlus1} 14:00:00`]
    );
    await conn.end();
    for (const r of rows) {
      const dni = normDni(r.dni);
      const ts = new Date(String(r.checktime).replace(' ', 'T')).getTime();
      (punches[dni] = punches[dni] || []).push({ ts, sn: String(r.SN) });
    }
  } catch (e: any) {
    return empty(e?.message ?? 'Error al consultar DB biométrica');
  }

  // ── clasificar cada turno ──
  const H2 = 2 * 3600000, H3 = 3 * 3600000, H1 = 3600000;
  const turnosCont: Record<EstadoTurno, number> = { OK: 0, MAL_FICHADO: 0, SIN_SALIDA: 0, REVISAR_HORARIO: 0, SOLO_SALIDA: 0, SIN_FICHAJE: 0 };
  const sinSalidaPorDni: Record<string, DiaSinSalida[]> = {};

  for (const t of expanded) {
    const cruza = t.s < t.e, g24 = t.s === t.e;
    const expEnt = dtLocal(t.f, toMin(t.e));
    const expSal = (cruza || g24) ? dtLocal(addDaysIso(t.f, 1), toMin(t.s)) : dtLocal(t.f, toMin(t.s));
    const mid = (expEnt + expSal) / 2;
    const lo = expEnt - H2, hi = expSal + H3;
    const ps = (punches[t.dni] || []).filter(p => p.ts >= lo && p.ts <= hi);
    const entSide = ps.filter(p => p.ts <= mid).sort((a, b) => a.ts - b.ts);
    const salSide = ps.filter(p => p.ts > mid).sort((a, b) => a.ts - b.ts);
    const ent = entSide[0] || null;
    const sal = salSide.length ? salSide[salSide.length - 1] : null;

    if (!ent && !sal) { turnosCont.SIN_FICHAJE++; continue; }
    if (!ent && sal) { turnosCont.SOLO_SALIDA++; continue; }
    if (ent && !sal) {
      // ¿tiene salida real que el horario no agarró? -> revisar horario, NO sin-salida.
      // Buscamos la primera marca del día y la ÚLTIMA marca en un RELOJ DE SALIDA
      // (no cualquier marca: así no confundimos la entrada de la mañana siguiente).
      const dLo = dtLocal(t.f, 0), dHi = dtLocal(addDaysIso(t.f, 1), 9 * 60);
      const day = (punches[t.dni] || []).filter(p => p.ts >= dLo && p.ts <= dHi).sort((a, b) => a.ts - b.ts);
      const first = day[0];
      const salPunches = day.filter(p => lector[p.sn] === 'SAL' || lector[p.sn] === 'BIDI');
      const lastSal = salPunches.length ? salPunches[salPunches.length - 1] : null;
      const salidaReal = !!first && !!lastSal && (lastSal.ts - first.ts) >= H2;
      if (salidaReal) { turnosCont.REVISAR_HORARIO++; }
      else {
        turnosCont.SIN_SALIDA++;
        const entHora = new Date(ent.ts); const p = (n: number) => String(n).padStart(2, '0');
        (sinSalidaPorDni[t.dni] = sinSalidaPorDni[t.dni] || []).push({
          fecha: t.f, turno: turnoDe(t.e, t.s), entrada: `${p(entHora.getHours())}:${p(entHora.getMinutes())}`, horaEntrada: t.e, horaSalida: t.s,
        });
      }
      continue;
    }
    // ent && sal -> validar reloj/hora
    if (ent && sal) {
      let mal = false;
      if (lector[ent.sn] === 'SAL') mal = true;
      if (lector[sal.sn] === 'ENT') mal = true;
      if (Math.abs(ent.ts - expEnt) > H1) mal = true;
      if (Math.abs(sal.ts - expSal) > H1) mal = true;
      if (mal) turnosCont.MAL_FICHADO++; else turnosCont.OK++;
    }
  }

  // ── enriquecer con personalv5 + filtros ──
  const dnisSS = Object.keys(sinSalidaPorDni);
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

  const fechasSet = new Set(fechas);
  const agentes: AgenteSinSalida[] = [];
  for (const dni of dnisSS) {
    const i = info[dni] || {};
    const ley = String(i.ley || '');
    if (opts.excluirResidentes && /RESIDENTE/i.test(ley)) continue;
    const servicio = String(i.servicio || '');
    if (servFilter && !servFilter.has(servicio.toUpperCase().trim())) continue;
    const ubicacion = UPA[dni] || 'HOSPITAL';
    if (ubicFilter && !ubicFilter.has(ubicacion.toUpperCase().trim())) continue;

    let dias = sinSalidaPorDni[dni];
    if (turnoFilter) dias = dias.filter(d => turnoFilter.has(d.turno));
    if (dias.length < minDias) continue;

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
      horario: resumenHorario(H[dni] || {}),
      coincidencia: analizarCoincidencia(H[dni] || {}, punches[dni] || [], fechasSet, lector),
    });
  }
  agentes.sort((a, b) => b.dias.length - a.dias.length || a.nombre.localeCompare(b.nombre));

  return {
    agentes,
    resumen: {
      turnos: turnosCont,
      agentesSinSalida: agentes.length,
      diasSinSalida: agentes.reduce((a, b) => a + b.dias.length, 0),
      fechas,
    },
    dbError,
  };
}
