const { app, request, login, auth } = require('./helpers');

describe('API en general', () => {
  test('health check sin autenticación', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('cabeceras de seguridad y sin caché', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('ruta inexistente devuelve 404 en JSON', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  test('JSON mal formado devuelve 400 sin detalles internos', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json').send('{"username": ');
    expect(res.status).toBe(400);
    expect(res.body.stack).toBeUndefined();
  });

  test('las rutas protegidas exigen token', async () => {
    for (const path of ['/api/incidents', '/api/users', '/api/geo/provinces', '/api/audit']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  test('la auditoría es solo para administradores', async () => {
    const { token } = await login('operador1');
    expect((await request(app).get('/api/audit').set(auth(token))).status).toBe(403);
  });
});
