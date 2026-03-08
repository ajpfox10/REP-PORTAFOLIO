// web/router.ts — Registro central de rutas
import { Router } from "express"
import { requireAuth } from "./auth.js"
import { requireTenant } from "./tenant.js"
import authRoute     from "./routes/auth.js"
import devices       from "./routes/devices.js"
import profiles      from "./routes/profiles.js"
import scanJobs      from "./routes/scanJobs.js"
import documents     from "./routes/documents.js"
import agent         from "./routes/agent.js"
import webhooks      from "./routes/webhooks.js"
import integration   from "./routes/integration.js"

export const router = Router()

// Info pública
router.get("/", (_req, res) => res.json({ name: "scanner-api", version: "3.0.0" }))
router.get("/v1", (_req, res) => res.json({ name: "scanner-api", version: "3.0.0" }))

// Auth (público — login/logout)
router.use("/v1/auth", requireTenant(), authRoute)

// Agent (usa device_key, no JWT)
router.use("/v1/agent", agent)

// Rutas protegidas: tenant (con fallback a 1) + JWT del scanner o del api_personal
const protect = [requireTenant(), requireAuth()]

router.use("/v1/devices",     ...protect, devices)
router.use("/v1/profiles",    ...protect, profiles)
router.use("/v1/scan-jobs",   ...protect, scanJobs)
router.use("/v1/documents",   ...protect, documents)
router.use("/v1/webhooks",    ...protect, webhooks)
router.use("/v1/integration", ...protect, integration)
