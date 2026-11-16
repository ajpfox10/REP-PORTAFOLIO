// src/services/whatsappBot.ts
// Bot de menú de WhatsApp por la API OFICIAL de Meta (Cloud API, número Business en coexistencia).
// Solo RESPONDE a quien escribe (gratis dentro de las 24 h): nunca inicia conversaciones.
//
// Todo se configura desde la página /app/whatsapp-bot (tablas whatsapp_bot_config y whatsapp_bot_opciones):
//   - menú: opciones en orden (el número que escribe la persona = posición entre las activas) + palabras clave
//   - acciones: TEXTO (responde un texto, opcional registra pedido) · CERT_IOMA (PDF del certificado) ·
//               RESET_GP (pide confirmación "SI" → cola gp_reset_cola → robot intranet_gp_resetear
//               resetea la clave de Gestiones Personales a su DNI → avisarResultadosReset le avisa) ·
//               HUMANO (el bot se calla N horas en ese chat; la palabra de menú lo reactiva)
//   - textos generales, horario de atención, credenciales de Meta, bot encendido/apagado
//
// Credenciales: lo cargado en la página tiene prioridad; si está vacío se usa el .env
// (WA_TOKEN, WA_PHONE_NUMBER_ID, WA_APP_SECRET, WA_VERIFY_TOKEN, WA_GRAPH_VERSION, WA_BOT_SIMULAR=1).
// Sin token o sin Phone Number ID el bot SIMULA: registra las respuestas y no envía nada a Meta.
//
// Lo usan dos procesos: el servidor público (webhook) y la API (página + simulador). La config se
// relee de la base cada 20 s, así que los cambios de la página llegan solos al webhook.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';
import { celularDe } from '../routes/licenciasMedicasControl.routes';
import { generarCertificadoIomaDocx } from '../routes/certificados.routes';
import { armarCertificadoLaboral, renderCertificadoLaboralDocx } from './certificadoLaboralDoc';

// ─── tablas ──────────────────────────────────────────────────────────────────

