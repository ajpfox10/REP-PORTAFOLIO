// src/routes/presentismoSector.routes.ts
// GET /api/v1/presentismo-sector?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&servicio_id=N (solo admin)][&refresh=1]
// GET /api/v1/presentismo-sector/prediccion?dias=14[&servicio_id=N (solo admin)][&refresh=1]
// GET /api/v1/presentismo-sector/minimos[?servicio_id=N (solo admin)]
// PUT /api/v1/presentismo-sector/minimos   { sector, turno, tipo_dia: 'habil'|'finde', minimo }   (minimo null/'' = borrar)
// GET /api/v1/presentismo-sector/distribucion-enfermeria?dep=HOSPITAL|UPA18|UPA4  (admin elige; jefe de enfermería ve la suya)
//
// Presentismo del servicio del jefe, día por día y por turno (página "Presentismo por turno" de Mi Sector).
// Por cada agente con pase abierto en el servicio y cada día en que HORARIOS.xlsx le marca turno (teórico):
//   · motivo de ausencia, con prioridad: Enfermedad > Acc. trabajo > Vacaciones > Anual compl. > Art. 26 >
//     Franco comp. > Inasistencia 28 > Otras. Fuentes: ministerio_novedades_anual, reconocimientos_medicos
//     (OTORGADA), francos_compensatorios y articulo_26 (cargados por los jefes, no ANULADO).
//   · si no tiene novedad: fichó (adms_db.checkinout, marcas dentro del turno; ver leerFichadas), "FER" si es feriado
//     o "SIN" (ni fichada ni novedad).
// Turno según la hora de entrada del día: 05–10:59 Mañana · 11–17:59 Tarde · resto Noche · 24 h si dura 24 h.
// Noche y 24 h cuentan en el día en que entran.
//
// Predicción (próximos días): por sector × turno × día,
//   presentes esperados = Σ (1 − p) sobre los teóricos que NO tienen ya una novedad cargada para ese día, con
//   p = tasa de ausencia NO planificada del agente (historial SIAPE de los últimos 24 meses: enfermedad, sin aviso,
//       causas particulares, familiar, accidente, duelo, paro…; suavizada hacia la tasa del servicio)
//       × factor del mes (historial del servicio desde 2020) × factor turno/día de semana (mismo historial).
//   "Normal" = promedio de presentes fichados en las últimas 12 semanas ese día de semana y turno.
//   Riesgo = P(presentes < mínimo) (distribución binomial de Poisson); el mínimo lo carga el jefe (dotacion_minima),
//   uno para días hábiles y otro para sábado, domingo y feriados.
//
// Rotación real: HORARIOS.xlsx suele declarar el horario "de planta" (ej. noche L–V 18–06) aunque el agente
//   trabaje noches rotativas (ej. una semana sí y otra no). Se detecta por agente con las últimas 8 semanas
//   (fichadas + PRESENTE / FRANCO COMPENSATORIO del historial SIAPE) en un ciclo de 14 días: los días del ciclo en
//   que casi nunca trabaja (≤ 25%) no se cuentan como teóricos ("ROT" en lo que pasó, "rotacion" en la predicción).
//
// El servicio sale del usuario logueado (usuarios.servicio_id); Sala (24) y Dpto. Enfermería (34) se ven juntos,
// igual que la tarjeta de enfermería de Mi Sector. Admin (crud:*:*) puede elegir cualquier servicio.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { armarTurnos } from '../services/ausentismoEval';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DOW_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const COLS: Record<string, [number, number]> = {
  lunes: [4, 5], martes: [6, 7], miercoles: [8, 9], jueves: [10, 11],
  viernes: [12, 13], sabado: [14, 15], domingo: [16, 17],
};
const SERVICIOS_ENFERMERIA = [24, 34];
// Servicios de enfermería por dependencia (página "Distribución de enfermería")
const ENFERMERIA_DEP: Record<string, { nombre: string; servicios: number[] }> = {
  HOSPITAL: { nombre: 'Hospital', servicios: [24, 34] },
  UPA18: { nombre: 'UPA 18', servicios: [38] },
  UPA4: { nombre: 'UPA 4', servicios: [51] },
};
// Categoría de la ocupación (Dotación por categoría de Mi Sector). ocupaciones.agrupamiento está vacío y los nombres
// vienen escritos de mil formas, así que se clasifica por patrón; el orden importa (Residente antes que Enfermería, etc.).
const CATEGORIAS: { key: string; re: RegExp }[] = [
  { key: 'RESIDENTES', re: /RESIDENTE|CONCURRENTE/ },
  { key: 'ENFERMERIA', re: /ENFERM|^ENF\.?\s/ },
  { key: 'MEDICOS', re: /MEDIC|^MD\.|ODONTOLOG/ },
  { key: 'TECNICOS', re: /TECNIC|^TEC\.|INSTRUMENTADOR|AUXILIAR DE (RADIOLOG|FARMACIA|HEMOTERAPIA|ELECTRO|ANESTES)|AUXILIAR FARMACIA|AYUDANTE DE (HEMOTERAPIA|ESTERILIZACION)|PREPARADOR/ },
  { key: 'PROFESIONALES', re: /LICENCIAD|^LIC\.|BIOQUIMIC|FARMACEUT|PSICOLOG|FONOAUDIOLOG|ABOGAD|ARQUITECT|INGENIER|NUTRICION/ },
  { key: 'ADMINISTRATIVOS', re: /ADMINISTRATIV|CONMUTADOR/ },
  { key: 'SERVICIOS', re: /MUCAM|GUARDIAN|CAMILLER|OPERARIO|CHOFER|MANTENIMIENTO|ELECTRICISTA|CARNICER|CAPELLAN/ },
];
function categoriaOcupacion(ocupacion: string): string {
  const s = ocupacion.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return CATEGORIAS.find(c => c.re.test(s))?.key ?? 'OTROS';
}
const MAX_DIAS = 62;
const MAX_DIAS_PRED = 31;
const TURNOS = ['Mañana', 'Tarde', 'Vespertino', 'Noche', '24 h'];
const TIPOS_DIA = ['habil', 'finde'];

// Categorías de ausencia, en orden de prioridad cuando se superponen
const PRIORIDAD = ['ENF', 'ART', 'VAC', 'COMP', 'A26', 'FC', 'INA', 'OTR'] as const;
type Cat = typeof PRIORIDAD[number];
const CAT_CODIGO: Record<string, Cat> = {
  '01': 'ENF', E: 'ENF', '04': 'ART', '08': 'VAC', '29': 'COMP', '291': 'COMP',
  '261': 'A26', '34': 'FC', '28': 'INA',
};

// Novedades del historial SIAPE para el modelo de predicción
const HIST_PRESENTE = ['PRESENTE', 'LLEGO TARDE', 'BOLETA DE SALIDA', 'BOLETA DE SALIDA - OFICIAL', 'PRESENTE CON RETENCION DE TAREAS'];
const HIST_NO_PLANIFICADA = [
  'AUSENTE SIN AVISO', 'ENFERMEDAD', 'CAUSAS PARTICULARES', 'ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE',
  'ACCIDENTE DE TRABAJO', 'DUELO DIRECTO', 'DUELO INDIRECTO', 'DUELO DIRECTO a mas de 200 Km',
  'DUELO INDIRECTO a mas de 200 Km', 'PARO', 'PARO TRANSPORTE', 'AGENTE CON PATOLOGIAS CRONICAS',
  'PERDIDA DE GESTACION', 'PARA MUJERES VICTIMAS DE VIOLENCIA', 'DESINFECCION',
];
const SUAVIZADO_K = 40;     // días "prestados" de la tasa del servicio al agente con poca historia
const P_MAX = 0.9;

