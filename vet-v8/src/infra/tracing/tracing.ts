import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

/**
 * Basic OpenTelemetry tracing. Configure via OTEL_EXPORTER_OTLP_ENDPOINT etc.
 * Works with OTLP collectors (Grafana Tempo, Honeycomb, Datadog, etc.)
 */
export async function initTracing() {
  if (process.env.OTEL_TRACES_EXPORTER === "none") return;

  if (process.env.NODE_ENV !== "production") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
  }

  const sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
  });

  await sdk.start();

  // Graceful shutdown
  process.on("SIGTERM", () => {
    sdk.shutdown().catch(() => {});
  });
}
