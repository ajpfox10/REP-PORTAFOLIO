import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { requireModule } from "../../infra/plan-limits/planGuard.js";

const FacturaIn = z.object({
  propietario_id: z.coerce.number().int().positive().optional().nullable(),
  consulta_id: z.coerce.number().int().positive().optional().nullable(),
  sucursal_id: z.coerce.number().int().positive().optional().nullable(),
  tipo: z.enum(["A", "B", "C", "X", "presupuesto"]).default("B"),
  notas: z.string().max(2000).optional().nullable(),
  vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  items: z.array(z.object({
    producto_id: z.coerce.number().int().positive().optional().nullable(),
    descripcion: z.string().min(1).max(255),
    cantidad: z.coerce.number().min(0.001).max(999999),
    precio_unitario: z.coerce.number().min(0),
    iva_pct: z.coerce.number().min(0).max(100).default(21),
  })).min(1),
});

export function buildFacturacionRouter(opts: { featureFlags?: any } = {}) {
  const router = Router();

  // Basic invoicing — plan: pro+
  router.use(requireModule("facturacion", opts));

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;
      const estado = req.query.estado ? String(req.query.estado) : null;

      const conditions = ["f.tenant_id=?"];
      const params: any[] = [ctx.tenantId];
      if (estado) { conditions.push("f.estado=?"); params.push(estado); }
      params.push(limit, offset);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT f.id, f.numero, f.tipo, f.estado, f.total, f.moneda, f.emitida_at, f.created_at,
                pr.nombre as propietario_nombre, pr.apellido as propietario_apellido
         FROM facturas f
         LEFT JOIN propietarios pr ON pr.id=f.propietario_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
        params
      );
      res.json({ data: rows, meta: { requestId: (req as any).id, page, limit }, errors: [] });
    } catch (e) { next(e); }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const id = Number(req.params.id);
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM facturas WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Factura no encontrada");
      const [items] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM factura_items WHERE factura_id=?", [id]
      );
      res.json({ data: { ...rows[0], items }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("receptionist")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const body = FacturaIn.parse(req.body ?? {});

      // Calculate totals
      let subtotal = 0;
      let ivaTotal = 0;
      for (const item of body.items) {
        const sub = item.cantidad * item.precio_unitario;
        subtotal += sub;
        ivaTotal += sub * (item.iva_pct / 100);
      }
      const total = subtotal + ivaTotal;

      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO facturas (tenant_id, sucursal_id, propietario_id, consulta_id, tipo, estado, subtotal, iva_total, total, notas, vencimiento)
         VALUES (?,?,?,?,?,  'borrador',?,?,?,?,?)`,
        [ctx.tenantId, body.sucursal_id ?? null, body.propietario_id ?? null, body.consulta_id ?? null,
         body.tipo, subtotal.toFixed(2), ivaTotal.toFixed(2), total.toFixed(2), body.notas ?? null, body.vencimiento ?? null]
      );
      const id = Number(result.insertId);

      for (const item of body.items) {
        const sub = item.cantidad * item.precio_unitario;
        await ctx.tenantPool.query(
          `INSERT INTO factura_items (tenant_id, factura_id, producto_id, descripcion, cantidad, precio_unitario, iva_pct, subtotal)
           VALUES (?,?,?,?,?,?,?,?)`,
          [ctx.tenantId, id, item.producto_id ?? null, item.descripcion,
           item.cantidad, item.precio_unitario.toFixed(2), item.iva_pct, sub.toFixed(2)]
        );
      }

      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "facturas", resource_id: String(id),
        after_json: { tipo: body.tipo, total }, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.status(201).json({ data: { id, total: total.toFixed(2) }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** POST /api/v1/facturacion/:id/emitir — emit invoice (changes estado to emitida) */
  router.post("/:id/emitir", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("receptionist")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const id = Number(req.params.id);
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT estado FROM facturas WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Factura no encontrada");
      if (rows[0].estado !== "borrador") throw new AppError("CONFLICT", "Solo se pueden emitir facturas en borrador");

      // AFIP integration hook — enterprise plan
      const afipEnabled = await (opts.featureFlags?.isEnabled(ctx.tenantId, "module:afip_facturacion", false).catch(() => false));
      let afipCae = null;
      if (afipEnabled) {
        // TODO: Wire WSFE/WSFEX via @afipsdk or custom SOAP client
        afipCae = `STUB-CAE-${nanoid(8).toUpperCase()}`;
      }

      const numero = `${body.tipo ?? "B"}-${String(id).padStart(8, "0")}`;
      await ctx.tenantPool.query(
        "UPDATE facturas SET estado='emitida', emitida_at=NOW(), numero=? WHERE id=? AND tenant_id=?",
        [numero, id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "factura_emitida", resource: "facturas", resource_id: String(id),
        after_json: { numero, afipCae }, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true, numero, afipCae }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** POST /api/v1/facturacion/:id/pagar */
  router.post("/:id/pagar", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const id = Number(req.params.id);
      const { metodo_pago = "efectivo" } = req.body ?? {};

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT estado FROM facturas WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Factura no encontrada");
      if (!["borrador","emitida"].includes(rows[0].estado)) {
        throw new AppError("CONFLICT", `Factura en estado ${rows[0].estado} no puede marcarse como pagada`);
      }

      await ctx.tenantPool.query(
        "UPDATE facturas SET estado='pagada', updated_at=NOW() WHERE id=? AND tenant_id=?",
        [id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "factura_pagada", resource: "facturas", resource_id: String(id),
        after_json: { metodo_pago }, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
