import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// Asigna un identificador por request para auditoria y soporte.
export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = String(req.header("x-request-id") || randomUUID());
  res.setHeader("x-request-id", req.requestId);
  next();
}
