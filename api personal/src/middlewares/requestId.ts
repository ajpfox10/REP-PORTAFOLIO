import { Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";

export const requestId = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header("x-request-id") || req.header("X-Request-Id");
  const id = incoming && incoming.trim().length > 0 ? incoming.trim() : uuid();

  // disponible para tu código
  (req as any).requestId = id;

  // IMPORTANTe para OpenAPI validator (valida headers de REQUEST)
  try {
    (req as any).headers = (req as any).headers || {};
    (req as any).headers["x-request-id"] = id;
  } catch {
    // noop
  }

  // visible para el cliente
  res.setHeader("x-request-id", id);

  next();
};
