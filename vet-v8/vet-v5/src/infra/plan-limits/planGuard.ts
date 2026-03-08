/**
 * planGuard — Subscription-aware feature gating
 *
 * Every optional module (WhatsApp, portal, AFIP, multi-sucursal, etc.) is
 * protected by this middleware. Each module declares which plan(s) can use it.
 *
 * Plan hierarchy:  basic < pro < enterprise < custom
 *
 * Module → min plan mapping lives in PLAN_MODULE_CATALOG below.
 * The internal API can override per-tenant via tenant_features table.
 */

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../core/errors/appError.js";

export type PlanTier = "basic" | "pro" | "enterprise" | "custom";

const TIER_ORDER: Record<PlanTier, number> = {
  basic: 0,
  pro: 1,
  enterprise: 2,
  custom: 3,
};

/** Module key → minimum plan required */
export const PLAN_MODULE_CATALOG: Record<string, PlanTier> = {
  // Core — always available
  "turnos":              "basic",
  "propietarios":        "basic",
  "vacunas":             "basic",
  "pacientes":           "basic",
  "consultas":           "basic",
  "prescripciones":      "basic",
  "inventario":          "basic",
  "agenda_rules":        "basic",

  // Pro
  "internaciones":       "pro",
  "desparasitaciones":   "pro",
  "facturacion":         "pro",
  "multi_sucursal":      "pro",
  "portal_propietario":  "pro",
  "recordatorios_sms":   "pro",
  "dashboard_metricas":  "pro",
  "export_pdf":          "pro",

  // Enterprise
  "whatsapp":            "enterprise",
  "afip_facturacion":    "enterprise",
  "api_webhooks":        "enterprise",
  "sso":                 "enterprise",
  "audit_export":        "enterprise",
};

export function planHasModule(plan: string, moduleKey: string): boolean {
  const minTier = PLAN_MODULE_CATALOG[moduleKey];
  if (!minTier) return true; // unknown = unrestricted
  const planTier = TIER_ORDER[plan as PlanTier] ?? 0;
  return planTier >= TIER_ORDER[minTier];
}

/**
 * Express middleware — gates the route by module key.
 * Also checks tenant-level feature flag override (stored in Redis/DB).
 */
export function requireModule(
  moduleKey: string,
  opts?: { featureFlags?: any }
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = (req as any).ctx;
      const plan: string = ctx.plan ?? "basic";

      // 1. Check feature flag override first (tenant-level enable/disable)
      if (opts?.featureFlags) {
        try {
          const flagEnabled = await opts.featureFlags.isEnabled(
            ctx.tenantId,
            `module:${moduleKey}`,
            planHasModule(plan, moduleKey)
          );
          if (!flagEnabled) {
            throw new AppError(
              "PLAN_REQUIRED",
              `Módulo "${moduleKey}" no disponible en tu plan actual (${plan}). Actualizá tu suscripción.`,
              403
            );
          }
          return next();
        } catch (e: any) {
          if (e.code === "PLAN_REQUIRED") throw e;
          // Redis/DB error — fall through to plan check
        }
      }

      // 2. Plan-based check
      if (!planHasModule(plan, moduleKey)) {
        const minPlan = PLAN_MODULE_CATALOG[moduleKey] ?? "pro";
        throw new AppError(
          "PLAN_REQUIRED",
          `El módulo "${moduleKey}" requiere plan ${minPlan} o superior. Plan actual: ${plan}.`,
          403
        );
      }

      next();
    } catch (e) {
      next(e);
    }
  };
}
