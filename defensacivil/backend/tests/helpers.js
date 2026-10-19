const request = require('supertest');
const app     = require('../src/app');
const { pool } = require('../src/config/database');

const PASSWORD = 'Admin2503!';

// Inicia sesión y devuelve un agente con la cookie de sesión y el access token
async function login(username, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`Login de ${username} falló: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, token: res.body.accessToken, user: res.body.user };
}

const auth = token => ({ Authorization: `Bearer ${token}` });

let counter = 0;
const unique = prefix => `${prefix}${Date.now().toString(36)}${counter++}`;

async function createUser(adminToken, role, extra = {}) {
  const username = unique(role.slice(0, 4));
  const res = await request(app).post('/api/users').set(auth(adminToken)).send({
    username, email: `${username}@test.gob.ar`, password: PASSWORD, role, full_name: `Usuario ${role}`, ...extra,
  });
  if (res.status !== 201) throw new Error(`No se pudo crear usuario: ${JSON.stringify(res.body)}`);
  return res.body;
}

const validIncident = (extra = {}) => ({
  incident_type_id: 1,
  title: 'Incendio de prueba en depósito',
  description: 'Descripción suficientemente larga del incidente de prueba.',
  priority: 'ALTA',
  latitude: -34.6037,
  longitude: -58.3816,
  ...extra,
});

afterAll(() => pool.end());

module.exports = { app, request, login, auth, createUser, unique, validIncident, PASSWORD, pool };
