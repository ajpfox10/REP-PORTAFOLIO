// src/routes/horariosExtendidos.routes.ts
// GET  /api/v1/horarios-extendidos          → JSON (agentes con algún turno > 10 h)
// GET  /api/v1/horarios-extendidos/export    → .xlsx (aplanado: una fila por día largo)
//
// Página SOLO para el rol 'nutricion' (+ admin): agentes que en el Excel de horarios
// (D:\...\HORARIOS.xlsx, EXCEL_ASISTENCIA_DIR) tienen algún turno de MÁS de 10 h.
// Reglas de duración (mismas que ausentismo, vía armarTurnos):
//   - entrada == salida            → 24 h
//   - salida  <  entrada (noche)   → cruza al día siguiente (ej. 19:00→07:00 = 12 h)
//   - salida  >  entrada           → duración normal
// Se listan SOLO los días con horas > 10 (estricto: 10 h exactas NO cuenta).
// Read-only. Cacheado 5 min.

import path from 'path';
import fs from 'fs';
import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { armarTurnos, type Turno } from '../services/ausentismoEval';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const UMBRAL_HORAS = 10; // estricto: se listan los turnos con horas > 10

// Columnas del Excel (0-based) — mismo layout que ausentismoEval.
const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const COLS: Record<string, [number, number]> = {
  lunes: [4, 5], martes: [6, 7], miercoles: [8, 9], jueves: [10, 11],
  viernes: [12, 13], sabado: [14, 15], domingo: [16, 17],
};
const DIA_LABEL: Record<string, string> = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};

function normHora(v: any): string | null {
  if (v == null) return null;
  let s = (typeof v === 'object' && v.text) ? String(v.text) : String(v);
  s = s.trim();
  if (!s || s === '-') return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : null;
}

// Columnas de estructura en HORARIOS.xlsx: E5 = col 26, E6 = col 27.
const COL_E5 = 26;
const COL_E6 = 27;

/** Dependencia operativa (igual criterio que asistencia): UPA 4 / UPA 18 / HOSPITAL. */
function resolveDependencia(e5raw: string, e6raw: string): string {
  const norm = (s: string) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const e6 = norm(e6raw);
  const e5 = norm(e5raw);
  const upaInE6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (upaInE6) return `UPA ${upaInE6[1]}`;
  const upaInE5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (upaInE5) return `UPA ${upaInE5[1]}`;
  return 'HOSPITAL';
}

function normTxt(s: any) {
  return String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

interface TurnoLargo {
  dia: string;          // etiqueta legible
  entrada: string;
  salida: string;
  horas: number;
  cruza: boolean;
}
interface AgenteRow {
  dni: number;
  apellido_nombre: string;
  regimen: string;      // REGIMEN_ESTATURARIO
  planta: string;
  agrupamiento: string;
  servicio: string;     // ESTRUCTURA_SERVICIO
  dependencia: string;  // HOSPITAL / UPA 4 / UPA 18 (derivada de E5/E6)
  max_horas: number;
  turnos: TurnoLargo[];
}
interface Payload {
  ok: boolean;
  resumen: { total_padron: number; con_turno_largo: number; con_24h: number };
  dependencias: string[];
  archivo: string | null;
  agentes: AgenteRow[];
  generado: string;
  error?: string;
}

const CACHE_TTL = 5 * 60 * 1000;
let cache: { ts: number; data: Payload } | null = null;

function hallarArchivo(): { dir: string | null; file: string | null; error: string | null } {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir || !fs.existsSync(dir)) {
    return { dir: null, file: null, error: 'EXCEL_ASISTENCIA_DIR no configurado o inexistente' };
  }
  const archivos = fs.readdirSync(dir)
    .filter((f: string) => /\.xls[xm]?$/i.test(f) && f.toLowerCase().includes('horario'));
  if (!archivos.length) return { dir, file: null, error: 'No se encontró ningún Excel de horarios en la carpeta' };
  return { dir, file: archivos[0], error: null };
}

