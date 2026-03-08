// routes/auth.ts — Login, refresh y gestión de tokens
import { Router } from "express"
import bcrypt from "bcryptjs"
import { pool } from "../../db/mysql.js"
import { signToken } from "../auth.js"
import { ApiError } from "../errorHandler.js"

const r = Router()

// ── POST /v1/auth/login ───────────────────────────────────────────────────────
r.post("/login", async (req, res) => {
  const { email, password, tenant_id } = req.body || {}
  if (!email || !password || !tenant_id) throw new ApiError(400, "missing_fields")

  const [rows] = await pool.query(
    "SELECT id, password_hash, role, token_version, is_active FROM users WHERE tenant_id=? AND email=?",
    [Number(tenant_id), String(email).toLowerCase().trim()]
  )
  const user = (rows as any[])[0]
  if (!user || !user.is_active) throw new ApiError(401, "invalid_credentials")

  const ok = await bcrypt.compare(String(password), user.password_hash)
  if (!ok) throw new ApiError(401, "invalid_credentials")

  const token = signToken({
    user_id:       user.id,
    tenant_id:     Number(tenant_id),
    role:          user.role,
    token_version: user.token_version,
  })

  res.json({ access_token: token, role: user.role, tenant_id: Number(tenant_id) })
})

// ── POST /v1/auth/logout — invalida todos los tokens del usuario ──────────────
r.post("/logout", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const auth = (req as any).auth
  if (auth?.user_id) {
    await pool.query(
      "UPDATE users SET token_version=token_version+1 WHERE tenant_id=? AND id=?",
      [tenant_id, auth.user_id]
    )
  }
  res.json({ ok: true })
})

// ── POST /v1/auth/change-password ─────────────────────────────────────────────
r.post("/change-password", async (req, res) => {
  const auth = (req as any).auth
  if (!auth) throw new ApiError(401, "unauthenticated")
  const { old_password, new_password } = req.body || {}
  if (!old_password || !new_password) throw new ApiError(400, "missing_fields")
  if (String(new_password).length < 8) throw new ApiError(400, "password_too_short")

  const [rows] = await pool.query(
    "SELECT id, password_hash FROM users WHERE tenant_id=? AND id=?",
    [auth.tenant_id, auth.user_id]
  )
  const user = (rows as any[])[0]
  if (!user) throw new ApiError(404, "user_not_found")

  const ok = await bcrypt.compare(String(old_password), user.password_hash)
  if (!ok) throw new ApiError(401, "wrong_password")

  const hash = await bcrypt.hash(String(new_password), 12)
  await pool.query(
    "UPDATE users SET password_hash=?, token_version=token_version+1, updated_at=now() WHERE id=?",
    [hash, user.id]
  )
  res.json({ ok: true })
})

export default r
