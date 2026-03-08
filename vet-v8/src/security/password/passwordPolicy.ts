/**
 * Password Policy — v10  (S-05)
 *
 * Enforces:
 *   - Minimum 10 characters
 *   - At least 1 uppercase letter
 *   - At least 1 digit
 *   - At least 1 special character
 *   - Not equal to email (case-insensitive)
 *   - Not in common/breached password list (top-50 check, no external API needed)
 *   - Not a reuse of last 5 passwords (checked against password_history table)
 *
 * Usage:
 *   validatePasswordStrength(password, email)  → throws VALIDATION_ERROR if weak
 *   await checkPasswordHistory(pool, userId, tenantId, bcryptHash, bcryptCompare)
 *                                               → throws VALIDATION_ERROR if reused
 *   await recordPasswordHistory(pool, userId, tenantId, bcryptHash)
 */

import { AppError } from "../../core/errors/appError.js";
import type { Pool } from "mysql2/promise";

// ── Strength rules ────────────────────────────────────────────────────────────

const MIN_LENGTH = 10;

// Top breached passwords — blocked without external API
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "123456789", "1234567890",
  "qwerty123", "iloveyou", "admin1234", "letmein1", "welcome1",
  "monkey123", "dragon123", "master123", "sunshine1", "princess1",
  "football", "superman1", "batman123", "trustno1!", "changeme1",
]);

export type PasswordValidationError = {
  code: "VALIDATION_ERROR";
  message: string;
  fields: string[];
};

/**
 * Validate password strength synchronously.
 * Throws AppError("VALIDATION_ERROR") with a descriptive message if invalid.
 */
export function validatePasswordStrength(password: string, email?: string): void {
  const errors: string[] = [];

  if (!password || password.length < MIN_LENGTH) {
    errors.push(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Debe contener al menos una letra mayúscula.");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Debe contener al menos un número.");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("Debe contener al menos un carácter especial (ej: !@#$%^&*).");
  }
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase())) {
    errors.push("La contraseña no puede contener tu nombre de usuario.");
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push("Esa contraseña es demasiado común. Elegí una más única.");
  }

  if (errors.length > 0) {
    throw new AppError("VALIDATION_ERROR", errors.join(" "), { fields: ["password"], reasons: errors });
  }
}

// ── Password history ──────────────────────────────────────────────────────────

const HISTORY_DEPTH = 5;

/**
 * Check if the new password matches any of the last HISTORY_DEPTH hashes.
 * `bcryptCompare` is passed in to avoid circular dep on the bcrypt import.
 * Throws VALIDATION_ERROR if reused.
 */
export async function checkPasswordHistory(
  pool: Pool,
  userId: string,
  tenantId: string,
  plainPassword: string,
  bcryptCompare: (plain: string, hash: string) => Promise<boolean>
): Promise<void> {
  const [rows] = await pool.query<any[]>(
    `SELECT password_hash FROM password_history
     WHERE user_id=? AND tenant_id=?
     ORDER BY created_at DESC LIMIT ?`,
    [userId, tenantId, HISTORY_DEPTH]
  );

  for (const row of rows ?? []) {
    if (await bcryptCompare(plainPassword, row.password_hash)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `No podés reutilizar ninguna de tus últimas ${HISTORY_DEPTH} contraseñas.`,
        { fields: ["password"] }
      );
    }
  }
}

/**
 * Persist the new hash to password_history after a successful password change.
 * Automatically prunes entries older than HISTORY_DEPTH.
 */
export async function recordPasswordHistory(
  pool: Pool,
  userId: string,
  tenantId: string,
  bcryptHash: string
): Promise<void> {
  await pool.query(
    `INSERT INTO password_history (user_id, tenant_id, password_hash)
     VALUES (?, ?, ?)`,
    [userId, tenantId, bcryptHash]
  );

  // Prune: keep only last HISTORY_DEPTH entries
  await pool.query(
    `DELETE FROM password_history
     WHERE user_id=? AND tenant_id=?
       AND id NOT IN (
         SELECT id FROM (
           SELECT id FROM password_history
           WHERE user_id=? AND tenant_id=?
           ORDER BY created_at DESC LIMIT ?
         ) AS keep
       )`,
    [userId, tenantId, userId, tenantId, HISTORY_DEPTH]
  );
}
