const { app, request, login, auth, createUser, unique, PASSWORD } = require('./helpers');

let admin;
beforeAll(async () => { admin = await login('admin'); });

describe('Usuarios', () => {
  test('solo un administrador puede listar usuarios', async () => {
    const { token } = await login('operador1');
    expect((await request(app).get('/api/users').set(auth(token))).status).toBe(403);

    const res = await request(app).get('/api/users').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body[0].password_hash).toBeUndefined();
  });

  test.each(['telefonista', 'chofer', 'read', 'medium'])('se puede crear un usuario con rol %s', async role => {
    const user = await createUser(admin.token, role);
    expect(user.role).toBe(role);
    const session = await login(user.username);
    expect(session.user.role).toBe(role);
  });

  test('no se puede repetir el nombre de un usuario desactivado', async () => {
    const user = await createUser(admin.token, 'read');
    await request(app).put(`/api/users/${user.uuid}/toggle-active`).set(auth(admin.token)).expect(200);

    const res = await request(app).post('/api/users').set(auth(admin.token)).send({
      username: user.username, email: `${unique('otro')}@test.gob.ar`, password: PASSWORD, role: 'read', full_name: 'Otro',
    });
    expect(res.status).toBe(409);
  });

  test('email repetido devuelve 409', async () => {
    const user = await createUser(admin.token, 'read');
    const res = await request(app).post('/api/users').set(auth(admin.token)).send({
      username: unique('dup'), email: user.email, password: PASSWORD, role: 'read', full_name: 'Duplicado',
    });
    expect(res.status).toBe(409);
  });

  test('valida contraseña, rol y usuario', async () => {
    const res = await request(app).post('/api/users').set(auth(admin.token)).send({
      username: 'con espacios', email: 'no-es-email', password: 'corta', role: 'superadmin', full_name: '',
    });
    expect(res.status).toBe(422);
    const fields = res.body.errors.map(e => e.field);
    expect(fields).toEqual(expect.arrayContaining(['username', 'email', 'password', 'role', 'full_name']));
  });

  test('desactivar a un usuario corta su acceso en la siguiente solicitud', async () => {
    const user = await createUser(admin.token, 'medium');
    const session = await login(user.username);
    expect((await request(app).get('/api/incidents').set(auth(session.token))).status).toBe(200);

    await request(app).put(`/api/users/${user.uuid}/toggle-active`).set(auth(admin.token)).expect(200);

    expect((await request(app).get('/api/incidents').set(auth(session.token))).status).toBe(401);
    expect((await session.agent.post('/api/auth/refresh')).status).toBe(401);
  });

  test('un cambio de rol rige de inmediato, sin esperar a que venza el token', async () => {
    const user = await createUser(admin.token, 'medium');
    const session = await login(user.username);

    await request(app).put(`/api/users/${user.uuid}`).set(auth(admin.token)).send({ role: 'read' }).expect(200);

    const res = await request(app).post('/api/incidents').set(auth(session.token)).send({
      incident_type_id: 1, title: 'Intento sin permiso', description: 'No debería poder crearlo.',
    });
    expect(res.status).toBe(403);
  });

  test('no se puede quitar el rol al único administrador activo', async () => {
    const me = await request(app).get('/api/auth/me').set(auth(admin.token));
    const demote = await request(app).put(`/api/users/${me.body.uuid}`).set(auth(admin.token)).send({ role: 'read' });
    expect(demote.status).toBe(409);
  });

  test('con dos administradores, uno puede pasar a otro rol', async () => {
    const second = await createUser(admin.token, 'admin');
    const res = await request(app).put(`/api/users/${second.uuid}`).set(auth(admin.token)).send({ role: 'medium' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('medium');
  });

  test('un administrador no puede desactivarse a sí mismo', async () => {
    const me = await request(app).get('/api/auth/me').set(auth(admin.token));
    const res = await request(app).put(`/api/users/${me.body.uuid}/toggle-active`).set(auth(admin.token));
    expect(res.status).toBe(400);
  });

  test('restablecer la contraseña cierra las sesiones abiertas', async () => {
    const user = await createUser(admin.token, 'chofer');
    const session = await login(user.username);

    await request(app).put(`/api/users/${user.uuid}/password`).set(auth(admin.token))
      .send({ newPassword: 'Restablecida9' }).expect(200);

    expect((await session.agent.post('/api/auth/refresh')).status).toBe(401);
    await login(user.username, 'Restablecida9');
  });

  test('identificador inválido devuelve 422 y uno inexistente 404', async () => {
    expect((await request(app).get('/api/users/123').set(auth(admin.token))).status).toBe(422);
    expect((await request(app).get('/api/users/00000000-0000-4000-8000-000000000000').set(auth(admin.token))).status).toBe(404);
  });

  test('las acciones quedan en la auditoría', async () => {
    const user = await createUser(admin.token, 'read');
    const res = await request(app).get('/api/audit').query({ action: 'CREATE_USER' }).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.some(e => e.entity_id === user.uuid)).toBe(true);
  });
});
