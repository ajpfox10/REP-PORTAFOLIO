// src/services/agendaTurnos.ts
// Lógica de la Agenda de turnos (mig 122). La usan:
//  - routes/agendaTurnos.routes.ts  → pantalla interna (con login)
//  - publico/turnosPublico.ts       → la página que abre el agente desde el enlace (sin login)
//
// Reglas:
//  - El agente solo puede pedir turno con una habilitación HABILITADO y sin vencer (enlace único).
//    Al reservar queda USADO: el enlace ya no sirve para otro turno, solo para ver/cancelar el suyo.
//  - Que no se repitan los turnos lo hace cumplir la base (UNIQUE slot_activo / dni_activo).
//  - Feriados (tabla `feriados`) y bloqueos (agenda_bloqueos) no ofrecen turnos.
//  - Agenda con carga_jubilacion = 1 → el turno también se carga en jubilacion_citas.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Sequelize, QueryTypes, Transaction } from 'sequelize';
import { logger } from '../logging/logger';

const TZ = 'America/Argentina/Buenos_Aires';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export class AgendaError extends Error {
  constructor(message: string, public status = 400, public code = 'AGENDA') { super(message); }
}

// ── Tablas ──────────────────────────────────────────────────────────────────

const listas = new WeakMap<Sequelize, Promise<void>>();

const MIGRACIONES = ['122__agenda_turnos.sql', '123__agenda_google_calendar.sql', '135__agenda_motivo.sql'];

// ── Motivo del turno (lista fija + "Otro" escrito) ─────────────────────────
export const MOTIVO_JUBILACION = 'Jubilación';
export const MOTIVOS = [MOTIVO_JUBILACION, 'Entrega de papeles', 'Nacimiento', 'Apelación de licencia'] as const;
export const MOTIVO_OTRO = 'Otro';

/** motivo de la lista, u "Otro" + texto escrito → texto final. Sin motivo → null (o error si es obligatorio). */
export function normalizarMotivo(motivo: any, otro: any, obligatorio: boolean): string | null {
  const m = String(motivo ?? '').trim();
  if (!m) { if (obligatorio) throw new AgendaError('Elegí el motivo del turno'); return null; }
  const deLista = MOTIVOS.find(x => x.toLowerCase() === m.toLowerCase());
  if (deLista) return deLista;
  const texto = String(m.toLowerCase() === MOTIVO_OTRO.toLowerCase() ? (otro ?? '') : m).replace(/\s+/g, ' ').trim().slice(0, 150);
  if (!texto) throw new AgendaError('Escribí el motivo del turno');
  return texto;
}
const esMotivoJubilacion = (m: string | null | undefined) => m === MOTIVO_JUBILACION;

function ddl(): string[] {
  const out: string[] = [];
  for (const m of MIGRACIONES) {
    const cands = [
      path.resolve(process.cwd(), 'scripts/migrations', m),
      path.resolve(__dirname, '../../scripts/migrations', m),
    ];
    const f = cands.find(p => fs.existsSync(p));
    if (!f) throw new Error(`No se encontró scripts/migrations/${m}`);
    const sinComentarios = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');
    out.push(...sinComentarios.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean));
  }
  return out;
}

// ── Conexión del servidor público (usuario de MySQL con permisos mínimos) ───
// No crea ni modifica tablas (eso lo hace la API) y no lee `personal`/`agentes`: usa la vista
// v_publico_agenda_agente, que solo tiene nombre, ley y ocupación de quienes recibieron un enlace.

const publicas = new WeakSet<Sequelize>();
export function marcarConexionPublica(sequelize: Sequelize) { publicas.add(sequelize); }
const esPublica = (sq: Sequelize) => publicas.has(sq);

/** La crea la API (usuario completo). Idempotente. */
export async function ensureVistaPublicaAgenda(sequelize: Sequelize): Promise<void> {
  await ensureAgendaTablas(sequelize);
  const ultimo = (campo: string, join: string) => `(
      SELECT ${campo} FROM agentes a ${join}
       WHERE a.dni = p.dni AND a.deleted_at IS NULL
       ORDER BY (a.estado_empleo = 'ACTIVO') DESC, a.fecha_ingreso DESC, a.id DESC LIMIT 1)`;
  await sequelize.query(`
    CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_publico_agenda_agente AS
    SELECT p.dni, p.apellido, p.nombre,
           ${ultimo('l.nombre', 'LEFT JOIN ley l ON l.id = a.ley_id')} AS ley_nombre,
           ${ultimo('o.nombre', 'LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id')} AS ocupacion_nombre
      FROM personal p
     WHERE p.dni IN (SELECT h.dni FROM agenda_habilitaciones h)`);
}

export function ensureAgendaTablas(sequelize: Sequelize): Promise<void> {
  if (esPublica(sequelize)) return Promise.resolve(); // el usuario público no puede (ni debe) tocar el esquema
  let p = listas.get(sequelize);
  if (!p) {
    p = (async () => {
      for (const s of ddl()) {
        try { await sequelize.query(s); }
        catch (err: any) {
          const code = err?.original?.code ?? err?.parent?.code;
          if (code === 'ER_DUP_FIELDNAME') continue;                         // columna ya agregada
          if (code === 'ER_DUP_ENTRY' && /UPDATE agendas/i.test(s)) continue; // nombre ya usado
          if (code === 'ER_NO_SUCH_TABLE' && /robots_config/i.test(s)) continue; // base sin página Robots
          throw err;
        }
      }
    })();
    p.catch(err => { listas.delete(sequelize); logger.error({ msg: 'agenda_turnos ensure', error: err?.message }); });
    listas.set(sequelize, p);
  }
  return p;
}

// ── Fechas (hora argentina) ─────────────────────────────────────────────────