function normHora(v: any): string | null {
  if (v == null) return null;
  const s = String((typeof v === 'object' && v.text) ? v.text : v).trim();
  if (!s || s === '-') return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : null;
}
const normDni = (v: any) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const enMin = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const esFecha = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const hoyIso = () => {
  const d = new Date(Date.now() - 3 * 3600_000); // hora argentina
  return d.toISOString().slice(0, 10);
};
function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dowDe = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
function turnoDe(entrada: string, horas: number): string {
  if (horas >= 24) return '24 h';
  const m = enMin(entrada);
  if (m >= 300 && m < 660) return 'Mañana';
  if (m >= 660 && m < 1080) return 'Tarde';
  // 26/10: 18–00 es Vespertino y 00–06 Noche (en Neo se sumaban las dos mitades como "Noche");
  // la guardia larga que entra a la tarde-noche (18–06) sigue siendo Noche
  if (m >= 1080 && horas <= 8) return 'Vespertino';
  return 'Noche';
}
// El de 12 h de día (06–18) cubre la mañana y la tarde: cuenta como teórico en las dos
// (26/10: el sábado de Clínica Médica la Tarde quedaba vacía con 7 agentes de 06 a 18).
function turnosDe(t: TurnoDia): string[] {
  const turno = turnoDe(t.entrada, t.horas);
  const sal = enMin(t.salida);
  if (turno === 'Mañana' && t.horas >= 10 && sal > enMin(t.entrada) && sal >= 17 * 60) return ['Mañana', 'Tarde'];
  return [turno];
}

// ── HORARIOS.xlsx (cacheado por mtime) ───────────────────────────────────────
interface TurnoDia { entrada: string; salida: string; horas: number }
let cacheHor: { file: string; mtime: number; map: Map<string, Record<string, TurnoDia>> } | null = null;
function leerHorarios(): { map: Map<string, Record<string, TurnoDia>>; error: string | null; mtime: number } {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!XLSX) return { map: new Map(), error: 'Módulo xlsx no disponible en el servidor', mtime: 0 };
  if (!dir || !fs.existsSync(dir)) return { map: new Map(), error: 'EXCEL_ASISTENCIA_DIR no configurado o inexistente', mtime: 0 };
  const file = fs.readdirSync(dir).find((f: string) => /\.xls[xm]?$/i.test(f) && f.toLowerCase().includes('horario'));
  if (!file) return { map: new Map(), error: 'No se encontró el Excel de horarios', mtime: 0 };
  const fp = path.join(dir, file);
  const mtime = fs.statSync(fp).mtimeMs;
  if (cacheHor && cacheHor.file === fp && cacheHor.mtime === mtime) return { map: cacheHor.map, error: null, mtime };

  const wb = XLSX.readFile(fp);
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const map = new Map<string, Record<string, TurnoDia>>();
  for (const r of rows.slice(1)) {
    const dni = normDni(r[3]);
    if (!dni) continue;
    const raw: Record<string, { e: string | null; s: string | null }> = {};
    for (const d of DIAS) raw[d] = { e: normHora(r[COLS[d][0]]), s: normHora(r[COLS[d][1]]) };
    const porDia: Record<string, TurnoDia> = {};
    for (const t of armarTurnos(raw)) porDia[t.dia] = { entrada: t.entrada, salida: t.salida, horas: t.horas };
    map.set(dni, porDia);
  }
  cacheHor = { file: fp, mtime, map };
  return { map, error: null, mtime };
}

