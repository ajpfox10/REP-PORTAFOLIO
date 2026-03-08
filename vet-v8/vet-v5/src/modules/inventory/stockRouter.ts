import { nanoid } from "nanoid";
import { Router } from "express";
import { z } from "zod";
import { appendAudit } from "../../audit/auditRepo.js";

const MoveIn = z.object({
  product_id: z.string().min(1),
  qty_delta: z.coerce.number().int(), // positive or negative
  reason: z.string().min(1).max(200),
});

export function buildStockRouter() {
  const router = Router();

  router.get("/levels", async (req, res, next) => {
    try {
      const pool = (req as any).ctx.tenantPool;
      const [rows] = await pool.query(
        `SELECT p.id, p.sku, p.name, COALESCE(SUM(m.qty_delta),0) as stock
         FROM inv_products p
         LEFT JOIN inv_stock_moves m ON m.product_id=p.id
         GROUP BY p.id, p.sku, p.name
         ORDER BY p.name ASC`
      ) as any[];
      return res.json(rows);
    } catch (e) { return next(e); }
  });

  router.post("/moves", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pool = ctx.tenantPool;
      const tenantId = ctx.tenantId;
      const userId = ctx.userId;

      const input = MoveIn.parse(req.body);
      const id = nanoid();
      await pool.query(
        `INSERT INTO inv_stock_moves (id, product_id, qty_delta, reason, created_at, created_by) VALUES (?,?,?,?,NOW(),?)`,
        [id, input.product_id, input.qty_delta, input.reason, userId]
      );
      await appendAudit(pool, { tenantId, userId, action: "inventory.stock.move", entity: "inv_stock_moves", entity_id: id, metadata: input });
      return res.status(201).json({ id });
    } catch (e) { return next(e); }
  });

  return router;
}

