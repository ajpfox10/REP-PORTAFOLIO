'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { query, queryOne } = require('../src/db');

const app = createApp();
let counter = 0;

// Cliente con cookies propias y token CSRF, como un navegador
async function client() {
  const agent = request.agent(app);
  const { body } = await agent.get('/api/csrf');
  const send = (method) => (url, data) => agent[method](url).set('X-CSRF-Token', body.csrfToken).send(data);
  return { agent, get: (url) => agent.get(url), post: send('post'), put: send('put'), patch: send('patch'), csrf: body.csrfToken };
}

async function customer(overrides = {}) {
  const c = await client();
  counter += 1;
  const user = {
    name: 'Cliente Prueba',
    email: `cliente${Date.now()}${counter}@test.local`,
    password: 'Clave1234',
    ...overrides,
  };
  const res = await c.post('/api/auth/register', user);
  if (res.status !== 201) throw new Error(`registro falló: ${JSON.stringify(res.body)}`);
  return { ...c, user: res.body.user };
}

async function admin() {
  const c = await client();
  const res = await c.post('/api/auth/login', { email: 'admin@test.local', password: 'Admin.Test2026' });
  if (res.status !== 200) throw new Error('login admin falló');
  return c;
}

const product = (slugPart) => queryOne('SELECT * FROM products WHERE slug LIKE :s', { s: `%${slugPart}%` });

const checkout = (items) => ({
  items,
  deliveryMethod: 'delivery',
  address: 'Av. Siempre Viva 742',
  phone: '11 4444-5555',
  paymentMethod: 'cash',
});

module.exports = { app, client, customer, admin, product, checkout, query, queryOne };
