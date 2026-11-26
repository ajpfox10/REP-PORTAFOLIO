// src/routes/bloqueoDocumentacion.routes.ts
//
// Bloqueo por documentación faltante de la TANDA 1 (pedido 25/11/2026).
// Apenas el usuario inicia sesión, el front muestra un cartel que tapa toda la app con
// quién no tiene qué documento bajado de SIAPE en DOCU, por qué (lo que vio el robot de
// Legajo Digital) y desde cuándo están los antecedentes. Solo se sigue con el código.
//
//   GET  /bloqueo-documentacion              → { activo, items[], generado }
//   POST /bloqueo-documentacion/desbloquear  { codigo } → { ok } (queda registrado quién)
//
// La lista se arma al momento desde DOCU (caché 2 min): cuando llega el documento la
// persona sale sola. El código se compara por hash (no queda escrito en el front).
import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dns from 'dns';
import { env } from '../config/env';
import { ipDe } from '../services/pcsConectadas';
import { logger } from '../logging/logger';

const TANDAS = ['TANDA 1'];
// El código de desbloqueo vive en el .env (no en el repo): BLOQUEO_DOC_CLAVE_HASH = sha256 del código,
// o BLOQUEO_DOC_CLAVE = el código en claro. Sin ninguno de los dos, ningún código desbloquea.

const DOCS = [
  { clave: 'apto',       nombre: 'Apto psicofísico',          carpeta: 'Certificado Apto Psicofisico',   prefijo: 'Apto Psicofisico SIAPE' },
  { clave: 'cv',         nombre: 'CV',                        carpeta: 'Curriculum',                     prefijo: 'Curriculum SIAPE' },
  { clave: 'planilla',   nombre: 'Planilla de datos personales', carpeta: 'Planilla de datos personales', prefijo: 'Planilla de datos personales SIAPE' }, // sync-guard:ignore
  { clave: 'aceptacion', nombre: 'Constancia de aceptación',  carpeta: 'Constancia de Aceptacion SIAPE', prefijo: 'Constancia de aceptacion SIAPE' }, // sync-guard:ignore
];
const ANTECEDENTES = [
  { clave: 'provincial', carpeta: 'Certificado ant. Provinciales' }, // sync-guard:ignore
  { clave: 'nacional',   carpeta: 'Certificado ant. Nacionales' }, // sync-guard:ignore
];

type Item = {
  dni: number;
  nombre: string;
  faltan: string[];
  motivo: string;
  antecedentes: { provincial: string | null; nacional: string | null };
};

function docuBase(): string {
  return String(env.TRAMITES_DOCU_BASE_DIR || 'D:\\G\\DOCU');
}

function archivos(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()); } catch { return []; }
}

function fechaMasNueva(dir: string): string | null {
  let max = 0;
  for (const f of archivos(dir)) {
    if (/^thumbs\.db$/i.test(f.name)) continue;
    try { max = Math.max(max, fs.statSync(path.join(dir, f.name)).mtimeMs); } catch { /* */ }
  }
  return max ? new Date(max).toISOString() : null;
}

