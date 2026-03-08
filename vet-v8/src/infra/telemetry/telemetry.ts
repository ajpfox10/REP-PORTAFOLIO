/**
 * telemetry.ts — v11  (Punto 10)
 *
 * OpenTelemetry distribuido:
 *   - Traces end-to-end: HTTP request → DB → Redis
 *   - Correlación con request_id (pino-http) via baggage
 *   - Export a OTLP/gRPC (Jaeger, Datadog, Honeycomb)
 *   - Spans automáticos para mysql2 y ioredis
 *   - Métricas: request duration, DB latency, error rates
 *
 * IMPORTANTE: este módulo debe importarse ANTES que cualquier otro.
 * En server.ts: import "./infra/telemetry/telemetry.js";
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { trace, context, propagation, SpanStatusCode, type Span } from "@opentelemetry/api";
import type { Request, Response, NextFunction } from "express";

// ── SDK singleton ─────────────────────────────────────────────────────────────

let _sdk: NodeSDK | null = null;

export interface TelemetryConfig {
  serviceName:    string;
  serviceVersion: string;
  environment:    string;
  otlpEndpoint?:  string;   // e.g. "http://jaeger:4317"
  enabled:        boolean;
}

export function initTelemetry(cfg: TelemetryConfig): void {
  if (!cfg.enabled || _sdk) return;

  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]:        cfg.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]:     cfg.serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: cfg.environment,
  });

  const traceExporter = new OTLPTraceExporter({
    url: cfg.otlpEndpoint ?? "http://localhost:4317",
  });

  const metricExporter = new OTLPMetricExporter({
    url: cfg.otlpEndpoint ?? "http://localhost:4317",
  });

  _sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30_000,
    }),
    // Auto-instrumenta: http, express, mysql2, ioredis, dns, net
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs":        { enabled: false }, // demasiado ruido
        "@opentelemetry/instrumentation-http":      { enabled: true },
        "@opentelemetry/instrumentation-express":   { enabled: true },
        "@opentelemetry/instrumentation-mysql2":    { enabled: true },
        "@opentelemetry/instrumentation-ioredis":   { enabled: true },
      }),
    ],
  });

  _sdk.start();

  process.on("SIGTERM", () => {
    _sdk?.shutdown().catch(console.error);
  });
}

export function shutdownTelemetry(): Promise<void> {
  return _sdk?.shutdown() ?? Promise.resolve();
}

// ── Tracer ────────────────────────────────────────────────────────────────────

export function getTracer(name = "vetpro") {
  return trace.getTracer(name);
}

// ── Express middleware: correlación request_id → span ─────────────────────────

export function telemetryMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const tracer = getTracer();
    const requestId = (req as any).id ?? crypto.randomUUID();

    const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
      attributes: {
        "http.method":     req.method,
        "http.url":        req.path,
        "http.user_agent": req.headers["user-agent"] ?? "",
        "vetpro.request_id": requestId,
        "vetpro.tenant_id":  (req as any).ctx?.tenantId ?? "unknown",
      },
    });

    // Propagar contexto al resto del request
    const ctx = trace.setSpan(context.active(), span);
    context.with(ctx, () => {
      res.on("finish", () => {
        span.setAttribute("http.status_code", res.statusCode);
        if (res.statusCode >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
        }
        span.end();
      });
      next();
    });
  };
}

// ── Helper: crear span de DB ──────────────────────────────────────────────────

export function dbSpan<T>(
  operation: string,
  table: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(`db.${operation} ${table}`, async (span) => {
    span.setAttribute("db.operation", operation);
    span.setAttribute("db.sql.table", table);
    span.setAttribute("db.system", "mysql");
    try {
      const result = await fn(span);
      return result;
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

// ── Helper: span para operaciones de negocio ─────────────────────────────────

export function businessSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: () => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(`vetpro.${name}`, async (span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    try {
      const result = await fn();
      return result;
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

// ── Exportar tracer para uso en módulos ───────────────────────────────────────

export { trace, context, propagation, SpanStatusCode };
