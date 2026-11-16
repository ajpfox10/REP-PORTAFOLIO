// src/routes/whatsappBot.routes.ts
// Configuración del bot de WhatsApp (página /app/whatsapp-bot, solo admin). El servidor público
// (/wa/webhook) solo valida la firma de Meta y anota el mensaje en whatsapp_bot_entrada; la API lo
// atiende (vigía de 2 s más abajo). Acá se edita lo que lee de la base: menú, textos, horario, credenciales.
//
//   GET    /estado                 config (secretos enmascarados) + opciones + modo + resumen
//   PUT    /config                 { valores: { k: v } } (secretos: "" = no cambiar, null = borrar)
//   POST   /probar-conexion        consulta el número en Meta con las credenciales cargadas
//   POST   /opciones               alta de opción · PUT /opciones/:id · DELETE /opciones/:id
//   PUT    /opciones-orden         { ids: [..] } en el orden nuevo
//   GET    /pedidos?estado=        PENDIENTE (default) | ATENDIDO | TODOS
//   PUT    /pedidos/:id            { estado: 'ATENDIDO' | 'PENDIENTE' }
//   GET    /chats                  últimas conversaciones · GET /chats/:tel/mensajes
//   POST   /chats/:tel/liberar     vuelve el chat al bot (sale de "con una persona")
//   POST   /simular                { texto, dni? } → lo que contestaría el bot (no envía nada)
//   POST   /simular/limpiar        borra lo generado por el simulador
//   GET    /resets                 cola de reseteos de clave de Gestiones Personales · POST /resets/:id/reintentar
// Además arranca un vigía (cada 20 s) que lanza el robot intranet_gp_resetear y avisa los resultados.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import {
  ensureBotTablas, leerEstado, invalidarConfig, CONFIG_DEFAULT, CONFIG_SECRETAS, menuNumerado, textoMenu,
  graph, simularMensaje, limpiarPruebas, dentroDeHorario, avisarResultadosReset, marcarLanzamientoReset, ROBOT_RESET,
  procesarBandeja, limpiarBandeja,
} from '../services/whatsappBot';
import { ensureVistaPublicaAgenda } from '../services/agendaTurnos';
import { ejecutarAhora } from '../services/robotsTareasWindows';

const ACCIONES = ['TEXTO', 'CERT_IOMA', 'CERT_TRABAJO', 'HUMANO', 'RESET_GP'];

const usuario = (req: Request): string | null => {
  const a = (req as any).auth;
  return a?.nombre ? `${a.apellido ?? ''} ${a.nombre}`.trim().slice(0, 120) : (a?.principalId ? `id ${a.principalId}` : null);
};

const enmascarar = (v: string) => (v ? `••••${v.slice(-4)}` : '');

function opcionDe(body: any): { ok: true; o: any } | { ok: false; error: string } {
  const titulo = String(body?.titulo ?? '').trim();
  if (!titulo) return { ok: false, error: 'El título es obligatorio' };
  if (titulo.length > 80) return { ok: false, error: 'El título no puede pasar de 80 caracteres' };
  const accion = String(body?.accion ?? 'TEXTO').toUpperCase();
  if (!ACCIONES.includes(accion)) return { ok: false, error: 'Acción inválida' };
  const respuesta = String(body?.respuesta ?? '').trim();
  if (accion === 'TEXTO' && !respuesta) return { ok: false, error: 'La respuesta es obligatoria' };
  if (accion === 'RESET_GP' && !respuesta) return { ok: false, error: 'Falta la pregunta de confirmación (la respuesta de la opción)' };
  if (respuesta.length > 3500) return { ok: false, error: 'La respuesta no puede pasar de 3500 caracteres (límite de WhatsApp: 4096)' };
  const palabras = String(body?.palabras ?? '').split(',').map(s => s.trim()).filter(Boolean).join(', ').slice(0, 300);
  return {
    ok: true,
    o: {
      titulo, accion, respuesta: respuesta || null, palabras: palabras || null,
      requiere_agente: body?.requiere_agente ? 1 : 0,
      registrar_pedido: body?.registrar_pedido ? 1 : 0,
      activa: body?.activa === undefined ? 1 : (body.activa ? 1 : 0),
    },
  };
}

/**
 * Fila del robot en la página Robots. Resetea de verdad SOLO contra la base de prod (personalv5);
 * con cualquier otra base (dev = personalv5_dev) solo simula. El comando se reescribe en cada arranque.
 * (El script tiene el mismo resguardo por su cuenta.)
 */
