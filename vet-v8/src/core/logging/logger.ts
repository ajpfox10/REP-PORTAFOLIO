/**
 * Logger — v10  (S-06)
 *
 * Extended redact list to prevent sensitive data leaking into logs:
 *   - Auth headers and cookies
 *   - Password fields (plain, new, confirm, recovery)
 *   - TOTP/MFA codes
 *   - Card/payment data
 *   - Encrypted field contents
 *
 * Pino's redact replaces matched paths with "[Redacted]" in all log entries.
 * Paths use dot-notation; wildcards (*) match any key at that level.
 */

import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      // ── HTTP request ──────────────────────────────────────────────────────
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers[\"x-api-key\"]",
      "req.headers[\"x-internal-token\"]",

      // ── Auth body fields ──────────────────────────────────────────────────
      "req.body.password",
      "req.body.new_password",
      "req.body.old_password",
      "req.body.confirm_password",
      "req.body.current_password",
      "req.body.totp_code",
      "req.body.recovery_code",
      "req.body.mfa_code",
      "req.body.token",
      "req.body.reset_token",
      "req.body.invite_token",

      // ── Payment / PCI ─────────────────────────────────────────────────────
      "req.body.card_number",
      "req.body.cvv",
      "req.body.cvc",
      "req.body.expiry",

      // ── Encrypted field values ─────────────────────────────────────────────
      "req.body.totp_secret_enc",
      "req.body.dek",

      // ── Response — never log bodies of auth/clinical endpoints ────────────
      // (pino-http logs res.body only if custom serializer is set;
      //  these paths are defensive in case a future serializer is added)
      "res.body.data.password_hash",
      "res.body.data.totp_secret_enc",
    ],
    censor: "[Redacted]",
  },
});
