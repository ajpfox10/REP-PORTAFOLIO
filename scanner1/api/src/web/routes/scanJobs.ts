// routes/scanJobs.ts — CRUD completo + upload de páginas escaneadas
import { Router } from "express"
import multer from "multer"
import crypto from "crypto"
import { validate } from "../validate.js"
import { createScanJobSchema, paginationSchema, agentUploadSchema } from "../../shared/index.js"
import { pool } from "../../db/mysql.js"
import { buildStoredOutput, scanQueue } from "../../services/queue.js"
import { storage } from "../../services/storage.js"
import { scanDurationSeconds, scanJobsTotal } from "../metrics.js"
import { ApiError } from "../errorHandler.js"
import { requireDeviceAuth } from "../auth.js"
import { requireTenant } from "../tenant.js"
import { deliverWebhookToSubscribers } from "../../services/webhook.js"
import { fetchPersonalPendingTramites, notifyPersonalApi } from "../../services/personalIntegration.js"
import { scanBufferWithClamAV } from "../../services/clamav.js"
import { asyncRoute } from "../asyncRoute.js"
import { Jimp } from "jimp"

const r = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } })

// ── GET /v1/scan-jobs — listar ────────────────────────────────────────────────
r.get("/", validate(paginationSchema, "query"), asyncRoute(async (req, res) => {
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
}))

// ── GET /v1/scan-jobs/:id ─────────────────────────────────────────────────────
r.get("/:id", asyncRoute(async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const id = Number(req.params.id)
  const [rows] = await pool.query(
    "SELECT j.*, d.id as document_id, d.doc_class, d.page_count as doc_pages FROM scan_jobs j LEFT JOIN documents d ON d.scan_job_id=j.id AND d.tenant_id=j.tenant_id WHERE j.tenant_id=? AND j.id=?",
    [tenant_id, id]
  )
  const job = (rows as any[])[0]
  if (!job) throw new ApiError(404, "scan_job_not_found")
  res.json(job)
}))

// ── POST /v1/scan-jobs — crear job ───────────────────────────────────────────
r.post("/", validate(createScanJobSchema, "body"), asyncRoute(async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const body = req.body as any

  const [devRows] = await pool.query(
    "SELECT id FROM devices WHERE tenant_id=? AND id=? AND is_active=1",
    [tenant_id, body.device_id]
  )
  if (!(devRows as any[]).length) throw new ApiError(404, "device_not_found")

  const nonce = crypto.randomBytes(32).toString("hex")

  const manualDpi = body.profile_id ? null : (body.dpi || 300)
  const manualColor = body.profile_id ? null : (body.color === false ? 0 : 1)
  const duplexValue = body.duplex || body.source === "adf_duplex" ? 1 : 0
  const paperSize = body.paper_size || "A4"
  const personalRef = String(body.personal_ref || "").startsWith("respage|")
    ? body.personal_ref
    : (body.doc_class || body.personal_ref || null)
  const [result] = await pool.query(
    `INSERT INTO scan_jobs
       (tenant_id,device_id,profile_id,priority,status,source,duplex,paper_size,
        dpi,color,auto_rotate,blank_page_detection,compression,output_format,
        personal_dni,personal_ref,upload_nonce,created_at)
     VALUES (?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,?,?,now())`,
    [
      tenant_id,
      body.device_id,
      body.profile_id || null,
      body.priority,
      body.source || "flatbed",
      duplexValue,
      paperSize,
      manualDpi,
      manualColor,
      body.profile_id ? null : (body.auto_rotate ? 1 : 0),
      body.profile_id ? null : (body.blank_page_detection ? 1 : 0),
      body.profile_id ? null : body.compression,
      body.profile_id ? null : body.output_format,
      body.personal_dni || null,
      personalRef,
      nonce,
    ]
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
}))

// ── GET /v1/scan-jobs/:id/pages — páginas escaneadas de un job ────────────────
r.get("/:id/pages", asyncRoute(async (req, res) => {
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
}))

