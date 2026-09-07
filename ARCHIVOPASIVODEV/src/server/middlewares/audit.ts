import type { NextFunction, Request, Response } from "express";
import { query } from "../db/pool.js";
import { clientIp } from "../auth/loginGuard.js";

// Registra eventos de escritura sin bloquear la respuesta ante fallos de auditoria.
export function auditAction(action: string, entity: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
      void query(
        `INSERT INTO audit_log
          (request_id, usuario_id, ip, method, route, status_code, duration_ms, action, entity, request_json)
         VALUES
          (:requestId, :userId, :ip, :method, :route, :statusCode, :durationMs, :action, :entity, :requestJson)`,
        {
          requestId: req.requestId ?? null,
          userId: req.auth?.userId ?? null,
          ip: clientIp(req),
          method: req.method,
          route: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          action,
          entity,
          requestJson: JSON.stringify(req.body ?? null),
        }
      ).catch(() => undefined);
    });
    next();
  };
}
