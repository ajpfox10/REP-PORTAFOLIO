import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

const SaleIn = z.object({
  propietario_id: z.coerce.number().int().positive().optional().nullable(),
  customer_name: z.string().min(1).max(200).optional().nullable(),
  items: z.array(z.object({
    producto_id: z.coerce.number().int().positive(),
    qty: z.coerce.number().int().min(1),
    unit_price_cents: z.coerce.number().int().min(0).optional(),
  })).min(1),
});

export function buildSalesRouter() {
  const router = Router();

  /** GET /api/v1/sales */
  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);
      const page  = Math.max(Number(req.query.page  ?? 1), 1);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT so.id, so.customer_name, so.total_cents, so.status, so.created_at,
                pr.nombre as propietario_nombre, pr.apellido as propietario_apellido
         FROM sales_orders so
         LEFT JOIN propietarios pr ON pr.id=so.propietario_id
         WHERE so.tenant_id=?
         ORDER BY so.created_at DESC LIMIT ? OFFSET ?`,
        [ctx.tenantId, limit, offset]
      );
      res.json(ok(rows, rid, { page, limit }));
    } catch (e) { next(e); }
  });

  /** GET /api/v1/sales/:id — FIX: endpoint faltante en v5 */
  router.get("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);
      const id  = String(req.params.id);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT so.*, pr.nombre as propietario_nombre, pr.apellido as propietario_apellido
         FROM sales_orders so
         LEFT JOIN propietarios pr ON pr.id=so.propietario_id
         WHERE so.id=? AND so.tenant_id=? LIMIT 1`,
        [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Venta no encontrada");

      const [items] = await ctx.tenantPool.query<any[]>(
        `SELECT soi.*, p.nombre as producto_nombre
         FROM sales_order_items soi
         LEFT JOIN productos p ON p.id=soi.producto_id
         WHERE soi.order_id=?`,
        [id]
      );
      res.json(ok({ ...rows[0], items }, rid));
    } catch (e) { next(e); }
  });

  /** POST /api/v1/sales */
  router.post("/", async (req, res, next) => {
    try {
      const ctx   = getCtx(req);
      const rid   = getRequestId(req);
      const roles = ctx.roles ?? [];

      if (!roles.includes("admin") && !roles.includes("receptionist") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }

      const input  = SaleIn.parse(req.body ?? {});
      const orderId = nanoid();
      let total    = 0;

      const conn = await ctx.tenantPool.getConnection();
      try {
        await conn.beginTransaction();

        for (const it of input.items) {
          const [prod] = await conn.query<any[]>(
            "SELECT id, nombre, precio, stock FROM productos WHERE id=? AND tenant_id=? AND is_active=1 FOR UPDATE",
            [it.producto_id, ctx.tenantId]
          );
          if (!prod?.length) throw new AppError("NOT_FOUND", `Producto ${it.producto_id} no encontrado`);
          if (prod[0].stock < it.qty) {
            throw new AppError("CONFLICT", `Stock insuficiente para "${prod[0].nombre}": disponible ${prod[0].stock}`);
          }
          const unitPrice = it.unit_price_cents ?? Math.round(Number(prod[0].precio) * 100);
          total += it.qty * unitPrice;
          it.unit_price_cents = unitPrice;
        }

        await conn.query(
          "INSERT INTO sales_orders (id, tenant_id, propietario_id, customer_name, total_cents, status, created_at, created_by) VALUES (?,?,?,?,?,'paid',NOW(),?)",
          [orderId, ctx.tenantId, input.propietario_id ?? null, input.customer_name ?? null, total, ctx.userId]
        );

        for (const it of input.items) {
          await conn.query(
            "INSERT INTO sales_order_items (id, order_id, producto_id, qty, unit_price_cents) VALUES (?,?,?,?,?)",
            [nanoid(), orderId, it.producto_id, it.qty, it.unit_price_cents]
          );
          await conn.query(
            "UPDATE productos SET stock=stock-?, updated_at=NOW() WHERE id=? AND tenant_id=?",
            [it.qty, it.producto_id, ctx.tenantId]
          );
          await conn.query(
            `INSERT INTO stock_movimientos (id, tenant_id, producto_id, tipo, cantidad, stock_post, referencia, actor_user_id)
             VALUES (?,?,?,'venta',?,(SELECT stock FROM productos WHERE id=? AND tenant_id=?),?,?)`,
            [nanoid(), ctx.tenantId, it.producto_id, -it.qty, it.producto_id, ctx.tenantId, `sale:${orderId}`, ctx.userId]
          );
        }

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId ?? "",
        action: "sales.order.create", resource: "sales_orders", resource_id: orderId,
        after_json: { total_cents: total, items: input.items.length },
        ip: req.ip ?? "", user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: rid,
      });

      return res.status(201).json(ok({ id: orderId, total_cents: total }, rid));
    } catch (e) { next(e); }
  });

  return router;
}
