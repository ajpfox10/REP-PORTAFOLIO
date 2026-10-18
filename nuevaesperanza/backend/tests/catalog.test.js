'use strict';

const request = require('supertest');
const { app } = require('./helpers');
const { pool } = require('../src/db');

afterAll(() => pool.end());

describe('catálogo', () => {
  test('lista categorías con cantidad de productos', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(8);
    expect(res.body.categories[0]).toMatchObject({ slug: 'frutas-y-verduras', product_count: 6 });
  });

  test('busca por nombre y ordena por precio', async () => {
    const res = await request(app).get('/api/products?q=leche&sort=price_asc');
    expect(res.status).toBe(200);
    const names = res.body.products.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Leche entera', 'Dulce de leche clásico']));
    const prices = res.body.products.map((p) => p.promo_price ?? p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test('los comodines de LIKE se tratan como texto', async () => {
    const res = await request(app).get('/api/products?q=%25');
    expect(res.body.total).toBe(0);
  });

  test('filtra por categoría y promociones', async () => {
    const res = await request(app).get('/api/products?category=lacteos&promo=1');
    expect(res.body.products.length).toBeGreaterThan(0);
    expect(res.body.products.every((p) => p.category_slug === 'lacteos' && p.promo_price !== null)).toBe(true);
  });

  test('pagina los resultados', async () => {
    const res = await request(app).get('/api/products?limit=10&page=2');
    expect(res.body).toMatchObject({ page: 2, limit: 10, total: 46, pages: 5 });
    expect(res.body.products).toHaveLength(10);
  });

  test('rechaza parámetros inválidos', async () => {
    const res = await request(app).get('/api/products?sort=DROP%20TABLE');
    expect(res.status).toBe(400);
  });

  test('detalle de producto con relacionados', async () => {
    const list = await request(app).get('/api/products?category=bebidas&limit=1');
    const res = await request(app).get(`/api/products/${list.body.products[0].slug}`);
    expect(res.status).toBe(200);
    expect(res.body.product.description).toBeTruthy();
    expect(res.body.related.every((p) => p.category_slug === 'bebidas')).toBe(true);
  });

  test('producto inexistente da 404', async () => {
    const res = await request(app).get('/api/products/no-existe');
    expect(res.status).toBe(404);
  });
});
