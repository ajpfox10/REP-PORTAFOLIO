import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { requireModule } from "../../infra/plan-limits/planGuard.js";
import { toCents, fromCents, calcIva } from "../../infra/money/money.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

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
    precio_unitario: z.coerce.number().min(0),  // en ARS (no centavos)
    iva_pct: z.coerce.number().min(0).max(100).default(21),
  })).min(1),
});

export function buildFacturacionRouter(opts: { featureFlags?: any } = {}) {
  const router = Router();

  router.use(requireModule("facturacion", opts));

  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
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
      const ctx = getCtx(req);
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
      const ctx = getCtx(req);
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("receptionist")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const body = FacturaIn.parse(req.body ?? {});

      // FIX: usar enteros (centavos) para evitar floating point errors
      let subtotalCents = 0;
      let ivaCents = 0;
      for (const item of body.items) {
        const sub = toCents(item.cantidad * item.precio_unitario);
        subtotalCents += sub;
        ivaCents += calcIva(sub, item.iva_pct);
      }
      const totalCents = subtotalCents + ivaCents;

      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO facturas (tenant_id, sucursal_id, propietario_id, consulta_id, tipo, estado,
                               subtotal, iva_total, total, notas, vencimiento)
         VALUES (?,?,?,?,?, 'borrador', ?,?,?,?,?)`,
        [ctx.tenantId, body.sucursal_id ?? null, body.propietario_id ?? null,
         body.consulta_id ?? null, body.tipo,
         fromCents(subtotalCents), fromCents(ivaCents), fromCents(totalCents),
         body.notas ?? null, body.vencimiento ?? null]
      );
      const id = Number(result.insertId);

      for (const item of body.items) {
        const sub = toCents(item.cantidad * item.precio_unitario);
        await ctx.tenantPool.query(
          `INSERT INTO factura_items (tenant_id, factura_id, producto_id, descripcion,
                                      cantidad, precio_unitario, iva_pct, subtotal)
           VALUES (?,?,?,?,?,?,?,?)`,
          [ctx.tenantId, id, item.producto_id ?? null, item.descripcion,
           item.cantidad, item.precio_unitario, item.iva_pct, fromCents(sub)]
        );
      }

      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "facturas", resource_id: String(id),
        after_json: { tipo: body.tipo, total_cents: totalCents },
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({
        data: { id, total: fromCents(totalCents) },
        meta: { requestId: (req as any).id }, errors: []
      });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/facturacion/:id/emitir
   * FIX: body ya no referenciado — se carga desde DB
   * FIX: numeración correlativa por tipo+sucursal usando tabla factura_numeracion
   */
  router.post("/:id/emitir", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("receptionist")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const id = Number(req.params.id);

      // FIX: cargar la factura desde DB (body no existe en este scope)
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, estado, tipo, sucursal_id FROM facturas WHERE id=? AND tenant_id=? LIMIT 1",
        [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Factura no encontrada");
      if (rows[0].estado !== "borrador") {
        throw new AppError("CONFLICT", "Solo se pueden emitir facturas en borrador");
      }

      const factura = rows[0];

      // FIX: numeración correlativa real usando transacción con lock
      const conn = await ctx.tenantPool.getConnection();
      let numero: string;
      try {
        await conn.beginTransaction();

        // Tabla de numeración por punto de venta + tipo
        await conn.query(`
          CREATE TABLE IF NOT EXISTS factura_numeracion (
            tenant_id   VARCHAR(64) NOT NULL,
            tipo        VARCHAR(16) NOT NULL,
            punto_venta INT         NOT NULL DEFAULT 1,
            ultimo_num  INT         NOT NULL DEFAULT 0,
            PRIMARY KEY (tenant_id, tipo, punto_venta)
          )
        `);

        const puntoVenta = factura.sucursal_id ?? 1;
        await conn.query(
          `INSERT INTO factura_numeracion (tenant_id, tipo, punto_venta, ultimo_num)
           VALUES (?,?,?,1)
           ON DUPLICATE KEY UPDATE ultimo_num = ultimo_num + 1`,
          [ctx.tenantId, factura.tipo, puntoVenta]
        );
        const [[numRow]] = await conn.query<any[]>(
          "SELECT ultimo_num FROM factura_numeracion WHERE tenant_id=? AND tipo=? AND punto_venta=? FOR UPDATE",
          [ctx.tenantId, factura.tipo, puntoVenta]
        );
        // Formato AFIP: XXXX-XXXXXXXX (punto_venta 4 dígitos - número 8 dígitos)
        numero = `${factura.tipo}-${String(puntoVenta).padStart(4, "0")}-${String(numRow.ultimo_num).padStart(8, "0")}`;

        await conn.query(
          "UPDATE facturas SET estado='emitida', emitida_at=NOW(), numero=? WHERE id=? AND tenant_id=?",
          [numero, id, ctx.tenantId]
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      // AFIP integration hook — enterprise plan
      let afipCae: string | null = null;
      const afipEnabled = await opts.featureFlags?.isEnabled(
        ctx.tenantId, "module:afip_facturacion", false
      ).catch(() => false);
      if (afipEnabled) {
        // TODO: Wire WSFE via @afipsdk o SOAP client
        afipCae = `STUB-CAE-${nanoid(8).toUpperCase()}`;
      }

      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "factura_emitida", resource: "facturas", resource_id: String(id),
        after_json: { numero, afipCae },
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.json({ data: { ok: true, numero, afipCae }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/:id/pagar", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const id = Number(req.params.id);
      const { metodo_pago = "efectivo" } = req.body ?? {};

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT estado FROM facturas WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Factura no encontrada");
      if (!["borrador", "emitida"].includes(rows[0].estado)) {
        throw new AppError("CONFLICT", `Factura en estado "${rows[0].estado}" no puede marcarse como pagada`);
      }

      await ctx.tenantPool.query(
        "UPDATE facturas SET estado='pagada', updated_at=NOW() WHERE id=? AND tenant_id=?",
        [id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "factura_pagada", resource: "facturas", resource_id: String(id),
        after_json: { metodo_pago },
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** DELETE /api/v1/facturacion/:id — anular (solo borrador) */
  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const id = Number(req.params.id);
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT estado FROM facturas WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Factura no encontrada");
      if (rows[0].estado === "pagada") throw new AppError("CONFLICT", "No se puede anular una factura pagada");
      await ctx.tenantPool.query(
        "UPDATE facturas SET estado='anulada', updated_at=NOW() WHERE id=? AND tenant_id=?",
        [id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "factura_anulada", resource: "facturas", resource_id: String(id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
