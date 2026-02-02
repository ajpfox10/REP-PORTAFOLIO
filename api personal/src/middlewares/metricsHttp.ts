import type { Request, Response, NextFunction } from "express";
import { httpInflight, httpRequestsTotal, httpRequestDuration } from "../metrics/prom";

function getRouteLabel(req: Request): string {
  // Usamos route “templated” si existe para evitar cardinalidad (no meter IDs)
  // Express setea req.route cuando matchea; si no, usamos path base.
  const anyReq = req as any;
  const routePath = anyReq?.route?.path;
  if (routePath) return String(routePath);

  // fallback: originalUrl sin query, recortado
  const raw = String(req.baseUrl || "") + String(req.path || "");
  return raw || "unknown";
}

export function metricsHttp(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  httpInflight.inc();

  res.on("finish", () => {
    httpInflight.dec();

    const end = process.hrtime.bigint();
    const durSec = Number(end - start) / 1e9;

    const method = req.method;
    const route = getRouteLabel(req);
    const status = String(res.statusCode);

    httpRequestsTotal.labels(method, route, status).inc(1);
    httpRequestDuration.labels(method, route, status).observe(durSec);
  });

  next();
}
