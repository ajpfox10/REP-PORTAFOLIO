import jwt from "jsonwebtoken";
import { pool } from "../db/mysql.js";
import { ApiError } from "./errorHandler.js";
// Secretos a probar en orden: scanner propio, luego api_personal
function getSecrets() {
    return [
        process.env.JWT_SECRET || "dev",
        process.env.PERSONAL_JWT_SECRET || "",
    ].filter(s => s.length > 0);
}
// ── JWT auth ──────────────────────────────────────────────────────────────────
export function requireAuth() {
    return async (req, _res, next) => {
        try {
            const raw = (req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim();
            // Sin token → rechazar con mensaje claro
            if (!raw)
                throw new ApiError(401, "missing_token", "Enviá Authorization: Bearer <token>");
            // Probar cada secreto hasta que uno valide
            let claims = null;
            for (const secret of getSecrets()) {
                try {
                    claims = jwt.verify(raw, secret);
                    break;
                }
                catch { /* probar siguiente */ }
            }
            if (!claims)
                throw new ApiError(401, "invalid_token", "Token inválido o expirado");
            req.auth = claims;
            if (!req.tenant_id) {
                ;
                req.tenant_id = claims.tenant_id || 1;
            }
            next();
        }
        catch (e) {
            next(e);
        }
    };
}
// ── Device (agent) auth via device_key ───────────────────────────────────────
export function requireDeviceAuth() {
    return async (req, _res, next) => {
        try {
            const tenant_id = req.tenant_id;
            const deviceKey = req.header("x-device-key") || req.body?.device_key;
            if (!deviceKey)
                throw new ApiError(401, "missing_device_key");
            const [rows] = await pool.query("SELECT id FROM devices WHERE tenant_id=? AND device_key=? AND is_active=1", [tenant_id, deviceKey]);
            const device = rows[0];
            if (!device)
                throw new ApiError(401, "invalid_device_key");
            const hostname = req.header("x-agent-hostname") || null;
            const version = req.header("x-agent-version") || null;
            await pool.query("UPDATE devices SET last_seen_at=now(), hostname=COALESCE(?,hostname), agent_version=COALESCE(?,agent_version) WHERE id=?", [hostname, version, device.id]);
            req.device_id = device.id;
            next();
        }
        catch (e) {
            next(e);
        }
    };
}
export function signToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET || "dev", { expiresIn: (process.env.JWT_TTL || "8h") });
}
export function requireRole(...roles) {
    return (req, _res, next) => {
        const auth = req.auth;
        if (!auth)
            throw new ApiError(401, "unauthenticated");
        if (roles.length && !roles.includes(auth.role || "")) {
            throw new ApiError(403, "forbidden", `Required: ${roles.join("|")}`);
        }
        next();
    };
}
