import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

/**
 * Holidays:
 * - source: 'region' | 'custom'
 * - date: YYYY-MM-DD
 * - closed: whether scheduling is blocked
 */
const HolidayIn = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1),
  source: z.enum(["region", "custom"]).default("custom"),
  closed: z.coerce.boolean().default(true),
});

export function buildHolidaysRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const [rows] = await ctx.tenantPool.query<any[]>("SELECT * FROM holidays ORDER BY date DESC LIMIT 400");
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Admin only");
      const body = HolidayIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        "INSERT INTO holidays (date, name, source, closed, created_by) VALUES (?,?,?,?,?)",
        [body.date, body.name, body.source, body.closed ? 1 : 0, ctx.userId ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, { tenant_id: ctx.tenantId, actor_user_id: ctx.userId, action: "create", resource: "holidays", resource_id: String(id), after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
