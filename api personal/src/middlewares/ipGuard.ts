import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

const parseList = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

export const ipGuard = (req: Request, res: Response, next: NextFunction) => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "";

  const allow = parseList(env.IP_ALLOWLIST);
  const deny = parseList(env.IP_BLACKLIST);

  if (deny.length && deny.includes(ip)) return res.status(403).json({ ok: false, error: "IP bloqueada" });
  if (allow.length && !allow.includes(ip)) return res.status(403).json({ ok: false, error: "IP no permitida" });

  next();
};
