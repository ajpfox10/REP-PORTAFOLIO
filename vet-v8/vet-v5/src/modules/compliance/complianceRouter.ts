import { Router } from "express";
import type { Queue } from "bullmq";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";

const ExportIn = z.object({
  scope: z.enum(["tenant", "user"]).default("tenant"),
  user_id: z.string().min(1).optional(),
  format: z.enum(["jsonl", "zip"]).default("jsonl"),
});

const DeleteIn = z.object({
  scope: z.enum(["user", "tenant"]),
  user_id: z.string().min(1).optional(),
  confirm: z.literal(true),
});

export function buildComplianceRouter(opts: { queue: Queue }) {
  const router = Router();

  /**
   * POST /api/v1/compliance/export
   * Body: { scope: 'tenant'|'user', user_id?, format }
   * Returns job id.
   */
  router.post("/export", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const tenantId = ctx.tenantId;
      const input = ExportIn.parse(req.body);

      if (input.scope === "user" && !input.user_id) {
        throw new AppError("BAD_REQUEST", "user_id requerido para scope=user", 400);
      }

      const job = await opts.queue.add("compliance-export", {
        tenantId,
        actorUserId: ctx.userId,
        scope: input.scope,
        userId: input.user_id,
        format: input.format,
      }, { removeOnComplete: 100, removeOnFail: 100 });

      return res.status(202).json({ jobId: job.id });
    } catch (e) { return next(e); }
  });

  /**
   * POST /api/v1/compliance/delete
   * Body: { scope: 'user'|'tenant', user_id?, confirm: true }
   * Returns job id.
   */
  router.post("/delete", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const tenantId = ctx.tenantId;
      const input = DeleteIn.parse(req.body);

      if (input.scope === "user" && !input.user_id) {
        throw new AppError("BAD_REQUEST", "user_id requerido para scope=user", 400);
      }

      const job = await opts.queue.add("compliance-delete", {
        tenantId,
        actorUserId: ctx.userId,
        scope: input.scope,
        userId: input.user_id,
      }, { removeOnComplete: 100, removeOnFail: 100 });

      return res.status(202).json({ jobId: job.id });
    } catch (e) { return next(e); }
  });

  return router;
}
