import client from "prom-client";
import { env } from "../config/env";

export const registry = new client.Registry();

// Métricas default (CPU, memoria, event loop, GC, etc.)
if (env.METRICS_ENABLE) {
  client.collectDefaultMetrics({ register: registry });
}

export const httpInflight = new client.Gauge({
  name: "http_inflight_requests",
  help: "Requests HTTP en curso",
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total de requests HTTP",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duración de requests HTTP (segundos)",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.03, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export function metricsText() {
  return registry.metrics();
}