// Lo que dejó el robot de Legajo Digital en su última pasada por el agente.
function motivoRobot(detalle: string | null | undefined, faltan: string[]): string {
  const d = String(detalle || '');
  if (!d) return 'El robot todavía no lo revisó';
  if (/^sin_tramite/.test(d)) return 'No tiene PASE A PLANTA PERMANENTE 2026 en el Legajo Digital de SIAPE';
  const rojo = d.match(/no hizo (.*?) \(en rojo/);
  if (rojo) return `En SIAPE no hizo ${rojo[1]} (en rojo): no se pueden bajar CV ni planilla`;
  if (/^error/.test(d)) return 'Error del robot al leer SIAPE (hay que reintentar)';
  const noEsta = DOCS.filter(x => faltan.includes(x.nombre))
    .filter(x => new RegExp(`${x.carpeta}: no esta en SIAPE`, 'i').test(d))
    .map(x => x.nombre);
  if (noEsta.length) return `No está cargado en SIAPE: ${noEsta.join(', ')}`;
  return 'Falta bajarlo de SIAPE';
}

let cache: { at: number; items: Item[] } | null = null;

async function calcular(sequelize: Sequelize): Promise<Item[]> {
  if (cache && Date.now() - cache.at < 2 * 60 * 1000) return cache.items;
  const agentes = await sequelize.query<{ dni: number; nombre: string }>(
    `SELECT t.dni, CONCAT(MAX(p.apellido), ', ', MAX(p.nombre)) AS nombre
       FROM tramites_tanda_interinos t
       LEFT JOIN personal p ON p.dni = t.dni
      WHERE t.tanda IN (:tandas)
        AND NOT EXISTS (SELECT 1 FROM agentes a WHERE a.dni = t.dni AND a.ley_id = 12
                         AND a.deleted_at IS NULL AND a.estado_empleo IN ('ACTIVO','TRAMITE','COMISION'))
      GROUP BY t.dni ORDER BY nombre`,
    { type: QueryTypes.SELECT, replacements: { tandas: TANDAS } },
  );
  const detalles = new Map<number, string>();
  if (agentes.length) {
    const rows = await sequelize.query<{ dni: number; detalle: string }>(
      `SELECT i.dni, i.detalle FROM script_run_items i
         JOIN (SELECT dni, MAX(id) mid FROM script_run_items
                WHERE script = 'siape_legajo_digital' AND dni IN (:dnis) GROUP BY dni) x ON x.mid = i.id`,
      { type: QueryTypes.SELECT, replacements: { dnis: agentes.map(a => a.dni) } },
    ).catch(() => [] as any[]);
    for (const r of rows) detalles.set(Number(r.dni), r.detalle);
  }
  const base = docuBase();
  const items: Item[] = [];
  for (const a of agentes) {
    const carpeta = path.join(base, String(a.dni));
    const faltan = DOCS
      .filter(d => !archivos(path.join(carpeta, d.carpeta)).some(f => f.name.startsWith(d.prefijo)))
      .map(d => d.nombre);
    if (!faltan.length) continue;
    items.push({
      dni: Number(a.dni),
      nombre: a.nombre || `DNI ${a.dni}`,
      faltan,
      motivo: motivoRobot(detalles.get(Number(a.dni)), faltan),
      antecedentes: {
        provincial: fechaMasNueva(path.join(carpeta, ANTECEDENTES[0].carpeta)),
        nacional: fechaMasNueva(path.join(carpeta, ANTECEDENTES[1].carpeta)),
      },
    });
  }
  cache = { at: Date.now(), items };
  return items;
}

function codigoOk(ingresado: string): boolean {
  // process.env directo: el schema de config/env descarta las variables que no declara.
  const propio = String(process.env.BLOQUEO_DOC_CLAVE || '').trim();
  const hash = String(process.env.BLOQUEO_DOC_CLAVE_HASH || '').trim().toLowerCase();
  const esperado = propio ? crypto.createHash('sha256').update(propio).digest('hex') : hash;
  if (!/^[0-9a-f]{64}$/.test(esperado)) {
    logger.error({ msg: '[bloqueo-documentacion] falta BLOQUEO_DOC_CLAVE_HASH (o BLOQUEO_DOC_CLAVE) en el .env' });
    return false;
  }
  const a = crypto.createHash('sha256').update(String(ingresado ?? '').trim()).digest();
  const b = Buffer.from(esperado, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Activar / desactivar el bloqueo: SOLO desde la PC del servidor (por nombre de equipo) ──
// (pedido 26/11/2026). Estado en app_runtime_config 'bloqueo_documentacion' = {activo}; sin fila = activo.
const EQUIPO_HABILITADO = String((env as any).BLOQUEO_DOC_EQUIPO || 'SERVIDOR-RRHH').toUpperCase();
const CLAVE_CONFIG = 'bloqueo_documentacion'; // sync-guard:ignore

function ipsPropias(): Set<string> {
  const s = new Set<string>(['127.0.0.1', '::1']);
  for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) s.add(i.address.replace(/^::ffff:/, ''));
  return s;
}

// Nombre de equipo de quien hace el pedido: si viene del propio servidor, el nombre de esta PC;
// si no, el que da la red (NetBIOS/DNS, puede tardar unos segundos).
async function equipoDe(req: Request): Promise<string | null> {
  const ip = ipDe(req);
  if (ipsPropias().has(ip)) return os.hostname().toUpperCase();
  try {
    const r = await Promise.race([
      dns.promises.lookupService(ip, 0),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    return r.hostname && r.hostname !== ip ? r.hostname.split('.')[0].toUpperCase() : null;
  } catch { return null; }
}

async function leerActivo(sequelize: Sequelize): Promise<boolean> {
  try {
    const rows = await sequelize.query<{ config_json: any }>(
      `SELECT config_json FROM app_runtime_config WHERE config_key = :k`,
      { type: QueryTypes.SELECT, replacements: { k: CLAVE_CONFIG } },
    );
    if (!rows.length) return true;
    const j = typeof rows[0].config_json === 'string' ? JSON.parse(rows[0].config_json) : rows[0].config_json;
    return j?.activo !== false;
  } catch { return true; }
}

let tablaLista = false;
async function ensureTabla(sequelize: Sequelize) {
  if (tablaLista) return;
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS bloqueo_documentacion_desbloqueos (
       id INT AUTO_INCREMENT PRIMARY KEY,
       user_id INT NULL,
       ip VARCHAR(64) NULL,
       pendientes INT NOT NULL DEFAULT 0,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
  tablaLista = true;
}

export function buildBloqueoDocumentacionRouter(sequelize: Sequelize): Router {
  const router = Router();

  router.get('/estado', async (req: Request, res: Response) => {
    const equipo = await equipoDe(req);
    return res.json({ ok: true, data: { activo: await leerActivo(sequelize), equipo, puede_configurar: equipo === EQUIPO_HABILITADO } });
  });

  router.put('/estado', async (req: Request, res: Response) => {
    const userId = (req as any).auth?.principalId ?? null;
    const equipo = await equipoDe(req);
    if (equipo !== EQUIPO_HABILITADO) {
      logger.warn({ msg: 'bloqueo-documentacion: intento de cambiar el estado desde otra PC', userId, equipo, ip: ipDe(req) });
      return res.status(403).json({ ok: false, error: `Solo se puede cambiar desde la PC ${EQUIPO_HABILITADO}` });
    }
    const activo = req.body?.activo !== false;
    const datos = { activo, por: userId, equipo, at: new Date().toISOString() };
    await sequelize.query(
      `INSERT INTO app_runtime_config (config_key, config_json, created_at, updated_at) VALUES (:k, :j, NOW(), NOW())
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()`,
      { replacements: { k: CLAVE_CONFIG, j: JSON.stringify(datos) } },
    );
    logger.info({ msg: `bloqueo-documentacion: ${activo ? 'ACTIVADO' : 'DESACTIVADO'}`, userId, equipo });
    return res.json({ ok: true, data: { activo } });
  });

  router.get('/', async (_req: Request, res: Response) => {
    try {
      if (!(await leerActivo(sequelize))) {
        return res.json({ ok: true, data: { activo: false, desactivado: true, items: [] } });
      }
      const items = await calcular(sequelize);
      return res.json({ ok: true, data: { activo: items.length > 0, items, tandas: TANDAS, generado: new Date(cache?.at || Date.now()).toISOString() } });
    } catch (err: any) {
      logger.error({ msg: 'bloqueo-documentacion: error armando la lista', err: err?.message || err });
      // si falla no se traba la app (no hay lista que mostrar)
      return res.json({ ok: true, data: { activo: false, items: [], error: 'No se pudo armar la lista' } });
    }
  });

  router.post('/desbloquear', async (req: Request, res: Response) => {
    const userId = (req as any).auth?.principalId ?? null;
    if (!codigoOk(req.body?.codigo)) {
      logger.warn({ msg: 'bloqueo-documentacion: código incorrecto', userId });
      return res.status(403).json({ ok: false, error: 'Código incorrecto' });
    }
    try {
      await ensureTabla(sequelize);
      await sequelize.query(
        `INSERT INTO bloqueo_documentacion_desbloqueos (user_id, ip, pendientes) VALUES (:u, :ip, :n)`,
        { replacements: { u: userId, ip: String(req.ip || '').slice(0, 64), n: cache?.items.length ?? 0 } },
      );
    } catch (err: any) {
      logger.error({ msg: 'bloqueo-documentacion: no pude registrar el desbloqueo', err: err?.message || err });
    }
    return res.json({ ok: true });
  });

  return router;
}
