// src/services/residentesControlSiape.ts
// Control "residentes activos en SIAPE" (07/11/2026).
//
// Problema: SIAPE a veces da de baja POR SU CUENTA a residentes / ex residentes que siguen
// trabajando. Regla del usuario: todo residente, y todo ex residente durante el año siguiente
// a terminar la residencia, que esté ACTIVO en la base (algún tramo ACTIVO/TRAMITE/INACTIVO/
// COMISION) tiene que figurar en SIAPE. Los que están de BAJA en la base no se controlan.
//
// Fuente SIAPE: HORARIOS.xlsx (consulta 76 "Horario Administrativo a un día", la baja el robot
// de exportaciones todos los días) + fotos mensuales HORARIOS_HISTORIAL\HORARIOS_YYYY-MM-01.xlsx.
// Plantel Nominado NO sirve: no trae residentes.
//
// Cada foto procesada se guarda en residentes_siape_fotos + residentes_siape_presencia
// (dni controlado × fecha → figuraba o no), así se sabe el día en que SIAPE lo sacó.
import fs from 'fs';
import path from 'path';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const VIVOS = ['ACTIVO', 'TRAMITE', 'INACTIVO', 'COMISION'];
const DIAS_EX_RESIDENTE = 365;
const DIAS_HISTORIAL = 400;          // fotos mensuales que se importan hacia atrás
const MIN_FILAS_FOTO = 500;          // menos que esto = exportación incompleta, no se usa
const THROTTLE_MS = 5 * 60 * 1000;

export type EstadoControl = 'ACTIVO_SIAPE' | 'BAJA_SIAPE' | 'ALTA_PENDIENTE';

export type ControlRow = {
  dni: number;
  apellido: string;
  nombre: string;
  condicion: 'RESIDENTE' | 'EX_RESIDENTE';
  fin_residencia: string | null;
  control_hasta: string | null;       // ex residente: fin + 365 días
  estado_base: string;
  ocupacion: string | null;
  ley: string | null;
  servicio: string | null;
  estado: EstadoControl;
  ultima_vez_en_siape: string | null;
  ausente_desde: string | null;       // primera foto en que ya no figuraba
  presencia: (0 | 1 | null)[];        // alineado con `columnas`
};

type Tramo = {
  id: number;
  dni: number;
  estado_empleo: string;
  fecha_egreso: string | null;
  ocupacion: string | null;
  ley: string | null;
  es_res: number;
  apellido: string;
  nombre: string;
};

const ensured = new WeakSet<Sequelize>();
let lastSync = 0;
let syncing: Promise<void> | null = null;

