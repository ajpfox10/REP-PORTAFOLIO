// src/routes/sinSalida.routes.ts
// Agentes sin fichaje de salida — cruzado con horarios y SIAP
//
// FLUJO:
//  POST /sin-salida  → por fecha exacta (YYYY-MM-DD) o por período mensual (YYYY-MM)
//
// Body JSON:
//   fecha         YYYY-MM-DD  (un día exacto)
//   periodo       YYYY-MM     (mes completo — expande todos los días laborables)
//   horariosFiles string[]    (auto-detecta archivos con "horario" en el nombre)
//   siapFiles     string[]    (auto-detecta archivos con "siap"    en el nombre)
//
// Estado por fila:
//   SIN_SALIDA          → tiene entrada pero sin salida en el fichaje
//   SOLO_SALIDA         → hay salida biométrica pero falta la entrada
//   PRESENTE_SIN_ESTAR  → SIAP lo marca PRESENTE pero no tiene fichaje biométrico
//   SIN_FICHAJE         → sin ningún registro, y sin novedad administrativa que lo cubra
//   JUSTIFICADO         → sin fichaje pero tiene novedad SIAP/MINISTERIO que cubre esa fecha
//   REQUIERE_REVISION   → horario nocturno ambiguo sin patrón semanal inferible
//   CON_SALIDA          → tiene entrada y salida (todo OK)
//
// Notas:
//   - Múltiples archivos de horarios y SIAP son combinados (uno por UPA)
//   - La UPA del agente se resuelve desde las columnas E5/E6 del SIAP
//   - Usa la misma DB biométrica (fichero_config.json) que el módulo Fichero

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let ExcelJS: any;
try { ExcelJS = require('exceljs'); } catch { ExcelJS = null; }

// ── Helpers de texto ─────────────────────────────────────────────────────────
function normHeader(s: any): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellToText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object' && Array.isArray((v as any).richText)) {
    return String((v as any).richText.map((x: any) => x.text).join('')).trim();
  }
  return String(v).trim();
}

function normDni(v: any): string {
  return String(v ?? '').replace(/[^0-9]/g, '').trim();
}

// ── Helpers de fecha ─────────────────────────────────────────────────────────
function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const months: Record<string, number> = {
      JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
      ENE:0,ABR:3,AGO:7,SET:8,DIC:11,
    };
    const m1 = val.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/i);
    if (m1) {
      const y  = parseInt(m1[3]) + (m1[3].length === 2 ? 2000 : 0);
      const mo = months[m1[2].toUpperCase()] ?? 0;
      return new Date(Date.UTC(y, mo, parseInt(m1[1])));
    }
    const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Date.UTC(+iso[1], +iso[2]-1, +iso[3]));
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const toUTCMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const dateToStr = (d: Date | null): string => d ? d.toISOString().slice(0, 10) : '';

// ── Directorio de Excel ───────────────────────────────────────────────────────
function getDir(): string {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir) throw new Error('Falta EXCEL_ASISTENCIA_DIR en .env');
  return dir;
}

function listExcelFiles(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.xlsx') || f.toLowerCase().endsWith('.xltx'))
    .map(f => ({ name: f, fullPath: path.join(dir, f) }));
}

// ── Helpers de hora ──────────────────────────────────────────────────────────
function parseHoraHHMM(val: any): string | null {
  if (!val) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Diferencia absoluta en minutos entre dos HH:MM, considerando vuelta a medianoche
function timeDiffMins(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  const diff = Math.abs((ah * 60 + am) - (bh * 60 + bm));
  return Math.min(diff, 1440 - diff);
}

// ── Tipos internos ───────────────────────────────────────────────────────────
type HorarioDia = {
  lunes: boolean; martes: boolean; miercoles: boolean;
  jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean;
};

type HorasDia = { horaEntrada: string | null; horaSalida: string | null };

// Umbral de corte para reasignar salidas al día anterior:
//   agentes normales → salidas hasta las 06:00 del día siguiente
//   GUARDIA (24hs)   → salidas hasta las 14:00 del día siguiente
const CUTOFF_NORMAL  = '06:00';
const CUTOFF_GUARDIA = '14:00';
const RANGO_SALIDA_NOCTURNA = 180;

const DOW_KEYS  = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'] as const;
const DOW_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function getWeekStartIso(fechaIso: string): string {
  const dt = new Date(fechaIso + 'T00:00:00Z');
  const dow = dt.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
}

function addDaysIso(fechaIso: string, delta: number): string {
  const dt = new Date(fechaIso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function getDowKeyFromDate(fechaIso: string): typeof DOW_KEYS[number] {
  return DOW_KEYS[new Date(fechaIso + 'T00:00:00Z').getUTCDay()];
}

function shiftSpansNextDay(info: { horario: HorarioDia; horas: Record<string, HorasDia> }, fechaIso: string): boolean {
  const dowKey = getDowKeyFromDate(fechaIso);
  if (!info.horario[dowKey]) return false;
  const horasDia = info.horas?.[dowKey];
  const ent = horasDia?.horaEntrada ?? null;
  const sal = horasDia?.horaSalida ?? null;
  if (!ent || !sal) return false;
  return ent === sal || sal < ent;
}

function shouldAssignSalidaToPreviousDay(
  dni: string,
  fechaOrig: string,
  hora: string,
  fichajesMap: Record<string, Record<string, { entrada: string | null; salida: string | null }>>,
  horariosMap: Record<string, { nombre: string; esGuardia: boolean; planta: string; horario: HorarioDia; horas: Record<string, HorasDia> }>,
): boolean {
  if (fichajesMap[dni]?.[fechaOrig]?.entrada) return false;

  const info = horariosMap[dni];
  const fechaPrev = addDaysIso(fechaOrig, -1);
  if (info && shiftSpansNextDay(info, fechaPrev)) {
    const prevDowKey = getDowKeyFromDate(fechaPrev);
    const horaSalidaProg = info.horas?.[prevDowKey]?.horaSalida ?? null;
    if (!horaSalidaProg) return false;
    return timeDiffMins(hora, horaSalidaProg) <= RANGO_SALIDA_NOCTURNA;
  }

  const cutoff = info?.esGuardia ? CUTOFF_GUARDIA : CUTOFF_NORMAL;
  return hora <= cutoff && !!fichajesMap[dni]?.[fechaPrev]?.entrada;
}

// ── Parser horarios ──────────────────────────────────────────────────────────
// Soporta dos formatos:
//   Formato A (antiguo): tiene columnas _CONTROLABLE (SI/NO) + _ENTRADA/_SALIDA con fechas
//   Formato B (nuevo):   solo _ENTRADA/_SALIDA con horas "HH:MM" — controlable si tiene hora
async function parseHorariosFile(fp: string): Promise<Record<string, { nombre: string; esGuardia: boolean; planta: string; horario: HorarioDia; horas: Record<string, HorasDia> }>> {
  const result: Record<string, { nombre: string; esGuardia: boolean; planta: string; horario: HorarioDia; horas: Record<string, HorasDia> }> = {};
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const ws = wb.worksheets[0];
  if (!ws) return result;

  const hdr: Record<string, number> = {};
  ws.getRow(1).eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) hdr[v] = col;
  });

  // Columnas de identidad
  const colDni         = hdr['nro_documento'] ?? hdr['nro documento'] ?? hdr['documento'] ?? hdr['dni'] ?? 4;
  const colNomFull     = hdr['apellido_nombre'] ?? hdr['apellido y nombres'] ?? hdr['apellido y nombre'] ?? 0;
  const colApellido    = hdr['apellido'] ?? 0;
  const colNomFirst    = hdr['nombre']   ?? 0;
  const colPlantaRevista = hdr['planta_de_revista'] ?? hdr['planta de revista'] ?? 0;

  // Columnas de horas programadas (ambos formatos las tienen, aunque con distintos valores)
  const colLunEnt = hdr['lunes_entrada']     ?? 0;
  const colLunSal = hdr['lunes_salida']      ?? 0;
  const colMarEnt = hdr['martes_entrada']    ?? 0;
  const colMarSal = hdr['martes_salida']     ?? 0;
  const colMieEnt = hdr['miercoles_entrada'] ?? 0;
  const colMieSal = hdr['miercoles_salida']  ?? 0;
  const colJueEnt = hdr['jueves_entrada']    ?? 0;
  const colJueSal = hdr['jueves_salida']     ?? 0;
  const colVieEnt = hdr['viernes_entrada']   ?? 0;
  const colVieSal = hdr['viernes_salida']    ?? 0;
  const colSabEnt = hdr['sabado_entrada']    ?? 0;
  const colSabSal = hdr['sabado_salida']     ?? 0;
  const colDomEnt = hdr['domingo_entrada']   ?? 0;
  const colDomSal = hdr['domingo_salida']    ?? 0;

  // Columnas _CONTROLABLE (solo Formato A)
  const colLunCtrl = hdr['lunes_controlable']     ?? 0;
  const colMarCtrl = hdr['martes_controlable']    ?? 0;
  const colMieCtrl = hdr['miercoles_controlable'] ?? 0;
  const colJueCtrl = hdr['jueves_controlable']    ?? 0;
  const colVieCtrl = hdr['viernes_controlable']   ?? 0;
  const colSabCtrl = hdr['sabado_controlable']    ?? 0;
  const colDomCtrl = hdr['domingo_controlable']   ?? 0;

  // Detectar formato: si existen columnas _CONTROLABLE usamos Formato A, si no Formato B
  const formatoA = colLunCtrl > 0;
  const isSI     = (v: any) => String(v ?? '').toUpperCase().trim() === 'SI';
  // En Formato B, el día es controlable si la columna _ENTRADA tiene una hora válida
  const esControlable = (v: any) => parseHoraHHMM(v) !== null;

  ws.eachRow((r: any, rn: number) => {
    if (rn === 1) return;
    const dni = normDni(r.getCell(colDni)?.value);
    if (!dni) return;

    let nombre = '';
    if (colNomFull)   nombre = cellToText(r.getCell(colNomFull)?.value);
    else if (colApellido && colNomFirst) {
      nombre = [cellToText(r.getCell(colApellido)?.value), cellToText(r.getCell(colNomFirst)?.value)].filter(Boolean).join(', ');
    }

    const plantaRevista = colPlantaRevista ? cellToText(r.getCell(colPlantaRevista)?.value).toUpperCase() : '';
    const esGuardia     = plantaRevista.includes('GUARDIA');

    const horaEnt = (col: number) => col ? parseHoraHHMM(r.getCell(col)?.value) : null;
    const horaSal = (col: number) => col ? parseHoraHHMM(r.getCell(col)?.value) : null;
    const ctrl    = (ctrlCol: number, entCol: number) =>
      formatoA ? isSI(r.getCell(ctrlCol)?.value) : esControlable(r.getCell(entCol)?.value);

    result[dni] = {
      nombre,
      esGuardia,
      planta: plantaRevista,
      horario: {
        lunes:     ctrl(colLunCtrl, colLunEnt),
        martes:    ctrl(colMarCtrl, colMarEnt),
        miercoles: ctrl(colMieCtrl, colMieEnt),
        jueves:    ctrl(colJueCtrl, colJueEnt),
        viernes:   ctrl(colVieCtrl, colVieEnt),
        sabado:    ctrl(colSabCtrl, colSabEnt),
        domingo:   ctrl(colDomCtrl, colDomEnt),
      },
      horas: {
        lunes:     { horaEntrada: horaEnt(colLunEnt), horaSalida: horaSal(colLunSal) },
        martes:    { horaEntrada: horaEnt(colMarEnt), horaSalida: horaSal(colMarSal) },
        miercoles: { horaEntrada: horaEnt(colMieEnt), horaSalida: horaSal(colMieSal) },
        jueves:    { horaEntrada: horaEnt(colJueEnt), horaSalida: horaSal(colJueSal) },
        viernes:   { horaEntrada: horaEnt(colVieEnt), horaSalida: horaSal(colVieSal) },
        sabado:    { horaEntrada: horaEnt(colSabEnt), horaSalida: horaSal(colSabSal) },
        domingo:   { horaEntrada: horaEnt(colDomEnt), horaSalida: horaSal(colDomSal) },
      },
    };
  });
  return result;
}

