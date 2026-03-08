import { Router } from "express";
import crypto from "crypto";
import { validate } from "../validate.js";
import { webhookCreateSchema, paginationSchema } from "../../shared/index.js";
import { pool } from "../../db/mysql.js";
import { ApiError } from "../errorHandler.js";
const r = Router();
r.get("/", validate(paginationSchema, "query"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const [rows] = await pool.query("SELECT id,url,events_json,is_active,last_delivery_at,last_delivery_status,fail_count,created_at FROM webhooks WHERE tenant_id=? ORDER BY id ASC", [tenant_id]);
    res.json({ items: rows });
});
r.post("/", validate(webhookCreateSchema, "body"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const b = req.body;
    const secret = b.secret || crypto.randomBytes(24).toString("hex");
    const [result] = await pool.query("INSERT INTO webhooks (tenant_id,url,events_json,secret,is_active,created_at) VALUES (?,?,?,?,?,now())", [tenant_id, b.url, JSON.stringify(b.events), secret, b.is_active ? 1 : 0]);
    res.status(201).json({ id: Number(result.insertId), secret });
});
r.patch("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const { is_active, url, events } = req.body || {};
    const [rows] = await pool.query("SELECT id FROM webhooks WHERE tenant_id=? AND id=?", [tenant_id, id]);
    if (!rows.length)
        throw new ApiError(404, "webhook_not_found");
    await pool.query("UPDATE webhooks SET url=COALESCE(?,url), events_json=COALESCE(?,events_json), is_active=COALESCE(?,is_active), fail_count=0, updated_at=now() WHERE tenant_id=? AND id=?", [url || null, events ? JSON.stringify(events) : null, is_active != null ? (is_active ? 1 : 0) : null, tenant_id, id]);
    res.json({ ok: true });
});
r.delete("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    await pool.query("DELETE FROM webhooks WHERE tenant_id=? AND id=?", [tenant_id, Number(req.params.id)]);
    res.json({ ok: true });
});
r.get("/:id/deliveries", async (req, res) => {
    const tenant_id = req.tenant_id;
    const [rows] = await pool.query("SELECT id,event,status_code,success,error_msg,duration_ms,created_at FROM webhook_deliveries WHERE tenant_id=? AND webhook_id=? ORDER BY id DESC LIMIT 50", [tenant_id, Number(req.params.id)]);
    res.json({ items: rows });
});
export default r;
