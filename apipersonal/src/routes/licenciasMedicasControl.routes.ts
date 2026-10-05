// src/routes/licenciasMedicasControl.routes.ts
// GET  /api/v1/licencias-medicas-control?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&refresh=1][&dni=X,Y]
//
// Control de licencias médicas NO OTORGADAS (EXCEL_ASISTENCIA_DIR):
//   · LICENCIAS_MEDICAS.xlsx  → licencias (todas salvo OTORGADA/APROBADA: PENDIENTE, DENEGADA,
//                               OBSERVADA, DOMICILIO ERRONEO, NO RESPONDE AL LLAMADO, …)
//   · HORARIOS*.xlsx          → si ese día le tocaba venir (armarTurnos: 24 h / noche que cruza)
//   · SIAPE\*.xlsx            → qué cargó el jefe en SIAPE ese día (PRESENTE, AUSENTE SIN AVISO…)
//   · adms_db.checkinout      → si fichó ese día (primera / última marca, hora local)
//
// Por cada licencia que se solapa con el período se devuelve el detalle día por día.
// "Deben reclamar" = NO JUSTIFICADAS (todo lo que no es PENDIENTE) con al menos un día del rango en que le tocaba venir
// (las que igual ficharon quedan en la lista, marcadas).
// Cada reclamo es una nota nueva (licencias_medicas_reclamo_notas → tblarchivos); se puede volver a
// reclamar. "Resueltas" = licencias reclamadas que el Ministerio terminó OTORGANDO.
// Solo admin (crud:*:*): contiene diagnósticos. Read-only. Excels cacheados por mtime.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { QueryTypes, Sequelize } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { armarTurnos, type Turno } from '../services/ausentismoEval';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

// ── helpers ──────────────────────────────────────────────────────────────────
const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DOW_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
// HORARIOS.xlsx (0-based) — mismo layout que horariosExtendidos
const COLS: Record<string, [number, number]> = {
  lunes: [4, 5], martes: [6, 7], miercoles: [8, 9], jueves: [10, 11],
  viernes: [12, 13], sabado: [14, 15], domingo: [16, 17],
};
// Resoluciones que justifican la licencia: todo lo demás se muestra
const OTORGADAS = new Set(['OTORGADA', 'APROBADA']);

function normHora(v: any): string | null {
  if (v == null) return null;
  const s = String((typeof v === 'object' && v.text) ? v.text : v).trim();
  if (!s || s === '-') return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : null;
}
const normDni = (v: any) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const normTxt = (s: any) => String(s ?? '').trim().toUpperCase();

/** Serial de Excel (46265.125 = medianoche AR en UTC) o texto DD/MM/AAAA → YYYY-MM-DD. */
function aIso(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date((Math.floor(v) - 25569) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const sumarDias = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowDe = (iso: string) => DOW_KEYS[new Date(iso + 'T00:00:00Z').getUTCDay()];

function leerHoja(fp: string, raw = true): any[][] {
  const wb = XLSX.readFile(fp, { cellDates: false, raw });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw, defval: '' });
}
function indiceCols(hdr: any[]) {
  const h = hdr.map(x => String(x ?? '').trim().toUpperCase());
  return (...keys: string[]) => { for (const k of keys) { const i = h.indexOf(k); if (i >= 0) return i; } return -1; };
}

// Cache de Excels por mtime (se relee solo si cambió el archivo)
const cacheArch = new Map<string, { mtime: number; data: any }>();
function conCache<T>(fp: string, parse: (fp: string) => T): T {
  const mtime = fs.statSync(fp).mtimeMs;
  const hit = cacheArch.get(fp);
  if (hit && hit.mtime === mtime) return hit.data as T;
  const data = parse(fp);
  cacheArch.set(fp, { mtime, data });
  return data;
}

// ── fuentes ──────────────────────────────────────────────────────────────────
interface Licencia {
  legajo: string; dni: string; nombre: string; novedad: string; resolucion: string;
  fecha_solicitud: string | null; desde: string; hasta: string; dias: number;
  justificado: string; codigo_oms: string; diagnostico: string; modalidad: string; junta_medica: string;
}
function parseLicencias(fp: string): Licencia[] {
  const raw = leerHoja(fp);
  if (raw.length < 2) return [];
  const ci = indiceCols(raw[0]);
  const c = {
    leg: ci('LEGAJO'), dni: ci('NRO_DOCUMENTO', 'NRO DOCUMENTO', 'DNI'), ap: ci('APELLIDO'), nom: ci('NOMBRE'),
    sol: ci('FECHA_SOLICITUD'), nov: ci('NOVEDAD'), res: ci('RESOLUCION'), des: ci('FECHA_DESDE'),
    has: ci('FECHA_HASTA'), dias: ci('DIAS'), just: ci('JUSTIFICADO'), oms: ci('CODIGO_OMS'),
    diag: ci('DIAGNOSTICO'), mod: ci('MODALIDAD_LICENCIA'), junta: ci('JUNTA_MEDICA'),
  };
  const g = (r: any[], i: number) => (i >= 0 ? r[i] : '');
  const out: Licencia[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const resolucion = normTxt(g(r, c.res));
    if (!resolucion) continue; // las OTORGADAS se leen igual: alimentan la pestaña "Resueltas"
    const dni = normDni(g(r, c.dni));
    const desde = aIso(g(r, c.des));
    if (!dni || !desde) continue;
    const hasta = aIso(g(r, c.has)) || desde;
    const ap = String(g(r, c.ap) ?? '').trim(), nm = String(g(r, c.nom) ?? '').trim();
    out.push({
      legajo: String(g(r, c.leg) ?? '').trim(), dni,
      nombre: ap && nm ? `${ap}, ${nm}` : (ap || nm),
      novedad: String(g(r, c.nov) ?? '').trim(), resolucion,
      fecha_solicitud: aIso(g(r, c.sol)), desde, hasta: hasta < desde ? desde : hasta,
      dias: Number(g(r, c.dias)) || 0, justificado: normTxt(g(r, c.just)),
      codigo_oms: String(g(r, c.oms) ?? '').trim(), diagnostico: String(g(r, c.diag) ?? '').trim(),
      modalidad: String(g(r, c.mod) ?? '').trim(), junta_medica: normTxt(g(r, c.junta)),
    });
  }
  return out;
}