// ── fichadas (adms_db) ───────────────────────────────────────────────────────
// Las marcas se asocian al TURNO, no al día calendario: el de noche ficha la entrada a la noche y la salida a la
// mañana siguiente, así que la salida de las 06:00 del martes es del turno del lunes y no prueba que haya ido el martes.
//   · turno que no cruza la medianoche: alguna marca del día entre entrada − 3 h y salida + 3 h
//   · turno que cruza (noche, 24 h): marca del día desde entrada − 3 h, o marca del día siguiente hasta salida + 3 h
const TOLERANCIA_MIN = 180;
interface Fichadas {
  turno: (dni: string, f: string, t: TurnoDia) => { primera: string; ultima: string } | null;
  diasConMarcas: (dni: string) => number;
}
async function leerFichadas(dnis: string[], desde: string, hasta: string): Promise<{ map: Fichadas; error: string | null }> {
  const marcas = new Map<string, number[]>();   // dni|fecha → minutos del día, ordenados
  const dias = new Map<string, number>();
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const map: Fichadas = {
    turno: (dni, f, t) => {
      const ent = enMin(t.entrada), sal = enMin(t.salida);
      const cruza = t.horas >= 24 || sal <= ent;
      const hoy = marcas.get(`${dni}|${f}`) || [];
      if (!cruza) {
        const ok = hoy.filter(m => m >= ent - TOLERANCIA_MIN && m <= sal + TOLERANCIA_MIN);
        return ok.length ? { primera: fmt(ok[0]), ultima: fmt(ok[ok.length - 1]) } : null;
      }
      const entrada = hoy.filter(m => m >= ent - TOLERANCIA_MIN);
      const salida = (marcas.get(`${dni}|${sumarDias(f, 1)}`) || []).filter(m => m <= sal + TOLERANCIA_MIN);
      if (!entrada.length && !salida.length) return null;
      return {
        primera: entrada.length ? fmt(entrada[0]) : `— (salió ${fmt(salida[0])})`,
        ultima: salida.length ? `${fmt(salida[salida.length - 1])} del día siguiente` : fmt(entrada[entrada.length - 1]),
      };
    },
    diasConMarcas: dni => dias.get(dni) || 0,
  };
  if (!dnis.length) return { map, error: null };
  const cfgPath = path.resolve(process.cwd(), 'fichero_config.json');
  if (!fs.existsSync(cfgPath)) return { map, error: 'No se encontró fichero_config.json (base biométrica)' };
  let conn: mysql.Connection | null = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    conn = await mysql.createConnection({
      host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
      user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '',
      database: cfg.mysqlDb || 'adms_db', connectTimeout: 10_000, dateStrings: true,
    });
    const ph = dnis.map(() => '?').join(',');
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ui.badgenumber AS dni, DATE_FORMAT(ci.checktime, '%Y-%m-%d %H:%i') AS t
         FROM checkinout ci
         INNER JOIN userinfo ui ON ci.userid = ui.userid
        WHERE ui.badgenumber IN (${ph})
          AND ci.checktime >= ? AND ci.checktime < ?`,
      [...dnis, `${desde} 00:00:00`, `${sumarDias(hasta, 2)} 00:00:00`],   // +1 día: salidas del turno noche
    );
    for (const r of rows) {
      const dni = normDni(r.dni);
      const t = String(r.t);
      const k = `${dni}|${t.slice(0, 10)}`;
      if (!marcas.has(k)) { marcas.set(k, []); if (t.slice(0, 10) <= hasta) dias.set(dni, (dias.get(dni) || 0) + 1); }
      marcas.get(k)!.push(enMin(t.slice(11, 16)));
    }
    for (const v of marcas.values()) v.sort((a, b) => a - b);
    return { map, error: null };
  } catch (e: any) {
    logger.warn({ msg: 'presentismo-sector: error leyendo fichadas', error: e?.message });
    return { map, error: 'No se pudo leer la base biométrica' };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

// ── tabla de mínimos por sector × turno ──────────────────────────────────────
const tablaMinimosLista = new WeakSet<Sequelize>();
async function ensureMinimosTable(sequelize: Sequelize) {
  if (tablaMinimosLista.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS dotacion_minima (
      id INT NOT NULL AUTO_INCREMENT,
      servicio_id INT NOT NULL,
      sector VARCHAR(150) NOT NULL,
      turno VARCHAR(10) NOT NULL,
      tipo_dia VARCHAR(6) NOT NULL DEFAULT 'habil',
      minimo INT NOT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_dotacion_minima (servicio_id, sector, turno, tipo_dia)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  tablaMinimosLista.add(sequelize);
}

// ── contexto: servicio del usuario + padrón ──────────────────────────────────
interface Agente { dni: string; nombre: string; sector: string; ocupacion: string }
interface Contexto {
  servicioId: number; servicioIds: number[]; servicioNombre: string;
  agentes: Map<string, Agente>; dnis: string[];
}
async function contexto(sequelize: Sequelize, req: Request): Promise<{ ctx?: Contexto; status?: number; error?: string }> {
  const auth = (req as any).auth ?? {};
  const perms: string[] = auth.permissions ?? [];
  const esAdmin = perms.includes('crud:*:*');

  let servicioId: number | null = null;
  if (esAdmin && req.query.servicio_id) servicioId = Number(req.query.servicio_id) || null;
  if (servicioId == null && auth.principalType === 'user' && auth.principalId) {
    const [u] = await sequelize.query<any>(
      `SELECT servicio_id FROM usuarios WHERE id = ? AND deleted_at IS NULL`,
      { replacements: [auth.principalId], type: QueryTypes.SELECT },
    );
    servicioId = u?.servicio_id != null ? Number(u.servicio_id) : null;
  }
  if (servicioId == null && esAdmin) servicioId = 24;
  if (servicioId == null) return { status: 403, error: 'Tu usuario no tiene un servicio asignado' };

  const servicioIds = SERVICIOS_ENFERMERIA.includes(servicioId) ? SERVICIOS_ENFERMERIA : [servicioId];
  const servRows = await sequelize.query<any>(
    `SELECT id, nombre FROM servicios WHERE id IN (?)`,
    { replacements: [servicioIds], type: QueryTypes.SELECT },
  );
  const servicioNombre = servRows.map((s: any) => s.nombre).join(' + ');

  // Padrón: igual que Mi Sector (pase abierto en el servicio, agente activo, sector abierto en ese servicio)
  const padron = await sequelize.query<any>(
    `SELECT ags.dni, p.apellido, p.nombre, COALESCE(se.nombre, '(SIN SECTOR)') AS sector, o.nombre AS ocupacion
       FROM agentes_servicios ags
       JOIN (SELECT DISTINCT dni FROM agentes WHERE estado_empleo = 'ACTIVO') a ON a.dni = ags.dni
       JOIN personal p ON p.dni = ags.dni
       LEFT JOIN agentes_sectores x ON x.dni = ags.dni AND x.servicio_id = ags.servicio_id
                                   AND x.fecha_hasta IS NULL AND x.deleted_at IS NULL
       LEFT JOIN sectores se ON se.id = x.sector_id
       LEFT JOIN (SELECT dni, MAX(ocupacion_id) AS ocupacion_id FROM agentes
                   WHERE estado_empleo = 'ACTIVO' GROUP BY dni) ao ON ao.dni = ags.dni
       LEFT JOIN ocupaciones o ON o.id = ao.ocupacion_id
      WHERE ags.servicio_id IN (?) AND ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL`,
    { replacements: [servicioIds], type: QueryTypes.SELECT },
  );
  const agentes = new Map<string, Agente>();
  for (const r of padron) {
    const dni = normDni(r.dni);
    if (!agentes.has(dni)) agentes.set(dni, {
      dni, nombre: [r.apellido, r.nombre].filter(Boolean).join(', '),
      sector: r.sector, ocupacion: (r.ocupacion || '').trim(),
    });
  }
  return { ctx: { servicioId, servicioIds, servicioNombre, agentes, dnis: [...agentes.keys()] } };
}

// Novedad del historial SIAPE → columna. null = no es ausencia (vino igual: presente, llegó tarde, boleta de salida).
function catSiape(novedad: string): Cat | null {
  const n = novedad.trim().toUpperCase();
  if (!n || n === 'PRESENTE' || n === 'LLEGO TARDE' || n.startsWith('BOLETA DE SALIDA')) return null;
  if (n.startsWith('ENFERMEDAD')) return 'ENF';
  if (n.startsWith('ACCIDENTE DE TRABAJO')) return 'ART';
  if (n.startsWith('ANUAL COMPLEMENTARIA')) return 'COMP';
  if (n === 'ANUAL') return 'VAC';
  if (n.startsWith('FRANCO COMPENSATORIO')) return 'FC';
  if (n === 'AUSENTE SIN AVISO') return 'INA';
  return 'OTR';
}

// ── novedades cargadas (Ministerio, Salud Laboral, francos, Art. 26, historial SIAPE) ─
interface Novedad { dni: string; desde: string; hasta: string; cat: Cat; detalle: string }
async function leerNovedades(sequelize: Sequelize, dnis: string[], desde: string, hasta: string, conSiape = true) {
  const nov: Novedad[] = [];
  let ministerioAl: string | null = null;
  if (dnis.length) {
    const q = (sql: string) => sequelize.query<any>(sql, { replacements: [dnis, hasta, desde], type: QueryTypes.SELECT });
    const min = await q(
      `SELECT dni, codigo, novedad, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(fecha_hasta,'%Y-%m-%d') h
         FROM ministerio_novedades_anual WHERE dni IN (?) AND fecha_desde <= ? AND fecha_hasta >= ?`);
    for (const r of min) nov.push({ dni: normDni(r.dni), desde: r.d, hasta: r.h, cat: CAT_CODIGO[String(r.codigo).trim()] ?? 'OTR', detalle: String(r.novedad || r.codigo).trim() });
    const rm = await q(
      `SELECT dni, tipo, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(fecha_hasta,'%Y-%m-%d') h
         FROM reconocimientos_medicos WHERE deleted_at IS NULL AND resultado = 'OTORGADA'
          AND dni IN (?) AND fecha_desde <= ? AND fecha_hasta >= ?`);
    for (const r of rm) nov.push({ dni: normDni(r.dni), desde: r.d, hasta: r.h, cat: 'ENF', detalle: `Salud Laboral ${r.tipo || ''}`.trim() });
    const fc = await q(
      `SELECT dni, estado, DATE_FORMAT(fecha_franco,'%Y-%m-%d') d FROM francos_compensatorios
        WHERE deleted_at IS NULL AND dni IN (?) AND fecha_franco <= ? AND fecha_franco >= ?`);
    for (const r of fc) nov.push({ dni: normDni(r.dni), desde: r.d, hasta: r.d, cat: 'FC', detalle: `Franco compensatorio (${String(r.estado || '').toLowerCase()})` });
    const a26 = await q(
      `SELECT dni, estado, DATE_FORMAT(fecha,'%Y-%m-%d') d,
              DATE_FORMAT(DATE_ADD(fecha, INTERVAL GREATEST(COALESCE(dias,1),1) - 1 DAY),'%Y-%m-%d') h
         FROM articulo_26 WHERE deleted_at IS NULL AND COALESCE(estado,'') <> 'ANULADO'
          AND dni IN (?) AND fecha <= ? AND DATE_ADD(fecha, INTERVAL GREATEST(COALESCE(dias,1),1) - 1 DAY) >= ?`);
    for (const r of a26) nov.push({ dni: normDni(r.dni), desde: r.d, hasta: r.h, cat: 'A26', detalle: `Art. 26 cargado por el jefe (${String(r.estado || '').toLowerCase()})` });
    // Historial SIAPE: tiene lo que no llega al Ministerio (becarios fuera del plantel, cargas que el robot no pudo pasar)
    const hs = !conSiape ? [] : await q(
      `SELECT dni, novedad, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(fecha_hasta,'%Y-%m-%d') h
         FROM historial WHERE dni IN (?) AND fecha_desde <= ? AND fecha_hasta >= ?`);
    for (const r of hs) {
      const cat = catSiape(String(r.novedad || ''));
      if (cat) nov.push({ dni: normDni(r.dni), desde: r.d, hasta: r.h, cat, detalle: `SIAPE: ${String(r.novedad).trim()}` });
    }
    const [m] = await sequelize.query<any>(
      `SELECT DATE_FORMAT(MAX(descargado_en),'%Y-%m-%d %H:%i') AS al FROM ministerio_novedades_anual`, { type: QueryTypes.SELECT });
    ministerioAl = m?.al ?? null;
  }
  const porDni = new Map<string, Novedad[]>();
  for (const n of nov) { if (!porDni.has(n.dni)) porDni.set(n.dni, []); porDni.get(n.dni)!.push(n); }
  const vigente = (dni: string, f: string) => {
    const vs = (porDni.get(dni) || []).filter(n => n.desde <= f && n.hasta >= f);
    const cat = PRIORIDAD.find(c => vs.some(n => n.cat === c));
    return cat ? vs.find(n => n.cat === cat)! : null;
  };
  return { vigente, ministerioAl };
}

// Presentes en SIAPE (para separar "presente sin fichar") y hasta qué día llega la última descarga del historial.
// La descarga trae PRESENTE de los días ya procesados; el último día "cubierto" es el último con un volumen razonable
// de presentes (≥ 25 % del máximo diario de los últimos 30 días), porque el día de la descarga viene casi vacío.
async function leerSiapePresentes(sequelize: Sequelize, dnis: string[], desde: string, hasta: string) {
  const presente = new Set<string>();
  if (dnis.length) {
    const rs = await sequelize.query<any>(
      `SELECT dni, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(fecha_hasta,'%Y-%m-%d') h
         FROM historial WHERE dni IN (?) AND novedad IN (?) AND fecha_desde <= ? AND fecha_hasta >= ?`,
      { replacements: [dnis, HIST_PRESENTE, hasta, desde], type: QueryTypes.SELECT });
    for (const r of rs) for (let f = r.d; f <= r.h; f = sumarDias(f, 1)) presente.add(`${normDni(r.dni)}|${f}`);
  }
  const cob = await sequelize.query<any>(
    `SELECT DATE_FORMAT(fecha_desde,'%Y-%m-%d') f, COUNT(*) n FROM historial
      WHERE novedad = 'PRESENTE' AND fecha_desde >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND fecha_desde <= CURDATE()
      GROUP BY f ORDER BY f`, { type: QueryTypes.SELECT });
  const max = Math.max(0, ...cob.map((x: any) => Number(x.n)));
  const cubreHasta: string | null = [...cob].reverse().find((x: any) => Number(x.n) >= max * 0.25)?.f ?? null;
  return { presente, cubreHasta };
}

async function leerFeriados(sequelize: Sequelize, desde: string, hasta: string) {
  return sequelize.query<any>(
    `SELECT DATE_FORMAT(fecha,'%Y-%m-%d') AS fecha, nombre FROM feriados WHERE fecha BETWEEN ? AND ?`,
    { replacements: [desde, hasta], type: QueryTypes.SELECT },
  );
}

// ── modelo de ausencia no planificada (historial SIAPE) ──────────────────────
interface Modelo {
  pAgente: Map<string, { p: number; dias: number }>;
  pServicio: number;
  factorMes: number[];                 // 1..12
  factorTurnoDia: Record<string, number>; // `${turno}|${dow}`
  histDesde: string; histHasta: string;
}
const cacheModelo = new Map<string, { ts: number; modelo: Modelo }>();
const MODELO_TTL = 6 * 3600_000;

async function construirModelo(sequelize: Sequelize, clave: string, dnis: string[],
  horarios: Map<string, Record<string, TurnoDia>>): Promise<Modelo> {
  const c = cacheModelo.get(clave);
  if (c && Date.now() - c.ts < MODELO_TTL) return c.modelo;

  const [lim] = await sequelize.query<any>(
    `SELECT DATE_FORMAT(MAX(fecha_desde),'%Y-%m-%d') AS hasta FROM historial WHERE novedad = 'PRESENTE' AND dni IN (?)`,
    { replacements: [dnis], type: QueryTypes.SELECT },
  );
  const histHasta: string = lim?.hasta || sumarDias(hoyIso(), -1);
  const histDesde = sumarDias(histHasta, -730);
  const novedades = [...HIST_PRESENTE, ...HIST_NO_PLANIFICADA];
  const presentes = new Set(HIST_PRESENTE);

  // Proporción de días de la semana que trabaja cada agente (para pasar licencias de varios días a días laborables)
  const share = (dni: string) => {
    const n = Object.keys(horarios.get(dni) || {}).length;
    return n ? n / 7 : 5 / 7;
  };
  const turnoDelDia = (dni: string, f: string) => {
    const t = horarios.get(dni)?.[DOW_KEYS[dowDe(f)]];
    return t ? turnoDe(t.entrada, t.horas) : null;
  };

  // 1) Por agente, últimos 24 meses
  const filas = await sequelize.query<any>(
    `SELECT dni, novedad, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(fecha_hasta,'%Y-%m-%d') h
       FROM historial
      WHERE dni IN (?) AND novedad IN (?) AND fecha_desde BETWEEN ? AND ?`,
    { replacements: [dnis, novedades, histDesde, histHasta], type: QueryTypes.SELECT },
  );
  const cnt = new Map<string, { pres: number; aus: number }>();
  const td: Record<string, { pres: number; aus: number }> = {};
  for (const r of filas) {
    const dni = normDni(r.dni);
    if (!cnt.has(dni)) cnt.set(dni, { pres: 0, aus: 0 });
    const o = cnt.get(dni)!;
    const unDia = r.d === r.h;
    const dias = unDia ? 1 : Math.max(1, ((Date.parse(r.h) - Date.parse(r.d)) / 86400000 + 1) * share(dni));
    const esPres = presentes.has(r.novedad);
    if (esPres) o.pres += dias; else o.aus += dias;
    // Patrón turno × día de semana: solo registros de un día, en días que el agente trabaja hoy
    if (unDia) {
      const t = turnoDelDia(dni, r.d);
      if (t) {
        const k = `${t}|${dowDe(r.d)}`;
        td[k] ??= { pres: 0, aus: 0 };
        if (esPres) td[k].pres++; else td[k].aus++;
      }
    }
  }
  let sp = 0, sa = 0;
  for (const o of cnt.values()) { sp += o.pres; sa += o.aus; }
  const pServicio = sp + sa > 0 ? sa / (sp + sa) : 0.08;
  const pAgente = new Map<string, { p: number; dias: number }>();
  for (const dni of dnis) {
    const o = cnt.get(dni) || { pres: 0, aus: 0 };
    const den = o.pres + o.aus;
    pAgente.set(dni, { p: (o.aus + SUAVIZADO_K * pServicio) / (den + SUAVIZADO_K), dias: Math.round(den) });
  }

  // 2) Factor turno × día de semana (relativo a la tasa del turno)
  const factorTurnoDia: Record<string, number> = {};
  for (const t of TURNOS) {
    let tp = 0, ta = 0;
    for (let w = 0; w < 7; w++) { const o = td[`${t}|${w}`]; if (o) { tp += o.pres; ta += o.aus; } }
    const base = tp + ta > 0 ? ta / (tp + ta) : 0;
    for (let w = 0; w < 7; w++) {
      const o = td[`${t}|${w}`];
      factorTurnoDia[`${t}|${w}`] = (o && base > 0 && o.pres + o.aus >= 150)
        ? clamp((o.aus / (o.pres + o.aus)) / base, 0.5, 2.5) : 1;
    }
  }

  // 3) Estacionalidad por mes: historial del servicio desde 2020
  const meses = await sequelize.query<any>(
    `SELECT MONTH(fecha_desde) AS m,
            SUM(CASE WHEN novedad IN (?) THEN 1 ELSE 0 END) AS pres,
            SUM(CASE WHEN novedad IN (?) THEN DATEDIFF(fecha_hasta, fecha_desde) * 5 / 7 + 1 ELSE 0 END) AS aus
       FROM historial
      WHERE dni IN (?) AND novedad IN (?) AND fecha_desde BETWEEN '2020-01-01' AND ?
      GROUP BY MONTH(fecha_desde)`,
    { replacements: [HIST_PRESENTE, HIST_NO_PLANIFICADA, dnis, novedades, histHasta], type: QueryTypes.SELECT },
  );
  let mp = 0, ma = 0;
  for (const r of meses) { mp += Number(r.pres); ma += Number(r.aus); }
  const baseMes = mp + ma > 0 ? ma / (mp + ma) : 0;
  const factorMes = Array(13).fill(1);
  for (const r of meses) {
    const p = Number(r.pres), a = Number(r.aus);
    if (baseMes > 0 && p + a >= 300) factorMes[Number(r.m)] = clamp((a / (p + a)) / baseMes, 0.5, 2);
  }

  const modelo: Modelo = { pAgente, pServicio, factorMes, factorTurnoDia, histDesde, histHasta };
  cacheModelo.set(clave, { ts: Date.now(), modelo });
  return modelo;
}

// ── rotación real por agente (ciclo de 14 días) ─────────────────────────────
const CICLO = 14;
const VENTANA_ROT = 56;
const posCiclo = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 86400000) % CICLO;
interface Rotacion {
  leToca: (dni: string, f: string) => boolean;
  desde: string; hasta: string;
  porAgente: Map<string, { trabaja: number; franco: number; posFranco: number[] }>;
  /** Turno de sábado/domingo que HORARIOS no tiene pero el agente ficha seguido (por posición del ciclo). */
  extra: (dni: string, f: string) => TurnoDia | null;
  finde: { dni: string; dia: string; entrada: string; salida: string; veces: number }[];
}
// Fin de semana fuera de HORARIOS: se toma si en las últimas 8 semanas fichó al menos 2 veces y la mitad
// de las veces en esa posición del ciclo de 14 días (sábados por medio = una de las dos posiciones).
const FINDE_MIN_VECES = 2;
const FINDE_MIN_PROP = 0.5;
const SONDA_DIA: TurnoDia = { entrada: '07:00', salida: '17:00', horas: 10 };   // marcas de 04:00 a 20:00
const aHora = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:00`;
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const cacheRot = new Map<string, { ts: number; rot: Rotacion }>();
async function detectarRotacion(sequelize: Sequelize, clave: string, dnis: string[],
  horarios: Map<string, Record<string, TurnoDia>>, fin: string): Promise<Rotacion> {
  const k = `${clave}|${fin}`;
  const c = cacheRot.get(k);
  if (c && Date.now() - c.ts < 30 * 60_000) return c.rot;

  const desde = sumarDias(fin, -(VENTANA_ROT - 1));
  const { map: fich } = await leerFichadas(dnis, desde, fin);
  // Sin historial SIAPE: sus FRANCO COMPENSATORIO son justamente la evidencia de la rotación (se leen abajo)
  const { vigente } = await leerNovedades(sequelize, dnis, desde, fin, false);
  const fer = new Set((await leerFeriados(sequelize, desde, fin)).map((x: any) => x.fecha));
  const hist = dnis.length ? await sequelize.query<any>(
    `SELECT dni, novedad, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d FROM historial
      WHERE dni IN (?) AND fecha_desde BETWEEN ? AND ? AND fecha_desde = fecha_hasta
        AND (novedad IN (?) OR novedad LIKE 'FRANCO%')`,
    { replacements: [dnis, desde, fin, HIST_PRESENTE], type: QueryTypes.SELECT },
  ) : [];
  const histDia = new Map<string, 'P' | 'F'>();
  for (const r of hist) histDia.set(`${normDni(r.dni)}|${r.d}`, String(r.novedad).startsWith('FRANCO') ? 'F' : 'P');

  const porAgente = new Map<string, { trabaja: number; franco: number; posFranco: number[] }>();
  const francoPos = new Map<string, Set<number>>();
  for (const dni of dnis) {
    const h = horarios.get(dni);
    if (!h) continue;
    const pos: { w: number; o: number }[] = Array.from({ length: CICLO }, () => ({ w: 0, o: 0 }));
    let tw = 0, to = 0;
    for (let f = desde; f <= fin; f = sumarDias(f, 1)) {
      const td = h[DOW_KEYS[dowDe(f)]];
      if (!td || fer.has(f) || vigente(dni, f)) continue;
      const fichoDia = !!fich.turno(dni, f, td);
      const hd = histDia.get(`${dni}|${f}`);
      const trabajo = fichoDia || hd === 'P';
      const p = pos[posCiclo(f)];
      if (trabajo) { p.w++; tw++; } else { p.o++; to++; }
    }
    if (fich.diasConMarcas(dni) < 4 || tw + to === 0) continue; // no ficha (o no hay datos): se respeta HORARIOS
    const francos = new Set<number>();
    pos.forEach((p, i) => { const n = p.w + p.o; if (n >= 2 && p.w / n <= 0.25) francos.add(i); });
    if (francos.size >= 2 && to / (tw + to) >= 0.25) {
      francoPos.set(dni, francos);
      porAgente.set(dni, { trabaja: tw, franco: to, posFranco: [...francos] });
    }
  }
  // Sábados/domingos que HORARIOS no tiene pero el agente ficha seguido (de día)
  const extras = new Map<string, Map<number, TurnoDia>>();
  const finde: Rotacion['finde'] = [];
  for (const dni of dnis) {
    const h = horarios.get(dni);
    for (const w of [6, 0]) {
      if (h?.[DOW_KEYS[w]]) continue;
      const porPos = new Map<number, { n: number; ent: number[]; sal: number[] }>();
      for (let f = desde; f <= fin; f = sumarDias(f, 1)) {
        if (dowDe(f) !== w) continue;
        const p = posCiclo(f);
        if (!porPos.has(p)) porPos.set(p, { n: 0, ent: [], sal: [] });
        const o = porPos.get(p)!;
        o.n++;
        const m = fich.turno(dni, f, SONDA_DIA);
        if (m) { o.ent.push(enMin(m.primera)); o.sal.push(enMin(m.ultima)); }
      }
      for (const [p, o] of porPos) {
        if (o.ent.length < FINDE_MIN_VECES || o.ent.length / o.n < FINDE_MIN_PROP) continue;
        const e = Math.round(mediana(o.ent) / 60) * 60;
        let s = Math.round(mediana(o.sal) / 60) * 60;
        if (s - e < 4 * 60) s = e + 6 * 60;               // fichó solo la entrada: turno de 6 h
        const t: TurnoDia = { entrada: aHora(e), salida: aHora(s), horas: (s - e) / 60 };
        if (!extras.has(dni)) extras.set(dni, new Map());
        extras.get(dni)!.set(p, t);
        finde.push({ dni, dia: w === 6 ? 'Sábado' : 'Domingo', entrada: t.entrada, salida: t.salida, veces: o.ent.length });
      }
    }
  }

  const rot: Rotacion = {
    leToca: (dni, f) => !francoPos.get(dni)?.has(posCiclo(f)),
    desde, hasta: fin, porAgente,
    extra: (dni, f) => extras.get(dni)?.get(posCiclo(f)) ?? null,
    finde,
  };
  cacheRot.set(k, { ts: Date.now(), rot });
  return rot;
}

/** P(X < k) para X = suma de Bernoulli(q_i) (binomial de Poisson). */
function probMenorQue(qs: number[], k: number): number {
  if (k <= 0) return 0;
  let dist = [1];
  for (const q of qs) {
    const nd = Array(dist.length + 1).fill(0);
    for (let i = 0; i < dist.length; i++) { nd[i] += dist[i] * (1 - q); nd[i + 1] += dist[i] * q; }
    dist = nd;
  }
  let s = 0;
  for (let i = 0; i < Math.min(k, dist.length); i++) s += dist[i];
  return clamp(s, 0, 1);
}

function resumenRotacion(rot: Rotacion) {
  return {
    desde: rot.desde, hasta: rot.hasta,
    agentes: [...rot.porAgente.entries()].map(([dni, x]) => ({ dni, ...x })),
    finde: rot.finde,
  };
}

export function buildPresentismoSectorRouter(sequelize: Sequelize) {
  const router = Router();

  ensureMinimosTable(sequelize).catch((e: any) => {
    logger.error({ msg: 'dotacion_minima: error creando tabla', error: e?.message });
  });

  // ── Lo que pasó: día por día ───────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const hoy = hoyIso();
      const hasta = esFecha(req.query.hasta) ? String(req.query.hasta) : sumarDias(hoy, -1);
      const desde = esFecha(req.query.desde) ? String(req.query.desde) : sumarDias(hasta, -14);
      if (desde > hasta) return res.status(400).json({ ok: false, error: 'La fecha desde es posterior a la fecha hasta' });
      const dias: string[] = [];
      for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f);
      if (dias.length > MAX_DIAS) return res.status(400).json({ ok: false, error: `El rango máximo es de ${MAX_DIAS} días` });
      if (req.query.refresh) { cacheHor = null; cacheRot.clear(); }

      const { ctx, status, error } = await contexto(sequelize, req);
      if (!ctx) return res.status(status!).json({ ok: false, error });
      const { agentes, dnis } = ctx;

      const { map: horarios, error: errHor, mtime } = leerHorarios();
      if (errHor) return res.status(503).json({ ok: false, error: errHor });
      const rot = await detectarRotacion(sequelize, `${ctx.servicioIds.join(',')}|${mtime}`, dnis, horarios, hasta);

      const { vigente, ministerioAl } = await leerNovedades(sequelize, dnis, desde, hasta);
      const { map: fichadas, error: errFich } = await leerFichadas(dnis, desde, hasta);
      const feriados = await leerFeriados(sequelize, desde, hasta);
      const esFeriado = new Set(feriados.map((x: any) => x.fecha));
      const siape = await leerSiapePresentes(sequelize, dnis, desde, hasta);

      // Un registro por agente × día con turno teórico
      const registros: any[] = [];
      for (const f of dias) {
        const dow = DOW_KEYS[dowDe(f)];
        for (const dni of dnis) {
          const deHorario = horarios.get(dni)?.[dow];
          const t = deHorario ?? rot.extra(dni, f);
          if (!t) continue;
          const nv = vigente(dni, f);
          const fich = fichadas.turno(dni, f, t);
          for (const turno of turnosDe(t)) registros.push({
            fecha: f, dni, turno, horario: `${t.entrada}–${t.salida}${deHorario ? '' : ' (por fichadas)'}`,
            estado: (!fich && !rot.leToca(dni, f)) ? 'ROT'
              : nv?.cat ?? (fich ? 'FICHO' : esFeriado.has(f) ? 'FER'
                : siape.presente.has(`${dni}|${f}`) ? 'PSF'                          // SIAPE lo da presente y no fichó
                : (!siape.cubreHasta || f > siape.cubreHasta) ? 'NOSIAPE'           // la descarga de SIAPE no llega a ese día
                : 'SIN'),
            novedad: nv ? { detalle: nv.detalle, desde: nv.desde, hasta: nv.hasta } : null,
            fichada: fich,
          });
        }
      }
      const sinHorario = dnis.filter(d => !horarios.has(d)).map(d => agentes.get(d));

      res.json({
        ok: true, desde, hasta, dias,
        servicio: { id: ctx.servicioId, nombre: ctx.servicioNombre, ids: ctx.servicioIds },
        agentes: [...agentes.values()],
        registros, sinHorario, feriados,
        rotacion: resumenRotacion(rot),
        fuentes: { ministerioAl, siapeAl: siape.cubreHasta, fichadasError: errFich },
      });
    } catch (e: any) {
      logger.error({ msg: 'presentismo-sector: error', error: e?.message });
      res.status(500).json({ ok: false, error: 'Error armando el presentismo' });
    }
  });

  // ── Próximos días: predicción de cuellos de botella ────────────────────────
  router.get('/prediccion', async (req: Request, res: Response) => {
    try {
      const nDias = clamp(Number(req.query.dias) || 14, 1, MAX_DIAS_PRED);
      const hoy = hoyIso();
      const desde = hoy, hasta = sumarDias(hoy, nDias - 1);
      const dias: string[] = [];
      for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f);
      if (req.query.refresh) { cacheHor = null; cacheModelo.clear(); cacheRot.clear(); }

      const { ctx, status, error } = await contexto(sequelize, req);
      if (!ctx) return res.status(status!).json({ ok: false, error });
      const { agentes, dnis } = ctx;
      if (!dnis.length) return res.json({ ok: true, dias, filas: [], agentes: [], minimos: [], servicio: { id: ctx.servicioId, nombre: ctx.servicioNombre } });

      const { map: horarios, error: errHor, mtime } = leerHorarios();
      if (errHor) return res.status(503).json({ ok: false, error: errHor });

      const modelo = await construirModelo(sequelize, `${ctx.servicioIds.join(',')}|${mtime}`, dnis, horarios);
      const rot = await detectarRotacion(sequelize, `${ctx.servicioIds.join(',')}|${mtime}`, dnis, horarios, sumarDias(hoy, -1));
      const { vigente, ministerioAl } = await leerNovedades(sequelize, dnis, desde, hasta);
      const feriados = await leerFeriados(sequelize, desde, hasta);

      // "Normal": presentes fichados en las últimas 12 semanas, por sector × turno × día de semana
      const nDesde = sumarDias(hoy, -84), nHasta = sumarDias(hoy, -1);
      const { map: fich, error: errFich } = await leerFichadas(dnis, nDesde, nHasta);
      const ferPasados = new Set((await leerFeriados(sequelize, nDesde, nHasta)).map((x: any) => x.fecha));
      const normalSum: Record<string, number> = {};
      const ocurrencias: Record<number, number> = {};
      for (let f = nDesde; f <= nHasta; f = sumarDias(f, 1)) {
        if (ferPasados.has(f)) continue;
        const w = dowDe(f);
        ocurrencias[w] = (ocurrencias[w] || 0) + 1;
        for (const dni of dnis) {
          const t = horarios.get(dni)?.[DOW_KEYS[w]] ?? rot.extra(dni, f);
          if (!t || !fich.turno(dni, f, t)) continue;
          for (const turno of turnosDe(t)) {
            const k = `${agentes.get(dni)!.sector}|${turno}|${w}`;
            normalSum[k] = (normalSum[k] || 0) + 1;
          }
        }
      }

      await ensureMinimosTable(sequelize);
      const minRows = await sequelize.query<any>(
        `SELECT sector, turno, tipo_dia, minimo FROM dotacion_minima WHERE servicio_id = ?`,
        { replacements: [ctx.servicioIds[0]], type: QueryTypes.SELECT },
      );
      const minimos = new Map<string, number>(minRows.map((r: any) => [`${r.sector}|${r.turno}|${r.tipo_dia}`, Number(r.minimo)]));
      const esFeriadoFut = new Set(feriados.map((x: any) => x.fecha));
      const tipoDia = (f: string) => (esFeriadoFut.has(f) || dowDe(f) === 0 || dowDe(f) === 6) ? 'finde' : 'habil';

      const filas: any[] = [];
      for (const f of dias) {
        const w = dowDe(f);
        const mes = Number(f.slice(5, 7));
        const grupos = new Map<string, any>();
        for (const dni of dnis) {
          const t = horarios.get(dni)?.[DOW_KEYS[w]] ?? rot.extra(dni, f);
          if (!t) continue;
          for (const turno of turnosDe(t)) {
            const sector = agentes.get(dni)!.sector;
            const k = `${sector}|${turno}`;
            if (!grupos.has(k)) grupos.set(k, { sector, turno, conocidos: [], restantes: [], rotacion: [] });
            const g = grupos.get(k);
            if (!rot.leToca(dni, f)) { g.rotacion.push(dni); continue; }
            const nv = vigente(dni, f);
            if (nv) g.conocidos.push({ dni, motivo: nv.cat, detalle: nv.detalle, desde: nv.desde, hasta: nv.hasta });
            else {
              const pa = modelo.pAgente.get(dni)!;
              const p = clamp(pa.p * modelo.factorMes[mes] * (modelo.factorTurnoDia[`${turno}|${w}`] ?? 1), 0, P_MAX);
              g.restantes.push({ dni, p: Math.round(p * 1000) / 1000, historiaDias: pa.dias });
            }
          }
        }
        for (const [k, g] of grupos) {
          const teoricos = g.conocidos.length + g.restantes.length;
          const qs = g.restantes.map((r: any) => 1 - r.p);
          const esperados = qs.reduce((a: number, b: number) => a + b, 0);
          const normal = ocurrencias[w] ? (normalSum[`${k}|${w}`] || 0) / ocurrencias[w] : null;
          const minimo = minimos.get(`${k}|${tipoDia(f)}`) ?? null;
          const riesgo = minimo != null ? probMenorQue(qs, minimo) : null;
          let nivel = 'ok';
          if (minimo != null) {
            if (esperados < minimo || (riesgo ?? 0) >= 0.5) nivel = 'rojo';
            else if ((riesgo ?? 0) >= 0.2) nivel = 'amarillo';
          }
          if (normal != null && normal >= 1) {
            const caida = esperados / normal;
            if (caida < 0.7) nivel = 'rojo';
            else if (caida < 0.85 && nivel === 'ok') nivel = 'amarillo';
          }
          g.restantes.sort((a: any, b: any) => b.p - a.p);
          filas.push({
            fecha: f, tipoDia: tipoDia(f), sector: g.sector, turno: g.turno, teoricos,
            conocidos: g.conocidos, restantes: g.restantes, rotacion: g.rotacion,
            esperados: Math.round(esperados * 10) / 10,
            normal: normal != null ? Math.round(normal * 10) / 10 : null,
            minimo, riesgo: riesgo != null ? Math.round(riesgo * 100) / 100 : null, nivel,
          });
        }
      }

      res.json({
        ok: true, dias, filas, feriados,
        servicio: { id: ctx.servicioId, nombre: ctx.servicioNombre, ids: ctx.servicioIds },
        agentes: [...agentes.values()],
        minimos: minRows,
        rotacion: resumenRotacion(rot),
        modelo: {
          histDesde: modelo.histDesde, histHasta: modelo.histHasta,
          tasaServicio: Math.round(modelo.pServicio * 1000) / 1000,
          factorMes: modelo.factorMes.slice(1).map(x => Math.round(x * 100) / 100),
          normalDesde: nDesde, normalHasta: nHasta,
        },
        fuentes: { ministerioAl, fichadasError: errFich },
      });
    } catch (e: any) {
      logger.error({ msg: 'presentismo-sector/prediccion: error', error: e?.message });
      res.status(500).json({ ok: false, error: 'Error armando la predicción' });
    }
  });

  // ── Distribución de enfermería: dotación por sector y horario ──────────────
  // GET /distribucion-enfermeria?dep=HOSPITAL|UPA18|UPA4
  // Admin elige la dependencia; el jefe ve solo la de su servicio (24/34 → Hospital, 38 → UPA 18, 51 → UPA 4).
  router.get('/distribucion-enfermeria', async (req: Request, res: Response) => {
    try {
      const auth = (req as any).auth ?? {};
      const esAdmin = (auth.permissions ?? []).includes('crud:*:*');
      let servicioUsuario: number | null = null;
      if (auth.principalType === 'user' && auth.principalId) {
        const [u] = await sequelize.query<any>(
          `SELECT servicio_id FROM usuarios WHERE id = ? AND deleted_at IS NULL`,
          { replacements: [auth.principalId], type: QueryTypes.SELECT },
        );
        servicioUsuario = u?.servicio_id != null ? Number(u.servicio_id) : null;
      }
      const depUsuario = Object.entries(ENFERMERIA_DEP).find(([, d]) => d.servicios.includes(servicioUsuario ?? -1))?.[0] ?? null;
      const pedida = String(req.query.dep ?? '').toUpperCase().replace(/\s+/g, '');
      let dep: string | null;
      if (esAdmin) dep = ENFERMERIA_DEP[pedida] ? pedida : (depUsuario ?? 'HOSPITAL');
      else dep = depUsuario;
      if (!dep) return res.status(403).json({ ok: false, error: 'Solo el admin y los jefes de enfermería pueden ver esta página' });
      if (req.query.refresh) cacheHor = null;

      const { servicios, nombre } = ENFERMERIA_DEP[dep];
      const padron = await sequelize.query<any>(
        `SELECT ags.dni, ags.servicio_id, s.nombre AS servicio, p.apellido, p.nombre,
                COALESCE(se.nombre, '(SIN SECTOR)') AS sector, o.nombre AS ocupacion
           FROM agentes_servicios ags
           JOIN (SELECT DISTINCT dni FROM agentes WHERE estado_empleo = 'ACTIVO') a ON a.dni = ags.dni
           JOIN personal p ON p.dni = ags.dni
           JOIN servicios s ON s.id = ags.servicio_id
           LEFT JOIN agentes_sectores x ON x.dni = ags.dni AND x.servicio_id = ags.servicio_id
                                       AND x.fecha_hasta IS NULL AND x.deleted_at IS NULL
           LEFT JOIN sectores se ON se.id = x.sector_id
           LEFT JOIN (SELECT dni, MAX(ocupacion_id) AS ocupacion_id FROM agentes
                       WHERE estado_empleo = 'ACTIVO' GROUP BY dni) ao ON ao.dni = ags.dni
           LEFT JOIN ocupaciones o ON o.id = ao.ocupacion_id
          WHERE ags.servicio_id IN (?) AND ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
          ORDER BY p.apellido, p.nombre`,
        { replacements: [servicios], type: QueryTypes.SELECT },
      );

      const { map: horarios, error: errHor } = leerHorarios();
      if (errHor) return res.status(503).json({ ok: false, error: errHor });

      const vistos = new Set<string>();
      const agentes: any[] = [];
      for (const r of padron) {
        const dni = normDni(r.dni);
        if (vistos.has(dni)) continue;
        vistos.add(dni);
        const h = horarios.get(dni);
        const dias: Record<string, { entrada: string; salida: string; horas: number; turno: string } | null> = {};
        for (const d of DIAS) {
          const t = h?.[d];
          dias[d] = t ? { entrada: t.entrada, salida: t.salida, horas: t.horas, turno: turnoDe(t.entrada, t.horas) } : null;
        }
        agentes.push({
          dni, nombre: [r.apellido, r.nombre].filter(Boolean).join(', '),
          servicioId: Number(r.servicio_id), servicio: r.servicio,
          sector: r.sector, ocupacion: (r.ocupacion || '').trim(),
          enHorarios: !!h, dias,
        });
      }

      res.json({
        ok: true, dep, nombre, esAdmin,
        dependencias: esAdmin ? Object.entries(ENFERMERIA_DEP).map(([k, d]) => ({ key: k, nombre: d.nombre })) : [{ key: dep, nombre }],
        servicios: (await sequelize.query<any>(
          `SELECT id, nombre FROM servicios WHERE id IN (?) ORDER BY FIELD(id, ?)`,
          { replacements: [servicios, servicios], type: QueryTypes.SELECT },
        )),
        agentes,
      });
    } catch (e: any) {
      logger.error({ msg: 'presentismo-sector/distribucion-enfermeria: error', error: e?.message });
      res.status(500).json({ ok: false, error: 'Error armando la distribución de enfermería' });
    }
  });

  // ── Dotación por categoría (Mi Sector): enfermería, médicos, administrativos… ──
  // GET /dotacion[?servicio_id=N]  Admin: cualquier servicio (sin servicio_id = todo el hospital).
  // Jefe: solo su servicio (Sala/Dpto. Enfermería se ven juntos). Categoría = regla sobre el nombre de la ocupación.
  router.get('/dotacion', async (req: Request, res: Response) => {
    try {
      const auth = (req as any).auth ?? {};
      const esAdmin = (auth.permissions ?? []).includes('crud:*:*');
      let servicioUsuario: number | null = null;
      if (auth.principalType === 'user' && auth.principalId) {
        const [u] = await sequelize.query<any>(
          `SELECT servicio_id FROM usuarios WHERE id = ? AND deleted_at IS NULL`,
          { replacements: [auth.principalId], type: QueryTypes.SELECT },
        );
        servicioUsuario = u?.servicio_id != null ? Number(u.servicio_id) : null;
      }
      let servicioIds: number[] | null;   // null = todos
      if (esAdmin) {
        const pedido = Number(req.query.servicio_id) || null;
        servicioIds = pedido ? (SERVICIOS_ENFERMERIA.includes(pedido) ? SERVICIOS_ENFERMERIA : [pedido]) : null;
      } else {
        if (servicioUsuario == null) return res.status(403).json({ ok: false, error: 'Tu usuario no tiene un servicio asignado' });
        servicioIds = SERVICIOS_ENFERMERIA.includes(servicioUsuario) ? SERVICIOS_ENFERMERIA : [servicioUsuario];
      }
      if (req.query.refresh) cacheHor = null;

      const padron = await sequelize.query<any>(
        `SELECT ags.dni, ags.servicio_id, s.nombre AS servicio, p.apellido, p.nombre,
                COALESCE(se.nombre, '(SIN SECTOR)') AS sector, o.nombre AS ocupacion
           FROM agentes_servicios ags
           JOIN (SELECT DISTINCT dni FROM agentes WHERE estado_empleo = 'ACTIVO') a ON a.dni = ags.dni
           JOIN personal p ON p.dni = ags.dni
           JOIN servicios s ON s.id = ags.servicio_id
           LEFT JOIN agentes_sectores x ON x.dni = ags.dni AND x.servicio_id = ags.servicio_id
                                       AND x.fecha_hasta IS NULL AND x.deleted_at IS NULL
           LEFT JOIN sectores se ON se.id = x.sector_id
           LEFT JOIN (SELECT dni, MAX(ocupacion_id) AS ocupacion_id FROM agentes
                       WHERE estado_empleo = 'ACTIVO' GROUP BY dni) ao ON ao.dni = ags.dni
           LEFT JOIN ocupaciones o ON o.id = ao.ocupacion_id
          WHERE ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
            ${servicioIds ? 'AND ags.servicio_id IN (:ids)' : ''}
          ORDER BY p.apellido, p.nombre`,
        { replacements: { ids: servicioIds ?? [0] }, type: QueryTypes.SELECT },
      );

      const { map: horarios, error: errHor } = leerHorarios();
      if (errHor) return res.status(503).json({ ok: false, error: errHor });

      const vistos = new Set<string>();
      const agentes: any[] = [];
      for (const r of padron) {
        const dni = normDni(r.dni);
        if (vistos.has(dni)) continue;
        vistos.add(dni);
        const h = horarios.get(dni);
        const dias: Record<string, { entrada: string; salida: string; horas: number; turno: string } | null> = {};
        for (const d of DIAS) {
          const t = h?.[d];
          dias[d] = t ? { entrada: t.entrada, salida: t.salida, horas: t.horas, turno: turnoDe(t.entrada, t.horas) } : null;
        }
        const ocupacion = String(r.ocupacion || '').trim();
        agentes.push({
          dni, nombre: [r.apellido, r.nombre].filter(Boolean).join(', '),
          servicioId: Number(r.servicio_id), servicio: r.servicio,
          // La mayoría no tiene sector cargado: se agrupa por el servicio para que no caigan todos en "sin sector"
          sector: r.sector === '(SIN SECTOR)' ? `${r.servicio} (servicio)` : r.sector,
          ocupacion, categoria: categoriaOcupacion(ocupacion),
          enHorarios: !!h, dias,
        });
      }

      // Servicios para el selector del admin (los que tienen activos) o el/los del jefe
      const servicios = await sequelize.query<any>(
        `SELECT s.id, s.nombre FROM servicios s
          WHERE s.deleted_at IS NULL
            ${servicioIds ? 'AND s.id IN (:ids)' : ''}
            AND EXISTS (SELECT 1 FROM agentes_servicios ags WHERE ags.servicio_id = s.id
                          AND ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL)
          ORDER BY s.nombre`,
        { replacements: { ids: servicioIds ?? [0] }, type: QueryTypes.SELECT },
      );
      res.json({ ok: true, esAdmin, servicioIds, servicios, categorias: CATEGORIAS.map(c => c.key).concat('OTROS'), agentes });
    } catch (e: any) {
      logger.error({ msg: 'presentismo-sector/dotacion: error', error: e?.message });
      res.status(500).json({ ok: false, error: 'Error armando la dotación' });
    }
  });

  // ── Mínimos por sector × turno (los carga el jefe) ─────────────────────────
  router.get('/minimos', async (req: Request, res: Response) => {
    try {
      const { ctx, status, error } = await contexto(sequelize, req);
      if (!ctx) return res.status(status!).json({ ok: false, error });
      await ensureMinimosTable(sequelize);
      const rows = await sequelize.query<any>(
        `SELECT sector, turno, tipo_dia, minimo, updated_by, DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i') AS updated_at
           FROM dotacion_minima WHERE servicio_id = ? ORDER BY sector, turno, tipo_dia`,
        { replacements: [ctx.servicioIds[0]], type: QueryTypes.SELECT },
      );
      res.json({ ok: true, minimos: rows });
    } catch (e: any) {
      logger.error({ msg: 'presentismo-sector/minimos: error', error: e?.message });
      res.status(500).json({ ok: false, error: 'Error leyendo los mínimos' });
    }
  });

  router.put('/minimos', async (req: Request, res: Response) => {
    try {
      const { ctx, status, error } = await contexto(sequelize, req);
      if (!ctx) return res.status(status!).json({ ok: false, error });
      const sector = String(req.body?.sector ?? '').trim();
      const turno = String(req.body?.turno ?? '').trim();
      const tipoDia = String(req.body?.tipo_dia ?? 'habil').trim();
      const raw = req.body?.minimo;
      const sectores = new Set([...ctx.agentes.values()].map(a => a.sector));
      if (!sectores.has(sector)) return res.status(400).json({ ok: false, error: 'Sector inexistente en tu servicio' });
      if (!TURNOS.includes(turno)) return res.status(400).json({ ok: false, error: 'Turno inválido' });
      if (!TIPOS_DIA.includes(tipoDia)) return res.status(400).json({ ok: false, error: 'Tipo de día inválido' });

      await ensureMinimosTable(sequelize);
      if (raw === null || raw === undefined || raw === '') {
        await sequelize.query(
          `DELETE FROM dotacion_minima WHERE servicio_id = ? AND sector = ? AND turno = ? AND tipo_dia = ?`,
          { replacements: [ctx.servicioIds[0], sector, turno, tipoDia] },
        );
        return res.json({ ok: true, minimo: null });
      }
      const minimo = Number(raw);
      if (!Number.isInteger(minimo) || minimo < 0 || minimo > 200) {
        return res.status(400).json({ ok: false, error: 'El mínimo debe ser un número entero entre 0 y 200' });
      }
      const auth = (req as any).auth ?? {};
      const usuario = (auth.principalType === 'user' || auth.principalType === 'dev') ? auth.principalId ?? null : null;
      await sequelize.query(
        `INSERT INTO dotacion_minima (servicio_id, sector, turno, tipo_dia, minimo, updated_by) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE minimo = VALUES(minimo), updated_by = VALUES(updated_by)`,
        { replacements: [ctx.servicioIds[0], sector, turno, tipoDia, minimo, usuario] },
      );
      res.json({ ok: true, minimo });
    } catch (e: any) {
      logger.error({ msg: 'presentismo-sector/minimos PUT: error', error: e?.message });
      res.status(500).json({ ok: false, error: 'Error guardando el mínimo' });
    }
  });

  return router;
}
