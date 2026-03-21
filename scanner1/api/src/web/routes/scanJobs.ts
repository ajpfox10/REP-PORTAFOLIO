// routes/scanJobs.ts — CRUD completo + upload de páginas escaneadas
import { Router } from "express"
import multer from "multer"
import crypto from "crypto"
import { validate } from "../validate.js"
import { createScanJobSchema, paginationSchema, agentUploadSchema } from "../../shared/index.js"
import { pool } from "../../db/mysql.js"
import { scanQueue } from "../../services/queue.js"
import { storage } from "../../services/storage.js"
import { scanDurationSeconds, scanJobsTotal } from "../metrics.js"
import { ApiError } from "../errorHandler.js"
import { requireDeviceAuth } from "../auth.js"
import { requireTenant } from "../tenant.js"
import { deliverWebhookToSubscribers } from "../../services/webhook.js"
import { fetchPersonalPendingTramites } from "../../services/personalIntegration.js"
import { scanBufferWithClamAV } from "../../services/clamav.js"

const r = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } })

// ── GET /v1/scan-jobs — listar ────────────────────────────────────────────────
r.get("/", validate(paginationSchema, "query"), async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const { limit, cursor } = req.query as any
  const status = req.query.status as string | undefined
  const dni    = req.query.personal_dni ? Number(req.query.personal_dni) : undefined

  let sql = "SELECT * FROM scan_jobs WHERE tenant_id=? AND id>?"
  const params: any[] = [tenant_id, cursor]
  if (status)  { sql += " AND status=?";       params.push(status) }
  if (dni)     { sql += " AND personal_dni=?"; params.push(dni) }
  sql += " ORDER BY id DESC LIMIT ?"
  params.push(limit)

  const [rows] = await pool.query(sql, params)
  const items = rows as any[]
  res.json({ items, next_cursor: items.at(-1)?.id || cursor })
})

// ── GET /v1/scan-jobs/:id ─────────────────────────────────────────────────────
r.get("/:id", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const id = Number(req.params.id)
  const [rows] = await pool.query(
    "SELECT j.*, d.id as document_id, d.doc_class, d.page_count as doc_pages FROM scan_jobs j LEFT JOIN documents d ON d.scan_job_id=j.id AND d.tenant_id=j.tenant_id WHERE j.tenant_id=? AND j.id=?",
    [tenant_id, id]
  )
  const job = (rows as any[])[0]
  if (!job) throw new ApiError(404, "scan_job_not_found")
  res.json(job)
})

// ── POST /v1/scan-jobs — crear job ───────────────────────────────────────────
r.post("/", validate(createScanJobSchema, "body"), async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const body = req.body as any

  const [devRows] = await pool.query(
    "SELECT id FROM devices WHERE tenant_id=? AND id=? AND is_active=1",
    [tenant_id, body.device_id]
  )
  if (!(devRows as any[]).length) throw new ApiError(404, "device_not_found")

  const nonce = crypto.randomBytes(32).toString("hex")

  const [result] = await pool.query(
    `INSERT INTO scan_jobs (tenant_id,device_id,profile_id,priority,status,source,duplex,personal_dni,personal_ref,upload_nonce,created_at)
     VALUES (?,?,?,?,'queued',?,?,?,?,?,now())`,
    [tenant_id, body.device_id, body.profile_id || null, body.priority,
     body.source || "flatbed", body.duplex ? 1 : 0,
     body.personal_dni || null, body.personal_ref || null, nonce]
  )
  const id = Number((result as any).insertId)

  // Encolar para que el agent lo levante
  await scanQueue.add("scan_job", { tenant_id, scan_job_id: id }, {
    priority: body.priority,
    jobId: `scan-${id}`,
  })
  scanJobsTotal.inc({ tenant_id: String(tenant_id), status: "queued" }, 1)

  // Webhook
  await deliverWebhookToSubscribers(tenant_id, "scan.queued", { scan_job_id: id, device_id: body.device_id })

  // Si tiene DNI, traer trámites pendientes para contexto del operador
  let pending_tramites: any[] = []
  if (body.personal_dni) {
    pending_tramites = await fetchPersonalPendingTramites(tenant_id, body.personal_dni)
  }

  res.status(201).json({ id, upload_nonce: nonce, pending_tramites })
})