const listas = new WeakMap<Sequelize, Promise<void>>();
export function ensureBotTablas(sequelize: Sequelize): Promise<void> {
  let p = listas.get(sequelize);
  if (!p) {
    p = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_bot_config (
          k VARCHAR(60) NOT NULL PRIMARY KEY,
          valor TEXT NULL,
          updated_by VARCHAR(120) NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_bot_opciones (
          id INT AUTO_INCREMENT PRIMARY KEY,
          orden INT NOT NULL DEFAULT 0,
          titulo VARCHAR(80) NOT NULL,
          palabras VARCHAR(300) NULL,
          accion VARCHAR(20) NOT NULL DEFAULT 'TEXTO',
          respuesta TEXT NULL,
          requiere_agente TINYINT NOT NULL DEFAULT 0,
          registrar_pedido TINYINT NOT NULL DEFAULT 0,
          activa TINYINT NOT NULL DEFAULT 1,
          updated_by VARCHAR(120) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_bot_chats (
          telefono VARCHAR(20) NOT NULL PRIMARY KEY,
          nombre_wa VARCHAR(120) NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'MENU',
          humano_hasta DATETIME NULL,
          dni INT NULL,
          intentos_dni INT NOT NULL DEFAULT 0,
          bloqueado_hasta DATETIME NULL,
          ultimo_in DATETIME NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      // columnas agregadas después (bases donde la tabla ya existía)
      for (const col of ['intentos_dni INT NOT NULL DEFAULT 0', 'bloqueado_hasta DATETIME NULL']) {
        try { await sequelize.query(`ALTER TABLE whatsapp_bot_chats ADD COLUMN ${col}`); }
        catch (err: any) { if ((err?.original?.code ?? err?.parent?.code) !== 'ER_DUP_FIELDNAME') throw err; }
      }
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_bot_mensajes (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          wa_msg_id VARCHAR(128) NULL,
          telefono VARCHAR(20) NOT NULL,
          direccion VARCHAR(3) NOT NULL,
          tipo VARCHAR(20) NOT NULL,
          texto TEXT NULL,
          opcion VARCHAR(80) NULL,
          dni INT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'OK',
          error VARCHAR(500) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_wa_msg_id (wa_msg_id),
          KEY ix_tel_fecha (telefono, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_bot_pedidos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          telefono VARCHAR(20) NOT NULL,
          dni INT NULL,
          tipo VARCHAR(80) NOT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
          prueba TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          atendido_at DATETIME NULL,
          atendido_por VARCHAR(120) NULL,
          KEY ix_estado (estado, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      // Pedidos de reseteo de clave de Gestiones Personales: los procesa scripts/resetear_clave_gp.py
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS gp_reset_cola (
          id INT AUTO_INCREMENT PRIMARY KEY,
          dni INT NOT NULL,
          telefono VARCHAR(20) NOT NULL,
          opcion_id INT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
          detalle VARCHAR(500) NULL,
          prueba TINYINT NOT NULL DEFAULT 0,
          lanzado_at DATETIME NULL,
          procesado_at DATETIME NULL,
          avisado TINYINT NOT NULL DEFAULT 0,
          avisado_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY ix_estado (estado, prueba),
          KEY ix_dni (dni, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      // Bandeja de entrada: el servidor público (usuario de MySQL con permisos mínimos) solo puede
      // INSERTAR acá el cuerpo crudo del webhook ya validado; la API la lee y procesa (procesarBandeja).
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_bot_entrada (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          cuerpo MEDIUMTEXT NOT NULL,
          recibido_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
          procesado_at DATETIME NULL,
          error VARCHAR(500) NULL,
          KEY ix_estado (estado, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      // Lo único de la config que ve el servidor público: para validar que el webhook viene de Meta
      await sequelize.query(`
        CREATE OR REPLACE SQL SECURITY DEFINER VIEW v_publico_wa_claves AS
        SELECT k, valor FROM whatsapp_bot_config WHERE k IN ('wa_app_secret', 'wa_verify_token')`);
      // Menú inicial (solo si la tabla está vacía)
      const [{ n }] = await sequelize.query<any>(`SELECT COUNT(*) AS n FROM whatsapp_bot_opciones`, { type: QueryTypes.SELECT });
      if (!Number(n)) {
        for (const o of MENU_INICIAL) {
          await sequelize.query(
            `INSERT INTO whatsapp_bot_opciones (orden, titulo, palabras, accion, respuesta, requiere_agente, registrar_pedido)
             VALUES (:orden, :titulo, :palabras, :accion, :respuesta, :requiere_agente, :registrar_pedido)`,
            { replacements: o });
        }
      }
    })();
    p.catch(() => listas.delete(sequelize));
    listas.set(sequelize, p);
  }
  return p;
}

const MENU_INICIAL = [
  { orden: 1, titulo: 'Certificado para IOMA', palabras: 'ioma', accion: 'CERT_IOMA',
    respuesta: 'Certificado para IOMA 📄', requiere_agente: 1, registrar_pedido: 0 },
  { orden: 2, titulo: 'Resetear clave de Gestiones Personales (recibo de sueldo)', palabras: 'clave, contraseña, resetear, sueldo', accion: 'RESET_GP',
    respuesta: '🔑 Vamos a resetear tu clave de *Gestiones Personales* (Intranet, recibo de sueldo).\n\nTu clave provisoria va a ser tu *número de documento*.\n\n¿Confirmás? Respondé *SI* o *NO*.',
    requiere_agente: 1, registrar_pedido: 0 },
  { orden: 3, titulo: 'Hablar con una persona', palabras: 'humano, persona, operador, hablar', accion: 'HUMANO',
    respuesta: 'Listo 🙋 En breve te atiende una persona del área de Personal.', requiere_agente: 0, registrar_pedido: 1 },
  { orden: 4, titulo: 'Certificado de trabajo', palabras: 'certificado de trabajo, trabajo, laboral', accion: 'CERT_TRABAJO',
    respuesta: 'Certificado de trabajo 📄', requiere_agente: 1, registrar_pedido: 0 },
];

// ─── configuración ───────────────────────────────────────────────────────────

export const CONFIG_DEFAULT: Record<string, string> = {
  activo: '1',
  saludo: 'Hola 👋 Soy el asistente de *Personal*.\nEscribí el número de lo que necesitás:',
  pie: '',
  palabra_menu: 'MENU',
  humano_horas: '12',
  texto_volver_menu: 'Si querés volver al menú, escribí *{menu}*.',
  texto_preparando: 'Estoy preparando tu documento, aguardá unos segundos ⏳',
  texto_pedir_dni: 'Para seguir necesito validar que sos vos 🔒\nEscribí tu *DNI* (solo números, sin puntos).',
  texto_dni_invalido: 'Escribí solo los números de tu DNI, sin puntos ni espacios. Ej: 30123456',
  texto_dni_no_coincide: 'Ese DNI no coincide con el celular que tenemos registrado en Personal. Revisalo y escribilo de nuevo.\nSi cambiaste de número, hay que actualizarlo en Personal.',
  texto_dni_bloqueado: 'Hubo demasiados intentos con un DNI que no coincide. Probá de nuevo más tarde.',
  dni_max_intentos: '3',
  dni_bloqueo_min: '60',
  texto_error: 'No pudimos completar tu pedido en este momento 😕',
  texto_derivar: 'Escribí *{humano}* y te atiende una persona.',
  texto_solo_texto: 'Por ahora solo puedo leer mensajes de texto.',
  horario_activo: '0',
  horario_desde: '08:00',
  horario_hasta: '15:00',
  horario_dias: '1,2,3,4,5',
  texto_fuera_horario: 'Nuestro horario de atención es de lunes a viernes de 8 a 15 h. Te respondemos apenas volvamos 🙏',
  palabras_si: 'si, sí, s, dale, ok, confirmo',
  reset_cancelado: 'Listo, no se cambió nada.',
  reset_encolado: 'Listo ✅ Estamos reseteando tu clave. En unos minutos te avisamos por acá ⏳',
  reset_ok: '✅ {nombre}, tu clave de Gestiones Personales quedó reseteada.\n\nIngresá con tu *número de documento* como clave: el sistema te va a pedir que elijas una nueva.',
  reset_ya_provisoria: 'Tu cuenta de Gestiones Personales ya tiene como clave provisoria tu *número de documento*. Ingresá con ese número y el sistema te pide una nueva.',
  reset_sin_cuenta: 'No encontramos una cuenta de Gestiones Personales con tu DNI. Primero hay que pedir la cuenta en la Intranet.',
  reset_en_curso: 'Tu pedido de reseteo ya está en proceso ⏳ Te avisamos por acá cuando esté listo.',
  reset_ya_hecho: 'Tu clave ya se reseteó en las últimas 24 h: la clave provisoria es tu *número de documento*.',
  url_publica: '',
  simular: '0',
  wa_token: '',
  wa_phone_number_id: '',
  wa_app_secret: '',
  wa_verify_token: '',
  wa_graph_version: 'v23.0',
};
export const CONFIG_SECRETAS = ['wa_token', 'wa_app_secret', 'wa_verify_token'];

export type Opcion = {
  id: number; orden: number; titulo: string; palabras: string | null; accion: 'TEXTO' | 'CERT_IOMA' | 'CERT_TRABAJO' | 'HUMANO' | 'RESET_GP';
  respuesta: string | null; requiere_agente: number; registrar_pedido: number; activa: number;
};

type Estado = {
  c: Record<string, string>; opciones: Opcion[];
  token: string; phoneId: string; appSecret: string; verifyToken: string; graph: string; simular: boolean;
};
const cache = new WeakMap<Sequelize, { hasta: number; estado: Estado }>();

export function invalidarConfig(sequelize: Sequelize) { cache.delete(sequelize); }

export async function leerEstado(sequelize: Sequelize): Promise<Estado> {
  const hit = cache.get(sequelize);
  if (hit && hit.hasta > Date.now()) return hit.estado;
  await ensureBotTablas(sequelize);
  const rows = await sequelize.query<any>(`SELECT k, valor FROM whatsapp_bot_config`, { type: QueryTypes.SELECT });
  const c: Record<string, string> = { ...CONFIG_DEFAULT };
  for (const r of rows) if (r.valor !== null && r.valor !== undefined) c[r.k] = String(r.valor);
  const opciones = await sequelize.query<Opcion>(
    `SELECT id, orden, titulo, palabras, accion, respuesta, requiere_agente, registrar_pedido, activa
       FROM whatsapp_bot_opciones ORDER BY orden, id`, { type: QueryTypes.SELECT });
  const token = c.wa_token || process.env.WA_TOKEN || '';
  const phoneId = c.wa_phone_number_id || process.env.WA_PHONE_NUMBER_ID || '';
  const estado: Estado = {
    c, opciones, token, phoneId,
    appSecret: c.wa_app_secret || process.env.WA_APP_SECRET || '',
    verifyToken: c.wa_verify_token || process.env.WA_VERIFY_TOKEN || '',
    graph: `https://graph.facebook.com/${c.wa_graph_version || process.env.WA_GRAPH_VERSION || 'v23.0'}`,
    simular: c.simular === '1' || process.env.WA_BOT_SIMULAR === '1' || !token || !phoneId,
  };
  cache.set(sequelize, { hasta: Date.now() + 20_000, estado });
  return estado;
}

/** Opciones activas con el número que ve la persona (1..n). */
export function menuNumerado(opciones: Opcion[]) {
  return opciones.filter(o => Number(o.activa)).map((o, i) => ({ ...o, numero: i + 1 }));
}

export function textoMenu(e: Pick<Estado, 'c' | 'opciones'>): string {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const lineas = menuNumerado(e.opciones).map(o => `${emojis[o.numero - 1] ?? `${o.numero}.`} ${o.titulo}`);
  return [e.c.saludo, '', ...lineas, ...(e.c.pie ? ['', e.c.pie] : [])].join('\n').trim();
}

// ─── identificación: DNI + celular registrado ────────────────────────────────
// Regla: para cualquier opción "solo agentes" la persona escribe su DNI y el número desde el que
// escribe TIENE que ser uno de los celulares cargados en personal.telefono de ese DNI (y el agente,
// activo). Nunca se identifica solo por el teléfono ni solo por el DNI.

export type Agente = { dni: number; apellido: string; nombre: string; activo: boolean; telefono?: string | null };

/** Normaliza el wa_id de Meta (549XXXXXXXXXX) igual que celularDe. */
export function normalizarWa(waId: string): string {
  const d = String(waId).replace(/\D/g, '');
  return celularDe(d).celular ?? d;
}

async function agentePorDni(sequelize: Sequelize, dni: number): Promise<Agente | null> {
  const [r] = await sequelize.query<any>(
    `SELECT p.dni, p.apellido, p.nombre, p.telefono,
            EXISTS(SELECT 1 FROM agentes a WHERE a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO') AS activo
       FROM personal p WHERE p.dni = :dni AND p.deleted_at IS NULL LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT });
  return r ? { dni: Number(r.dni), apellido: r.apellido ?? '', nombre: r.nombre ?? '', activo: !!Number(r.activo), telefono: r.telefono ?? null } : null;
}

/** Agente ACTIVO con ese DNI cuyo celular registrado coincide con `celular`; si no, null (sin decir por qué). */
export async function verificarDniCelular(sequelize: Sequelize, dni: number, celular: string): Promise<Agente | null> {
  const ag = await agentePorDni(sequelize, dni);
  if (!ag || !ag.activo || !celular) return null;
  return celularDe(ag.telefono).opciones.some(o => o.celular === celular) ? ag : null;
}

// ─── DOCX → PDF (Word por COM, de a uno) ─────────────────────────────────────

let colaWord: Promise<unknown> = Promise.resolve();

export function docxAPdf(docx: Buffer): Promise<Buffer> {
  const tarea = colaWord.then(() => convertir(docx));
  colaWord = tarea.catch(() => undefined);
  return tarea;
}

function convertir(docx: Buffer): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-'));
  const entrada = path.join(dir, 'cert.docx');
  const salida = path.join(dir, 'cert.pdf');
  fs.writeFileSync(entrada, docx);
  const ps =
    `$ErrorActionPreference='Stop'; $w = New-Object -ComObject Word.Application; ` +
    `try { $w.Visible=$false; $w.DisplayAlerts=0; $d = $w.Documents.Open($env:WABOT_IN, $false, $true); ` +
    `$d.SaveAs2($env:WABOT_OUT, 17); $d.Close(0) } finally { $w.Quit() }`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 90_000, windowsHide: true, env: { ...process.env, WABOT_IN: entrada, WABOT_OUT: salida } },
      (err, _out, stderr) => {
        try {
          if (err) return reject(new Error(`Word no convirtió a PDF: ${String(stderr || err.message).slice(0, 300)}`));
          resolve(fs.readFileSync(salida));
        } catch (e) { reject(e); }
        finally { fs.rmSync(dir, { recursive: true, force: true }); }
      });
  });
}

// ─── envío a Meta ────────────────────────────────────────────────────────────

export async function graph(e: Estado, pathUrl: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${e.graph}/${pathUrl}`, { ...init, headers: { Authorization: `Bearer ${e.token}`, ...(init.headers || {}) } });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta ${res.status}: ${body?.error?.message || JSON.stringify(body).slice(0, 200)}`);
  return body;
}

/** Contexto de una conversación: real (webhook) o prueba (simulador de la página). */
type Ctx = {
  sequelize: Sequelize; e: Estado; tel: string;
  prueba: boolean; salida: Array<{ tipo: 'text' | 'document'; texto: string; archivo?: string; pdf_base64?: string }>;
  /** Celular (549XXXXXXXXXX) contra el que se valida el DNI: el que escribe (real) o el simulado. */
  celular: string;
};

async function registrarSalida(ctx: Ctx, tipo: string, texto: string, opcion: string | null, dni: number | null, estado: string, error: string | null = null) {
  await ctx.sequelize.query(
    `INSERT INTO whatsapp_bot_mensajes (telefono, direccion, tipo, texto, opcion, dni, estado, error)
     VALUES (:telefono, 'OUT', :tipo, :texto, :opcion, :dni, :estado, :error)`,
    { replacements: { telefono: ctx.tel, tipo, texto, opcion: opcion?.slice(0, 80) ?? null, dni, estado, error: error?.slice(0, 500) ?? null } });
}

const modo = (ctx: Ctx) => (ctx.prueba ? 'PRUEBA' : ctx.e.simular ? 'SIMULADO' : 'OK');

async function enviarTexto(ctx: Ctx, texto: string, opcion: string | null = null, dni: number | null = null) {
  try {
    if (ctx.prueba) ctx.salida.push({ tipo: 'text', texto });
    else if (ctx.e.simular) logger.info({ msg: 'wabot SIMULADO texto', to: ctx.tel, texto });
    else {
      await graph(ctx.e, `${ctx.e.phoneId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: ctx.tel, type: 'text', text: { body: texto, preview_url: false } }),
      });
    }
    await registrarSalida(ctx, 'text', texto, opcion, dni, modo(ctx));
  } catch (err: any) {
    await registrarSalida(ctx, 'text', texto, opcion, dni, 'ERROR', err?.message);
    throw err;
  }
}

async function enviarPdf(ctx: Ctx, pdf: Buffer, nombreArchivo: string, caption: string, opcion: string, dni: number) {
  try {
    if (ctx.prueba) {
      ctx.salida.push({ tipo: 'document', texto: caption, archivo: nombreArchivo, pdf_base64: pdf.toString('base64') });
    } else if (ctx.e.simular) {
      const dir = path.join(process.cwd(), 'logs', 'whatsapp-bot');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${Date.now()}_${nombreArchivo}`), pdf);
      logger.info({ msg: 'wabot SIMULADO pdf', to: ctx.tel, nombreArchivo });
    } else {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'application/pdf');
      form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), nombreArchivo);
      const media = await graph(ctx.e, `${ctx.e.phoneId}/media`, { method: 'POST', body: form });
      await graph(ctx.e, `${ctx.e.phoneId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: ctx.tel, type: 'document', document: { id: media.id, filename: nombreArchivo, caption } }),
      });
    }
    await registrarSalida(ctx, 'document', `${nombreArchivo} — ${caption}`, opcion, dni, modo(ctx));
  } catch (err: any) {
    await registrarSalida(ctx, 'document', nombreArchivo, opcion, dni, 'ERROR', err?.message);
    throw err;
  }
}

