import { Queue } from "bullmq";
import type { AppConfig } from "../../config/types.js";

export function buildQueue(config: AppConfig) {
  return new Queue("jobs", { connection: { url: config.redisUrl } as any });
}
