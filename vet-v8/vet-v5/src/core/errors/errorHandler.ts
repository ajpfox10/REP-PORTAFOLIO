import { type ErrorRequestHandler } from "express";
import { AppError } from "./appError.js";
import { errorResponse } from "./errorResponse.js";
import { logger } from "../logging/logger.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as any).id;
  if (err instanceof AppError) {
    return res.status(err.status).json(errorResponse({ requestId, errors: [{ code: err.code, message: err.message, details: err.details }] }));
  }
  logger.error({ err, requestId }, "unhandled error");
  return res.status(500).json(errorResponse({ requestId, errors: [{ code: "UNKNOWN", message: "Unexpected error" }] }));
};
