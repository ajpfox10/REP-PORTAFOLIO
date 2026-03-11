// worker/pipelines/index.ts — Full-text indexing
import type { Pool } from "mysql2/promise"

export async function runIndexPipeline(pool: Pool, data: any) {
  const { tenant_id, document_id } = data

  const [rows] = await pool.query(
    "SELECT ocr_text, title, doc_class, extracted_json FROM documents WHERE tenant_id=? AND id=?",
    [tenant_id, document_id]
  )
  const doc = (rows as any[])[0]
  if (!doc) return

  // Construir search_text: combinar título, clase, texto OCR y entidades extraídas
  const parts: string[] = []
  if (doc.title)     parts.push(doc.title)
  if (doc.doc_class && doc.doc_class !== "unknown") parts.push(doc.doc_class)

  if (doc.extracted_json) {
    try {
      const ext = typeof doc.extracted_json === "string"
        ? JSON.parse(doc.extracted_json)
        : doc.extracted_json
      // Agregar fechas, CUILs, etc. al índice
      for (const v of Object.values(ext)) {
        if (Array.isArray(v)) parts.push(...v.map(String))
        else if (typeof v === "string" || typeof v === "number") parts.push(String(v))
      }
    } catch {}
  }

  if (doc.ocr_text) parts.push(doc.ocr_text)

  const search_text = parts.join(" ").replace(/\s+/g, " ").trim()

  await pool.query(
    "UPDATE documents SET search_text=?, updated_at=now() WHERE tenant_id=? AND id=?",
    [search_text || null, tenant_id, document_id]
  )

  console.log(`[index] document ${document_id} indexed, ${search_text.length} chars`)
}
