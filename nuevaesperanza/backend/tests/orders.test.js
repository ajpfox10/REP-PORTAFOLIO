'use strict';

const { customer, product, checkout, queryOne, query } = require('./helpers');
const { pool } = require('../src/db');

afterAll(() => pool.end());

const stockOf = async (id) => (await queryOne('SELECT stock FROM products WHERE id = :id', { id })).stock;

describe('carrito', () => {
  test('el presupuesto usa precios de la base, aplica promos y cobra envío', async () => {
    const c = await customer();
    const apple = await product('manzana-roja');
    const res = await c.post('/api/cart/quote', {
      items: [{ productId: apple.id, quantity: 2, price: 1 }],
      deliveryMethod: 'delivery',
    });
    expect(res.status).toBe(200);
    expect(res.body.lines[0]).toMatchObject({ unitPrice: Number(apple.promo_price), listPrice: Number(apple.price), quantity: 2 });
    expect(res.body.savings).toBeCloseTo((apple.price - apple.promo_price) * 2);
    expect(res.body.deliveryFee).toBe(3500);
  });

  test('envío gratis desde el monto mínimo y retiro en el local sin cargo', async () => {
    const c = await customer();
    const sunscreen = await product('protector-solar');
    const big = await c.post('/api/cart/quote', { items: [{ productId: sunscreen.id, quantity: 4 }], deliveryMethod: 'delivery' });
    expect(big.body.deliveryFee).toBe(0);
    const pickup = await c.post('/api/cart/quote', { items: [{ productId: sunscreen.id, quantity: 1 }], deliveryMethod: 'pickup' });
    expect(pickup.body.deliveryFee).toBe(0);
  });

  test('avisa cuando no alcanza el stock', async () => {
    const c = await customer();
    const sunscreen = await product('protector-solar');
    const res = await c.post('/api/cart/quote', { items: [{ productId: sunscreen.id, quantity: 50 }] });
    expect(res.body.issues[0]).toMatchObject({ code: 'NOT_ENOUGH_STOCK', available: sunscreen.stock });
  });
});

describe('pedidos', () => {
  test('hay que iniciar sesión para comprar', async () => {
    const { client } = require('./helpers');
    const c = await client();
    const res = await c.post('/api/orders', checkout([{ productId: 1, quantity: 1 }]));
    expect(res.status).toBe(401);
  });

  test('crear un pedido descuenta stock y guarda los precios del momento', async () => {
    const c = await customer();
    const milk = await product('leche-entera');
    const before = await stockOf(milk.id);

    const res = await c.post('/api/orders', checkout([{ productId: milk.id, quantity: 3 }]));
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'pending', subtotal: milk.price * 3, total: milk.price * 3 + 3500 });
    expect(res.body.order.items[0]).toMatchObject({ product_name: 'Leche entera', quantity: 3 });
    expect(await stockOf(milk.id)).toBe(before - 3);
  });

  test('exige dirección para envío a domicilio', async () => {
    const c = await customer();
    const res = await c.post('/api/orders', { ...checkout([{ productId: 1, quantity: 1 }]), address: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('address');
  });

  test('rechaza el pedido si no alcanza el stock y no toca nada', async () => {
    const c = await customer();
    const sunscreen = await product('protector-solar');
    const before = await stockOf(sunscreen.id);
    const res = await c.post('/api/orders', checkout([{ productId: sunscreen.id, quantity: before + 1 }]));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CART_CHANGED');
    expect(await stockOf(sunscreen.id)).toBe(before);
  });

  test('dos compras simultáneas no pueden llevarse la última unidad', async () => {
    const coffee = await product('cafe-molido');
    await query('UPDATE products SET stock = 1 WHERE id = :id', { id: coffee.id });
    const [a, b] = await Promise.all([customer(), customer()]);

    const results = await Promise.all([
      a.post('/api/orders', checkout([{ productId: coffee.id, quantity: 1 }])),
      b.post('/api/orders', checkout([{ productId: coffee.id, quantity: 1 }])),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf(coffee.id)).toBe(0);
    await query('UPDATE products SET stock = 45 WHERE id = :id', { id: coffee.id });
  });

  test('cada cliente ve solo sus pedidos', async () => {
    const owner = await customer();
    const other = await customer();
    const created = await owner.post('/api/orders', checkout([{ productId: 1, quantity: 1 }]));
    const id = created.body.order.id;

    expect((await owner.get('/api/orders')).body.orders.map((o) => o.id)).toContain(id);
    expect((await other.get('/api/orders')).body.orders).toHaveLength(0);
    expect((await other.get(`/api/orders/${id}`)).status).toBe(404);
    expect((await other.post(`/api/orders/${id}/cancel`)).status).toBe(404);
  });

  test('cancelar un pedido pendiente devuelve el stock', async () => {
    const c = await customer();
    const bread = await product('pan-frances');
    const before = await stockOf(bread.id);
    const created = await c.post('/api/orders', checkout([{ productId: bread.id, quantity: 2 }]));
    expect(await stockOf(bread.id)).toBe(before - 2);

    const res = await c.post(`/api/orders/${created.body.order.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
    expect(await stockOf(bread.id)).toBe(before);
  });
});
