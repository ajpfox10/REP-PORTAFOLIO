import { createWorker } from "tesseract.js";
import { storageWorker } from "../storage.js";
import { aiQueue } from "../queues.js";
export async function runOcrPipeline(pool, data) {
    const { tenant_id, document_id } = data;
    // 1) Cargar el documento
    const [docRows] = await pool.query("SELECT storage_key, mime_type, page_count FROM documents WHERE tenant_id=? AND id=?", [tenant_id, document_id]);
    const doc = docRows[0];
    if (!doc) {
        console.error("[ocr] document not found", document_id);
        return;
    }
    await pool.query("UPDATE documents SET updated_at=now() WHERE id=?", [document_id]);
    try {
        // 2) Cargar páginas del documento
        const [pageRows] = await pool.query("SELECT page_number, storage_key FROM document_pages WHERE tenant_id=? AND document_id=? ORDER BY page_number ASC", [tenant_id, document_id]);
        const pages = pageRows;
        let fullText = "";
        const worker = await createWorker("spa+eng"); // español + inglés por defecto
        for (const page of pages) {
            try {
                const buf = await storageWorker().get(page.storage_key);
                const { data: { text } } = await worker.recognize(buf);
                const cleaned = text.trim();
                // Guardar OCR por página
                await pool.query("UPDATE document_pages SET ocr_text=? WHERE tenant_id=? AND document_id=? AND page_number=?", [cleaned, tenant_id, document_id, page.page_number]);
                fullText += `\n--- Página ${page.page_number} ---\n${cleaned}`;
            }
            catch (e) {
                console.warn(`[ocr] page ${page.page_number} failed`, e?.message);
            }
        }
        await worker.terminate();
        // Si no hay páginas individuales, intentar el PDF completo
        if (!pages.length) {
            try {
                const buf = await storageWorker().get(doc.storage_key);
                const w = await createWorker("spa+eng");
                const { data: { text } } = await w.recognize(buf);
                fullText = text.trim();
                await w.terminate();
            }
            catch (e) {
                console.warn("[ocr] direct file ocr failed", e?.message);
            }
        }
        // 3) Guardar texto completo
        if (fullText.trim()) {
            await pool.query("UPDATE documents SET ocr_text=?, search_text=?, updated_at=now() WHERE tenant_id=? AND id=?", [fullText.trim(), fullText.trim(), tenant_id, document_id]);
        }
        // 4) Encolar pipeline de AI
        await aiQueue.add("ai_job", { tenant_id, document_id }, { priority: 5 });
        console.log(`[ocr] document ${document_id} done, ${fullText.length} chars`);
    }
    catch (e) {
        console.error("[ocr] pipeline error", e?.message);
        await pool.query("UPDATE documents SET updated_at=now() WHERE tenant_id=? AND id=?", [tenant_id, document_id]);
    }
}
