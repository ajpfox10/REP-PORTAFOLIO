// routes/documents.ts — Documentos: CRUD, búsqueda, descarga, soft-delete
import { Router } from "express";
import { validate } from "../validate.js";
import { searchSchema, paginationSchema } from "../../shared/index.js";
import { pool } from "../../db/mysql.js";
import { storage } from "../../services/storage.js";
import { ApiError } from "../errorHandler.js";
const r = Router();
// ── GET /v1/documents — listar con filtros ────────────────────────────────────
r.get("/", validate(paginationSchema, "query"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const { limit, cursor } = req.query;
    const dni = req.query.personal_dni ? Number(req.query.personal_dni) : undefined;
    const doc_class = req.query.doc_class;
    const job_id = req.query.scan_job_id ? Number(req.query.scan_job_id) : undefined;
    let sql = "SELECT id,title,doc_class,mime_type,page_count,personal_dni,personal_ref,storage_key,created_at FROM documents WHERE tenant_id=? AND deleted_at IS NULL AND id>?";
    const params = [tenant_id, cursor];
    if (dni) {
        sql += " AND personal_dni=?";
        params.push(dni);
    }
    if (doc_class) {
        sql += " AND doc_class=?";
        params.push(doc_class);
    }
    if (job_id) {
        sql += " AND scan_job_id=?";
        params.push(job_id);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);
    const [rows] = await pool.query(sql, params);
    const items = rows;
    res.json({ items, next_cursor: items.at(-1)?.id || cursor });
});
// ── GET /v1/documents/search ──────────────────────────────────────────────────
r.get("/search", validate(searchSchema, "query"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const { q, personal_dni, doc_class, limit } = req.query;
    let sql = `SELECT id,title,doc_class,personal_dni,personal_ref,page_count,created_at,
             MATCH(search_text) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
             FROM documents WHERE tenant_id=? AND deleted_at IS NULL
             AND MATCH(search_text) AGAINST(? IN NATURAL LANGUAGE MODE)`;
    const params = [q, tenant_id, q];
    if (personal_dni) {
        sql += " AND personal_dni=?";
        params.push(Number(personal_dni));
    }
    if (doc_class) {
        sql += " AND doc_class=?";
        params.push(doc_class);
    }
    sql += " ORDER BY relevance DESC LIMIT ?";
    params.push(Number(limit));
    const [rows] = await pool.query(sql, params);
    res.json({ items: rows, query: q });
});
// ── GET /v1/documents/:id ─────────────────────────────────────────────────────
r.get("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT * FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL", [tenant_id, id]);
    const doc = rows[0];
    if (!doc)
        throw new ApiError(404, "document_not_found");
    // Parse extracted_json si viene como string
    if (typeof doc.extracted_json === "string") {
        try {
            doc.extracted_json = JSON.parse(doc.extracted_json);
        }
        catch { }
    }
    // Cargar páginas
    const [pageRows] = await pool.query("SELECT page_number, storage_key, qr_payload, is_blank FROM document_pages WHERE tenant_id=? AND document_id=? ORDER BY page_number ASC", [tenant_id, id]);
    doc.pages = pageRows;
    res.json(doc);
});
// ── GET /v1/documents/:id/ocr — obtener texto OCR ────────────────────────────
r.get("/:id/ocr", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT id, ocr_text, doc_class, extracted_json FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL", [tenant_id, id]);
    const doc = rows[0];
    if (!doc)
        throw new ApiError(404, "document_not_found");
    res.json(doc);
});
// ── GET /v1/documents/files/:key* — descargar archivo ─────────────────────────
r.get("/files/:key(*)", async (req, res) => {
    const tenant_id = req.tenant_id;
    const key = req.params.key;
    // Verificar que el key pertenece al tenant
    const [rows] = await pool.query("SELECT mime_type, title FROM documents WHERE tenant_id=? AND storage_key=? AND deleted_at IS NULL", [tenant_id, key]);
    // También buscar en páginas
    const [pageRows] = await pool.query("SELECT dp.storage_key FROM document_pages dp JOIN documents d ON d.id=dp.document_id WHERE d.tenant_id=? AND dp.storage_key=?", [tenant_id, key]);
    const doc = rows[0];
    const isPage = !!pageRows[0];
    if (!doc && !isPage)
        throw new ApiError(403, "access_denied");
    try {
        const buf = await storage().get(key);
        const ct = doc?.mime_type || "application/octet-stream";
        const filename = doc?.title ? encodeURIComponent(doc.title) : "document";
        res.setHeader("content-type", ct);
        res.setHeader("content-disposition", `inline; filename="${filename}"`);
        res.setHeader("content-length", buf.length);
        res.send(buf);
    }
    catch {
        throw new ApiError(404, "file_not_found");
    }
});
// ── PATCH /v1/documents/:id — actualizar título / ref ─────────────────────────
r.patch("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const { title, personal_ref } = req.body || {};
    const [rows] = await pool.query("SELECT id FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL", [tenant_id, id]);
    if (!rows.length)
        throw new ApiError(404, "document_not_found");
    await pool.query("UPDATE documents SET title=COALESCE(?,title), personal_ref=COALESCE(?,personal_ref), updated_at=now() WHERE tenant_id=? AND id=?", [title || null, personal_ref || null, tenant_id, id]);
    res.json({ ok: true });
});
// ── DELETE /v1/documents/:id — soft delete ────────────────────────────────────
r.delete("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT storage_key FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL", [tenant_id, id]);
    if (!rows.length)
        throw new ApiError(404, "document_not_found");
    await pool.query("UPDATE documents SET deleted_at=now(), updated_at=now() WHERE tenant_id=? AND id=?", [tenant_id, id]);
    res.json({ ok: true });
});
export default r;
