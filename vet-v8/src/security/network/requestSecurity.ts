import type { Request } from "express";

export function getNormalizedHost(req: Request): string {
  return String(req.headers.host ?? "").toLowerCase().split(":")[0];
}

export function isPrivateIp(ipRaw: string): boolean {
  const ip = String(ipRaw || "").replace(/^::ffff:/, "");
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

export function sameUserAgentFamily(expected: string, current: string): boolean {
  const norm = (v: string) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const e = norm(expected);
  const c = norm(current);
  if (!e || !c) return true;
  const keys = ["chrome", "firefox", "safari", "edg", "mozilla", "postman", "curl"];
  const pick = (s: string) => keys.find((k) => s.includes(k)) ?? s.slice(0, 24);
  return pick(e) === pick(c);
}

export function parseOrigin(origin?: string | null): URL | null {
  try {
    return origin ? new URL(origin) : null;
  } catch {
    return null;
  }
}

export function isAllowedCorsOrigin(origin: string, opts: { baseDomain: string; extraOrigins?: string[] }) {
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const proto = parsed.protocol;
  const base = String(opts.baseDomain || "").toLowerCase().trim();
  const extras = new Set((opts.extraOrigins ?? []).map((v) => String(v).trim()).filter(Boolean));
  if (extras.has(origin)) return true;
  if (!base) return false;
  if (proto !== "https:" && !extras.has(origin)) return false;
  return host === base || host.endsWith(`.${base}`);
}

export function validateCanonicalTenantHost(host: string, baseDomain: string): { ok: boolean; subdomain: string | null } {
  const clean = String(host || "").toLowerCase().split(":")[0];
  const base = String(baseDomain || "").toLowerCase().trim();
  if (!clean || !base) return { ok: false, subdomain: null };
  if (clean === base) return { ok: true, subdomain: null };
  if (!clean.endsWith(`.${base}`)) return { ok: false, subdomain: null };
  const left = clean.slice(0, -(base.length + 1));
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(left)) return { ok: false, subdomain: null };
  return { ok: true, subdomain: left };
}
