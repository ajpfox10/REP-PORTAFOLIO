const { app, request, login, auth, createUser, PASSWORD } = require('./helpers');

describe('Autenticación', () => {
  test('el login deja el refresh token en una cookie httpOnly y no en el cuerpo', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'admin' });

    const cookie = res.headers['set-cookie'].find(c => c.startsWith('dc_refresh='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  test('el usuario no distingue mayúsculas', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'ADMIN', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  test('usuario inexistente y contraseña incorrecta dan el mismo error', async () => {
    const wrongPass = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Incorrecta1' });
    const noUser    = await request(app).post('/api/auth/login').send({ username: 'noexiste', password: 'Incorrecta1' });

    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(noUser.body).toEqual(wrongPass.body);
  });

  test('datos de login faltantes devuelven 422', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('password');
  });

  test('refresh rota la cookie y entrega un access token nuevo', async () => {
    const { agent } = await login('admin');

    const first  = await agent.post('/api/auth/refresh');
    const second = await agent.post('/api/auth/refresh');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.accessToken).toEqual(expect.any(String));
    expect(first.headers['set-cookie'][0]).not.toEqual(second.headers['set-cookie'][0]);
  });

  test('dos renovaciones en el mismo segundo no chocan', async () => {
    const a = await login('operador1');
    const b = await login('operador1');
    const [r1, r2] = await Promise.all([a.agent.post('/api/auth/refresh'), b.agent.post('/api/auth/refresh')]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  test('reusar un refresh token ya usado cierra todas las sesiones del usuario', async () => {
    const { token: adminToken } = await login('admin');
    const victim = await createUser(adminToken, 'read');

    const loginRes = await request(app).post('/api/auth/login').send({ username: victim.username, password: PASSWORD });
    const stolenCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    // El dueño legítimo renueva su sesión
    const legit = await request(app).post('/api/auth/refresh').set('Cookie', stolenCookie);
    expect(legit.status).toBe(200);
    const legitCookie = legit.headers['set-cookie'][0].split(';')[0];

    // Alguien reusa la cookie vieja
    const attacker = await request(app).post('/api/auth/refresh').set('Cookie', stolenCookie);
    expect(attacker.status).toBe(401);

    // La sesión legítima también queda cerrada por seguridad
    const afterwards = await request(app).post('/api/auth/refresh').set('Cookie', legitCookie);
    expect(afterwards.status).toBe(401);
  });

  test('refresh sin cookie devuelve 401', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  test('logout invalida la cookie', async () => {
    const { agent } = await login('lector1');
    const cookieBefore = (await agent.post('/api/auth/refresh')).headers['set-cookie'][0].split(';')[0];

    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);

    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', cookieBefore);
    expect(reuse.status).toBe(401);
  });

  test('/me requiere token y devuelve el usuario sin el hash', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);

    const { token } = await login('admin');
    const res = await request(app).get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
    expect(res.body.password_hash).toBeUndefined();
  });

  test('un token firmado con otra clave es rechazado', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ id: 1, role: 'admin' }, 'otra-clave-cualquiera');
    const res = await request(app).get('/api/auth/me').set(auth(forged));
    expect(res.status).toBe(401);
  });

  test('cambiar la contraseña exige la actual y cierra las otras sesiones', async () => {
    const { token: adminToken } = await login('admin');
    const user = await createUser(adminToken, 'medium');
    const other = await login(user.username);
    const mine  = await login(user.username);

    const wrong = await request(app).put('/api/auth/change-password').set(auth(mine.token))
      .send({ currentPassword: 'Incorrecta1', newPassword: 'NuevaClave1' });
    expect(wrong.status).toBe(400);

    const weak = await request(app).put('/api/auth/change-password').set(auth(mine.token))
      .send({ currentPassword: PASSWORD, newPassword: 'debil' });
    expect(weak.status).toBe(422);

    const ok = await mine.agent.put('/api/auth/change-password').set(auth(mine.token))
      .send({ currentPassword: PASSWORD, newPassword: 'NuevaClave1' });
    expect(ok.status).toBe(200);

    expect((await other.agent.post('/api/auth/refresh')).status).toBe(401);
    expect((await mine.agent.post('/api/auth/refresh')).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ username: user.username, password: 'NuevaClave1' })).status).toBe(200);
  });
});
