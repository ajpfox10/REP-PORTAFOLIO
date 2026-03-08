/**
 * Metrics router — v9
 *
 * CHANGES vs v8:
 *  - /metrics endpoint now requires Bearer internalToken OR localhost origin.
 *  - Previously could be mounted without authentication, leaking Prometheus
 *    metrics (request counts, latencies, queue depths) to any client.
 *  - metricsMiddleware (prom-client) is unchanged.
 *
 * Configure your Prometheus scrape job with:
 *   bearer_token: <INTERNAL_API_TOKEN>
 */

import { Router, type Request, type Response, type RequestHandler } from "express";
import promClient from "prom-client";

// ── Prometheus setup ─────────────────────────────────────────────────────────

const register = promClient.register;
promClient.collectDefaultMetrics({ register });

export const httpRequestDuration = new promClient.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    httpRequestDuration
      .labels(req.method, req.route?.path ?? req.path, String(res.statusCode))
      .observe((Date.now() - start) / 1000);
  });
  next();
};

// ── Protected metrics router ─────────────────────────────────────────────────

export type MetricsRouterOpts = {
  internalToken: string;   // config.internalApiToken
};

export function buildMetricsRouter(opts: MetricsRouterOpts) {
  const router = Router();
  const { internalToken } = opts;

  router.get("/metrics", async (req: Request, res: Response) => {
    // Allow from localhost without token (Prometheus sidecar pattern)
    const fromLocalhost = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip ?? "");
    if (!fromLocalhost) {
      const auth = req.headers.authorization ?? "";
      if (!auth.startsWith("Bearer ") || auth.slice(7) !== internalToken) {
        res.status(401).set("WWW-Authenticate", "Bearer realm=\"metrics\"").end();
        return;
      }
    }

    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  return router;
}
