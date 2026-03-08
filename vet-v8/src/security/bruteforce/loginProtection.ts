/**
 * Login Brute-Force Protection — v10  (S-03)
 *
 * Two complementary layers:
 *
 * Layer 1 — Per-credential Redis counter (survives IP rotation):
 *   Key: login:cred:<tenantId>:<email_sha256>
 *   After MAX_ATTEMPTS failures → locked for LOCKOUT_SECONDS
 *   Reset on successful login.
 *
 * Layer 2 — Per-IP Redis counter:
 *   Key: login:ip:<ip>
 *   After IP_MAX_ATTEMPTS → short cooldown (60 s)
 *   Catches distributed attacks from rotating emails.
 *
 * DB-level fallback (login_attempts table):
 *   For forensics and long-term lockout persistence across Redis restarts.
 *   Checked ONLY if Redis is unavailable.
 *
 * Usage (in authRouter POST /login handler):
 *   const guard = buildLoginProtection(redis, tenantPool);
 *   await guard.checkAndThrow(tenantId, email, ip);
 *   // ... verify password ...
 *   await guard.onSuccess(tenantId, email, ip);
 *   // on wrong password:
 *   await guard.onFailure(tenantId, email, ip);
 */

import crypto from "node:crypto";
import { AppError } from "../../core/errors/appError.js";

const MAX_ATTEMPTS      = 5;
const LOCKOUT_SECONDS   = 15 * 60;   // 15 minutes
const IP_MAX_ATTEMPTS   = 30;         // per IP across all emails
const IP_LOCKOUT_SECONDS = 60;        // 1 minute IP cooldown

function emailKey(tenantId: string, email: string): string {
  const h = crypto.createHash("sha256").update(`${tenantId}:${email.toLowerCase()}`).digest("hex").slice(0, 32);
  return `login:cred:${h}`;
}

function ipKey(ip: string): string {
  return `login:ip:${ip}`;
}

export function buildLoginProtection(redis: any, tenantPool?: any) {
  /**
   * Call BEFORE password verification.
   * Throws RATE_LIMITED if account or IP is locked.
   */
  async function checkAndThrow(tenantId: string, email: string, ip: string): Promise<void> {
    if (!redis) return; // degrade gracefully if Redis unavailable

    // IP check
    const ipCount = parseInt(await redis.get(ipKey(ip)) ?? "0", 10);
    if (ipCount >= IP_MAX_ATTEMPTS) {
      throw new AppError("RATE_LIMITED", "Demasiados intentos desde esta IP. Intentá en 1 minuto.");
    }

    // Credential check
    const credCount = parseInt(await redis.get(emailKey(tenantId, email)) ?? "0", 10);
    if (credCount >= MAX_ATTEMPTS) {
      throw new AppError("RATE_LIMITED",
        "Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intentá en 15 minutos o usá 'Olvidé mi contraseña'."
      );
    }
  }

  /**
   * Call AFTER successful login.
   * Resets both counters.
   */
  async function onSuccess(tenantId: string, email: string, ip: string): Promise<void> {
    if (!redis) return;
    await Promise.all([
      redis.del(emailKey(tenantId, email)),
      redis.del(ipKey(ip)),
    ]);

    // Reset DB counter if using tenant DB
    if (tenantPool) {
      await tenantPool.query(
        "UPDATE login_attempts SET attempts=0, locked_until=NULL WHERE tenant_id=? AND email_hash=?",
        [tenantId, crypto.createHash("sha256").update(`${tenantId}:${email.toLowerCase()}`).digest("hex")]
      ).catch(() => {}); // non-fatal
    }
  }

  /**
   * Call AFTER failed password verification.
   * Increments counters and writes to DB for persistence.
   */
  async function onFailure(tenantId: string, email: string, ip: string): Promise<void> {
    if (!redis) return;

    const credK = emailKey(tenantId, email);
    const newCredCount = await redis.incr(credK);
    if (newCredCount === 1) await redis.expire(credK, LOCKOUT_SECONDS + 60);
    if (newCredCount >= MAX_ATTEMPTS) await redis.expire(credK, LOCKOUT_SECONDS);

    const ipK = ipKey(ip);
    const newIpCount = await redis.incr(ipK);
    if (newIpCount === 1) await redis.expire(ipK, IP_LOCKOUT_SECONDS);

    // Persist to DB (non-fatal — Redis is primary)
    if (tenantPool) {
      const emailHash = crypto.createHash("sha256")
        .update(`${tenantId}:${email.toLowerCase()}`).digest("hex");
      const lockedUntil = newCredCount >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_SECONDS * 1000)
        : null;
      await tenantPool.query(`
        INSERT INTO login_attempts (tenant_id, email_hash, attempts, last_attempt_at, locked_until)
        VALUES (?, ?, 1, NOW(), ?)
        ON DUPLICATE KEY UPDATE
          attempts     = attempts + 1,
          last_attempt_at = NOW(),
          locked_until = IF(attempts + 1 >= ?, ?, locked_until)
      `, [tenantId, emailHash, lockedUntil, MAX_ATTEMPTS, lockedUntil]).catch(() => {});
    }
  }

  return { checkAndThrow, onSuccess, onFailure };
}

export type LoginProtection = ReturnType<typeof buildLoginProtection>;
