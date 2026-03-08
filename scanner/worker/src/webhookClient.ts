// worker/webhookClient.ts — webhook delivery desde el worker (sin axios circular)
import crypto from "crypto"
import type { Pool } from "mysql2/promise"
import type { EventName } from "./shared/index.js"
import { request as httpsRequest } from "https"
import { request as httpRequest }  from "http"

function sign(secret: string, body: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`
}

function post(url: string, body: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const u = new URL(url)
    const fn = u.protocol === "https:" ? httpsRequest : httpRequest
    const req = fn({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers }, (res) => {
      res.resume()
      res.on("end", () => resolve(res.statusCode || 0))
    })
    req.on("error", () => resolve(0))
    req.setTimeout(6000, () => { req.destroy(); resolve(0) })
    req.write(body)
    req.end()
  })
}

export async function deliverWebhookToSubscribersFromWorker(
  pool: Pool, tenant_id: number, event: EventName, payload: any
) {
  try {
    const [rows] = await pool.query(
      "SELECT id, url, secret FROM webhooks WHERE tenant_id=? AND is_active=1 AND JSON_CONTAINS(events_json, JSON_QUOTE(?))",
      [tenant_id, event]
    )
    const hooks = rows as any[]
    const body = JSON.stringify({ event, payload, ts: Date.now() })

    for (const h of hooks) {
      const status = await post(h.url, body, {
        "content-type": "application/json",
        "x-webhook-signature": sign(h.secret, body),
        "x-webhook-event": event,
      })
      await pool.query(
        `INSERT INTO webhook_deliveries (webhook_id,tenant_id,event,payload_json,status_code,success,created_at)
         VALUES (?,?,?,?,?,?,now())`,
        [h.id, tenant_id, event, body, status || null, status >= 200 && status < 300 ? 1 : 0]
      ).catch(() => {})
    }
  } catch (e: any) {
    console.warn("[webhook-worker] delivery failed", e?.message)
  }
}
