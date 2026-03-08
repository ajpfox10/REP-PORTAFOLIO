import "./bootstrap-env.js";
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, "../../.env") })

import express from "express"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import compression from "compression"
import { router } from "./web/router.js"
import { errorHandler } from "./web/errorHandler.js"
import { metricsRouter } from "./web/metrics.js"
import { requestId } from "./web/requestId.js"
import { migrate } from "./db/migrate.js"

const app = express()

// ── Security & middleware ─────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }))
app.use(compression())
app.use(requestId())
const allowedOrigins = (process.env.CORS_ORIGINS || "*").split(",").map(s => s.trim())
app.use(cors({
  origin: (origin, callback) => {
    // Sin origin = curl, Postman, server-to-server → permitir
    if (!origin) return callback(null, true)
    // Wildcard → permitir todo
    if (allowedOrigins.includes("*")) return callback(null, true)
    // Chequear si está en la lista
    if (allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origin not allowed: ${origin}`))
  },
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["authorization","content-type","x-tenant","x-tenant-id","x-device-key","x-agent-hostname","x-agent-version","x-request-id"],
  credentials: true,
}))
app.use((req, res, next) => {
  if (req.path.includes('/upload')) return next()
  express.json({ limit: `${process.env.MAX_UPLOAD_MB || 150}mb` })(req, res, next)
})
app.use(express.urlencoded({ extended: true, limit: `${process.env.MAX_UPLOAD_MB || 150}mb` }))

// ── Rate limiting (global) ────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max:      Number(process.env.RATE_LIMIT_MAX       || 300),
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) => req.path === "/health" || req.path === "/metrics",
}))

// ── System endpoints ──────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }))
app.use("/metrics", metricsRouter)

// ── App routes ────────────────────────────────────────────────────────────────
app.use(router)

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "not_found" }))

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler)

// ── Start ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT || 3001)

async function start() {
  if (process.env.AUTO_MIGRATE === "true") {
    console.log("[api] running migrations...")
    await migrate()
    console.log("[api] migrations done")
  }
  app.listen(port, () => {
    console.log(`[api] scanner-api v3 listening on :${port}`)
    console.log(`[api] health: http://localhost:${port}/health`)
  })
}

start().catch(e => { console.error("[api] startup error", e); process.exit(1) })