// ─── lógica del menú ─────────────────────────────────────────────────────────

export type MensajeEntrante = { id: string; from: string; tipo: string; texto: string; nombre?: string };

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Qué eligió la persona: 'MENU', una opción del menú o null (texto que no entiende). */
export function elegir(texto: string, e: Pick<Estado, 'c' | 'opciones'>): 'MENU' | (Opcion & { numero: number }) | null {
  const t = norm(texto);
  if (!t) return null;
  const menu = menuNumerado(e.opciones);
  const palabraMenu = norm(e.c.palabra_menu || 'menu');
  if (t === palabraMenu || t === 'menu' || t === '0') return 'MENU';
  const num = t.match(/^(\d{1,2})(️?⃣)?\s*[.)-]?$/);
  if (num) return menu.find(o => o.numero === Number(num[1])) ?? null;
  for (const o of menu) {
    for (const p of String(o.palabras || '').split(',').map(norm).filter(Boolean)) {
      if (new RegExp(`(^|[^a-z0-9])${escRe(p)}([^a-z0-9]|$)`).test(t)) return o;
    }
  }
  return null;
}

const nombreCorto = (a: Agente | null) => {
  const n = String(a?.nombre || '').trim().split(/\s+/)[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
};

/** {nombre} {menu} {humano} en los textos configurables. */
function completar(texto: string, ctx: Ctx, agente: Agente | null): string {
  const humano = menuNumerado(ctx.e.opciones).find(o => o.accion === 'HUMANO');
  return String(texto || '')
    .replace(/\{nombre\}/g, nombreCorto(agente))
    .replace(/\{menu\}/g, ctx.e.c.palabra_menu || 'MENU')
    .replace(/\{humano\}/g, humano ? String(humano.numero) : '');
}

function derivar(ctx: Ctx, agente: Agente | null): string {
  const humano = menuNumerado(ctx.e.opciones).some(o => o.accion === 'HUMANO');
  return humano && ctx.e.c.texto_derivar ? `\n\n${completar(ctx.e.c.texto_derivar, ctx, agente)}` : '';
}

export function dentroDeHorario(c: Record<string, string>, ahora = new Date()): boolean {
  if (c.horario_activo !== '1') return true;
  const dias = String(c.horario_dias || '').split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x));
  if (!dias.includes(ahora.getDay())) return false;
  const hhmm = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  return hhmm >= (c.horario_desde || '00:00') && hhmm < (c.horario_hasta || '23:59');
}

