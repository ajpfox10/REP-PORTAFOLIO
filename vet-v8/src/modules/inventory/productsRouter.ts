import { nanoid } from "nanoid";
import { Router } from "express";
import { z } from "zod";
import { appendAudit } from "../../audit/auditRepo.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

const ProductIn = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  price_cents: z.coerce.number().int().min(0),
  active: z.coerce.boolean().default(true),
});

export function buildProductsRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const pool = getCtx(req).tenantPool;
      const [rows] = await pool.query(`SELECT * FROM inv_products ORDER BY name ASC`) as any[];
      return res.json(rows);
    } catch (e) { return next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const pool = ctx.tenantPool;
      const tenantId = ctx.tenantId;
      const userId = ctx.userId;

      const input = ProductIn.parse(req.body);
      const id = nanoid();
      await pool.query(
        `INSERT INTO inv_products (id, sku, name, price_cents, active, created_at, created_by) VALUES (?,?,?,?,?,NOW(),?)`,
        [id, input.sku, input.name, input.price_cents, input.active ? 1 : 0, userId]
      );
      await appendAudit(pool, { tenantId, userId, action: "inventory.product.create", entity: "inv_products", entity_id: id, metadata: { sku: input.sku } });
      return res.status(201).json({ id });
    } catch (e) { return next(e); }
  });

  return router;
}

