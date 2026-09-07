'use strict';

/**
 * Servicio de mensajería — SMS + WhatsApp via Twilio.
 *
 * Variables de entorno:
 *   TWILIO_ACCOUNT_SID       — Account SID del panel Twilio
 *   TWILIO_AUTH_TOKEN        — Auth Token del panel Twilio
 *   TWILIO_PHONE_NUMBER      — Número SMS ej: +5491112345678
 *   TWILIO_WHATSAPP_NUMBER   — Número WhatsApp ej: whatsapp:+14155238886 (sandbox)
 *
 * En sandbox de WhatsApp los mensajes libres funcionan.
 * En producción los mensajes outbound deben usar templates aprobadas por Meta.
 */

const twilio = require('twilio');

// ── Cliente ───────────────────────────────────────────────────────────────────
let _client;
function getClient() {
  if (!_client) {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN no configurados');
    _client = twilio(sid, token);
  }
  return _client;
}

// ── Validación de número de teléfono ──────────────────────────────────────────
/**
 * Valida y normaliza un número de teléfono destino.
 * Solo acepta formato E.164: + seguido de 7-15 dígitos.
 * Previene header injection por números malformados pasados a la API de Twilio.
 */
function validatePhoneNumber(to) {
  // Extraer solo dígitos y el signo +
  const cleaned = String(to || '').trim();
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    throw Object.assign(
      new Error(`Número de teléfono inválido: debe ser formato E.164 (ej: +5491112345678)`),
      { code: 'INVALID_PHONE_NUMBER' }
    );
  }
  return cleaned;
}

// ── SMS ───────────────────────────────────────────────────────────────────────
/**
 * Enviar un SMS.
 * @param {string} to      Número destino con código de país ej: +5491112345678
 * @param {string} body    Texto del mensaje
 * @returns {Promise<{sid, status}>}
 */
async function sendSms(to, body) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER no configurado');

  // SEC: validar número destino para prevenir header injection en la API de Twilio
  const toSafe = validatePhoneNumber(to);

  const msg = await getClient().messages.create({ to: toSafe, from, body });
  return { sid: msg.sid, status: msg.status };
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
/**
 * Enviar un mensaje de WhatsApp.
 * @param {string} to      Número destino ej: +5491112345678 (sin prefijo whatsapp:)
 * @param {string} body    Texto del mensaje
 * @returns {Promise<{sid, status}>}
 */
async function sendWhatsApp(to, body) {
  const fromRaw = process.env.TWILIO_WHATSAPP_NUMBER || '';
  const from    = fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:${fromRaw}`;

  // SEC: extraer y validar número base antes de agregar prefijo whatsapp:
  const toBase  = to.startsWith('whatsapp:') ? to.slice('whatsapp:'.length) : to;
  const toSafe  = validatePhoneNumber(toBase);
  const toFmt   = `whatsapp:${toSafe}`;

  const msg = await getClient().messages.create({ to: toFmt, from, body });
  return { sid: msg.sid, status: msg.status };
}

// ── Templates en español ──────────────────────────────────────────────────────
const templates = {
  /** Recordatorio de cita */
  appointmentReminder: ({ ownerName, petName, date, time, vetName, clinicName }) =>
    `Hola ${ownerName} 👋\n\nRecordatorio: *${petName}* tiene cita el *${date} a las ${time}* con *${vetName}* en *${clinicName}*.\n\nSi necesita reprogramar, contáctenos. ¡Los esperamos! 🐾`,

  /** Confirmación de cita creada */
  appointmentConfirm: ({ ownerName, petName, date, time, clinicName }) =>
    `Hola ${ownerName}, su cita para *${petName}* fue confirmada para el *${date} a las ${time}* en *${clinicName}*. ✅`,

  /** Resultado de laboratorio disponible */
  labReady: ({ ownerName, petName, testName, clinicName }) =>
    `Hola ${ownerName}, los resultados de *${testName}* de *${petName}* ya están disponibles. Contáctese con *${clinicName}* para más información. 🔬`,

  /** Alerta de resultado crítico de lab */
  labCritical: ({ vetName, patientName, testName }) =>
    `⚠️ ALERTA: Resultado crítico de *${testName}* para *${patientName}*. Por favor revise inmediatamente. — VetManager Pro`,

  /** Recordatorio de vacunación próxima */
  vaccinationReminder: ({ ownerName, petName, vaccineName, dueDate, clinicName }) =>
    `Hola ${ownerName} 💉\n\n*${petName}* tiene pendiente la vacuna *${vaccineName}* para el *${dueDate}*.\n\nAgende su cita en *${clinicName}*. ¡La salud de su mascota importa! 🐾`,

  /** Pago confirmado */
  paymentConfirmed: ({ ownerName, amount, invoiceNumber, clinicName }) =>
    `Hola ${ownerName}, su pago de *$${amount}* para la factura *#${invoiceNumber}* fue confirmado exitosamente. Gracias por confiar en *${clinicName}*. ✅`,

  /** Telemedicina — sesión lista */
  teleSessionReady: ({ ownerName, petName, link }) =>
    `Hola ${ownerName}, su videoconsulta para *${petName}* está lista. Ingrese aquí: ${link} 📹`,

  /** Alta hospitalaria */
  dischargeReady: ({ ownerName, petName, clinicName }) =>
    `Hola ${ownerName}, *${petName}* está listo/a para ser retirado/a de *${clinicName}*. 🏠`,
};

// ── Envío con template ────────────────────────────────────────────────────────
/**
 * Enviar un mensaje usando un template predefinido.
 *
 * @param {'sms'|'whatsapp'|'both'} channel
 * @param {string}                  to           Número destino (+549...)
 * @param {string}                  templateName Nombre del template en `templates`
 * @param {object}                  vars         Variables del template
 */
function sanitizeTemplateVar(key, val) {
  const s = String(val || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 200);
  if (key === 'link') {
    try {
      const parsed = new URL(s);
      if (parsed.protocol !== 'https:') return '[enlace no valido]';
    } catch { return '[enlace no valido]'; }
  }
  return s;
}

async function sendTemplate(channel, to, templateName, vars) {
  const fn = templates[templateName];
  if (!fn) throw new Error(`Template '${templateName}' no existe`);
  const safeVars = Object.fromEntries(
    Object.entries(vars || {}).map(([k, v]) => [k, sanitizeTemplateVar(k, v)])
  );
  const body = fn(safeVars);

  const results = [];
  if (channel === 'sms' || channel === 'both') {
    results.push({ channel: 'sms', ...(await sendSms(to, body).catch(e => ({ error: e.message }))) });
  }
  if (channel === 'whatsapp' || channel === 'both') {
    results.push({ channel: 'whatsapp', ...(await sendWhatsApp(to, body).catch(e => ({ error: e.message }))) });
  }
  return { body, results };
}

module.exports = {
  sendSms,
  sendWhatsApp,
  sendTemplate,
  templates,
};
