/**
 * planGuard — Subscription-aware feature gating
 *
 * Plan hierarchy:  basic < pro < enterprise < custom
 *
 * Regla de precedencia:
 *   1. Si featureFlags tiene un override EXPLÍCITO para el tenant → úsalo
 *   2. Si no hay override (flag no existe) → decidir por plan
 *   3. Un flag en `false` no bloquea si el plan lo cubre (solo lo bloquea si está en false explícito para bajar el tier)
 *
 * FIX: el flag es un OVERRIDE de habilitación temporal, no reemplaza el plan.
 * Un tenant enterprise con flag "whatsapp=false" → bloqueado (admin desactivó el módulo).
 * Un tenant pro sin flag "whatsapp" → bloqueado (plan insuficiente).
 * Un tenant basic con flag "whatsapp=true" → habilitado (override para ese tenant).
 */

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../core/errors/appError.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

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
  "desparasitaciones":   "basic",

  // Pro
  "internaciones":       "pro",
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
  if (!minTier) return true; // unknown module = unrestricted
  const planTier = TIER_ORDER[plan as PlanTier] ?? 0;
  return planTier >= TIER_ORDER[minTier];
}

/**
 * Express middleware — gates the route by module key.
 *
 * FIX: la lógica de feature flags ahora es correcta:
 *   - Si hay un override explícito (flag existe en DB): úsalo como decisión final
 *   - Si NO hay override: cae al check de plan
 * Esto permite tanto "habilitar un módulo para un tenant con plan menor"
 * como "deshabilitar un módulo para un tenant con plan suficiente" (p.ej. compliance).
 */
export function requireModule(moduleKey: string, opts?: { featureFlags?: any }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const plan: string = ctx.plan ?? "basic";

      if (opts?.featureFlags) {
        try {
          // FIX: pasar null como fallback para detectar "flag no existe"
          const cacheKey = `ff:${ctx.tenantId}:module:${moduleKey}`;
          const cached = await opts.featureFlags._redis?.get(cacheKey).catch(() => null);

          if (cached !== null && cached !== undefined) {
            // Hay override explícito en cache
            if (cached === "0") {
              return next(new AppError(
                "PLAN_REQUIRED",
                `Módulo "${moduleKey}" deshabilitado para este tenant. Contactá soporte.`,
                403
              ));
            }
            return next(); // cached "1" → habilitado
          }

          // Consultar DB directamente para detectar si existe el flag
          const [flagRows] = await opts.featureFlags._masterPool?.query<any[]>(
            "SELECT enabled FROM tenant_features WHERE tenant_id=? AND feature_key=? LIMIT 1",
            [ctx.tenantId, `module:${moduleKey}`]
          ).catch(() => [[]]);

          if (flagRows?.length) {
            // Override explícito en DB
            const enabled = Boolean(flagRows[0].enabled);
            await opts.featureFlags._redis?.set(cacheKey, enabled ? "1" : "0", "EX", 60).catch(() => {});
            if (!enabled) {
              return next(new AppError(
                "PLAN_REQUIRED",
                `Módulo "${moduleKey}" deshabilitado para este tenant.`,
                403
              ));
            }
            return next(); // override explícito en true
          }
          // No hay override → caer al check de plan
        } catch {
          // Error en Redis/DB → fall through al check de plan
        }
      }

      // Check de plan puro
      if (!planHasModule(plan, moduleKey)) {
        const minPlan = PLAN_MODULE_CATALOG[moduleKey] ?? "pro";
        return next(new AppError(
          "PLAN_REQUIRED",
          `El módulo "${moduleKey}" requiere plan ${minPlan} o superior. Plan actual: ${plan}. Actualizá tu suscripción.`,
          403
        ));
      }

      next();
    } catch (e) {
      next(e);
    }
  };
}
