'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/auth');
const { handle, notFound, badRequest } = require('../lib/http');
const orders = require('../services/orders');
const { slugify } = require('../lib/slug');

const router = Router();
router.use(requireAdmin);

const LOW_STOCK = 15;

router.get('/stats', handle(async (_req, res) => {
  const [today] = await query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
       FROM orders WHERE status <> 'cancelled' AND created_at >= CURRENT_DATE()`
  );
  const [week] = await query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue, COALESCE(AVG(total), 0) AS average
       FROM orders WHERE status <> 'cancelled' AND created_at >= CURRENT_DATE() - INTERVAL 6 DAY`
  );
  const byStatus = await query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status');
  const daily = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS orders, SUM(total) AS revenue
       FROM orders WHERE status <> 'cancelled' AND created_at >= CURRENT_DATE() - INTERVAL 13 DAY
      GROUP BY day ORDER BY day`
  );
  const topProducts = await query(
    `SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status <> 'cancelled' AND o.created_at >= CURRENT_DATE() - INTERVAL 29 DAY
      GROUP BY oi.product_name ORDER BY units DESC LIMIT 5`
  );
  const lowStock = await query(
    `SELECT id, name, unit, stock FROM products WHERE is_active = 1 AND stock < ${LOW_STOCK} ORDER BY stock, name LIMIT 10`
  );
  const [{ customers }] = await query("SELECT COUNT(*) AS customers FROM users WHERE role = 'customer'");
  res.json({ today, week, byStatus, daily, topProducts, lowStock, customers, lowStockThreshold: LOW_STOCK });
}));

// ── Productos ────────────────────────────────────────────────────────────────

const money = z.coerce.number().positive('Tiene que ser mayor a cero').max(100000000);
const productSchema = z.object({
  name: z.string().trim().min(2).max(140),
  brand: z.string().trim().max(80).optional().or(z.literal('')),
  categorySlug: z.string().trim().max(80),
  unit: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  price: money,
  promoPrice: money.nullable().optional(),
  stock: z.coerce.number().int().min(0).max(1000000),
  imageUrl: z.string().trim().url().max(500).regex(/^https:\/\//, 'La imagen tiene que ser una URL https').nullable().optional().or(z.literal('')),
  isActive: z.boolean().default(true),
}).refine((p) => p.promoPrice == null || p.promoPrice < p.price, {
  message: 'El precio promocional tiene que ser menor al precio normal',
  path: ['promoPrice'],
});

const listSchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive', 'low']).optional(),
});

router.get('/products', validate(listSchema, 'query'), handle(async (req, res) => {
  const { q, category, status } = req.valid.query;
  const where = ['1 = 1'];
  const params = {};
  if (q) { where.push('(p.name LIKE :q OR p.brand LIKE :q)'); params.q = `%${q.replace(/[\\%_]/g, '\\$&')}%`; }
  if (category) { where.push('c.slug = :category'); params.category = category; }
  if (status === 'active') where.push('p.is_active = 1');
  if (status === 'inactive') where.push('p.is_active = 0');
  if (status === 'low') where.push(`p.is_active = 1 AND p.stock < ${LOW_STOCK}`);
  const products = await query(
    `SELECT p.id, p.slug, p.name, p.brand, p.unit, p.description, p.price, p.promo_price, p.stock, p.image_url, p.is_active,
            c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')} ORDER BY c.sort_order, p.name LIMIT 500`,
    params
  );
  res.json({ products });
}));

async function categoryId(slug) {
  const row = await queryOne('SELECT id FROM categories WHERE slug = :slug', { slug });
  if (!row) throw badRequest('Revisá los datos ingresados', 'VALIDATION_ERROR', { categorySlug: 'Elegí una categoría válida' });
  return row.id;
}

function productParams(data, cid) {
  return {
    cid,
    name: data.name,
    brand: data.brand || null,
    unit: data.unit,
    description: data.description || null,
    price: data.price,
    promo: data.promoPrice ?? null,
    stock: data.stock,
    image: data.imageUrl || null,
    active: data.isActive ? 1 : 0,
  };
}

router.post('/products', validate(productSchema), handle(async (req, res) => {
  const data = req.valid.body;
  const params = productParams(data, await categoryId(data.categorySlug));
  let slug = slugify(`${data.name} ${data.brand || ''} ${data.unit}`);
  if (await queryOne('SELECT id FROM products WHERE slug = :slug', { slug })) slug = `${slug}-${Date.now().toString(36)}`;
  const result = await query(
    `INSERT INTO products (category_id, slug, name, brand, unit, description, price, promo_price, stock, image_url, is_active)
     VALUES (:cid, :slug, :name, :brand, :unit, :description, :price, :promo, :stock, :image, :active)`,
    { ...params, slug }
  );
  res.status(201).json({ product: await queryOne('SELECT * FROM products WHERE id = :id', { id: result.insertId }) });
}));

router.put('/products/:id(\\d+)', validate(productSchema), handle(async (req, res) => {
  const id = Number(req.params.id);
  const data = req.valid.body;
  const params = productParams(data, await categoryId(data.categorySlug));
  const result = await query(
    `UPDATE products SET category_id = :cid, name = :name, brand = :brand, unit = :unit, description = :description,
            price = :price, promo_price = :promo, stock = :stock, image_url = :image, is_active = :active
      WHERE id = :id`,
    { ...params, id }
  );
  if (!result.affectedRows) throw notFound('No encontramos ese producto');
  res.json({ product: await queryOne('SELECT * FROM products WHERE id = :id', { id }) });
}));

const stockSchema = z.object({ delta: z.coerce.number().int().min(-100000).max(100000).refine((n) => n !== 0, 'Indicá cuántas unidades') });

router.post('/products/:id(\\d+)/stock', validate(stockSchema), handle(async (req, res) => {
  const id = Number(req.params.id);
  const { delta } = req.valid.body;
  // GREATEST evita stock negativo aunque lleguen dos ajustes a la vez
  const result = await query(
    'UPDATE products SET stock = GREATEST(0, CAST(stock AS SIGNED) + :delta) WHERE id = :id',
    { id, delta }
  );
  if (!result.affectedRows) throw notFound('No encontramos ese producto');
  res.json({ product: await queryOne('SELECT id, name, stock FROM products WHERE id = :id', { id }) });
}));

// ── Pedidos ──────────────────────────────────────────────────────────────────

const STATUSES = ['pending', 'preparing', 'shipped', 'delivered', 'cancelled'];

router.get('/orders', validate(z.object({ status: z.enum(STATUSES).optional() }), 'query'), handle(async (req, res) => {
  const { status } = req.valid.query;
  const rows = await query(
    `SELECT o.id, o.status, o.delivery_method, o.payment_method, o.total, o.created_at,
            u.name AS customer_name, COUNT(oi.id) AS item_count
       FROM orders o JOIN users u ON u.id = o.user_id JOIN order_items oi ON oi.order_id = o.id
      ${status ? 'WHERE o.status = :status' : ''}
      GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT 200`,
    { status }
  );
  res.json({ orders: rows });
}));

router.get('/orders/:id(\\d+)', handle(async (req, res) => {
  res.json({ order: await orders.getOrder(Number(req.params.id)) });
}));

router.patch('/orders/:id(\\d+)/status', validate(z.object({ status: z.enum(STATUSES) })), handle(async (req, res) => {
  const id = Number(req.params.id);
  await orders.changeStatus(id, req.valid.body.status, { by: 'admin' });
  res.json({ order: await orders.getOrder(id) });
}));

module.exports = router;
