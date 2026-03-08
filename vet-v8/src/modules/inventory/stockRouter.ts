/**
 * stockRouter — v11  (Punto 7)
 *
 * Stock avanzado:
 *   - Alertas de stock mínimo por producto
 *   - Gestión de lotes y fechas de vencimiento
 *   - Descuento automático al crear prescripción
 *   - Órdenes de compra sugeridas
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { getCtx, requireRole, ok } from "../../core/context.js";
import { AppError } from "../../core/errors/appError.js";

export function buildStockRouter(): Router {
  const r = Router();

  // ── GET /alertas — productos bajo stock mínimo ─────────────────────────
  r.get("/alertas", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "staff", "vet");

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           p.id, p.nombre, p.codigo, p.categoria, p.unidad,
           p.stock_actual, p.stock_minimo, p.precio_compra_cents,
           p.proveedor,
           (p.stock_minimo - p.stock_actual) AS unidades_faltantes,
           CASE
             WHEN p.stock_actual = 0      THEN 'sin_stock'
             WHEN p.stock_actual <= p.stock_minimo * 0.5 THEN 'critico'
             ELSE 'bajo'
           END AS nivel_alerta
         FROM productos p
         WHERE p.tenant_id=?
           AND p.is_active=1
           AND p.stock_actual <= p.stock_minimo
         ORDER BY p.stock_actual ASC`,
        [ctx.tenantId]
      );

      res.json(ok(rows, { total: rows.length }));
    } catch (e) { next(e); }
  });

  // ── GET /lotes — lotes con vencimiento próximo ──────────────────────────
  r.get("/lotes", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const diasHasta = parseInt(String(req.query.dias ?? "90"));

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           l.id, l.producto_id, p.nombre AS producto_nombre,
           l.numero_lote, l.fecha_vencimiento, l.cantidad_inicial,
           l.cantidad_actual, l.proveedor, l.fecha_ingreso,
           DATEDIFF(l.fecha_vencimiento, CURDATE()) AS dias_para_vencer
         FROM stock_lotes l
         JOIN productos p ON p.id=l.producto_id
         WHERE l.tenant_id=?
           AND l.cantidad_actual > 0
           AND l.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
         ORDER BY l.fecha_vencimiento ASC`,
        [ctx.tenantId, diasHasta]
      );

      res.json(ok(rows, { dias_filtro: diasHasta, total: rows.length }));
    } catch (e) { next(e); }
  });

  // ── POST /lotes — registrar nuevo lote ──────────────────────────────────
  r.post("/lotes", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "staff");

      const { producto_id, numero_lote, fecha_vencimiento, cantidad, proveedor, precio_compra_cents } = req.body;
      if (!producto_id || !numero_lote || !cantidad) {
        throw new AppError("VALIDATION_ERROR", "producto_id, numero_lote y cantidad son requeridos");
      }

      const conn = await ctx.tenantPool.getConnection();
      try {
        await conn.beginTransaction();

        // Registrar lote
        const [loteResult] = await conn.query<any>(
          `INSERT INTO stock_lotes
             (tenant_id, producto_id, numero_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, proveedor, precio_compra_cents, fecha_ingreso)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [ctx.tenantId, producto_id, numero_lote, fecha_vencimiento ?? null, cantidad, cantidad, proveedor ?? null, precio_compra_cents ?? null]
        );

        // Actualizar stock_actual del producto
        await conn.query(
          "UPDATE productos SET stock_actual = stock_actual + ? WHERE id=? AND tenant_id=?",
          [cantidad, producto_id, ctx.tenantId]
        );

        // Registrar movimiento
        await conn.query(
          `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, motivo, lote_id)
           VALUES (?, ?, 'ingreso', ?, 'Ingreso de lote', ?)`,
          [ctx.tenantId, producto_id, cantidad, loteResult.insertId]
        );

        await conn.commit();
        res.status(201).json(ok({ lote_id: loteResult.insertId, producto_id, cantidad }));
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) { next(e); }
  });

  // ── POST /descuento — descontar stock (desde prescripción) ──────────────
  r.post("/descuento", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet", "staff");

      const { producto_id, cantidad, motivo, consulta_id, lote_id } = req.body;
      if (!producto_id || !cantidad || cantidad <= 0) {
        throw new AppError("VALIDATION_ERROR", "producto_id y cantidad (>0) son requeridos");
      }

      const conn = await ctx.tenantPool.getConnection();
      try {
        await conn.beginTransaction();

        const [prod] = await conn.query<any[]>(
          "SELECT id, stock_actual, nombre FROM productos WHERE id=? AND tenant_id=? AND is_active=1 FOR UPDATE",
          [producto_id, ctx.tenantId]
        );
        if (!prod[0]) throw new AppError("NOT_FOUND", "Producto no encontrado");
        if (prod[0].stock_actual < cantidad) {
          throw new AppError("VALIDATION_ERROR", `Stock insuficiente. Disponible: ${prod[0].stock_actual} ${prod[0].nombre}`);
        }

        await conn.query(
          "UPDATE productos SET stock_actual = stock_actual - ? WHERE id=? AND tenant_id=?",
          [cantidad, producto_id, ctx.tenantId]
        );

        // Descontar del lote específico o del más próximo a vencer (FEFO)
        if (lote_id) {
          await conn.query(
            "UPDATE stock_lotes SET cantidad_actual = cantidad_actual - ? WHERE id=? AND tenant_id=?",
            [cantidad, lote_id, ctx.tenantId]
          );
        } else {
          // FEFO: First Expire, First Out
          await conn.query(
            `UPDATE stock_lotes SET cantidad_actual = GREATEST(0, cantidad_actual - ?)
             WHERE producto_id=? AND tenant_id=? AND cantidad_actual > 0
             ORDER BY fecha_vencimiento ASC LIMIT 1`,
            [cantidad, producto_id, ctx.tenantId]
          );
        }

        await conn.query(
          `INSERT INTO stock_movimientos (tenant_id, producto_id, tipo, cantidad, motivo, consulta_id, lote_id)
           VALUES (?, ?, 'egreso', ?, ?, ?, ?)`,
          [ctx.tenantId, producto_id, cantidad, motivo ?? "Prescripción", consulta_id ?? null, lote_id ?? null]
        );

        await conn.commit();
        res.json(ok({ producto_id, cantidad_descontada: cantidad, stock_restante: prod[0].stock_actual - cantidad }));
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) { next(e); }
  });

  // ── GET /orden-compra — sugerencia de reabastecimiento ──────────────────
  r.get("/orden-compra", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "staff");

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           p.id, p.nombre, p.codigo, p.proveedor, p.unidad,
           p.stock_actual, p.stock_minimo,
           GREATEST(p.stock_minimo * 2 - p.stock_actual, 0) AS cantidad_sugerida,
           p.precio_compra_cents,
           GREATEST(p.stock_minimo * 2 - p.stock_actual, 0) * p.precio_compra_cents AS costo_estimado_cents
         FROM productos p
         WHERE p.tenant_id=? AND p.is_active=1
           AND p.stock_actual < p.stock_minimo
         ORDER BY p.proveedor, p.nombre`,
        [ctx.tenantId]
      );

      const totalCents = rows.reduce((s: number, r: any) => s + (r.costo_estimado_cents ?? 0), 0);
      res.json(ok(rows, { total_items: rows.length, total_estimado_cents: totalCents }));
    } catch (e) { next(e); }
  });

  return r;
}
