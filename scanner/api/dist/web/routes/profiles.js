import { Router } from "express";
import { validate } from "../validate.js";
import { createProfileSchema, paginationSchema } from "../../shared/index.js";
import { pool } from "../../db/mysql.js";
import { ApiError } from "../errorHandler.js";
const r = Router();
r.get("/", validate(paginationSchema, "query"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const [rows] = await pool.query("SELECT * FROM scan_profiles WHERE tenant_id=? ORDER BY id ASC", [tenant_id]);
    res.json({ items: rows });
});
r.post("/", validate(createProfileSchema, "body"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const b = req.body;
    const [result] = await pool.query(`INSERT INTO scan_profiles (tenant_id,name,dpi,color,auto_rotate,blank_page_detection,compression,output_format,created_at)
     VALUES (?,?,?,?,?,?,?,?,now())`, [tenant_id, b.name, b.dpi, b.color ? 1 : 0, b.auto_rotate ? 1 : 0, b.blank_page_detection ? 1 : 0, b.compression, b.output_format]);
    res.status(201).json({ id: Number(result.insertId) });
});
r.put("/:id", validate(createProfileSchema, "body"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const b = req.body;
    const [rows] = await pool.query("SELECT id FROM scan_profiles WHERE tenant_id=? AND id=?", [tenant_id, id]);
    if (!rows.length)
        throw new ApiError(404, "profile_not_found");
    await pool.query(`UPDATE scan_profiles SET name=?,dpi=?,color=?,auto_rotate=?,blank_page_detection=?,compression=?,output_format=?,updated_at=now()
     WHERE tenant_id=? AND id=?`, [b.name, b.dpi, b.color ? 1 : 0, b.auto_rotate ? 1 : 0, b.blank_page_detection ? 1 : 0, b.compression, b.output_format, tenant_id, id]);
    res.json({ ok: true });
});
r.delete("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    await pool.query("DELETE FROM scan_profiles WHERE tenant_id=? AND id=?", [tenant_id, id]);
    res.json({ ok: true });
});
export default r;
