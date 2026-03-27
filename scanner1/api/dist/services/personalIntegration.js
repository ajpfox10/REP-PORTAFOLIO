// services/personalIntegration.ts
import axios from "axios";
import { pool } from "../db/mysql.js";
export async function getPersonalIntegrationConfig(tenant_id) {
    const [rows] = await pool.query(`SELECT base_url, api_key
       FROM personal_integration
      WHERE tenant_id=? AND is_enabled=1
      ORDER BY id DESC
      LIMIT 1`, [tenant_id]);
    const row = rows?.[0];
    if (!row?.base_url || !row?.api_key)
        return null;
    return {
        base_url: String(row.base_url).replace(/\/+$/, ""),
        api_key: String(row.api_key),
    };
}
export async function fetchPersonalPendingTramites(tenant_id, dni) {
    const cfg = await getPersonalIntegrationConfig(tenant_id);
    if (!cfg) {
        console.warn("[personal-integration] pending tramites skipped: integration not configured", {
            tenant_id,
            dni,
        });
        return [];
    }
    const url = `${cfg.base_url}/api/v1/pedidos?dni=${encodeURIComponent(String(dni))}&limit=20&page=1`;
    try {
        const res = await axios.get(url, {
            headers: {
                "x-api-key": cfg.api_key,
                "content-type": "application/json",
            },
            timeout: 15000,
        });
        const items = res?.data?.items;
        return Array.isArray(items) ? items : [];
    }
    catch (e) {
        console.warn("[personal-integration] fetch pending tramites failed", {
            tenant_id,
            dni,
            url,
            message: e?.message,
            status: e?.response?.status,
            data: e?.response?.data,
        });
        return [];
    }
}
export async function notifyPersonalApi(tenant_id, opts) {
    const cfg = await getPersonalIntegrationConfig(tenant_id);
    if (!cfg) {
        console.warn("[personal-integration] notify skipped: integration not configured", {
            tenant_id,
            personal_dni: opts.personal_dni,
            document_id: opts.document_id,
            scan_job_id: opts.scan_job_id,
            storage_key: opts.storage_key,
        });
        return false;
    }
    const url = `${cfg.base_url}/api/v1/scanner/document-ready`;
    const payload = {
        personal_dni: opts.personal_dni,
        personal_ref: opts.personal_ref || null,
        scanner_document_id: opts.document_id,
        scan_job_id: opts.scan_job_id,
        doc_class: opts.doc_class || "general",
        page_count: opts.page_count ?? null,
        storage_key: opts.storage_key,
        ocr_text: opts.ocr_text || undefined,
    };
    try {
        console.log("[personal-integration] notify start", {
            tenant_id,
            url,
            payload,
        });
        const res = await axios.post(url, payload, {
            headers: {
                "x-api-key": cfg.api_key,
                "content-type": "application/json",
            },
            timeout: 30000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            validateStatus: () => true,
        });
        if (res.status >= 200 && res.status < 300) {
            console.log("[personal-integration] notify ok", {
                tenant_id,
                url,
                status: res.status,
                document_id: opts.document_id,
                scan_job_id: opts.scan_job_id,
                personal_dni: opts.personal_dni,
                storage_key: opts.storage_key,
                response: res.data,
            });
            return true;
        }
        console.warn("[personal-integration] notify http error", {
            tenant_id,
            url,
            status: res.status,
            document_id: opts.document_id,
            scan_job_id: opts.scan_job_id,
            personal_dni: opts.personal_dni,
            storage_key: opts.storage_key,
            response: res.data,
        });
        return false;
    }
    catch (e) {
        console.warn("[personal-integration] notify failed", {
            tenant_id,
            url,
            message: e?.message,
            status: e?.response?.status,
            data: e?.response?.data,
            code: e?.code,
            document_id: opts.document_id,
            scan_job_id: opts.scan_job_id,
            personal_dni: opts.personal_dni,
            storage_key: opts.storage_key,
            payload,
        });
        return false;
    }
}