// POST /v1/scan-jobs/:id/pages/:pageNumber/rotate
// Rota la pagina almacenada y reconstruye el documento final antes de sincronizarlo.
r.post("/:id/pages/:pageNumber/rotate", asyncRoute(async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const job_id = Number(req.params.id)
  const page_number = Number(req.params.pageNumber)
  const degrees = Number(req.body?.degrees ?? 90)

  if (![90, 180, 270, -90, -180, -270].includes(degrees)) {
    throw new ApiError(400, "invalid_rotation")
  }

  const [rows] = await pool.query(
    `SELECT d.id AS document_id, d.storage_key AS document_storage_key,
            COALESCE(dp.storage_key, CASE WHEN ?=1 THEN d.storage_key END) AS page_storage_key,
            COALESCE(j.output_format, p.output_format, 'pdf') AS output_format
       FROM scan_jobs j
       JOIN documents d ON d.scan_job_id=j.id AND d.tenant_id=j.tenant_id AND d.deleted_at IS NULL
       LEFT JOIN document_pages dp ON dp.document_id=d.id AND dp.tenant_id=d.tenant_id AND dp.page_number=?
       LEFT JOIN scan_profiles p ON p.id=j.profile_id AND p.tenant_id=j.tenant_id
      WHERE j.tenant_id=? AND j.id=? AND COALESCE(dp.storage_key, CASE WHEN ?=1 THEN d.storage_key END) IS NOT NULL
      LIMIT 1`,
    [page_number, page_number, tenant_id, job_id, page_number]
  )
  const page = (rows as any[])[0]
  if (!page) throw new ApiError(404, "scan_page_not_found")

  let rotated: Buffer
  try {
    const image = await Jimp.read(await storage().get(page.page_storage_key))
    image.rotate(degrees)
    rotated = await image.getBuffer("image/jpeg", { quality: 88 })
  } catch {
    throw new ApiError(422, "page_rotation_not_supported", "La pagina no es una imagen compatible")
  }

  const rotatedPage = await storage().put(rotated, ".jpg", "image/jpeg", `t${tenant_id}/j${job_id}`)
  const [pageRows] = await pool.query(
    "SELECT page_number, storage_key FROM document_pages WHERE tenant_id=? AND document_id=? ORDER BY page_number ASC",
    [tenant_id, page.document_id]
  )
  const storedPages = pageRows as any[]
  if (!storedPages.some((item) => item.page_number === page_number)) {
    storedPages.push({ page_number, storage_key: page.page_storage_key })
    storedPages.sort((a, b) => a.page_number - b.page_number)
  }
  const pageKeys = storedPages.map((item) =>
    item.page_number === page_number ? rotatedPage.key : item.storage_key
  )
  const pageBuffers = await Promise.all(pageKeys.map((key) => storage().get(key)))
  const finalOutput = await buildStoredOutput(tenant_id, job_id, page.output_format, pageBuffers)

  const [updatedPage] = await pool.query(
    "UPDATE document_pages SET storage_key=? WHERE tenant_id=? AND document_id=? AND page_number=?",
    [rotatedPage.key, tenant_id, page.document_id, page_number]
  )
  if ((updatedPage as any).affectedRows === 0) {
    await pool.query(
      "INSERT INTO document_pages (tenant_id,document_id,page_number,storage_key,created_at) VALUES (?,?,?,?,now())",
      [tenant_id, page.document_id, page_number, rotatedPage.key]
    )
  }
  await pool.query(
    "UPDATE documents SET storage_key=?, mime_type=? WHERE tenant_id=? AND id=?",
    [finalOutput.storage_key, finalOutput.mime_type, tenant_id, page.document_id]
  )

  await Promise.all([
    storage().del(page.page_storage_key),
    storage().del(page.document_storage_key),
  ])

  res.json({
    ok: true,
    page_number,
    storage_key: rotatedPage.key,
    document_storage_key: finalOutput.storage_key,
  })
}))

