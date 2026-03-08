import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { pool } from "../db/mysql.js"
import { ApiError } from "./errorHandler.js"

export type JwtClaims = {
  sub?: string
  tenant_id?: number
  user_id?: number
  role?: string
  token_version?: number
  [key: string]: any
}

// Secretos a probar en orden: scanner propio, luego api_personal
function getSecrets(): string[] {
  return [
    process.env.JWT_SECRET        || "dev",
    process.env.PERSONAL_JWT_SECRET || "",
  ].filter(s => s.length > 0)
}

// ── JWT auth ──────────────────────────────────────────────────────────────────
export function requireAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const raw = (req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim()

      // Sin token → rechazar con mensaje claro
      if (!raw) throw new ApiError(401, "missing_token", "Enviá Authorization: Bearer <token>")

      // Probar cada secreto hasta que uno valide
      let claims: JwtClaims | null = null
      for (const secret of getSecrets()) {
        try {
          claims = jwt.verify(raw, secret) as JwtClaims
          break
        } catch { /* probar siguiente */ }
      }

      if (!claims) throw new ApiError(401, "invalid_token", "Token inválido o expirado")

      // Setear tenant desde el token si no vino en header
      ;(req as any).auth = claims
      if (!(req as any).tenant_id) {
        ;(req as any).tenant_id = claims.tenant_id || 1
      }

      next()
    } catch (e) { next(e) }
  }
}

// ── Device (agent) auth via device_key ───────────────────────────────────────
export function requireDeviceAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tenant_id = (req as any).tenant_id as number
      const deviceKey = req.header("x-device-key") || req.body?.device_key
      if (!deviceKey) throw new ApiError(401, "missing_device_key")

      const [rows] = await pool.query(
        "SELECT id FROM devices WHERE tenant_id=? AND device_key=? AND is_active=1",
        [tenant_id, deviceKey]
      )
      const device = (rows as any[])[0]
      if (!device) throw new ApiError(401, "invalid_device_key")

      const hostname = req.header("x-agent-hostname") || null
      const version  = req.header("x-agent-version")  || null
      await pool.query(
        "UPDATE devices SET last_seen_at=now(), hostname=COALESCE(?,hostname), agent_version=COALESCE(?,agent_version) WHERE id=?",
        [hostname, version, device.id]
      )

      ;(req as any).device_id = device.id
      next()
    } catch (e) { next(e) }
  }
}

export function signToken(payload: Record<string, any>): string {
  return jwt.sign(payload, process.env.JWT_SECRET || "dev",
    { expiresIn: (process.env.JWT_TTL || "8h") as any })
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = (req as any).auth as JwtClaims
    if (!auth) throw new ApiError(401, "unauthenticated")
    if (roles.length && !roles.includes(auth.role || "")) {
      throw new ApiError(403, "forbidden", `Required: ${roles.join("|")}`)
    }
    next()
  }
}
