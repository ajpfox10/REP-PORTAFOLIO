import type { Request, Response, NextFunction } from "express";
import { randomUUID, randomBytes } from "crypto";

function genId() {
  return typeof randomUUID === "function"
    ? randomUUID()
    : randomBytes(16).toString("hex");
}

// ✅ Middleware directo (NO factory)
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const id = incoming && incoming.trim() ? incoming.trim() : genId();

  (req as any).requestId = id;
  res.setHeader("x-request-id", id);

  next();
}