// POST /v1/scan-jobs/consolidate
// Une las tandas temporales de una sesión (cristal/ADF) en un único documento
// (PDF/TIFF/JPG según output_format).
r.post("/consolidate", asyncRoute(async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const body = (req.body || {}) as {
    job_ids?: number[]
    page_keys?: string[]
    personal_dni?: number
    personal_ref?: string
    doc_class?: string
    output_format?: string
  }
  const job_ids = [...new Set((body.job_ids || []).map(Number).filter(Number.isFinite))]
  const page_keys = (body.page_keys || []).map(String).filter(Boolean)

  if (!job_ids.length || !page_keys.length) throw new ApiError(400, "empty_scan_session")
  if (!body.personal_dni) throw new ApiError(400, "missing_personal_dni")

  const placeholders = job_ids.map(() => "?").join(",")
  const [docRows] = await pool.query(
    `SELECT j.id AS scan_job_id, j.output_format AS job_output_format, d.id AS document_id, d.storage_key AS document_storage_key
       FROM scan_jobs j
       JOIN documents d ON d.scan_job_id=j.id AND d.tenant_id=j.tenant_id AND d.deleted_at IS NULL
      WHERE j.tenant_id=? AND j.id IN (${placeholders}) AND j.status='completed'
      ORDER BY FIELD(j.id, ${placeholders})`,
    [tenant_id, ...job_ids, ...job_ids]
  )
  const docs = docRows as any[]
  if (docs.length !== job_ids.length) throw new ApiError(409, "scan_session_not_ready")

  const documentIds = docs.map((doc) => doc.document_id)
  const docPlaceholders = documentIds.map(() => "?").join(",")
  const [allowedRows] = await pool.query(
    `SELECT storage_key FROM document_pages
      WHERE tenant_id=? AND document_id IN (${docPlaceholders})`,
    [tenant_id, ...documentIds]
  )
  const allowedKeys = new Set((allowedRows as any[]).map((page) => String(page.storage_key)))
  if (page_keys.some((key) => !allowedKeys.has(key))) {
    throw new ApiError(400, "invalid_scan_session_page")
  }

  const canonical = docs[0]

  const ALLOWED_FORMATS = new Set(["pdf", "pdf_a", "tiff", "jpg"])
  const requestedFormat = String(body.output_format || canonical.job_output_format || "pdf").toLowerCase()
  let effectiveFormat = ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat : "pdf"
  // JPG no soporta multipágina: degradar a PDF
  if (effectiveFormat === "jpg" && page_keys.length > 1) effectiveFormat = "pdf"

  // Leer los buffers de cada página — si alguno no existe en disco, error amigable
  let pageBuffers: Buffer[]
  try {
    pageBuffers = await Promise.all(page_keys.map((key) => storage().get(key)))
  } catch (e: any) {
    const missing = page_keys.find(k => e.message?.includes(k.split("/").pop() ?? k))
    throw new ApiError(
      409,
      "scan_pages_lost",
      `Algunos archivos escaneados ya no están disponibles en el servidor ` +
      `(probablemente por un reinicio del servicio). ` +
      `Por favor, descartá las páginas y volvé a escanear.` +
      (missing ? ` (archivo: ${missing})` : "")
    )
  }

  const finalOutput = await buildStoredOutput(tenant_id, canonical.scan_job_id, effectiveFormat, pageBuffers)
  const personal_ref = body.personal_ref || body.doc_class || "documento_escaneado"
  const doc_class = body.doc_class || body.personal_ref || "documento_escaneado"
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    await connection.query(
      `UPDATE documents
          SET storage_key=?, mime_type=?, page_count=?, doc_class=?,
              personal_dni=?, personal_ref=?, search_text=?, updated_at=now()
        WHERE tenant_id=? AND id=?`,
      [
        finalOutput.storage_key,
        finalOutput.mime_type,
        page_keys.length,
        doc_class,
        body.personal_dni,
        personal_ref,
        `${personal_ref} ${doc_class}`.trim(),
        tenant_id,
        canonical.document_id,
      ]
    )
    await connection.query(
      "DELETE FROM document_pages WHERE tenant_id=? AND document_id=?",
      [tenant_id, canonical.document_id]
    )
    for (let i = 0; i < page_keys.length; i++) {
      await connection.query(
        "INSERT INTO document_pages (tenant_id,document_id,page_number,storage_key,created_at) VALUES (?,?,?,?,now())",
        [tenant_id, canonical.document_id, i + 1, page_keys[i]]
      )
    }
    await connection.query(
      "UPDATE scan_jobs SET personal_dni=?, personal_ref=?, output_format=?, page_count=?, updated_at=now() WHERE tenant_id=? AND id=?",
      [body.personal_dni, personal_ref, effectiveFormat, page_keys.length, tenant_id, canonical.scan_job_id]
    )

    const extraDocs = docs.slice(1).map((doc) => doc.document_id)
    if (extraDocs.length) {
      await connection.query(
        `UPDATE documents SET deleted_at=now(), updated_at=now()
          WHERE tenant_id=? AND id IN (${extraDocs.map(() => "?").join(",")})`,
        [tenant_id, ...extraDocs]
      )
    }
    await connection.commit()
  } catch (e) {
    await connection.rollback()
    await storage().del(finalOutput.storage_key)
    throw e
  } finally {
    connection.release()
  }

  const ok = await notifyPersonalApi(tenant_id, {
    personal_dni: body.personal_dni,
    personal_ref,
    document_id: canonical.document_id,
    scan_job_id: canonical.scan_job_id,
    doc_class,
    page_count: page_keys.length,
    storage_key: finalOutput.storage_key,
  })
  if (!ok) throw new ApiError(502, "personal_sync_failed")

  await Promise.all(
    docs
      .map((doc) => String(doc.document_storage_key))
      .filter((key) => key && key !== finalOutput.storage_key && !page_keys.includes(key))
      .map((key) => storage().del(key))
  )

  res.json({
    ok: true,
    document_id: canonical.document_id,
    scan_job_id: canonical.scan_job_id,
    page_count: page_keys.length,
    storage_key: finalOutput.storage_key,
    output_format: effectiveFormat,
    mime_type: finalOutput.mime_type,
  })
}))

