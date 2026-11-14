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
//  GET    /agenda-turnos/habilitaciones?agenda_id&estado
//  POST   /agenda-turnos/habilitaciones            → { agenda_id, dnis[], observacion }
//  POST   /agenda-turnos/habilitaciones/:id/anular
//  GET    /agenda-turnos/turnos?agenda_id&desde&hasta
//  POST   /agenda-turnos/turnos                    → carga manual { agenda_id, dni, fecha, hora }
//  PATCH  /agenda-turnos/turnos/:id                → { estado, observaciones }
//  GET    /agenda-turnos/buscar-agente?q=          → DNI o apellido (para habilitar)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';
import { celularDe } from './licenciasMedicasControl.routes';
import {
  AgendaError, ensureAgendaTablas, disponibilidad, habilitar, anularHabilitacion, vencerHabilitaciones,
  reservarInterno, cambiarEstadoTurno, esFecha, normHora, hoyAR, sumarDias, Franja,
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

export function buildAgendaTurnosRouter(sequelize: Sequelize): Router {
  const router = Router();
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
  router.get('/config', async (_req, res) => {
    try { return res.json({ ok: true, data: { ...(await leerConfig()), plantillaDefault: PLANTILLA_DEFAULT } }); }
    catch (err) { return fallo(res, err, 'config get'); }
  });
  router.put('/config', async (req, res) => {
    try {
      const url = String(req.body?.url_publica ?? '').trim().replace(/\/+$/, '');
      const plantilla = String(req.body?.plantilla ?? '').trim();
      if (url && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url)) throw new AgendaError('La URL pública no es válida');
      if (plantilla && !plantilla.includes('{LINK}')) throw new AgendaError('El mensaje tiene que tener {LINK}');
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES (:k, :j, :u, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { k: CONFIG_KEY, j: JSON.stringify({ url_publica: url, plantilla: plantilla || PLANTILLA_DEFAULT }), u: userId(req) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'config put'); }
  });

  // ── Agendas ───────────────────────────────────────────────────────────────
  router.get('/agendas', async (_req, res) => {
    try {
      await vencerHabilitaciones(sequelize);
      const hoy = hoyAR();
      const agendas = await q<any>(
        `SELECT a.*,
                (SELECT COUNT(*) FROM agenda_habilitaciones h WHERE h.agenda_id = a.id AND h.estado = 'HABILITADO') AS habilitados,
                (SELECT COUNT(*) FROM agenda_turnos t WHERE t.agenda_id = a.id AND t.estado = 'RESERVADO' AND t.fecha >= :hoy) AS proximos
           FROM agendas a ORDER BY a.activa DESC, a.nombre`, { hoy });
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
    };
    if (datos.mensaje_whatsapp && !datos.mensaje_whatsapp.includes('{LINK}')) throw new AgendaError('El mensaje tiene que tener {LINK}');
    return sequelize.transaction(async (t) => {
      let agendaId = id;
      if (agendaId) {
        await sequelize.query(
          `UPDATE agendas SET nombre = :nombre, descripcion = :descripcion, lugar = :lugar, anticipacion_dias = :anticipacion_dias,
                  ventana_dias = :ventana_dias, vence_dias = :vence_dias, cancelar_horas = :cancelar_horas,
                  carga_jubilacion = :carga_jubilacion, mensaje_whatsapp = :mensaje_whatsapp, activa = :activa, updated_by = :u
            WHERE id = :id`, { replacements: { ...datos, id: agendaId }, transaction: t });
      } else {
        const [nid] = await sequelize.query(
          `INSERT INTO agendas (nombre, descripcion, lugar, anticipacion_dias, ventana_dias, vence_dias, cancelar_horas,
                                carga_jubilacion, mensaje_whatsapp, activa, created_by)
           VALUES (:nombre, :descripcion, :lugar, :anticipacion_dias, :ventana_dias, :vence_dias, :cancelar_horas,
                   :carga_jubilacion, :mensaje_whatsapp, :activa, :u)`, { replacements: datos, transaction: t });
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
        `SELECT h.id, h.dni, p.apellido, p.nombre, p.telefono, h.token, h.estado, h.observacion,
                DATE_FORMAT(h.vence_el, '%Y-%m-%d') AS vence_el, h.created_at, h.usado_at,
                DATE_FORMAT(t.fecha, '%Y-%m-%d') AS turno_fecha, TIME_FORMAT(t.hora, '%H:%i') AS turno_hora, t.estado AS turno_estado
           FROM agenda_habilitaciones h
           JOIN personal p ON p.dni = h.dni
           LEFT JOIN agenda_turnos t ON t.id = h.turno_id
          WHERE h.agenda_id = :a ${['HABILITADO', 'USADO', 'VENCIDO', 'ANULADO'].includes(estado) ? 'AND h.estado = :estado' : ''}
          ORDER BY h.created_at DESC LIMIT 1000`, { a: agendaId, estado });
      return res.json({ ok: true, data: rows.map(r => ({ ...r, ...celularDe(r.telefono), token: r.estado === 'HABILITADO' || r.estado === 'USADO' ? r.token : null })) });
    } catch (err) { return fallo(res, err, 'habilitaciones list'); }
  });
  router.post('/habilitaciones', async (req, res) => {
    try {
      const b = req.body ?? {};
      const dnis = (Array.isArray(b.dnis) ? b.dnis : [b.dni]).map((d: any) => Number(String(d ?? '').replace(/\D/g, ''))).filter((d: number) => d > 0);
      if (!dnis.length) throw new AgendaError('Falta el DNI');
      if (dnis.length > 500) throw new AgendaError('Máximo 500 por vez');
      const r = await habilitar(sequelize, Number(b.agenda_id), dnis, userId(req), txt(b.observacion, 300));
      return res.json({ ok: true, data: r });
    } catch (err) { return fallo(res, err, 'habilitar'); }
  });
  router.post('/habilitaciones/:id(\\d+)/anular', async (req, res) => {
    try { await anularHabilitacion(sequelize, Number(req.params.id), userId(req)); return res.json({ ok: true }); }
    catch (err) { return fallo(res, err, 'anular'); }
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
                t.estado, t.origen, t.telefono_contacto, t.observaciones, t.cancelado_por, t.jubilacion_cita_id, t.created_at
           FROM agenda_turnos t JOIN personal p ON p.dni = t.dni
          WHERE t.agenda_id = :a AND t.fecha BETWEEN :desde AND :hasta
          ORDER BY t.fecha, t.hora, t.lugar`, { a: agendaId, desde, hasta });
      return res.json({ ok: true, data: rows });
    } catch (err) { return fallo(res, err, 'turnos list'); }
  });
  router.post('/turnos', async (req, res) => {
    try {
      const b = req.body ?? {};
      const id = await reservarInterno(sequelize, Number(b.agenda_id), Number(b.dni), b.fecha, b.hora, txt(b.observaciones, 500), userId(req), userNombre(req));
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
        `SELECT h.id, h.agenda_id, h.token, h.estado, DATE_FORMAT(h.vence_el, '%Y-%m-%d') AS vence_el, h.created_at,
                DATE_FORMAT(t.fecha, '%Y-%m-%d') AS turno_fecha, TIME_FORMAT(t.hora, '%H:%i') AS turno_hora, t.estado AS turno_estado
           FROM agenda_habilitaciones h
           LEFT JOIN agenda_turnos t ON t.id = h.turno_id
          WHERE h.dni = :dni
            AND h.id = (SELECT MAX(h2.id) FROM agenda_habilitaciones h2 WHERE h2.dni = h.dni AND h2.agenda_id = h.agenda_id)`, { dni });
      const turnos = await q<any>(
        `SELECT t.id, t.agenda_id, DATE_FORMAT(t.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(t.hora, '%H:%i') AS hora, t.estado, t.origen
           FROM agenda_turnos t
          WHERE t.dni = :dni AND t.estado = 'RESERVADO'`, { dni });
      const cfg = await leerConfig();
      return res.json({
        ok: true,
        data: {
          agente: { dni: per.dni, apellido: per.apellido, nombre: per.nombre, activo: !!Number(per.activo), ...celularDe(per.telefono) },
          agendas: agendas.map(a => ({
            id: a.id, nombre: a.nombre, lugar: a.lugar, mensaje_whatsapp: a.mensaje_whatsapp,
            habilitacion: habs.find(h => h.agenda_id === a.id) ?? null,
            turno: turnos.find(t => t.agenda_id === a.id) ?? null,
          })),
          url_publica: cfg.url_publica, plantilla: cfg.plantilla,
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