interface Horario { turnos: Turno[]; servicio: string }
function parseHorarios(fp: string): Map<string, Horario> {
  const raw = leerHoja(fp, false); // horas como texto HH:MM (raw:true las trae como fracción de día)
  const map = new Map<string, Horario>();
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const dni = normDni(r[3]);
    if (!dni) continue;
    const semana: Record<string, { e: string | null; s: string | null }> = {};
    for (const k of DIAS) semana[k] = { e: normHora(r[COLS[k][0]]), s: normHora(r[COLS[k][1]]) };
    map.set(dni, { turnos: armarTurnos(semana), servicio: String(r[22] ?? '').trim() });
  }
  return map;
}

interface NovSiape { novedad: string; desde: string; hasta: string; justificado: string }
function parseSiape(fp: string): Map<string, NovSiape[]> {
  const raw = leerHoja(fp);
  const map = new Map<string, NovSiape[]>();
  if (raw.length < 2) return map;
  const ci = indiceCols(raw[0]);
  const cDni = ci('NRO_DOCUMENTO', 'NRO DOCUMENTO', 'DNI'), cNov = ci('NOVEDAD');
  const cDes = ci('FECHA_DESDE', 'FECHA DESDE'), cHas = ci('FECHA_HASTA', 'FECHA HASTA'), cJus = ci('JUSTIFICADO');
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const dni = normDni(r[cDni]);
    const desde = aIso(r[cDes]);
    const novedad = String(r[cNov] ?? '').trim();
    if (!dni || !desde || !novedad) continue;
    const hasta = aIso(r[cHas]) || desde;
    if (!map.has(dni)) map.set(dni, []);
    map.get(dni)!.push({ novedad, desde, hasta, justificado: cJus >= 0 ? normTxt(r[cJus]) : '' });
  }
  return map;
}

function cargarFuentes() {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR as string;
  if (!dir || !fs.existsSync(dir)) throw new Error('EXCEL_ASISTENCIA_DIR no configurado o inexistente');
  const excel = (f: string) => /\.xls[xm]?$/i.test(f) && !f.startsWith('~$');

  const licFile = fs.readdirSync(dir).find(f => excel(f) && /licencias?_?medicas/i.test(f));
  if (!licFile) throw new Error(`No se encontró LICENCIAS_MEDICAS.xlsx en ${dir}`);
  const licencias = conCache(path.join(dir, licFile), parseLicencias);
  const licenciasMtime = new Date(fs.statSync(path.join(dir, licFile)).mtimeMs).toISOString();

  const horarios = new Map<string, Horario>();
  const horFiles = fs.readdirSync(dir).filter(f => excel(f) && f.toLowerCase().includes('horario'));
  for (const f of horFiles) for (const [k, v] of conCache(path.join(dir, f), parseHorarios)) horarios.set(k, v);

  const siape = new Map<string, NovSiape[]>();
  const siapeDir = path.join(dir, 'SIAPE');
  const siapeFiles = fs.existsSync(siapeDir) ? fs.readdirSync(siapeDir).filter(excel) : [];
  for (const f of siapeFiles) {
    for (const [k, v] of conCache(path.join(siapeDir, f), parseSiape)) siape.set(k, [...(siape.get(k) || []), ...v]);
  }
  return {
    licencias, licenciasMtime, horarios, siape,
    archivos: { licencias: licFile, horarios: horFiles, siape: siapeFiles },
  };
}