// ── Parser SIAP (extracto mínimo: dni, nombre, upa, novedad, desde, hasta) ───
function resolveUpa(e5raw: string, e6raw: string): string {
  const norm = (s: string) =>
    String(s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const e6 = norm(e6raw);
  const e5 = norm(e5raw);
  const inE6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE6) return `UPA ${inE6[1]}`;
  const inE5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (inE5) return `UPA ${inE5[1]}`;
  return 'HOSPITAL';
}

async function parseSiapFile(fp: string): Promise<Array<{
  dni: string; nombre: string; upa: string;
  novedad: string; desde: Date | null; hasta: Date | null;
}>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const hdr: Record<string, number> = {};
  ws.getRow(1).eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) hdr[v] = col;
  });

  const colDni      = hdr['nro_documento'] ?? hdr['nro documento'] ?? hdr['dni'] ?? hdr['documento'] ?? 5;
  const colApellido = hdr['apellido'] ?? 2;
  const colNomFirst = hdr['nombre'] ?? 3;
  const colNomFull  = hdr['apellido y nombres'] ?? hdr['apellido y nombre'] ?? 0;
  const colNovedad  = hdr['novedad'] ?? hdr['novedad siap'] ?? 12;
  const colDesde    = hdr['fecha_desde'] ?? hdr['fecha desde'] ?? hdr['desde'] ?? 13;
  const colHasta    = hdr['fecha_hasta'] ?? hdr['fecha hasta'] ?? hdr['hasta'] ?? 14;
  const colE5       = hdr['e5'] ?? 21;
  const colE6       = hdr['e6'] ?? 22;

  const rows: any[] = [];
  ws.eachRow((r: any, rn: number) => {
    if (rn === 1) return;
    const dni = normDni(r.getCell(colDni)?.value);
    if (!dni) return;
    let nombre: string;
    if (colNomFull) {
      nombre = cellToText(r.getCell(colNomFull)?.value);
    } else {
      nombre = [
        cellToText(r.getCell(colApellido)?.value),
        cellToText(r.getCell(colNomFirst)?.value),
      ].filter(Boolean).join(', ');
    }
    const e5  = cellToText(r.getCell(colE5)?.value);
    const e6  = cellToText(r.getCell(colE6)?.value);
    const upa = resolveUpa(e5, e6);
    rows.push({
      dni,
      nombre,
      upa,
      novedad: cellToText(r.getCell(colNovedad)?.value),
      desde:   parseDate(r.getCell(colDesde)?.value),
      hasta:   parseDate(r.getCell(colHasta)?.value),
    });
  });
  return rows;
}

