// src/services/ausentismoEval.ts
// Nivel de ausentismo por dependencia / servicio / sector, abierto por régimen horario.
//
// CRITERIOS (fijados con el usuario):
//   · Régimen: turno de MÁS de 12 hs → GUARDIA. 12 hs exactas o menos → PLANTA.
//   · Turnos partidos por medianoche: el Excel los trae en dos filas
//     (`mar 08:00-00:00` + `mie 00:00-13:00`). Se unen en un solo turno; si no,
//     la guardia se pierde y se cuenta como dos días sueltos.
//   · Ausencia NO PROGRAMADA: enfermedad, familiar enfermo, ausente sin aviso.
//   · Ausencia PROGRAMADA: el resto de las licencias.
//   · PRESENTISMO (llegó tarde, boleta de salida, error de sistema): categoría
//     aparte, NO suma al ausentismo.
//   · Franco compensatorio y PRESENTE: se ignoran (no son ausencia).
//
// Denominador: turnos programados según D:\...\HORARIOS.xlsx (EXCEL_ASISTENCIA_DIR).
// Numerador:   tabla `historial` (novedades SIAPE), rangos fecha_desde..fecha_hasta.
//
// El mapeo de novedades vive en EXCEL_ASISTENCIA_DIR\mapeo.ausentismo.json y se
// puede editar en caliente (mismo patrón que mapeo.asistencia.json).

import fs from 'fs';
import path from 'path';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let ExcelJS: any;
try { ExcelJS = require('exceljs'); } catch { ExcelJS = null; }

// ── tipos ────────────────────────────────────────────────────────────────────
export type Categoria = 'NO_PROGRAMADA' | 'PROGRAMADA' | 'PRESENTISMO' | 'IGNORAR';
export type Regimen = 'GUARDIA' | 'PLANTA';

export interface Turno {
  dia: string;          // lunes..domingo (día en que ARRANCA el turno)
  entrada: string;      // HH:MM
  salida: string;       // HH:MM
  horas: number;
  cruza: boolean;       // termina al día siguiente
}

export interface AgenteAusentismo {
  dni: string;
  nombre: string;
  apellido: string | null;
  agrupamiento: string;
  ocupacion: string | null;
  dependencia: string;
  servicio: string;
  sector: string;
  regimen: Regimen;
  horario: string;              // línea legible
  horasSemana: number;
  turnosProg: number;
  horasProg: number;
  turnosNoProg: number;         // turnos perdidos por ausencia no programada
  horasNoProg: number;
  turnosProgramada: number;
  horasProgramada: number;
  turnosPresentismo: number;
  eventosNoProg: number;
  eventosProgramada: number;
  pctNoProgramada: number;
  pctProgramada: number;
  pctTotal: number;
}

export interface GrupoAusentismo {
  clave: string;
  dependencia: string;
  servicio: string;
  sector: string;
  agentes: number;
  guardia: number;
  planta: number;
  conAusencia: number;
  turnosProg: number;
  horasProg: number;
  turnosNoProg: number;
  horasNoProg: number;
  turnosProgramada: number;
  horasProgramada: number;
  turnosPresentismo: number;
  pctNoProgramada: number;
  pctProgramada: number;
  pctTotal: number;
  // apertura por régimen
  porRegimen: Record<Regimen, {
    agentes: number; turnosProg: number; turnosNoProg: number; turnosProgramada: number;
    horasProg: number; horasNoProg: number; pctNoProgramada: number; pctProgramada: number;
  }>;
}

export interface ResultadoAusentismo {
  desde: string;
  hasta: string;
  nivel: Nivel;
  grupos: GrupoAusentismo[];
  agentes: AgenteAusentismo[];
  totales: Omit<GrupoAusentismo, 'clave' | 'dependencia' | 'servicio' | 'sector'>;
  porNovedad: { novedad: string; categoria: Categoria; turnos: number; eventos: number }[];
  advertencias: string[];
}

export type Nivel = 'dependencia' | 'servicio' | 'sector';

