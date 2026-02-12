import type { RequestHandler } from "express";
import helmet from "helmet";
import hpp from "hpp";
import { env } from "../config/env";

/**
 * Hardening HTTP (defensa general).
 *
 * - No cambia endpoints ni contratos
 * - Ajusta headers a un API (no es una web con templates)
 * - HSTS solo en producción
 */
export function hardening(): RequestHandler[] {
  const isProd = env.NODE_ENV === "production";

  const helmetMw = helmet({
    // Para APIs suele ser mejor no forzar CSP (lo maneja el front en su hosting)
    contentSecurityPolicy: false,
    // Si el front sirve en otro origen, esto puede romper si se activa.
    crossOriginEmbedderPolicy: false,
    // HSTS solo prod
    hsts: isProd
      ? {
          maxAge: 15552000, // 180 días
          includeSubDomains: true,
          preload: false,
        }
      : false,
  });

  const extraHeaders: RequestHandler = (_req, res, next) => {
    // Evita “sniffing” de tipos
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Para APIs, es razonable no enviar referrers
    res.setHeader("Referrer-Policy", "no-referrer");

    // No permitir que se embeba en iframes
    res.setHeader("X-Frame-Options", "DENY");

    next();
  };

  return [helmetMw, hpp(), extraHeaders];
}