async function chatDe(sequelize: Sequelize, telefono: string) {
  const [row] = await sequelize.query<any>(
    `SELECT estado, dni, intentos_dni, humano_hasta > NOW() AS humano_vigente, bloqueado_hasta > NOW() AS bloqueado
       FROM whatsapp_bot_chats WHERE telefono = :telefono`,
    { replacements: { telefono }, type: QueryTypes.SELECT });
  return row ?? null;
}

/** Intentos de DNI que no coinciden; al llegar al máximo se bloquea el chat un rato. */
async function guardarIntentos(ctx: Ctx, intentos: number, bloquearMin = 0) {
  await ctx.sequelize.query(
    `UPDATE whatsapp_bot_chats SET intentos_dni = :i,
            bloqueado_hasta = ${bloquearMin ? 'NOW() + INTERVAL :m MINUTE' : 'bloqueado_hasta'}
      WHERE telefono = :tel`,
    { replacements: { i: intentos, m: bloquearMin, tel: ctx.tel } });
}

/** humano_hasta = hasta cuándo vale el estado (HUMANO: horas; CONFIRMA:<id>: minutos para contestar). */
async function guardarChat(ctx: Ctx, campos: { estado?: string; humanoHoras?: number; esperaMin?: number; nombre?: string; dni?: number | null }) {
  const hasta = campos.humanoHoras ? 'NOW() + INTERVAL :horas HOUR' : campos.esperaMin ? 'NOW() + INTERVAL :minutos MINUTE' : 'NULL';
  await ctx.sequelize.query(
    `INSERT INTO whatsapp_bot_chats (telefono, nombre_wa, estado, humano_hasta, dni, ultimo_in)
     VALUES (:telefono, :nombre, :estado, ${hasta}, :dni, NOW())
     ON DUPLICATE KEY UPDATE
       nombre_wa = COALESCE(VALUES(nombre_wa), nombre_wa),
       estado = ${campos.estado ? 'VALUES(estado)' : 'estado'},
       humano_hasta = ${campos.estado ? 'VALUES(humano_hasta)' : 'humano_hasta'},
       dni = COALESCE(VALUES(dni), dni),
       ultimo_in = NOW()`,
    { replacements: { telefono: ctx.tel, nombre: campos.nombre ?? null, estado: campos.estado ?? 'MENU', horas: campos.humanoHoras ?? 0, minutos: campos.esperaMin ?? 0, dni: campos.dni ?? null } });
}

