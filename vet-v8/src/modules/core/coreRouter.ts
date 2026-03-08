import { Router } from "express";
import { appendAudit } from "../../audit/auditRepo.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

export const coreRouter = Router();

/**
 * GET /api/v1/me — Returns authenticated user's context
 */
coreRouter.get("/me", (req, res) => {
  const ctx = getCtx(req);
  res.json({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      roles: ctx.roles ?? [],
      plan: ctx.plan,
      region: ctx.region,
      locale: ctx.locale,
      sucursalId: ctx.sucursalId ?? null,
      veterinarioId: ctx.veterinarioId ?? null
    },
    meta: { requestId: (req as any).id },
    errors: []
  });
});

/**
 * GET /api/v1/audit — Returns audit log (admin only)
 */
coreRouter.get("/audit", async (req, res, next) => {
  try {
    const ctx = getCtx(req);
    if (!ctx.roles?.includes("admin")) {
      return res.status(403).json({ data: null, meta: { requestId: (req as any).id }, errors: [{ code: "RBAC_DENIED", message: "Admin only" }] });
    }

    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
    const [rows] = await ctx.tenantPool.query<any[]>(
      "SELECT id, ts, actor_user_id, action, resource, resource_id, ip, request_id FROM auditoria_log WHERE tenant_id=? ORDER BY ts DESC LIMIT ?",
      [ctx.tenantId, limit]
    );
    res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
  } catch (e) { next(e); }
});
