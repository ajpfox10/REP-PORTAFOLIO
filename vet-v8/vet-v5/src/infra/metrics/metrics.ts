import { Router, type RequestHandler } from "express";
import client from "prom-client";
import { type AppConfig } from "../../config/types.js";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register]
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register]
});

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const seconds = Number(end - start) / 1e9;

    const route = (req.route?.path as string) || req.path || "unknown";
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, seconds);
  });
  next();
};

export function buildMetricsRouter(config: AppConfig) {
  const router = Router();

  router.get("/metrics", async (req, res) => {
    // Optional protection: require bearer token in production setups
    if (config.metricsProtect) {
      const ok = Boolean(req.headers.authorization?.startsWith("Bearer "));
      if (!ok) return res.status(401).send("unauthorized");
    }

    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  return router;
}
