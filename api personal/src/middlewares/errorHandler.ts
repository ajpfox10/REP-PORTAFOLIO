import type { NextFunction, Request, Response } from "express";
import { logger } from "../logging/logger";
import { ZodError } from "zod";

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // Normalización de errores comunes (Sequelize, OpenAPI validator, etc.)
  let status = err?.status || err?.statusCode || 500;

  // Sequelize: FK/unique/validation -> 400/409
  const name = String(err?.name || "");
  if (name.includes("SequelizeForeignKeyConstraintError")) status = 409;
  if (name.includes("SequelizeUniqueConstraintError")) status = 409;
  if (name.includes("SequelizeValidationError")) status = 400;

  // Zod: validación de input
  if (err instanceof ZodError) status = 400;

  // OpenAPI validator: a veces devuelve "Not Found" como 500; normalizamos a 404
  const msgRaw = String(err?.message || "");
  const stackRaw = String(err?.stack || "");
  const looksLikeOpenApiValidatorNotFound =
    msgRaw.includes("Not Found") &&
    (stackRaw.includes("express-openapi-validator") || stackRaw.includes("openapi.metadata"));
  if (status === 500 && looksLikeOpenApiValidatorNotFound) status = 404;

  const requestId = (req as any)?.requestId;

  const auth = (req as any)?.auth;
  const actor = auth
    ? {
        principalType: auth?.principalType,
        principalId: auth?.principalId,
      }
    : null;

  const logPayload = {
    msg: status >= 500 ? "Unhandled error" : "Request rejected",
    status,
    requestId,
    actor,
    method: req.method,
    path: req.originalUrl,
    query: req.query,
    err: err?.message ? `${err.message}\n${err.stack || ""}` : err
  };

  // ✅ 401/403: esperado (auth/permiso). No ensuciar ERROR
  if (status === 401 || status === 403) {
    logger.warn(logPayload);
  } else if (status >= 400 && status < 500) {
    // 4xx: normalmente es input inválido / ruta no permitida / validator
    logger.info(logPayload);
  } else {
    logger.error(logPayload);
  }

  if (res.headersSent) return;

  const details =
    err instanceof ZodError
      ? err.issues
      : err?.errors ||
        (err?.details ? err.details : undefined) ||
        (err?.error?.errors ? err.error.errors : undefined);

  const msg =
    status === 500
      ? "Error interno"
      : err?.message || (status === 409 ? "Conflicto" : "Error");

  res.status(status).json({
    ok: false,
    error: msg,
    details,
    requestId
  });
}
