'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { handle } = require('../lib/http');
const orders = require('../services/orders');

const router = Router();

const items = z.array(z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(50, 'Máximo 50 unidades por producto'),
})).min(1, 'El carrito está vacío').max(60, 'El carrito tiene demasiados productos');

const quoteSchema = z.object({
  items,
  deliveryMethod: z.enum(['delivery', 'pickup']).default('delivery'),
});

const orderSchema = z.object({
  items,
  deliveryMethod: z.enum(['delivery', 'pickup']),
  address: z.string().trim().max(255).optional(),
  phone: z.string().trim().regex(/^[0-9+()\s-]{6,40}$/, 'Ingresá un teléfono válido'),
  paymentMethod: z.enum(['cash', 'card', 'transfer']),
  notes: z.string().trim().max(500).optional(),
}).refine((data) => data.deliveryMethod === 'pickup' || (data.address && data.address.length >= 5), {
  message: 'Ingresá la dirección de entrega',
  path: ['address'],
});

router.post('/cart/quote', validate(quoteSchema), handle(async (req, res) => {
  const { items: cart, deliveryMethod } = req.valid.body;
  res.json(await orders.quoteCart(cart, deliveryMethod));
}));

router.post('/orders', requireAuth, validate(orderSchema), handle(async (req, res) => {
  const id = await orders.createOrder(req.user, req.valid.body);
  res.status(201).json({ order: await orders.getOrder(id, { userId: req.user.id }) });
}));

router.get('/orders', requireAuth, handle(async (req, res) => {
  const rows = await query(
    `SELECT o.id, o.status, o.delivery_method, o.total, o.created_at, COUNT(oi.id) AS item_count
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = :userId GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT 100`,
    { userId: req.user.id }
  );
  res.json({ orders: rows });
}));

router.get('/orders/:id(\\d+)', requireAuth, handle(async (req, res) => {
  res.json({ order: await orders.getOrder(Number(req.params.id), { userId: req.user.id }) });
}));

router.post('/orders/:id(\\d+)/cancel', requireAuth, handle(async (req, res) => {
  const id = Number(req.params.id);
  await orders.changeStatus(id, 'cancelled', { by: 'customer', userId: req.user.id });
  res.json({ order: await orders.getOrder(id, { userId: req.user.id }) });
}));

module.exports = router;