async function ensureRobotReset(sequelize: Sequelize) {
  const real = (process.env.DB_NAME || '').trim() === 'personalv5';
  const comando = real ? 'python resetear_clave_gp.py --resetear' : 'python resetear_clave_gp.py';
  await sequelize.query(
    `INSERT INTO robots_config (script, descripcion, grupo, orden, comando, reporta_solo, notas)
     VALUES (:s, 'Gestiones Personales: resetear clave (pedidos del bot de WhatsApp)', 'Intranet MS', 91, :comando, 0,
             'Lo lanza el bot de WhatsApp cuando un agente confirma el reseteo (cola gp_reset_cola). Busca la cuenta por DNI y aprieta Resetear clave: la clave provisoria queda en el número de documento. Si la cuenta está A CONFIRMAR, la confirma. Mismo perfil de Chrome de la Intranet: espera su turno. Conviene crear la tarea de Windows (cualquier horario) para que corra en la sesión interactiva. Log en logs/resetear_clave_gp/.')
     ON DUPLICATE KEY UPDATE comando = VALUES(comando)`,
    { replacements: { s: ROBOT_RESET, comando } });
  logger.info({ msg: 'wabot: robot de reseteo registrado', base: process.env.DB_NAME, modo: real ? 'REAL' : 'SIMULA' });
}

/** Cada 20 s: lanza el robot si hay pedidos de reseteo y avisa por WhatsApp los que terminaron. */
let vigiaIniciado = false;
function iniciarVigiaReset(sequelize: Sequelize) {
  if (vigiaIniciado || process.env.NODE_ENV === 'test') return;
  vigiaIniciado = true;
  let ocupado = false;
  ensureBotTablas(sequelize).then(() => ensureRobotReset(sequelize))
    .catch((err: any) => logger.warn({ msg: 'whatsapp_bot: no se registró el robot de reseteo', error: err?.message }));
  // Vista acotada que usa la página pública de la Agenda de turnos (servidor público, permisos mínimos)
  ensureVistaPublicaAgenda(sequelize)
    .catch((err: any) => logger.warn({ msg: 'agenda: no se creó la vista pública', error: err?.message }));

  // Cada 2 s: atiende lo que anotó el webhook del servidor público en whatsapp_bot_entrada
  let leyendo = false;
  let ultimaLimpieza = 0;
  setInterval(async () => {
    if (leyendo) return;
    leyendo = true;
    try {
      await procesarBandeja(sequelize);
      if (Date.now() - ultimaLimpieza > 6 * 3600_000) { ultimaLimpieza = Date.now(); await limpiarBandeja(sequelize); }
    } catch (err: any) {
      logger.error({ msg: 'wabot bandeja', error: err?.message });
    } finally { leyendo = false; }
  }, 2_000).unref();
  setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      if (await marcarLanzamientoReset(sequelize)) {
        const como = await ejecutarAhora(ROBOT_RESET);
        logger.info({ msg: 'wabot: robot de reseteo lanzado', como });
      }
      await avisarResultadosReset(sequelize);
    } catch (err: any) {
      logger.error({ msg: 'wabot vigía reseteo', error: err?.message });
    } finally { ocupado = false; }
  }, 20_000).unref();
}

