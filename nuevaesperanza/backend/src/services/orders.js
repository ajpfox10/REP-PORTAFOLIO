'use strict';

const { query, transaction } = require('../db');
const { conflict, notFound } = require('../lib/http');
const { buildQuote, mergeItems } = require('./pricing');

const PRODUCT_COLUMNS = 'id, slug, name, unit, price, promo_price, stock, is_active';

async function loadProducts(ids, runner = { query }, { lock = false } = {}) {
  if (!ids.length) return new Map();
  const rows = await runner.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id IN (:ids) ORDER BY id ${lock ? 'FOR UPDATE' : ''}`,
    { ids }
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function quoteCart(items, method) {
  const merged = mergeItems(items);
  const products = await loadProducts(merged.map((i) => i.productId));
  return buildQuote(merged, products, method);
}

/**
 * Crea el pedido dentro de una transacción. Las filas de productos se bloquean
 * (FOR UPDATE, en orden de id para evitar deadlocks) así dos compras simultáneas
 * no pueden vender el mismo último paquete.
 */
async function createOrder(user, data) {
  return transaction(async (tx) => {
    const merged = mergeItems(data.items);
    const products = await loadProducts(merged.map((i) => i.productId), tx, { lock: true });
    const quote = buildQuote(merged, products, data.deliveryMethod);
    if (quote.issues.length) {
      throw conflict('Algunos productos cambiaron. Revisá tu carrito.', 'CART_CHANGED', quote.issues);
    }

    const order = await tx.query(
      `INSERT INTO orders (user_id, delivery_method, address, phone, payment_method, notes, subtotal, savings, delivery_fee, total)
       VALUES (:userId, :method, :address, :phone, :payment, :notes, :subtotal, :savings, :fee, :total)`,
      {
        userId: user.id,
        method: data.deliveryMethod,
        address: data.deliveryMethod === 'delivery' ? data.address : null,
        phone: data.phone,
        payment: data.paymentMethod,
        notes: data.notes || null,
        subtotal: quote.subtotal,
        savings: quote.savings,
        fee: quote.deliveryFee,
        total: quote.total,
      }
    );

    for (const line of quote.lines) {
      await tx.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit, unit_price, list_price, quantity, line_total)
         VALUES (:orderId, :productId, :name, :unit, :unitPrice, :listPrice, :quantity, :lineTotal)`,
        { orderId: order.insertId, ...line }
      );
      await tx.query('UPDATE products SET stock = stock - :quantity WHERE id = :id', {
        quantity: line.quantity,
        id: line.productId,
      });
    }
    return order.insertId;
  });
}

async function getOrder(id, { userId } = {}) {
  const [order] = await query(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email
       FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.id = :id ${userId ? 'AND o.user_id = :userId' : ''}`,
    { id, userId }
  );
  if (!order) throw notFound('No encontramos ese pedido');
  order.items = await query(
    `SELECT oi.product_id, oi.product_name, oi.unit, oi.unit_price, oi.list_price, oi.quantity, oi.line_total, p.slug
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = :id ORDER BY oi.id`,
    { id }
  );
  return order;
}

const CANCELLABLE = {
  customer: ['pending'],
  admin: ['pending', 'preparing'],
};

// Cambia el estado; si se cancela, devuelve el stock reservado
async function changeStatus(id, nextStatus, { by, userId } = {}) {
  return transaction(async (tx) => {
    const order = await tx.queryOne(
      `SELECT id, status FROM orders WHERE id = :id ${userId ? 'AND user_id = :userId' : ''} FOR UPDATE`,
      { id, userId }
    );
    if (!order) throw notFound('No encontramos ese pedido');
    if (order.status === nextStatus) return order.status;

    if (nextStatus === 'cancelled') {
      if (!CANCELLABLE[by].includes(order.status)) {
        throw conflict(by === 'customer'
          ? 'El pedido ya se está preparando y no se puede cancelar desde la web'
          : 'Un pedido enviado o entregado no se puede cancelar', 'NOT_CANCELLABLE');
      }
      const items = await tx.query('SELECT product_id, quantity FROM order_items WHERE order_id = :id', { id });
      for (const item of items) {
        await tx.query('UPDATE products SET stock = stock + :quantity WHERE id = :productId', {
          quantity: item.quantity,
          productId: item.product_id,
        });
      }
    } else if (order.status === 'cancelled' || order.status === 'delivered') {
      throw conflict('Ese pedido ya está cerrado', 'ORDER_CLOSED');
    }

    await tx.query('UPDATE orders SET status = :status WHERE id = :id', { status: nextStatus, id });
    return nextStatus;
  });
}

module.exports = { quoteCart, createOrder, getOrder, changeStatus };