// ── mapeo de novedades ───────────────────────────────────────────────────────
const NO_PROGRAMADAS_DEF = [
  'ENFERMEDAD',
  'ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE',
  'ATENCION FAMILIAR ENFERMO',
  'AUSENTE SIN AVISO',
];
const PRESENTISMO_DEF = [
  'LLEGO TARDE',
  'BOLETA DE SALIDA',
  'BOLETA DE SALIDA - OFICIAL',
  'ERROR EN SISTEMA CONTROL DE ACCESO (PS)',
  'COMISION DE ENTRADA',
];
const IGNORAR_DEF = [
  'PRESENTE',
  'FRANCO COMPENSATORIO',
  'FRANCO COMPENSATORIO (COMUNICACIONES)',
  'FRANCO COMPENSATORIO (AERONAUTICOS)',
  'TELETRABAJO',
];

export interface MapeoAusentismo {
  no_programadas: string[];
  presentismo: string[];
  ignorar: string[];
}

export function mapeoPath(): string | null {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  return dir ? path.join(dir, 'mapeo.ausentismo.json') : null;
}

export function leerMapeo(): MapeoAusentismo {
  const base: MapeoAusentismo = {
    no_programadas: [...NO_PROGRAMADAS_DEF],
    presentismo: [...PRESENTISMO_DEF],
    ignorar: [...IGNORAR_DEF],
  };
  const fp = mapeoPath();
  if (!fp || !fs.existsSync(fp)) return base;
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return {
      no_programadas: Array.isArray(j.no_programadas) ? j.no_programadas : base.no_programadas,
      presentismo: Array.isArray(j.presentismo) ? j.presentismo : base.presentismo,
      ignorar: Array.isArray(j.ignorar) ? j.ignorar : base.ignorar,
    };
  } catch (e: any) {
    logger.warn({ msg: 'ausentismo: mapeo.ausentismo.json ilegible, uso defaults', error: e?.message });
    return base;
  }
}

function categorizar(mapeo: MapeoAusentismo) {
  const up = (s: string) => s.trim().toUpperCase();
  const noProg = new Set(mapeo.no_programadas.map(up));
  const pres = new Set(mapeo.presentismo.map(up));
  const ign = new Set(mapeo.ignorar.map(up));
  return (novedad: string): Categoria => {
    const n = up(novedad || '');
    if (noProg.has(n)) return 'NO_PROGRAMADA';
    if (pres.has(n)) return 'PRESENTISMO';
    if (ign.has(n)) return 'IGNORAR';
    return 'PROGRAMADA';
  };
}

// ── ocupación ────────────────────────────────────────────────────────────────
// Las ocupaciones vienen abiertas por categoría salarial: "Auxiliar de Farmacia A",
// "Auxiliar de Farmacia B", "AUXILIAR FARMACIA"... Para agrupar hay que unificarlas:
// se saca la letra de categoría del final, los acentos y las preposiciones, y se
// normaliza el espaciado. La etiqueta que se muestra es la variante más usada.
const CONECTORES = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'EN', 'Y']);
// marcas diacríticas que deja NFD (U+0300..U+036F)
const RE_DIACRITICOS = new RegExp('[\u0300-\u036f]', 'g');

export function claveOcupacion(nombre: string | null | undefined): string {
  const base = (nombre || '').trim();
  if (!base) return '';
  const sinAcentos = base.normalize('NFD').replace(RE_DIACRITICOS, '').toUpperCase();
  const palabras = sinAcentos
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // letra de categoría suelta al final (A, B, C...)
  while (palabras.length > 1 && /^[A-F]$/.test(palabras[palabras.length - 1])) palabras.pop();
  return palabras
    .filter(p => !CONECTORES.has(p))
    // neutralizo el género para que MUCAMA/MUCAMO o FARMACEUTICA/FARMACEUTICO
    // no queden como dos ocupaciones distintas
    .map(p => (p.length > 3 && (p.endsWith('A') || p.endsWith('O')) ? `${p.slice(0, -1)}~` : p))
    .join(' ');
}

/** Etiqueta legible: la variante original más frecuente, sin la letra de categoría. */
export function etiquetaOcupacion(variantes: Map<string, number>): string {
  let mejor = '', max = -1;
  for (const [v, n] of variantes) {
    if (n > max || (n === max && v.length > mejor.length)) { mejor = v; max = n; }
  }
  return mejor.trim().replace(/\s+[A-Fa-f]$/, '').trim();
}

