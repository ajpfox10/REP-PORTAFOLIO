'use strict';

const config = require('../config');
const { toCents, fromCents } = require('../lib/money');

// Suma cantidades repetidas del mismo producto: [{productId, quantity}]
function mergeItems(items) {
  const merged = new Map();
  for (const { productId, quantity } of items) {
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function deliveryFeeCents(subtotalCents, method) {
  if (method !== 'delivery') return 0;
  return subtotalCents >= toCents(config.delivery.freeFrom) ? 0 : toCents(config.delivery.fee);
}

/**
 * Arma el presupuesto de un carrito a partir de los productos de la base.
 * El precio siempre sale de la base, nunca del cliente.
 * @param {Array<{productId:number, quantity:number}>} items
 * @param {Map<number, object>} productsById filas de products
 * @param {'delivery'|'pickup'} method
 */
function buildQuote(items, productsById, method = 'delivery') {
  const lines = [];
  const issues = [];
  let subtotal = 0;
  let savings = 0;

  for (const { productId, quantity } of mergeItems(items)) {
    const product = productsById.get(productId);
    if (!product || !product.is_active) {
      issues.push({ productId, code: 'UNAVAILABLE', message: 'Este producto ya no está disponible' });
      continue;
    }
    if (product.stock < quantity) {
      issues.push({
        productId,
        code: 'NOT_ENOUGH_STOCK',
        available: product.stock,
        message: product.stock === 0 ? `${product.name} está sin stock` : `Solo quedan ${product.stock} de ${product.name}`,
      });
    }
    const unit = toCents(product.promo_price ?? product.price);
    const list = toCents(product.price);
    subtotal += unit * quantity;
    savings += (list - unit) * quantity;
    lines.push({
      productId,
      slug: product.slug,
      name: product.name,
      unit: product.unit,
      quantity,
      stock: product.stock,
      unitPrice: fromCents(unit),
      listPrice: fromCents(list),
      lineTotal: fromCents(unit * quantity),
    });
  }

  const fee = deliveryFeeCents(subtotal, method);
  return {
    lines,
    issues,
    subtotal: fromCents(subtotal),
    savings: fromCents(savings),
    deliveryFee: fromCents(fee),
    total: fromCents(subtotal + fee),
    freeDeliveryFrom: config.delivery.freeFrom,
  };
}

module.exports = { buildQuote, mergeItems };