function construir(): Payload {
  const generado = new Date().toISOString();
  const vacio = { total_padron: 0, con_turno_largo: 0, con_24h: 0 };
  if (!XLSX) return { ok: false, resumen: vacio, dependencias: [], archivo: null, agentes: [], generado, error: 'Falta dependencia xlsx' };

  const { dir, file, error } = hallarArchivo();
  if (error || !dir || !file) {
    return { ok: false, resumen: vacio, dependencias: [], archivo: null, agentes: [], generado, error: error || 'Excel no disponible' };
  }

  let rows: any[][] = [];
  try {
    const wb = XLSX.readFile(path.join(dir, file));
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  } catch (e: any) {
    logger.warn({ msg: 'horarios-extendidos: error leyendo Excel', file, error: e?.message });
    return { ok: false, resumen: vacio, dependencias: [], archivo: file, agentes: [], generado, error: `No se pudo leer el Excel: ${e?.message}` };
  }

  const agentes: AgenteRow[] = [];
  let totalPadron = 0;
  let con24 = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const dni = String(r[3] ?? '').replace(/\D/g, '');
    if (!dni) continue;
    totalPadron++;

    const raw: Record<string, { e: string | null; s: string | null }> = {};
    for (const k of DIAS) {
      const [ce, cs] = COLS[k];
      raw[k] = { e: normHora(r[ce]), s: normHora(r[cs]) };
    }
    const turnos: Turno[] = armarTurnos(raw);
    const largos = turnos
      .filter(t => t.horas > UMBRAL_HORAS)
      .map<TurnoLargo>(t => ({ dia: DIA_LABEL[t.dia] || t.dia, entrada: t.entrada, salida: t.salida, horas: t.horas, cruza: t.cruza }));
    if (!largos.length) continue;

    const maxHoras = largos.reduce((m, t) => Math.max(m, t.horas), 0);
    if (largos.some(t => t.horas >= 24)) con24++;

    agentes.push({
      dni: Number(dni),
      apellido_nombre: String(r[1] ?? '').trim(),
      regimen: String(r[18] ?? '').trim(),
      planta: String(r[19] ?? '').trim(),
      agrupamiento: String(r[21] ?? '').trim(),
      servicio: String(r[22] ?? '').trim(),
      dependencia: resolveDependencia(String(r[COL_E5] ?? ''), String(r[COL_E6] ?? '')),
      max_horas: maxHoras,
      turnos: largos,
    });
  }

  agentes.sort((a, b) => b.max_horas - a.max_horas || a.apellido_nombre.localeCompare(b.apellido_nombre, 'es'));
  const dependencias = [...new Set(agentes.map(a => a.dependencia))].sort((a, b) => a.localeCompare(b, 'es'));

  return {
    ok: true,
    resumen: { total_padron: totalPadron, con_turno_largo: agentes.length, con_24h: con24 },
    dependencias,
    archivo: file,
    agentes,
    generado,
  };
}

/** Filtro compartido (front y export): dependencia, texto (nombre/DNI/servicio) y solo 24 h. */
function filtrarAgentes(agentes: AgenteRow[], f: { q?: string; dependencia?: string; solo24?: boolean }): AgenteRow[] {
  const nq = normTxt(f.q).trim();
  const dep = (f.dependencia || '').trim().toUpperCase();
  return agentes.filter(a => {
    if (dep && dep !== 'TODAS' && a.dependencia.toUpperCase() !== dep) return false;
    if (f.solo24 && a.max_horas < 24) return false;
    if (nq) {
      const hay = normTxt(a.apellido_nombre).includes(nq) || String(a.dni).includes(nq) || normTxt(a.servicio).includes(nq);
      if (!hay) return false;
    }
    return true;
  });
}

function obtener(refresh: boolean): Payload {
  if (!refresh && cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  const data = construir();
  if (data.ok) cache = { ts: Date.now(), data };
  return data;
}

export function buildHorariosExtendidosRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = obtener(refresh);
    res.json(data);
  });

  router.get('/export', (req: Request, res: Response) => {
    if (!XLSX) return res.status(500).json({ ok: false, error: 'Falta dependencia xlsx' });
    const data = obtener(false);
    const agentes = filtrarAgentes(data.agentes, {
      q: String(req.query.q ?? ''),
      dependencia: String(req.query.dependencia ?? ''),
      solo24: req.query.solo24 === '1' || req.query.solo24 === 'true',
    });
    const flat: any[] = [];
    for (const a of agentes) {
      for (const t of a.turnos) {
        flat.push({
          DNI: a.dni,
          APELLIDO_NOMBRE: a.apellido_nombre,
          DEPENDENCIA: a.dependencia,
          DIA: t.dia,
          ENTRADA: t.entrada,
          SALIDA: t.salida,
          HORAS: t.horas,
          CRUZA_MEDIANOCHE: t.cruza ? 'SÍ' : 'NO',
          REGIMEN: a.regimen,
          PLANTA: a.planta,
          AGRUPAMIENTO: a.agrupamiento,
          SERVICIO: a.servicio,
        });
      }
    }
    const ws = XLSX.utils.json_to_sheet(flat);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mas de 10 horas');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="horarios_mas_de_10h_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  });

  router.post('/invalidar-cache', (_req: Request, res: Response) => {
    cache = null;
    res.json({ ok: true });
  });

  return router;
}

export default buildHorariosExtendidosRouter;
