// src/webhooks/queue.ts
import { Sequelize } from 'sequelize';
import { WebhookEvent, WebhookPayload } from './types';
import { logger } from '../logging/logger';
import { randomUUID } from 'crypto';

// ✅ Función para evaluar filtros (importada)
function evaluateFilters(payload: any, filters: any[]): boolean {
  if (!filters || filters.length === 0) return true;
  const data = payload.data || payload;

  for (const f of filters) {
    const fieldValue = data[f.field];
    
    switch (f.operator) {
      case 'eq': if (fieldValue != f.value) return false; break;
      case 'neq': if (fieldValue == f.value) return false; break;
      case 'gt': if (!(fieldValue > f.value)) return false; break;
      case 'gte': if (!(fieldValue >= f.value)) return false; break;
      case 'lt': if (!(fieldValue < f.value)) return false; break;
      case 'lte': if (!(fieldValue <= f.value)) return false; break;
      case 'contains': 
        if (!String(fieldValue).includes(String(f.value))) return false; 
        break;
      case 'startsWith':
        if (!String(fieldValue).startsWith(String(f.value))) return false;
        break;
      case 'endsWith':
        if (!String(fieldValue).endsWith(String(f.value))) return false;
        break;
      default: return false;
    }
  }
  
  return true;
}

export async function enqueueWebhook(
  sequelize: Sequelize,
  evento: WebhookEvent,
  data: any,
  actor?: { id?: number; type?: string }
): Promise<void> {
  try {
    // Buscar webhooks activos suscritos a este evento
    const [webhooks] = await sequelize.query(
      `SELECT id, url, secret, timeout_ms, retry_policy, filters
       FROM webhooks
       WHERE estado = 'activo'
         AND deleted_at IS NULL
         AND JSON_CONTAINS(eventos, :evento)`,
      {
        replacements: { evento: JSON.stringify(evento) }
      }
    );

    if (!(webhooks as any[]).length) {
      return; // Nadie escucha este evento
    }

    const payload: WebhookPayload = {
      id: randomUUID(),
      event: evento,
      created_at: new Date().toISOString(),
      data,
      actor: actor?.id ? { id: actor.id, type: actor.type || 'user' } : undefined
    };

    const now = new Date();

    // Encolar para cada webhook
    for (const webhook of (webhooks as any[])) {
      // ✅ APLICAR FILTROS ANTES DE ENCOLAR
      let filters: any[] = [];
      if (webhook.filters) {
        try {
          filters = typeof webhook.filters === 'string' 
            ? JSON.parse(webhook.filters) 
            : webhook.filters;
        } catch {
          filters = [];
        }
      }

      if (!evaluateFilters(payload, filters)) {
        logger.debug({ 
          msg: 'Webhook filtered out', 
          webhookId: webhook.id, 
          evento,
          filters 
        });
        continue; // No cumple los filtros, no se encola
      }

      const retryPolicy = typeof webhook.retry_policy === 'string' 
        ? JSON.parse(webhook.retry_policy) 
        : webhook.retry_policy;

      const proximoIntento = new Date(now.getTime() + (retryPolicy.backoff_ms || 1000));

      await sequelize.query(
        `INSERT INTO webhook_queue 
         (webhook_id, evento, payload, intento, proximo_intento, estado, created_at)
         VALUES 
         (:webhookId, :evento, :payload, 0, :proximoIntento, 'pendiente', :now)`,
        {
          replacements: {
            webhookId: webhook.id,
            evento,
            payload: JSON.stringify(payload),
            proximoIntento,
            now
          }
        }
      );

      logger.debug({ 
        msg: 'Webhook enqueued', 
        webhookId: webhook.id, 
        evento,
        filters: filters.length > 0 
      });
    }
  } catch (err) {
    logger.error({ msg: 'Failed to enqueue webhook', evento, err });
  }
}