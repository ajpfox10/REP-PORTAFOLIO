// services/personalIntegration.ts
// Integración con el backend api_personal.
// Cuando se escanea un documento vinculado a un DNI, notifica al backend
// principal para que el documento aparezca en el legajo del agente.

import axios from "axios"
import { pool } from "../db/mysql.js"

interface PersonalConfig {
  base_url: string
  api_key:  string
}

async function getConfig(tenant_id: number): Promise<PersonalConfig | null> {
  const [rows] = await pool.query(
    "SELECT base_url, api_key FROM personal_integration WHERE tenant_id=? AND is_enabled=1",
    [tenant_id]
  )
  const cfg = (rows as any[])[0]
  if (!cfg) return null
  return { base_url: cfg.base_url, api_key: cfg.api_key }
}

/**
 * Notifica al backend personal que hay un documento escaneado nuevo para un DNI.
 * El backend puede guardarlo como referencia o adjuntarlo al legajo.
 */
export async function notifyPersonalApi(
  tenant_id: number,
  opts: {
    personal_dni:  number
    personal_ref?: string
    document_id:   number
    scan_job_id:   number
    doc_class:     string
    page_count:    number | null
    storage_key:   string
    ocr_text?:     string
  }
): Promise<boolean> {
  const cfg = await getConfig(tenant_id)
  if (!cfg) return false  // integración no configurada → OK silencioso

  try {
    await axios.post(
      `${cfg.base_url}/api/v1/scanner/document-ready`,
      {
        scanner_document_id: opts.document_id,
        scanner_job_id:      opts.scan_job_id,
        personal_dni:        opts.personal_dni,
        personal_ref:        opts.personal_ref || null,
        doc_class:           opts.doc_class,
        page_count:          opts.page_count,
        storage_key:         opts.storage_key,
        ocr_summary:         opts.ocr_text ? opts.ocr_text.slice(0, 500) : null,
      },
      {
        headers: {
          "x-api-key": cfg.api_key,
          "content-type": "application/json",
          "x-scanner-version": "3.0",
        },
        timeout: 5000,
      }
    )
    return true
  } catch (e: any) {
    // Log but don't fail — la integración es best-effort
    console.warn("[personal-integration] notify failed", e?.message)
    return false
  }
}

/**
 * Busca pedidos pendientes de un agente en el backend personal.
 * Usado para mostrar contexto al operador de ventanilla al momento del scan.
 */
export async function fetchPersonalPendingTramites(
  tenant_id: number,
  personal_dni: number
): Promise<any[]> {
  const cfg = await getConfig(tenant_id)
  if (!cfg) return []

  try {
    const res = await axios.get(
      `${cfg.base_url}/api/v1/pedidos?dni=${personal_dni}&limit=20&page=1`,
      {
        headers: { "x-api-key": cfg.api_key },
        timeout: 4000,
      }
    )
    return res.data?.data || []
  } catch {
    return []
  }
}
