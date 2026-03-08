import Redis from "ioredis";
import { type AppConfig } from "../../config/types.js";
export function buildRedis(config: AppConfig) { return new Redis(config.redisUrl, { maxRetriesPerRequest: null }); }
