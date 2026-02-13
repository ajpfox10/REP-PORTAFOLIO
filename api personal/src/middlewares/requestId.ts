// src/middlewares/requestId.ts
import type { Request, Response, NextFunction } from "express";
import { randomUUID, randomBytes } from "crypto";

declare global {
  var requestId: string | undefined; // ✅ AGREGADO PARA TRACK.TS
}

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
  
  // ✅ AGREGADO: asignar a global para track.ts
  global.requestId = id;

  next();
}