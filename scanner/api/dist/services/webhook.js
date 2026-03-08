// services/webhook.ts — Webhook delivery con reintentos, logging y firma HMAC
import crypto from "crypto";
import axios from "axios";
import { pool } from "../db/mysql.js";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 10000, 60000]; // backoff en ms
const TIMEOUT_MS = 8000;
function sign(secret, body) {
    return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}
async function deliverOnce(url, secret, body, event) {
    const sig = sign(secret, body);
    const t0 = Date.now();
    const res = await axios.post(url, body, {
        headers: {
            "content-type": "application/json",
            "x-webhook-signature": sig,
            "x-webhook-event": event,
            "x-scanner-version": "3.0",
        },
        timeout: TIMEOUT_MS,
        validateStatus: () => true, // no throw on 4xx/5xx
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 300, duration_ms: Date.now() - t0 };
}
export async function deliverWebhookToSubscribers(tenant_id, event, payload) {
    const [rows] = await pool.query("SELECT id, url, secret FROM webhooks WHERE tenant_id=? AND is_active=1 AND JSON_CONTAINS(events_json, JSON_QUOTE(?))", [tenant_id, event]);
    const hooks = rows;
    if (!hooks.length)
        return;
    const body = JSON.stringify({ event, payload, ts: Date.now() });
    await Promise.allSettled(hooks.map(h => deliverWithRetry(h, body, event, tenant_id)));
}
async function deliverWithRetry(hook, body, event, tenant_id) {
    let lastResult = { status: 0, ok: false, duration_ms: 0 };
    let lastError = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0)
            await sleep(RETRY_DELAYS[attempt - 1] ?? 60000);
        try {
            lastResult = await deliverOnce(hook.url, hook.secret, body, event);
            if (lastResult.ok)
                break;
            lastError = `HTTP ${lastResult.status}`;
        }
        catch (e) {
            lastError = e?.message || "network_error";
        }
    }
    const success = lastResult.ok ? 1 : 0;
    // Log delivery
    await pool.query(`INSERT INTO webhook_deliveries (webhook_id,tenant_id,event,payload_json,status_code,success,error_msg,duration_ms,created_at)
     VALUES (?,?,?,?,?,?,?,?,now())`, [hook.id, tenant_id, event, body, lastResult.status || null, success, lastError || null, lastResult.duration_ms]).catch(() => { });
    // Update webhook stats
    await pool.query(`UPDATE webhooks SET
       last_delivery_at=now(),
       last_delivery_status=?,
       fail_count=IF(?,0,fail_count+1),
       is_active=IF(fail_count+1>=10 AND ?=0, 0, is_active)
     WHERE id=?`, [lastResult.status || null, success, success, hook.id]).catch(() => { });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
