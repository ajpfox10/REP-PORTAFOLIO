'use strict';

const { admin, customer, product, checkout, queryOne } = require('./helpers');
const { pool } = require('../src/db');

afterAll(() => pool.end());

describe('panel de administración', () => {
  test('un cliente no puede entrar', async () => {
    const c = await customer();
    expect((await c.get('/api/admin/stats')).status).toBe(403);
    expect((await c.get('/api/admin/orders')).status).toBe(403);
  });

  test('devuelve métricas', async () => {
    const a = await admin();
    const res = await a.get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('week.revenue');
    expect(Array.isArray(res.body.daily)).toBe(true);
  });

  test('crea un producto y valida el precio promocional', async () => {
    const a = await admin();
    const base = { name: 'Galletitas de avena', brand: 'Horno Nuestro', categorySlug: 'almacen', unit: '300 g', price: 2000, stock: 10, isActive: false };

    const bad = await a.post('/api/admin/products', { ...base, promoPrice: 2500 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toHaveProperty('promoPrice');

    const res = await a.post('/api/admin/products', { ...base, promoPrice: 1700 });
    expect(res.status).toBe(201);
    expect(res.body.product).toMatchObject({ slug: 'galletitas-de-avena-horno-nuestro-300-g', promo_price: 1700 });

    const edit = await a.put(`/api/admin/products/${res.body.product.id}`, { ...base, price: 2200 });
    expect(edit.status).toBe(200);
    expect(edit.body.product).toMatchObject({ price: 2200, promo_price: null });
  });

  test('solo acepta imágenes https', async () => {
    const a = await admin();
    const res = await a.post('/api/admin/products', {
      name: 'Producto', categorySlug: 'almacen', unit: '1 u', price: 100, stock: 1, isActive: false, imageUrl: 'javascript:alert(1)',
    });
    expect(res.status).toBe(400);
  });

  test('el ajuste de stock nunca deja números negativos', async () => {
    const a = await admin();
    const soap = await product('jabon-de-tocador');
    const res = await a.post(`/api/admin/products/${soap.id}/stock`, { delta: -100000 });
    expect(res.body.product.stock).toBe(0);
    await a.post(`/api/admin/products/${soap.id}/stock`, { delta: 90 });
  });

  test('cambia el estado de un pedido y al cancelarlo repone el stock', async () => {
    const a = await admin();
    const c = await customer();
    const yerba = await product('yerba-mate');
    const created = await c.post('/api/orders', checkout([{ productId: yerba.id, quantity: 2 }]));
    const id = created.body.order.id;

    const preparing = await a.patch(`/api/admin/orders/${id}/status`, { status: 'preparing' });
    expect(preparing.body.order.status).toBe('preparing');

    // El cliente ya no puede cancelarlo, el admin sí
    expect((await c.post(`/api/orders/${id}/cancel`)).status).toBe(409);
    const cancelled = await a.patch(`/api/admin/orders/${id}/status`, { status: 'cancelled' });
    expect(cancelled.body.order.status).toBe('cancelled');
    expect((await queryOne('SELECT stock FROM products WHERE id = :id', { id: yerba.id })).stock).toBe(yerba.stock);

    const reopen = await a.patch(`/api/admin/orders/${id}/status`, { status: 'pending' });
    expect(reopen.status).toBe(409);
  });
});