// ── horarios ─────────────────────────────────────────────────────────────────
const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DOW_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const COLS: Record<string, [number, number]> = {
  lunes: [5, 6], martes: [7, 8], miercoles: [9, 10], jueves: [11, 12],
  viernes: [13, 14], sabado: [15, 16], domingo: [17, 18],
};

function normHora(v: any): string | null {
  if (v == null) return null;
  let s = (typeof v === 'object' && v.text) ? String(v.text) : String(v);
  s = s.trim();
  if (!s || s === '-') return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : null;
}
const enMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Construye los turnos de la semana uniendo los que cruzan la medianoche. */
export function armarTurnos(raw: Record<string, { e: string | null; s: string | null }>): Turno[] {
  const colas = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const k = DIAS[i], n = DIAS[(i + 1) % 7];
    if (raw[k].e && raw[k].s === '00:00' && raw[n].e === '00:00' && raw[n].s) colas.add(n);
  }
  const turnos: Turno[] = [];
  for (let i = 0; i < 7; i++) {
    const k = DIAS[i], n = DIAS[(i + 1) % 7], d = raw[k], sig = raw[n];
    if (colas.has(k) || !d.e || !d.s) continue;
    if (d.s === '00:00' && sig.e === '00:00' && sig.s) {
      turnos.push({
        dia: k, entrada: d.e, salida: sig.s,
        horas: ((24 * 60 - enMin(d.e)) + enMin(sig.s)) / 60, cruza: true,
      });
    } else {
      let h = (enMin(d.s) - enMin(d.e)) / 60;
      if (h === 0) h = 24;
      if (h < 0) h += 24;
      turnos.push({ dia: k, entrada: d.e, salida: d.s, horas: h, cruza: h >= 24 || enMin(d.s) <= enMin(d.e) });
    }
  }
  return turnos;
}

/** GUARDIA si algún turno dura MÁS de 12 hs. 12 exactas = PLANTA. */
export function regimenDe(turnos: Turno[]): Regimen {
  return turnos.some(t => t.horas > 12) ? 'GUARDIA' : 'PLANTA';
}

