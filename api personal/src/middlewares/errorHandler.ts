import type { NextFunction, Request, Response } from "express";
import { logger } from "../logging/logger";

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // Normalización de errores comunes (Sequelize, OpenAPI validator, etc.)
  let status = err?.status || err?.statusCode || 500;

  // Sequelize: FK/unique/validation -> 400/409
  const name = String(err?.name || "");
  if (name.includes("SequelizeForeignKeyConstraintError")) status = 409;
  if (name.includes("SequelizeUniqueConstraintError")) status = 409;
  if (name.includes("SequelizeValidationError")) status = 400;

  const requestId = (req as any)?.requestId;

  logger.error({
    msg: "Unhandled error",
    status,
    requestId,
    method: req.method,
    path: req.originalUrl,
    err: err?.message ? `${err.message}\n${err.stack || ""}` : err
  });

  if (res.headersSent) return;

  const details =
    err?.errors ||
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
