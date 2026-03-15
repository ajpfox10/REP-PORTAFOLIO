// src/webhooks/dispatcher.ts
import axios, { AxiosError } from 'axios';
import { Sequelize } from 'sequelize';
import { generateWebhookHeaders } from './signature';
import { logger } from '../logging/logger';

const MAX_CONCURRENT = 5;
let activeWorkers = 0;

export async function processQueue(sequelize: Sequelize): Promise<void> {
  if (activeWorkers >= MAX_CONCURRENT) {
    return;
  }

  activeWorkers++;

  try {
    const now = new Date();

    // Tomar próximos jobs pendientes
    const [jobs] = await sequelize.query(
      `SELECT q.id, q.webhook_id, q.evento, q.payload, q.intento,
              w.url, w.secret, w.timeout_ms, w.retry_policy
       FROM webhook_queue q
       JOIN webhooks w ON w.id = q.webhook_id
       WHERE q.estado = 'pendiente'
         AND q.proximo_intento <= :now
       ORDER BY q.proximo_intento ASC
       LIMIT 10`,
      { replacements: { now } }
    );

    for (const job of (jobs as any[])) {
      await dispatchJob(sequelize, job);
    }
  } catch (err) {
    logger.error({ msg: 'Error processing webhook queue', err });
  } finally {
    activeWorkers--;
  }
}

async function dispatchJob(sequelize: Sequelize, job: any): Promise<void> {
  const startTime = Date.now();
  const retryPolicy = typeof job.retry_policy === 'string'
    ? JSON.parse(job.retry_policy)
    : job.retry_policy;

  // Marcar como procesando
  await sequelize.query(
    `UPDATE webhook_queue 
     SET estado = 'procesando', updated_at = NOW()
     WHERE id = :id`,
    { replacements: { id: job.id } }
  );

  try {
    const payload = typeof job.payload === 'string'
      ? JSON.parse(job.payload)
      : job.payload;

    const headers = generateWebhookHeaders(
      payload,
      job.secret,
      job.evento,
      job.webhook_id
    );

    const response = await axios.post(job.url, payload, {
      headers,
      timeout: job.timeout_ms || 5000,
      validateStatus: () => true // No tirar error por status code
    });

    const duration = Date.now() - startTime;

    // Guardar delivery
    await sequelize.query(
      `INSERT INTO webhook_deliveries
       (webhook_id, evento, payload, request_headers, response_status, response_body, duration_ms, created_at)
       VALUES
       (:webhookId, :evento, :payload, :headers, :status, :body, :duration, NOW())`,
      {
        replacements: {
          webhookId: job.webhook_id,
          evento: job.evento,
          payload: JSON.stringify(payload),
          headers: JSON.stringify(headers),
          status: response.status,
          body: response.data ? JSON.stringify(response.data).slice(0, 5000) : null,
          duration
        }
      }
    );

    // Actualizar webhook con última ejecución
    await sequelize.query(
      `UPDATE webhooks 
       SET ultima_ejecucion = NOW(), ultimo_status = :status
       WHERE id = :id`,
      { replacements: { id: job.webhook_id, status: response.status } }
    );

    // Si es exitoso (2xx), eliminar de cola
    if (response.status >= 200 && response.status < 300) {
      await sequelize.query(
        `DELETE FROM webhook_queue WHERE id = :id`,
        { replacements: { id: job.id } }
      );
      logger.info({ 
        msg: 'Webhook delivered', 
        webhookId: job.webhook_id, 
        evento: job.evento,
        status: response.status,
        duration 
      });
    } else {
      // Reintentar o fallar
      await handleFailure(sequelize, job, retryPolicy, 
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

  } catch (err) {
    const error = err as AxiosError | Error;
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';

    // Guardar delivery fallido
    await sequelize.query(
      `INSERT INTO webhook_deliveries
       (webhook_id, evento, payload, error, duration_ms, created_at)
       VALUES
       (:webhookId, :evento, :payload, :error, :duration, NOW())`,
      {
        replacements: {
          webhookId: job.webhook_id,
          evento: job.evento,
          payload: job.payload,
          error: errorMessage.slice(0, 1000),
          duration
        }
      }
    );

    await handleFailure(sequelize, job, retryPolicy, errorMessage);
  }
}

async function handleFailure(
  sequelize: Sequelize,
  job: any,
  retryPolicy: any,
  error: string
): Promise<void> {
  const maxAttempts = retryPolicy.max_attempts || 3;
  const backoffMs = retryPolicy.backoff_ms || 1000;
  const newAttempt = (job.intento || 0) + 1;

  if (newAttempt >= maxAttempts) {
    // Máximo de reintentos alcanzado, marcar como fallido
    await sequelize.query(
      `UPDATE webhook_queue 
       SET estado = 'fallido', updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id: job.id } }
    );
    
    logger.error({ 
      msg: 'Webhook failed permanently', 
      webhookId: job.webhook_id, 
      evento: job.evento,
      attempts: newAttempt,
      error
    });
  } else {
    // Reintentar con backoff exponencial
    const nextAttempt = new Date(Date.now() + (backoffMs * Math.pow(2, newAttempt - 1)));
    
    await sequelize.query(
      `UPDATE webhook_queue 
       SET estado = 'pendiente', 
           intento = :intento,
           proximo_intento = :nextAttempt,
           updated_at = NOW()
       WHERE id = :id`,
      {
        replacements: {
          id: job.id,
          intento: newAttempt,
          nextAttempt
        }
      }
    );
    
    logger.warn({ 
      msg: 'Webhook will retry', 
      webhookId: job.webhook_id, 
      evento: job.evento,
      attempt: newAttempt,
      nextAttempt,
      error
    });
  }
}