import fs from "fs";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { env } from "../config/env";

const ensureDir = (p: string) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

ensureDir(path.resolve(process.cwd(), env.LOG_DIR));

const fileRotate = new DailyRotateFile({
  dirname: path.resolve(process.cwd(), env.LOG_DIR),
  filename: "app-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: false,
  maxFiles: `${env.LOG_RETENTION_DAYS}d`
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    fileRotate,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf((info) => {
          // Winston pone todo en `info`, no solo `message`.
          // Si el message es objeto (caso típico: logger.info({ msg: "...", ...meta })), lo serializamos bien.
          const base: any = {
            timestamp: info.timestamp,
            level: info.level,
          };

          // `message` puede venir como string u objeto
          const message = (info as any).message;
          if (typeof message === "string") base.message = message;
          else if (message !== undefined) base.message = message;

          // Copiamos el resto de campos relevantes (meta) evitando keys internas
          for (const [k, v] of Object.entries(info)) {
            if (k === "level" || k === "timestamp" || k === "message") continue;
            if (k.startsWith("_") || k === "[Symbol(message)]") continue;
            (base as any)[k] = v;
          }

          return JSON.stringify(base);
        })
      )
    })
  ]
});