// POST /v1/scan-jobs/:id/sync-personal
// Fuerza la importacion en api_personal para que el boton Guardar tenga efecto real.
r.post("/:id/sync-personal", asyncRoute(async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const job_id = Number(req.params.id)
  const body = (req.body || {}) as { personal_ref?: string; doc_class?: string }

  const [rows] = await pool.query(
    `SELECT j.id AS scan_job_id, j.personal_dni, j.personal_ref,
            d.id AS document_id, d.doc_class, d.page_count, d.storage_key
       FROM scan_jobs j
       LEFT JOIN documents d ON d.scan_job_id=j.id AND d.tenant_id=j.tenant_id AND d.deleted_at IS NULL
      WHERE j.tenant_id=? AND j.id=?
      LIMIT 1`,
    [tenant_id, job_id]
  )
  const row = (rows as any[])[0]
  if (!row) throw new ApiError(404, "scan_job_not_found")
  if (!row.document_id || !row.storage_key) throw new ApiError(409, "document_not_ready")
  if (!row.personal_dni) throw new ApiError(400, "missing_personal_dni")

  const personal_ref = body.personal_ref || row.personal_ref || undefined
  const doc_class = body.doc_class || row.doc_class || row.personal_ref || "documento_escaneado"

  const ok = await notifyPersonalApi(tenant_id, {
    personal_dni: row.personal_dni,
    personal_ref,
    document_id: row.document_id,
    scan_job_id: row.scan_job_id,
    doc_class,
    page_count: row.page_count,
    storage_key: row.storage_key,
  })

  if (!ok) throw new ApiError(502, "personal_sync_failed")
  res.json({ ok: true, document_id: row.document_id })
}))

// ── POST /v1/scan-jobs/:id/cancel ────────────────────────────────────────────
r.post("/:id/cancel", asyncRoute(async (req, res) => {
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
}))

// ── POST /v1/scan-jobs/:id/upload — el agent sube las páginas escaneadas ──────
// Esta ruta usa device auth (x-device-key), no JWT
r.post(
  "/:id/upload",
  requireTenant(),
  requireDeviceAuth(),
  upload.array("pages", 500),
  asyncRoute(async (req, res) => {
    const tenant_id  = (req as any).tenant_id  as number
    const device_id  = (req as any).device_id  as number
    const job_id     = Number(req.params.id)
    const nonce      = req.body.nonce as string

    const [rows] = await pool.query(
      `SELECT j.status, j.upload_nonce, j.personal_dni, j.personal_ref,
              COALESCE(j.output_format, p.output_format) AS output_format
       FROM scan_jobs j
       LEFT JOIN scan_profiles p ON p.id=j.profile_id AND p.tenant_id=j.tenant_id
       WHERE j.tenant_id=? AND j.id=? AND j.device_id=?`,
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
      output_format: job.output_format || "pdf",
    }, { priority: 10, jobId: `finalize-${job_id}` })

    scanJobsTotal.inc({ tenant_id: String(tenant_id), status: "uploaded" }, 1)
    res.json({ ok: true, pages: files.length, storage_keys })
  })
)

export default r