// ── fichadas (adms_db) ───────────────────────────────────────────────────────
interface Fichada { primera: string; ultima: string; marcas: number }
async function leerFichadas(dnis: string[], desde: string, hasta: string): Promise<{ map: Map<string, Fichada>; error: string | null }> {
  const map = new Map<string, Fichada>();
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
      `SELECT ui.badgenumber AS dni, DATE(ci.checktime) AS fecha,
              DATE_FORMAT(MIN(ci.checktime), '%H:%i') AS primera,
              DATE_FORMAT(MAX(ci.checktime), '%H:%i') AS ultima,
              COUNT(*) AS marcas
         FROM checkinout ci
         INNER JOIN userinfo ui ON ci.userid = ui.userid
        WHERE ui.badgenumber IN (${ph})
          AND ci.checktime >= ? AND ci.checktime < ?
        GROUP BY ui.badgenumber, DATE(ci.checktime)`,
      [...dnis, `${desde} 00:00:00`, `${sumarDias(hasta, 1)} 00:00:00`],
    );
    for (const r of rows) {
      map.set(`${normDni(r.dni)}|${String(r.fecha).slice(0, 10)}`, {
        primera: String(r.primera), ultima: String(r.ultima), marcas: Number(r.marcas),
      });
    }
    return { map, error: null };
  } catch (e: any) {
    logger.warn({ msg: 'licencias-medicas-control: no se pudieron leer fichadas', error: e?.message });
    return { map, error: `No se pudieron leer las fichadas: ${e?.message}` };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

// ── router ───────────────────────────────────────────────────────────────────
const MAX_DIAS_LICENCIA = 400; // tope defensivo del detalle día por día

// Reclamo de licencias no otorgadas.
//   · licencias_medicas_reclamos: una fila por licencia (dni+desde+hasta+novedad) con el tilde
//     "reclamó". Tildar/destildar ACTUALIZA, nunca se borra.
//   · licencias_medicas_reclamo_notas: cada reclamo es una nota nueva (nro 1, 2, 3…). La nota en
//     sí es una fila de tblarchivos (Resoluciones → Archivos); acá solo se vincula y se numera.
// Runtime, sin migración (patrón del proyecto). La columna vieja archivo_id (una sola nota por
// licencia) se pasa una vez a la tabla de notas como reclamo nº 1 y ya no se usa.
async function ensureReclamosTable(sequelize: Sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS licencias_medicas_reclamos (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      dni           INT          NOT NULL,
      desde         DATE         NOT NULL,
      hasta         DATE         NOT NULL,
      novedad       VARCHAR(120) NOT NULL,
      reclamo       TINYINT(1)   NOT NULL DEFAULT 0,
      reclamo_at    DATETIME     NULL,
      reclamo_por   INT          NULL,
      archivo_id    INT          NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_lmr_licencia (dni, desde, hasta, novedad),
      KEY idx_lmr_reclamo (reclamo),
      CONSTRAINT fk_lmr_personal_dni FOREIGN KEY (dni) REFERENCES personal (dni)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS licencias_medicas_reclamo_notas (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      reclamo_id    INT       NOT NULL,
      nro           INT       NOT NULL,
      archivo_id    INT       NOT NULL,
      created_por   INT       NULL,
      created_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_lmrn_nro (reclamo_id, nro),
      UNIQUE KEY uq_lmrn_archivo (archivo_id),
      CONSTRAINT fk_lmrn_reclamo FOREIGN KEY (reclamo_id) REFERENCES licencias_medicas_reclamos (id),
      CONSTRAINT fk_lmrn_archivo FOREIGN KEY (archivo_id) REFERENCES tblarchivos (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Nota única del esquema viejo → reclamo nº 1 (idempotente: no re-inserta si ya tiene notas)
  await sequelize.query(`
    INSERT INTO licencias_medicas_reclamo_notas (reclamo_id, nro, archivo_id, created_por, created_at)
    SELECT r.id, 1, r.archivo_id, r.reclamo_por, COALESCE(r.reclamo_at, r.created_at)
      FROM licencias_medicas_reclamos r
     WHERE r.archivo_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM licencias_medicas_reclamo_notas n WHERE n.reclamo_id = r.id)
  `);
}

const esFecha = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fechaStr = (v: any) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const isoDe = (v: any) => (v ? new Date(v).toISOString() : null);

interface NotaReclamo {
  id: number; nro: number; numero: string; fecha: string | null; observaciones: string | null;
  cargada_por: string | null; created_at: string | null;
}
interface ReclamoReg {
  id: number; dni: string; desde: string; hasta: string; novedad: string;
  reclamo: boolean; reclamo_at: string | null; reclamo_por: string | null; notas: NotaReclamo[];
}

/** Todos los reclamos registrados con sus notas (la tabla es chica: solo licencias reclamadas). */
async function leerReclamos(sequelize: Sequelize): Promise<Map<string, ReclamoReg[]>> {
  const regs = await sequelize.query<any>(
    `SELECT r.id, r.dni, r.desde, r.hasta, r.novedad, r.reclamo, r.reclamo_at, u.nombre AS reclamo_por
       FROM licencias_medicas_reclamos r
       LEFT JOIN usuarios u ON u.id = r.reclamo_por`,
    { type: QueryTypes.SELECT },
  );
  const notas = await sequelize.query<any>(
    `SELECT n.id, n.reclamo_id, n.nro, n.created_at, ta.numero, ta.fecha, ta.descripcion_archivo, u.nombre AS cargada_por
       FROM licencias_medicas_reclamo_notas n
       JOIN tblarchivos ta ON ta.id = n.archivo_id AND ta.deleted_at IS NULL
       LEFT JOIN usuarios u ON u.id = n.created_por
      ORDER BY n.reclamo_id, n.nro`,
    { type: QueryTypes.SELECT },
  );
  const notasPor = new Map<number, NotaReclamo[]>();
  for (const n of notas) {
    const id = Number(n.reclamo_id);
    if (!notasPor.has(id)) notasPor.set(id, []);
    notasPor.get(id)!.push({
      id: Number(n.id), nro: Number(n.nro), numero: String(n.numero ?? ''), fecha: fechaStr(n.fecha),
      observaciones: n.descripcion_archivo ?? null, cargada_por: n.cargada_por ?? null, created_at: isoDe(n.created_at),
    });
  }
  const porDni = new Map<string, ReclamoReg[]>();
  for (const r of regs) {
    const dni = normDni(r.dni);
    if (!porDni.has(dni)) porDni.set(dni, []);
    porDni.get(dni)!.push({
      id: Number(r.id), dni, desde: fechaStr(r.desde)!, hasta: fechaStr(r.hasta)!, novedad: String(r.novedad),
      reclamo: !!r.reclamo, reclamo_at: isoDe(r.reclamo_at), reclamo_por: r.reclamo_por ?? null,
      notas: notasPor.get(Number(r.id)) || [],
    });
  }
  return porDni;
}

/** Reclamo de una licencia: misma clave exacta; si no, misma novedad con rango solapado
 *  (el Ministerio a veces corrige el rango: 23→27 OBSERVADA pasa a 23→25 DENEGADA). */
function reclamoDe(porDni: Map<string, ReclamoReg[]>, l: Licencia, usados?: Set<number>): ReclamoReg | null {
  const lista = (porDni.get(l.dni) || []).filter(r => !usados?.has(r.id));
  const exacto = lista.find(r => r.desde === l.desde && r.hasta === l.hasta && r.novedad === l.novedad);
  if (exacto) return exacto;
  const solapa = lista.filter(r => r.novedad === l.novedad && r.desde <= l.hasta && r.hasta >= l.desde);
  return solapa.sort((a, b) => b.id - a.id)[0] || null;
}
const tieneReclamo = (r: ReclamoReg | null) => !!r && (r.reclamo || r.notas.length > 0);

// ── Avisos por WhatsApp ──────────────────────────────────────────────────────────────────────
// licencias_medicas_whatsapp_envios: una fila por intento de envío (automático por la extensión
// de Chrome o manual por link). Los de prueba (prueba=1) no cuentan como "avisado".
async function ensureWhatsappTable(sequelize: Sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS licencias_medicas_whatsapp_envios (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      dni         INT          NOT NULL,
      desde       DATE         NOT NULL,
      hasta       DATE         NOT NULL,
      novedad     VARCHAR(120) NOT NULL,
      destino     VARCHAR(150) NULL,
      modo        ENUM('NOMBRE','TELEFONO','MANUAL') NOT NULL,
      prueba      TINYINT(1)   NOT NULL DEFAULT 0,
      estado      ENUM('ENVIADO','NO_ENCONTRADO','SIN_WHATSAPP','ERROR') NOT NULL,
      detalle     VARCHAR(255) NULL,
      mensaje     TEXT         NULL,
      enviado_por INT          NULL,
      created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_lmwe_licencia (dni, desde, hasta, novedad),
      CONSTRAINT fk_lmwe_personal_dni FOREIGN KEY (dni) REFERENCES personal (dni)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/** Celular para WhatsApp (549 + área + número, sin 0 ni 15) a partir del texto libre de
 *  personal.telefono ("4627-1479/1554242725", "NO POSEE/1130610665", "0341-153591500"…).
 *  Prefiere el que es seguro móvil (tenía 15, o es 11 que no empieza con 4); un 11-4xxx
 *  puede ser fijo → se usa solo si no hay otro y queda como dudoso. */
export function celularDe(raw: any): { celular: string | null; dudoso: boolean } {
  const cands: { cel: string; movil: boolean }[] = [];
  for (const seg of String(raw ?? '').split(/[\/;,|]|\s+[yo]\s+|-\s+|\s+-/i)) {
    const d = seg.replace(/\D/g, '');
    if (!d) continue;
    let nac = d.startsWith('549') && d.length === 13 ? d.slice(3)
      : d.startsWith('54') && d.length === 12 ? d.slice(2)
      : d.replace(/^0+/, '');
    let movil = d.startsWith('549') && d.length === 13;
    if (nac.length === 12) {
      // área (2-4 dígitos) + 15 + número
      for (const a of nac.startsWith('11') ? [2] : [3, 4, 2]) {
        if (nac.substr(a, 2) === '15') { nac = nac.slice(0, a) + nac.slice(a + 2); movil = true; break; }
      }
    } else if (nac.length === 10 && nac.startsWith('15')) {
      nac = '11' + nac.slice(2); movil = true; // 15-XXXX-XXXX sin área → AMBA
    }
    if (nac.length !== 10) continue;
    if (!movil) {
      if (!nac.startsWith('11')) continue; // otra área sin 15 → fijo
      movil = !nac.startsWith('114');
    }
    cands.push({ cel: `549${nac}`, movil });
  }
  const elegido = cands.find(c => c.movil) || cands[0];
  return elegido ? { celular: elegido.cel, dudoso: !elegido.movil } : { celular: null, dudoso: false };
}

export function buildLicenciasMedicasControlRouter(sequelize: Sequelize) {
  const router = Router();

  const tablaLista = ensureReclamosTable(sequelize).catch((e: any) => {
    logger.error({ msg: 'licencias_medicas_reclamos: error creando tablas', error: e?.message });
  });
  const tablaWhatsapp = ensureWhatsappTable(sequelize).catch((e: any) => {
    logger.error({ msg: 'licencias_medicas_whatsapp_envios: error creando tabla', error: e?.message });
  });

  router.get('/', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      if (!XLSX) return res.status(503).json({ ok: false, error: 'Módulo xlsx no disponible en el servidor' });
      if (req.query.refresh) cacheArch.clear();

      const hoy = new Date().toISOString().slice(0, 10);
      const qDesde = String(req.query.desde ?? '');
      const qHasta = String(req.query.hasta ?? '');
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : `${hoy.slice(0, 4)}-01-01`;
      const hasta = /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : hoy;

      let fuentes;
      try { fuentes = cargarFuentes(); }
      catch (e: any) { return res.status(404).json({ ok: false, error: e.message }); }
      const { licencias, licenciasMtime, horarios, siape, archivos } = fuentes;

      // Reclamos registrados (tilde + notas)
      let reclamos = new Map<string, ReclamoReg[]>();
      try {
        await tablaLista;
        reclamos = await leerReclamos(sequelize);
      } catch (e: any) {
        logger.warn({ msg: 'licencias-medicas-control: no se pudo leer reclamos', error: e?.message });
      }

      // Licencias que se solapan con el período:
      //   · no otorgadas (PENDIENTE, DENEGADA, OBSERVADA, …) → siempre
      //   · otorgadas → solo si se habían reclamado ("Resueltas")
      // ?dni= (modal de Gestión): solo ese agente; se aceptan varios separados por coma (cambio de DNI)
      const soloDnis = new Set(String(req.query.dni ?? '').split(',').map(normDni).filter(Boolean));
      const solapan = licencias.filter(l => l.desde <= hasta && l.hasta >= desde
        && (!soloDnis.size || soloDnis.has(l.dni)));
      const usados = new Set<number>();
      const base: { l: Licencia; rec: ReclamoReg | null; resuelta: boolean }[] = [];
      for (const l of solapan) {
        if (OTORGADAS.has(l.resolucion)) continue;
        const rec = reclamoDe(reclamos, l, usados);
        if (rec) usados.add(rec.id);
        base.push({ l, rec, resuelta: false });
      }
      for (const l of solapan) {
        if (!OTORGADAS.has(l.resolucion)) continue;
        const rec = reclamoDe(reclamos, l, usados);
        if (!rec || !tieneReclamo(rec)) continue;
        usados.add(rec.id);
        base.push({ l, rec, resuelta: true });
      }

      // El Excel del Ministerio trae TODOS los organismos: se deja solo el padrón del
      // hospital (tabla agentes). Si la base falla, se usa HORARIOS + SIAPE como padrón.
      const servicioDb = new Map<string, string>();
      let padron: Set<string> | null = null;
      const dnisExcel = [...new Set(base.map(b => b.l.dni))];
      if (dnisExcel.length) {
        try {
          const rows = await sequelize.query<any>(
            `SELECT a.dni, s.nombre AS servicio
               FROM agentes a
               LEFT JOIN agentes_servicios ags
                      ON ags.dni = a.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
               LEFT JOIN servicios s ON s.id = ags.servicio_id
              WHERE a.dni IN (:dnis) AND a.deleted_at IS NULL
              ORDER BY ags.id DESC`,
            { replacements: { dnis: dnisExcel.map(Number) }, type: QueryTypes.SELECT },
          );
          padron = new Set<string>();
          for (const r of rows) {
            const d = normDni(r.dni);
            padron.add(d);
            if (r.servicio && !servicioDb.has(d)) servicioDb.set(d, r.servicio);
          }
        } catch (e: any) {
          logger.warn({ msg: 'licencias-medicas-control: no se pudo leer el padrón', error: e?.message });
        }
      }
      if (!padron) padron = new Set([...horarios.keys(), ...siape.keys()]);

      const enPeriodo = base.filter(b => padron!.has(b.l.dni));
      const dnis = [...new Set(enPeriodo.map(b => b.l.dni))];
      const minDia = enPeriodo.reduce((m, b) => (b.l.desde < m ? b.l.desde : m), desde);
      const maxDia = enPeriodo.reduce((m, b) => (b.l.hasta > m ? b.l.hasta : m), hasta);

      const { map: fichadas, error: errorFichadas } = await leerFichadas(dnis, minDia, maxDia);

      const salida = enPeriodo.map(({ l, rec, resuelta }) => {
        const hor = horarios.get(l.dni);
        const novs = siape.get(l.dni) || [];
        const detalle: any[] = [];
        let dia = l.desde;
        for (let n = 0; dia <= l.hasta && n < MAX_DIAS_LICENCIA; n++, dia = sumarDias(dia, 1)) {
          const dow = dowDe(dia);
          const turno = hor?.turnos.find(t => t.dia === dow) || null;
          const fic = fichadas.get(`${l.dni}|${dia}`) || null;
          const jefe = [...new Set(novs.filter(x => x.desde <= dia && x.hasta >= dia).map(x => x.novedad))];
          detalle.push({
            fecha: dia,
            dia_semana: dow,
            le_tocaba: hor ? !!turno : null,          // null = sin horario cargado
            horario: turno ? `${turno.entrada}-${turno.salida}${turno.cruza ? ' (+1)' : ''}` : '',
            fichada: fic,
            siape_jefe: jefe,
          });
        }
        const diasTocaba = detalle.filter(d => d.le_tocaba).length;
        const diasFicho = detalle.filter(d => d.fichada).length;
        const diasFichoTocaba = detalle.filter(d => d.le_tocaba && d.fichada).length;
        const jefeResumen = [...new Set(detalle.flatMap(d => d.siape_jefe))];
        const notas = rec?.notas ?? [];
        // Último movimiento del reclamo: si el Excel del Ministerio es posterior y la licencia
        // sigue sin otorgar, el reclamo no prosperó (todavía) → volver a reclamar.
        const ultimoReclamo = [rec?.reclamo_at, ...notas.map(n => n.created_at)].filter(Boolean).sort().pop() || null;
        const reclamo = !!rec?.reclamo;
        return {
          ...l,
          servicio: servicioDb.get(l.dni) || hor?.servicio || '',
          sin_horario: !hor,
          dias_tocaba: diasTocaba,
          dias_ficho: diasFicho,
          dias_ficho_tocaba: diasFichoTocaba,
          siape_jefe: jefeResumen,
          resuelta,
          debe_reclamar: !resuelta && l.resolucion !== 'PENDIENTE' && diasTocaba > 0,
          reclamo_id: rec?.id ?? null,
          reclamo,
          reclamo_at: rec?.reclamo_at ?? null,
          reclamo_por: rec?.reclamo_por ?? null,
          notas,
          sigue_sin_otorgar: !resuelta && reclamo && !!ultimoReclamo && ultimoReclamo < licenciasMtime,
          detalle,
        };
      });

      salida.sort((a, b) => b.desde.localeCompare(a.desde) || a.nombre.localeCompare(b.nombre, 'es'));

      const vigentes = salida.filter(x => !x.resuelta);
      const pend = vigentes.filter(x => x.resolucion === 'PENDIENTE');
      const den = vigentes.filter(x => x.resolucion !== 'PENDIENTE'); // denegadas, observadas, etc.
      return res.json({
        ok: true,
        periodo: { desde, hasta },
        archivos,
        licencias_actualizado: licenciasMtime,
        error_fichadas: errorFichadas,
        resumen: {
          pendientes: pend.length,
          denegadas: den.length,
          por_resolucion: vigentes.reduce((acc: Record<string, number>, x) => { acc[x.resolucion] = (acc[x.resolucion] || 0) + 1; return acc; }, {}),
          deben_reclamar: den.filter(x => x.debe_reclamar && !x.reclamo).length,
          reclamaron: den.filter(x => x.reclamo).length,
          sigue_sin_otorgar: den.filter(x => x.sigue_sin_otorgar).length,
          resueltas: salida.filter(x => x.resuelta).length,
          reclamar_con_fichada: den.filter(x => x.debe_reclamar && x.dias_ficho_tocaba > 0).length,
          denegadas_sin_horario: den.filter(x => x.sin_horario).length,
        },
        data: salida,
        generado: new Date().toISOString(),
      });
    } catch (err: unknown) {
      logger.error({ msg: 'Error licencias-medicas-control', err });
      return res.status(500).json({ ok: false, error: 'Error procesando el control de licencias médicas' });
    }
  });

  /** Fila de reclamo de la licencia: por reclamo_id si viene (licencia ya vinculada), si no
   *  upsert por dni+desde+hasta+novedad. Devuelve el id. */
  async function asegurarReclamo(b: any, transaction?: any): Promise<number> {
    if (b.reclamo_id) {
      const rows = await sequelize.query<any>(
        'SELECT id FROM licencias_medicas_reclamos WHERE id = :id',
        { replacements: { id: Number(b.reclamo_id) }, type: QueryTypes.SELECT, transaction },
      );
      if (rows[0]?.id) return Number(rows[0].id);
    }
    const dni = Number(normDni(b.dni));
    const novedad = String(b.novedad ?? '').trim().slice(0, 120);
    if (!dni || !esFecha(b.desde) || !esFecha(b.hasta) || !novedad) {
      throw Object.assign(new Error('Faltan dni, desde, hasta o novedad'), { status: 400 });
    }
    await sequelize.query(
      `INSERT IGNORE INTO licencias_medicas_reclamos (dni, desde, hasta, novedad)
       VALUES (:dni, :desde, :hasta, :novedad)`,
      { replacements: { dni, desde: b.desde, hasta: b.hasta, novedad }, transaction },
    );
    const rows = await sequelize.query<any>(
      `SELECT id FROM licencias_medicas_reclamos
        WHERE dni = :dni AND desde = :desde AND hasta = :hasta AND novedad = :novedad`,
      { replacements: { dni, desde: b.desde, hasta: b.hasta, novedad }, type: QueryTypes.SELECT, transaction },
    );
    if (!rows[0]?.id) throw Object.assign(new Error('El DNI no está en la tabla personal'), { status: 409 });
    return Number(rows[0].id);
  }

  function datosNota(b: any) {
    const numero = String(b.nota_numero ?? '').trim().slice(0, 255);
    if (!numero) throw Object.assign(new Error('Falta el número de nota'), { status: 400 });
    if (b.nota_fecha && !esFecha(b.nota_fecha)) throw Object.assign(new Error('Fecha de nota inválida'), { status: 400 });
    const fecha = b.nota_fecha || null;
    const anio = Number(String(fecha || new Date().toISOString()).slice(0, 4));
    const obs = String(b.observaciones ?? '').trim().slice(0, 255) || null;
    return { numero, fecha, anio, obs };
  }

  function errorRes(res: Response, err: any, msg: string) {
    if (err?.status) return res.status(err.status).json({ ok: false, error: err.message });
    if (err?.original?.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(409).json({ ok: false, error: 'El DNI no está en la tabla personal' });
    }
    logger.error({ msg, err });
    return res.status(500).json({ ok: false, error: msg });
  }

  // Tilde "reclamó". Body: { reclamo_id? | dni, desde, hasta, novedad; reclamo: boolean }
  router.put('/reclamo', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      await tablaLista;
      const b = req.body ?? {};
      if (typeof b.reclamo !== 'boolean') return res.status(400).json({ ok: false, error: 'Falta reclamo' });
      const id = await asegurarReclamo(b);
      const userId = (req as any).auth?.principalId ?? null;
      await sequelize.query(
        `UPDATE licencias_medicas_reclamos SET reclamo = :reclamo, reclamo_at = NOW(), reclamo_por = :userId WHERE id = :id`,
        { replacements: { reclamo: b.reclamo ? 1 : 0, userId, id } },
      );
      return res.json({ ok: true, reclamo_id: id });
    } catch (err: any) {
      return errorRes(res, err, 'Error guardando el reclamo');
    }
  });

  // Nueva nota de reclamo (nº siguiente). Deja tildado "reclamó".
  // Body: { reclamo_id? | dni, desde, hasta, novedad; nota_numero, nota_fecha?, observaciones? }
  router.post('/reclamo/nota', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      await tablaLista;
      const b = req.body ?? {};
      const nota = datosNota(b);
      const userId = (req as any).auth?.principalId ?? null;
      const resultado = await sequelize.transaction(async (transaction) => {
        const reclamoId = await asegurarReclamo(b, transaction);
        const [rec] = await sequelize.query<any>(
          'SELECT id, dni, desde, hasta, novedad FROM licencias_medicas_reclamos WHERE id = :id FOR UPDATE',
          { replacements: { id: reclamoId }, type: QueryTypes.SELECT, transaction },
        );
        const [{ nro }] = await sequelize.query<any>(
          'SELECT COALESCE(MAX(nro), 0) + 1 AS nro FROM licencias_medicas_reclamo_notas WHERE reclamo_id = :id',
          { replacements: { id: reclamoId }, type: QueryTypes.SELECT, transaction },
        );
        const dmy = (f: any) => String(fechaStr(f)).split('-').reverse().join('/');
        const d = fechaStr(rec.desde), h = fechaStr(rec.hasta);
        const nombre = `Nota de reclamo nº ${nro} licencia ${rec.novedad} ${dmy(d)}${h !== d ? ` al ${dmy(h)}` : ''}`.slice(0, 255);
        const [archivoId] = await sequelize.query(
          `INSERT INTO tblarchivos (dni, nombre, numero, tipo, fecha, anio, descripcion_archivo, created_by)
           VALUES (:dni, :nombre, :numero, 'nota', :fecha, :anio, :obs, :userId)`,
          { replacements: { dni: rec.dni, nombre, ...nota, userId }, type: QueryTypes.INSERT, transaction },
        );
        const [notaId] = await sequelize.query(
          `INSERT INTO licencias_medicas_reclamo_notas (reclamo_id, nro, archivo_id, created_por)
           VALUES (:reclamoId, :nro, :archivoId, :userId)`,
          { replacements: { reclamoId, nro: Number(nro), archivoId: Number(archivoId), userId }, type: QueryTypes.INSERT, transaction },
        );
        await sequelize.query(
          `UPDATE licencias_medicas_reclamos
              SET reclamo_at = IF(reclamo = 1, reclamo_at, NOW()),
                  reclamo_por = IF(reclamo = 1, reclamo_por, :userId),
                  reclamo = 1
            WHERE id = :reclamoId`,
          { replacements: { reclamoId, userId }, transaction },
        );
        return { reclamo_id: reclamoId, nota_id: Number(notaId), nro: Number(nro) };
      });
      return res.json({ ok: true, ...resultado });
    } catch (err: any) {
      return errorRes(res, err, 'Error guardando la nota de reclamo');
    }
  });

  // Corrige una nota ya cargada (no crea otra). Body: { nota_numero, nota_fecha?, observaciones? }
  router.put('/reclamo/nota/:id', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      await tablaLista;
      const nota = datosNota(req.body ?? {});
      const userId = (req as any).auth?.principalId ?? null;
      const [row] = await sequelize.query<any>(
        'SELECT archivo_id FROM licencias_medicas_reclamo_notas WHERE id = :id',
        { replacements: { id: Number(req.params.id) }, type: QueryTypes.SELECT },
      );
      if (!row) return res.status(404).json({ ok: false, error: 'Nota no encontrada' });
      await sequelize.query(
        `UPDATE tblarchivos SET numero = :numero, fecha = :fecha, anio = :anio,
                descripcion_archivo = :obs, updated_by = :userId
          WHERE id = :archivoId`,
        { replacements: { ...nota, userId, archivoId: Number(row.archivo_id) } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      return errorRes(res, err, 'Error editando la nota de reclamo');
    }
  });

  // Elimina una nota cargada por error: saca el vínculo y da de baja lógica el registro de tblarchivos.
  // El tilde "reclamó" no se toca (se destilda aparte).
  router.delete('/reclamo/nota/:id', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      await tablaLista;
      const userId = (req as any).auth?.principalId ?? null;
      const ok = await sequelize.transaction(async (transaction) => {
        const [row] = await sequelize.query<any>(
          'SELECT archivo_id FROM licencias_medicas_reclamo_notas WHERE id = :id FOR UPDATE',
          { replacements: { id: Number(req.params.id) }, type: QueryTypes.SELECT, transaction },
        );
        if (!row) return false;
        await sequelize.query(
          'DELETE FROM licencias_medicas_reclamo_notas WHERE id = :id',
          { replacements: { id: Number(req.params.id) }, transaction },
        );
        await sequelize.query(
          'UPDATE tblarchivos SET deleted_at = NOW(), updated_by = :userId WHERE id = :archivoId AND deleted_at IS NULL',
          { replacements: { userId, archivoId: Number(row.archivo_id) }, transaction },
        );
        return true;
      });
      if (!ok) return res.status(404).json({ ok: false, error: 'Nota no encontrada' });
      return res.json({ ok: true });
    } catch (err: any) {
      return errorRes(res, err, 'Error eliminando la nota de reclamo');
    }
  });

  // Teléfonos para WhatsApp + envíos reales (no prueba) de esos DNI.
  // GET /whatsapp/contactos?dni=1,2,3
  router.get('/whatsapp/contactos', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      await tablaWhatsapp;
      const dnis = [...new Set(String(req.query.dni ?? '').split(',').map(x => Number(x.trim())).filter(n => Number.isInteger(n) && n > 0))];
      if (!dnis.length) return res.json({ ok: true, contactos: [], envios: [] });
      const personas = await sequelize.query<any>(
        'SELECT dni, apellido, nombre, telefono FROM personal WHERE dni IN (:dnis)',
        { replacements: { dnis }, type: QueryTypes.SELECT },
      );
      const envios = await sequelize.query<any>(
        `SELECT e.id, e.dni, e.desde, e.hasta, e.novedad, e.destino, e.modo, e.estado, e.detalle, e.created_at, u.nombre AS enviado_por
           FROM licencias_medicas_whatsapp_envios e
           LEFT JOIN usuarios u ON u.id = e.enviado_por
          WHERE e.dni IN (:dnis) AND e.prueba = 0
          ORDER BY e.id`,
        { replacements: { dnis }, type: QueryTypes.SELECT },
      );
      return res.json({
        ok: true,
        contactos: personas.map(p => ({
          dni: String(p.dni), apellido: p.apellido ?? '', nombre: p.nombre ?? '', telefono: p.telefono ?? '',
          ...celularDe(p.telefono),
        })),
        envios: envios.map(e => ({
          id: Number(e.id), dni: String(e.dni), desde: fechaStr(e.desde), hasta: fechaStr(e.hasta), novedad: e.novedad,
          destino: e.destino, modo: e.modo, estado: e.estado, detalle: e.detalle,
          created_at: isoDe(e.created_at), enviado_por: e.enviado_por ?? null,
        })),
      });
    } catch (err: any) {
      return errorRes(res, err, 'Error leyendo los teléfonos');
    }
  });

  // Registra un intento de envío. Body: { dni, desde, hasta, novedad, destino?, modo, prueba?, estado, detalle?, mensaje? }
  router.post('/whatsapp/envio', requirePermission('crud:*:*'), async (req: Request, res: Response) => {
    try {
      await tablaWhatsapp;
      const b = req.body ?? {};
      if (!Number(b.dni) || !esFecha(b.desde) || !esFecha(b.hasta) || !b.novedad) {
        return res.status(400).json({ ok: false, error: 'Faltan datos de la licencia' });
      }
      if (!['NOMBRE', 'TELEFONO', 'MANUAL'].includes(b.modo) || !['ENVIADO', 'NO_ENCONTRADO', 'SIN_WHATSAPP', 'ERROR'].includes(b.estado)) {
        return res.status(400).json({ ok: false, error: 'Modo o estado inválido' });
      }
      const userId = (req as any).auth?.principalId ?? null;
      const [id] = await sequelize.query(
        `INSERT INTO licencias_medicas_whatsapp_envios
           (dni, desde, hasta, novedad, destino, modo, prueba, estado, detalle, mensaje, enviado_por)
         VALUES (:dni, :desde, :hasta, :novedad, :destino, :modo, :prueba, :estado, :detalle, :mensaje, :userId)`,
        {
          replacements: {
            dni: Number(b.dni), desde: b.desde, hasta: b.hasta, novedad: String(b.novedad).slice(0, 120),
            destino: b.destino ? String(b.destino).slice(0, 150) : null, modo: b.modo, prueba: b.prueba ? 1 : 0,
            estado: b.estado, detalle: b.detalle ? String(b.detalle).slice(0, 255) : null,
            mensaje: b.mensaje ? String(b.mensaje) : null, userId,
          },
          type: QueryTypes.INSERT,
        },
      );
      return res.json({ ok: true, id: Number(id) });
    } catch (err: any) {
      return errorRes(res, err, 'Error registrando el envío');
    }
  });

  // Celulares de todos los agentes ACTIVOS (para cruzar con la agenda de WhatsApp Web).
  router.get('/whatsapp/celulares', requirePermission('crud:*:*'), async (_req: Request, res: Response) => {
    try {
      const rows = await sequelize.query<any>(
        `SELECT p.dni, p.apellido, p.nombre, p.telefono
           FROM personal p
          WHERE EXISTS (SELECT 1 FROM agentes a WHERE a.dni = p.dni AND a.estado_empleo = 'ACTIVO')`,
        { type: QueryTypes.SELECT },
      );
      return res.json({
        ok: true,
        agentes: rows.map(p => ({
          dni: String(p.dni), apellido: p.apellido ?? '', nombre: p.nombre ?? '', telefono: p.telefono ?? '',
          ...celularDe(p.telefono),
        })),
      });
    } catch (err: any) {
      return errorRes(res, err, 'Error leyendo los celulares');
    }
  });

  return router;
}
