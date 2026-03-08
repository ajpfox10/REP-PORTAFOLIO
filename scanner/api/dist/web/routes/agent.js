// routes/agent.ts — Endpoints del agente: poll, heartbeat (con caps), fail
import { Router } from "express";
import { requireDeviceAuth } from "../auth.js";
import { requireTenant } from "../tenant.js";
import { pool } from "../../db/mysql.js";
import { ApiError } from "../errorHandler.js";
import { deliverWebhookToSubscribers } from "../../services/webhook.js";
const r = Router();
r.use(requireTenant(), requireDeviceAuth());
// ── GET /v1/agent/poll ────────────────────────────────────────────────────────
r.get("/poll", async (req, res) => {
    const tenant_id = req.tenant_id;
    const device_id = req.device_id;
    const [rows] = await pool.query(`SELECT j.id, j.priority, j.profile_id, j.upload_nonce, j.personal_dni, j.personal_ref,
            p.dpi, p.color, p.auto_rotate, p.blank_page_detection, p.compression, p.output_format
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
        profile: job.dpi ? {
            dpi: job.dpi,
            color: !!job.color,
            auto_rotate: !!job.auto_rotate,
            blank_page_detection: !!job.blank_page_detection,
            compression: job.compression,
            output_format: job.output_format,
        } : null,
    });
});
// ── POST /v1/agent/heartbeat — también guarda capabilities ───────────────────
r.post("/heartbeat", async (req, res) => {
    const device_id = req.device_id;
    const { capabilities } = req.body || {};
    if (capabilities && typeof capabilities === "object") {
        // Upsert en device_capabilities
        await pool.query(`INSERT INTO device_capabilities (device_id, capabilities_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE capabilities_json=VALUES(capabilities_json), updated_at=now()`, [device_id, JSON.stringify(capabilities)]).catch(() => { });
    }
    res.json({ ok: true, server_ts: Date.now() });
});
// ── POST /v1/agent/fail ───────────────────────────────────────────────────────
r.post("/fail", async (req, res) => {
    const tenant_id = req.tenant_id;
    const { job_id, error_message } = req.body || {};
    if (!job_id)
        throw new ApiError(400, "missing_job_id");
    await pool.query("UPDATE scan_jobs SET status='failed', error_message=?, completed_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [error_message || "agent_error", tenant_id, job_id]);
    await deliverWebhookToSubscribers(tenant_id, "scan.failed", { scan_job_id: job_id, error: error_message });
    res.json({ ok: true });
});
export default r;
