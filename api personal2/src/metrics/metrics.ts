import { Request, Response, NextFunction } from "express";
import client from "prom-client";

type Bucket = { count: number; totalMs: number };

const buckets: Record<string, Bucket> = {};

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const key = `${req.method} ${req.route?.path || req.path}`;
    buckets[key] = buckets[key] || { count: 0, totalMs: 0 };
    buckets[key].count += 1;
    buckets[key].totalMs += Date.now() - start;
  });
  next();
};

export const metricsHandler = async (_req: Request, res: Response) => {
  // 1) Métricas simples (legacy) para debug rápido
  const lines: string[] = [];
  for (const [k, b] of Object.entries(buckets)) {
    const avg = b.count ? b.totalMs / b.count : 0;
    lines.push(`${k} count=${b.count} avg_ms=${avg.toFixed(2)}`);
  }

  // 2) Métricas Prometheus (registry global de prom-client)
  let promText = "";
  try {
    promText = await client.register.metrics();
  } catch {
    promText = "";
  }

  const out =
    lines.join("\n") +
    (lines.length ? "\n" : "") +
    (promText ? "\n# --- prometheus ---\n" + promText : "");

  res.type("text/plain").send(out + "\n");
};
