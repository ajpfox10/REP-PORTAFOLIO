import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";
import crypto from "node:crypto";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

type StoredResponse = { status: number; headers: Record<string, string>; body: any };

export function buildIdempotencyMiddleware(opts: { redis: Redis; ttlSeconds: number }) {
  const { redis, ttlSeconds } = opts;

  return async function idempotency(req: Request, res: Response, next: NextFunction) {
    // Apply only to non-GET mutating methods
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

    const key = req.header("Idempotency-Key");
    if (!key) return next();

    const ctx = getCtx(req) || {};
    const tenantId = ctx.tenantId || "unknown";
    const userId = ctx.userId || "anon";

    // Make the key route-specific to avoid collisions
    const route = req.originalUrl.split("?")[0];
    const normalized = `idem:${tenantId}:${userId}:${req.method}:${route}:${key}`;

    const existing = await redis.get(normalized);
    if (existing) {
      const stored = JSON.parse(existing) as StoredResponse;
      for (const [h, v] of Object.entries(stored.headers || {})) {
        try { res.setHeader(h, v); } catch {}
      }
      return res.status(stored.status).json(stored.body);
    }

    // Capture response
    const chunks: any[] = [];
    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);

    function store(body: any) {
      const headers: Record<string, string> = {};
      const allow = ["content-type"];
      for (const h of allow) {
        const v = res.getHeader(h);
        if (typeof v === "string") headers[h] = v;
      }
      const payload: StoredResponse = { status: res.statusCode, headers, body };
      return redis.setex(normalized, ttlSeconds, JSON.stringify(payload));
    }

    (res as any).json = (body: any) => {
      store(body).catch(() => {});
      return origJson(body);
    };
    (res as any).send = (body: any) => {
      // If send is used, try to parse JSON, else store raw
      let val: any = body;
      try { if (typeof body === "string") val = JSON.parse(body); } catch {}
      store(val).catch(() => {});
      return origSend(body);
    };

    return next();
  };
}
