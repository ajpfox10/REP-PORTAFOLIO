import { Request, Response, NextFunction } from "express";

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

export const metricsHandler = (_req: Request, res: Response) => {
  const lines: string[] = [];
  for (const [k, b] of Object.entries(buckets)) {
    const avg = b.count ? b.totalMs / b.count : 0;
    lines.push(`${k} count=${b.count} avg_ms=${avg.toFixed(2)}`);
  }
  res.type("text/plain").send(lines.join("\n") + "\n");
};
