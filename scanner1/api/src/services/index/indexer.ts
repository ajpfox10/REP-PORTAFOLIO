import { pool } from "../../db/mysql.js"

export async function upsertIndex(tenantId: number, documentId: number, text: string) {
  // For mysql fulltext: store text in documents.search_text and create FULLTEXT index
  await pool.query(
    "update documents set search_text = ? where tenant_id = ? and id = ?",
    [text, tenantId, documentId]
  )
}
