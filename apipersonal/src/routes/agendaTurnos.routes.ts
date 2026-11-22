// src/routes/agendaTurnos.routes.ts
// Agenda de turnos — pantalla interna (/app/agenda-turnos). Lógica en services/agendaTurnos.ts;
// la página pública del agente la sirve publico/turnosPublicoServer.ts (otro proceso, otro puerto).
//
//  GET    /agenda-turnos/config                    → URL pública + mensaje de WhatsApp por defecto
//  PUT    /agenda-turnos/config
//  GET    /agenda-turnos/agendas                   → agendas + franjas + contadores
//  POST   /agenda-turnos/agendas                   → alta (con franjas)
//  PUT    /agenda-turnos/agendas/:id               → edición (reemplaza franjas si vienen)
//  GET    /agenda-turnos/agendas/:id/grilla?desde&hasta → días/horarios con ocupación (vista oficina)
//  GET    /agenda-turnos/bloqueos?agenda_id        → bloqueos vigentes (de hoy en adelante)
//  POST   /agenda-turnos/bloqueos
//  DELETE /agenda-turnos/bloqueos/:id
//  GET    /agenda-turnos/habilitaciones?agenda_id&estado (estado=REENVIAR: sin usar mandados con otra dirección)
//  POST   /agenda-turnos/habilitaciones/:id/enviado → anota con qué dirección se mandó (WhatsApp / Copiar)
//  GET    /agenda-turnos/tunel?forzar=1          → ¿la página pública se ve desde internet?
//  POST   /agenda-turnos/habilitaciones            → { agenda_id, dnis[], observacion }
//  POST   /agenda-turnos/habilitaciones/:id/anular
//  GET    /agenda-turnos/turnos?agenda_id&desde&hasta
//  POST   /agenda-turnos/turnos                    → carga manual { agenda_id, dni, fecha, hora }
//  PATCH  /agenda-turnos/turnos/:id                → { estado, observaciones }
//  GET    /agenda-turnos/buscar-agente?q=          → DNI o apellido (para habilitar)
//  GET    /agenda-turnos/cola?agenda_id            → cola de envíos por WhatsApp + PCs que están mandando (mig 143)
//  POST   /agenda-turnos/cola                      → encolar { agenda_id, ids[], prueba_destino? } (saltea si ya tiene turno)
//  POST   /agenda-turnos/cola/tomar                → la PC marcada pide el siguiente { pc, version }
//  POST   /agenda-turnos/cola/:id/resultado        → { toma, estado, detalle, destino } (ENVIADO marca la habilitación)
//  POST   /agenda-turnos/cola/:id/reintentar · POST /agenda-turnos/cola/cancelar { agenda_id?, id? }
//  POST   /agenda-turnos/cola/:id/mandar-igual · /atendido → RETENIDO (tenía mensajes sin leer, mig 144)
//  POST   /agenda-turnos/pcs/latido { pc_id, nombre, version, whatsapp, whatsapp_listo } → { manda } · GET /agenda-turnos/pcs · POST /agenda-turnos/pcs/designar { pc_id|null }

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { execFile } from 'child_process';
import path from 'path';
import { logger } from '../logging/logger';
import { celularDe } from './licenciasMedicasControl.routes';
import { ipDe, nombreDeIp, visitasRecientes } from '../services/pcsConectadas';
import {
  AgendaError, ensureAgendaTablas, disponibilidad, habilitar, anularHabilitacion, vencerHabilitaciones,
  reservarInterno, cambiarEstadoTurno, sincronizarCitaciones, normalizarMotivo, MOTIVOS, MOTIVO_OTRO, esFecha, normHora, hoyAR, sumarDias, Franja,
} from '../services/agendaTurnos';

const CONFIG_KEY = 'agenda_turnos';
export const PLANTILLA_DEFAULT = [
  'Hola {NOMBRE}, le escribimos de la Oficina de Personal del Hospital.',
  '',
  'Para sacar su turno de *{AGENDA}* entre a este enlace y elija día y horario:',
  '{LINK}',
  '',
  'El enlace es personal y sirve para un solo turno. Vence el {VENCE}.',
].join('\n');

const txt = (v: any, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const ent = (v: any, def: number, min: number, max: number) => {
  const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const userId = (req: Request): number | null => {
  const a = (req as any).auth;
  return a?.principalType === 'user' || a?.principalType === 'dev' ? Number(a.principalId) || null : null;
};
const userNombre = (req: Request): string | null => {
  const a = (req as any).auth;
  return a?.nombre ? `${a.apellido ?? ''} ${a.nombre}`.trim() : null;
};

function franjasDe(body: any): Franja[] | null {
  if (!Array.isArray(body?.franjas)) return null;
  const out: Franja[] = [];
  for (const f of body.franjas.slice(0, 50)) {
    const d = Number(f?.dia_semana);
    const hd = normHora(f?.hora_desde), hh = normHora(f?.hora_hasta);
    if (!(d >= 0 && d <= 6) || !hd || !hh) throw new AgendaError('Cada franja necesita día, hora desde y hora hasta');
    if (hh <= hd) throw new AgendaError(`Franja ${hd}–${hh}: la hora hasta tiene que ser mayor`);
    out.push({ dia_semana: d, hora_desde: hd, hora_hasta: hh, duracion_min: ent(f?.duracion_min, 20, 5, 480), cupo: ent(f?.cupo, 1, 1, 50) });
  }
  return out;
}

function fallo(res: Response, err: any, donde: string) {
  if (err instanceof AgendaError) return res.status(err.status).json({ ok: false, error: err.message, code: err.code });
  if (err?.original?.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, error: 'Ya existe (dato repetido)' });
  logger.error({ msg: `agenda_turnos ${donde}`, error: err?.message });
  return res.status(500).json({ ok: false, error: err?.message || 'Error' });
}

let citacionesIniciado = false;
/** Turnos → citaciones: cada 30 s (también toma lo que reservan los agentes desde el enlace). */
function iniciarSyncCitaciones(sequelize: Sequelize) {
  if (citacionesIniciado || process.env.NODE_ENV === 'test') return;
  citacionesIniciado = true;
  const correr = () => sincronizarCitaciones(sequelize)
    .then(r => { if (r.creadas || r.cerradas || r.movidas) logger.info({ msg: 'agenda→citaciones', ...r }); })
    .catch(err => logger.error({ msg: 'agenda→citaciones', error: err?.message }));
  setTimeout(correr, 15_000);
  setInterval(correr, 30_000);
}

// ── Chequeo del túnel ──────────────────────────────────────────────────────
// La página pública (publico/turnosPublicoServer.ts) sale a internet por un túnel de Cloudflare. El túnel rápido
// (trycloudflare) se cae cada tanto (13/11, 18/11): se prueba el /health del servidor local y el de la dirección
// pública. Lo muestra la página Agenda de turnos; cada 5 min se vuelve a probar y se anota en el log si cambia.
type CfgTunel = { url_publica: string; url_publica_temporal: boolean; url_publica_desde: string | null };
export type EstadoTunel = {
  estado: 'OK' | 'CAIDO' | 'SERVIDOR_CAIDO' | 'SIN_URL';
  url: string; temporal: boolean; url_desde: string | null;
  local_ok: boolean; publico_ok: boolean | null; detalle: string;
  chequeado_at: string; caido_desde: string | null;
};
let ultimoTunel: EstadoTunel | null = null;
let ultimoTunelMs = 0;
let tunelEnCurso: Promise<EstadoTunel> | null = null;

async function probarHealth(url: string, ms: number): Promise<{ ok: boolean; detalle: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'agenda-turnos-chequeo' } });
    const cuerpo = await r.text().catch(() => '');
    let j: any = null; try { j = JSON.parse(cuerpo); } catch { /* no es JSON: página de error de Cloudflare */ }
    if (r.ok && j?.ok === true) return { ok: true, detalle: 'responde' };
    if (r.status === 530 || /1033|Argo Tunnel error|Cloudflare Tunnel error/i.test(cuerpo)) return { ok: false, detalle: 'Cloudflare no encuentra el túnel (dado de baja)' };
    if (r.status === 502 || r.status === 503 || r.status === 504) return { ok: false, detalle: `el túnel está pero no llega al servidor de turnos (HTTP ${r.status})` };
    return { ok: false, detalle: `respuesta inesperada (HTTP ${r.status})` };
  } catch (err: any) {
    const code = err?.cause?.code || err?.code || err?.name;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { ok: false, detalle: 'la dirección ya no existe (Cloudflare dio de baja el túnel)' };
    if (code === 'TimeoutError' || code === 'AbortError') return { ok: false, detalle: 'no contesta (tiempo agotado)' };
    if (code === 'ECONNREFUSED') return { ok: false, detalle: 'no está corriendo' };
    return { ok: false, detalle: String(err?.cause?.message || err?.message || code || 'error') };
  }
}

