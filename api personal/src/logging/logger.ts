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
          const msg = typeof info.message === "string" ? info.message : JSON.stringify(info.message);
          return `${info.timestamp} ${info.level}: ${msg}`;
        })
      )
    })
  ]
});
