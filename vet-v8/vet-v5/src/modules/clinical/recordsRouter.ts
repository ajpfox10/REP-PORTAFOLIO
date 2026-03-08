import { nanoid } from "nanoid";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

const RecordIn = z.object({
  visit_id: z.string().min(1),
  type: z.enum(["soap", "note", "prescription", "vaccine", "lab"]),
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1),
  attachments: z.array(z.string().min(1)).default([]), // file ids
});

export function buildClinicalRecordsRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pool = ctx.tenantPool;
      const visitId = String(req.query.visit_id || "");
      if (!visitId) throw new AppError("BAD_REQUEST", "visit_id requerido", 400);
      const [rows] = await pool.query(`SELECT * FROM clinical_records WHERE visit_id=? ORDER BY created_at DESC`, [visitId]) as any[];
      return res.json(rows);
    } catch (e) { return next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pool = ctx.tenantPool;
      const userId = ctx.userId;
      const tenantId = ctx.tenantId;

      const input = RecordIn.parse(req.body);
      const id = nanoid();
      await pool.query(
        `INSERT INTO clinical_records (id, visit_id, type, title, body, attachments_json, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,NOW())`,
        [id, input.visit_id, input.type, input.title ?? null, input.body, JSON.stringify(input.attachments), userId]
      );

      await appendAudit(pool, { tenantId, userId, action: "clinical.record.create", entity: "clinical_records", entity_id: id, metadata: { visit_id: input.visit_id, type: input.type } });
      return res.status(201).json({ id });
    } catch (e) { return next(e); }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pool = ctx.tenantPool;
      const userId = ctx.userId;
      const tenantId = ctx.tenantId;
      const id = req.params.id;

      await pool.query(`DELETE FROM clinical_records WHERE id=?`, [id]);
      await appendAudit(pool, { tenantId, userId, action: "clinical.record.delete", entity: "clinical_records", entity_id: id });
      return res.json({ ok: true });
    } catch (e) { return next(e); }
  });

  return router;
}

