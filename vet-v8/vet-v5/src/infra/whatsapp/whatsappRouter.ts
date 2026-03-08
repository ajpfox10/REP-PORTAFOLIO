/**
 * WhatsApp Business API integration
 * Plan: enterprise+
 *
 * Uses Meta's Cloud API (v20+). Supports:
 *   - Appointment reminders (template messages)
 *   - Vaccine reminders
 *   - Inbound webhook (status callbacks)
 *
 * Configuration via env:
 *   WHATSAPP_PHONE_NUMBER_ID=<from Meta Business>
 *   WHATSAPP_ACCESS_TOKEN=<permanent token from Meta>
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN=<your custom string>
 */

import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { requireModule } from "../../infra/plan-limits/planGuard.js";
import { logger } from "../../core/logging/logger.js";
import type { AppConfig } from "../../config/types.js";

export type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
};

export function buildWhatsAppRouter(opts: { config: AppConfig; featureFlags?: any }) {
  const router = Router();

  const waConf: WhatsAppConfig = {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
  };

  /**
   * Send a WhatsApp template message.
   * Templates must be pre-approved in Meta Business Manager.
   */
  async function sendTemplate(to: string, templateName: string, components: any[]) {
    if (!waConf.phoneNumberId || !waConf.accessToken) {
      logger.warn("WhatsApp credentials not configured — skipping send");
      return { ok: false, reason: "not_configured" };
    }

    const url = `https://graph.facebook.com/v20.0/${waConf.phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""), // strip non-digits
      type: "template",
      template: {
        name: templateName,
        language: { code: "es_AR" },
        components,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${waConf.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      logger.error({ to, templateName, err }, "WhatsApp send failed");
      throw new Error(`WhatsApp API error: ${JSON.stringify(err)}`);
    }

    const data = await resp.json() as any;
    return { ok: true, messageId: data?.messages?.[0]?.id };
  }

  // Gate all routes to enterprise plan
  router.use(requireModule("whatsapp", opts));

  /**
   * POST /api/v1/whatsapp/send/turno-reminder
   * Body: { turno_id, phone }
   * Sends a pre-approved "turno_recordatorio" template.
   */
  router.post("/send/turno-reminder", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const { turno_id, phone } = z.object({
        turno_id: z.coerce.number().int().positive(),
        phone: z.string().min(8).max(20),
      }).parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.fecha_hora, t.motivo, p.nombre as paciente, v.nombre as vet_nombre, v.apellido as vet_apellido
         FROM turnos t
         LEFT JOIN pacientes p ON p.id=t.paciente_id
         LEFT JOIN veterinarios v ON v.id=t.veterinario_id
         WHERE t.id=? AND t.tenant_id=? LIMIT 1`,
        [turno_id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Turno no encontrado");

      const t = rows[0];
      const result = await sendTemplate(phone, "turno_recordatorio", [
        {
          type: "body",
          parameters: [
            { type: "text", text: t.paciente ?? "su mascota" },
            { type: "text", text: String(t.fecha_hora).slice(0, 16).replace("T", " ") },
            { type: "text", text: `Dr/a. ${t.vet_nombre} ${t.vet_apellido}` },
          ],
        },
      ]);

      res.json({ data: result, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/whatsapp/send/vacuna-reminder
   * Body: { vacuna_id, phone }
   */
  router.post("/send/vacuna-reminder", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const { vacuna_id, phone } = z.object({
        vacuna_id: z.coerce.number().int().positive(),
        phone: z.string().min(8).max(20),
      }).parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT v.nombre as vacuna, v.proxima_dosis, p.nombre as paciente
         FROM vacunas v JOIN pacientes p ON p.id=v.paciente_id
         WHERE v.id=? AND v.tenant_id=? LIMIT 1`,
        [vacuna_id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Vacuna no encontrada");

      const result = await sendTemplate(phone, "vacuna_recordatorio", [
        {
          type: "body",
          parameters: [
            { type: "text", text: rows[0].paciente },
            { type: "text", text: rows[0].vacuna },
            { type: "text", text: String(rows[0].proxima_dosis) },
          ],
        },
      ]);

      res.json({ data: result, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/whatsapp/webhook — Meta verification handshake
   */
  router.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === waConf.webhookVerifyToken) {
      logger.info("WhatsApp webhook verified");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  });

  /**
   * POST /api/v1/whatsapp/webhook — inbound messages & delivery receipts
   */
  router.post("/webhook", (req, res) => {
    const body = req.body;
    if (body?.object === "whatsapp_business_account") {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const val = change.value;
          if (val?.messages) {
            for (const msg of val.messages) {
              logger.info({ from: msg.from, type: msg.type, text: msg.text?.body }, "WhatsApp inbound");
              // Extend: route inbound messages to a queue for agent handling
            }
          }
          if (val?.statuses) {
            for (const s of val.statuses) {
              logger.debug({ id: s.id, status: s.status }, "WhatsApp delivery status");
            }
          }
        }
      }
      return res.sendStatus(200);
    }
    return res.sendStatus(404);
  });

  return router;
}
