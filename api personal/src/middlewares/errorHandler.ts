import type { NextFunction, Request, Response } from "express";
import { logger } from "../logging/logger";

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // 1) status base
  let status = err?.status || err?.statusCode || 500;

  // 2) Normalización Sequelize
  const name = String(err?.name || "");
  if (name.includes("SequelizeForeignKeyConstraintError")) status = 409;
  else if (name.includes("SequelizeUniqueConstraintError")) status = 409;
  else if (name.includes("SequelizeValidationError")) status = 400;

  // 3) Normalización OpenAPI validator (404 reales, no 500 fantasmas)
  const msgRaw = String(err?.message || "");
  const stackRaw = String(err?.stack || "");
  const looksLikeOpenApiValidatorNotFound =
    msgRaw.includes("Not Found") &&
    (stackRaw.includes("express-openapi-validator") || stackRaw.includes("openapi.metadata"));

  if (status === 500 && looksLikeOpenApiValidatorNotFound) status = 404;

  // 4) Contexto (requestId/actor)
  const requestId = (req as any)?.requestId;
  const auth = (req as any)?.auth;
  const actor = auth
    ? { principalType: auth?.principalType, principalId: auth?.principalId }
    : null;

  // 5) Armar payload DESPUÉS de normalizar status
  const logPayload = {
    msg: status >= 500 ? "Unhandled error" : "Request rejected",
    status,
    requestId,
    actor,
    method: req.method,
    path: req.originalUrl,
    query: req.query,
    err: err?.message ? `${err.message}\n${err.stack || ""}` : err,
  };

  // 6) Nivel de log
  if (status === 401 || status === 403) logger.warn(logPayload);
  else if (status >= 400 && status < 500) logger.info(logPayload);
  else logger.error(logPayload);

  if (res.headersSent) return;

  // 7) Details para debugging de cliente (si aplica)
  const details =
    err?.errors ??
    err?.details ??
    err?.error?.errors ??
    undefined;

  // 8) Mensaje
  const msg =
    status === 500 ? "Error interno"
    : err?.message || (status === 409 ? "Conflicto" : "Error");

  res.status(status).json({
    ok: false,
    error: msg,
    details,
    requestId,
  });
}
