import { validateEnv } from "./infra/startup/validateEnv.js";
import { initTracing } from "./infra/tracing/tracing.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config/loadConfig.js";
import { logger } from "./core/logging/logger.js";

// Validate env FIRST — fail fast on misconfiguration
validateEnv();

(async () => {
  await initTracing();
  const config = loadConfig();
  const app = await buildApp(config);

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, version: "5.0.0", env: config.nodeEnv }, "VetPro API started");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown signal received");
    server.close(() => { logger.info("HTTP server closed"); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
})();
