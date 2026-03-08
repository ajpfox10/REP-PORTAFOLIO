import { Router } from "express";
import type Redis from "ioredis";
import Stripe from "stripe";
import { type AppConfig } from "../config/types.js";
import { AppError } from "../core/errors/appError.js";
import { logger } from "../core/logging/logger.js";

export function billingRouter(opts: { config: AppConfig; redis: Redis }) {
  const router = Router();
  const stripe = new Stripe(opts.config.stripeSecretKey || "sk_test_dummy");

  const PLANS = [
    { key: "basic", name: "Básico", priceMonthly: 9900, maxUsers: 3, maxSucursales: 1, features: ["CRUD", "Agenda", "Auditoría"] },
    { key: "pro", name: "Pro", priceMonthly: 24900, maxUsers: 15, maxSucursales: 5, features: ["Todo Basic", "Multi-sucursal", "Reportes", "API pública"] },
    { key: "enterprise", name: "Enterprise", priceMonthly: null, maxUsers: null, maxSucursales: null, features: ["Todo Pro", "SLA 99.9%", "Soporte dedicado", "SSO/SAML"] }
  ];

  router.get("/plans", (_req, res) => {
    res.json({ data: PLANS, meta: { requestId: null }, errors: [] });
  });

  router.post("/webhooks/stripe", async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = opts.config.stripeWebhookSecret;

    if (!webhookSecret) {
      logger.warn("STRIPE_WEBHOOK_SECRET not configured");
      return res.status(400).json({ error: "Webhook not configured" });
    }

    try {
      const event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);

      // Queue event for async processing via BullMQ
      const { Queue } = await import("bullmq");
      const q = new Queue("jobs", { connection: opts.config.redisUrl as any });
      await q.add("stripe-webhook", { type: event.type, data: event.data }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

      res.json({ received: true });
    } catch (e: any) {
      logger.error({ err: e }, "Stripe webhook signature validation failed");
      throw new AppError("BILLING_ERROR", "Invalid webhook signature");
    }
  });



  /**
   * POST /api/v1/billing/stripe/webhook
   * Requires Stripe signature verification + replay protection.
   */
  router.post("/stripe/webhook", async (req: any, res, next) => {
    try {
      const sig = req.header("stripe-signature");
      if (!sig) throw new AppError("BAD_REQUEST", "Missing stripe-signature header", 400);
      if (!opts.config.stripeWebhookSecret) throw new AppError("CONFIG", "STRIPE_WEBHOOK_SECRET not configured", 500);

      const raw = req.rawBodyBuf || Buffer.from(req.rawBody || "", "utf8");
      const event = stripe.webhooks.constructEvent(raw, sig, opts.config.stripeWebhookSecret);

      // replay protection by event id
      const replayKey = `stripe_evt:${event.id}`;
      const already = await opts.redis.get(replayKey);
      if (already) return res.json({ ok: true, replay: true });
      await opts.redis.setex(replayKey, 60 * 60 * 24, "1");

      logger.info({ type: event.type, id: event.id }, "stripe webhook");

      // enqueue job for async processing (worker)
      await opts.redis.lpush("stripe_webhooks", JSON.stringify({ id: event.id, type: event.type, data: event.data }));
      return res.json({ ok: true });
    } catch (e) { return next(e); }
  });

  return router;
}