// ─── reseteo de clave de Gestiones Personales (robot intranet_gp_resetear) ───

export const ROBOT_RESET = 'intranet_gp_resetear';

/** Último pedido de las últimas 24 h de ese DNI (para no resetear dos veces ni encolar repetido). */
async function resetReciente(sequelize: Sequelize, dni: number, prueba: boolean) {
  const [r] = await sequelize.query<any>(
    `SELECT estado FROM gp_reset_cola
      WHERE dni = :dni AND prueba = :prueba AND created_at >= NOW() - INTERVAL 24 HOUR
        AND estado IN ('PENDIENTE','PROCESANDO','OK','YA_PROVISORIA','SIMULADO')
      ORDER BY id DESC LIMIT 1`,
    { replacements: { dni, prueba: prueba ? 1 : 0 }, type: QueryTypes.SELECT });
  return r?.estado as string | undefined;
}

async function encolarReset(ctx: Ctx, agente: Agente, op: Opcion, opTxt: string) {
  const { e } = ctx;
  await ctx.sequelize.query(
    `INSERT INTO gp_reset_cola (dni, telefono, opcion_id, estado, prueba, avisado)
     VALUES (:dni, :tel, :op, :estado, :prueba, :avisado)`,
    { replacements: { dni: agente.dni, tel: ctx.tel, op: op.id, estado: ctx.prueba ? 'SIMULADO' : 'PENDIENTE', prueba: ctx.prueba ? 1 : 0, avisado: ctx.prueba ? 1 : 0 } });
  await guardarChat(ctx, { estado: 'MENU', dni: agente.dni });
  if (op.registrar_pedido) await nuevoPedido(ctx, agente.dni, op.titulo);
  await enviarTexto(ctx, completar(e.c.reset_encolado, ctx, agente), opTxt, agente.dni);
  if (ctx.prueba) {
    await enviarTexto(ctx, `🧪 (Simulación: no se lanza el robot. Si sale bien, cuando termine le llega esto:)\n\n${completar(e.c.reset_ok, ctx, agente)}`, opTxt, agente.dni);
  }
}

/** Texto final según lo que dejó el robot en la cola. */
function textoResultadoReset(ctx: Ctx, estado: string, agente: Agente | null): string {
  const c = ctx.e.c;
  switch (estado) {
    case 'OK': return completar(c.reset_ok, ctx, agente);
    case 'YA_PROVISORIA': return completar(c.reset_ya_provisoria, ctx, agente);
    case 'SIN_CUENTA': return `${completar(c.reset_sin_cuenta, ctx, agente)}${derivar(ctx, agente)}`;
    case 'SIMULADO': return '🧪 El robot de reseteo está en modo simulación (servidor de prueba): no se cambió ninguna clave.';
    default: return `${completar(c.texto_error, ctx, agente)}${derivar(ctx, agente)}`;
  }
}

/**
 * Avisa por WhatsApp el resultado de los reseteos que terminó el robot (lo llama el API cada 20 s).
 * Si pasaron más de 23 h desde el pedido, ya no se puede escribir gratis: queda como pedido para una persona.
 */
export async function avisarResultadosReset(sequelize: Sequelize): Promise<number> {
  await ensureBotTablas(sequelize);
  const rows = await sequelize.query<any>(
    `SELECT id, dni, telefono, estado, detalle, created_at < NOW() - INTERVAL 23 HOUR AS vencido
       FROM gp_reset_cola
      WHERE avisado = 0 AND prueba = 0 AND estado IN ('OK','YA_PROVISORIA','SIN_CUENTA','ERROR','SIMULADO')
      ORDER BY id LIMIT 20`, { type: QueryTypes.SELECT });
  if (!rows.length) return 0;
  const e = await leerEstado(sequelize);
  for (const r of rows) {
    const ctx: Ctx = { sequelize, e, tel: r.telefono, celular: '', prueba: false, salida: [] };
    const agente = await agentePorDni(sequelize, Number(r.dni));
    let avisado = 1;
    try {
      if (Number(r.vencido)) {
        avisado = 2;
        await nuevoPedido(ctx, Number(r.dni), `Reseteo de clave ${r.estado} (no se pudo avisar: pasaron 24 h)`);
      } else {
        if (r.estado === 'ERROR') await nuevoPedido(ctx, Number(r.dni), 'Reseteo de clave: falló el robot');
        await enviarTexto(ctx, textoResultadoReset(ctx, r.estado, agente), `Reseteo de clave: ${r.estado}`, Number(r.dni));
      }
    } catch (err: any) {
      avisado = 3; // no salió el mensaje: queda registrado en whatsapp_bot_mensajes con el error
      logger.error({ msg: 'wabot aviso reseteo', id: r.id, error: err?.message });
    }
    await sequelize.query(`UPDATE gp_reset_cola SET avisado = :a, avisado_at = NOW() WHERE id = :id`, { replacements: { a: avisado, id: r.id } });
  }
  return rows.length;
}

/**
 * Hay pedidos pendientes sin robot lanzado en los últimos 30 min → los marca y devuelve true.
 * (Si el robot está esperando su turno de la Intranet, relanzarlo no hace nada: la tarea de
 * Windows tiene MultipleInstances IgnoreNew y el robot procesa toda la cola de una.)
 */
export async function marcarLanzamientoReset(sequelize: Sequelize): Promise<boolean> {
  await ensureBotTablas(sequelize);
  const [, meta]: any = await sequelize.query(
    `UPDATE gp_reset_cola SET lanzado_at = NOW()
      WHERE estado = 'PENDIENTE' AND prueba = 0 AND (lanzado_at IS NULL OR lanzado_at < NOW() - INTERVAL 30 MINUTE)`);
  return Number(meta?.affectedRows ?? meta ?? 0) > 0;
}