function dir() {
  return String((env as any).EXCEL_ASISTENCIA_DIR || 'D:\\G\\comparacion').trim();
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toYmd(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return ymd(v);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return ymd(d);
}

async function ensureTables(sequelize: Sequelize) {
  if (ensured.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS residentes_siape_fotos (
      fecha DATE NOT NULL, archivo VARCHAR(400) NOT NULL, archivo_mtime DATETIME NULL,
      filas INT NOT NULL DEFAULT 0, procesado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS residentes_siape_presencia (
      fecha DATE NOT NULL, dni INT NOT NULL, en_siape TINYINT(1) NOT NULL,
      PRIMARY KEY (fecha, dni), KEY idx_rsp_dni (dni, fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  ensured.add(sequelize);
}

// ── universo a controlar ──────────────────────────────────────────────────────
async function universo(sequelize: Sequelize) {
  const tramos = await sequelize.query<Tramo>(`
    SELECT a.id, a.dni, a.estado_empleo, a.fecha_egreso,
           oc.nombre AS ocupacion, l.nombre AS ley,
           (a.ley_id = 11 OR a.ocupacion_id = 132 OR UPPER(COALESCE(oc.nombre,'')) LIKE '%RESIDENTE%') AS es_res,
           p.apellido, p.nombre
      FROM agentes a
      JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
      LEFT JOIN ley l ON l.id = a.ley_id
      LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id
     WHERE a.deleted_at IS NULL
       AND a.dni IN (SELECT a2.dni FROM agentes a2
                       LEFT JOIN ocupaciones o2 ON o2.id = a2.ocupacion_id
                      WHERE a2.deleted_at IS NULL
                        AND (a2.ley_id = 11 OR a2.ocupacion_id = 132
                             OR UPPER(COALESCE(o2.nombre,'')) LIKE '%RESIDENTE%'))
     ORDER BY a.dni, a.id`, { type: QueryTypes.SELECT });

  const hoy = ymd(new Date());
  const limite = sumarDias(hoy, -DIAS_EX_RESIDENTE);
  const porDni = new Map<number, Tramo[]>();
  for (const t of tramos) {
    const k = Number(t.dni);
    if (!porDni.has(k)) porDni.set(k, []);
    porDni.get(k)!.push(t);
  }

  const out: Omit<ControlRow, 'estado' | 'ultima_vez_en_siape' | 'ausente_desde' | 'presencia' | 'servicio'>[] = [];
  for (const [dni, ts] of porDni) {
    const vivos = ts.filter((t) => VIVOS.includes(String(t.estado_empleo || '').toUpperCase()));
    if (!vivos.length) continue;                       // de BAJA en la base → no se controla
    const resVivo = vivos.some((t) => Number(t.es_res) === 1);
    const finRes = ts
      .filter((t) => Number(t.es_res) === 1 && !VIVOS.includes(String(t.estado_empleo || '').toUpperCase()))
      .map((t) => toYmd(t.fecha_egreso))
      .filter((f): f is string => !!f)
      .sort()
      .pop() || null;
    if (!resVivo && !(finRes && finRes >= limite)) continue;
    const actual = [...vivos].sort((a, b) =>
      (Number(b.estado_empleo === 'ACTIVO') - Number(a.estado_empleo === 'ACTIVO')) || (b.id - a.id))[0];
    out.push({
      dni,
      apellido: ts[0].apellido,
      nombre: ts[0].nombre,
      condicion: resVivo ? 'RESIDENTE' : 'EX_RESIDENTE',
      fin_residencia: resVivo ? null : finRes,
      control_hasta: resVivo || !finRes ? null : sumarDias(finRes, DIAS_EX_RESIDENTE),
      estado_base: actual.estado_empleo,
      ocupacion: actual.ocupacion,
      ley: actual.ley,
    });
  }
  return out;
}

async function servicios(sequelize: Sequelize, dnis: number[]) {
  const map = new Map<number, string>();
  if (!dnis.length) return map;
  const rows = await sequelize.query<{ dni: number; servicio: string | null }>(`
    SELECT ags.dni, COALESCE(s.nombre, ags.nombre) AS servicio
      FROM agentes_servicios ags
      LEFT JOIN servicios s ON s.id = ags.servicio_id
     WHERE ags.id IN (SELECT MAX(x.id) FROM agentes_servicios x
                       WHERE x.deleted_at IS NULL AND x.dni IN (:dnis)
                         AND (x.fecha_hasta IS NULL OR x.fecha_hasta >= CURDATE())
                       GROUP BY x.dni)`,
    { type: QueryTypes.SELECT, replacements: { dnis } });
  for (const r of rows) if (r.servicio) map.set(Number(r.dni), r.servicio);
  return map;
}

// ── fotos de SIAPE ────────────────────────────────────────────────────────────
function leerDnis(file: string): { dnis: Set<number>; filas: number } {
  const wb = XLSX.readFile(file, { cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const hdr = (raw[0] || []).map((h) => String(h ?? '').trim().toUpperCase());
  let col = hdr.indexOf('NRO_DOCUMENTO');
  if (col < 0) col = 3;
  const dnis = new Set<number>();
  for (let i = 1; i < raw.length; i += 1) {
    const d = parseInt(String((raw[i] || [])[col] ?? '').replace(/\D/g, ''), 10);
    if (d) dnis.add(d);
  }
  return { dnis, filas: Math.max(0, raw.length - 1) };
}

async function guardarFoto(sequelize: Sequelize, fecha: string, file: string, mtime: Date | null, control: number[]) {
  const { dnis, filas } = leerDnis(file);
  if (filas < MIN_FILAS_FOTO) {
    logger.warn({ msg: '[residentes-siape] foto descartada (pocas filas)', file, filas });
    return false;
  }
  const t = await sequelize.transaction();
  try {
    await sequelize.query(
      `REPLACE INTO residentes_siape_fotos (fecha, archivo, archivo_mtime, filas, procesado_en)
       VALUES (:fecha, :file, :mtime, :filas, NOW())`,
      { replacements: { fecha, file, mtime, filas }, transaction: t });
    if (control.length) {
      const values = control.map((d) => `(${sequelize.escape(fecha)}, ${Number(d)}, ${dnis.has(d) ? 1 : 0})`);
      await sequelize.query(
        `INSERT INTO residentes_siape_presencia (fecha, dni, en_siape) VALUES ${values.join(',')}
         ON DUPLICATE KEY UPDATE en_siape = VALUES(en_siape)`,
        { transaction: t });
    }
    await t.commit();
    return true;
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

async function sincronizarInterno(sequelize: Sequelize) {
  if (!XLSX) throw new Error('Modulo xlsx no disponible');
  await ensureTables(sequelize);
  const control = (await universo(sequelize)).map((r) => r.dni);
  const fotos = await sequelize.query<{ fecha: string }>(
    `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha FROM residentes_siape_fotos`, { type: QueryTypes.SELECT });
  const ya = new Set(fotos.map((f) => f.fecha));

  // 1) fotos mensuales del historial (solo las que faltan, último ~año)
  const histDir = path.join(dir(), 'HORARIOS_HISTORIAL');
  const desde = sumarDias(ymd(new Date()), -DIAS_HISTORIAL);
  if (fs.existsSync(histDir)) {
    for (const f of fs.readdirSync(histDir).sort()) {
      const m = f.match(/^HORARIOS_(\d{4}-\d{2}-\d{2})\.xlsx$/i);
      if (!m || m[1] < desde || ya.has(m[1])) continue;
      try {
        const full = path.join(histDir, f);
        await guardarFoto(sequelize, m[1], full, fs.statSync(full).mtime, control);
      } catch (e: any) {
        logger.warn({ msg: '[residentes-siape] error foto historial', file: f, error: e?.message });
      }
    }
  }

  // 2) la exportación diaria: siempre se re-procesa (barato) para incluir a los que
  //    entraron al control después y tomar la descarga más nueva del día.
  const diario = path.join(dir(), 'HORARIOS.xlsx');
  if (fs.existsSync(diario)) {
    const mtime = fs.statSync(diario).mtime;
    await guardarFoto(sequelize, ymd(mtime), diario, mtime, control);
  }
}

export async function sincronizarFotosSiape(sequelize: Sequelize, force = false) {
  if (!force && Date.now() - lastSync < THROTTLE_MS) return;
  if (!syncing) {
    syncing = sincronizarInterno(sequelize)
      .then(() => { lastSync = Date.now(); })
      .finally(() => { syncing = null; });
  }
  await syncing;
}

// ── control ───────────────────────────────────────────────────────────────────
export async function controlResidentesSiape(sequelize: Sequelize, opts: { force?: boolean } = {}) {
  let syncError: string | null = null;
  try {
    await sincronizarFotosSiape(sequelize, !!opts.force);
  } catch (e: any) {
    syncError = e?.message || 'Error leyendo HORARIOS.xlsx';
    logger.warn({ msg: '[residentes-siape] sync error', error: syncError });
    await ensureTables(sequelize);
  }

  const base = await universo(sequelize);
  const dnis = base.map((r) => r.dni);
  const srv = await servicios(sequelize, dnis);

  const fotos = await sequelize.query<{ fecha: string; archivo: string; filas: number; procesado_en: string }>(
    `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, archivo, filas,
            DATE_FORMAT(procesado_en, '%Y-%m-%d %H:%i') AS procesado_en
       FROM residentes_siape_fotos ORDER BY fecha`, { type: QueryTypes.SELECT });
  const ultima = fotos[fotos.length - 1] || null;

  const pres = dnis.length
    ? await sequelize.query<{ dni: number; fecha: string; en_siape: number }>(
      `SELECT dni, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, en_siape
         FROM residentes_siape_presencia WHERE dni IN (:dnis) ORDER BY fecha`,
      { type: QueryTypes.SELECT, replacements: { dnis } })
    : [];
  const presPorDni = new Map<number, Map<string, number>>();
  for (const p of pres) {
    const k = Number(p.dni);
    if (!presPorDni.has(k)) presPorDni.set(k, new Map());
    presPorDni.get(k)!.set(p.fecha, Number(p.en_siape));
  }

  // columnas para la grilla: fotos de día 1 de cada mes (últimos 13) + la última
  const mensuales = fotos.filter((f) => f.fecha.endsWith('-01')).map((f) => f.fecha).slice(-13);
  const columnas = Array.from(new Set([...mensuales, ...(ultima ? [ultima.fecha] : [])])).sort();

  const rows: ControlRow[] = base.map((r) => {
    const mp = presPorDni.get(r.dni) || new Map<string, number>();
    const fechas = Array.from(mp.keys()).sort();
    const enUltima = ultima ? mp.get(ultima.fecha) === 1 : false;
    const ultimaVez = fechas.filter((f) => mp.get(f) === 1).pop() || null;
    let estado: EstadoControl;
    let ausenteDesde: string | null = null;
    if (enUltima) estado = 'ACTIVO_SIAPE';
    else if (ultimaVez) {
      estado = 'BAJA_SIAPE';
      ausenteDesde = fechas.find((f) => f > ultimaVez && mp.get(f) === 0) || ultima?.fecha || null;
    } else estado = 'ALTA_PENDIENTE';
    return {
      ...r,
      servicio: srv.get(r.dni) || null,
      estado,
      ultima_vez_en_siape: ultimaVez,
      ausente_desde: ausenteDesde,
      presencia: columnas.map((c) => (mp.has(c) ? (mp.get(c) === 1 ? 1 : 0) : null)),
    };
  });

  const orden: Record<EstadoControl, number> = { BAJA_SIAPE: 0, ALTA_PENDIENTE: 1, ACTIVO_SIAPE: 2 };
  rows.sort((a, b) => orden[a.estado] - orden[b.estado]
    || a.apellido.localeCompare(b.apellido, 'es') || a.nombre.localeCompare(b.nombre, 'es'));

  return {
    foto: ultima,
    columnas,
    syncError,
    totals: {
      controlados: rows.length,
      residentes: rows.filter((r) => r.condicion === 'RESIDENTE').length,
      exResidentes: rows.filter((r) => r.condicion === 'EX_RESIDENTE').length,
      activos: rows.filter((r) => r.estado === 'ACTIVO_SIAPE').length,
      bajaSiape: rows.filter((r) => r.estado === 'BAJA_SIAPE').length,
      altaPendiente: rows.filter((r) => r.estado === 'ALTA_PENDIENTE').length,
    },
    rows,
  };
}