async function parseMinisterioFile(fp: string): Promise<Array<{
  dni: string;
  nombre: string;
  novedad: string;
  desde: Date | null;
  hasta: Date | null;
}>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const hdr: Record<string, number> = {};
  ws.getRow(1).eachCell((c: any, col: number) => {
    const v = normHeader(c?.value ?? '');
    if (v) hdr[v] = col;
  });

  const colDni     = hdr['dni'] ?? hdr['nro documento'] ?? hdr['documento'] ?? hdr['nro_documento'] ?? 1;
  const colNombre  = hdr['apellido y nombres'] ?? hdr['apellido y nombre'] ?? hdr['apellidoynombre'] ?? hdr['apellido_nombre'] ?? hdr['nombre'] ?? 2;
  const colNovedad = hdr['novedad ministerio'] ?? hdr['novedad'] ?? 3;
  const colDesde   = hdr['desde'] ?? hdr['fecha desde'] ?? 4;
  const colHasta   = hdr['hasta'] ?? hdr['fecha hasta'] ?? 5;

  const rows: Array<{
    dni: string;
    nombre: string;
    novedad: string;
    desde: Date | null;
    hasta: Date | null;
  }> = [];

  ws.eachRow((r: any, rn: number) => {
    if (rn === 1) return;
    const dni = normDni(r.getCell(colDni)?.value);
    const nombre = cellToText(r.getCell(colNombre)?.value);
    const novedad = cellToText(r.getCell(colNovedad)?.value);
    const desde = parseDate(r.getCell(colDesde)?.value);
    const hasta = parseDate(r.getCell(colHasta)?.value);
    if (!dni && !nombre && !novedad) return;
    rows.push({ dni, nombre, novedad, desde, hasta });
  });

  return rows;
}

