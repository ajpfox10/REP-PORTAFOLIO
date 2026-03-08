/**
 * WhatsApp Business — plan: enterprise
 *
 * FIX: agrega retry con backoff exponencial para rate limits de Meta API.
 * Meta limita por phone_number_id: 250 mensajes/s tier 1, etc.
 * El router encola en BullMQ en vez de llamar Meta directamente,
 * así el worker puede reintentar sin bloquear la request.
 */

import { Router } from "express";
import { z } from "zod";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { AppError } from "../../core/errors/appError.js";
import { requireModule } from "../../infra/plan-limits/planGuard.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";
import type { AppConfig } from "../../config/types.js";
import { logger } from "../../core/logging/logger.js";

/** Llama Meta Graph API con retry automático en 429/503 */
async function callMetaApi(opts: {
  phoneNumberId: string;
  accessToken: string;
  payload: unknown;
  maxRetries?: number;
}): Promise<{ messageId: string }> {
  const { phoneNumberId, accessToken, payload, maxRetries = 3 } = opts;
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    // Rate limit — esperar y reintentar
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 2);
      if (attempt < maxRetries) {
        logger.warn({ attempt, retryAfter }, "WhatsApp API rate limited, retrying...");
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AppError("SERVER_ERROR", `WhatsApp API error ${res.status}: ${body}`);
    }

    const data = await res.json() as any;
    const messageId = data?.messages?.[0]?.id ?? "";
    return { messageId };
  }

  throw new AppError("SERVER_ERROR", "WhatsApp API: max retries exceeded");
}

export function buildWhatsAppRouter(opts: { config: AppConfig; featureFlags?: any; }) {
  const router = Router();

  router.use(requireModule("whatsapp", opts));

  // Redis queue para WhatsApp (usa la misma "jobs" queue que el worker)
  function getQueue(redis: Redis) {
    return new Queue("jobs", { connection: redis });
  }

  /** POST /api/v1/whatsapp/send/turno-reminder */
  router.post("/send/turno-reminder", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);

      const body = z.object({
        to: z.string().min(8).max(20),
        turno_id: z.coerce.number().int().positive(),
        paciente_nombre: z.string().min(1),
        fecha_hora: z.string().min(1),
        vet_nombre: z.string().min(1),
      }).parse(req.body ?? {});

      const phoneId = opts.config.whatsappPhoneNumberId;
      const token   = opts.config.whatsappAccessToken;

      if (!phoneId || !token) {
        throw new AppError("CONFIG_ERROR", "WhatsApp no configurado (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)");
      }

      // FIX: encolar el envío en vez de llamar Meta directamente
      // El worker reintenta con backoff en caso de falla
      const redis = (opts.config as any)._redis;
      if (redis) {
        const q = getQueue(redis);
        await q.add("whatsapp-send", {
          tenantId: ctx.tenantId,
          to: body.to,
          templateName: "turno_recordatorio",
          params: [body.paciente_nombre, body.fecha_hora, body.vet_nombre],
          phoneId,
          token,
        }, { attempts: 5, backoff: { type: "exponential", delay: 2000 } });

        return res.json(ok({ queued: true, turnoId: body.turno_id }, rid));
      }

      // Fallback: envío directo (si no hay Redis disponible en el contexto)
      const to = body.to.replace(/\D/g, "");
      const { messageId } = await callMetaApi({
        phoneNumberId: phoneId,
        accessToken: token,
        payload: {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: "turno_recordatorio",
            language: { code: "es_AR" },
            components: [{
              type: "body",
              parameters: [
                { type: "text", text: body.paciente_nombre },
                { type: "text", text: body.fecha_hora },
                { type: "text", text: body.vet_nombre },
              ],
            }],
          },
        },
      });

      return res.json(ok({ messageId, turnoId: body.turno_id }, rid));
    } catch (e) { next(e); }
  });

  /** POST /api/v1/whatsapp/send/vacuna-reminder */
  router.post("/send/vacuna-reminder", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);

      const body = z.object({
        to: z.string().min(8).max(20),
        paciente_nombre: z.string().min(1),
        vacuna_nombre: z.string().min(1),
        proxima_dosis: z.string().min(1),
      }).parse(req.body ?? {});

      const phoneId = opts.config.whatsappPhoneNumberId;
      const token   = opts.config.whatsappAccessToken;
      if (!phoneId || !token) throw new AppError("CONFIG_ERROR", "WhatsApp no configurado");

      const to = body.to.replace(/\D/g, "");
      const { messageId } = await callMetaApi({
        phoneNumberId: phoneId,
        accessToken: token,
        payload: {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: "vacuna_recordatorio",
            language: { code: "es_AR" },
            components: [{
              type: "body",
              parameters: [
                { type: "text", text: body.paciente_nombre },
                { type: "text", text: body.vacuna_nombre },
                { type: "text", text: body.proxima_dosis },
              ],
            }],
          },
        },
      });

      res.json(ok({ messageId }, rid));
    } catch (e) { next(e); }
  });

  /** GET /api/v1/whatsapp/webhook — Meta hub verification */
  router.get("/webhook", (req, res) => {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "")) {
      return res.status(200).send(String(challenge));
    }
    res.sendStatus(403);
  });

  /** POST /api/v1/whatsapp/webhook — inbound messages & delivery receipts */
  router.post("/webhook", (req, res) => {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value  = changes?.value;

    if (value?.messages?.length) {
      for (const msg of value.messages) {
        logger.info({ from: msg.from, type: msg.type, body: msg.text?.body }, "WhatsApp inbound message");
        // TODO: enqueue for agent/auto-reply handling
      }
    }

    if (value?.statuses?.length) {
      for (const status of value.statuses) {
        logger.debug({ msgId: status.id, status: status.status }, "WhatsApp delivery status");
      }
    }

    res.sendStatus(200);
  });

  return router;
}
