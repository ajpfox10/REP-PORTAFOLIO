import { env } from "../config/env.js";
import { query } from "../db/pool.js";

// Normaliza IPs locales y direcciones proxy para registros consistentes.
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string }; headers?: Record<string, unknown> }) {
  const forwarded = env.TRUST_PROXY ? String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  const raw = forwarded || req.ip || req.socket?.remoteAddress || "";
  return raw.replace(/^::ffff:/, "").replace(/^::1$/, "127.0.0.1");
}

// Devuelve si un usuario o IP esta bloqueado temporalmente.
export async function getLoginLock(ip: string, identifier: string) {
  const rows = await query<Array<{ attempts: number; locked_until: Date | null }>>(
    `SELECT attempts, locked_until
       FROM auth_login_guard
      WHERE ip = :ip AND identifier = :identifier
      LIMIT 1`,
    { ip, identifier }
  );
  return rows[0] ?? null;
}

// Registra intentos fallidos y bloquea temporalmente segun configuracion.
export async function recordLoginAttempt(ip: string, identifier: string, ok: boolean) {
  if (!env.LOGIN_GUARD_ENABLE) return;

  if (ok) {
    await query(`DELETE FROM auth_login_guard WHERE ip = :ip AND identifier = :identifier`, { ip, identifier });
    return;
  }

  await query(
    `INSERT INTO auth_login_guard (ip, identifier, attempts, last_attempt_at)
     VALUES (:ip, :identifier, 1, NOW())
     ON DUPLICATE KEY UPDATE attempts = attempts + 1, last_attempt_at = NOW()`,
    { ip, identifier }
  );

  const lock = await getLoginLock(ip, identifier);
  if (lock && Number(lock.attempts) >= env.LOGIN_GUARD_MAX_ATTEMPTS) {
    await query(
      `UPDATE auth_login_guard
          SET locked_until = DATE_ADD(NOW(), INTERVAL :minutes MINUTE)
        WHERE ip = :ip AND identifier = :identifier`,
      { ip, identifier, minutes: env.LOGIN_GUARD_LOCK_MINUTES }
    );
  }
}

// Verifica bloqueos activos antes de procesar credenciales.
export async function assertLoginAllowed(ip: string, identifier: string) {
  if (!env.LOGIN_GUARD_ENABLE) return;
  const lock = await getLoginLock(ip, identifier);
  if (lock?.locked_until && new Date(lock.locked_until).getTime() > Date.now()) {
    const error = new Error("Demasiados intentos fallidos. Intente mas tarde.");
    (error as Error & { status?: number }).status = 429;
    throw error;
  }
}