async function nuevoPedido(ctx: Ctx, dni: number | null, tipo: string) {
  await ctx.sequelize.query(`INSERT INTO whatsapp_bot_pedidos (telefono, dni, tipo, prueba) VALUES (:telefono, :dni, :tipo, :prueba)`,
    { replacements: { telefono: ctx.tel, dni, tipo: tipo.slice(0, 80), prueba: ctx.prueba ? 1 : 0 } });
}

/** Opciones que necesitan saber quién es: siempre piden DNI + celular registrado. */
const necesitaAgente = (op: Opcion) =>
  !!Number(op.requiere_agente) || op.accion === 'CERT_IOMA' || op.accion === 'CERT_TRABAJO' || op.accion === 'RESET_GP';

async function atender(ctx: Ctx, m: MensajeEntrante): Promise<void> {
  const { sequelize, e } = ctx;
  const esTexto = m.tipo === 'text' || m.tipo === 'interactive' || m.tipo === 'button';
  const op = esTexto ? elegir(m.texto, e) : null;
  const opTxt = op === 'MENU' ? 'MENU' : op ? `${op.numero}. ${op.titulo}` : null;

  const [, meta]: any = await sequelize.query(
    `INSERT IGNORE INTO whatsapp_bot_mensajes (wa_msg_id, telefono, direccion, tipo, texto, opcion, estado)
     VALUES (:id, :tel, 'IN', :tipo, :texto, :op, :estado)`,
    { replacements: { id: m.id, tel: ctx.tel, tipo: m.tipo, texto: String(m.texto ?? '').slice(0, 4000), op: opTxt?.slice(0, 80) ?? null, estado: ctx.prueba ? 'PRUEBA' : 'OK' } });
  const afectadas = typeof meta === 'number' ? meta : meta?.affectedRows;
  if (afectadas === 0) return; // Meta reintentó un mensaje ya procesado

  if (e.c.activo !== '1') { await guardarChat(ctx, { nombre: m.nombre }); return; } // bot apagado: solo registra

  const chat = await chatDe(sequelize, ctx.tel);
  const estadoChat = String(chat?.estado || '');
  const vigente = !!Number(chat?.humano_vigente);

  // Con una persona: el bot no contesta, salvo que pida volver al menú
  if (estadoChat === 'HUMANO' && vigente && op !== 'MENU') {
    await guardarChat(ctx, { nombre: m.nombre });
    return;
  }

  // Esperando el DNI para una opción "solo agentes"
  if (estadoChat.startsWith('PIDE_DNI:') && vigente && op !== 'MENU') {
    const opc = menuNumerado(e.opciones).find(o => o.id === Number(estadoChat.slice(9)));
    if (opc) { await recibirDni(ctx, m, chat, opc); return; }
  }

  // Esperando que confirme (reseteo de clave). El DNI ya se validó: quedó en el chat.
  if (estadoChat.startsWith('CONFIRMA:') && vigente && op !== 'MENU') {
    const opc = menuNumerado(e.opciones).find(o => o.id === Number(estadoChat.slice(9)));
    const agente = chat?.dni ? await agentePorDni(sequelize, Number(chat.dni)) : null;
    const t = norm(m.texto);
    const si = String(e.c.palabras_si || 'si').split(',').map(norm).filter(Boolean).some(p => t === p || t.startsWith(`${p} `));
    if (si && opc && agente?.activo) {
      await encolarReset(ctx, agente, opc, `${opc.numero}. ${opc.titulo}: confirmó`);
    } else {
      await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre });
      await enviarTexto(ctx, `${completar(e.c.reset_cancelado, ctx, null)}\n\n${textoMenu(e)}`, 'CANCELADO', null);
    }
    return;
  }

  if (!op || op === 'MENU') {
    await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre });
    const aviso = esTexto ? '' : `${e.c.texto_solo_texto}\n\n`;
    await enviarTexto(ctx, `${aviso}${textoMenu(e)}`, 'MENU', null);
    return;
  }

  // Solo agentes: SIEMPRE se pide el DNI (y se valida contra el celular registrado)
  if (necesitaAgente(op)) {
    if (Number(chat?.bloqueado)) {
      await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre });
      await enviarTexto(ctx, `${completar(e.c.texto_dni_bloqueado, ctx, null)}${derivar(ctx, null)}`, opTxt, null);
      return;
    }
    await guardarChat(ctx, { estado: `PIDE_DNI:${op.id}`, esperaMin: 10, nombre: m.nombre });
    await enviarTexto(ctx, completar(e.c.texto_pedir_dni, ctx, null), opTxt, null);
    return;
  }

  const respuesta = completar(op.respuesta || '', ctx, null);

  if (op.accion === 'HUMANO') {
    const horas = Math.max(1, Number(e.c.humano_horas) || 12);
    await guardarChat(ctx, { estado: 'HUMANO', humanoHoras: horas, nombre: m.nombre });
    if (op.registrar_pedido) await nuevoPedido(ctx, null, op.titulo);
    const fuera = dentroDeHorario(e.c) ? '' : `\n\n${completar(e.c.texto_fuera_horario, ctx, null)}`;
    const volver = e.c.texto_volver_menu ? `\n\n${completar(e.c.texto_volver_menu, ctx, null)}` : '';
    await enviarTexto(ctx, `${respuesta}${fuera}${volver}`, opTxt, null);
    return;
  }

  // TEXTO para cualquiera
  await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre });
  if (op.registrar_pedido) await nuevoPedido(ctx, null, op.titulo);
  await enviarTexto(ctx, respuesta || textoMenu(e), opTxt, null);
}

