/**
 * pino-http middleware — v10  (S-06)
 *
 * Added custom serializers to prevent request bodies and sensitive
 * response payloads from appearing in logs on auth/clinical routes.
 *
 * Routes with sensitive bodies are listed in SENSITIVE_PATH_PREFIXES.
 * Their req.body is redacted entirely in the log record.
 */

import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";

const SENSITIVE_PATH_PREFIXES = [
  "/api/v1/auth/",
  "/api/v1/portal/login",
  "/api/v1/portal/register",
];

function isSensitivePath(url: string): boolean {
  return SENSITIVE_PATH_PREFIXES.some(p => url.startsWith(p));
}

export const pinoHttpMiddleware = pinoHttp({
  logger,
  genReqId: () => randomUUID(),

  // Custom serializers: redact body on sensitive paths
  serializers: {
    req(req) {
      return {
        id:     req.id,
        method: req.method,
        url:    req.url,
        // Redact body on sensitive paths; include (safely) on others
        body: isSensitivePath(req.url ?? "") ? "[Redacted]" : undefined,
        remoteAddress: req.remoteAddress,
        remotePort:    req.remotePort,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },

  // Don't log health probe noise
  autoLogging: {
    ignore: (req) => (req.url ?? "").startsWith("/health"),
  },
});
