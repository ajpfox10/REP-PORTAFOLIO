import { Worker, Queue } from "bullmq";
import { loadConfig } from "../config/loadConfig.js";
import { buildRedis } from "../infra/redis/redisClient.js";
import { buildMasterPool, buildTenantPoolFactory } from "../db/pools.js";
import { buildKmsEnvelope } from "../security/encryption/kmsEnvelope.js";
import { logger } from "../core/logging/logger.js";
import { buildEmailProvider } from "../infra/notifications/emailProvider.js";
import { buildSmsProvider } from "../infra/notifications/smsProvider.js";

const config = loadConfig();
const redis = buildRedis(config);
const masterPool = buildMasterPool(config);
const tenantPoolFactory = buildTenantPoolFactory(config);
const emailProvider = buildEmailProvider(config);
const smsProvider = buildSmsProvider(config);

const kms = buildKmsEnvelope({
  kmsKeyId: config.kmsKeyId || undefined,
  masterSecret: config.encryptionMasterSecret || undefined,
  redis,
  masterPool,
});

// ── Job handlers ─────────────────────────────────────────────────────────────

type JobResult = { ok: boolean; [k: string]: unknown };

async function handleStripeWebhook(data: any): Promise<JobResult> {
  const { type, data: evData } = data;
  logger.info({ type }, "processing stripe webhook");

  switch (type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = evData.object;
      const tenantId = sub.metadata?.tenant_id;
      if (!tenantId) { logger.warn({ sub }, "stripe subscription missing tenant_id metadata"); return { ok: false }; }
      const plan = sub.metadata?.plan ?? "basic";
      await masterPool.query("UPDATE tenants SET plan=? WHERE tenant_id=?", [plan, tenantId]);
      logger.info({ tenantId, plan }, "tenant plan updated from stripe");
      return { ok: true, tenantId, plan };
    }
    case "customer.subscription.deleted": {
      const sub = evData.object;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) {
        await masterPool.query("UPDATE tenants SET plan='basic', status='active' WHERE tenant_id=?", [tenantId]);
        logger.info({ tenantId }, "tenant subscription cancelled → downgraded to basic");
      }
      return { ok: true };
    }
    case "invoice.payment_failed": {
      const tenantId = evData.object?.subscription_details?.metadata?.tenant_id;
      if (tenantId) {
        logger.warn({ tenantId }, "invoice payment failed");
        // After N failures the billing router suspends the tenant
      }
      return { ok: true };
    }
    default:
      logger.debug({ type }, "unhandled stripe event type");
      return { ok: true, skipped: true };
  }
}

async function handleSendEmail(data: any): Promise<JobResult> {
  const { to, subject, body, bodyHtml, tenantId } = data;
  logger.info({ to, subject, tenantId }, "sending email");
  try {
    await emailProvider.send({ to, subject, bodyText: body ?? "", bodyHtml });
    return { ok: true };
  } catch (e: any) {
    logger.error({ err: e, to, tenantId }, "email send failed");
    throw e; // rethrow so BullMQ retries
  }
}

async function handleSendSms(data: any): Promise<JobResult> {
  const { to, message, tenantId } = data;
  logger.info({ to, tenantId }, "sending sms");
  try {
    await smsProvider.send({ to, message });
    return { ok: true };
  } catch (e: any) {
    logger.error({ err: e, to, tenantId }, "sms send failed");
    throw e;
  }
}

async function handleVacunaReminder(data: any): Promise<JobResult> {
  const { tenantId, pacienteId, vacunaId, ownerEmail, dbName } = data;
  if (!dbName) { logger.warn({ tenantId, vacunaId }, "vacuna-reminder missing dbName"); return { ok: false, reason: "missing dbName" }; }
  logger.info({ tenantId, pacienteId, vacunaId }, "vacuna reminder");

  const pool = tenantPoolFactory(dbName);
  const [rows] = await pool.query<any[]>(
    "SELECT p.nombre as paciente, v.nombre as vacuna, v.proxima_dosis FROM vacunas v JOIN pacientes p ON p.id=v.paciente_id WHERE v.id=?",
    [vacunaId]
  );
  if (!rows?.length) return { ok: false, reason: "vacuna not found" };

  const emailQ = new Queue("jobs", { connection: redis });
  await emailQ.add("send-email", {
    to: ownerEmail,
    subject: `Recordatorio de vacuna para ${rows[0].paciente}`,
    body: `La vacuna ${rows[0].vacuna} está programada para el ${rows[0].proxima_dosis}. Por favor contacte a la clínica para confirmar su turno.`,
    tenantId,
    dbName,
  }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });

  // Mark reminder as sent
  await pool.query("UPDATE vacunas SET recordatorio_env=1 WHERE id=?", [vacunaId]);

  return { ok: true };
}

