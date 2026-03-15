import { ocrQueue } from "../queues.js";
import { deliverWebhookToSubscribersFromWorker } from "../webhookClient.js";
import { notifyPersonalApiFromWorker } from "../personalClient.js";
export async function runScanFinalize(pool, data) {
    const { tenant_id, scan_job_id, storage_keys, page_count, personal_dni, personal_ref } = data;
    await pool.query("UPDATE scan_jobs SET status='in_progress', started_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [tenant_id, scan_job_id]);
    try {
        const primaryKey = storage_keys?.[0];
        if (!primaryKey)
            throw new Error("no storage_keys in finalize payload");
        const [result] = await pool.query(`INSERT INTO documents (tenant_id,scan_job_id,storage_key,mime_type,page_count,personal_dni,personal_ref,created_at)
       VALUES (?,?,?,'application/pdf',?,?,?,now())`, [tenant_id, scan_job_id, primaryKey, page_count || null, personal_dni || null, personal_ref || null]);
        const document_id = Number(result.insertId);
        if (storage_keys?.length > 1) {
            for (let i = 1; i < storage_keys.length; i++) {
                await pool.query(`INSERT INTO document_pages (tenant_id,document_id,page_number,storage_key,created_at)
           VALUES (?,?,?,?,now())`, [tenant_id, document_id, i, storage_keys[i]]);
            }
        }
        await pool.query("UPDATE scan_jobs SET status='completed', page_count=?, completed_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [page_count || null, tenant_id, scan_job_id]);
        // NOTIFICAR A APIPERSONAL SI HAY DNI VINCULADO
        if (personal_dni) {
            await notifyPersonalApiFromWorker(pool, tenant_id, {
                personal_dni,
                personal_ref: personal_ref || null,
                document_id,
                scan_job_id,
                doc_class: "unknown",
                page_count: page_count || null,
                storage_key: primaryKey,
                ocr_text: undefined,
            });
        }
        const ocrProvider = process.env.OCR_PROVIDER || "none";
        if (ocrProvider !== "none") {
            await ocrQueue.add("ocr_job", { tenant_id, document_id }, { priority: 8 });
            console.log(`[finalize] job ${scan_job_id} → doc ${document_id} → queued OCR`);
        }
        else {
            console.log(`[finalize] job ${scan_job_id} → doc ${document_id} (OCR disabled)`);
        }
        await deliverWebhookToSubscribersFromWorker(pool, tenant_id, "scan.completed", {
            scan_job_id,
            document_id,
            page_count,
            personal_dni: personal_dni || null,
        });
        await deliverWebhookToSubscribersFromWorker(pool, tenant_id, "document.created", {
            document_id,
            scan_job_id,
            personal_dni: personal_dni || null,
        });
    }
    catch (e) {
        console.error("[finalize] error", e?.message);
        await pool.query("UPDATE scan_jobs SET status='failed', error_message=?, completed_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [e?.message || "finalize_error", tenant_id, scan_job_id]);
        await deliverWebhookToSubscribersFromWorker(pool, tenant_id, "scan.failed", {
            scan_job_id, error: e?.message
        });
    }
}
