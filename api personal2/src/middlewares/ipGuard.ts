import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

const parseList = (s?: string) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

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

function firstForwardedFor(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  if (!raw) return "";
  return String(raw).split(",")[0].trim();
}

export const ipGuard = (req: Request, res: Response, next: NextFunction) => {
  if (!env.IP_GUARD_ENABLE) return next();

  const forwarded = env.TRUST_PROXY ? firstForwardedFor(req) : "";
  const ip = normalizeIp(forwarded || req.ip || req.socket.remoteAddress || "");

  // ✅ según tu env.ts: IP_ALLOWLIST / IP_BLACKLIST son string (CSV)
  const allow = parseList(env.IP_ALLOWLIST).map(normalizeIp);
  const deny = parseList(env.IP_BLACKLIST).map(normalizeIp);

  if (deny.length && deny.includes(ip)) return res.status(403).json({ ok: false, error: "IP bloqueada" });
  if (allow.length && !allow.includes(ip)) return res.status(403).json({ ok: false, error: "IP no permitida" });

  next();
};
