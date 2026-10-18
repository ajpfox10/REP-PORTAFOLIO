'use strict';

// Carga categorías y productos de ejemplo, y crea el administrador inicial.
// Con --demo también genera clientes y pedidos de las últimas dos semanas.

const bcrypt = require('bcryptjs');
const { pool, query, queryOne, transaction } = require('../src/db');
const { categories, products, slugify } = require('./catalog');

async function seedCatalog() {
  for (const [index, c] of categories.entries()) {
    await query(
      `INSERT INTO categories (slug, name, icon, color, sort_order)
       VALUES (:slug, :name, :icon, :color, :sort)
       ON DUPLICATE KEY UPDATE name = VALUES(name), icon = VALUES(icon), color = VALUES(color), sort_order = VALUES(sort_order)`,
      { ...c, sort: index }
    );
  }
  const rows = await query('SELECT id, slug FROM categories');
  const categoryId = Object.fromEntries(rows.map((r) => [r.slug, r.id]));

  let created = 0;
  for (const [category, name, brand, unit, price, promo, stock, description] of products) {
    const result = await query(
      `INSERT IGNORE INTO products (category_id, slug, name, brand, description, unit, price, promo_price, stock)
       VALUES (:cid, :slug, :name, :brand, :description, :unit, :price, :promo, :stock)`,
      { cid: categoryId[category], slug: slugify(`${name} ${brand} ${unit}`), name, brand, description, unit, price, promo, stock }
    );
    created += result.affectedRows;
  }
  return created;
}

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 10) {
    return 'sin ADMIN_EMAIL / ADMIN_PASSWORD (mínimo 10 caracteres): no se creó el administrador';
  }
  const existing = await queryOne('SELECT id FROM users WHERE email = :email', { email });
  if (existing) return `el administrador ${email} ya existía`;
  await query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Administración', :email, :hash, 'admin')`,
    { email, hash: await bcrypt.hash(password, 12) }
  );
  return `administrador ${email} creado`;
}

const DEMO_CUSTOMERS = [
  ['Lucía Fernández', 'lucia@cliente.test', 'Av. San Martín 1520'],
  ['Martín Gómez', 'martin@cliente.test', 'Belgrano 845'],
  ['Sofía Ramírez', 'sofia@cliente.test', 'Mitre 233, 2.º B'],
  ['Diego Álvarez', 'diego@cliente.test', 'Sarmiento 1102'],
];

async function seedDemoOrders() {
  const password = process.env.DEMO_PASSWORD || 'Cliente.2026';
  const hash = await bcrypt.hash(password, 12);
  const customerIds = [];
  for (const [name, email, address] of DEMO_CUSTOMERS) {
    await query(
      `INSERT IGNORE INTO users (name, email, password_hash, phone, address) VALUES (:name, :email, :hash, '11 5555-0101', :address)`,
      { name, email, hash, address }
    );
    customerIds.push((await queryOne('SELECT id FROM users WHERE email = :email', { email })).id);
  }
  const already = await queryOne('SELECT COUNT(*) AS n FROM orders');
  if (already.n > 0) return `ya había pedidos; clientes de prueba con clave ${password}`;

  const catalog = await query('SELECT id, name, unit, price, promo_price FROM products WHERE is_active = 1');
  const statuses = ['delivered', 'delivered', 'delivered', 'shipped', 'preparing', 'pending', 'cancelled'];
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  let count = 0;
  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    const ordersToday = 2 + Math.floor(random() * 4);
    for (let n = 0; n < ordersToday; n += 1) {
      const userId = customerIds[Math.floor(random() * customerIds.length)];
      const picked = new Map();
      const lines = 2 + Math.floor(random() * 5);
      for (let i = 0; i < lines; i += 1) {
        const product = catalog[Math.floor(random() * catalog.length)];
        picked.set(product.id, { product, quantity: 1 + Math.floor(random() * 3) });
      }
      const items = [...picked.values()];
      const subtotal = items.reduce((acc, { product, quantity }) => acc + (product.promo_price ?? product.price) * quantity, 0);
      const savings = items.reduce((acc, { product, quantity }) => acc + (product.promo_price ? (product.price - product.promo_price) * quantity : 0), 0);
      const delivery = random() > 0.35;
      const fee = delivery && subtotal < 50000 ? 3500 : 0;
      const status = daysAgo > 2 ? statuses[Math.floor(random() * 3)] : statuses[Math.floor(random() * statuses.length)];
      const createdAt = new Date(Date.now() - daysAgo * 86400000 - Math.floor(random() * 10) * 3600000);

      await transaction(async (tx) => {
        const order = await tx.query(
          `INSERT INTO orders (user_id, status, delivery_method, address, phone, payment_method, subtotal, savings, delivery_fee, total, created_at)
           VALUES (:userId, :status, :method, :address, '11 5555-0101', :payment, :subtotal, :savings, :fee, :total, :createdAt)`,
          {
            userId, status, method: delivery ? 'delivery' : 'pickup', address: delivery ? 'Domicilio del cliente' : null,
            payment: ['cash', 'card', 'transfer'][Math.floor(random() * 3)],
            subtotal, savings, fee, total: subtotal + fee, createdAt,
          }
        );
        for (const { product, quantity } of items) {
          const unitPrice = product.promo_price ?? product.price;
          await tx.query(
            `INSERT INTO order_items (order_id, product_id, product_name, unit, unit_price, list_price, quantity, line_total)
             VALUES (:orderId, :productId, :name, :unit, :unitPrice, :listPrice, :quantity, :lineTotal)`,
            {
              orderId: order.insertId, productId: product.id, name: product.name, unit: product.unit,
              unitPrice, listPrice: product.price, quantity, lineTotal: unitPrice * quantity,
            }
          );
        }
      });
      count += 1;
    }
  }
  return `${count} pedidos de prueba; clientes con clave ${password}`;
}

async function main() {
  const created = await seedCatalog();
  console.log(`Catálogo: ${created} productos nuevos.`);
  console.log(`Administrador: ${await seedAdmin()}.`);
  if (process.argv.includes('--demo')) console.log(`Demo: ${await seedDemoOrders()}.`);
}

if (require.main === module) {
  main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { seedCatalog, seedAdmin };