export function ahoraAR(): { fecha: string; hora: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return { fecha: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
}
export const hoyAR = () => ahoraAR().fecha;

export function sumarDias(f: string, n: number): string {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();
const aMin = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); };
const aHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const esFecha = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
export const normHora = (v: any): string | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ''));
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};

/** Minutos que faltan hasta fecha+hora (hora argentina). */
function minutosHasta(fecha: string, hora: string): number {
  const now = ahoraAR();
  const dias = Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${now.fecha}T00:00:00Z`)) / 86400000);
  return dias * 1440 + aMin(hora) - aMin(now.hora);
}

export function fechaLarga(f: string): string {
  const [y, m, d] = f.split('-');
  return `${DIAS[diaSemana(f)]} ${d}/${m}/${y}`;
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export interface Agenda {
  id: number; nombre: string; descripcion: string | null; lugar: string | null;
  anticipacion_dias: number; ventana_dias: number; vence_dias: number; cancelar_horas: number;
  carga_jubilacion: number; mensaje_whatsapp: string | null; activa: number;
}
export interface Franja { id?: number; dia_semana: number; hora_desde: string; hora_hasta: string; duracion_min: number; cupo: number }

type Opts = { transaction?: Transaction };

export async function getAgenda(sq: Sequelize, id: number, o: Opts = {}): Promise<Agenda | null> {
  const r = await sq.query<Agenda>(`SELECT * FROM agendas WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT, ...o });
  return r[0] ?? null;
}

export async function getFranjas(sq: Sequelize, agendaId: number, o: Opts = {}): Promise<Franja[]> {
  return sq.query<Franja>(
    `SELECT id, dia_semana, TIME_FORMAT(hora_desde, '%H:%i') AS hora_desde, TIME_FORMAT(hora_hasta, '%H:%i') AS hora_hasta,
            duracion_min, cupo
       FROM agenda_franjas WHERE agenda_id = :id ORDER BY dia_semana, hora_desde`,
    { replacements: { id: agendaId }, type: QueryTypes.SELECT, ...o });
}

export interface Horario { hora: string; cupo: number; ocupados: number; libres: number; bloqueado: boolean; google: string | null }
export interface DiaDisponible { fecha: string; dia: string; feriado: string | null; bloqueado: string | null; horarios: Horario[] }

/**
 * Grilla de horarios de la agenda entre `desde` y `hasta` (recortado a la ventana de la agenda
 * salvo `sinVentana`, que usa la oficina para ver/cargar fuera de ella).
 */
export async function disponibilidad(sq: Sequelize, agendaId: number,
  p: { desde?: string; hasta?: string; sinVentana?: boolean } = {}, o: Opts = {}): Promise<DiaDisponible[]> {
  const agenda = await getAgenda(sq, agendaId, o);
  if (!agenda) throw new AgendaError('La agenda no existe', 404);
  const franjas = await getFranjas(sq, agendaId, o);
  const now = ahoraAR();
  let desde = p.desde && esFecha(p.desde) ? p.desde : sumarDias(now.fecha, agenda.anticipacion_dias);
  let hasta = p.hasta && esFecha(p.hasta) ? p.hasta : sumarDias(now.fecha, agenda.ventana_dias);
  if (!p.sinVentana) {
    const min = sumarDias(now.fecha, Math.max(0, agenda.anticipacion_dias));
    const max = sumarDias(now.fecha, agenda.ventana_dias);
    if (desde < min) desde = min;
    if (hasta > max) hasta = max;
  }
  if (hasta < desde) return [];
  if (Date.parse(hasta) - Date.parse(desde) > 400 * 86400000) throw new AgendaError('Rango demasiado largo');

  const rep = { id: agendaId, desde, hasta };
  const [feriados, bloqueos, ocupados, google, citasJub] = await Promise.all([
    sq.query<any>(`SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, nombre FROM feriados WHERE fecha BETWEEN :desde AND :hasta`,
      { replacements: rep, type: QueryTypes.SELECT, ...o }).catch(() => [] as any[]),
    sq.query<any>(
      `SELECT DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS fd, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS fh,
              TIME_FORMAT(hora_desde, '%H:%i') AS hd, TIME_FORMAT(hora_hasta, '%H:%i') AS hh, motivo
         FROM agenda_bloqueos
        WHERE deleted_at IS NULL AND (agenda_id IS NULL OR agenda_id = :id)
          AND fecha_hasta >= :desde AND fecha_desde <= :hasta`,
      { replacements: rep, type: QueryTypes.SELECT, ...o }),
    sq.query<any>(
      `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(hora, '%H:%i') AS hora, COUNT(*) AS n
         FROM agenda_turnos
        WHERE agenda_id = :id AND estado <> 'CANCELADO' AND fecha BETWEEN :desde AND :hasta
        GROUP BY fecha, hora`,
      { replacements: rep, type: QueryTypes.SELECT, ...o }),
    // Eventos cargados a mano en el Google Calendar de la agenda (los baja el robot): ocupan el horario
    sq.query<any>(
      `SELECT DATE_FORMAT(inicio, '%Y-%m-%d %H:%i') AS ini, DATE_FORMAT(fin, '%Y-%m-%d %H:%i') AS fin, titulo
         FROM gcal_eventos
        WHERE agenda_id = :id AND origen = 'MANUAL' AND estado <> 'cancelled'
          AND inicio < DATE_ADD(:hasta, INTERVAL 1 DAY) AND fin > :desde`,
      { replacements: rep, type: QueryTypes.SELECT, ...o }).catch(() => [] as any[]),
    // Agenda de jubilación: las citas cargadas a mano en la pestaña de Jubilación también ocupan
    // (las que vienen de esta agenda ya están contadas en agenda_turnos)
    Number(agenda.carga_jubilacion)
      ? sq.query<any>(
          `SELECT DATE_FORMAT(c.fecha_cita, '%Y-%m-%d') AS fecha, TIME_FORMAT(c.hora_cita, '%H:%i') AS hora
             FROM jubilacion_citas c
            WHERE c.deleted_at IS NULL AND c.estado <> 'CANCELADA' AND c.fecha_cita BETWEEN :desde AND :hasta
              AND NOT EXISTS (SELECT 1 FROM agenda_turnos t WHERE t.jubilacion_cita_id = c.id)`,
          { replacements: rep, type: QueryTypes.SELECT, ...o }).catch(() => [] as any[])
      : Promise.resolve([] as any[]),
  ]);
  const fer =new Map<string, string>(feriados.map((f: any) => [f.fecha, f.nombre]));
  const ocu = new Map<string, number>(ocupados.map((x: any) => [`${x.fecha} ${x.hora}`, Number(x.n)]));

  const out: DiaDisponible[] = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const fs_ = franjas.filter(x => Number(x.dia_semana) === diaSemana(f));
    if (!fs_.length) continue;
    const bls = bloqueos.filter((b: any) => b.fd <= f && b.fh >= f);
    const diaEntero = bls.find((b: any) => !b.hd || !b.hh);
    const horarios: Horario[] = [];
    for (const fr of fs_) {
      const dur = Math.max(5, Number(fr.duracion_min) || 20);
      for (let m = aMin(fr.hora_desde); m + dur <= aMin(fr.hora_hasta); m += dur) {
        const hora = aHora(m);
        if (f === now.fecha && m <= aMin(now.hora)) continue;   // ya pasó
        const bloqueado = !!diaEntero || bls.some((b: any) => b.hd && b.hh && m < aMin(b.hh) && m + dur > aMin(b.hd));
        const ini = `${f} ${hora}`, finSlot = `${f} ${aHora(m + dur)}`;
        const ev = google.find((g: any) => g.ini < finSlot && g.fin > ini);
        const citas = citasJub.filter((c: any) => c.fecha === f && aMin(c.hora) >= m && aMin(c.hora) < m + dur).length;
        const ocupadosN = (ocu.get(ini) ?? 0) + citas;
        const cupo = Math.max(1, Number(fr.cupo) || 1);
        horarios.push({
          hora, cupo, ocupados: ocupadosN, bloqueado, google: ev ? (ev.titulo || 'Evento en Google') : null,
          libres: bloqueado || ev || fer.has(f) ? 0 : Math.max(0, cupo - ocupadosN),
        });
      }
    }
    horarios.sort((a, b) => a.hora.localeCompare(b.hora));
    out.push({
      fecha: f, dia: fechaLarga(f), feriado: fer.get(f) ?? null,
      bloqueado: diaEntero ? (diaEntero.motivo || 'Bloqueado') : null, horarios,
    });
  }
  return out;
}

