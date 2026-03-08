import { Router } from "express";
import { buildPolicyEngine } from "../../security/policy-engine/index.js";
import { AppError } from "../../core/errors/appError.js";
import type { AppConfig } from "../../config/types.js";

export function buildAuthzRouter(opts: { config: AppConfig }) {
  const router = Router();
  const engine = buildPolicyEngine({ config: opts.config });

  /**
   * POST /api/v1/authz/explain
   * Body: { table, op, requiredPerm? }
   */
  router.post("/explain", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx || {};
      const { table, op, requiredPerm } = req.body || {};
      if (!table || !op) throw new AppError("BAD_REQUEST", "table y op son requeridos", 400);

      const roles = ctx.roles || [];
      const allowed = engine.crudAllowed(table, op, roles);

      const details: any = {
        allowed,
        table,
        op,
        roles,
        denylist: opts.config.crudTableDenylist.includes(table),
        allowlistEnabled: opts.config.crudStrictAllowlist,
        allowlistHas: opts.config.crudTableAllowlist.includes(table),
      };

      if (requiredPerm) {
        details.requiredPerm = requiredPerm;
        details.hasRequiredPerm = engine.hasPermission(requiredPerm, roles);
      }

      if (!allowed) {
        details.reason =
          details.denylist ? "TABLE_DENYLIST" :
          (details.allowlistEnabled && !details.allowlistHas) ? "NOT_IN_ALLOWLIST" :
          "POLICY_OR_ROLE_DENIED";
      } else {
        details.reason = "ALLOWED";
      }

      return res.json(details);
    } catch (e) { return next(e); }
  });

  return router;
}