/** Llegó la respuesta al "escribí tu DNI". */
async function recibirDni(ctx: Ctx, m: MensajeEntrante, chat: any, op: Opcion & { numero: number }) {
  const { e } = ctx;
  const opTxt = `${op.numero}. ${op.titulo}: DNI`;
  const dniTxt = String(m.texto || '').replace(/[.\s-]/g, '');
  if (!/^\d{7,8}$/.test(dniTxt)) {
    await guardarChat(ctx, { estado: `PIDE_DNI:${op.id}`, esperaMin: 10, nombre: m.nombre });
    await enviarTexto(ctx, completar(e.c.texto_dni_invalido, ctx, null), opTxt, null);
    return;
  }
  const agente = await verificarDniCelular(ctx.sequelize, Number(dniTxt), ctx.celular);
  if (!agente) {
    const max = Math.max(1, Number(e.c.dni_max_intentos) || 3);
    const intentos = Number(chat?.intentos_dni || 0) + 1;
    if (intentos >= max) {
      await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre });
      await guardarIntentos(ctx, 0, Math.max(1, Number(e.c.dni_bloqueo_min) || 60));
      await enviarTexto(ctx, `${completar(e.c.texto_dni_bloqueado, ctx, null)}${derivar(ctx, null)}`, opTxt, null);
    } else {
      await guardarChat(ctx, { estado: `PIDE_DNI:${op.id}`, esperaMin: 10, nombre: m.nombre });
      await guardarIntentos(ctx, intentos);
      await enviarTexto(ctx, `${completar(e.c.texto_dni_no_coincide, ctx, null)}${derivar(ctx, null)}`, opTxt, null);
    }
    return;
  }
  await guardarIntentos(ctx, 0);
  await ejecutarOpcion(ctx, m, op, agente);
}

/** Opción "solo agentes" con el agente ya validado (DNI + celular). */
async function ejecutarOpcion(ctx: Ctx, m: MensajeEntrante, op: Opcion & { numero: number }, agente: Agente) {
  const { sequelize, e } = ctx;
  const opTxt = `${op.numero}. ${op.titulo}`;
  const dni = agente.dni;
  const hola = `Hola ${nombreCorto(agente)} 👋\n`;
  const respuesta = completar(op.respuesta || '', ctx, agente);
  // si la respuesta ya nombra a la persona ({nombre}), no se antepone el "Hola X"
  const holaOp = /\{nombre\}/.test(op.respuesta || '') ? '' : hola;

  if (op.accion === 'RESET_GP') {
    const previo = await resetReciente(sequelize, dni, ctx.prueba);
    if (previo === 'PENDIENTE' || previo === 'PROCESANDO') {
      await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre, dni });
      await enviarTexto(ctx, completar(e.c.reset_en_curso, ctx, agente), opTxt, dni);
    } else if (previo) {
      await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre, dni });
      await enviarTexto(ctx, completar(e.c.reset_ya_hecho, ctx, agente), opTxt, dni);
    } else {
      // pide confirmación: la respuesta de la opción es la pregunta; 10 min para contestar
      await guardarChat(ctx, { estado: `CONFIRMA:${op.id}`, esperaMin: 10, nombre: m.nombre, dni });
      await enviarTexto(ctx, `${holaOp}${respuesta}`, opTxt, dni);
    }
    return;
  }

  await guardarChat(ctx, { estado: 'MENU', nombre: m.nombre, dni });
  if (op.registrar_pedido) await nuevoPedido(ctx, dni, op.titulo);

  if (op.accion === 'CERT_IOMA' || op.accion === 'CERT_TRABAJO') {
    await enviarTexto(ctx, `${hola}${completar(e.c.texto_preparando, ctx, agente)}`, opTxt, dni);
    try {
      let docx: Buffer;
      if (op.accion === 'CERT_IOMA') {
        const gen = await generarCertificadoIomaDocx(sequelize, dni);
        if (!gen) throw new Error('El agente no está en personaldetalle');
        docx = gen.buffer;
      } else {
        const c = await armarCertificadoLaboral(sequelize, dni);
        if (!c) throw new Error('No se pudo armar el certificado de trabajo');
        docx = await renderCertificadoLaboralDocx(c);
      }
      const pdf = await docxAPdf(docx);
      const archivo = op.accion === 'CERT_IOMA' ? `Certificado_IOMA_${dni}.pdf` : `Certificado_de_trabajo_${dni}.pdf`;
      await enviarPdf(ctx, pdf, archivo, respuesta || (op.accion === 'CERT_IOMA' ? 'Certificado para IOMA 📄' : 'Certificado de trabajo 📄'), opTxt, dni);
    } catch (err: any) {
      logger.error({ msg: `wabot ${op.accion}`, tel: ctx.tel, dni, error: err?.message });
      await enviarTexto(ctx, `${completar(e.c.texto_error, ctx, agente)}${derivar(ctx, agente)}`, opTxt, dni);
    }
    return;
  }

  // TEXTO solo para agentes
  await enviarTexto(ctx, `${holaOp}${respuesta || textoMenu(e)}`, opTxt, dni);
}

/** Mensaje real que llegó por el webhook: se valida contra el número que escribe. */
export async function procesarMensaje(sequelize: Sequelize, m: MensajeEntrante): Promise<void> {
  const e = await leerEstado(sequelize);
  const tel = String(m.from).replace(/\D/g, '');
  await atender({ sequelize, e, tel, celular: normalizarWa(tel), prueba: false, salida: [] }, m);
}

/**
 * Simulador de la página: corre la misma lógica sin enviar nada a Meta y devuelve lo que contestaría.
 * `dniCelular` = escribir "desde el celular registrado de ese agente" (sin él, desde un número
 * desconocido). El DNI se escribe en el chat como haría la persona, así se prueba la validación.
 * El chat de prueba usa el teléfono "P<dni>" (o "P0") para no tocar conversaciones reales.
 */