/**
 * Para la agenda de citas de Jubilación (carga manual): ¿ese día/hora ya lo tomó alguien en una agenda
 * de turnos conectada a jubilación? Devuelve quién, o null. `excluirCitaId` = la cita que se está editando.
 */
export async function turnoJubilacionEn(sq: Sequelize, fecha: string, hora: string, excluirCitaId?: number | null) {
  const r = await sq.query<any>(
    `SELECT t.id, p.apellido, p.nombre, a.nombre AS agenda, TIME_FORMAT(t.hora, '%H:%i') AS hora
       FROM agenda_turnos t
       JOIN agendas a ON a.id = t.agenda_id AND a.carga_jubilacion = 1
       JOIN personal p ON p.dni = t.dni
      WHERE t.fecha = :fecha AND t.estado <> 'CANCELADO'
        AND (:excl IS NULL OR t.jubilacion_cita_id IS NULL OR t.jubilacion_cita_id <> :excl)
        AND TIME(:hora) >= t.hora
        AND TIME(:hora) < ADDTIME(t.hora, SEC_TO_TIME(60 * COALESCE((
              SELECT f.duracion_min FROM agenda_franjas f
               WHERE f.agenda_id = t.agenda_id AND f.dia_semana = DAYOFWEEK(t.fecha) - 1
                 AND t.hora >= f.hora_desde AND t.hora < f.hora_hasta LIMIT 1), 20)))
      LIMIT 1`,
    { replacements: { fecha, hora, excl: excluirCitaId ?? null }, type: QueryTypes.SELECT }).catch(() => [] as any[]);
  return r[0] ?? null;
}

