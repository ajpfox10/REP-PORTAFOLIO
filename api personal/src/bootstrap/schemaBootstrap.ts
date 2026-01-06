import fs from "fs";
import path from "path";
import { Sequelize } from "sequelize";
import { env } from "../config/env";
import { logger } from "../logging/logger";
import { CORE_TABLES } from "./coreTables";
import { introspectSchema } from "../db/schema/introspect";
import { SchemaSnapshot } from "../db/schema/types";

const readJson = <T>(p: string): T | null => {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJson = (p: string, data: any) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
};

const hasCoreTables = (snap: SchemaSnapshot): boolean => {
  if (!CORE_TABLES || CORE_TABLES.length === 0) return true;
  const names = Object.keys(snap.tables || {});
  return CORE_TABLES.every((t) => names.includes(t));
};

export const schemaBootstrap = async (sequelize: Sequelize): Promise<SchemaSnapshot> => {
  const cachePath = path.resolve(process.cwd(), env.SCHEMA_CACHE_PATH);
  const cached = readJson<SchemaSnapshot>(cachePath);

  const shouldRefresh = env.NODE_ENV !== "production" || !cached;

  if (!shouldRefresh && cached) {
    if (!hasCoreTables(cached)) {
      logger.warn("Schema cache found but core tables missing; refreshing from DB");
    } else {
      logger.info({ msg: "Schema loaded from cache", cachePath, hash: cached.hash });
      return cached;
    }
  }

  logger.info({ msg: "Introspecting schema from DB...", db: env.DB_NAME });
  const snap = await introspectSchema(sequelize);

  if (!hasCoreTables(snap)) {
    logger.warn({ msg: "Core tables check failed (continuing anyway)", coreTables: CORE_TABLES });
  }

  writeJson(cachePath, snap);
  logger.info({ msg: "Schema cached", cachePath, hash: snap.hash });

  return snap;
};
