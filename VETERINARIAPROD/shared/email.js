'use strict';

/**
 * Email service — nodemailer transport with HTML templates.
 * Mirrors apipersonal email module.
 *
 * Usage:
 *   const { sendPasswordReset, sendWelcome, sendAppointmentReminder } = require('../../shared/email');
 */

const nodemailer = require('nodemailer');
const { formatDate } = require('./locale');
const { getSecret } = require('./secrets');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize an email header value (To, Subject, From, etc.) to prevent
 * header injection attacks. Strips carriage returns, newlines, and null bytes
 * that could be used to inject additional headers.
 */
function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n\0]/g, '');
}

// ── Transport ─────────────────────────────────────────────────────────────────
function createTransport() {
  // Allow SMTP or SendGrid / Mailgun via SMTP bridge
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: getSecret('SMTP_PASS'),
      },
    });
  }

  // Fallback: Ethereal for development
  return nodemailer.createTransport({ jsonTransport: true });
}

const transport = createTransport();

const FROM = process.env.EMAIL_FROM || '"VetManager Pro" <no-reply@vetmanager.com>';
const APP_URL = process.env.APP_URL || 'http://localhost:4050';

// ── Low-level send ────────────────────────────────────────────────────────────
async function send({ to, subject, html, text }) {
  // Sanitize header fields to prevent email header injection attacks
  const safeSubject = sanitizeHeader(subject);
  const safeTo      = sanitizeHeader(to);
  const info = await transport.sendMail({ from: FROM, to: safeTo, subject: safeSubject, html, text });
  return info;
}

