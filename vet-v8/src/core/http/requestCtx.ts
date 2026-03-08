/**
 * getCtx — helper tipado para acceder al contexto de la request.
 *
 * Reemplaza el patrón `(req as any).ctx` que se repetía ~90 veces.
 * Provee autocompletado y evita errores de typo.
 */

import type { Request } from "express";

export interface RequestCtx {
  tenantId: string;
  tenantPool: any;        // mysql2 Pool — tipado fuerte en cada módulo si se necesita
  userId: string | null;
  sessionId: string | null;
  roles: string[];
  plan: string;           // "basic" | "pro" | "enterprise" | "custom"
  sucursalId: number | null;
  veterinarioId: number | null;
  propietarioId: number | null;  // solo para portal "owner"
  ip: string;
}

export function getCtx(req: Request): RequestCtx {
  const ctx = (req as any).ctx;
  if (!ctx) {
    throw new Error("Request context not initialized — tenant resolution middleware missing?");
  }
  return ctx as RequestCtx;
}

/** Shorthand para el requestId de idempotencia/logging */
export function getRequestId(req: Request): string {
  return String((req as any).id ?? (req as any).requestId ?? "");
}

/** Respuesta estándar */
export function ok(data: unknown, requestId: string, meta?: Record<string, unknown>) {
  return { data, meta: { requestId, ...meta }, errors: [] };
}
