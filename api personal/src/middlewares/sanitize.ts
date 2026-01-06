import type { RequestHandler } from "express";

/**
 * Sanitiza body/query:
 * - trim strings
 * - elimina keys peligrosas (__proto__/constructor/prototype)
 * - convierte objetos a "null-prototype" para que obj.__proto__ sea undefined
 */

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeDeep(value: any): any {
  if (value === null || value === undefined) return value;

  // strings: trim
  if (typeof value === "string") return value.trim();

  // arrays: map
  if (Array.isArray(value)) return value.map(sanitizeDeep);

  // objects: deep-copy a null-prototype y filtrar keys bloqueadas
  if (typeof value === "object") {
    const out: any = Object.create(null);

    for (const [k, v] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(k)) continue;
      out[k] = sanitizeDeep(v);
    }

    return out;
  }

  // numbers/booleans/etc
  return value;
}

export const sanitize: RequestHandler = (req, _res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeDeep(req.body);
  }

  // req.query puede venir como objeto/array/string por qs
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeDeep(req.query) as any;
  }

  next();
};