// ── Templates ─────────────────────────────────────────────────────────────────
function baseHtml(content, title = 'VetManager Pro') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .card { background: #fff; border-radius: 8px; max-width: 580px; margin: 0 auto; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid #eee; }
    .header h1 { color: #2563eb; font-size: 24px; margin: 0; }
    .content { padding: 24px 0; color: #374151; line-height: 1.6; }
    .btn { display: inline-block; background: #2563eb; color: #fff; text-decoration: none;
           padding: 12px 28px; border-radius: 6px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; padding-top: 20px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><h1>VetManager Pro</h1></div>
    <div class="content">${content}</div>
    <div class="footer">Este email fue enviado desde VetManager Pro. Por favor no responda a este mensaje.</div>
  </div>
</body>
</html>`;
}

// ── Password reset ────────────────────────────────────────────────────────────
async function sendPasswordReset({ to, token, expiresInMinutes = 60, portal = false }) {
  const link = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}${portal ? '&portal=1' : ''}`;
  const html = baseHtml(`
    <p>Hemos recibido una solicitud para restablecer la contraseña de su cuenta.</p>
    <p>Haga clic en el siguiente botón para continuar:</p>
    <a href="${link}" class="btn">Restablecer contraseña</a>
    <p>Este enlace expirará en <strong>${expiresInMinutes} minutos</strong>.</p>
    <p>Si no solicitó este cambio, puede ignorar este correo.</p>
    <p style="word-break:break-all;font-size:12px;color:#6b7280;">O copie: ${link}</p>
  `, 'Restablecer contraseña');

  return send({
    to,
    subject: 'Restablecer contraseña — VetManager Pro',
    html,
    text: `Restablezca su contraseña: ${link} (expira en ${expiresInMinutes} min)`,
  });
}

// ── Welcome ───────────────────────────────────────────────────────────────────
async function sendWelcome({ to, name, orgName, tempPassword = null }) {
  const credBlock = tempPassword
    ? `<p>Su contraseña temporal es: <strong style="font-size:18px;letter-spacing:2px;">${escHtml(tempPassword)}</strong></p>
       <p style="color:#dc2626;">Por seguridad, cambie esta contraseña en su primer inicio de sesión.</p>`
    : '';

  const html = baseHtml(`
    <p>Hola <strong>${escHtml(name)}</strong>,</p>
    <p>Su cuenta en <strong>${escHtml(orgName)}</strong> ha sido creada exitosamente en VetManager Pro.</p>
    ${credBlock}
    <a href="${APP_URL}/login" class="btn">Iniciar sesión</a>
    <p style="font-size:12px;color:#6b7280;">Si no esperaba este correo, ignórelo o contáctenos.</p>
  `, 'Bienvenido a VetManager Pro');

  return send({ to, subject: `Bienvenido a VetManager Pro — ${orgName}`, html });
}

// ── New device / IP login alert ───────────────────────────────────────────────
async function sendNewDeviceLogin({ to, name, ip, userAgent, time, appUrl }) {
  const url = appUrl || APP_URL;
  const html = baseHtml(`
    <p>Hola <strong>${escHtml(name)}</strong>,</p>
    <p>Detectamos un inicio de sesión en su cuenta desde un dispositivo o ubicación no reconocida:</p>
    <ul>
      <li><strong>Fecha y hora:</strong> ${escHtml(time)}</li>
      <li><strong>IP:</strong> ${escHtml(ip)}</li>
      <li><strong>Dispositivo:</strong> ${escHtml(userAgent)}</li>
    </ul>
    <p>Si fue usted, puede ignorar este mensaje.</p>
    <p>Si <strong>no reconoce</strong> esta actividad, cierre todas sus sesiones de inmediato:</p>
    <a href="${url}/security/sessions" class="btn" style="background:#dc2626;">Cerrar todas las sesiones</a>
  `, 'Nuevo inicio de sesión detectado');

  return send({
    to,
    subject: '⚠️ Nuevo inicio de sesión en su cuenta — VetManager Pro',
    html,
    text: `Inicio de sesión detectado desde IP ${ip} el ${time}. Si no fue usted, visite ${url}/security/sessions`,
  });
}

// ── 2FA enabled confirmation ──────────────────────────────────────────────────
async function send2faEnabled({ to, name }) {
  const html = baseHtml(`
    <p>Hola <strong>${escHtml(name)}</strong>,</p>
    <p>La autenticación de dos factores ha sido <strong>activada</strong> en su cuenta.</p>
    <p>Si no realizó este cambio, contáctenos inmediatamente.</p>
  `, 'Autenticación 2FA activada');

  return send({ to, subject: 'Autenticación 2FA activada — VetManager Pro', html });
}

// ── Appointment reminder ──────────────────────────────────────────────────────
async function sendAppointmentReminder({ to, ownerName, petName, datetime, vetName, clinicName }) {
  const html = baseHtml(`
    <p>Hola <strong>${escHtml(ownerName)}</strong>,</p>
    <p>Le recordamos que tiene una cita programada para su mascota <strong>${escHtml(petName)}</strong>:</p>
    <ul>
      <li><strong>Fecha y hora:</strong> ${escHtml(datetime)}</li>
      <li><strong>Veterinario:</strong> ${escHtml(vetName)}</li>
      <li><strong>Clínica:</strong> ${escHtml(clinicName)}</li>
    </ul>
    <p>Si necesita cancelar o reprogramar, contáctenos con anticipación.</p>
  `, 'Recordatorio de cita veterinaria');

  return send({ to, subject: `Recordatorio: cita de ${petName} — ${clinicName}`, html });
}

// ── Critical lab result alert ─────────────────────────────────────────────────
async function sendCriticalLabAlert({ to, vetName, patientName, testName, value, unit, referenceRange }) {
  const html = baseHtml(`
    <p>Alerta de resultado crítico de laboratorio:</p>
    <ul>
      <li><strong>Paciente:</strong> ${escHtml(patientName)}</li>
      <li><strong>Prueba:</strong> ${escHtml(testName)}</li>
      <li><strong>Resultado:</strong> ${escHtml(value)} ${escHtml(unit)}</li>
      <li><strong>Rango referencia:</strong> ${escHtml(referenceRange)}</li>
    </ul>
    <p>Por favor revise y tome las medidas necesarias.</p>
  `, 'Resultado crítico de laboratorio');

  return send({ to, subject: `⚠️ Resultado crítico: ${testName} — ${patientName}`, html });
}

// ── Invoice / payment receipt ─────────────────────────────────────────────────
async function sendInvoiceReceipt({ to, ownerName, invoiceNumber, total, paidAt, clinicName }) {
  const html = baseHtml(`
    <p>Hola <strong>${escHtml(ownerName)}</strong>,</p>
    <p>Su pago ha sido recibido correctamente.</p>
    <ul>
      <li><strong>Número de factura:</strong> ${escHtml(invoiceNumber)}</li>
      <li><strong>Total pagado:</strong> ${escHtml(total)}</li>
      <li><strong>Fecha:</strong> ${escHtml(paidAt)}</li>
      <li><strong>Clínica:</strong> ${escHtml(clinicName)}</li>
    </ul>
    <p>Gracias por confiar en VetManager Pro.</p>
  `, 'Comprobante de pago');

  return send({ to, subject: `Comprobante de pago #${invoiceNumber} — ${clinicName}`, html });
}

// ── sendReportEmail ───────────────────────────────────────────────────────────
async function sendReportEmail({ email, subject, reportName, buffer, filename, mimeType }) {
  // Reuse the module-level transport singleton instead of creating a new one
  // per call (which would leak connections / file descriptors).
  // Sanitize header values and HTML-escape user-supplied data.
  const safeSubject = sanitizeHeader(subject);
  const safeTo      = sanitizeHeader(email);
  await transport.sendMail({
    from    : sanitizeHeader(`"VetManager Reportes" <${process.env.FROM_EMAIL || 'reportes@vetmanager.com'}>`),
    to      : safeTo,
    subject : safeSubject,
    html    : `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#2563eb;">Reporte Programado</h2>
        <p>Hola,</p>
        <p>Se adjunta el reporte <strong>${escHtml(reportName)}</strong> generado automáticamente el
           <strong>${escHtml(formatDate(new Date()))}</strong>.</p>
        <p style="color:#64748b;font-size:13px;">
          Este correo fue generado autom&#xE1;ticamente por VetManager Pro.<br>
          Para cambiar la configuraci&#xF3;n de reportes programados, ingres&#xE1; al panel de administraci&#xF3;n.
        </p>
      </div>`,
    attachments: [{
      filename,
      content : buffer,
      contentType: mimeType,
    }],
  });
}

module.exports = {
  send,
  sendPasswordReset,
  sendWelcome,
  sendNewDeviceLogin,
  send2faEnabled,
  sendAppointmentReminder,
  sendCriticalLabAlert,
  sendInvoiceReceipt,
  sendReportEmail,
};
