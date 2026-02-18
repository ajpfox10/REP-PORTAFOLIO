// src/services/email.service.ts
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let transporter: Transporter | null = null;

export function createEmailTransporter(): Transporter | null {
  if (!env.EMAIL_ENABLE) {
    logger.warn({ msg: 'Email service disabled', EMAIL_ENABLE: env.EMAIL_ENABLE });
    return null;
  }

  if (!env.EMAIL_HOST || !env.EMAIL_PORT) {
    logger.error({ msg: 'Email config missing', EMAIL_HOST: env.EMAIL_HOST, EMAIL_PORT: env.EMAIL_PORT });
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE, // true for 465, false for other ports
      auth: env.EMAIL_USER && env.EMAIL_PASSWORD ? {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASSWORD,
      } : undefined,
    });

    logger.info({ 
      msg: 'Email transporter created', 
      host: env.EMAIL_HOST, 
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE 
    });

    return transporter;
  } catch (error: any) {
    logger.error({ msg: 'Failed to create email transporter', error: error?.message || error });
    return null;
  }
}

export function getEmailTransporter(): Transporter | null {
  if (!transporter) {
    transporter = createEmailTransporter();
  }
  return transporter;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  // Guard: nunca intentar enviar si el servicio está deshabilitado
  if (!env.EMAIL_ENABLE) {
    logger.warn({ msg: "sendEmail llamado pero EMAIL_ENABLE=false. Email no enviado.", to: options.to, subject: options.subject });
    return { ok: false, error: "Email service disabled (EMAIL_ENABLE=false)" };
  }

  const t = getEmailTransporter();
  
  if (!t) {
    return { ok: false, error: 'Email service not configured' };
  }

  try {
    const info = await t.sendMail({
      from: options.from || env.EMAIL_FROM || '"No Reply" <noreply@example.com>',
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    logger.info({ 
      msg: 'Email sent', 
      messageId: info.messageId, 
      to: options.to,
      subject: options.subject 
    });

    return { ok: true, messageId: info.messageId };
  } catch (error: any) {
    logger.error({ 
      msg: 'Failed to send email', 
      error: error?.message || error,
      to: options.to,
      subject: options.subject 
    });
    return { ok: false, error: error?.message || 'Failed to send email' };
  }
}

// Template helpers
export function getPasswordResetEmailHtml(resetLink: string, userName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Restablecer Contraseña</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
              <tr>
                <td style="padding: 40px 30px; background-color: #2E5FA3; color: #ffffff; text-align: center;">
                  <h1 style="margin: 0; font-size: 28px;">Restablecer Contraseña</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
                    Hola ${userName || 'Usuario'},
                  </p>
                  <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
                    Recibimos una solicitud para restablecer la contraseña de tu cuenta. 
                    Haz clic en el botón de abajo para crear una nueva contraseña:
                  </p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                    <tr>
                      <td align="center">
                        <a href="${resetLink}" 
                           style="display: inline-block; padding: 15px 40px; background-color: #2E5FA3; color: #ffffff; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold;">
                          Restablecer Contraseña
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin: 0 0 20px 0; font-size: 14px; color: #666666;">
                    O copia y pega este enlace en tu navegador:
                  </p>
                  <p style="margin: 0 0 20px 0; font-size: 14px; color: #2E5FA3; word-break: break-all;">
                    ${resetLink}
                  </p>
                  <p style="margin: 0 0 20px 0; font-size: 14px; color: #666666;">
                    Este enlace expirará en 1 hora por seguridad.
                  </p>
                  <p style="margin: 0 0 20px 0; font-size: 14px; color: #666666;">
                    Si no solicitaste restablecer tu contraseña, ignora este correo y tu contraseña permanecerá sin cambios.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px 30px; background-color: #f8f8f8; text-align: center; font-size: 12px; color: #999999;">
                  <p style="margin: 0;">
                    Este es un correo automático, por favor no respondas a este mensaje.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function getPasswordResetEmailText(resetLink: string, userName: string): string {
  return `
Hola ${userName || 'Usuario'},

Recibimos una solicitud para restablecer la contraseña de tu cuenta.

Para crear una nueva contraseña, visita este enlace:
${resetLink}

Este enlace expirará en 1 hora por seguridad.

Si no solicitaste restablecer tu contraseña, ignora este correo y tu contraseña permanecerá sin cambios.

---
Este es un correo automático, por favor no respondas a este mensaje.
  `.trim();
}

export function get2FAEmailHtml(code: string, userName: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Código de Verificación</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
              <tr>
                <td style="padding: 40px 30px; background-color: #2E5FA3; color: #ffffff; text-align: center;">
                  <h1 style="margin: 0; font-size: 28px;">Código de Verificación</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px; text-align: center;">
                  <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">
                    Hola ${userName || 'Usuario'},
                  </p>
                  <p style="margin: 0 0 30px 0; font-size: 16px; color: #333333;">
                    Tu código de verificación es:
                  </p>
                  <div style="background-color: #f8f8f8; border: 2px solid #2E5FA3; border-radius: 8px; padding: 20px; margin: 0 auto; display: inline-block;">
                    <span style="font-size: 36px; font-weight: bold; color: #2E5FA3; letter-spacing: 8px;">
                      ${code}
                    </span>
                  </div>
                  <p style="margin: 30px 0 0 0; font-size: 14px; color: #666666;">
                    Este código expirará en 10 minutos.
                  </p>
                  <p style="margin: 10px 0 0 0; font-size: 14px; color: #666666;">
                    Si no solicitaste este código, ignora este correo.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px 30px; background-color: #f8f8f8; text-align: center; font-size: 12px; color: #999999;">
                  <p style="margin: 0;">
                    Este es un correo automático, por favor no respondas a este mensaje.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function get2FAEmailText(code: string, userName: string): string {
  return `
Hola ${userName || 'Usuario'},

Tu código de verificación es: ${code}

Este código expirará en 10 minutos.

Si no solicitaste este código, ignora este correo.

---
Este es un correo automático, por favor no respondas a este mensaje.
  `.trim();
}
