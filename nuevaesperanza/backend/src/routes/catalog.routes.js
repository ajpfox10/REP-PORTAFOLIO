'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { validate } = require('../middleware/validate');
const { handle, notFound } = require('../lib/http');

const router = Router();

const PRODUCT_FIELDS = `p.id, p.slug, p.name, p.brand, p.unit, p.price, p.promo_price, p.stock, p.image_url,
  c.slug AS category_slug, c.name AS category_name, c.color AS category_color, c.icon AS category_icon`;

const SORTS = {
  relevance: 'p.promo_price IS NULL, c.sort_order, p.name',
  price_asc: 'COALESCE(p.promo_price, p.price) ASC',
  price_desc: 'COALESCE(p.promo_price, p.price) DESC',
  name: 'p.name ASC',
  newest: 'p.created_at DESC, p.id DESC',
};

const listSchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional(),
  promo: z.enum(['1', 'true']).optional(),
  sort: z.enum(Object.keys(SORTS)).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

router.get('/categories', handle(async (_req, res) => {
  const rows = await query(
    `SELECT c.slug, c.name, c.icon, c.color, COUNT(p.id) AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
      GROUP BY c.id ORDER BY c.sort_order`
  );
  res.json({ categories: rows });
}));

router.get('/products', validate(listSchema, 'query'), handle(async (req, res) => {
  const { q, category, promo, sort, page, limit } = req.valid.query;
  const where = ['p.is_active = 1'];
  const params = {};
  if (q) {
    where.push('(p.name LIKE :q OR p.brand LIKE :q OR c.name LIKE :q)');
    params.q = `%${escapeLike(q)}%`;
  }
  if (category) { where.push('c.slug = :category'); params.category = category; }
  if (promo) where.push('p.promo_price IS NOT NULL');

  const from = `FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from}`, params);
  const products = await query(
    `SELECT ${PRODUCT_FIELDS} ${from} ORDER BY ${SORTS[sort]}, p.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );
  res.json({ products, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get('/products/:slug', handle(async (req, res) => {
  const product = await queryOne(
    `SELECT ${PRODUCT_FIELDS}, p.description FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.slug = :slug AND p.is_active = 1`,
    { slug: String(req.params.slug).slice(0, 140) }
  );
  if (!product) throw notFound('No encontramos ese producto');
  const related = await query(
    `SELECT ${PRODUCT_FIELDS} FROM products p JOIN categories c ON c.id = p.category_id
      WHERE c.slug = :category AND p.id <> :id AND p.is_active = 1
      ORDER BY p.promo_price IS NULL, p.name LIMIT 4`,
    { category: product.category_slug, id: product.id }
  );
  res.json({ product, related });
}));

module.exports = router;