/** La cita de jubilación cambió de estado en su pestaña → el turno de la agenda (si vino de ahí) acompaña. */
export async function reflejarEstadoEnTurno(sq: Sequelize, citaId: number, estadoCita: string): Promise<void> {
  const map: Record<string, string> = { AGENDADA: 'RESERVADO', ATENDIDA: 'ATENDIDO', AUSENTE: 'AUSENTE', CANCELADA: 'CANCELADO', REPROGRAMADA: 'CANCELADO' };
  const e = map[estadoCita];
  if (!e) return;
  try {
    await sq.query(
      `UPDATE agenda_turnos SET estado = :e, gcal_pendiente = 1,
              cancelado_at = IF(:e = 'CANCELADO' AND cancelado_at IS NULL, NOW(), cancelado_at),
              cancelado_por = IF(:e = 'CANCELADO' AND cancelado_por IS NULL, 'OFICINA', cancelado_por)
        WHERE jubilacion_cita_id = :c AND estado <> 'CANCELADO' AND estado <> :e`,
      { replacements: { e, c: citaId } });
  } catch (err: any) {
    // p.ej. volver a AGENDADA cuando el agente ya tiene otro turno reservado (uq_at_dni): queda como estaba
    if (err?.original?.code !== 'ER_DUP_ENTRY' && err?.original?.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
}

// ── Habilitaciones ──────────────────────────────────────────────────────────

export const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenValido = (t: any) => /^[A-Za-z0-9_-]{43}$/.test(String(t ?? ''));

/** Pasa a VENCIDO las habilitaciones sin usar con vence_el anterior a hoy. */
export async function vencerHabilitaciones(sq: Sequelize): Promise<void> {
  await sq.query(`UPDATE agenda_habilitaciones SET estado = 'VENCIDO' WHERE estado = 'HABILITADO' AND vence_el < :hoy`,
    { replacements: { hoy: hoyAR() } });
}

export interface ResultadoHabilitar { dni: number; ok: boolean; id?: number; token?: string; existente?: boolean; motivo?: string; apellido?: string; nombre?: string }

/** Habilita a cada DNI en la agenda. Si ya tiene una habilitación vigente devuelve esa (no crea otra). */
export async function habilitar(sq: Sequelize, agendaId: number, dnis: number[], userId: number | null,
  observacion: string | null, motivo: string | null = null): Promise<ResultadoHabilitar[]> {
  const agenda = await getAgenda(sq, agendaId);
  if (!agenda) throw new AgendaError('La agenda no existe', 404);
  if (!agenda.activa) throw new AgendaError('La agenda está desactivada');
  await vencerHabilitaciones(sq);
  const vence = sumarDias(hoyAR(), Math.max(1, agenda.vence_dias || 15));
  const out: ResultadoHabilitar[] = [];
  for (const dni of [...new Set(dnis)]) {
    const ag = await sq.query<any>(
      `SELECT p.dni, p.apellido, p.nombre,
              EXISTS(SELECT 1 FROM agentes a WHERE a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO') AS activo
         FROM personal p WHERE p.dni = :dni AND p.deleted_at IS NULL`,
      { replacements: { dni }, type: QueryTypes.SELECT });
    if (!ag[0]) { out.push({ dni, ok: false, motivo: 'No está en el sistema' }); continue; }
    const base = { dni, apellido: ag[0].apellido, nombre: ag[0].nombre };
    if (!Number(ag[0].activo)) { out.push({ ...base, ok: false, motivo: 'No es agente activo' }); continue; }
    const turno = await sq.query<any>(
      `SELECT id FROM agenda_turnos WHERE agenda_id = :a AND dni = :dni AND estado = 'RESERVADO'`,
      { replacements: { a: agendaId, dni }, type: QueryTypes.SELECT });
    if (turno[0]) { out.push({ ...base, ok: false, motivo: 'Ya tiene un turno reservado en esta agenda' }); continue; }
    const vig = await sq.query<any>(
      `SELECT id, token FROM agenda_habilitaciones WHERE agenda_id = :a AND dni = :dni AND estado = 'HABILITADO'`,
      { replacements: { a: agendaId, dni }, type: QueryTypes.SELECT });
    if (vig[0]) {
      // enlace sin usar: si ahora la oficina eligió motivo, se le pone
      if (motivo) await sq.query(`UPDATE agenda_habilitaciones SET motivo = :m WHERE id = :id`, { replacements: { m: motivo, id: vig[0].id } });
      out.push({ ...base, ok: true, id: vig[0].id, token: vig[0].token, existente: true }); continue;
    }
    const token = nuevoToken();
    try {
      const [id] = await sq.query(
        `INSERT INTO agenda_habilitaciones (agenda_id, dni, token, vence_el, observacion, motivo, created_by)
         VALUES (:a, :dni, :token, :vence, :obs, :motivo, :u)`,
        { replacements: { a: agendaId, dni, token, vence, obs: observacion, motivo, u: userId } });
      out.push({ ...base, ok: true, id: Number(id), token });
    } catch (err: any) {
      if (err?.original?.code === 'ER_DUP_ENTRY') out.push({ ...base, ok: false, motivo: 'Ya estaba habilitado (otro usuario al mismo tiempo)' });
      else throw err;
    }
  }
  return out;
}

export async function anularHabilitacion(sq: Sequelize, id: number, userId: number | null): Promise<void> {
  const [, n]: any = await sq.query(
    `UPDATE agenda_habilitaciones SET estado = 'ANULADO', anulado_at = NOW(), anulado_by = :u
      WHERE id = :id AND estado = 'HABILITADO'`, { replacements: { id, u: userId }, type: QueryTypes.UPDATE });
  if (!Number(n)) throw new AgendaError('Solo se puede anular un enlace sin usar', 409);
}

// ── Enlace del agente ───────────────────────────────────────────────────────

const sqlHab = (sq: Sequelize) => `
  SELECT h.id, h.agenda_id, h.dni, h.estado, DATE_FORMAT(h.vence_el, '%Y-%m-%d') AS vence_el, h.turno_id, h.motivo,
         p.apellido, p.nombre,
         a.nombre AS agenda_nombre, a.descripcion AS agenda_descripcion, a.lugar AS agenda_lugar,
         a.cancelar_horas, a.carga_jubilacion, a.activa
    FROM agenda_habilitaciones h
    JOIN ${esPublica(sq) ? 'v_publico_agenda_agente' : 'personal'} p ON p.dni = h.dni
    JOIN agendas a  ON a.id = h.agenda_id
   WHERE h.token = :token`;

async function turnoDe(sq: Sequelize, id: number | null, o: Opts = {}) {
  if (!id) return null;
  const r = await sq.query<any>(
    `SELECT id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(hora, '%H:%i') AS hora, estado, jubilacion_cita_id, motivo
       FROM agenda_turnos WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT, ...o });
  return r[0] ?? null;
}

/** Duración del turno según la franja de ese día y hora (20 min si no la encuentra). */
async function duracionTurno(sq: Sequelize, agendaId: number, fecha: string, hora: string): Promise<number> {
  const fr = await getFranjas(sq, agendaId);
  const m = aMin(hora);
  const f = fr.find(x => Number(x.dia_semana) === diaSemana(fecha) && m >= aMin(x.hora_desde) && m < aMin(x.hora_hasta));
  return Math.max(5, Number(f?.duracion_min) || 20);
}

/** Archivo .ics del turno (iPhone / Outlook / cualquier calendario). */
export async function icsEnlace(sq: Sequelize, token: string): Promise<string> {
  const e = await estadoEnlace(sq, token);
  if (!e.turno || e.turno.estado !== 'RESERVADO') throw new AgendaError('No hay un turno reservado', 404);
  const dt = (f: string, h: string) => `${f.replace(/-/g, '')}T${h.replace(':', '')}00`;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, m => `\\${m}`).replace(/\r?\n/g, '\\n');
  const ahora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const desc = [e.agenda.descripcion, 'Turno pedido desde el enlace de la Oficina de Personal.'].filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Oficina de Personal//Agenda de turnos//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:America/Argentina/Buenos_Aires', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:turno-${token.slice(0, 16)}@agenda-turnos`,
    `DTSTAMP:${ahora}`,
    `DTSTART;TZID=America/Argentina/Buenos_Aires:${dt(e.turno.fecha, e.turno.hora)}`,
    `DTEND;TZID=America/Argentina/Buenos_Aires:${dt(e.turno.fecha, e.turno.hora_fin)}`,
    `SUMMARY:${esc(`Turno: ${e.turno?.motivo || e.motivo || e.agenda.nombre}`)}`,
    e.agenda.lugar ? `LOCATION:${esc(e.agenda.lugar)}` : '',
    `DESCRIPTION:${esc(desc)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Turno en 1 hora', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].filter(l => l !== '').join('\r\n') + '\r\n';
}

/** Lo que ve el agente al abrir su enlace. */
export async function estadoEnlace(sq: Sequelize, token: string) {
  if (!tokenValido(token)) throw new AgendaError('Enlace inválido', 404);
  const h = (await sq.query<any>(sqlHab(sq), { replacements: { token }, type: QueryTypes.SELECT }))[0];
  if (!h) throw new AgendaError('Enlace inválido', 404);
  let estado: string = h.estado;
  if (estado === 'HABILITADO' && h.vence_el < hoyAR()) {
    await sq.query(`UPDATE agenda_habilitaciones SET estado = 'VENCIDO' WHERE id = :id AND estado = 'HABILITADO'`, { replacements: { id: h.id } });
    estado = 'VENCIDO';
  }
  if (estado === 'HABILITADO' && !h.activa) estado = 'ANULADO';
  const t = await turnoDe(sq, h.turno_id);
  const dur = t ? await duracionTurno(sq, h.agenda_id, t.fecha, t.hora) : 0;
  const turno = t ? {
    fecha: t.fecha, hora: t.hora, hora_fin: aHora(aMin(t.hora) + dur), dia: fechaLarga(t.fecha), estado: t.estado, motivo: t.motivo ?? null,
    puede_cancelar: t.estado === 'RESERVADO' && minutosHasta(t.fecha, t.hora) >= Number(h.cancelar_horas || 0) * 60,
  } : null;
  return {
    estado,
    vence_el: h.vence_el,
    agente: { apellido: h.apellido, nombre: h.nombre },
    agenda: { nombre: h.agenda_nombre, descripcion: h.agenda_descripcion, lugar: h.agenda_lugar, cancelar_horas: Number(h.cancelar_horas) },
    turno,
    // motivo que puso la oficina; si es null el agente lo elige de `motivos` (o "Otro" y lo escribe)
    motivo: h.motivo ?? null,
    motivos: [...MOTIVOS, MOTIVO_OTRO],
  };
}

export async function disponiblesEnlace(sq: Sequelize, token: string) {
  const e = await estadoEnlace(sq, token);
  if (e.estado !== 'HABILITADO') throw new AgendaError('Este enlace ya no permite pedir turno', 409);
  const h = (await sq.query<any>(`SELECT agenda_id FROM agenda_habilitaciones WHERE token = :token`, { replacements: { token }, type: QueryTypes.SELECT }))[0];
  const dias = await disponibilidad(sq, h.agenda_id);
  // Al agente solo se le muestran los horarios con lugar
  return dias
    .map(d => ({ fecha: d.fecha, dia: d.dia, horarios: d.horarios.filter(x => x.libres > 0).map(x => x.hora) }))
    .filter(d => d.horarios.length);
}

// ── Reservar ────────────────────────────────────────────────────────────────

/** Ocupa un lugar libre del horario. La base rechaza el duplicado (uq_at_slot / uq_at_dni). */
async function insertarTurno(sq: Sequelize, t: Transaction, d: {
  agendaId: number; habilitacionId: number | null; dni: number; fecha: string; hora: string; cupo: number;
  origen: 'ENLACE' | 'INTERNO'; telefono: string | null; observaciones: string | null; userId: number | null; motivo: string | null;
}): Promise<number> {
  const usados = await sq.query<any>(
    `SELECT lugar FROM agenda_turnos WHERE agenda_id = :a AND fecha = :f AND hora = :h AND estado <> 'CANCELADO'`,
    { replacements: { a: d.agendaId, f: d.fecha, h: d.hora }, type: QueryTypes.SELECT, transaction: t });
  const tomados = new Set(usados.map((u: any) => Number(u.lugar)));
  for (let lugar = 1; lugar <= d.cupo; lugar++) {
    if (tomados.has(lugar)) continue;
    try {
      const [id] = await sq.query(
        `INSERT INTO agenda_turnos (agenda_id, habilitacion_id, dni, fecha, hora, lugar, origen, telefono_contacto, observaciones, motivo, created_by)
         VALUES (:a, :hab, :dni, :f, :h, :lugar, :origen, :tel, :obs, :motivo, :u)`,
        { replacements: { a: d.agendaId, hab: d.habilitacionId, dni: d.dni, f: d.fecha, h: d.hora, lugar,
          origen: d.origen, tel: d.telefono, obs: d.observaciones, motivo: d.motivo, u: d.userId }, transaction: t });
      return Number(id);
    } catch (err: any) {
      if (err?.original?.code !== 'ER_DUP_ENTRY') throw err;
      const msg = String(err?.original?.sqlMessage ?? '');
      if (msg.includes('uq_at_dni')) throw new AgendaError('Ya tiene un turno reservado en esta agenda', 409, 'YA_TIENE');
      // otro tomó ese lugar en el mismo instante → probar el siguiente
    }
  }
  throw new AgendaError('Ese horario se acaba de ocupar. Elegí otro.', 409, 'OCUPADO');
}

async function cupoDelHorario(sq: Sequelize, agendaId: number, fecha: string, hora: string, sinVentana: boolean, t?: Transaction): Promise<number> {
  const dias = await disponibilidad(sq, agendaId, { desde: fecha, hasta: fecha, sinVentana }, { transaction: t });
  const h = dias[0]?.horarios.find(x => x.hora === hora);
  if (!h) throw new AgendaError('Ese horario no existe en la agenda o ya no se ofrece', 409, 'NO_DISPONIBLE');
  if (dias[0].feriado) throw new AgendaError(`Es feriado (${dias[0].feriado})`, 409, 'NO_DISPONIBLE');
  if (h.bloqueado) throw new AgendaError('Ese horario está bloqueado', 409, 'NO_DISPONIBLE');
  if (h.google) throw new AgendaError(`Ese horario está ocupado en el calendario (${h.google})`, 409, 'NO_DISPONIBLE');
  if (h.libres <= 0) throw new AgendaError('Ese horario se acaba de ocupar. Elegí otro.', 409, 'OCUPADO');
  return h.cupo;
}

async function tablaExiste(sq: Sequelize, tabla: string, t?: Transaction): Promise<boolean> {
  const r = await sq.query<any>(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t`,
    { replacements: { t: tabla }, type: QueryTypes.SELECT, transaction: t });
  return !!r.length;
}

/** Agenda con carga_jubilacion → copia el turno a jubilacion_citas (snapshot del agente, como la agenda de citas). */
async function cargarEnJubilacion(sq: Sequelize, t: Transaction, turnoId: number, agendaNombre: string, userId: number | null, userNombre: string | null) {
  if (!(await tablaExiste(sq, 'jubilacion_citas', t))) return;
  const tu = (await sq.query<any>(
    `SELECT dni, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(hora, '%H:%i:%s') AS hora, origen FROM agenda_turnos WHERE id = :id`,
    { replacements: { id: turnoId }, type: QueryTypes.SELECT, transaction: t }))[0];
  const ag = (await sq.query<any>(esPublica(sq)
    ? `SELECT apellido, nombre, ley_nombre, ocupacion_nombre FROM v_publico_agenda_agente WHERE dni = :dni`
    : `SELECT p.apellido, p.nombre, l.nombre AS ley_nombre, o.nombre AS ocupacion_nombre
       FROM personal p
       LEFT JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
       LEFT JOIN ley l ON l.id = a.ley_id
       LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id
      WHERE p.dni = :dni
      ORDER BY (a.estado_empleo = 'ACTIVO') DESC, a.fecha_ingreso DESC, a.id DESC LIMIT 1`,
    { replacements: { dni: tu.dni }, type: QueryTypes.SELECT, transaction: t }))[0];
  if (!ag) return;
  const [citaId] = await sq.query(
    `INSERT INTO jubilacion_citas (dni, apellido, nombre, ley_nombre, ocupacion_nombre, fecha_cita, hora_cita, motivo, estado,
                                   observaciones, creado_por, creado_por_nombre)
     VALUES (:dni, :ap, :no, :ley, :ocu, :f, :h, :motivo, 'AGENDADA', :obs, :u, :un)`,
    { replacements: { dni: tu.dni, ap: ag.apellido, no: ag.nombre, ley: ag.ley_nombre ?? null, ocu: ag.ocupacion_nombre ?? null,
      f: tu.fecha, h: tu.hora, motivo: `Turno de Jubilación (${agendaNombre})`.slice(0, 200),
      obs: tu.origen === 'ENLACE' ? 'Pedido por el agente desde el enlace (Agenda de turnos)' : 'Cargado desde Agenda de turnos',
      u: userId, un: userNombre ?? (tu.origen === 'ENLACE' ? 'Agenda de turnos (enlace)' : null) }, transaction: t });
  await sq.query(`UPDATE agenda_turnos SET jubilacion_cita_id = :c WHERE id = :id`, { replacements: { c: Number(citaId), id: turnoId }, transaction: t });
}

async function sincronizarJubilacion(sq: Sequelize, t: Transaction, turnoId: number, estado: string) {
  const map: Record<string, string> = { CANCELADO: 'CANCELADA', ATENDIDO: 'ATENDIDA', AUSENTE: 'AUSENTE', RESERVADO: 'AGENDADA' };
  const tu = (await sq.query<any>(`SELECT jubilacion_cita_id FROM agenda_turnos WHERE id = :id`,
    { replacements: { id: turnoId }, type: QueryTypes.SELECT, transaction: t }))[0];
  if (!tu?.jubilacion_cita_id || !map[estado]) return;
  await sq.query(`UPDATE jubilacion_citas SET estado = :e WHERE id = :c AND deleted_at IS NULL`,
    { replacements: { e: map[estado], c: tu.jubilacion_cita_id }, transaction: t });
}

/** El agente reserva desde su enlace. Consume la habilitación. */
export async function reservarEnlace(sq: Sequelize, token: string, fecha: any, hora: any, telefono: any, motivo?: any, motivoOtro?: any) {
  if (!tokenValido(token)) throw new AgendaError('Enlace inválido', 404);
  const f = esFecha(fecha) ? String(fecha) : null;
  const h = normHora(hora);
  if (!f || !h) throw new AgendaError('Elegí un día y un horario');
  const tel = String(telefono ?? '').replace(/[^\d+ ()-]/g, '').trim().slice(0, 40) || null;

  const turnoId = await sq.transaction(async (t) => {
    const hab = (await sq.query<any>(
      `SELECT h.id, h.agenda_id, h.dni, h.estado, DATE_FORMAT(h.vence_el, '%Y-%m-%d') AS vence_el, a.nombre AS agenda_nombre,
              a.carga_jubilacion, a.activa, h.motivo
         FROM agenda_habilitaciones h JOIN agendas a ON a.id = h.agenda_id
        WHERE h.token = :token FOR UPDATE OF h`,
      { replacements: { token }, type: QueryTypes.SELECT, transaction: t }))[0];
    if (!hab) throw new AgendaError('Enlace inválido', 404);
    if (hab.estado === 'USADO') throw new AgendaError('Con este enlace ya se pidió un turno', 409, 'USADO');
    if (hab.estado !== 'HABILITADO' || !hab.activa) throw new AgendaError('Este enlace ya no permite pedir turno', 409, 'NO_HABILITADO');
    if (hab.vence_el < hoyAR()) {
      await sq.query(`UPDATE agenda_habilitaciones SET estado = 'VENCIDO' WHERE id = :id`, { replacements: { id: hab.id }, transaction: t });
      throw new AgendaError('El enlace venció. Pedí uno nuevo a la oficina.', 409, 'VENCIDO');
    }
    // el motivo de la oficina manda; si no puso, lo elige el agente
    const mot = hab.motivo ?? normalizarMotivo(motivo, motivoOtro, true);
    const cupo = await cupoDelHorario(sq, hab.agenda_id, f, h, false, t);
    const id = await insertarTurno(sq, t, {
      agendaId: hab.agenda_id, habilitacionId: hab.id, dni: hab.dni, fecha: f, hora: h, cupo,
      origen: 'ENLACE', telefono: tel, observaciones: null, userId: null, motivo: mot,
    });
    await sq.query(`UPDATE agenda_habilitaciones SET estado = 'USADO', turno_id = :tid, usado_at = NOW() WHERE id = :id`,
      { replacements: { tid: id, id: hab.id }, transaction: t });
    if (Number(hab.carga_jubilacion) && esMotivoJubilacion(mot)) await cargarEnJubilacion(sq, t, id, hab.agenda_nombre, null, null);
    return id;
  });
  logger.info({ msg: 'agenda_turnos reserva por enlace', turnoId });
  return estadoEnlace(sq, token);
}

/** El agente cancela su turno desde el enlace (hasta `cancelar_horas` antes). La habilitación sigue USADA. */
export async function cancelarEnlace(sq: Sequelize, token: string) {
  const e = await estadoEnlace(sq, token);
  if (!e.turno || e.turno.estado !== 'RESERVADO') throw new AgendaError('No hay un turno para cancelar', 409);
  if (!e.turno.puede_cancelar) throw new AgendaError(`Solo se puede cancelar hasta ${e.agenda.cancelar_horas} h antes. Comunicate con la oficina.`, 409);
  const hab = (await sq.query<any>(`SELECT turno_id FROM agenda_habilitaciones WHERE token = :token`, { replacements: { token }, type: QueryTypes.SELECT }))[0];
  await sq.transaction(async (t) => {
    await sq.query(`UPDATE agenda_turnos SET estado = 'CANCELADO', cancelado_at = NOW(), cancelado_por = 'AGENTE', gcal_pendiente = 1 WHERE id = :id AND estado = 'RESERVADO'`,
      { replacements: { id: hab.turno_id }, transaction: t });
    await sincronizarJubilacion(sq, t, hab.turno_id, 'CANCELADO');
  });
  return estadoEnlace(sq, token);
}

// ── Oficina ─────────────────────────────────────────────────────────────────

/** La oficina carga un turno a mano (por teléfono, en ventanilla). No usa habilitación y puede salir de la ventana. */
export async function reservarInterno(sq: Sequelize, agendaId: number, dni: number, fecha: any, hora: any,
  observaciones: string | null, userId: number | null, userNombre: string | null, motivo: string) {
  const f = esFecha(fecha) ? String(fecha) : null;
  const h = normHora(hora);
  if (!f || !h) throw new AgendaError('Falta día u horario');
  const agenda = await getAgenda(sq, agendaId);
  if (!agenda) throw new AgendaError('La agenda no existe', 404);
  const per = await sq.query<any>(`SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL`, { replacements: { dni }, type: QueryTypes.SELECT });
  if (!per[0]) throw new AgendaError('Ese DNI no está en el sistema', 404);
  return sq.transaction(async (t) => {
    const cupo = await cupoDelHorario(sq, agendaId, f, h, true, t);
    const id = await insertarTurno(sq, t, {
      agendaId, habilitacionId: null, dni, fecha: f, hora: h, cupo, origen: 'INTERNO', telefono: null, observaciones, userId, motivo,
    });
    // si tenía un enlace sin usar, queda usado (ya tiene turno)
    await sq.query(`UPDATE agenda_habilitaciones SET estado = 'USADO', turno_id = :tid, usado_at = NOW()
                     WHERE agenda_id = :a AND dni = :dni AND estado = 'HABILITADO'`,
      { replacements: { tid: id, a: agendaId, dni }, transaction: t });
    if (Number(agenda.carga_jubilacion) && esMotivoJubilacion(motivo)) await cargarEnJubilacion(sq, t, id, agenda.nombre, userId, userNombre);
    return id;
  });
}

export async function cambiarEstadoTurno(sq: Sequelize, id: number, estado: string, userId: number | null, observaciones?: string | null) {
  if (!['RESERVADO', 'ATENDIDO', 'AUSENTE', 'CANCELADO'].includes(estado)) throw new AgendaError('Estado inválido');
  await sq.transaction(async (t) => {
    const tu = (await sq.query<any>(`SELECT id, estado FROM agenda_turnos WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction: t }))[0];
    if (!tu) throw new AgendaError('El turno no existe', 404);
    if (tu.estado === 'CANCELADO' && estado !== 'CANCELADO') throw new AgendaError('Un turno cancelado no se reactiva: cargá uno nuevo', 409);
    try {
      await sq.query(
        `UPDATE agenda_turnos SET estado = :e, updated_by = :u, gcal_pendiente = 1,
                observaciones = COALESCE(:obs, observaciones),
                cancelado_at = IF(:e = 'CANCELADO' AND cancelado_at IS NULL, NOW(), cancelado_at),
                cancelado_por = IF(:e = 'CANCELADO' AND cancelado_por IS NULL, 'OFICINA', cancelado_por)
          WHERE id = :id`,
        { replacements: { e: estado, u: userId, obs: observaciones ?? null, id }, transaction: t });
    } catch (err: any) {
      if (err?.original?.code === 'ER_DUP_ENTRY') throw new AgendaError('El agente ya tiene otro turno reservado en esta agenda', 409);
      throw err;
    }
    await sincronizarJubilacion(sq, t, id, estado);
  });
}

// ── Turnos → citaciones (16/11/2026, pedido del usuario) ────────────────────
// Cada turno reservado aparece también en `citaciones` (página Citaciones / Atención al público).
// Lo hace el API cada 30 s (no el servidor público: su usuario MySQL no tiene permiso sobre
// citaciones). Cancelado/atendido/ausente → la citación se cierra; si se mueve, se actualiza.

let sincronizando = false;

// "Turno: Nacimiento — 20/11/2026 10:00 hs" (sin motivo: el nombre de la agenda)
const motivoTurno = (motivo: string, fecha: string, hora: string) =>
  `Turno: ${motivo} — ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)} ${hora.slice(0, 5)} hs`.slice(0, 255);

export async function sincronizarCitaciones(sq: Sequelize): Promise<{ creadas: number; cerradas: number; movidas: number }> {
  const res = { creadas: 0, cerradas: 0, movidas: 0 };
  if (esPublica(sq)) return res;
  await ensureAgendaTablas(sq);
  if (sincronizando) return res; // una corrida a la vez (el UPDATE ... citacion_id IS NULL cubre el resto)
  sincronizando = true;
  try {
    // 1) Turnos reservados (de hoy en adelante) sin citación → crear
    const nuevos = await sq.query<any>(
      `SELECT t.id, t.dni, DATE_FORMAT(t.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(t.hora, '%H:%i:%s') AS hora,
              t.origen, t.created_by, COALESCE(t.motivo, a.nombre) AS motivo
         FROM agenda_turnos t JOIN agendas a ON a.id = t.agenda_id
         JOIN personal p ON p.dni = t.dni
        WHERE t.estado = 'RESERVADO' AND t.citacion_id IS NULL AND t.fecha >= CURDATE()`,
      { type: QueryTypes.SELECT });
    for (const t of nuevos) {
      await sq.transaction(async (tx) => {
        const [cid] = await sq.query(
          `INSERT INTO citaciones (dni, citado_por, motivo, citacion_activa, fecha_citacion, created_by)
           VALUES (:dni, :por, :motivo, 1, :fh, :u)`,
          { replacements: { dni: t.dni, por: `Agenda de turnos (${t.origen === 'ENLACE' ? 'pedido por el agente' : 'oficina'})`.slice(0, 255),
            motivo: motivoTurno(t.motivo, t.fecha, t.hora), fh: `${t.fecha} ${t.hora}`, u: t.created_by ?? null }, transaction: tx });
        const [, meta]: any = await sq.query(`UPDATE agenda_turnos SET citacion_id = :c WHERE id = :id AND citacion_id IS NULL`,
          { replacements: { c: Number(cid), id: t.id }, transaction: tx });
        if (!Number(meta?.affectedRows ?? meta ?? 0)) throw new Error('turno ya sincronizado');
      }).then(() => { res.creadas++; }).catch((err) => logger.warn({ msg: 'agenda→citaciones crear', turno: t.id, error: err?.message }));
    }
    // 2) Turno cancelado/atendido/ausente → cerrar la citación que siga activa
    const [, m2]: any = await sq.query(
      `UPDATE citaciones c JOIN agenda_turnos t ON t.citacion_id = c.id
          SET c.citacion_activa = 0, c.cierre_citacion = NOW()
        WHERE t.estado <> 'RESERVADO' AND c.citacion_activa = 1 AND c.deleted_at IS NULL`);
    res.cerradas = Number(m2?.affectedRows ?? m2 ?? 0);
    // 3) Turno movido de día/hora → actualizar la citación activa
    const [, m3]: any = await sq.query(
      `UPDATE citaciones c JOIN agenda_turnos t ON t.citacion_id = c.id JOIN agendas a ON a.id = t.agenda_id
          SET c.fecha_citacion = TIMESTAMP(t.fecha, t.hora),
              c.motivo = LEFT(CONCAT('Turno: ', COALESCE(t.motivo, a.nombre), ' — ', DATE_FORMAT(t.fecha, '%d/%m/%Y'), ' ', TIME_FORMAT(t.hora, '%H:%i'), ' hs'), 255)
        WHERE t.estado = 'RESERVADO' AND c.citacion_activa = 1 AND c.deleted_at IS NULL
          AND (c.fecha_citacion <> TIMESTAMP(t.fecha, t.hora) OR c.motivo <> LEFT(CONCAT('Turno: ', COALESCE(t.motivo, a.nombre), ' — ', DATE_FORMAT(t.fecha, '%d/%m/%Y'), ' ', TIME_FORMAT(t.hora, '%H:%i'), ' hs'), 255))`);
    res.movidas = Number(m3?.affectedRows ?? m3 ?? 0);
  } finally {
    sincronizando = false;
  }
  return res;
}
