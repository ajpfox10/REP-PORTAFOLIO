import { authenticator } from "otplib";
import qrcode from "qrcode";
import { env } from "../config/env.js";

// Genera un secreto TOTP para activar 2FA en una cuenta.
export function createTwoFactorSecret(email: string) {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(email, env.TWO_FACTOR_ISSUER, secret);
  return { secret, otpauth };
}

// Convierte el URI TOTP en QR para apps autenticadoras.
export function createTwoFactorQr(otpauth: string) {
  return qrcode.toDataURL(otpauth);
}

// Valida el codigo TOTP cuando 2FA esta habilitado.
export function verifyTwoFactorCode(secret: string, token: string) {
  return authenticator.verify({ secret, token });
}
