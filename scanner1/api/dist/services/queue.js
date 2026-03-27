// queue.ts — Cola sin Redis, usando MySQL como backend
// BullMQ reemplazado por polling a scan_jobs + procesamiento inline.
// Compatible con la misma interfaz que usaban los routes.
import { pool } from "../db/mysql.js";
import { deliverWebhookToSubscribers } from "./webhook.js";
import { notifyPersonalApi } from "./personalIntegration.js";
// ── Interfaz mínima compatible con BullMQ Queue ───────────────────────────────
class MySQLQueue {
    name;
    constructor(name) { this.name = name; }
    async add(_jobName, data, _opts) {
        if (this.name === "scan_queue") {
            const { scan_job_id, tenant_id } = data;
            if (scan_job_id && data.storage_keys) {
                setImmediate(() => runPipeline(tenant_id, scan_job_id, data).catch(console.error));
            }
        }
        return { id: String(data.scan_job_id || Date.now()) };
    }
}
export const scanQueue = new MySQLQueue("scan_queue");
export const ocrQueue = new MySQLQueue("ocr_queue");
export const aiQueue = new MySQLQueue("ai_queue");
export const indexQueue = new MySQLQueue("index_queue");
async function runPipeline(tenant_id, scan_job_id, data) {
    try {
        // 1. Crear documento
        const storage_key = data.storage_keys[0] || "";
        const [docResult] = await pool.query(`INSERT INTO documents
         (tenant_id, scan_job_id, storage_key, mime_type, page_count,
          doc_class, personal_dni, personal_ref, created_at)
       VALUES (?,?,?,'application/pdf',?,'unknown',?,?,now())`, [tenant_id, scan_job_id, storage_key, data.page_count,
            data.personal_dni || null, data.personal_ref || null]);
        const doc_id = Number(docResult.insertId);
        // 2. Registrar páginas
        for (let i = 0; i < data.storage_keys.length; i++) {
            await pool.query("INSERT INTO document_pages (tenant_id,document_id,page_number,storage_key,created_at) VALUES (?,?,?,?,now())", [tenant_id, doc_id, i + 1, data.storage_keys[i]]).catch(() => { });
        }
        // 3. Clasificar por referencia
        let doc_class = "general";
        const ref = (data.personal_ref || "").toLowerCase();
        if (/dni|documento|identidad/.test(ref))
            doc_class = "identificacion";
        else if (/jubil|pension/.test(ref))
            doc_class = "jubilacion";
        else if (/legajo|expediente/.test(ref))
            doc_class = "legajo";
        else if (/certificado|cert/.test(ref))
            doc_class = "certificado";
        else if (/titulo|diploma/.test(ref))
            doc_class = "titulo";
        else if (/recibo|sueldo/.test(ref))
            doc_class = "recibo_sueldo";
        else if (/pedido|solicitud/.test(ref))
            doc_class = "solicitud";
        // 4. Actualizar documento con clase
        await pool.query("UPDATE documents SET doc_class=?, search_text=? WHERE id=?", [doc_class, `${data.personal_ref || ""} ${doc_class}`.trim(), doc_id]);
        // 5. Notificar a api_personal
        if (data.personal_dni) {
            await notifyPersonalApi(tenant_id, {
                personal_dni: data.personal_dni,
                personal_ref: data.personal_ref || undefined,
                document_id: doc_id,
                scan_job_id,
                doc_class,
                page_count: data.page_count,
                storage_key,
            });
        }
        // 6. Marcar job completado
        await pool.query("UPDATE scan_jobs SET status='completed', page_count=?, completed_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [data.page_count, tenant_id, scan_job_id]);
        await deliverWebhookToSubscribers(tenant_id, "scan.completed", {
            scan_job_id, document_id: doc_id, doc_class, page_count: data.page_count,
        });
        console.log(`[queue] ✅ job ${scan_job_id} → doc ${doc_id} (${doc_class}, ${data.page_count}p)`);
    }
    catch (e) {
        console.error(`[queue] ❌ job ${scan_job_id} pipeline error:`, e?.message);
        await pool.query("UPDATE scan_jobs SET status='failed', error_message=?, updated_at=now() WHERE tenant_id=? AND id=?", [e?.message || "pipeline_error", tenant_id, scan_job_id]).catch(() => { });
    }
}