// ── GET /v1/scan-jobs/:id/pages — páginas escaneadas de un job ────────────────
r.get("/:id/pages", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const job_id = Number(req.params.id)

  // Buscar el documento asociado al job
  const [docRows] = await pool.query(
    "SELECT id, storage_key, page_count FROM documents WHERE tenant_id=? AND scan_job_id=? AND deleted_at IS NULL LIMIT 1",
    [tenant_id, job_id]
  )
  const doc = (docRows as any[])[0]
  if (!doc) return res.json({ pages: [], doc_id: null, status: "no_document" })

  // Buscar páginas en document_pages (ya incluye página 1 tras el fix de scanFinalize)
  const [pageRows] = await pool.query(
    "SELECT page_number, storage_key, is_blank FROM document_pages WHERE tenant_id=? AND document_id=? ORDER BY page_number ASC",
    [tenant_id, doc.id]
  )
  const pages = pageRows as any[]

  // Si no hay entradas en document_pages (docs escaneados antes del fix),
  // exponer el storage_key del documento como página 1
  if (!pages.length && doc.storage_key) {
    return res.json({
      doc_id: doc.id,
      pages: [{ page_number: 1, storage_key: doc.storage_key, is_blank: 0 }],
    })
  }

  // Para docs viejos con document_pages pero sin página 1 (bug previo):
  // si la página 1 no está en el resultado, agregarla desde documents.storage_key
  const hasPage1 = pages.some((p: any) => p.page_number === 1)
  if (!hasPage1 && doc.storage_key) {
    pages.unshift({ page_number: 1, storage_key: doc.storage_key, is_blank: 0 })
  }

  res.json({ doc_id: doc.id, pages })
})

// ── POST /v1/scan-jobs/:id/cancel ────────────────────────────────────────────
r.post("/:id/cancel", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const id = Number(req.params.id)

  const [rows] = await pool.query(
    "SELECT status FROM scan_jobs WHERE tenant_id=? AND id=?", [tenant_id, id]
  )
  const job = (rows as any[])[0]
  if (!job) throw new ApiError(404, "scan_job_not_found")
  if (!["queued","in_progress"].includes(job.status)) throw new ApiError(409, "cannot_cancel", `Job status: ${job.status}`)

  await pool.query(
    "UPDATE scan_jobs SET status='canceled', updated_at=now() WHERE tenant_id=? AND id=?",
    [tenant_id, id]
  )
  await deliverWebhookToSubscribers(tenant_id, "scan.canceled", { scan_job_id: id })
  res.json({ ok: true })
})

// ── POST /v1/scan-jobs/:id/upload — el agent sube las páginas escaneadas ──────
// Esta ruta usa device auth (x-device-key), no JWT
r.post(
  "/:id/upload",
  requireTenant(),
  requireDeviceAuth(),
  upload.array("pages", 500),
  async (req, res) => {
    const tenant_id  = (req as any).tenant_id  as number
    const device_id  = (req as any).device_id  as number
    const job_id     = Number(req.params.id)
    const nonce      = req.body.nonce as string

    const [rows] = await pool.query(
      "SELECT status, upload_nonce, personal_dni, personal_ref FROM scan_jobs WHERE tenant_id=? AND id=? AND device_id=?",
      [tenant_id, job_id, device_id]
    )
    const job = (rows as any[])[0]
    if (!job)         throw new ApiError(404, "scan_job_not_found")
    if (job.upload_nonce !== nonce) throw new ApiError(401, "invalid_nonce")
    if (job.status !== "queued" && job.status !== "in_progress") throw new ApiError(409, "job_not_uploadable")

    const files = (req.files as any[]) || []
    if (!files.length) throw new ApiError(400, "no_pages_uploaded")

    const timer = scanDurationSeconds.startTimer({ tenant_id: String(tenant_id) })
    const storage_keys: string[] = []

    for (const file of files) {
      // Antivirus check
      if (process.env.CLAMAV_ENABLED === "true") {
        const av = await scanBufferWithClamAV(file.buffer)
        if (!av.ok) throw new ApiError(422, "virus_detected", `ClamAV: ${av.virus}`)
      }

      const ext = file.mimetype.includes("pdf") ? ".pdf" :
                  file.mimetype.includes("tiff") ? ".tiff" : ".jpg"
      const stored = await storage().put(file.buffer, ext, file.mimetype, `t${tenant_id}/j${job_id}`)
      storage_keys.push(stored.key)
    }

    timer()

    // Encolar finalización
    const { ocrQueue: _ocr, aiQueue: _ai, indexQueue: _idx, ...queueModule } = await import("../../services/queue.js")
    await queueModule.scanQueue.add("scan_finalize", {
      tenant_id,
      scan_job_id: job_id,
      storage_keys,
      page_count:   files.length,
      personal_dni: job.personal_dni,
      personal_ref: job.personal_ref,
    }, { priority: 10, jobId: `finalize-${job_id}` })

    scanJobsTotal.inc({ tenant_id: String(tenant_id), status: "uploaded" }, 1)
    res.json({ ok: true, pages: files.length, storage_keys })
  }
)

export default r