async function handleTurnoReminder(data: any): Promise<JobResult> {
  const { tenantId, turnoId, ownerEmail, dbName } = data;
  if (!dbName) { logger.warn({ tenantId, turnoId }, "turno-reminder missing dbName"); return { ok: false, reason: "missing dbName" }; }
  const pool = tenantPoolFactory(dbName);
  const [rows] = await pool.query<any[]>(
    `SELECT t.fecha_hora, t.motivo, p.nombre as paciente, v.nombre as vet_nombre, v.apellido as vet_apellido
     FROM turnos t
     LEFT JOIN pacientes p ON p.id = t.paciente_id
     LEFT JOIN veterinarios v ON v.id = t.veterinario_id
     WHERE t.id=? LIMIT 1`,
    [turnoId]
  );
  if (!rows?.length) return { ok: false, reason: "turno not found" };

  const row = rows[0];
  const emailQ = new Queue("jobs", { connection: redis });
  await emailQ.add("send-email", {
    to: ownerEmail,
    subject: `Recordatorio: turno mañana para ${row.paciente}`,
    body: `Le recordamos que tiene un turno mañana para ${row.paciente} el ${row.fecha_hora} con Dr. ${row.vet_nombre} ${row.vet_apellido}. Motivo: ${row.motivo || "consulta general"}.`,
    tenantId,
    dbName,
  }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });

  await pool.query("UPDATE turnos SET recordatorio_env=1 WHERE id=?", [turnoId]);

  return { ok: true };
}

async function handleDekRotation(data: any): Promise<JobResult> {
  const { tenantId, dbName } = data;
  if (!tenantId || !dbName) return { ok: false, reason: "missing tenantId or dbName" };
  logger.info({ tenantId }, "starting DEK rotation");

  const newVersion = await kms.rotateDek(tenantId);
  logger.info({ tenantId, newVersion }, "DEK generated");

  const pool = tenantPoolFactory(dbName);
  const [users] = await pool.query<any[]>(
    "SELECT id, totp_secret_enc FROM users WHERE tenant_id=? AND totp_secret_enc IS NOT NULL",
    [tenantId]
  );

  let reEncrypted = 0;
  let failed = 0;
  for (const u of users) {
    try {
      const newBlob = await kms.reEncryptBlob(tenantId, String(u.totp_secret_enc), newVersion);
      await pool.query("UPDATE users SET totp_secret_enc=? WHERE id=?", [newBlob, u.id]);
      reEncrypted++;
    } catch (e) {
      logger.error({ err: e, userId: u.id }, "failed to re-encrypt user TOTP secret");
      failed++;
    }
  }

  logger.info({ tenantId, newVersion, reEncrypted, failed }, "DEK rotation complete");
  return { ok: true, newVersion, reEncrypted, failed };
}

async function handleAuditExport(data: any): Promise<JobResult> {
  const { tenantId, dbName, scope, userId, format = "jsonl", callbackUrl } = data;
  if (!dbName) return { ok: false, reason: "missing dbName" };
  logger.info({ tenantId, scope, format }, "audit export starting");

  const pool = tenantPoolFactory(dbName);
  const conditions = ["tenant_id=?"];
  const params: any[] = [tenantId];
  if (scope === "user" && userId) { conditions.push("actor_user_id=?"); params.push(userId); }

  const [rows] = await pool.query<any[]>(
    `SELECT id, ts, actor_user_id, action, resource, resource_id, ip, request_id, before_json, after_json
     FROM auditoria_log WHERE ${conditions.join(" AND ")}
     ORDER BY ts ASC`,
    params
  );

  // Build JSONL
  const lines = rows.map(r => JSON.stringify(r)).join("\n");
  const fileName = `audit-${tenantId}-${Date.now()}.jsonl`;

  // Try S3 upload if configured
  const s3Bucket = process.env.AWS_S3_BUCKET;
  if (s3Bucket) {
    try {
      const { S3Client, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
      const key = `exports/${tenantId}/${fileName}`;
      await s3.send(new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: lines,
        ContentType: "application/x-ndjson",
      }));
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: s3Bucket, Key: key }), { expiresIn: 3600 });
      logger.info({ tenantId, key, rows: rows.length }, "audit export uploaded to S3");
      return { ok: true, rows: rows.length, downloadUrl: url, expiresIn: 3600 };
    } catch (e: any) {
      logger.error({ err: e, tenantId }, "S3 upload failed, falling back to DB storage");
    }
  }

  // Fallback: store in outbox_events as base64 (small exports only)
  if (lines.length < 500_000) {
    const b64 = Buffer.from(lines).toString("base64");
    await pool.query(
      `INSERT INTO outbox_events (tenant_id, event_type, payload_json, status)
       VALUES (?, 'audit-export-ready', ?, 'done')`,
      [tenantId, JSON.stringify({ fileName, data: b64, rows: rows.length })]
    );
    return { ok: true, rows: rows.length, storedInOutbox: true };
  }

  return { ok: false, reason: "Export too large and S3 not configured" };
}

