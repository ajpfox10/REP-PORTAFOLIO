// routes/integration.ts — Configuración de integración con api_personal
import { Router } from "express"
import { pool } from "../../db/mysql.js"
import { requireRole } from "../auth.js"
import { ApiError } from "../errorHandler.js"
import axios from "axios"

const r = Router()

// Solo admins pueden configurar la integración
r.use(requireRole("admin"))

// ── GET /v1/integration ───────────────────────────────────────────────────────
r.get("/", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const [rows] = await pool.query(
    "SELECT id, base_url, is_enabled, created_at, updated_at FROM personal_integration WHERE tenant_id=?",
    [tenant_id]
  )
  const cfg = (rows as any[])[0] || null
  res.json(cfg)
})

// ── PUT /v1/integration — crear o actualizar ──────────────────────────────────
r.put("/", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const { base_url, api_key, is_enabled = true } = req.body || {}
  if (!base_url || !api_key) throw new ApiError(400, "missing_fields", "base_url and api_key required")

  await pool.query(
    `INSERT INTO personal_integration (tenant_id, base_url, api_key, is_enabled, created_at)
     VALUES (?,?,?,?,now())
     ON DUPLICATE KEY UPDATE base_url=VALUES(base_url), api_key=VALUES(api_key),
     is_enabled=VALUES(is_enabled), updated_at=now()`,
    [tenant_id, base_url, api_key, is_enabled ? 1 : 0]
  )
  res.json({ ok: true })
})

// ── POST /v1/integration/test — verificar conectividad ────────────────────────
r.post("/test", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const [rows] = await pool.query(
    "SELECT base_url, api_key FROM personal_integration WHERE tenant_id=?", [tenant_id]
  )
  const cfg = (rows as any[])[0]
  if (!cfg) throw new ApiError(404, "integration_not_configured")

  try {
    const r2 = await axios.get(`${cfg.base_url}/health`, {
      headers: { "x-api-key": cfg.api_key },
      timeout: 5000,
    })
    res.json({ ok: true, status: r2.status, data: r2.data })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message })
  }
})

export default r
