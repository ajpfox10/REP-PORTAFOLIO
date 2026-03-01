import { Sequelize } from "sequelize";

function normalizeIp(ip: string): string {
  let v = (ip || "").trim();
  if (!v) return "";

  // "ip:port" (IPv4)
  if (v.includes(":") && v.includes(".") && v.split(":").length === 2) {
    const maybePort = v.split(":")[1];
    if (/^\d+$/.test(maybePort)) v = v.split(":")[0];
  }

  // ::ffff:127.0.0.1 -> 127.0.0.1
  if (v.startsWith("::ffff:")) v = v.slice("::ffff:".length);
  // ::1 -> 127.0.0.1
  if (v === "::1") v = "127.0.0.1";

  return v;
}

function firstForwardedFor(req: any): string {
  const xf = req?.headers?.["x-forwarded-for"];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  if (!raw) return "";
  return String(raw).split(",")[0].trim();
}

export function getClientIp(req: any, trustProxy: boolean): string {
  const forwarded = trustProxy ? firstForwardedFor(req) : "";
  const ip = forwarded || req?.ip || req?.socket?.remoteAddress || "";
  return normalizeIp(String(ip));
}

export async function getLoginLock(sequelize: Sequelize, ip: string, identifier: string) {
  const [rows] = await sequelize.query(
    `
    SELECT attempts, locked_until AS lockedUntil
    FROM auth_login_guard
    WHERE ip = :ip AND identifier = :identifier
    LIMIT 1
    `,
    { replacements: { ip, identifier } }
  );

  const list = rows as any[];
  if (!list.length) return { attempts: 0, lockedUntil: null as Date | null };

  const r = list[0];
  return {
    attempts: Number(r.attempts || 0),
    lockedUntil: r.lockedUntil ? new Date(r.lockedUntil) : null,
  };
}

export async function recordLoginAttempt(
  sequelize: Sequelize,
  ip: string,
  identifier: string,
  ok: boolean,
  maxAttempts: number,
  lockMinutes: number
) {
  const now = new Date();

  if (ok) {
    // en éxito, limpiamos contador (evita lockouts eternos)
    await sequelize.query(
      `DELETE FROM auth_login_guard WHERE ip = :ip AND identifier = :identifier`,
      { replacements: { ip, identifier } }
    );
    return;
  }

  // incrementa intentos, y si supera umbral -> lock
  await sequelize.query(
    `
    INSERT INTO auth_login_guard (ip, identifier, attempts, locked_until, last_attempt_at)
    VALUES (:ip, :identifier, 1, NULL, :now)
    ON DUPLICATE KEY UPDATE
      attempts = attempts + 1,
      last_attempt_at = :now
    `,
    { replacements: { ip, identifier, now } }
  );

  const { attempts } = await getLoginLock(sequelize, ip, identifier);
  if (attempts >= maxAttempts) {
    const lockedUntil = new Date(now.getTime() + lockMinutes * 60 * 1000);
    await sequelize.query(
      `
      UPDATE auth_login_guard
      SET locked_until = :lockedUntil
      WHERE ip = :ip AND identifier = :identifier
      `,
      { replacements: { lockedUntil, ip, identifier } }
    );
  }
}

export async function getActiveSecurityBan(sequelize: Sequelize, ip: string, email: string | null) {
  const now = new Date();
  const [rows] = await sequelize.query(
    `
    SELECT id, ip, usuario_email AS usuarioEmail, reason, banned_until AS bannedUntil
    FROM security_bans
    WHERE banned_until > :now
      AND (
        (ip IS NOT NULL AND ip = :ip)
        OR (usuario_email IS NOT NULL AND usuario_email = :email)
      )
    ORDER BY banned_until DESC
    LIMIT 1
    `,
    { replacements: { now, ip, email } }
  );

  const list = rows as any[];
  if (!list.length) return null;

  const r = list[0];
  return {
    id: Number(r.id),
    ip: r.ip ? String(r.ip) : null,
    usuarioEmail: r.usuarioEmail ? String(r.usuarioEmail) : null,
    reason: r.reason ? String(r.reason) : null,
    bannedUntil: r.bannedUntil ? new Date(r.bannedUntil) : null,
  };
}

export async function createSecurityBan(
  sequelize: Sequelize,
  ip: string | null,
  email: string | null,
  reason: string,
  minutes: number
) {
  const bannedUntil = new Date(Date.now() + minutes * 60 * 1000);
  await sequelize.query(
    `
    INSERT INTO security_bans (ip, usuario_email, reason, banned_until, created_at)
    VALUES (:ip, :email, :reason, :bannedUntil, NOW())
    `,
    { replacements: { ip, email, reason, bannedUntil } }
  );
  return bannedUntil;
}
