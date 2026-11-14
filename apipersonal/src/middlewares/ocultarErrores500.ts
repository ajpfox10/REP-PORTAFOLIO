// src/middlewares/ocultarErrores500.ts
// Los errores del servidor (5xx) no le muestran al navegador el detalle interno
// (rutas de disco, SQL, nombres de tablas, stack). El navegador recibe un mensaje
// genérico con una referencia; el detalle completo queda en el log con esa referencia.
// Las respuestas 4xx (datos mal cargados, permisos) no se tocan.
import type { Request, Response, NextFunction } from "express";
import { logger } from "../logging/logger";

// Campos que se conservan en una respuesta 5xx (no traen información interna).
const CAMPOS_SEGUROS = new Set(["ok", "data", "items", "rows", "total", "count"]);

function referencia(req: Request): string {
  const id = String((req as any).requestId || "");
  return id ? id.slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

export function ocultarErrores500(req: Request, res: Response, next: NextFunction) {
  const jsonOriginal = res.json.bind(res);
  const sendOriginal = res.send.bind(res);
  let yaProcesado = false;

  res.json = ((body: any) => {
    if (res.statusCode < 500 || yaProcesado) return jsonOriginal(body);
    yaProcesado = true;
    const ref = referencia(req);
    logger.error({
      msg: "Error 5xx (detalle oculto al cliente)",
      ref,
      requestId: (req as any).requestId,
      status: res.statusCode,
      method: req.method,
      path: req.originalUrl,
      body: (() => { try { return JSON.stringify(body).slice(0, 4000); } catch { return String(body).slice(0, 4000); } })(),
    });
    const limpio: Record<string, any> = {};
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const k of Object.keys(body)) if (CAMPOS_SEGUROS.has(k)) limpio[k] = body[k];
    }
    limpio.ok = false;
    limpio.error = `Error interno del servidor (ref. ${ref}). Avisá a sistemas con esta referencia.`;
    limpio.ref = ref;
    if ((req as any).requestId) limpio.requestId = (req as any).requestId;
    return jsonOriginal(limpio);
  }) as any;

  res.send = ((body: any) => {
    // res.json termina llamando a res.send con el texto ya limpio: no tocar de nuevo
    if (res.statusCode < 500 || yaProcesado || typeof body !== "string") return sendOriginal(body);
    yaProcesado = true;
    const ref = referencia(req);
    logger.error({
      msg: "Error 5xx (detalle oculto al cliente)",
      ref,
      requestId: (req as any).requestId,
      status: res.statusCode,
      method: req.method,
      path: req.originalUrl,
      body: body.slice(0, 4000),
    });
    return sendOriginal(`Error interno del servidor (ref. ${ref})`);
  }) as any;

  next();
}