export function buildWhatsappBotRouter(sequelize: Sequelize) {
  const router = Router();
  iniciarVigiaReset(sequelize);
  router.use(requirePermission('crud:*:*'));
  router.use(async (_req, res, next) => {
    try { await ensureBotTablas(sequelize); next(); }
    catch (err: any) { logger.error({ msg: 'whatsapp_bot tablas', error: err?.message }); res.status(500).json({ ok: false, error: 'No se pudieron crear las tablas del bot' }); }
  });
  const q = (sql: string, replacements: any = {}) => sequelize.query<any>(sql, { replacements, type: QueryTypes.SELECT });
  const fallo = (res: Response, err: any, msg: string) => {
    logger.error({ msg: `whatsapp_bot: ${msg}`, error: err?.message });
    return res.status(500).json({ ok: false, error: `${msg}: ${err?.message ?? err}` });
  };

  router.get('/estado', async (_req, res) => {
    try {
      invalidarConfig(sequelize);
      const e = await leerEstado(sequelize);
      const config: Record<string, string> = { ...e.c };
      for (const k of CONFIG_SECRETAS) config[k] = enmascarar(e.c[k]);
      const [hoy] = await q(`
        SELECT SUM(direccion = 'IN') AS recibidos, SUM(direccion = 'OUT' AND estado <> 'ERROR') AS enviados,
               SUM(direccion = 'OUT' AND estado = 'ERROR') AS errores
          FROM whatsapp_bot_mensajes WHERE created_at >= CURDATE() AND telefono NOT LIKE 'P%'`);
      const [ped] = await q(`SELECT COUNT(*) AS n FROM whatsapp_bot_pedidos WHERE estado = 'PENDIENTE' AND prueba = 0`);
      const [hum] = await q(`SELECT COUNT(*) AS n FROM whatsapp_bot_chats WHERE estado = 'HUMANO' AND humano_hasta > NOW() AND telefono NOT LIKE 'P%'`);
      // Dirección del túnel de la Agenda de turnos (mismo servidor público): sirve de referencia
      let tunel: { url: string; temporal: boolean } | null = null;
      try {
        const [r] = await q(`SELECT config_json FROM app_runtime_config WHERE config_key = 'agenda_turnos'`);
        const cj = r ? (typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json) : null;
        if (cj?.url_publica) tunel = { url: String(cj.url_publica), temporal: !!cj.url_publica_temporal || /trycloudflare\.com/i.test(cj.url_publica) };
      } catch { /* base sin agenda de turnos */ }
      return res.json({
        ok: true,
        data: {
          config,
          opciones: menuNumerado(e.opciones).concat(e.opciones.filter(o => !Number(o.activa)).map(o => ({ ...o, numero: 0 }))),
          vista_menu: textoMenu(e),
          credenciales: {
            token: !!e.token, phone_number_id: e.phoneId, app_secret: !!e.appSecret, verify_token: !!e.verifyToken,
            token_origen: e.c.wa_token ? 'pagina' : (process.env.WA_TOKEN ? 'env' : ''),
          },
          modo: e.simular ? 'SIMULADO' : 'REAL',
          activo: e.c.activo === '1',
          en_horario: dentroDeHorario(e.c),
          webhook: e.c.url_publica ? `${e.c.url_publica.replace(/\/+$/, '')}/wa/webhook` : '',
          hoy: { recibidos: Number(hoy?.recibidos || 0), enviados: Number(hoy?.enviados || 0), errores: Number(hoy?.errores || 0) },
          pedidos_pendientes: Number(ped?.n || 0),
          chats_con_persona: Number(hum?.n || 0),
          tunel_turnos: tunel,
        },
      });
    } catch (err) { return fallo(res, err, 'Error leyendo el estado del bot'); }
  });

  router.put('/config', async (req, res) => {
    try {
      const valores = req.body?.valores ?? {};
      if (typeof valores !== 'object') return res.status(400).json({ ok: false, error: 'valores inválidos' });
      let cambios = 0;
      for (const [k, raw] of Object.entries(valores)) {
        if (!(k in CONFIG_DEFAULT)) continue;
        const secreto = CONFIG_SECRETAS.includes(k);
        if (secreto && raw === '') continue; // vacío = no cambiar
        let v = raw === null ? null : String(raw);
        if (v !== null) {
          if (k === 'humano_horas' && !(Number(v) >= 1 && Number(v) <= 168)) return res.status(400).json({ ok: false, error: 'Horas con una persona: entre 1 y 168' });
          if (k === 'dni_max_intentos' && !(Number(v) >= 1 && Number(v) <= 10)) return res.status(400).json({ ok: false, error: 'Intentos de DNI: entre 1 y 10' });
          if (k === 'dni_bloqueo_min' && !(Number(v) >= 1 && Number(v) <= 1440)) return res.status(400).json({ ok: false, error: 'Minutos de bloqueo: entre 1 y 1440' });
          if ((k === 'horario_desde' || k === 'horario_hasta') && !/^\d{2}:\d{2}$/.test(v)) return res.status(400).json({ ok: false, error: 'Horario con formato HH:MM' });
          if (k === 'url_publica') v = v.trim().replace(/\/+$/, '');
          if (k === 'url_publica' && v && !/^https:\/\//i.test(v)) return res.status(400).json({ ok: false, error: 'La URL pública tiene que empezar con https://' });
          if (k === 'palabra_menu' && !v.trim()) return res.status(400).json({ ok: false, error: 'La palabra para volver al menú no puede quedar vacía' });
          if (v.length > 4000) return res.status(400).json({ ok: false, error: `${k}: texto demasiado largo` });
          if (secreto || k === 'wa_phone_number_id') v = v.trim();
        }
        await sequelize.query(
          `INSERT INTO whatsapp_bot_config (k, valor, updated_by) VALUES (:k, :v, :u)
           ON DUPLICATE KEY UPDATE valor = VALUES(valor), updated_by = VALUES(updated_by)`,
          { replacements: { k, v, u: usuario(req) } });
        cambios++;
      }
      invalidarConfig(sequelize);
      return res.json({ ok: true, cambios });
    } catch (err) { return fallo(res, err, 'Error guardando la configuración'); }
  });

  router.post('/probar-conexion', async (_req, res) => {
    try {
      invalidarConfig(sequelize);
      const e = await leerEstado(sequelize);
      if (!e.token || !e.phoneId) return res.status(400).json({ ok: false, error: 'Faltan el token o el Phone Number ID' });
      const info = await graph(e, `${e.phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`);
      return res.json({ ok: true, data: info });
    } catch (err: any) { return res.status(502).json({ ok: false, error: err?.message || 'Meta no respondió' }); }
  });

  // ─── opciones del menú ─────────────────────────────────────────────────────

  router.post('/opciones', async (req, res) => {
    try {
      const r = opcionDe(req.body);
      if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
      const [{ m }] = await q(`SELECT COALESCE(MAX(orden), 0) AS m FROM whatsapp_bot_opciones`);
      await sequelize.query(
        `INSERT INTO whatsapp_bot_opciones (orden, titulo, palabras, accion, respuesta, requiere_agente, registrar_pedido, activa, updated_by)
         VALUES (:orden, :titulo, :palabras, :accion, :respuesta, :requiere_agente, :registrar_pedido, :activa, :u)`,
        { replacements: { ...r.o, orden: Number(m) + 1, u: usuario(req) } });
      invalidarConfig(sequelize);
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'Error agregando la opción'); }
  });

  router.put('/opciones/:id', async (req, res) => {
    try {
      const r = opcionDe(req.body);
      if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
      const [, meta]: any = await sequelize.query(
        `UPDATE whatsapp_bot_opciones SET titulo = :titulo, palabras = :palabras, accion = :accion, respuesta = :respuesta,
                requiere_agente = :requiere_agente, registrar_pedido = :registrar_pedido, activa = :activa, updated_by = :u
          WHERE id = :id`,
        { replacements: { ...r.o, id: Number(req.params.id), u: usuario(req) } });
      invalidarConfig(sequelize);
      if ((meta?.affectedRows ?? meta) === 0) return res.status(404).json({ ok: false, error: 'La opción no existe' });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'Error guardando la opción'); }
  });

  router.delete('/opciones/:id', async (req, res) => {
    try {
      await sequelize.query(`DELETE FROM whatsapp_bot_opciones WHERE id = :id`, { replacements: { id: Number(req.params.id) } });
      invalidarConfig(sequelize);
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'Error borrando la opción'); }
  });

  router.put('/opciones-orden', async (req, res) => {
    try {
      const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => n > 0);
      if (!ids.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });
      await sequelize.transaction(async (t) => {
        for (let i = 0; i < ids.length; i++) {
          await sequelize.query(`UPDATE whatsapp_bot_opciones SET orden = :o WHERE id = :id`, { replacements: { o: i + 1, id: ids[i] }, transaction: t });
        }
      });
      invalidarConfig(sequelize);
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'Error reordenando el menú'); }
  });

  // ─── pedidos ───────────────────────────────────────────────────────────────

  router.get('/pedidos', async (req, res) => {
    try {
      const estado = String(req.query.estado || 'PENDIENTE').toUpperCase();
      const filtro = estado === 'TODOS' ? '' : 'AND pe.estado = :estado';
      const rows = await q(`
        SELECT pe.id, pe.telefono, pe.dni, pe.tipo, pe.estado, pe.created_at, pe.atendido_at, pe.atendido_por,
               p.apellido, p.nombre, c.nombre_wa
          FROM whatsapp_bot_pedidos pe
          LEFT JOIN personal p ON p.dni = pe.dni AND p.deleted_at IS NULL
          LEFT JOIN whatsapp_bot_chats c ON c.telefono = pe.telefono
         WHERE pe.prueba = 0 ${filtro}
         ORDER BY pe.created_at DESC LIMIT 500`, { estado });
      return res.json({ ok: true, data: rows });
    } catch (err) { return fallo(res, err, 'Error leyendo los pedidos'); }
  });

  router.put('/pedidos/:id', async (req, res) => {
    try {
      const estado = String(req.body?.estado || '').toUpperCase();
      if (!['ATENDIDO', 'PENDIENTE'].includes(estado)) return res.status(400).json({ ok: false, error: 'estado inválido' });
      await sequelize.query(
        `UPDATE whatsapp_bot_pedidos SET estado = :estado,
                atendido_at = ${estado === 'ATENDIDO' ? 'NOW()' : 'NULL'}, atendido_por = :u WHERE id = :id`,
        { replacements: { estado, u: estado === 'ATENDIDO' ? usuario(req) : null, id: Number(req.params.id) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'Error actualizando el pedido'); }
  });

  // ─── reseteos de clave (cola del robot) ────────────────────────────────────

  router.get('/resets', async (_req, res) => {
    try {
      const rows = await q(`
        SELECT r.id, r.dni, r.telefono, r.estado, r.detalle, r.created_at, r.lanzado_at, r.procesado_at, r.avisado, r.avisado_at,
               p.apellido, p.nombre
          FROM gp_reset_cola r
          LEFT JOIN personal p ON p.dni = r.dni AND p.deleted_at IS NULL
         WHERE r.prueba = 0
         ORDER BY r.id DESC LIMIT 300`);
      const [ult] = await q(`SELECT estado, motivo, actualizado_at FROM script_runs WHERE script = :s ORDER BY id DESC LIMIT 1`, { s: ROBOT_RESET })
        .catch(() => [] as any[]);
      return res.json({ ok: true, data: rows, ultima_corrida: ult ?? null });
    } catch (err) { return fallo(res, err, 'Error leyendo los reseteos'); }
  });

  // Reintentar un pedido que falló (vuelve a la cola y se relanza el robot)
  router.post('/resets/:id/reintentar', async (req, res) => {
    try {
      await sequelize.query(
        `UPDATE gp_reset_cola SET estado = 'PENDIENTE', detalle = NULL, lanzado_at = NULL, procesado_at = NULL, avisado = 0, avisado_at = NULL
          WHERE id = :id AND prueba = 0 AND estado IN ('ERROR','PROCESANDO')`,
        { replacements: { id: Number(req.params.id) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'Error reintentando el pedido'); }
  });

  // ─── conversaciones ────────────────────────────────────────────────────────

  router.get('/chats', async (_req, res) => {
    try {
      const rows = await q(`
        SELECT c.telefono, c.nombre_wa, c.dni, c.ultimo_in,
               IF(c.estado = 'HUMANO' AND c.humano_hasta > NOW(), 'HUMANO', 'MENU') AS estado, c.humano_hasta,
               p.apellido, p.nombre,
               (SELECT m.texto FROM whatsapp_bot_mensajes m WHERE m.telefono = c.telefono AND m.direccion = 'IN' ORDER BY m.id DESC LIMIT 1) AS ultimo_texto,
               (SELECT COUNT(*) FROM whatsapp_bot_mensajes m WHERE m.telefono = c.telefono) AS mensajes
          FROM whatsapp_bot_chats c
          LEFT JOIN personal p ON p.dni = c.dni AND p.deleted_at IS NULL
         WHERE c.telefono NOT LIKE 'P%'
         ORDER BY c.ultimo_in DESC LIMIT 300`);
      return res.json({ ok: true, data: rows });
    } catch (err) { return fallo(res, err, 'Error leyendo las conversaciones'); }
  });

  router.get('/chats/:tel/mensajes', async (req, res) => {
    try {
      const rows = await q(`
        SELECT id, direccion, tipo, texto, opcion, estado, error, created_at
          FROM whatsapp_bot_mensajes WHERE telefono = :tel ORDER BY id DESC LIMIT 200`, { tel: String(req.params.tel) });
      return res.json({ ok: true, data: rows.reverse() });
    } catch (err) { return fallo(res, err, 'Error leyendo los mensajes'); }
  });

  router.post('/chats/:tel/liberar', async (req, res) => {
    try {
      await sequelize.query(`UPDATE whatsapp_bot_chats SET estado = 'MENU', humano_hasta = NULL WHERE telefono = :tel`,
        { replacements: { tel: String(req.params.tel) } });
      return res.json({ ok: true });
    } catch (err) { return fallo(res, err, 'Error liberando el chat'); }
  });

  // ─── simulador ─────────────────────────────────────────────────────────────

  router.post('/simular', async (req, res) => {
    try {
      const texto = String(req.body?.texto ?? '').slice(0, 1000);
      if (!texto.trim()) return res.status(400).json({ ok: false, error: 'Escribí un mensaje' });
      const dni = Number(req.body?.dni) || null;
      return res.json({ ok: true, data: await simularMensaje(sequelize, texto, dni) });
    } catch (err) { return fallo(res, err, 'Error en el simulador'); }
  });

  router.post('/simular/limpiar', async (_req, res) => {
    try { await limpiarPruebas(sequelize); return res.json({ ok: true }); }
    catch (err) { return fallo(res, err, 'Error limpiando las pruebas'); }
  });

  return router;
}
