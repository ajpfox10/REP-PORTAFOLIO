import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
export const pinoHttpMiddleware = pinoHttp({ logger, genReqId: () => randomUUID() });