// ── Router ───────────────────────────────────────────────────────────────────
export function buildSinSalidaRouter(sequelize?: import('sequelize').Sequelize) {
  const router = Router();

  // POST /sin-salida
  router.post('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) {
      return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs en el backend' });
    }
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);

      // ── Determinar rango de fechas ────────────────────────────────────────
      // Acepta "fecha" (YYYY-MM-DD) o "periodo" (YYYY-MM).
      // Si vienen los dos, periodo tiene prioridad.
      const periodoStr = String(req.body?.periodo ?? '').trim();
      const fechaStr   = String(req.body?.fecha   ?? '').trim();
      const desdeStr   = String(req.body?.desde   ?? '').trim();
      const hastaStr   = String(req.body?.hasta   ?? '').trim();

      let fechas: string[] = [];

      if (/^\d{4}-\d{2}$/.test(periodoStr)) {
        // Expandir todos los días del mes, sin superar ayer para evitar falsos
        // "sin salida" sobre jornadas todavía abiertas.
        const [y, m] = periodoStr.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const ayerDt = new Date();
        ayerDt.setUTCDate(ayerDt.getUTCDate() - 1);
        const ayer = ayerDt.toISOString().slice(0, 10);
        for (let d = 1; d <= daysInMonth; d++) {
          const f = `${periodoStr}-${String(d).padStart(2, '0')}`;
          if (f > ayer) break;
          fechas.push(f);
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(desdeStr) && /^\d{4}-\d{2}-\d{2}$/.test(hastaStr) && desdeStr <= hastaStr) {
        const ayerDt = new Date();
        ayerDt.setUTCDate(ayerDt.getUTCDate() - 1);
        const ayer = ayerDt.toISOString().slice(0, 10);
        let cur = desdeStr;
        while (cur <= hastaStr && cur <= ayer) {
          fechas.push(cur);
          cur = addDaysIso(cur, 1);
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        const hoy = new Date().toISOString().slice(0, 10);
        if (fechaStr >= hoy) {
          fechas = [];
        } else {
          fechas = [fechaStr];
        }
      } else {
        return res.status(400).json({ ok: false, error: 'Falta "fecha" (YYYY-MM-DD), "desde"+"hasta" o "periodo" (YYYY-MM)' });
      }

      if (fechas.length === 0) {
        const emptyMeta = {
          total: 0,
          sinSalida: 0,
          soloSalida: 0,
          sinFichaje: 0,
          presentesSinEstar: 0,
          requiereRevision: 0,
          justificados: 0,
          conSalida: 0,
          sospechosos: 0,
          agentesConProblema: 0,
          agentesInvertidos: 0,
          sinBiometrico: false,
          dbError: null,
        };
        return res.json({ ok: true, data: [], siapAgentes: {}, horariosAgentes: {}, sinHorarioAgentes: [], meta: emptyMeta });
      }

      const rangoMin = fechas[0];
      const rangoMax = fechas[fechas.length - 1];

      // ── Archivos horarios ─────────────────────────────────────────────────
      let horariosFileNames: string[] = Array.isArray(req.body?.horariosFiles) && req.body.horariosFiles.length > 0
        ? req.body.horariosFiles
        : files.filter(f => f.name.toLowerCase().includes('horario')).map(f => f.name);

      // ── Archivos SIAP ─────────────────────────────────────────────────────
      let siapFileNames: string[] = Array.isArray(req.body?.siapFiles) && req.body.siapFiles.length > 0
        ? req.body.siapFiles
        : files.filter(f => f.name.toLowerCase().includes('siap')).map(f => f.name);

      // ── Archivos Ministerio ───────────────────────────────────────────────
      const ministerioFileNames: string[] = Array.isArray(req.body?.ministerioFiles) && req.body.ministerioFiles.length > 0
        ? req.body.ministerioFiles
        : (
            req.body?.ministerioFile
              ? [String(req.body.ministerioFile)]
              : files.filter(f => f.name.toLowerCase().includes('ministerio')).map(f => f.name)
          );

      // ── 1. Leer horarios (todos los archivos, merge por DNI) ──────────────
      const horariosMap: Record<string, { nombre: string; esGuardia: boolean; planta: string; horario: HorarioDia; horas: Record<string, HorasDia> }> = {};
      for (const fileName of horariosFileNames) {
        const fp = path.join(dir, fileName);
        if (!fs.existsSync(fp)) continue;
        try {
          const parcial = await parseHorariosFile(fp);
          Object.assign(horariosMap, parcial);
        } catch (e: any) {
          logger.warn({ msg: 'sin-salida: error leyendo horarios', file: fileName, error: e?.message });
        }
      }

      if (Object.keys(horariosMap).length === 0) {
        return res.status(400).json({ ok: false, error: 'No se encontraron datos en los archivos de horarios' });
      }

      // ── 2. Leer SIAP (todos los archivos, merge por DNI) ──────────────────
      const siapDniMap: Record<string, {
        nombre: string;
        upa: string;
        novedades: Array<{ novedad: string; desde: Date; hasta: Date }>;
      }> = {};

      for (const fileName of siapFileNames) {
        const fp = path.join(dir, fileName);
        if (!fs.existsSync(fp)) continue;
        try {
          const rows = await parseSiapFile(fp);
          for (const r of rows) {
            if (!siapDniMap[r.dni]) {
              siapDniMap[r.dni] = { nombre: r.nombre, upa: r.upa, novedades: [] };
            }
            if (r.nombre && !siapDniMap[r.dni].nombre) siapDniMap[r.dni].nombre = r.nombre;
            if (r.upa)  siapDniMap[r.dni].upa = r.upa;
            if (r.desde && r.hasta) {
              siapDniMap[r.dni].novedades.push({
                novedad: r.novedad,
                desde:   r.desde,
                hasta:   r.hasta,
              });
            }
          }
        } catch (e: any) {
          logger.warn({ msg: 'sin-salida: error leyendo SIAP', file: fileName, error: e?.message });
        }
      }

      // Helper: novedad SIAP para un DNI en una fecha dada
      const getSiapNovedad = (dni: string, fechaIso: string): string => {
        const info = siapDniMap[dni];
        if (!info) return '';
        const dt = toUTCMidnight(new Date(fechaIso + 'T00:00:00Z'));
        const matches = info.novedades.filter(e =>
          toUTCMidnight(e.desde) <= dt && dt <= toUTCMidnight(e.hasta),
        );
        return [...new Set(matches.map(e => e.novedad).filter(Boolean))].join(' / ');
      };

      const ministerioDniMap: Record<string, Array<{ novedad: string; desde: Date; hasta: Date }>> = {};
      for (const fileName of ministerioFileNames) {
        const fp = path.join(dir, fileName);
        if (!fs.existsSync(fp)) continue;
        try {
          const rows = await parseMinisterioFile(fp);
          for (const r of rows) {
            if (!r.dni || !r.desde) continue;
            const hasta = r.hasta ?? r.desde;
            if (!hasta) continue;
            if (!ministerioDniMap[r.dni]) ministerioDniMap[r.dni] = [];
            ministerioDniMap[r.dni].push({
              novedad: r.novedad,
              desde: r.desde,
              hasta,
            });
          }
        } catch (e: any) {
          logger.warn({ msg: 'sin-salida: error leyendo Ministerio', file: fileName, error: e?.message });
        }
      }

      const getMinisterioNovedad = (dni: string, fechaIso: string): string => {
        const info = ministerioDniMap[dni];
        if (!info) return '';
        const dt = toUTCMidnight(new Date(fechaIso + 'T00:00:00Z'));
        const matches = info.filter(e =>
          toUTCMidnight(e.desde) <= dt && dt <= toUTCMidnight(e.hasta),
        );
        return [...new Set(matches.map(e => e.novedad).filter(Boolean))].join(' / ');
      };

      // ── 3. Expandir: agente × fecha donde debe trabajar ───────────────────
      // Para cada fecha del rango, filtrar quién tiene ese día como controlable
      type ExpandedRow = { dni: string; nombre: string; upa: string; esGuardia: boolean; planta: string; fecha: string; diaSemana: string; horaEntradaProg: string | null; horaSalidaProg: string | null };
      const expanded: ExpandedRow[] = [];

      for (const fechaIso of fechas) {
        const dt  = new Date(fechaIso + 'T00:00:00Z');
        const dow = dt.getUTCDay();
        const dowKey = DOW_KEYS[dow];
        const diaSemana = DOW_LABELS[dow];

        for (const [dni, info] of Object.entries(horariosMap)) {
          if (!info.horario[dowKey]) continue; // no controlable ese día
          const upa    = siapDniMap[dni]?.upa    ?? 'SIN UPA';
          const nombre = siapDniMap[dni]?.nombre || info.nombre || '';
          const horasDia = info.horas?.[dowKey];
          expanded.push({
            dni, nombre, upa, esGuardia: info.esGuardia, planta: info.planta ?? '', fecha: fechaIso, diaSemana,
            horaEntradaProg: horasDia?.horaEntrada ?? null,
            horaSalidaProg:  horasDia?.horaSalida  ?? null,
          });
        }
      }

      if (expanded.length === 0) {
        const emptyMeta = { total: 0, sinSalida: 0, sinFichaje: 0, justificados: 0, conSalida: 0, sinBiometrico: false, dbError: null };
        return res.json({ ok: true, data: [], meta: emptyMeta });
      }

      // ── 4. Consultar DB biométrica (una sola query para el rango completo) ─
      // fichajesMap[dni][fechaISO] = { entrada, salida, eventos[] }
      // fechaOrig = fecha real del checktime (antes de cualquier reasignación de día)
      type FichajeInfo = { entrada: string | null; salida: string | null; eventos: Array<{ hora: string; checktype: number; fechaOrig: string; sn: string }> };
      const fichajesMap: Record<string, Record<string, FichajeInfo>> = {};
      const servicioDbMap: Record<string, string> = {};
      const rawEntryEvents: Array<{ dni: string; fechaOrig: string; hora: string }> = [];
      let dbError: string | null = null;
      // Resuelve el tipo efectivo del evento usando el SN del lector cuando es dedicado.
      // Se sobrescribe dentro del bloque biométrico con la clasificación real de la DB.
      let tipoLector = (sn: string, checktype: number): number => checktype;

      const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          const cfg  = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const conn = await mysql.createConnection({
            host:           cfg.mysqlHost || '127.0.0.1',
            port:           cfg.mysqlPort || 3306,
            user:           cfg.mysqlUser || 'root',
            password:       cfg.mysqlPass || '',
            database:       cfg.mysqlDb   || 'adms_db',
            connectTimeout: 10_000,
            dateStrings:    true,
          });

          const allDnis = [...new Set(expanded.map(r => r.dni))];
          // Mapa rápido DNI → esGuardia para usar al procesar registros
          const guardiaDnis = new Set(expanded.filter(r => r.esGuardia).map(r => r.dni));

          // Extender el rango hasta las 14:00 del día siguiente al rangoMax
          // para capturar salidas de turno nocturno / guardia 24hs
          const rangoMaxPlusOneDate = new Date(rangoMax + 'T00:00:00Z');
          rangoMaxPlusOneDate.setUTCDate(rangoMaxPlusOneDate.getUTCDate() + 1);
          const rangoMaxPlusOne = rangoMaxPlusOneDate.toISOString().slice(0, 10);

          // Clasificar lectores por SN: '0'=dedicado entrada, '1'=dedicado salida, null=bidireccional
          const [snRows] = await conn.query<RowDataPacket[]>(
            `SELECT SN, checktype, COUNT(*) AS cnt FROM checkinout WHERE SN IS NOT NULL AND SN != '' GROUP BY SN, checktype`
          );
          const snCount: Record<string, { e: number; s: number }> = {};
          for (const r of snRows) {
            const sn = String(r.SN);
            if (!snCount[sn]) snCount[sn] = { e: 0, s: 0 };
            if (String(r.checktype) === '0') snCount[sn].e += Number(r.cnt);
            else snCount[sn].s += Number(r.cnt);
          }
          // Cada SN tiene un tipo físico fijo (0=Entrada, 1=Salida).
          // Los registros con el tipo opuesto son errores del dispositivo.
          // El tipo del lector es el checktype dominante: el que más aparece.
          const lectorTipo: Record<string, 0 | 1> = {};
          for (const [sn, { e, s }] of Object.entries(snCount)) {
            lectorTipo[sn] = s > e ? 1 : 0;
          }
          tipoLector = (sn: string, checktype: number): number =>
            sn in lectorTipo ? lectorTipo[sn] : checktype;

          const ph      = allDnis.map(() => '?').join(',');

          // Leer servicio vigente de cada agente desde personalv5.agentes_servicios
          try {
            const connPv5 = await mysql.createConnection({
              host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
              user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '',
              database: 'personalv5', connectTimeout: 10_000,
            });
            const phPv5 = allDnis.map(() => '?').join(',');
            const [srvRows] = await connPv5.query<RowDataPacket[]>(
              `SELECT a.dni, s.nombre AS servicio
                 FROM agentes_servicios a
                 INNER JOIN servicios s ON a.servicio_id = s.id AND s.deleted_at IS NULL
                 WHERE a.dni IN (${phPv5})
                   AND a.deleted_at IS NULL
                   AND (a.fecha_hasta IS NULL OR a.fecha_hasta >= CURDATE())
                 ORDER BY a.fecha_desde DESC`,
              allDnis,
            );
            await connPv5.end();
            for (const r of srvRows) {
              const d = normDni(String(r.dni));
              if (!servicioDbMap[d]) servicioDbMap[d] = String(r.servicio ?? '');
            }
          } catch (e: any) {
            logger.warn({ msg: 'sin-salida: no se pudo leer servicios de personalv5', error: e?.message });
          }

          const [dbRows] = await conn.query<RowDataPacket[]>(
            `SELECT ui.badgenumber, ci.checktime, ci.checktype, COALESCE(ci.SN, '') AS SN
               FROM checkinout ci
               INNER JOIN userinfo ui ON ci.userid = ui.userid
               WHERE ui.badgenumber IN (${ph})
                 AND ci.checktime >= ? AND ci.checktime <= ?
               ORDER BY ci.checktime ASC`,
            [...allDnis, `${rangoMin} 00:00:00`, `${rangoMaxPlusOne} 14:00:00`],
          );
          await conn.end();

          // Pasada 1: registrar todas las entradas (tipo=0).
          // Para guardias: si la entrada cae después de las 20:00 en un día NO controlable
          // pero el día siguiente SÍ es controlable, reasignarla al día siguiente
          // (el agente fichó unos minutos antes de medianoche, pero el turno es del día siguiente).
          for (const r of dbRows) {
            if (String(r.checktype) !== '0') continue;
            const dniR    = normDni(String(r.badgenumber));
            const cts     = String(r.checktime);
            const fechaOrig = cts.slice(0, 10);
            let   fecha   = fechaOrig;
            const hora    = cts.slice(11, 16);
            rawEntryEvents.push({ dni: dniR, fechaOrig, hora });

            if (guardiaDnis.has(dniR) && hora >= '20:00') {
              const dt = new Date(fecha + 'T00:00:00Z');
              const dowHoy = DOW_KEYS[dt.getUTCDay()];
              dt.setUTCDate(dt.getUTCDate() + 1);
              const fechaSig  = dt.toISOString().slice(0, 10);
              const dowSig    = DOW_KEYS[dt.getUTCDay()];
              const infoAgent = horariosMap[dniR];
              if (infoAgent && !infoAgent.horario[dowHoy] && infoAgent.horario[dowSig]) {
                fecha = fechaSig;
              }
            }

            if (!fichajesMap[dniR]) fichajesMap[dniR] = {};
            if (!fichajesMap[dniR][fecha]) fichajesMap[dniR][fecha] = { entrada: null, salida: null, eventos: [] };
            fichajesMap[dniR][fecha].eventos.push({ hora, checktype: 0, fechaOrig, sn: String(r.SN || '') });
            if (!fichajesMap[dniR][fecha].entrada || hora < fichajesMap[dniR][fecha].entrada!)
              fichajesMap[dniR][fecha].entrada = hora;
          }

          // Pasada 2: registrar salidas (tipo=1) con reasignación condicional.
          // Reasignar al día anterior SOLO cuando se cumplen las tres condiciones:
          //   1. La hora de salida cae dentro del cutoff (< 06:00 normal / < 14:00 guardia)
          //   2. NO hay entrada registrada ese mismo día calendario (si hay entrada ese día,
          //      la salida pertenece a ese turno sin importar la hora)
          //   3. SÍ hay entrada registrada el día anterior (confirma turno nocturno cruzado)
          for (const r of dbRows) {
            if (String(r.checktype) !== '1') continue;
            const dniR    = normDni(String(r.badgenumber));
            const cts     = String(r.checktime);
            const fechaOrig = cts.slice(0, 10);
            let   fecha   = fechaOrig;
            const hora    = cts.slice(11, 16);

            if (shouldAssignSalidaToPreviousDay(dniR, fechaOrig, hora, fichajesMap, horariosMap)) {
              fecha = addDaysIso(fechaOrig, -1);
            }

            if (!fichajesMap[dniR]) fichajesMap[dniR] = {};
            if (!fichajesMap[dniR][fecha]) fichajesMap[dniR][fecha] = { entrada: null, salida: null, eventos: [] };
            fichajesMap[dniR][fecha].eventos.push({ hora, checktype: 1, fechaOrig, sn: String(r.SN || '') });
            if (!fichajesMap[dniR][fecha].salida || hora > fichajesMap[dniR][fecha].salida!)
              fichajesMap[dniR][fecha].salida = hora;
          }
        } catch (e: any) {
          dbError = e?.message ?? 'Error al consultar DB biométrica';
          logger.warn({ msg: 'sin-salida: error DB biométrica', error: dbError });
        }
      } else {
        dbError = 'fichero_config.json no encontrado — configura la conexión en el módulo Fichero';
      }

      // ── 5. Construir resultado ─────────────────────────────────────────────
      const semanasRango = Array.from(new Set(fechas.map(getWeekStartIso))).sort();
      const nocturnosAlternados = new Set(
        Object.entries(horariosMap)
          .filter(([, info]) => {
            if (info.esGuardia) return false;
            const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'] as const;
            return dias.every(d =>
              info.horario[d] &&
              info.horas[d]?.horaEntrada === '18:00' &&
              info.horas[d]?.horaSalida === '06:00',
            );
          })
          .map(([dni]) => dni),
      );

      const patronesSemanalesNocturnos: Record<string, Record<string, 'LMV' | 'MJ'>> = {};
      for (const dni of nocturnosAlternados) {
        const known: Record<string, 'LMV' | 'MJ'> = {};
        const counts = new Map<string, { lmv: number; mj: number }>();

        rawEntryEvents
          .filter(e => e.dni === dni && e.hora >= '16:00')
          .forEach(e => {
            const dow = new Date(e.fechaOrig + 'T00:00:00Z').getUTCDay();
            const week = getWeekStartIso(e.fechaOrig);
            const acc = counts.get(week) ?? { lmv: 0, mj: 0 };
            if (dow === 1 || dow === 3 || dow === 5) acc.lmv += 1;
            if (dow === 2 || dow === 4) acc.mj += 1;
            counts.set(week, acc);
          });

        for (const [week, c] of counts.entries()) {
          if (c.lmv > c.mj && c.lmv > 0) known[week] = 'LMV';
          else if (c.mj > c.lmv && c.mj > 0) known[week] = 'MJ';
        }

        const resolved: Record<string, 'LMV' | 'MJ'> = { ...known };
        const knownWeeks = Object.keys(known).sort();
        for (const anchor of knownWeeks) {
          const anchorIdx = semanasRango.indexOf(anchor);
          if (anchorIdx < 0) continue;
          const anchorPat = known[anchor];
          for (let i = 0; i < semanasRango.length; i++) {
            const week = semanasRango[i];
            if (resolved[week]) continue;
            const distance = Math.abs(i - anchorIdx);
            resolved[week] = distance % 2 === 0 ? anchorPat : (anchorPat === 'LMV' ? 'MJ' : 'LMV');
          }
        }

        if (Object.keys(resolved).length > 0) patronesSemanalesNocturnos[dni] = resolved;
      }

      const expandedFiltrado = expanded.filter(row => {
        if (!nocturnosAlternados.has(row.dni)) return true;
        if (row.horaEntradaProg !== '18:00' || row.horaSalidaProg !== '06:00') return true;
        const pattern = patronesSemanalesNocturnos[row.dni]?.[getWeekStartIso(row.fecha)];
        if (!pattern) return true;
        const dow = new Date(row.fecha + 'T00:00:00Z').getUTCDay();
        if (pattern === 'LMV') return dow === 1 || dow === 3 || dow === 5;
        return dow === 2 || dow === 4;
      });

      const ORDEN: Record<string, number> = { SOSPECHOSO: 0, SIN_SALIDA: 1, SOLO_SALIDA: 2, PRESENTE_SIN_ESTAR: 3, SIN_FICHAJE: 4, REQUIERE_REVISION: 5, JUSTIFICADO: 6, CON_SALIDA: 7 };

      // ── Reconocimientos médicos ───────────────────────────────────────────────
      const recMedicoMap = new Map<string, string>();
      if (sequelize && expandedFiltrado.length > 0) {
        try {
          const allDnisRec  = [...new Set(expandedFiltrado.map(r => r.dni))];
          const allDatesRec = expandedFiltrado.map(r => r.fecha);
          const minDateRec  = allDatesRec.reduce((a, b) => (a < b ? a : b));
          const maxDateRec  = allDatesRec.reduce((a, b) => (a > b ? a : b));
          const [recRows] = await sequelize.query(
            `SELECT dni, fecha_desde, fecha_hasta, tipo
               FROM reconocimientos_medicos
              WHERE dni IN (${allDnisRec.map(() => '?').join(',')})
                AND fecha_desde <= ?
                AND (fecha_hasta >= ? OR fecha_hasta IS NULL)`,
            { replacements: [...allDnisRec, maxDateRec, minDateRec] },
          ) as [any[], unknown];
          for (const rec of recRows) {
            const dniRec  = String(rec.dni ?? '').replace(/\D/g, '');
            const desde   = String(rec.fecha_desde ?? '').slice(0, 10);
            const hasta   = rec.fecha_hasta ? String(rec.fecha_hasta).slice(0, 10) : maxDateRec;
            const tipoRec = String(rec.tipo ?? '').trim();
            for (const row of expandedFiltrado) {
              if (row.dni !== dniRec) continue;
              if (row.fecha >= desde && row.fecha <= hasta) {
                const key = `${row.dni}|${row.fecha}`;
                if (!recMedicoMap.has(key)) recMedicoMap.set(key, tipoRec);
              }
            }
          }
        } catch (e: any) {
          logger.warn({ msg: 'sin-salida: error consultando reconocimientos_medicos', error: e?.message });
        }
      }

      const data = expandedFiltrado.map(row => {
        const fich      = fichajesMap[row.dni]?.[row.fecha];
        const novSiap   = getSiapNovedad(row.dni, row.fecha);
        const novMin    = getMinisterioNovedad(row.dni, row.fecha);
        const revisionNocturnoAmbiguo =
          nocturnosAlternados.has(row.dni) &&
          row.horaEntradaProg === '18:00' &&
          row.horaSalidaProg === '06:00' &&
          !patronesSemanalesNocturnos[row.dni]?.[getWeekStartIso(row.fecha)];
        const siapPresente = novSiap
          .split('/')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
          .includes('PRESENTE');

        let estado: string;
        if (fich?.entrada && fich?.salida)  estado = 'CON_SALIDA';
        else if (fich?.entrada)             estado = 'SIN_SALIDA';
        else if (fich?.salida)              estado = 'SOLO_SALIDA';
        else if (siapPresente)              estado = 'PRESENTE_SIN_ESTAR';
        else if (novSiap || novMin)         estado = 'JUSTIFICADO';
        else if (revisionNocturnoAmbiguo)   estado = 'REQUIERE_REVISION';
        else                                estado = 'SIN_FICHAJE';

        let fichajeInvertido = false;
        let salidaFaltante   = false;
        if (fich?.eventos?.length && row.horaEntradaProg && row.horaSalidaProg) {
          const entProg = row.horaEntradaProg;
          const salProg = row.horaSalidaProg;
          const RANGO   = 120; // ±2 horas en minutos

          if (entProg !== salProg) {
            // Turno normal: cada evento pertenece a la mitad del turno que le queda más cerca.
            // Si el tipo del lector no coincide con el esperado para esa mitad → invertido.
            const eventosHoy = fich.eventos.filter(e => e.fechaOrig === row.fecha);
            const cercaEntrada = (hora: string) => timeDiffMins(hora, entProg) <= timeDiffMins(hora, salProg);

            const hayEntradaValida = eventosHoy.some(e =>  cercaEntrada(e.hora) && tipoLector(e.sn, e.checktype) === 0);
            const haySalidaValida  = eventosHoy.some(e => !cercaEntrada(e.hora) && tipoLector(e.sn, e.checktype) === 1);

            fichajeInvertido = eventosHoy.some(e => {
              const tipo     = tipoLector(e.sn, e.checktype);
              const esperado = cercaEntrada(e.hora) ? 0 : 1;
              return tipo !== esperado;
            });
            salidaFaltante = hayEntradaValida && !haySalidaValida;
          } else {
            // Turno 24hs: entrada=salida en el Excel → entra el día del turno, sale al día siguiente.
            // Los eventos del día del turno deben ser Entrada (0), los del día siguiente Salida (1).
            const nextDayDt = new Date(row.fecha + 'T00:00:00Z');
            nextDayDt.setUTCDate(nextDayDt.getUTCDate() + 1);
            const nextDay = nextDayDt.toISOString().slice(0, 10);

            const hayEntradaValidaHoy    = fich.eventos.some(e => e.fechaOrig === row.fecha && tipoLector(e.sn, e.checktype) === 0);
            const haySalidaValidaNextDay = fich.eventos.some(e => e.fechaOrig === nextDay   && tipoLector(e.sn, e.checktype) === 1);

            fichajeInvertido = fich.eventos.some(e => {
              const tipo     = tipoLector(e.sn, e.checktype);
              const esperado = e.fechaOrig === row.fecha ? 0 : 1;
              return tipo !== esperado;
            });
            salidaFaltante = hayEntradaValidaHoy && !haySalidaValidaNextDay;
          }
        }

        if (fichajeInvertido) estado = 'SOSPECHOSO';

        const recKey = `${row.dni}|${row.fecha}`;
        return {
          dni:                  row.dni,
          nombre:               row.nombre,
          upa:                  row.upa,
          esGuardia:            row.esGuardia,
          ocupacion:            row.planta,
          servicio:             servicioDbMap[row.dni] ?? '',
          fecha:                row.fecha,
          diaSemana:            row.diaSemana,
          entrada:              fich?.entrada ?? null,
          salida:               fich?.salida  ?? null,
          horaEntradaProgramada: row.horaEntradaProg,
          horaSalidaProgramada:  row.horaSalidaProg,
          novedadSiap:          novSiap,
          novedadMinisterio:    novMin,
          estado,
          fichajeInvertido,
          salidaFaltante,
          recMedico:            recMedicoMap.has(recKey) ? (recMedicoMap.get(recKey) || 'Sí') : null,
        };
      });

      // Ordenar: estado (SIN_SALIDA primero) → nombre → fecha
      data.sort((a, b) => {
        const eo = (ORDEN[a.estado] ?? 99) - (ORDEN[b.estado] ?? 99);
        if (eo !== 0) return eo;
        const no = a.nombre.localeCompare(b.nombre);
        if (no !== 0) return no;
        return a.fecha.localeCompare(b.fecha);
      });

      const agentesConProblema = new Set(
        data.filter(r => r.estado === 'SOSPECHOSO' || r.estado === 'SIN_SALIDA' || r.estado === 'SOLO_SALIDA' || r.estado === 'PRESENTE_SIN_ESTAR' || r.estado === 'SIN_FICHAJE').map(r => r.dni)
      ).size;

      const agentesInvertidos = new Set(
        data.filter(r => r.fichajeInvertido).map(r => r.dni)
      ).size;

      // Construir mapa de novedades SIAP por agente para el modal
      const siapAgentes: Record<string, { novedades: Array<{ novedad: string; desde: string; hasta: string }> }> = {};
      for (const [dni, info] of Object.entries(siapDniMap)) {
        siapAgentes[dni] = {
          novedades: info.novedades
            .filter(n => n.novedad)
            .map(n => ({ novedad: n.novedad, desde: dateToStr(n.desde), hasta: dateToStr(n.hasta) })),
        };
      }

      // Construir mapa de horarios por agente para el modal
      // (qué días trabaja y en qué horarios, según el Excel de horarios)
      const horariosAgentes: Record<string, {
        nombre: string;
        diasLaborables: string[];
        horas: Record<string, { entrada: string | null; salida: string | null }>;
      }> = {};
      for (const [dni, info] of Object.entries(horariosMap)) {
        const diasLaborables = DOW_KEYS.filter(k => info.horario[k]).map(k => DOW_LABELS[DOW_KEYS.indexOf(k)]);
        const horas: Record<string, { entrada: string | null; salida: string | null }> = {};
        for (const k of DOW_KEYS) {
          if (info.horario[k]) {
            horas[DOW_LABELS[DOW_KEYS.indexOf(k)]] = {
              entrada: info.horas[k]?.horaEntrada ?? null,
              salida:  info.horas[k]?.horaSalida  ?? null,
            };
          }
        }
        horariosAgentes[dni] = { nombre: info.nombre, diasLaborables, horas };
      }

      // Agentes presentes en SIAP pero sin horario en el Excel
      const sinHorarioAgentes: Array<{ dni: string; nombre: string; upa: string }> =
        Object.entries(siapDniMap)
          .filter(([dni]) => !horariosMap[dni])
          .map(([dni, info]) => ({ dni, nombre: info.nombre, upa: info.upa }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));

      const uniq = (estado: string) => new Set(data.filter(r => r.estado === estado).map(r => r.dni)).size;

      return res.json({
        ok: true,
        data,
        siapAgentes,
        horariosAgentes,
        sinHorarioAgentes,
        meta: {
          total:              new Set(data.map(r => r.dni)).size,
          sospechosos:        uniq('SOSPECHOSO'),
          sinSalida:          uniq('SIN_SALIDA'),
          soloSalida:         uniq('SOLO_SALIDA'),
          sinFichaje:         uniq('SIN_FICHAJE'),
          presentesSinEstar:  uniq('PRESENTE_SIN_ESTAR'),
          requiereRevision:   uniq('REQUIERE_REVISION'),
          justificados:       uniq('JUSTIFICADO'),
          conSalida:          uniq('CON_SALIDA'),
          agentesConProblema,
          agentesInvertidos,
          sinBiometrico: !!dbError,
          dbError,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  // ── POST /sin-salida/ficho-sin-deber ────────────────────────────────────────
  // Detecta agentes que ficharon (biométrico) en días que el horario Excel
  // marca como NO laborables para ellos (controlable = false).
  // Ej: horario dice lunes-martes y aparece entrada/salida un sábado o domingo.
  router.post('/ficho-sin-deber', requirePermission('api:access'), async (req: Request, res: Response) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'Falta dependencia exceljs' });
    try {
      const dir   = getDir();
      const files = listExcelFiles(dir);

      // ── 1. Rango de fechas (idéntico al route principal) ──────────────
      const periodoStr = String(req.body?.periodo ?? '').trim();
      const fechaStr   = String(req.body?.fecha   ?? '').trim();
      const desdeStr   = String(req.body?.desde   ?? '').trim();
      const hastaStr   = String(req.body?.hasta   ?? '').trim();

      let fechas: string[] = [];
      if (/^\d{4}-\d{2}$/.test(periodoStr)) {
        const [y, m] = periodoStr.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const ayerDt = new Date();
        ayerDt.setUTCDate(ayerDt.getUTCDate() - 1);
        const ayer = ayerDt.toISOString().slice(0, 10);
        for (let d = 1; d <= daysInMonth; d++) {
          const f = `${periodoStr}-${String(d).padStart(2, '0')}`;
          if (f > ayer) break;
          fechas.push(f);
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(desdeStr) && /^\d{4}-\d{2}-\d{2}$/.test(hastaStr) && desdeStr <= hastaStr) {
        const ayerDt = new Date();
        ayerDt.setUTCDate(ayerDt.getUTCDate() - 1);
        const ayer = ayerDt.toISOString().slice(0, 10);
        let cur = desdeStr;
        while (cur <= hastaStr && cur <= ayer) {
          fechas.push(cur);
          cur = addDaysIso(cur, 1);
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        const hoy = new Date().toISOString().slice(0, 10);
        if (fechaStr >= hoy) {
          fechas = [];
        } else {
          fechas = [fechaStr];
        }
      } else {
        return res.status(400).json({ ok: false, error: 'Falta "fecha" (YYYY-MM-DD), "desde"+"hasta" o "periodo" (YYYY-MM)' });
      }

      if (fechas.length === 0) {
        return res.json({
          ok: true,
          data: [],
          meta: {
            total: 0,
            agentes: 0,
            sinBiometrico: false,
            dbError: null,
          },
        });
      }

      const rangoMin = fechas[0];
      const rangoMax = fechas[fechas.length - 1];

      // ── 2. Leer horarios ───────────────────────────────────────────────
      const horariosFileNames: string[] = Array.isArray(req.body?.horariosFiles) && req.body.horariosFiles.length > 0
        ? req.body.horariosFiles
        : files.filter(f => f.name.toLowerCase().includes('horario')).map(f => f.name);

      const horariosMap: Record<string, { nombre: string; esGuardia: boolean; planta: string; horario: HorarioDia; horas: Record<string, HorasDia> }> = {};
      for (const fileName of horariosFileNames) {
        const fp = path.join(dir, fileName);
        if (!fs.existsSync(fp)) continue;
        try {
          Object.assign(horariosMap, await parseHorariosFile(fp));
        } catch (e: any) {
          logger.warn({ msg: 'ficho-sin-deber: error leyendo horarios', file: fileName, error: e?.message });
        }
      }

      if (Object.keys(horariosMap).length === 0) {
        return res.status(400).json({ ok: false, error: 'No se encontraron datos en los archivos de horarios' });
      }

      // ── 3. Leer SIAP (solo para nombre y UPA, igual que route principal) ─
      const siapFileNames: string[] = Array.isArray(req.body?.siapFiles) && req.body.siapFiles.length > 0
        ? req.body.siapFiles
        : files.filter(f => f.name.toLowerCase().includes('siap')).map(f => f.name);

      const siapDniMap: Record<string, { nombre: string; upa: string }> = {};
      for (const fileName of siapFileNames) {
        const fp = path.join(dir, fileName);
        if (!fs.existsSync(fp)) continue;
        try {
          const rows = await parseSiapFile(fp);
          for (const r of rows) {
            if (!siapDniMap[r.dni]) siapDniMap[r.dni] = { nombre: r.nombre, upa: r.upa };
          }
        } catch {}
      }

      // ── 4. Consultar DB biométrica para TODOS los agentes del horario ──
      type FichajeInfo = { entrada: string | null; salida: string | null };
      const fichajesMap: Record<string, Record<string, FichajeInfo>> = {};
      let dbError: string | null = null;

      const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          const cfg  = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const conn = await mysql.createConnection({
            host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
            user: cfg.mysqlUser || 'root',      password: cfg.mysqlPass || '',
            database: cfg.mysqlDb || 'adms_db',
            connectTimeout: 10_000, dateStrings: true,
          });

          const allDnis = Object.keys(horariosMap);
          const rangoMaxPlusOneDate = new Date(rangoMax + 'T00:00:00Z');
          rangoMaxPlusOneDate.setUTCDate(rangoMaxPlusOneDate.getUTCDate() + 1);
          const rangoMaxPlusOne = rangoMaxPlusOneDate.toISOString().slice(0, 10);

          const ph = allDnis.map(() => '?').join(',');
          const [dbRows] = await conn.query<RowDataPacket[]>(
            `SELECT ui.badgenumber, ci.checktime, ci.checktype
               FROM checkinout ci
               INNER JOIN userinfo ui ON ci.userid = ui.userid
               WHERE ui.badgenumber IN (${ph})
                 AND ci.checktime >= ? AND ci.checktime <= ?
               ORDER BY ci.checktime ASC`,
            [...allDnis, `${rangoMin} 00:00:00`, `${rangoMaxPlusOne} 14:00:00`],
          );
          await conn.end();

          // Pasada 1: entradas
          for (const r of dbRows) {
            if (String(r.checktype) !== '0') continue;
            const dniR  = normDni(String(r.badgenumber));
            const cts   = String(r.checktime);
            const fecha = cts.slice(0, 10);
            const hora  = cts.slice(11, 16);
            if (!fichajesMap[dniR]) fichajesMap[dniR] = {};
            if (!fichajesMap[dniR][fecha]) fichajesMap[dniR][fecha] = { entrada: null, salida: null };
            if (!fichajesMap[dniR][fecha].entrada || hora < fichajesMap[dniR][fecha].entrada!)
              fichajesMap[dniR][fecha].entrada = hora;
          }

          // Pasada 2: salidas (mismo cutoff corregido del route principal)
          const guardiaDnis = new Set(Object.entries(horariosMap).filter(([,v]) => v.esGuardia).map(([k]) => k));
          for (const r of dbRows) {
            if (String(r.checktype) !== '1') continue;
            const dniR  = normDni(String(r.badgenumber));
            const cts   = String(r.checktime);
            let   fecha = cts.slice(0, 10);
            const hora  = cts.slice(11, 16);
            if (shouldAssignSalidaToPreviousDay(dniR, fecha, hora, fichajesMap, horariosMap)) {
              fecha = addDaysIso(fecha, -1);
            }
            if (!fichajesMap[dniR]) fichajesMap[dniR] = {};
            if (!fichajesMap[dniR][fecha]) fichajesMap[dniR][fecha] = { entrada: null, salida: null };
            if (!fichajesMap[dniR][fecha].salida || hora > fichajesMap[dniR][fecha].salida!)
              fichajesMap[dniR][fecha].salida = hora;
          }
        } catch (e: any) {
          dbError = e?.message ?? 'Error al consultar DB biométrica';
        }
      } else {
        dbError = 'fichero_config.json no encontrado';
      }

      // ── 5. Cruzar: días NO laborables según horario pero CON fichaje ───
      // Para cada fecha del período, para cada agente, si ese día NO es
      // controlable pero tiene registro biométrico → flag.
      const data: Array<{
        dni: string; nombre: string; upa: string; esGuardia: boolean;
        fecha: string; diaSemana: string; diasLaborables: string;
        entrada: string | null; salida: string | null;
      }> = [];

      for (const fechaIso of fechas) {
        const dt     = new Date(fechaIso + 'T00:00:00Z');
        const dow    = dt.getUTCDay();
        const dowKey = DOW_KEYS[dow];
        const diaSemana = DOW_LABELS[dow];

        for (const [dni, info] of Object.entries(horariosMap)) {
          if (info.horario[dowKey]) continue; // sí era laborable → no es el caso que buscamos
          const fich = fichajesMap[dni]?.[fechaIso];
          if (!fich?.entrada && !fich?.salida) continue; // sin fichaje ese día → OK

          const upa    = siapDniMap[dni]?.upa    ?? 'SIN UPA';
          const nombre = siapDniMap[dni]?.nombre || info.nombre || '';

          // Armar etiqueta de días laborables programados para contexto
          const diasLaborables = DOW_KEYS
            .filter(k => info.horario[k])
            .map(k => DOW_LABELS[DOW_KEYS.indexOf(k)])
            .join(', ') || '—';

          data.push({ dni, nombre, upa, esGuardia: info.esGuardia, fecha: fechaIso, diaSemana, diasLaborables, entrada: fich.entrada, salida: fich.salida });
        }
      }

      data.sort((a, b) => {
        const n = a.nombre.localeCompare(b.nombre);
        return n !== 0 ? n : a.fecha.localeCompare(b.fecha);
      });

      return res.json({
        ok: true,
        data,
        meta: {
          total:         data.length,
          agentes:       new Set(data.map(r => r.dni)).size,
          sinBiometrico: !!dbError,
          dbError,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  // ── POST /sin-salida/fichajes-agente ─────────────────────────────────────────
  // Devuelve registros crudos de checkinout para un agente en el período.
  // Body: { dni, periodo?: "YYYY-MM", fecha?: "YYYY-MM-DD" }
  router.post('/fichajes-agente', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      const dni        = normDni(String(req.body?.dni ?? ''));
      const periodoStr = String(req.body?.periodo ?? '').trim();
      const fechaStr   = String(req.body?.fecha   ?? '').trim();
      const desdeStr2  = String(req.body?.desde   ?? '').trim();
      const hastaStr2  = String(req.body?.hasta   ?? '').trim();
      const fechasReq  = Array.isArray(req.body?.fechas)
        ? req.body.fechas.map((f: any) => String(f ?? '').trim()).filter((f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        : [];

      if (!dni) return res.status(400).json({ ok: false, error: 'Falta "dni"' });

      let rangoMin: string, rangoMax: string;
      if (/^\d{4}-\d{2}$/.test(periodoStr)) {
        const [y, m] = periodoStr.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        rangoMin = `${periodoStr}-01`;
        rangoMax = `${periodoStr}-${String(daysInMonth).padStart(2, '0')}`;
        const hoy = new Date().toISOString().slice(0, 10);
        if (rangoMax > hoy) rangoMax = hoy;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(desdeStr2) && /^\d{4}-\d{2}-\d{2}$/.test(hastaStr2) && desdeStr2 <= hastaStr2) {
        rangoMin = desdeStr2;
        rangoMax = hastaStr2;
        const hoy = new Date().toISOString().slice(0, 10);
        if (rangoMax > hoy) rangoMax = hoy;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        rangoMin = fechaStr;
        rangoMax = fechaStr;
      } else {
        return res.status(400).json({ ok: false, error: 'Falta "fecha" (YYYY-MM-DD), "desde"+"hasta" o "periodo" (YYYY-MM)' });
      }

      const rangoMaxPlusOneDate = new Date(rangoMax + 'T00:00:00Z');
      rangoMaxPlusOneDate.setUTCDate(rangoMaxPlusOneDate.getUTCDate() + 1);
      const rangoMaxPlusOne = rangoMaxPlusOneDate.toISOString().slice(0, 10);

      const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
      if (!fs.existsSync(cfgPath)) {
        return res.json({ ok: true, data: [], sinBiometrico: true, dbError: 'fichero_config.json no encontrado' });
      }

      const cfg  = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const conn = await mysql.createConnection({
        host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
        user: cfg.mysqlUser || 'root',      password: cfg.mysqlPass || '',
        database: cfg.mysqlDb || 'adms_db',
        connectTimeout: 10_000, dateStrings: true,
      });

      const [snRowsR] = await conn.query<RowDataPacket[]>(
        `SELECT SN, checktype, COUNT(*) AS cnt FROM checkinout WHERE SN IS NOT NULL AND SN != '' GROUP BY SN, checktype`
      );
      const snCountR: Record<string, { e: number; s: number }> = {};
      for (const r of snRowsR) {
        const sn = String(r.SN);
        if (!snCountR[sn]) snCountR[sn] = { e: 0, s: 0 };
        if (String(r.checktype) === '0') snCountR[sn].e += Number(r.cnt);
        else snCountR[sn].s += Number(r.cnt);
      }
      const lectorTipoR: Record<string, 0 | 1> = {};
      for (const [sn, { e, s }] of Object.entries(snCountR)) {
        lectorTipoR[sn] = s > e ? 1 : 0;
      }

      const [dbRows] = await conn.query<RowDataPacket[]>(
        `SELECT ci.checktime, ci.checktype, COALESCE(ci.SN, '') AS SN
           FROM checkinout ci
           INNER JOIN userinfo ui ON ci.userid = ui.userid
           WHERE ui.badgenumber = ?
             AND ci.checktime >= ? AND ci.checktime <= ?
           ORDER BY ci.checktime ASC`,
        [dni, `${rangoMin} 00:00:00`, `${rangoMaxPlusOne} 14:00:00`],
      );
      await conn.end();

      const fechasScope = new Set<string>();
      if (fechasReq.length > 0) {
        for (const fecha of fechasReq) {
          fechasScope.add(addDaysIso(fecha, -1));
          fechasScope.add(fecha);
          fechasScope.add(addDaysIso(fecha, 1));
        }
      }

      const data = dbRows.map(r => {
        const sn       = String(r.SN || '');
        const tipoReal = sn in lectorTipoR ? lectorTipoR[sn] : Number(r.checktype);
        return {
          checktime: String(r.checktime),
          fecha:     String(r.checktime).slice(0, 10),
          hora:      String(r.checktime).slice(11, 16),
          checktype: Number(r.checktype),
          tipoReal,
          sn,
          tipo:      tipoReal === 0 ? 'Entrada' : 'Salida',
        };
      }).filter(r => fechasScope.size === 0 || fechasScope.has(r.fecha));

      return res.json({ ok: true, data });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al consultar DB' });
    }
  });

  return router;
}