async function handleAuditVerifyChain(data: any): Promise<JobResult> {
  const { tenantId, dbName } = data;
  if (!dbName) return { ok: false, reason: "missing dbName" };
  const pool = tenantPoolFactory(dbName);
  const [rows] = await pool.query<any[]>(
    "SELECT id, seq, prev_hash, hash FROM auditoria_log WHERE tenant_id=? ORDER BY seq ASC",
    [tenantId]
  );

  let broken = 0;
  const crypto = await import("node:crypto");
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i].prev_hash) !== String(rows[i - 1].hash)) {
      logger.error({ tenantId, seq: rows[i].seq, prevSeq: rows[i - 1].seq }, "audit chain broken");
      broken++;
    }
  }

  logger.info({ tenantId, total: rows.length, broken }, "audit chain verification complete");
  return { ok: broken === 0, total: rows.length, broken };
}

async function handleComplianceExport(data: any): Promise<JobResult> {
  const { tenantId, dbName, scope, userId } = data;
  if (!dbName) return { ok: false, reason: "missing dbName" };
  logger.info({ tenantId, scope, userId }, "compliance export");

  const pool = tenantPoolFactory(dbName);
  const export_data: Record<string, any> = { tenantId, exportedAt: new Date().toISOString(), scope };

  if (scope === "user" && userId) {
    // GDPR: exportar todos los datos de un propietario
    const [[propietario]] = await pool.query<any[]>(
      "SELECT id, nombre, apellido, email, telefono, created_at FROM propietarios WHERE id=? LIMIT 1",
      [userId]
    );
    export_data.propietario = propietario;

    const [mascotas] = await pool.query<any[]>(
      "SELECT id, nombre, especie, raza, fecha_nacimiento FROM pacientes WHERE propietario_id=? AND is_active=1",
      [userId]
    );
    export_data.mascotas = mascotas;

    const [turnos] = await pool.query<any[]>(
      "SELECT id, fecha_hora, motivo, estado FROM turnos WHERE propietario_id=? ORDER BY fecha_hora DESC LIMIT 200",
      [userId]
    );
    export_data.turnos = turnos;

    const [vacunas] = await pool.query<any[]>(
      `SELECT v.nombre, v.fecha_aplicacion, v.proxima_dosis
       FROM vacunas v JOIN pacientes p ON p.id=v.paciente_id
       WHERE p.propietario_id=? ORDER BY v.fecha_aplicacion DESC`,
      [userId]
    );
    export_data.vacunas = vacunas;
  }

  const jsonData = JSON.stringify(export_data, null, 2);
  const fileName = `gdpr-export-${tenantId}-${userId ?? "all"}-${Date.now()}.json`;

  const s3Bucket = process.env.AWS_S3_BUCKET;
  if (s3Bucket) {
    try {
      const { S3Client, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
      const key = `exports/${tenantId}/gdpr/${fileName}`;
      await s3.send(new PutObjectCommand({ Bucket: s3Bucket, Key: key, Body: jsonData, ContentType: "application/json" }));
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: s3Bucket, Key: key }), { expiresIn: 86400 });
      return { ok: true, downloadUrl: url, expiresIn: 86400 };
    } catch (e: any) {
      logger.error({ err: e }, "S3 compliance export failed");
    }
  }

  // Fallback inline
  return { ok: true, data: export_data };
}

async function handleComplianceDelete(data: any): Promise<JobResult> {
  const { tenantId, dbName, scope, userId } = data;
  logger.info({ tenantId, scope, userId }, "compliance delete job");
  if (!dbName) return { ok: false, reason: "missing dbName" };

  if (scope === "user" && userId) {
    const pool = tenantPoolFactory(dbName);
    // Anonymize PII (GDPR right to erasure) rather than hard delete
    await pool.query(
      "UPDATE users SET email=CONCAT('deleted-', id, '@deleted.invalid'), password_hash='[deleted]', totp_secret_enc=NULL, mfa_enabled=0 WHERE id=? AND tenant_id=?",
      [userId, tenantId]
    );
    logger.info({ tenantId, userId }, "user data anonymized for GDPR");
  }
  return { ok: true };
}

