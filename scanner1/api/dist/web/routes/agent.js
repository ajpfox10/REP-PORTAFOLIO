// routes/agent.ts — Endpoints del agente: poll, heartbeat (con caps), fail
import { Router } from "express";
import { requireDeviceAuth } from "../auth.js";
import { requireTenant } from "../tenant.js";
import { pool } from "../../db/mysql.js";
import { ApiError } from "../errorHandler.js";
import { deliverWebhookToSubscribers } from "../../services/webhook.js";
import { asyncRoute } from "../asyncRoute.js";
const r = Router();
r.use(requireTenant(), requireDeviceAuth());
// ── GET /v1/agent/poll ────────────────────────────────────────────────────────
r.get("/poll", asyncRoute(async (req, res) => {
    const tenant_id = req.tenant_id;
    const device_id = req.device_id;
    const [rows] = await pool.query(`SELECT j.id, j.priority, j.profile_id, j.upload_nonce, j.personal_dni, j.personal_ref,
            j.source, j.duplex,
            COALESCE(j.dpi, p.dpi) AS dpi,
            COALESCE(j.color, p.color) AS color,
            COALESCE(j.auto_rotate, p.auto_rotate) AS auto_rotate,
            COALESCE(j.blank_page_detection, p.blank_page_detection) AS blank_page_detection,
            COALESCE(j.compression, p.compression) AS compression,
            COALESCE(j.output_format, p.output_format) AS output_format
     FROM scan_jobs j
     LEFT JOIN scan_profiles p ON p.id=j.profile_id AND p.tenant_id=j.tenant_id
     WHERE j.tenant_id=? AND j.device_id=? AND j.status='queued'
     ORDER BY j.priority DESC, j.id ASC LIMIT 1`, [tenant_id, device_id]);
    const job = rows[0];
    if (!job)
        return res.json({ job_id: null });
    await pool.query("UPDATE scan_jobs SET status='in_progress', started_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [tenant_id, job.id]);
    await deliverWebhookToSubscribers(tenant_id, "scan.started", { scan_job_id: job.id, device_id });
    return res.json({
        job_id: job.id,
        upload_nonce: job.upload_nonce,
        personal_ref: job.personal_ref,
        personal_dni: job.personal_dni,
        source: job.source || "flatbed",
        duplex: !!job.duplex,
        profile: {
            dpi: job.dpi || 300,
            color: job.color == null ? true : !!job.color,
            auto_rotate: job.auto_rotate == null ? true : !!job.auto_rotate,
            blank_page_detection: job.blank_page_detection == null ? true : !!job.blank_page_detection,
            compression: job.compression || "medium",
            output_format: job.output_format || "pdf",
        },
    });
}));
// ── POST /v1/agent/heartbeat — también guarda capabilities ───────────────────
r.post("/heartbeat", asyncRoute(async (req, res) => {
    const device_id = req.device_id;
    const { capabilities } = req.body || {};
    const online = capabilities?.online !== false;
    if (capabilities && typeof capabilities === "object") {
        // Upsert en device_capabilities
        await pool.query(`INSERT INTO device_capabilities (device_id, capabilities_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE capabilities_json=VALUES(capabilities_json), updated_at=now()`, [device_id, JSON.stringify(capabilities)]).catch(() => { });
    }
    if (online) {
        await pool.query("UPDATE devices SET last_seen_at=now() WHERE id=?", [device_id]).catch(() => { });
    }
    res.json({ ok: true, server_ts: Date.now() });
}));
// ── POST /v1/agent/fail ───────────────────────────────────────────────────────
r.post("/fail", asyncRoute(async (req, res) => {
    const tenant_id = req.tenant_id;
    const { job_id, error_message } = req.body || {};
    if (!job_id)
        throw new ApiError(400, "missing_job_id");
    await pool.query("UPDATE scan_jobs SET status='failed', error_message=?, completed_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [error_message || "agent_error", tenant_id, job_id]);
    await deliverWebhookToSubscribers(tenant_id, "scan.failed", { scan_job_id: job_id, error: error_message });
    res.json({ ok: true });
}));
export default r;