export function estadoTunel(leerConfig: () => Promise<CfgTunel>, forzar = false): Promise<EstadoTunel> {
  if (!forzar && ultimoTunel && Date.now() - ultimoTunelMs < 60_000) return Promise.resolve(ultimoTunel);
  if (tunelEnCurso) return tunelEnCurso;
  tunelEnCurso = (async () => {
    const cfg = await leerConfig();
    const url = String(cfg.url_publica || '').trim().replace(/\/+$/, '');
    const port = Number(process.env.TURNOS_PUBLICO_PORT || (process.env.NODE_ENV === 'production' ? 3011 : 3010));
    const local = await probarHealth(`http://127.0.0.1:${port}/health`, 5_000);
    const publico = url ? await probarHealth(`${url}/health`, 15_000) : null;
    const estado: EstadoTunel['estado'] = !url ? 'SIN_URL' : !local.ok ? 'SERVIDOR_CAIDO' : publico?.ok ? 'OK' : 'CAIDO';
    const detalle = !url ? 'No hay dirección pública cargada'
      : !local.ok ? `El servidor de turnos (puerto ${port}) ${local.detalle}`
      : publico?.ok ? 'La página de turnos se ve desde internet'
      : `No se ve desde internet: ${publico?.detalle}`;
    const antes = ultimoTunel;
    const caido = estado !== 'OK';
    const nuevo: EstadoTunel = {
      estado, url, temporal: cfg.url_publica_temporal, url_desde: cfg.url_publica_desde,
      local_ok: local.ok, publico_ok: publico ? publico.ok : null, detalle,
      chequeado_at: new Date().toISOString(),
      caido_desde: caido ? (antes && antes.estado !== 'OK' && antes.url === url && antes.caido_desde ? antes.caido_desde : new Date().toISOString()) : null,
    };
    if (!antes || antes.estado !== nuevo.estado || antes.url !== nuevo.url) {
      (caido ? logger.warn : logger.info).call(logger, { msg: 'agenda_turnos tunel', estado, url, detalle });
    }
    ultimoTunel = nuevo; ultimoTunelMs = Date.now();
    return nuevo;
  })().finally(() => { tunelEnCurso = null; });
  return tunelEnCurso;
}

// ── Relanzar el túnel (botón en la página) ─────────────────────────────────
// Cloudflare a veces da de baja el túnel rápido y cloudflared queda "online" en pm2 reintentando para siempre
// ("Tunnel not found"). Esto reinicia el proceso pm2 del túnel (o lo arranca si no existe): sale una dirección
// nueva que scripts/turnos_tunel.cjs guarda sola en la config. Nombre y comando fijos (nada viene del usuario).
const TUNEL_PM2 = process.env.TURNOS_TUNEL_PM2 || (process.env.NODE_ENV === 'production' ? 'turnos-tunel-prod' : 'turnos-tunel-dev');
let relanzandoTunel = false;
function pm2(args: string[]): Promise<{ ok: boolean; salida: string }> {
  const raiz = path.resolve(__dirname, '..', '..');
  return new Promise(resolve => {
    execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'pm2', ...args],
      { cwd: raiz, timeout: 60_000, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, salida: `${stdout ?? ''}${stderr ?? ''}`.slice(-2000) }));
  });
}
async function relanzarTunel(): Promise<string> {
  const r = await pm2(['restart', TUNEL_PM2]);
  if (r.ok) return 'reiniciado';
  if (!/not found|no se encontr/i.test(r.salida)) throw new Error(`pm2 restart ${TUNEL_PM2} falló: ${r.salida.trim().split('\n').pop()}`);
  // no existe en pm2 (p. ej. dev): se arranca
  const script = path.resolve(__dirname, '..', '..', 'scripts', 'turnos_tunel.cjs');
  const s = await pm2(['start', script, '--name', TUNEL_PM2]);
  if (!s.ok) throw new Error(`pm2 start ${TUNEL_PM2} falló: ${s.salida.trim().split('\n').pop()}`);
  return 'iniciado';
}

let tunelIniciado = false;
function iniciarChequeoTunel(leerConfig: () => Promise<CfgTunel>) {
  if (tunelIniciado || process.env.NODE_ENV === 'test') return;
  tunelIniciado = true;
  const correr = () => estadoTunel(leerConfig, true).catch(err => logger.error({ msg: 'agenda_turnos tunel', error: err?.message }));
  setTimeout(correr, 20_000);
  setInterval(correr, 5 * 60_000);
}