async function handleOutboxDispatch(data: any): Promise<JobResult> {
  const { tenantId, dbName } = data;
  if (!dbName) return { ok: false, reason: "missing dbName" };
  const pool = tenantPoolFactory(dbName);
  const [events] = await pool.query<any[]>(
    "SELECT * FROM outbox_events WHERE status='pending' AND (next_run_at IS NULL OR next_run_at <= NOW()) ORDER BY created_at ASC LIMIT 50"
  );

  for (const ev of events) {
    try {
      await pool.query("UPDATE outbox_events SET status='processing', attempts=attempts+1 WHERE id=?", [ev.id]);
      const payload = JSON.parse(ev.payload_json ?? "{}");
      const emailQ = new Queue("jobs", { connection: redis });
      await emailQ.add(ev.event_type, { ...payload, tenantId, dbName });
      await pool.query("UPDATE outbox_events SET status='done', updated_at=NOW() WHERE id=?", [ev.id]);
    } catch (e) {
      logger.error({ err: e, eventId: ev.id }, "outbox dispatch failed");
      await pool.query(
        "UPDATE outbox_events SET status='pending', next_run_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), updated_at=NOW() WHERE id=?",
        [ev.id]
      );
    }
  }

  return { ok: true, dispatched: events.length };
}


async function handleWhatsAppSend(data: any): Promise<JobResult> {
  const { to, templateName, params, phoneId, token, tenantId } = data;
  if (!phoneId || !token) {
    logger.warn({ tenantId }, "whatsapp-send missing phoneId/token");
    return { ok: false, reason: "missing credentials" };
  }
  const phone = String(to ?? "").replace(/\D/g, "");
  if (!phone) return { ok: false, reason: "invalid phone" };

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  let lastErr: any;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: templateName,
          language: { code: "es_AR" },
          components: [{
            type: "body",
            parameters: (params ?? []).map((p: string) => ({ type: "text", text: p })),
          }],
        },
      }),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? attempt * 2);
      logger.warn({ attempt, retryAfter, phone }, "WhatsApp rate limited");
      if (attempt < 4) { await new Promise(r => setTimeout(r, retryAfter * 1000)); continue; }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      lastErr = new Error(`WhatsApp API ${res.status}: ${body}`);
      logger.error({ attempt, status: res.status, phone }, "WhatsApp send failed");
      if (attempt < 4) { await new Promise(r => setTimeout(r, attempt * 3000)); continue; }
      throw lastErr;
    }

    const respData = await res.json() as any;
    logger.info({ messageId: respData?.messages?.[0]?.id, phone, templateName }, "WhatsApp sent");
    return { ok: true, messageId: respData?.messages?.[0]?.id };
  }

  throw lastErr ?? new Error("WhatsApp: max retries exceeded");
}

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker("jobs", async (job) => {
  logger.info({ jobName: job.name, jobId: job.id }, "processing job");
  switch (job.name) {
    case "stripe-webhook":       return handleStripeWebhook(job.data);
    case "send-email":           return handleSendEmail(job.data);
    case "send-sms":             return handleSendSms(job.data);
    case "vacuna-reminder":      return handleVacunaReminder(job.data);
    case "turno-reminder":       return handleTurnoReminder(job.data);
    case "dek-rotation":         return handleDekRotation(job.data);
    case "audit-export":         return handleAuditExport(job.data);
    case "audit-verify-chain":   return handleAuditVerifyChain(job.data);
    case "compliance-export":    return handleComplianceExport(job.data);
    case "compliance-delete":    return handleComplianceDelete(job.data);
    case "outbox-dispatch":      return handleOutboxDispatch(job.data);
    case "whatsapp-send":         return handleWhatsAppSend(job.data);
    default:
      logger.warn({ jobName: job.name }, "unknown job type");
      return { ok: true, skipped: true };
  }
}, {
  connection: redis,
  concurrency: 4,
  settings: { backoffStrategy: (attemptsMade: number) => Math.min(attemptsMade * 2000, 30000) },
});

worker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, jobName: job.name, result }, "job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, jobName: job?.name, err }, "job failed");
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, closing worker gracefully");
  await worker.close();
  await redis.quit();
  process.exit(0);
});

logger.info("worker started");
