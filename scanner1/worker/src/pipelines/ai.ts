// worker/pipelines/ai.ts — Clasificación y extracción de documentos
// Funciona sin AI externa: keyword-based classifier
// Enchufable con OpenAI si se configura AI_PROVIDER=openai

import type { Pool } from "mysql2/promise"
import type { DocClass } from "../shared/index.js"
import { indexQueue } from "../queues.js"
import { notifyPersonalApiFromWorker } from "../personalClient.js"

// ── Keyword classifier (sin API externa) ──────────────────────────────────────
const CLASS_RULES: Array<{ class: DocClass; keywords: string[] }> = [
  { class: "invoice",        keywords: ["factura", "invoice", "total a pagar", "monto", "iva", "cuit"] },
  { class: "id_card",        keywords: ["dni", "documento nacional", "cédula", "identidad", "renaper"] },
  { class: "medical_record", keywords: ["diagnóstico", "médico", "paciente", "historia clínica", "receta", "ioma", "salud"] },
  { class: "contract",       keywords: ["contrato", "acuerdo", "parte", "cláusula", "firmante", "convenio"] },
  { class: "resolution",     keywords: ["resolución", "disposición", "ministerio", "decreto", "considerando", "artículo"] },
  { class: "certificate",    keywords: ["certificado", "certifica", "constancia", "se hace constar", "expedido"] },
]

function classifyByKeywords(text: string): { doc_class: DocClass; confidence: number } {
  const lower = text.toLowerCase()
  let best: DocClass = "unknown"
  let bestScore = 0

  for (const rule of CLASS_RULES) {
    const matches = rule.keywords.filter(kw => lower.includes(kw)).length
    const score   = matches / rule.keywords.length
    if (score > bestScore) { bestScore = score; best = rule.class }
  }

  return { doc_class: best, confidence: bestScore }
}

// ── Entity extractor por doc_class ────────────────────────────────────────────
function extractEntities(text: string, docClass: DocClass): Record<string, any> {
  const lower = text.toLowerCase()
  const result: Record<string, any> = {}

  // Fechas (dd/mm/yyyy o dd-mm-yyyy)
  const dates = text.match(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/g) || []
  if (dates.length) result.dates_found = [...new Set(dates)]

  // CUIL/CUIT
  const cuils = text.match(/\b\d{2}-\d{8}-\d{1}\b/g) || []
  if (cuils.length) result.cuils = [...new Set(cuils)]

  // DNI
  const dnis = text.match(/\bDNI[:\s]+(\d{7,8})\b/i) || text.match(/\b(\d{7,8})\b/g) || []
  if (dnis.length && docClass === "id_card") result.dni_candidates = Array.isArray(dnis) ? dnis.slice(0, 3) : [dnis[1]]

  // Montos
  if (docClass === "invoice") {
    const amounts = text.match(/\$[\s]?\d[\d.,]+/g) || []
    if (amounts.length) result.amounts = amounts.slice(0, 5)
  }

  // Número de resolución
  if (docClass === "resolution") {
    const m = text.match(/resoluci[oó]n\s+(?:n[°º]?\s*)?(\d+[\s/]\d+)/i)
    if (m) result.resolution_number = m[1]
  }

  return result
}

// ── OpenAI provider (si está configurado) ─────────────────────────────────────
async function classifyWithOpenAI(text: string): Promise<{ doc_class: DocClass; confidence: number }> {
  // Solo intentar si está configurado
  if (!process.env.OPENAI_API_KEY) return classifyByKeywords(text)

  try {
    const { default: OpenAI } = await import("openai")
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: `Classify this document text into one of: invoice, id_card, medical_record, contract, resolution, certificate, unknown.
Respond with JSON: {"doc_class":"...","confidence":0.9}
Document (first 800 chars):
${text.slice(0, 800)}`
      }]
    })

    const content = res.choices[0]?.message?.content || "{}"
    const parsed = JSON.parse(content.replace(/```json|```/g, ""))
    return { doc_class: parsed.doc_class || "unknown", confidence: parsed.confidence || 0.5 }
  } catch (e: any) {
    console.warn("[ai] openai classify failed, fallback to keywords", e?.message)
    return classifyByKeywords(text)
  }
}

// ── Pipeline principal ────────────────────────────────────────────────────────
export async function runAiPipeline(pool: Pool, data: any) {
  const { tenant_id, document_id } = data

  const [rows] = await pool.query(
    "SELECT ocr_text, personal_dni, personal_ref, scan_job_id, storage_key FROM documents WHERE tenant_id=? AND id=?",
    [tenant_id, document_id]
  )
  const doc = (rows as any[])[0]
  if (!doc?.ocr_text) {
    console.log(`[ai] document ${document_id} has no OCR text, skipping`)
    return
  }

  try {
    const text = doc.ocr_text as string

    // 1) Clasificar
    const { doc_class, confidence } = process.env.AI_PROVIDER === "openai"
      ? await classifyWithOpenAI(text)
      : classifyByKeywords(text)

    // 2) Extraer entidades
    const extracted = extractEntities(text, doc_class)
    extracted._confidence = confidence

    // 3) Guardar
    await pool.query(
      "UPDATE documents SET doc_class=?, extracted_json=?, updated_at=now() WHERE tenant_id=? AND id=?",
      [doc_class, JSON.stringify(extracted), tenant_id, document_id]
    )

    // 4) Notificar api_personal si está vinculado a un DNI
    if (doc.personal_dni) {
      await notifyPersonalApiFromWorker(pool, tenant_id, {
        personal_dni:  doc.personal_dni,
        personal_ref:  doc.personal_ref,
        document_id,
        scan_job_id:   doc.scan_job_id,
        doc_class,
        page_count:    null,
        storage_key:   doc.storage_key,
        ocr_text:      text,
      })
    }

    // 5) Encolar indexación
    await indexQueue.add("index_job", { tenant_id, document_id }, { priority: 3 })

    console.log(`[ai] document ${document_id} → ${doc_class} (${(confidence*100).toFixed(0)}%)`)
  } catch (e: any) {
    console.error("[ai] pipeline error", e?.message)
  }
}
