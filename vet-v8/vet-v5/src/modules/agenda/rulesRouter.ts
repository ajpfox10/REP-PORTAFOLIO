import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

/**
 * Agenda rules: "ranges with exceptions"
 * - resource_type: 'vet' | 'sucursal'
 * - resource_id: id
 * - day_of_week: 0..6
 * - start_time/end_time: 'HH:MM'
 * - slot_minutes: integer
 */
const RuleIn = z.object({
  resource_type: z.enum(["vet", "sucursal"]),
  resource_id: z.string().min(1),
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d\d:\d\d$/),
  end_time: z.string().regex(/^\d\d:\d\d$/),
  slot_minutes: z.coerce.number().int().min(5).max(240).default(30),
  active: z.coerce.boolean().default(true),
});

export function buildAgendaRulesRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const [rows] = await ctx.tenantPool.query<any[]>("SELECT * FROM agenda_rules ORDER BY resource_type, resource_id, day_of_week");
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Admin only");
      const body = RuleIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        "INSERT INTO agenda_rules (resource_type, resource_id, day_of_week, start_time, end_time, slot_minutes, active, created_by) VALUES (?,?,?,?,?,?,?,?)",
        [body.resource_type, body.resource_id, body.day_of_week, body.start_time, body.end_time, body.slot_minutes, body.active ? 1 : 0, ctx.userId ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, { tenant_id: ctx.tenantId, actor_user_id: ctx.userId, action: "create", resource: "agenda_rules", resource_id: String(id), after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