export function buildAgendaTurnosRouter(sequelize: Sequelize): Router {
  const router = Router();
  iniciarSyncCitaciones(sequelize);
  const q = <T extends object = any>(sql: string, replacements: any = {}): Promise<T[]> =>
    sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

  router.use(async (_req, res, next) => {
    try { await ensureAgendaTablas(sequelize); next(); } catch (err) { fallo(res, err, 'ensure'); }
  });

  // ── Config ────────────────────────────────────────────────────────────────
  const leerConfig = async () => {
    const row = (await q<any>(`SELECT config_json FROM app_runtime_config WHERE config_key = :k`, { k: CONFIG_KEY }).catch(() => []))[0];
    const cfg = row?.config_json ? (typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json) : {};
    return {
      url_publica: String(cfg.url_publica ?? process.env.TURNOS_PUBLICO_URL ?? ''), plantilla: cfg.plantilla || PLANTILLA_DEFAULT,
      // la pone scripts/turnos_tunel.cjs (túnel rápido sin dominio): cambia en cada reinicio
      url_publica_temporal: !!cfg.url_publica_temporal && /\.trycloudflare\.com$/i.test(String(cfg.url_publica ?? '')),
      url_publica_desde: cfg.url_publica_desde ?? null,
    };
  };
  iniciarChequeoTunel(leerConfig);

  // ── Reenvío de enlaces (cambió la dirección pública) ───────────────────────
  // Un enlace SIN USAR hay que reenviarlo si se mandó con otra dirección, o (los de antes de 19/11, sin dato
  // de envío) si se creó antes de que la dirección actual empezara a regir.
  const sinBarra = (u: string) => String(u || '').trim().replace(/\/+$/, '');
  const desdeLocal = (iso: string | null) => {           // url_publica_desde (UTC) → hora Argentina (-03, sin horario de verano)
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? new Date(ms - 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : null;
  };
  const reenviarSql = (alias = 'h') => `(${alias}.estado = 'HABILITADO' AND (
      (${alias}.enviado_url IS NOT NULL AND ${alias}.enviado_url <> :urlActual)
   OR (${alias}.enviado_url IS NULL AND :urlDesde IS NOT NULL AND ${alias}.created_at < :urlDesde)))`;
  const reenviarRep = async () => {
    const cfg = await leerConfig();
    return { urlActual: sinBarra(cfg.url_publica), urlDesde: desdeLocal(cfg.url_publica_desde) };
  };

  // ── Estado del túnel (¿la página pública se ve desde internet?) ───────────
  router.get('/tunel', async (req, res) => {
    try { return res.json({ ok: true, data: await estadoTunel(leerConfig, req.query.forzar === '1') }); }
    catch (err) { return fallo(res, err, 'tunel'); }
  });

  // Relanza el túnel y espera (hasta ~40 s) a que guarde la dirección nueva; devuelve el estado probado.
  router.post('/tunel/relanzar', async (req, res) => {
    if (relanzandoTunel) return res.status(409).json({ ok: false, error: 'Ya se está relanzando el túnel, esperá unos segundos' });
    relanzandoTunel = true;
    try {
      const antes = (await leerConfig()).url_publica;
      const accion = await relanzarTunel();
      logger.warn({ msg: 'agenda_turnos tunel relanzado', accion, pm2: TUNEL_PM2, por: userNombre(req) ?? userId(req) });
      let urlNueva = false;
      for (let i = 0; i < 20 && !urlNueva; i++) {
        await new Promise(r => setTimeout(r, 2_000));
        urlNueva = (await leerConfig()).url_publica !== antes;
      }
      if (urlNueva) await new Promise(r => setTimeout(r, 5_000)); // que Cloudflare termine de publicar la dirección
      ultimoTunelMs = 0;
      const estado = await estadoTunel(leerConfig, true);
      return res.json({ ok: true, data: estado, accion, url_nueva: urlNueva });
    } catch (err) { return fallo(res, err, 'tunel relanzar'); }
    finally { relanzandoTunel = false; }
  });

  router.get('/config', async (_req, res) => {
    try { return res.json({ ok: true, data: { ...(await leerConfig()), plantillaDefault: PLANTILLA_DEFAULT, motivos: [...MOTIVOS, MOTIVO_OTRO] } }); }
    catch (err) { return fallo(res, err, 'config get'); }
  });
  router.put('/config', async (req, res) => {
    try {
      const url = String(req.body?.url_publica ?? '').trim().replace(/\/+$/, '');
      const plantilla = String(req.body?.plantilla ?? '').trim();
      if (url && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url)) throw new AgendaError('La URL pública no es válida');
      if (plantilla && !plantilla.includes('{LINK}')) throw new AgendaError('El mensaje tiene que tener {LINK}');
      // se conservan los datos del túnel (url_publica_desde/temporal/anterior): sirven para saber a quién reenviar
      const row = (await q<any>(`SELECT config_json FROM app_runtime_config WHERE config_key = :k`, { k: CONFIG_KEY }).catch(() => []))[0];
      const prev = row?.config_json ? (typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json) || {} : {};
      const cambio = sinBarra(prev.url_publica ?? '') !== url;
      const nuevo = {
        ...prev, url_publica: url, plantilla: plantilla || PLANTILLA_DEFAULT,
        ...(cambio ? {
          url_publica_desde: new Date().toISOString(), url_publica_anterior: prev.url_publica || undefined,
          url_publica_temporal: /\.trycloudflare\.com$/i.test(url),
        } : {}),
      };
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES (:k, :j, :u, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { k: CONFIG_KEY, j: JSON.stringify(nuevo), u: userId(req) } });
      ultimoTunelMs = 0; // que el próximo chequeo pruebe la dirección nueva
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'config put'); }
  });

  // ── Agendas ───────────────────────────────────────────────────────────────
  router.get('/agendas', async (_req, res) => {
    try {
      await vencerHabilitaciones(sequelize);
      const hoy = hoyAR();
      const agendas = await q<any>(
        `SELECT a.*, DATE_FORMAT(a.turnos_desde, '%Y-%m-%d') AS turnos_desde,
                (SELECT COUNT(*) FROM agenda_habilitaciones h WHERE h.agenda_id = a.id AND h.estado = 'HABILITADO') AS habilitados,
                (SELECT COUNT(*) FROM agenda_habilitaciones h WHERE h.agenda_id = a.id AND ${reenviarSql('h')}) AS para_reenviar,
                (SELECT COUNT(*) FROM agenda_turnos t WHERE t.agenda_id = a.id AND t.estado = 'RESERVADO' AND t.fecha >= :hoy) AS proximos,
                (SELECT COUNT(*) FROM agenda_envios_cola c WHERE c.agenda_id = a.id AND c.estado = 'RETENIDO') AS retenidos
           FROM agendas a ORDER BY a.activa DESC, a.nombre`, { hoy, ...(await reenviarRep()) });
      const franjas = await q<any>(
        `SELECT id, agenda_id, dia_semana, TIME_FORMAT(hora_desde, '%H:%i') AS hora_desde, TIME_FORMAT(hora_hasta, '%H:%i') AS hora_hasta,
                duracion_min, cupo FROM agenda_franjas ORDER BY dia_semana, hora_desde`);
      return res.json({ ok: true, data: agendas.map(a => ({ ...a, franjas: franjas.filter(f => f.agenda_id === a.id) })) });
    } catch (err) { return fallo(res, err, 'agendas list'); }
  });

  const guardarAgenda = async (req: Request, id: number | null) => {
    const b = req.body ?? {};
    const nombre = txt(b.nombre, 120);
    if (!nombre) throw new AgendaError('Falta el nombre de la agenda');
    const franjas = franjasDe(b);
    const datos = {
      nombre, descripcion: txt(b.descripcion, 500), lugar: txt(b.lugar, 200),
      anticipacion_dias: ent(b.anticipacion_dias, 1, 0, 60), ventana_dias: ent(b.ventana_dias, 30, 1, 365),
      vence_dias: ent(b.vence_dias, 15, 1, 365), cancelar_horas: ent(b.cancelar_horas, 24, 0, 720),
      carga_jubilacion: b.carga_jubilacion ? 1 : 0, mensaje_whatsapp: txt(b.mensaje_whatsapp, 4000),
      activa: b.activa === undefined ? 1 : (b.activa ? 1 : 0), u: userId(req),
      turnos_desde: /^\d{4}-\d{2}-\d{2}$/.test(String(b.turnos_desde ?? '')) ? String(b.turnos_desde) : null,
      turnos_desde_activo: b.turnos_desde_activo ? 1 : 0,
    };
    if (datos.turnos_desde_activo && !datos.turnos_desde) {
      throw new AgendaError(String(b.turnos_desde ?? '').trim()
        ? `La fecha "Dar turnos a partir del" está mal escrita (${String(b.turnos_desde).slice(0, 12)}): revisá el año`
        : 'Elegí la fecha desde la que se dan turnos');
    }
    if (datos.mensaje_whatsapp && !datos.mensaje_whatsapp.includes('{LINK}')) throw new AgendaError('El mensaje tiene que tener {LINK}');
    return sequelize.transaction(async (t) => {
      let agendaId = id;
      if (agendaId) {
        await sequelize.query(
          `UPDATE agendas SET nombre = :nombre, descripcion = :descripcion, lugar = :lugar, anticipacion_dias = :anticipacion_dias,
                  ventana_dias = :ventana_dias, vence_dias = :vence_dias, cancelar_horas = :cancelar_horas,
                  carga_jubilacion = :carga_jubilacion, mensaje_whatsapp = :mensaje_whatsapp, activa = :activa,
                  turnos_desde = :turnos_desde, turnos_desde_activo = :turnos_desde_activo, updated_by = :u
            WHERE id = :id`, { replacements: { ...datos, id: agendaId }, transaction: t });
      } else {
        const [nid] = await sequelize.query(
          `INSERT INTO agendas (nombre, descripcion, lugar, anticipacion_dias, ventana_dias, vence_dias, cancelar_horas,
                                carga_jubilacion, mensaje_whatsapp, activa, turnos_desde, turnos_desde_activo, created_by)
           VALUES (:nombre, :descripcion, :lugar, :anticipacion_dias, :ventana_dias, :vence_dias, :cancelar_horas,
                   :carga_jubilacion, :mensaje_whatsapp, :activa, :turnos_desde, :turnos_desde_activo, :u)`, { replacements: datos, transaction: t });
        agendaId = Number(nid);
      }
      if (franjas) {
        await sequelize.query(`DELETE FROM agenda_franjas WHERE agenda_id = :id`, { replacements: { id: agendaId }, transaction: t });
        for (const f of franjas) {
          await sequelize.query(
            `INSERT INTO agenda_franjas (agenda_id, dia_semana, hora_desde, hora_hasta, duracion_min, cupo)
             VALUES (:a, :d, :hd, :hh, :dur, :cupo)`,
            { replacements: { a: agendaId, d: f.dia_semana, hd: f.hora_desde, hh: f.hora_hasta, dur: f.duracion_min, cupo: f.cupo }, transaction: t });
        }
      }
      return agendaId;
    });
  };
  router.post('/agendas', async (req, res) => {
    try { return res.json({ ok: true, id: await guardarAgenda(req, null) }); }
    catch (err) { return fallo(res, err, 'agendas post'); }
  });
  router.put('/agendas/:id(\\d+)', async (req, res) => {
    try { return res.json({ ok: true, id: await guardarAgenda(req, Number(req.params.id)) }); }
    catch (err) { return fallo(res, err, 'agendas put'); }
  });

  router.get('/agendas/:id(\\d+)/grilla', async (req, res) => {
    try {
      const hoy = hoyAR();
      const desde = esFecha(req.query.desde) ? String(req.query.desde) : hoy;
      const hasta = esFecha(req.query.hasta) ? String(req.query.hasta) : sumarDias(desde, 13);
      const dias = await disponibilidad(sequelize, Number(req.params.id), { desde, hasta, sinVentana: true });
      return res.json({ ok: true, data: dias });
    } catch (err) { return fallo(res, err, 'grilla'); }
  });

  // ── Bloqueos ──────────────────────────────────────────────────────────────
  router.get('/bloqueos', async (req, res) => {
    try {
      const agendaId = Number(req.query.agenda_id) || null;
      const rows = await q<any>(
        `SELECT b.id, b.agenda_id, a.nombre AS agenda_nombre,
                DATE_FORMAT(b.fecha_desde, '%Y-%m-%d') AS fecha_desde, DATE_FORMAT(b.fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
                TIME_FORMAT(b.hora_desde, '%H:%i') AS hora_desde, TIME_FORMAT(b.hora_hasta, '%H:%i') AS hora_hasta, b.motivo
           FROM agenda_bloqueos b LEFT JOIN agendas a ON a.id = b.agenda_id
          WHERE b.deleted_at IS NULL AND b.fecha_hasta >= :hoy
            ${agendaId ? 'AND (b.agenda_id IS NULL OR b.agenda_id = :agendaId)' : ''}
          ORDER BY b.fecha_desde, b.hora_desde`, { hoy: hoyAR(), agendaId });
      return res.json({ ok: true, data: rows });
    } catch (err) { return fallo(res, err, 'bloqueos list'); }
  });
  router.post('/bloqueos', async (req, res) => {
    try {
      const b = req.body ?? {};
      const fd = esFecha(b.fecha_desde) ? b.fecha_desde : null;
      const fh = esFecha(b.fecha_hasta) ? b.fecha_hasta : fd;
      if (!fd || !fh || fh < fd) throw new AgendaError('Revisá las fechas del bloqueo');
      const hd = b.hora_desde ? normHora(b.hora_desde) : null;
      const hh = b.hora_hasta ? normHora(b.hora_hasta) : null;
      if ((hd && !hh) || (!hd && hh) || (hd && hh && hh <= hd)) throw new AgendaError('Revisá las horas del bloqueo (o dejalas vacías para el día entero)');
      const [id] = await sequelize.query(
        `INSERT INTO agenda_bloqueos (agenda_id, fecha_desde, fecha_hasta, hora_desde, hora_hasta, motivo, created_by)
         VALUES (:a, :fd, :fh, :hd, :hh, :m, :u)`,
        { replacements: { a: Number(b.agenda_id) || null, fd, fh, hd, hh, m: txt(b.motivo, 200), u: userId(req) } });
      // Los turnos ya tomados en el bloqueo NO se cancelan solos: se avisan para que la oficina decida
      const afectados = await q<any>(
        `SELECT t.id, t.dni, p.apellido, p.nombre, DATE_FORMAT(t.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(t.hora, '%H:%i') AS hora
           FROM agenda_turnos t JOIN personal p ON p.dni = t.dni
          WHERE t.estado = 'RESERVADO' AND t.fecha BETWEEN :fd AND :fh
            ${Number(b.agenda_id) ? 'AND t.agenda_id = :a' : ''}
            ${hd ? 'AND t.hora >= :hd AND t.hora < :hh' : ''}
          ORDER BY t.fecha, t.hora`, { fd, fh, a: Number(b.agenda_id) || null, hd, hh });
      return res.json({ ok: true, id: Number(id), afectados });
    } catch (err) { return fallo(res, err, 'bloqueos post'); }
  });
  router.delete('/bloqueos/:id(\\d+)', async (req, res) => {
    try {
      await sequelize.query(`UPDATE agenda_bloqueos SET deleted_at = NOW(), deleted_by = :u WHERE id = :id AND deleted_at IS NULL`,
        { replacements: { id: Number(req.params.id), u: userId(req) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'bloqueos delete'); }
  });

  // ── Habilitaciones ────────────────────────────────────────────────────────
  router.get('/habilitaciones', async (req, res) => {
    try {
      await vencerHabilitaciones(sequelize);
      const agendaId = Number(req.query.agenda_id);
      if (!agendaId) throw new AgendaError('Falta la agenda');
      const estado = String(req.query.estado ?? '').toUpperCase();
      const rows = await q<any>(
        `SELECT h.id, h.dni, p.apellido, p.nombre, p.telefono, h.token, h.estado, h.observacion, COALESCE(t.motivo, h.motivo) AS motivo,
                DATE_FORMAT(h.vence_el, '%Y-%m-%d') AS vence_el, h.created_at, h.usado_at,
                h.enviado_at, h.envios, ${reenviarSql('h')} AS reenviar,
                DATE_FORMAT(t.fecha, '%Y-%m-%d') AS turno_fecha, TIME_FORMAT(t.hora, '%H:%i') AS turno_hora, t.estado AS turno_estado,
                (SELECT CONCAT(DATE_FORMAT(tv.fecha, '%d/%m'), ' ', TIME_FORMAT(tv.hora, '%H:%i')) FROM agenda_turnos tv
                  WHERE tv.dni = h.dni AND tv.estado = 'RESERVADO' AND tv.fecha >= :hoy ORDER BY tv.fecha, tv.hora LIMIT 1) AS turno_vigente
           FROM agenda_habilitaciones h
           JOIN personal p ON p.dni = h.dni
           LEFT JOIN agenda_turnos t ON t.id = h.turno_id
          WHERE h.agenda_id = :a
                ${estado === 'REENVIAR' ? `AND ${reenviarSql('h')}` : ['HABILITADO', 'USADO', 'VENCIDO', 'ANULADO'].includes(estado) ? 'AND h.estado = :estado' : ''}
          ORDER BY ${estado === 'REENVIAR' ? 'p.apellido, p.nombre' : 'h.created_at DESC'} LIMIT 1000`, { a: agendaId, estado, hoy: hoyAR(), ...(await reenviarRep()) });
      return res.json({ ok: true, data: rows.map(r => ({ ...r, reenviar: !!Number(r.reenviar), ...celularDe(r.telefono), token: r.estado === 'HABILITADO' || r.estado === 'USADO' ? r.token : null })) });
    } catch (err) { return fallo(res, err, 'habilitaciones list'); }
  });
  // la oficina tocó WhatsApp / Copiar mensaje: se anota con qué dirección salió (para saber a quién reenviar si cambia)
  router.post('/habilitaciones/:id(\\d+)/enviado', async (req, res) => {
    try {
      const url = sinBarra(String(req.body?.url ?? '')) || sinBarra((await leerConfig()).url_publica);
      if (!url) throw new AgendaError('Falta la dirección pública');
      await sequelize.query(
        `UPDATE agenda_habilitaciones SET enviado_url = :url, enviado_at = NOW(), envios = envios + 1 WHERE id = :id`,
        { replacements: { url: url.slice(0, 255), id: Number(req.params.id) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'enviado'); }
  });
  router.post('/habilitaciones', async (req, res) => {
    try {
      const b = req.body ?? {};
      const dnis = (Array.isArray(b.dnis) ? b.dnis : [b.dni]).map((d: any) => Number(String(d ?? '').replace(/\D/g, ''))).filter((d: number) => d > 0);
      if (!dnis.length) throw new AgendaError('Falta el DNI');
      if (dnis.length > 500) throw new AgendaError('Máximo 500 por vez');
      // motivo opcional: si la oficina no lo elige, lo elige el agente en su enlace
      const r = await habilitar(sequelize, Number(b.agenda_id), dnis, userId(req), txt(b.observacion, 300), normalizarMotivo(b.motivo, b.motivo_otro, false));
      return res.json({ ok: true, data: r });
    } catch (err) { return fallo(res, err, 'habilitar'); }
  });
  router.post('/habilitaciones/:id(\\d+)/anular', async (req, res) => {
    try { await anularHabilitacion(sequelize, Number(req.params.id), userId(req)); return res.json({ ok: true }); }
    catch (err) { return fallo(res, err, 'anular'); }
  });

  // ── Cola de envíos por WhatsApp (mig 143) ────────────────────────────────
  // El servidor no tiene WhatsApp: la oficina encola y los manda la PC marcada ("Esta PC manda los mensajes
  // de la agenda", componente EnvioAgendaAutomatico en el Layout) con la extensión. Antes de entregar cada
  // mensaje se vuelve a revisar que el enlace siga sin usar y que la persona no tenga ya un turno reservado.
  const tc = (s: string) => String(s || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()).trim();
  const fmtF = (f?: string | null) => (f ? String(f).slice(0, 10).split('-').reverse().join('/') : '');
  const REENVIO_TXT = 'Le reenviamos el enlace para sacar su turno porque el anterior dejó de funcionar.\n\n';
  const armarMensaje = (r: any, url: string, plantilla: string) =>
    (Number(r.reenviar) ? REENVIO_TXT : '') + (r.mensaje_whatsapp || plantilla)
      .replace(/\{NOMBRE\}/g, tc(r.nombre))
      .replace(/\{APELLIDO\}/g, tc(r.apellido))
      .replace(/\{AGENDA\}/g, r.motivo || r.agenda_nombre)
      .replace(/\{MOTIVO\}/g, r.motivo || '')
      .replace(/\{VENCE\}/g, fmtF(r.vence_el))
      .replace(/\{LINK\}/g, `${url}/t/${r.token}`);
  const celularPrueba = (s: any) => {
    const d = String(s ?? '').replace(/\D/g, '');
    if (d.startsWith('549') && d.length === 13) return d;
    if (d.startsWith('54') && d.length === 12) return `549${d.slice(2)}`;
    if (d.length === 10) return `549${d}`;
    return d;
  };
  /** ¿Tiene ya un turno reservado de hoy en adelante? (cualquier agenda) */
  const turnoVigente = async (dni: number) => (await q<any>(
    `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(hora, '%H:%i') AS hora, motivo
       FROM agenda_turnos WHERE dni = :dni AND estado = 'RESERVADO' AND fecha >= :hoy ORDER BY fecha, hora LIMIT 1`,
    { dni, hoy: hoyAR() }))[0] ?? null;
  const yaTieneTurno = (t: any) => `ya tiene turno el ${fmtF(t.fecha)} a las ${t.hora}${t.motivo ? ` (${t.motivo})` : ''}`;
  /** PCs que están mandando (se anotan cada vez que piden el siguiente mensaje). */
  const pcsVistas = new Map<string, { at: number; version: string | null; pausa: string | null }>();

  // ── PCs conectadas + cuál manda ──────────────────────────────────────────
  // Cada PC con la app abierta avisa cada minuto (EnvioAgendaAutomatico en el Layout): nombre, usuario,
  // versión de la extensión y si tiene WhatsApp Web abierto. La PC que manda se elige desde cualquier PC
  // ("Que mande esta") y queda guardada en la config (sobrevive reinicios); esa PC se entera en su próximo aviso.
  type PcConectada = { id: string; nombre: string; usuario: string | null; version: string | null; whatsapp: boolean | null; whatsapp_listo: boolean | null; at: number; ip: string };
  const pcsConectadas = new Map<string, PcConectada>();
  const emailUsuario = new Map<number, string | null>();
  const usuarioDe = async (req: Request) => usuarioPorId(userId(req));
  const usuarioPorId = async (id: number | null) => {
    if (!id) return null;
    if (!emailUsuario.has(id)) {
      const [u] = await q<any>(`SELECT email FROM usuarios WHERE id = :id`, { id }).catch(() => []);
      emailUsuario.set(id, u?.email ? String(u.email).split('@')[0] : `usuario ${id}`);
    }
    return emailUsuario.get(id) ?? null;
  };
  const leerCfgCruda = async () => {
    const row = (await q<any>(`SELECT config_json FROM app_runtime_config WHERE config_key = :k`, { k: CONFIG_KEY }).catch(() => []))[0];
    return row?.config_json ? (typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json) || {} : {};
  };
  let pcEnvioCache: { id: string; nombre: string } | null | undefined;
  const pcEnvio = async (): Promise<{ id: string; nombre: string } | null> => {
    if (pcEnvioCache === undefined) pcEnvioCache = (await leerCfgCruda()).pc_envio ?? null;
    return pcEnvioCache ?? null;
  };
  const guardarPcEnvio = async (v: { id: string; nombre: string; por: string | null; at: string } | null, req: Request) => {
    const cfg = await leerCfgCruda();
    cfg.pc_envio = v;
    await sequelize.query(
      `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
       VALUES (:k, :j, :u, NOW(), NOW())
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
      { replacements: { k: CONFIG_KEY, j: JSON.stringify(cfg), u: userId(req) } });
    pcEnvioCache = v ? { id: v.id, nombre: v.nombre } : null;
  };
  const idPc = (v: any) => (/^[A-Za-z0-9-]{6,40}$/.test(String(v ?? '')) ? String(v) : null);

  router.post('/pcs/latido', async (req, res) => {
    try {
      const id = idPc(req.body?.pc_id);
      if (!id) throw new AgendaError('Falta el id de la PC');
      const b = req.body ?? {};
      pcsConectadas.set(id, {
        id, ip: ipDe(req), nombre: txt(b.nombre, 60) || 'PC sin nombre', usuario: await usuarioDe(req), version: txt(b.version, 20),
        whatsapp: typeof b.whatsapp === 'boolean' ? b.whatsapp : null, whatsapp_listo: typeof b.whatsapp_listo === 'boolean' ? b.whatsapp_listo : null,
        at: Date.now(),
      });
      const pc = await pcEnvio();
      return res.json({ ok: true, data: { manda: pc?.id === id, hay_designada: !!pc, red: await nombreDeIp(ipDe(req)) } });
    } catch (err) { return fallo(res, err, 'pcs latido'); }
  });
  router.get('/pcs', async (req, res) => {
    try {
      const ahora = Date.now();
      for (const [k, v] of pcsConectadas) if (ahora - v.at > 30 * 60_000) pcsConectadas.delete(k);
      const pc = await pcEnvio();
      const conLatido = await Promise.all([...pcsConectadas.values()].map(async p => ({
        ...p, red: p.ip ? await nombreDeIp(p.ip) : null, segundos: Math.round((ahora - p.at) / 1000), manda: p.id === pc?.id, app_vieja: false, at: undefined,
      })));
      // PCs que piden cosas a la API pero no avisan: tienen abierta una versión vieja de la app (hay que recargarla)
      const ipsConLatido = new Set(conLatido.filter(p => p.segundos < 180).map(p => p.ip));
      // horas: 1 (por defecto), 24 o 48 → también las PCs que usaron la app en ese lapso (tabla pcs_visitas)
      const horas = [1, 24, 48].includes(Number(req.query.horas)) ? Number(req.query.horas) : 1;
      const sinLatido = await Promise.all((await visitasRecientes(horas * 3600_000)).filter(v => !ipsConLatido.has(v.ip)).map(async v => {
        const red = await nombreDeIp(v.ip);
        const segundos = Math.round((ahora - v.at) / 1000);
        return {
          id: `ip:${v.ip}`, ip: v.ip, red, nombre: red || v.ip, usuario: await usuarioPorId(v.userId), version: null,
          whatsapp: null, whatsapp_listo: null, segundos, manda: false,
          app_vieja: segundos < 600,      // pidió algo hace poco pero no avisa → app de antes del deploy
          inactiva: segundos >= 600,      // usó la app en el lapso elegido, ahora no
          pedidos: v.pedidos, primer: v.primer ? new Date(v.primer).toISOString() : null,
        };
      }));
      const lista = [...conLatido, ...sinLatido]
        .sort((a: any, b: any) => Number(b.manda) - Number(a.manda) || Number(!!a.inactiva) - Number(!!b.inactiva) || Number(a.app_vieja) - Number(b.app_vieja)
          || Number(!!b.whatsapp_listo) - Number(!!a.whatsapp_listo) || a.segundos - b.segundos);
      return res.json({ ok: true, data: { pcs: lista, manda: pc } });
    } catch (err) { return fallo(res, err, 'pcs list'); }
  });
  // { pc_id } elige la PC que manda; { pc_id: null } = ninguna
  router.post('/pcs/designar', async (req, res) => {
    try {
      const id = req.body?.pc_id === null ? null : idPc(req.body?.pc_id);
      if (req.body?.pc_id !== null && !id) throw new AgendaError('PC inválida');
      const nombre = id ? (pcsConectadas.get(id)?.nombre ?? txt(req.body?.nombre, 60) ?? 'PC') : '';
      await guardarPcEnvio(id ? { id, nombre, por: await usuarioDe(req), at: new Date().toISOString() } : null, req);
      logger.info({ msg: 'agenda cola: PC que manda', pc: id ? nombre : null, por: await usuarioDe(req) });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'pcs designar'); }
  });

  router.get('/cola', async (req, res) => {
    try {
      const agendaId = Number(req.query.agenda_id) || 0;
      const rows = await q<any>(
        `SELECT c.id, c.habilitacion_id, c.dni, p.apellido, p.nombre, c.estado, c.prueba_destino, c.celular, c.pc, c.detalle,
                c.intentos, c.created_at, c.tomado_at, c.terminado_at, c.sin_leer, c.sin_leer_json, c.forzar
           FROM agenda_envios_cola c JOIN personal p ON p.dni = c.dni
          WHERE (:a = 0 OR c.agenda_id = :a)
            AND (c.estado IN ('PENDIENTE','TOMADO','RETENIDO') OR c.created_at >= DATE_SUB(NOW(), INTERVAL 2 DAY))
          ORDER BY FIELD(c.estado, 'RETENIDO', 'TOMADO', 'PENDIENTE', 'ERROR', 'SALTEADO', 'ENVIADO', 'CANCELADO'), c.id DESC
          LIMIT 300`, { a: agendaId });
      const ahora = Date.now();
      const pcs = [...pcsVistas.entries()]
        .map(([nombre, v]) => ({ nombre, segundos: Math.round((ahora - v.at) / 1000), version: v.version, pausa: v.pausa }))
        .filter(p => p.segundos < 3600).sort((a, b) => a.segundos - b.segundos);
      const filas = rows.map(r => {
        let mensajes: any[] = [];
        try { mensajes = r.sin_leer_json ? JSON.parse(r.sin_leer_json) : []; } catch { /* noop */ }
        const { sin_leer_json: _j, ...resto } = r;
        return { ...resto, forzar: !!Number(r.forzar), mensajes };
      });
      return res.json({ ok: true, data: { filas, pcs } });
    } catch (err) { return fallo(res, err, 'cola list'); }
  });

  // encolar: { agenda_id, ids: habilitacion_id[], prueba_destino? }
  router.post('/cola', async (req, res) => {
    try {
      const b = req.body ?? {};
      const agendaId = Number(b.agenda_id);
      const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n: number) => n > 0))] as number[];
      if (!agendaId || !ids.length) throw new AgendaError('No hay nada para mandar');
      if (ids.length > 500) throw new AgendaError('Máximo 500 por vez');
      const prueba = b.prueba_destino ? celularPrueba(b.prueba_destino) : null;
      if (b.prueba_destino && (!prueba || prueba.length < 12)) throw new AgendaError('El número de prueba no es válido');
      const habs = await q<any>(
        `SELECT h.id, h.dni, h.estado, p.apellido, p.nombre, p.telefono,
                (SELECT MAX(c.estado) FROM agenda_envios_cola c WHERE c.habilitacion_id = h.id AND c.estado IN ('PENDIENTE','TOMADO','RETENIDO')) AS en_cola
           FROM agenda_habilitaciones h JOIN personal p ON p.dni = h.dni
          WHERE h.agenda_id = :a AND h.id IN (:ids)`, { a: agendaId, ids });
      let encolados = 0;
      const salteados: { dni: number; apellido: string; nombre: string; motivo: string }[] = [];
      for (const h of habs) {
        const saltar = (motivo: string) => salteados.push({ dni: h.dni, apellido: h.apellido, nombre: h.nombre, motivo });
        if (h.estado !== 'HABILITADO') { saltar(`el enlace está ${String(h.estado).toLowerCase()}`); continue; }
        if (h.en_cola) { saltar(h.en_cola === 'RETENIDO' ? 'retenido: tenía mensajes sin leer (resolvelo en la cola)' : 'ya está en la cola'); continue; }
        if (!prueba && !celularDe(h.telefono).celular) { saltar('sin celular en la base'); continue; }
        const t = await turnoVigente(Number(h.dni));
        if (t) { saltar(yaTieneTurno(t)); continue; }
        await sequelize.query(
          `INSERT INTO agenda_envios_cola (habilitacion_id, agenda_id, dni, prueba_destino, created_by) VALUES (:h, :a, :dni, :p, :u)`,
          { replacements: { h: h.id, a: agendaId, dni: h.dni, p: prueba, u: userId(req) } });
        encolados++;
      }
      return res.json({ ok: true, data: { encolados, salteados, no_encontrados: ids.length - habs.length } });
    } catch (err) { return fallo(res, err, 'cola post'); }
  });

  // La PC marcada pide el siguiente: { pc, version } → { item } | { item: null, pausa? }
  router.post('/cola/tomar', async (req, res) => {
    try {
      const pc = txt(req.body?.pc, 60) || 'PC sin nombre';
      const version = txt(req.body?.version, 20);
      const anotar = (pausa: string | null) => pcsVistas.set(pc, { at: Date.now(), version, pausa });
      // una sola PC manda: la elegida en "PCs conectadas" (si hay una elegida)
      const elegida = await pcEnvio();
      if (elegida && idPc(req.body?.pc_id) !== elegida.id) {
        return res.json({ ok: true, data: null, no_designada: true, pausa: `Manda otra PC: ${elegida.nombre}` });
      }
      if (req.body?.sin_extension) { anotar('la extensión de WhatsApp no responde en esa PC'); return res.json({ ok: true, data: null }); }
      if (req.body?.ext_vieja) { anotar(`extensión vieja (${version ?? '?'}): se está actualizando sola`); return res.json({ ok: true, data: null }); }
      anotar(null);
      // tomados que quedaron colgados (se cerró la PC a mitad de envío) → vuelven a la cola
      await sequelize.query(`UPDATE agenda_envios_cola SET estado = 'PENDIENTE', toma = NULL
                              WHERE estado = 'TOMADO' AND tomado_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`);
      const [{ n }] = await q<any>(`SELECT COUNT(*) AS n FROM agenda_envios_cola WHERE estado = 'PENDIENTE'`);
      if (!Number(n)) return res.json({ ok: true, data: null });
      const cfg = await leerConfig();
      const url = sinBarra(cfg.url_publica);
      if (!url) { anotar('falta la dirección pública'); return res.json({ ok: true, data: null, pausa: 'Falta la dirección pública' }); }
      const tunel = await estadoTunel(leerConfig);
      if (tunel.estado !== 'OK') {
        anotar(`túnel caído: ${tunel.detalle}`);
        return res.json({ ok: true, data: null, pausa: `Túnel caído: ${tunel.detalle}` });
      }
      const rep = await reenviarRep();
      for (let i = 0; i < 50; i++) {
        const toma = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        await sequelize.query(
          `UPDATE agenda_envios_cola SET estado = 'TOMADO', toma = :toma, pc = :pc, tomado_at = NOW(), intentos = intentos + 1, detalle = NULL
            WHERE estado = 'PENDIENTE' ORDER BY id LIMIT 1`, { replacements: { toma, pc } });
        const [c] = await q<any>(
          `SELECT c.id, c.prueba_destino, c.forzar, h.estado AS hab_estado, h.token, h.motivo, DATE_FORMAT(h.vence_el, '%Y-%m-%d') AS vence_el,
                  ${reenviarSql('h')} AS reenviar, p.dni, p.apellido, p.nombre, p.telefono, a.nombre AS agenda_nombre, a.mensaje_whatsapp
             FROM agenda_envios_cola c
             JOIN agenda_habilitaciones h ON h.id = c.habilitacion_id
             JOIN agendas a ON a.id = c.agenda_id
             JOIN personal p ON p.dni = c.dni
            WHERE c.toma = :toma`, { toma, ...rep });
        if (!c) return res.json({ ok: true, data: null });
        const saltear = (detalle: string) => sequelize.query(
          `UPDATE agenda_envios_cola SET estado = 'SALTEADO', detalle = :d, terminado_at = NOW() WHERE id = :id`,
          { replacements: { d: detalle.slice(0, 500), id: c.id } });
        if (c.hab_estado !== 'HABILITADO') { await saltear(`el enlace ya está ${String(c.hab_estado).toLowerCase()}`); continue; }
        const t = await turnoVigente(Number(c.dni));
        if (t) { await saltear(yaTieneTurno(t)); continue; }
        const celular = c.prueba_destino || celularDe(c.telefono).celular;
        if (!celular) { await saltear('sin celular en la base'); continue; }
        await sequelize.query(`UPDATE agenda_envios_cola SET celular = :cel, url_usada = :url WHERE id = :id`,
          { replacements: { cel: celular, url, id: c.id } });
        return res.json({
          ok: true,
          data: {
            id: c.id, toma, dni: c.dni, apellido: c.apellido, nombre: c.nombre, celular, prueba: !!c.prueba_destino,
            // antes de mandar, la PC revisa si el AGENTE (su número real, también en prueba) tenía mensajes sin leer
            revisar_sin_leer: Number(c.forzar) ? null : celularDe(c.telefono).celular,
            texto: (c.prueba_destino ? `[PRUEBA - era para ${c.apellido} ${c.nombre}]\n\n` : '') + armarMensaje(c, url, cfg.plantilla),
          },
        });
      }
      return res.json({ ok: true, data: null });
    } catch (err) { return fallo(res, err, 'cola tomar'); }
  });

  // Resultado de la PC: { toma, estado: 'ENVIADO'|..., detalle, destino }
  router.post('/cola/:id(\\d+)/resultado', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [c] = await q<any>(`SELECT * FROM agenda_envios_cola WHERE id = :id AND toma = :toma AND estado = 'TOMADO'`,
        { id, toma: String(req.body?.toma ?? '') });
      if (!c) throw new AgendaError('Ese envío ya no está tomado por esta PC', 409);
      if (String(req.body?.estado ?? '').toUpperCase() === 'SIN_LEER') {
        const n = Number(req.body?.sin_leer) || 0;
        const mensajes = (Array.isArray(req.body?.mensajes) ? req.body.mensajes : []).slice(0, 15).map((m: any) => ({
          t: Number(m?.t) || null, tipo: String(m?.tipo ?? '').slice(0, 30), texto: String(m?.texto ?? '').slice(0, 1000),
        }));
        await sequelize.query(
          `UPDATE agenda_envios_cola SET estado = 'RETENIDO', sin_leer = :n, sin_leer_json = :j, terminado_at = NOW(),
                  detalle = :d WHERE id = :id`,
          { replacements: { n, j: JSON.stringify(mensajes), id,
            d: n === -1 ? 'no se mandó: el chat estaba marcado como no leído' : `no se mandó: tenía ${n} mensaje${n === 1 ? '' : 's'} sin leer` } });
        logger.info({ msg: 'agenda cola retenido por sin leer', id, dni: c.dni, sin_leer: n });
        return res.json({ ok: true });
      }
      const ok = String(req.body?.estado ?? '').toUpperCase() === 'ENVIADO';
      const detalle = ok ? (txt(req.body?.destino, 200) ? `a ${txt(req.body?.destino, 200)}` : null)
        : `${String(req.body?.estado || 'ERROR')}${req.body?.detalle ? `: ${String(req.body.detalle)}` : ''}`.slice(0, 500);
      await sequelize.query(
        `UPDATE agenda_envios_cola SET estado = :e, detalle = :d, terminado_at = NOW() WHERE id = :id`,
        { replacements: { e: ok ? 'ENVIADO' : 'ERROR', d: detalle, id } });
      if (ok && !c.prueba_destino) {
        await sequelize.query(
          `UPDATE agenda_habilitaciones SET enviado_url = :url, enviado_at = NOW(), envios = envios + 1 WHERE id = :h`,
          { replacements: { url: c.url_usada, h: c.habilitacion_id } });
      }
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'cola resultado'); }
  });

  router.post('/cola/:id(\\d+)/reintentar', async (req, res) => {
    try {
      await sequelize.query(
        `UPDATE agenda_envios_cola SET estado = 'PENDIENTE', toma = NULL, detalle = NULL, terminado_at = NULL
          WHERE id = :id AND estado IN ('ERROR','SALTEADO','CANCELADO')`, { replacements: { id: Number(req.params.id) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'cola reintentar'); }
  });
  // Retenido por mensajes sin leer → la oficina decide
  router.post('/cola/:id(\\d+)/mandar-igual', async (req, res) => {
    try {
      await sequelize.query(
        `UPDATE agenda_envios_cola SET estado = 'PENDIENTE', forzar = 1, toma = NULL, terminado_at = NULL,
                detalle = CONCAT('mandar igual (', COALESCE(:u, 'oficina'), ')')
          WHERE id = :id AND estado = 'RETENIDO'`, { replacements: { id: Number(req.params.id), u: userNombre(req) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'cola mandar igual'); }
  });
  router.post('/cola/:id(\\d+)/atendido', async (req, res) => {
    try {
      await sequelize.query(
        `UPDATE agenda_envios_cola SET estado = 'CANCELADO', terminado_at = NOW(),
                detalle = CONCAT('tenía mensajes sin leer: lo atendió ', COALESCE(:u, 'la oficina'), ' (no se mandó el enlace)')
          WHERE id = :id AND estado = 'RETENIDO'`, { replacements: { id: Number(req.params.id), u: userNombre(req) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'cola atendido'); }
  });
  router.post('/cola/cancelar', async (req, res) => {
    try {
      const agendaId = Number(req.body?.agenda_id) || 0;
      const id = Number(req.body?.id) || 0;
      const [, meta]: any = await sequelize.query(
        `UPDATE agenda_envios_cola SET estado = 'CANCELADO', detalle = 'cancelado por la oficina', terminado_at = NOW()
          WHERE estado = 'PENDIENTE' AND (:a = 0 OR agenda_id = :a) AND (:id = 0 OR id = :id)`, { replacements: { a: agendaId, id } });
      return res.json({ ok: true, cancelados: Number(meta?.affectedRows ?? meta ?? 0) });
    } catch (err) { return fallo(res, err, 'cola cancelar'); }
  });

  // ── Turnos ────────────────────────────────────────────────────────────────
  router.get('/turnos', async (req, res) => {
    try {
      const agendaId = Number(req.query.agenda_id);
      if (!agendaId) throw new AgendaError('Falta la agenda');
      const desde = esFecha(req.query.desde) ? String(req.query.desde) : hoyAR();
      const hasta = esFecha(req.query.hasta) ? String(req.query.hasta) : sumarDias(desde, 30);
      const rows = await q<any>(
        `SELECT t.id, t.dni, p.apellido, p.nombre, p.telefono, DATE_FORMAT(t.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(t.hora, '%H:%i') AS hora,
                t.estado, t.origen, t.motivo, t.telefono_contacto, t.observaciones, t.cancelado_por, t.jubilacion_cita_id, t.created_at
           FROM agenda_turnos t JOIN personal p ON p.dni = t.dni
          WHERE t.agenda_id = :a AND t.fecha BETWEEN :desde AND :hasta
          ORDER BY t.fecha, t.hora, t.lugar`, { a: agendaId, desde, hasta });
      return res.json({ ok: true, data: rows });
    } catch (err) { return fallo(res, err, 'turnos list'); }
  });
  router.post('/turnos', async (req, res) => {
    try {
      const b = req.body ?? {};
      const id = await reservarInterno(sequelize, Number(b.agenda_id), Number(b.dni), b.fecha, b.hora, txt(b.observaciones, 500), userId(req), userNombre(req),
        normalizarMotivo(b.motivo, b.motivo_otro, true) as string);
      return res.json({ ok: true, id });
    } catch (err) { return fallo(res, err, 'turnos post'); }
  });
  router.patch('/turnos/:id(\\d+)', async (req, res) => {
    try {
      await cambiarEstadoTurno(sequelize, Number(req.params.id), String(req.body?.estado ?? '').toUpperCase(), userId(req), txt(req.body?.observaciones, 500));
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'turnos patch'); }
  });

  // ── Google Calendar (lo sincroniza scripts/google_calendar_turnos.py) ─────
  router.get('/gcal', async (req, res) => {
    try {
      const agendaId = Number(req.query.agenda_id);
      if (!agendaId) throw new AgendaError('Falta la agenda');
      const desde = esFecha(req.query.desde) ? String(req.query.desde) : hoyAR();
      const hasta = esFecha(req.query.hasta) ? String(req.query.hasta) : sumarDias(desde, 30);
      const [ag] = await q<any>(
        `SELECT a.gcal_calendar_id, s.ultimo_ok, s.ultimo_error,
                (SELECT COUNT(*) FROM agenda_turnos t WHERE t.agenda_id = a.id AND t.gcal_pendiente = 1) AS pendientes,
                (SELECT COUNT(*) FROM agenda_turnos t WHERE t.agenda_id = a.id AND t.gcal_error IS NOT NULL AND t.gcal_pendiente = 1) AS con_error,
                (SELECT MAX(r.actualizado_at) FROM script_runs r WHERE r.script = 'google_calendar_turnos') AS ultima_corrida
           FROM agendas a LEFT JOIN gcal_sync s ON s.calendar_id = a.gcal_calendar_id
          WHERE a.id = :a`, { a: agendaId }).catch(async () => q<any>(
        `SELECT a.gcal_calendar_id, s.ultimo_ok, s.ultimo_error, 0 AS pendientes, 0 AS con_error, NULL AS ultima_corrida
           FROM agendas a LEFT JOIN gcal_sync s ON s.calendar_id = a.gcal_calendar_id WHERE a.id = :a`, { a: agendaId }));
      const eventos = await q<any>(
        `SELECT e.id, e.origen, e.turno_id, e.dni, e.titulo, e.descripcion, e.ubicacion, e.todo_el_dia, e.estado, e.creador,
                DATE_FORMAT(e.inicio, '%Y-%m-%d %H:%i') AS inicio, DATE_FORMAT(e.fin, '%Y-%m-%d %H:%i') AS fin,
                p.apellido, p.nombre,
                (SELECT COUNT(*) FROM agenda_turnos t
                  WHERE e.origen = 'MANUAL' AND t.agenda_id = e.agenda_id AND t.estado = 'RESERVADO'
                    AND TIMESTAMP(t.fecha, t.hora) >= e.inicio AND TIMESTAMP(t.fecha, t.hora) < e.fin) AS choca
           FROM gcal_eventos e LEFT JOIN personal p ON p.dni = e.dni
          WHERE e.agenda_id = :a AND e.estado <> 'cancelled'
            AND e.inicio < DATE_ADD(:hasta, INTERVAL 1 DAY) AND e.fin > :desde
          ORDER BY e.inicio`, { a: agendaId, desde, hasta });
      return res.json({ ok: true, data: { estado: ag ?? null, eventos } });
    } catch (err) { return fallo(res, err, 'gcal'); }
  });

  // ── Un agente (tarjeta en la ficha de Gestión) ────────────────────────────
  // Agendas activas + sus enlaces/turnos en cada una + celular + config para armar el mensaje.
  router.get('/agente/:dni(\\d+)', async (req, res) => {
    try {
      await vencerHabilitaciones(sequelize);
      const dni = Number(req.params.dni);
      const [per] = await q<any>(
        `SELECT p.dni, p.apellido, p.nombre, p.telefono,
                EXISTS(SELECT 1 FROM agentes a WHERE a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO') AS activo
           FROM personal p WHERE p.dni = :dni AND p.deleted_at IS NULL`, { dni });
      if (!per) throw new AgendaError('El agente no está en el sistema', 404);
      const agendas = await q<any>(`SELECT id, nombre, lugar, mensaje_whatsapp FROM agendas WHERE activa = 1 ORDER BY nombre`);
      // por agenda: la última habilitación y el turno vigente (si tiene)
      const habs = await q<any>(
        `SELECT h.id, h.agenda_id, h.token, h.estado, DATE_FORMAT(h.vence_el, '%Y-%m-%d') AS vence_el, h.created_at, h.motivo,
                h.enviado_at, ${reenviarSql('h')} AS reenviar,
                DATE_FORMAT(t.fecha, '%Y-%m-%d') AS turno_fecha, TIME_FORMAT(t.hora, '%H:%i') AS turno_hora, t.estado AS turno_estado
           FROM agenda_habilitaciones h
           LEFT JOIN agenda_turnos t ON t.id = h.turno_id
          WHERE h.dni = :dni
            AND h.id = (SELECT MAX(h2.id) FROM agenda_habilitaciones h2 WHERE h2.dni = h.dni AND h2.agenda_id = h.agenda_id)`, { dni, ...(await reenviarRep()) });
      const turnos = await q<any>(
        `SELECT t.id, t.agenda_id, DATE_FORMAT(t.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(t.hora, '%H:%i') AS hora, t.estado, t.origen, t.motivo
           FROM agenda_turnos t
          WHERE t.dni = :dni AND t.estado = 'RESERVADO'
          ORDER BY t.fecha, t.hora`, { dni });
      const cfg = await leerConfig();
      return res.json({
        ok: true,
        data: {
          agente: { dni: per.dni, apellido: per.apellido, nombre: per.nombre, activo: !!Number(per.activo), ...celularDe(per.telefono) },
          agendas: agendas.map(a => ({
            id: a.id, nombre: a.nombre, lugar: a.lugar, mensaje_whatsapp: a.mensaje_whatsapp,
            habilitacion: habs.find(h => h.agenda_id === a.id) ?? null,
            turno: turnos.find(t => t.agenda_id === a.id) ?? null,
            turnos: turnos.filter(t => t.agenda_id === a.id),   // puede tener varios (17/11)
          })),
          url_publica: cfg.url_publica, plantilla: cfg.plantilla, motivos: [...MOTIVOS, MOTIVO_OTRO],
          url_publica_temporal: cfg.url_publica_temporal, url_publica_desde: cfg.url_publica_desde,
        },
      });
    } catch (err) { return fallo(res, err, 'agente'); }
  });

  // ── Buscar agente (para habilitar) ────────────────────────────────────────
  router.get('/buscar-agente', async (req, res) => {
    try {
      const s = String(req.query.q ?? '').trim();
      if (s.length < 3) return res.json({ ok: true, data: [] });
      const dni = /^\d+$/.test(s) ? Number(s) : null;
      const rows = await q<any>(
        `SELECT p.dni, p.apellido, p.nombre, p.telefono
           FROM personal p
          WHERE p.deleted_at IS NULL
            AND EXISTS(SELECT 1 FROM agentes a WHERE a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO')
            AND ${dni ? 'CAST(p.dni AS CHAR) LIKE :pre' : "CONCAT(p.apellido, ' ', p.nombre) LIKE :like"}
          ORDER BY p.apellido, p.nombre LIMIT 20`, { pre: `${dni}%`, like: `%${s}%` });
      return res.json({ ok: true, data: rows.map(r => ({ ...r, ...celularDe(r.telefono) })) });
    } catch (err) { return fallo(res, err, 'buscar'); }
  });

  return router;
}
