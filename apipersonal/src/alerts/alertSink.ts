import { logger } from "../logging/logger";

type AlertLevel = "info" | "warn" | "critical";

export function emitAlert(level: AlertLevel, title: string, details?: any) {
  // Por diseño: NUNCA rompe requests. Solo emite log estructurado.
  try {
    logger.warn({
      msg: "ALERT",
      level,
      title,
      details: details ?? null,
    });
  } catch {
    // fallback absoluto (sin console)
    try {
      process.stderr.write(`ALERT ${level} ${title} ${JSON.stringify(details ?? null)}\n`);
    } catch {
      // no-op
    }
  }
}
