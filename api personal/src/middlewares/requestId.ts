// src/middlewares/requestId.ts
// Usa AsyncLocalStorage para que el requestId sea correcto bajo carga concurrente.
// global.requestId era compartido entre todas las requests simultáneas (race condition).
import type { Request, Response, NextFunction } from "express";
import { randomUUID, randomBytes } from "crypto";
import { AsyncLocalStorage } from "async_hooks";

export const requestIdStorage = new AsyncLocalStorage<string>();

/**
 * Obtener el requestId del contexto actual (compatible con async/await).
 * Usar esto en lugar de global.requestId en cualquier código que corra
 * dentro de un middleware de Express.
 */
export function getRequestId(): string | undefined {
  return requestIdStorage.getStore();
}

function genId() {
  return typeof randomUUID === "function"
    ? randomUUID()
    : randomBytes(16).toString("hex");
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const id = incoming?.trim() || genId();

  (req as any).requestId = id;
  res.setHeader("x-request-id", id);

  // Ejecutar el resto de la cadena dentro del contexto AsyncLocalStorage
  requestIdStorage.run(id, next);
}