function lineaHorario(turnos: Turno[]): string {
  const grupos = new Map<string, string[]>();
  for (const t of turnos) {
    const k = `${t.entrada}-${t.salida}|${t.horas}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(t.dia.slice(0, 3));
  }
  return [...grupos.entries()]
    .map(([k, ds]) => {
      const [rango, horas] = k.split('|');
      return `${ds.join('/')} ${rango} (${Number(horas)}h)`;
    })
    .join(' + ');
}

interface FilaHorario {
  dni: string; nombre: string; agrupamiento: string; estructuraExcel: string; turnos: Turno[];
}

function leerHorarios(): { filas: FilaHorario[]; error: string | null } {
  if (!ExcelJS) return { filas: [], error: 'Falta dependencia exceljs' };
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir || !fs.existsSync(dir)) return { filas: [], error: 'EXCEL_ASISTENCIA_DIR no configurado o inexistente' };
  return { filas: [], error: null };
}

async function cargarHorarios(): Promise<{ filas: FilaHorario[]; error: string | null }> {
  const pre = leerHorarios();
  if (pre.error) return pre;
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  const archivos = fs.readdirSync(dir).filter((f: string) => /\.xls[xm]?$/i.test(f) && f.toLowerCase().includes('horario'));
  const porDni = new Map<string, FilaHorario>();
  for (const fn of archivos) {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(path.join(dir, fn));
      const ws = wb.worksheets[0];
      if (!ws) continue;
      ws.eachRow((r: any, rn: number) => {
        if (rn === 1) return;
        const dni = String(r.getCell(4).value ?? '').replace(/\D/g, '');
        if (!dni) return;
        const raw: Record<string, { e: string | null; s: string | null }> = {};
        for (const k of DIAS) {
          const [ce, cs] = COLS[k];
          raw[k] = { e: normHora(r.getCell(ce).value), s: normHora(r.getCell(cs).value) };
        }
        const turnos = armarTurnos(raw);
        if (!turnos.length) return;
        porDni.set(dni, {
          dni,
          nombre: String(r.getCell(2).value ?? '').trim(),
          agrupamiento: String(r.getCell(22).value ?? '').trim(),
          estructuraExcel: String(r.getCell(23).value ?? '').trim(),
          turnos,
        });
      });
    } catch (e: any) {
      logger.warn({ msg: 'ausentismo: error leyendo horarios', file: fn, error: e?.message });
    }
  }
  if (!porDni.size) return { filas: [], error: 'No se encontraron horarios en el Excel' };
  return { filas: [...porDni.values()], error: null };
}

// ── novedades desde Excel ────────────────────────────────────────────────────
// La tabla `historial` sólo tiene años cerrados (hasta 2025). Para el año en
// curso se lee el export puesto en EXCEL_ASISTENCIA_DIR (archivos con
// "historial" en el nombre). Se soportan los dos formatos que exporta el SIAPE:
//   A) export completo:  NRO_DOCUMENTO · NOVEDAD · FECHA_DESDE · FECHA_HASTA
//   B) reporte ausentismo: NUMERO · CAUSAL_AUSENTISMO · FECHA_DESDE · FECHA_HASTA
// Las fechas vienen como serial de Excel o como texto DD-MM-AAAA / DD/MM/AAAA.

export interface NovedadCruda { dni: string; novedad: string; d1: string; d2: string; }

/** Serial de Excel o texto DD-MM-AAAA → 'YYYY-MM-DD'. */
function aFecha(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date((v - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export async function leerNovedadesExcel(): Promise<{ filas: NovedadCruda[]; archivos: string[]; errores: string[] }> {
  const out: NovedadCruda[] = [];
  const archivos: string[] = [];
  const errores: string[] = [];
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!ExcelJS || !dir || !fs.existsSync(dir)) return { filas: out, archivos, errores };

  const candidatos = fs.readdirSync(dir)
    .filter((f: string) => /\.xls[xm]?$/i.test(f) && /historial/i.test(f) && !f.startsWith('~$'));

  for (const fn of candidatos) {
    const fp = path.join(dir, fn);
    try {
      // un export real pesa MB; si es chico suele ser la página de error del
      // servidor de RRHH guardada con extensión .xlsx
      if (fs.statSync(fp).size < 4096) {
        errores.push(`${fn}: el archivo tiene ${fs.statSync(fp).size} bytes, no es un export válido (¿falló la descarga?)`);
        continue;
      }
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(fp);
      const ws = wb.worksheets[0];
      if (!ws) { errores.push(`${fn}: sin hojas`); continue; }

      const hdr: Record<string, number> = {};
      ws.getRow(1).eachCell((c: any, i: number) => {
        hdr[String(c.value ?? '').toUpperCase().trim()] = i;
      });
      const col = (...nombres: string[]) => {
        for (const n of nombres) if (hdr[n] != null) return hdr[n];
        return -1;
      };
      const iDni = col('NRO_DOCUMENTO', 'NUMERO', 'DNI', 'DOCUMENTO');
      const iNov = col('NOVEDAD', 'CAUSAL_AUSENTISMO', 'CAUSAL');
      const iD1 = col('FECHA_DESDE');
      const iD2 = col('FECHA_HASTA');
      if (iDni < 0 || iNov < 0 || iD1 < 0) {
        errores.push(`${fn}: no reconozco las columnas (necesito documento, novedad y fecha desde)`);
        continue;
      }

      let leidas = 0;
      ws.eachRow((r: any, rn: number) => {
        if (rn === 1) return;
        const dni = String(r.getCell(iDni).value ?? '').replace(/\D/g, '');
        const novedad = String(r.getCell(iNov).value ?? '').trim();
        const d1 = aFecha(r.getCell(iD1).value);
        if (!dni || !novedad || !d1) return;
        const d2 = (iD2 > 0 ? aFecha(r.getCell(iD2).value) : null) || d1;
        out.push({ dni, novedad, d1, d2: d2 < d1 ? d1 : d2 });
        leidas++;
      });
      if (leidas) archivos.push(`${fn} (${leidas} filas)`);
      else errores.push(`${fn}: no tiene filas con datos`);
    } catch (e: any) {
      errores.push(`${fn}: no se pudo leer (${e?.message})`);
    }
  }
  return { filas: out, archivos, errores };
}

// ── fechas ───────────────────────────────────────────────────────────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/**
 * Acepta 'YYYY' (año completo) o 'YYYY-MM' (mes) y devuelve el rango de días.
 * El final se recorta a hoy: si no, pedir el año en curso metería meses futuros
 * en el denominador (turnos programados que todavía no ocurrieron) y el
 * ausentismo daría artificialmente bajo.
 */
export function resolverRango(desde: string, hasta: string): { desde: string; hasta: string } {
  const d = /^\d{4}$/.test(desde) ? `${desde}-01-01`
    : /^\d{4}-\d{2}$/.test(desde) ? `${desde}-01` : desde;
  let h: string;
  if (/^\d{4}$/.test(hasta)) h = `${hasta}-12-31`;
  else if (/^\d{4}-\d{2}$/.test(hasta)) {
    const [y, m] = hasta.split('-').map(Number);
    h = `${hasta}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  } else h = hasta;
  const hoy = new Date().toISOString().slice(0, 10);
  if (h > hoy) h = hoy;
  return { desde: d, hasta: h };
}

