// worker/personalClient.ts — Notifica al backend api_personal desde el worker
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
function post(url, body, apiKey) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const fn = u.protocol === "https:" ? httpsRequest : httpRequest;
        const req = fn({
            hostname: u.hostname, port: u.port,
            path: u.pathname + u.search,
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "x-scanner-version": "3.0",
            }
        }, (res) => {
            res.resume();
            res.on("end", () => resolve((res.statusCode ?? 0) < 300));
        });
        req.on("error", () => resolve(false));
        req.setTimeout(5000, () => { req.destroy(); resolve(false); });
        req.write(body);
        req.end();
    });
}
export async function notifyPersonalApiFromWorker(pool, tenant_id, opts) {
    try {
        const [rows] = await pool.query("SELECT base_url, api_key FROM personal_integration WHERE tenant_id=? AND is_enabled=1", [tenant_id]);
        const cfg = rows[0];
        if (!cfg)
            return;
        const body = JSON.stringify({
            scanner_document_id: opts.document_id,
            scanner_job_id: opts.scan_job_id,
            personal_dni: opts.personal_dni,
            personal_ref: opts.personal_ref || null,
            doc_class: opts.doc_class,
            page_count: opts.page_count,
            storage_key: opts.storage_key,
            ocr_summary: opts.ocr_text ? opts.ocr_text.slice(0, 500) : null,
        });
        const ok = await post(`${cfg.base_url}/api/v1/scanner/document-ready`, body, cfg.api_key);
        if (!ok)
            console.warn("[personal-client] notify failed for doc", opts.document_id);
    }
    catch (e) {
        console.warn("[personal-client] error", e?.message);
    }
}