export async function simularMensaje(sequelize: Sequelize, texto: string, dniCelular: number | null) {
  invalidarConfig(sequelize);
  const e = await leerEstado(sequelize);
  const duenio = dniCelular ? await agentePorDni(sequelize, dniCelular) : null;
  const celular = duenio ? celularDe(duenio.telefono).celular ?? '' : '';
  const ctx: Ctx = { sequelize, e, tel: `P${dniCelular || 0}`, celular: celular || 'SIN_CELULAR', prueba: true, salida: [] };
  await atender(ctx, { id: `PRUEBA-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, from: ctx.tel, tipo: 'text', texto });
  const chat = await chatDe(sequelize, ctx.tel);
  const est = String(chat?.estado || 'MENU');
  return {
    desde: duenio
      ? { dni: duenio.dni, nombre: `${duenio.apellido} ${duenio.nombre}`.trim(), activo: duenio.activo, celular: celular || null }
      : null,
    estado_chat: Number(chat?.bloqueado) ? 'BLOQUEADO'
      : !Number(chat?.humano_vigente) ? 'MENU'
      : est === 'HUMANO' ? 'HUMANO' : est.startsWith('PIDE_DNI:') ? 'PIDE_DNI' : est.startsWith('CONFIRMA:') ? 'CONFIRMA' : 'MENU',
    bot_activo: e.c.activo === '1',
    respuestas: ctx.salida,
  };
}

export async function limpiarPruebas(sequelize: Sequelize) {
  await ensureBotTablas(sequelize);
  await sequelize.query(`DELETE FROM whatsapp_bot_mensajes WHERE telefono LIKE 'P%'`);
  await sequelize.query(`DELETE FROM whatsapp_bot_pedidos WHERE prueba = 1`);
  await sequelize.query(`DELETE FROM gp_reset_cola WHERE prueba = 1`);
  await sequelize.query(`DELETE FROM whatsapp_bot_chats WHERE telefono LIKE 'P%'`);
}

// ─── webhook ─────────────────────────────────────────────────────────────────

// La verificación del webhook y la firma de Meta están en services/whatsappWebhook.ts (servidor público):
// ese proceso solo anota el cuerpo crudo en whatsapp_bot_entrada; acá se procesa.

/** Saca los mensajes entrantes del cuerpo del webhook (ignora estados, ecos de la app, etc.). */
export function mensajesDelWebhook(body: any, phoneId: string): MensajeEntrante[] {
  const out: MensajeEntrante[] = [];
  for (const entry of body?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      if (ch?.field !== 'messages') continue;
      const v = ch.value ?? {};
      if (phoneId && v?.metadata?.phone_number_id && v.metadata.phone_number_id !== phoneId) continue;
      const nombres = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c.wa_id), c?.profile?.name ?? '']));
      for (const msg of v.messages ?? []) {
        const texto = msg.text?.body
          ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title
          ?? msg.button?.text ?? '';
        out.push({ id: String(msg.id), from: String(msg.from), tipo: String(msg.type || 'unknown'), texto, nombre: nombres.get(String(msg.from)) });
      }
      for (const st of v.statuses ?? []) {
        if (st?.status === 'failed') logger.warn({ msg: 'wabot entrega fallida', to: st.recipient_id, errores: st.errors });
      }
    }
  }
  return out;
}

/**
 * Procesa el cuerpo del webhook (ya validado). Un chat a la vez por teléfono para que salga en orden.
 * Devuelve una promesa que termina cuando se atendieron todos sus mensajes (los errores quedan logueados).
 */
const colas = new Map<string, Promise<unknown>>();
export async function recibirWebhook(sequelize: Sequelize, body: any): Promise<void> {
  const e = await leerEstado(sequelize);
  const tareas: Promise<unknown>[] = [];
  for (const m of mensajesDelWebhook(body, e.phoneId)) {
    const previa = colas.get(m.from) ?? Promise.resolve();
    const tarea = previa.then(() => procesarMensaje(sequelize, m)).catch((err: any) => {
      logger.error({ msg: 'wabot procesar', from: m.from, error: err?.message });
    });
    colas.set(m.from, tarea);
    tarea.finally(() => { if (colas.get(m.from) === tarea) colas.delete(m.from); });
    tareas.push(tarea);
  }
  await Promise.all(tareas);
}

// ─── bandeja de entrada (la llena el servidor público, la procesa la API) ─────

let bandejaRecuperada = false;

/**
 * Toma lo que anotó el webhook en whatsapp_bot_entrada y lo atiende. La API lo llama cada 2 s.
 * Si la API se cayó a mitad de camino, al arrancar lo que quedó PROCESANDO vuelve a PENDIENTE
 * (no se contesta dos veces: los mensajes se deduplican por el id de Meta).
 */
export async function procesarBandeja(sequelize: Sequelize): Promise<number> {
  await ensureBotTablas(sequelize);
  if (!bandejaRecuperada) {
    bandejaRecuperada = true;
    await sequelize.query(`UPDATE whatsapp_bot_entrada SET estado = 'PENDIENTE' WHERE estado = 'PROCESANDO'`);
  }
  await leerEstado(sequelize); // config en cache: así las filas se encolan por teléfono en el orden de llegada
  const filas = await sequelize.query<any>(
    `SELECT id, cuerpo FROM whatsapp_bot_entrada WHERE estado = 'PENDIENTE' ORDER BY id LIMIT 50`, { type: QueryTypes.SELECT });
  const marcar = (id: number, estado: string, error: string | null = null) => sequelize.query(
    `UPDATE whatsapp_bot_entrada SET estado = :estado, procesado_at = NOW(), error = :error WHERE id = :id`,
    { replacements: { id, estado, error: error?.slice(0, 500) ?? null } });
  for (const f of filas) {
    const [, meta]: any = await sequelize.query(
      `UPDATE whatsapp_bot_entrada SET estado = 'PROCESANDO' WHERE id = :id AND estado = 'PENDIENTE'`, { replacements: { id: f.id } });
    if (!Number(meta?.affectedRows ?? meta ?? 0)) continue;
    let body: any;
    try { body = JSON.parse(String(f.cuerpo)); } catch { await marcar(f.id, 'ERROR', 'JSON inválido'); continue; }
    // Se despacha en orden de llegada y NO se espera: cada teléfono tiene su propia cola, así un PDF
    // lento no frena a los demás ni a la próxima vuelta (la fila ya está PROCESANDO, no se toma dos veces).
    recibirWebhook(sequelize, body)
      .then(() => marcar(f.id, 'OK'))
      .catch((err: any) => marcar(f.id, 'ERROR', err?.message).catch(() => undefined));
  }
  return filas.length;
}

/** Limpieza: lo ya procesado de la bandeja se borra a los 30 días (los mensajes quedan en whatsapp_bot_mensajes). */
export async function limpiarBandeja(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`DELETE FROM whatsapp_bot_entrada WHERE estado IN ('OK','ERROR') AND recibido_at < NOW() - INTERVAL 30 DAY`);
}