// ── cálculo principal ────────────────────────────────────────────────────────
export interface OpcionesAusentismo {
  desde: string;            // YYYY | YYYY-MM | YYYY-MM-DD
  hasta: string;
  nivel?: Nivel;
  dependencia?: string;     // filtros de drill-down
  servicio?: string;
  ocupacion?: string;       // clave normalizada (ver claveOcupacion)
  regimen?: Regimen | 'TODOS';
}

const SIN = 'Sin asignar';

export async function evaluarAusentismo(
  opts: OpcionesAusentismo,
  sequelize: Sequelize,
): Promise<ResultadoAusentismo> {
  const nivel: Nivel = opts.nivel || 'servicio';
  const { desde, hasta } = resolverRango(opts.desde, opts.hasta);
  const advertencias: string[] = [];

  const { filas, error } = await cargarHorarios();
  if (error) {
    return {
      desde, hasta, nivel, grupos: [], agentes: [], porNovedad: [],
      totales: totalesVacios(), advertencias: [error],
    };
  }

  // ── estructura desde la base (servicio vigente → repartición → dependencia) ──
  const dnis = filas.map(f => Number(f.dni)).filter(n => Number.isFinite(n));
  const estructura = new Map<string, any>();
  if (dnis.length) {
    const rows: any[] = await sequelize.query(`
      SELECT p.dni, p.apellido, p.nombre,
             COALESCE(dep.nombre, '') AS dependencia,
             COALESCE(srv.nombre, '') AS servicio,
             COALESCE(sec.nombre, '') AS sector,
             COALESCE(o.nombre, '')   AS ocupacion
        FROM personal p
        LEFT JOIN (
          SELECT a1.dni, a1.servicio_id
            FROM agentes_servicios a1
            JOIN (SELECT dni, MAX(id) AS mx FROM agentes_servicios
                   WHERE deleted_at IS NULL AND fecha_hasta IS NULL GROUP BY dni) u
              ON u.mx = a1.id
        ) vig ON vig.dni = p.dni
        LEFT JOIN servicios srv     ON srv.id = vig.servicio_id AND srv.deleted_at IS NULL
        LEFT JOIN reparticiones rep ON rep.id = srv.reparticion_id AND rep.deleted_at IS NULL
        LEFT JOIN dependencias dep  ON dep.id = rep.dependencia_id AND dep.deleted_at IS NULL
        LEFT JOIN (
          SELECT s1.dni, s1.sector_id
            FROM agentes_sectores s1
            JOIN (SELECT dni, MAX(id) AS mx FROM agentes_sectores
                   WHERE deleted_at IS NULL GROUP BY dni) u2
              ON u2.mx = s1.id
        ) vsec ON vsec.dni = p.dni
        LEFT JOIN sectores sec ON sec.id = vsec.sector_id AND sec.deleted_at IS NULL
        LEFT JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'
        LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id
       WHERE p.deleted_at IS NULL AND p.dni IN (:dnis)
    `, { type: QueryTypes.SELECT, replacements: { dnis } });
    for (const r of rows) estructura.set(String(r.dni), r);
  }

  // ── turnos programados ──
  type Prog = { inicio: string; fin: string; horas: number };
  const progPorDni = new Map<string, Prog[]>();
  const agentesBase = filas.map(f => {
    const db = estructura.get(f.dni) || {};
    return {
      fila: f,
      apellido: db.apellido ?? null,
      nombreDb: db.nombre ?? null,
      ocupacion: db.ocupacion || null,
      dependencia: db.dependencia || SIN,
      servicio: db.servicio || SIN,
      sector: db.sector || SIN,
      regimen: regimenDe(f.turnos),
    };
  }).filter(a => {
    if (opts.dependencia && a.dependencia !== opts.dependencia) return false;
    if (opts.servicio && a.servicio !== opts.servicio) return false;
    if (opts.ocupacion && claveOcupacion(a.ocupacion) !== opts.ocupacion) return false;
    if (opts.regimen && opts.regimen !== 'TODOS' && a.regimen !== opts.regimen) return false;
    return true;
  });

  for (const a of agentesBase) progPorDni.set(a.fila.dni, []);
  for (let d = new Date(`${desde}T00:00:00Z`); iso(d) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = DOW_KEYS[d.getUTCDay()], f = iso(d);
    for (const a of agentesBase) {
      for (const t of a.fila.turnos) {
        if (t.dia !== k) continue;
        progPorDni.get(a.fila.dni)!.push({ inicio: f, fin: t.cruza ? sumarDias(f, 1) : f, horas: t.horas });
      }
    }
  }

  // ── novedades del período ──
  // Fuente única: la tabla `historial`. Los exports del SIAPE se cargan ahí con
  // el importador (historialSiapeImport), así los números no dependen de qué
  // archivo haya quedado suelto en la carpeta.
  const catDe = categorizar(leerMapeo());
  const licPorDni = new Map<string, { novedad: string; cat: Categoria; d1: string; d2: string }[]>();
  const vistas = new Set<string>();
  const dnisEnJuego = new Set(agentesBase.map(a => a.fila.dni));
  let filasDb = 0;

  const sumar = (dni: string, novedad: string, d1: string, d2: string): boolean => {
    if (!dnisEnJuego.has(dni)) return false;
    if (d2 < desde || d1 > hasta) return false;
    const k = `${dni}|${novedad}|${d1}|${d2}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    const cat = catDe(novedad);
    if (cat === 'IGNORAR') return false;
    if (!licPorDni.has(dni)) licPorDni.set(dni, []);
    licPorDni.get(dni)!.push({ novedad, cat, d1, d2 });
    return true;
  };

  if (agentesBase.length) {
    const rows: any[] = await sequelize.query(`
      SELECT dni, novedad,
             DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS d1,
             DATE_FORMAT(COALESCE(fecha_hasta, fecha_desde), '%Y-%m-%d') AS d2
        FROM historial
       WHERE fecha_hasta >= :desde AND fecha_desde <= :hasta
         AND dni IN (:dnis)
    `, {
      type: QueryTypes.SELECT,
      replacements: { desde, hasta, dnis: agentesBase.map(a => Number(a.fila.dni)) },
    });
    for (const r of rows) if (sumar(String(r.dni), r.novedad, r.d1, r.d2)) filasDb++;
  }

  if (!filasDb) {
    advertencias.push(`No hay novedades en la tabla historial para ${desde} a ${hasta}. Si el período es reciente, falta importar el export del SIAPE.`);
  }

  // ── por agente ──
  const novedadStats = new Map<string, { categoria: Categoria; turnos: number; eventos: number }>();
  const agentes: AgenteAusentismo[] = agentesBase.map(a => {
    const prog = progPorDni.get(a.fila.dni) || [];
    const lics = licPorDni.get(a.fila.dni) || [];
    const turnosProg = prog.length;
    const horasProg = prog.reduce((s, p) => s + p.horas, 0);

    let turnosNoProg = 0, horasNoProg = 0, turnosProgramada = 0, horasProgramada = 0, turnosPresentismo = 0;
    let evNoProg = 0, evProg = 0;

    for (const l of lics) {
      if (l.cat === 'NO_PROGRAMADA') evNoProg++;
      else if (l.cat === 'PROGRAMADA') evProg++;
      const st = novedadStats.get(l.novedad) || { categoria: l.cat, turnos: 0, eventos: 0 };
      st.eventos++;
      novedadStats.set(l.novedad, st);
    }

    for (const p of prog) {
      // prioridad: no programada > programada > presentismo (un turno cuenta una vez)
      const tocan = lics.filter(l => l.d1 <= p.fin && l.d2 >= p.inicio);
      if (!tocan.length) continue;
      const cat: Categoria = tocan.some(l => l.cat === 'NO_PROGRAMADA') ? 'NO_PROGRAMADA'
        : tocan.some(l => l.cat === 'PROGRAMADA') ? 'PROGRAMADA' : 'PRESENTISMO';
      if (cat === 'NO_PROGRAMADA') { turnosNoProg++; horasNoProg += p.horas; }
      else if (cat === 'PROGRAMADA') { turnosProgramada++; horasProgramada += p.horas; }
      else turnosPresentismo++;
      for (const l of tocan) {
        const st = novedadStats.get(l.novedad);
        if (st) st.turnos++;
      }
    }

    const den = turnosProg || 1;
    return {
      dni: a.fila.dni,
      nombre: a.fila.nombre || [a.apellido, a.nombreDb].filter(Boolean).join(' '),
      apellido: a.apellido,
      agrupamiento: a.fila.agrupamiento,
      ocupacion: a.ocupacion,
      dependencia: a.dependencia,
      servicio: a.servicio,
      sector: a.sector,
      regimen: a.regimen,
      horario: lineaHorario(a.fila.turnos),
      horasSemana: +a.fila.turnos.reduce((s, t) => s + t.horas, 0).toFixed(2),
      turnosProg, horasProg: +horasProg.toFixed(2),
      turnosNoProg, horasNoProg: +horasNoProg.toFixed(2),
      turnosProgramada, horasProgramada: +horasProgramada.toFixed(2),
      turnosPresentismo,
      eventosNoProg: evNoProg,
      eventosProgramada: evProg,
      pctNoProgramada: +(100 * turnosNoProg / den).toFixed(2),
      pctProgramada: +(100 * turnosProgramada / den).toFixed(2),
      pctTotal: +(100 * (turnosNoProg + turnosProgramada) / den).toFixed(2),
    };
  });

  // ── agrupación ──
  const claveDe = (a: AgenteAusentismo) =>
    nivel === 'dependencia' ? a.dependencia
      : nivel === 'servicio' ? `${a.dependencia}||${a.servicio}`
        : `${a.dependencia}||${a.servicio}||${a.sector}`;

  const mapa = new Map<string, GrupoAusentismo>();
  for (const a of agentes) {
    const clave = claveDe(a);
    let g = mapa.get(clave);
    if (!g) {
      g = {
        clave,
        dependencia: a.dependencia,
        servicio: nivel === 'dependencia' ? '' : a.servicio,
        sector: nivel === 'sector' ? a.sector : '',
        agentes: 0, guardia: 0, planta: 0, conAusencia: 0,
        turnosProg: 0, horasProg: 0, turnosNoProg: 0, horasNoProg: 0,
        turnosProgramada: 0, horasProgramada: 0, turnosPresentismo: 0,
        pctNoProgramada: 0, pctProgramada: 0, pctTotal: 0,
        porRegimen: {
          GUARDIA: { agentes: 0, turnosProg: 0, turnosNoProg: 0, turnosProgramada: 0, horasProg: 0, horasNoProg: 0, pctNoProgramada: 0, pctProgramada: 0 },
          PLANTA: { agentes: 0, turnosProg: 0, turnosNoProg: 0, turnosProgramada: 0, horasProg: 0, horasNoProg: 0, pctNoProgramada: 0, pctProgramada: 0 },
        },
      };
      mapa.set(clave, g);
    }
    acumular(g, a);
  }
  const grupos = [...mapa.values()].map(cerrar).sort((x, y) => y.pctNoProgramada - x.pctNoProgramada);

  // ── totales ──
  const tot = cerrar(agentes.reduce((g, a) => (acumular(g, a), g), {
    clave: 'TOTAL', dependencia: '', servicio: '', sector: '',
    agentes: 0, guardia: 0, planta: 0, conAusencia: 0,
    turnosProg: 0, horasProg: 0, turnosNoProg: 0, horasNoProg: 0,
    turnosProgramada: 0, horasProgramada: 0, turnosPresentismo: 0,
    pctNoProgramada: 0, pctProgramada: 0, pctTotal: 0,
    porRegimen: {
      GUARDIA: { agentes: 0, turnosProg: 0, turnosNoProg: 0, turnosProgramada: 0, horasProg: 0, horasNoProg: 0, pctNoProgramada: 0, pctProgramada: 0 },
      PLANTA: { agentes: 0, turnosProg: 0, turnosNoProg: 0, turnosProgramada: 0, horasProg: 0, horasNoProg: 0, pctNoProgramada: 0, pctProgramada: 0 },
    },
  } as GrupoAusentismo));

  // ── advertencias de calidad de dato ──
  const sinEstructura = agentes.filter(a => a.servicio === SIN).length;
  if (sinEstructura) advertencias.push(`${sinEstructura} agente(s) del Excel de horarios no tienen servicio vigente en el sistema.`);
  const sinSector = agentes.filter(a => a.sector === SIN).length;
  if (sinSector) advertencias.push(`${sinSector} de ${agentes.length} agente(s) no tienen sector cargado: el desglose por sector es parcial.`);
  const raros = agentes.filter(a => /\(29h\)|\(2[5-9]h\)/.test(a.horario)).length;
  if (raros) advertencias.push(`${raros} agente(s) tienen un turno de más de 24 hs en el Excel de horarios (probable error de carga).`);

  const { clave: _c, dependencia: _d, servicio: _s, sector: _x, ...totales } = tot;

  return {
    desde, hasta, nivel, grupos, agentes,
    totales: totales as any,
    porNovedad: [...novedadStats.entries()]
      .map(([novedad, v]) => ({ novedad, ...v }))
      .sort((a, b) => b.turnos - a.turnos),
    advertencias,
  };
}

function acumular(g: GrupoAusentismo, a: AgenteAusentismo) {
  g.agentes++;
  if (a.regimen === 'GUARDIA') g.guardia++; else g.planta++;
  if (a.turnosNoProg || a.turnosProgramada) g.conAusencia++;
  g.turnosProg += a.turnosProg; g.horasProg += a.horasProg;
  g.turnosNoProg += a.turnosNoProg; g.horasNoProg += a.horasNoProg;
  g.turnosProgramada += a.turnosProgramada; g.horasProgramada += a.horasProgramada;
  g.turnosPresentismo += a.turnosPresentismo;
  const r = g.porRegimen[a.regimen];
  r.agentes++; r.turnosProg += a.turnosProg; r.turnosNoProg += a.turnosNoProg;
  r.turnosProgramada += a.turnosProgramada; r.horasProg += a.horasProg; r.horasNoProg += a.horasNoProg;
}

function cerrar(g: GrupoAusentismo): GrupoAusentismo {
  const den = g.turnosProg || 1;
  g.pctNoProgramada = +(100 * g.turnosNoProg / den).toFixed(2);
  g.pctProgramada = +(100 * g.turnosProgramada / den).toFixed(2);
  g.pctTotal = +(100 * (g.turnosNoProg + g.turnosProgramada) / den).toFixed(2);
  g.horasProg = +g.horasProg.toFixed(2);
  g.horasNoProg = +g.horasNoProg.toFixed(2);
  g.horasProgramada = +g.horasProgramada.toFixed(2);
  for (const k of ['GUARDIA', 'PLANTA'] as Regimen[]) {
    const r = g.porRegimen[k];
    const d = r.turnosProg || 1;
    r.pctNoProgramada = +(100 * r.turnosNoProg / d).toFixed(2);
    r.pctProgramada = +(100 * r.turnosProgramada / d).toFixed(2);
    r.horasProg = +r.horasProg.toFixed(2);
    r.horasNoProg = +r.horasNoProg.toFixed(2);
  }
  return g;
}

function totalesVacios(): any {
  return {
    agentes: 0, guardia: 0, planta: 0, conAusencia: 0,
    turnosProg: 0, horasProg: 0, turnosNoProg: 0, horasNoProg: 0,
    turnosProgramada: 0, horasProgramada: 0, turnosPresentismo: 0,
    pctNoProgramada: 0, pctProgramada: 0, pctTotal: 0,
    porRegimen: {
      GUARDIA: { agentes: 0, turnosProg: 0, turnosNoProg: 0, turnosProgramada: 0, horasProg: 0, horasNoProg: 0, pctNoProgramada: 0, pctProgramada: 0 },
      PLANTA: { agentes: 0, turnosProg: 0, turnosNoProg: 0, turnosProgramada: 0, horasProg: 0, horasNoProg: 0, pctNoProgramada: 0, pctProgramada: 0 },
    },
  };
}
