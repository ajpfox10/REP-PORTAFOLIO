/**
 * Security Headers — v10  (S-07)
 *
 * Replaces the default helmet({ contentSecurityPolicy: ... }) with:
 *   1. Explicit, strict Content-Security-Policy (not helmet defaults)
 *   2. Permissions-Policy: disables browser APIs not needed by the app
 *   3. Strict-Transport-Security with preload
 *   4. X-Content-Type-Options, X-Frame-Options, Referrer-Policy
 *
 * Active in ALL environments (not just production).
 * The CSP uses nonce-based script-src — nonce injected per request.
 *
 * Important: if the frontend uses inline scripts or external CDNs,
 * add their hashes/domains to the CSP directives below.
 */

import helmet from "helmet";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

// ── CSP directives ────────────────────────────────────────────────────────────

function buildCsp(nonce: string, isDev: boolean): string {
  const directives: string[] = [
    `default-src 'self'`,
    // Nonce allows inline scripts injected by SSR; hash-based for known snippets
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,   // unsafe-inline needed for most CSS-in-JS
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `media-src 'none'`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,             // Stronger than X-Frame-Options
    `form-action 'self'`,
    `base-uri 'self'`,
    `upgrade-insecure-requests`,
  ];
  return directives.join("; ");
}

// ── Permissions-Policy ────────────────────────────────────────────────────────

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "fullscreen=(self)",
  "display-capture=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
].join(", ");

// ── Middleware factory ────────────────────────────────────────────────────────

export function buildSecurityHeaders(opts: { isDev?: boolean } = {}): RequestHandler[] {
  const isDev = opts.isDev ?? false;

  // Base helmet config (CSP disabled — we handle it ourselves with nonce)
  const helmetMiddleware = helmet({
    contentSecurityPolicy: false,      // overridden below with nonce
    crossOriginEmbedderPolicy: false,  // enable only if needed for SharedArrayBuffer
  });

  // Per-request nonce + CSP + Permissions-Policy
  const cspNonceMiddleware: RequestHandler = (_req: Request, res: Response, next: NextFunction) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    (res.locals as any).cspNonce = nonce;

    res.setHeader("Content-Security-Policy", buildCsp(nonce, isDev));
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // HSTS: 1 year, includeSubDomains, preload (production only)
    if (!isDev) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload"
      );
    }
    next();
  };

  return [helmetMiddleware, cspNonceMiddleware];
}
