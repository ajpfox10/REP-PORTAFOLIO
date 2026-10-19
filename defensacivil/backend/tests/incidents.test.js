const { app, request, login, auth, createUser, validIncident } = require('./helpers');

let admin, operador, lector, chofer, telefonista;

beforeAll(async () => {
  admin       = await login('admin');
  operador    = await login('operador1');
  lector      = await login('lector1');
  chofer      = await login('chofer1');
  telefonista = await login('telefonista1');
});

const create = (token, data) => request(app).post('/api/incidents').set(auth(token)).send(validIncident(data));

describe('Incidentes', () => {
  test('el alta asigna número correlativo, estado RECIBIDO e historial', async () => {
    const a = await create(telefonista.token);
    const b = await create(telefonista.token);

    expect(a.status).toBe(201);
    expect(a.body.status).toBe('RECIBIDO');
    expect(a.body.incident_number).toMatch(/^DC-\d{4}-\d{6}$/);
    const seq = s => Number(s.incident_number.split('-')[2]);
    expect(seq(b.body)).toBe(seq(a.body) + 1);

    const history = await request(app).get(`/api/incidents/${a.body.uuid}/history`).set(auth(lector.token));
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ new_status: 'RECIBIDO', previous_status: null });
  });

  test('altas simultáneas nunca repiten número', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => create(admin.token)));
    expect(results.every(r => r.status === 201)).toBe(true);
    const numbers = results.map(r => r.body.incident_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test('el estado no se puede fijar en el alta', async () => {
    const res = await create(admin.token, { status: 'CERRADO' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('RECIBIDO');
  });

  test('rechaza coordenadas fuera de Argentina y textos cortos', async () => {
    const res = await create(admin.token, { latitude: 40.4, longitude: -3.7, title: 'X' });
    expect(res.status).toBe(422);
    expect(res.body.errors.map(e => e.field)).toEqual(expect.arrayContaining(['latitude', 'longitude', 'title']));
  });

  test('el rol de lectura no puede crear, editar ni cargar notas', async () => {
    const inc = (await create(admin.token)).body;
    expect((await create(lector.token)).status).toBe(403);
    expect((await request(app).put(`/api/incidents/${inc.uuid}`).set(auth(lector.token)).send({ priority: 'BAJA' })).status).toBe(403);
    expect((await request(app).post(`/api/incidents/${inc.uuid}/note`).set(auth(lector.token)).send({ notes: 'hola' })).status).toBe(403);
  });

  test('el chofer informa estado y ubicación desde el lugar', async () => {
    const inc = (await create(telefonista.token)).body;

    const res = await request(app).post(`/api/incidents/${inc.uuid}/note`).set(auth(chofer.token))
      .send({ status: 'EN_ESCENA', notes: 'Llegamos al lugar', latitude: -34.61, longitude: -58.39 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EN_ESCENA');
    expect(res.body.latitude).toBeCloseTo(-34.61);

    const history = await request(app).get(`/api/incidents/${inc.uuid}/history`).set(auth(admin.token));
    expect(history.body.at(-1)).toMatchObject({ previous_status: 'RECIBIDO', new_status: 'EN_ESCENA', notes: 'Llegamos al lugar' });
  });

  test('la nota valida estado, coordenadas y que haya algo que informar', async () => {
    const inc = (await create(admin.token)).body;
    const post = body => request(app).post(`/api/incidents/${inc.uuid}/note`).set(auth(chofer.token)).send(body);

    expect((await post({})).status).toBe(422);
    expect((await post({ status: 'INVENTADO' })).status).toBe(422);
    expect((await post({ latitude: -34.6 })).status).toBe(422);
    expect((await post({ latitude: 10, longitude: 10 })).status).toBe(422);
  });

  test('cerrar un incidente completa la fecha de cierre y queda en el historial', async () => {
    const inc = (await create(admin.token)).body;
    const res = await request(app).post(`/api/incidents/${inc.uuid}/status`).set(auth(operador.token))
      .send({ status: 'CERRADO', notes: 'Finalizado' });

    expect(res.status).toBe(200);
    expect(res.body.closed_at).not.toBeNull();
  });

  test('cambiar el estado editando también deja registro en el historial', async () => {
    const inc = (await create(admin.token)).body;
    await request(app).put(`/api/incidents/${inc.uuid}`).set(auth(admin.token)).send({ status: 'CONTROLADO' }).expect(200);

    const history = await request(app).get(`/api/incidents/${inc.uuid}/history`).set(auth(admin.token));
    expect(history.body.map(h => h.new_status)).toEqual(['RECIBIDO', 'CONTROLADO']);

    const detail = await request(app).get(`/api/incidents/${inc.uuid}`).set(auth(admin.token));
    expect(detail.body.controlled_at).not.toBeNull();
  });

  test('un operador solo edita sus propios incidentes', async () => {
    const ajeno = (await create(admin.token)).body;
    const propio = (await create(operador.token)).body;

    expect((await request(app).put(`/api/incidents/${ajeno.uuid}`).set(auth(operador.token)).send({ priority: 'BAJA' })).status).toBe(403);
    expect((await request(app).put(`/api/incidents/${propio.uuid}`).set(auth(operador.token)).send({ priority: 'BAJA' })).status).toBe(200);
  });

  test('la búsqueda trata % y _ como texto, no como comodines', async () => {
    await create(admin.token, { title: 'Corte total en avenida 100% bloqueada' });

    const all = await request(app).get('/api/incidents').query({ search: '%' }).set(auth(admin.token));
    const exact = await request(app).get('/api/incidents').query({ search: '100%' }).set(auth(admin.token));

    expect(exact.body.total).toBe(1);
    expect(all.body.total).toBe(1);
  });

  test('filtros inválidos devuelven 422', async () => {
    const res = await request(app).get('/api/incidents').query({ status: 'NADA', dateFrom: 'ayer' }).set(auth(admin.token));
    expect(res.status).toBe(422);
  });

  test('un incidente eliminado deja de verse en detalle, historial y mapa', async () => {
    const inc = (await create(admin.token)).body;
    expect((await request(app).delete(`/api/incidents/${inc.uuid}`).set(auth(operador.token))).status).toBe(403);
    await request(app).delete(`/api/incidents/${inc.uuid}`).set(auth(admin.token)).expect(200);

    expect((await request(app).get(`/api/incidents/${inc.uuid}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`/api/incidents/${inc.uuid}/history`).set(auth(admin.token))).status).toBe(404);
    const map = await request(app).get('/api/incidents/map').set(auth(admin.token));
    expect(map.body.some(p => p.uuid === inc.uuid)).toBe(false);
  });

  test('unidades y recursos se agregan y quitan', async () => {
    const inc = (await create(admin.token)).body;
    const unit = await request(app).post(`/api/incidents/${inc.uuid}/units`).set(auth(operador.token))
      .send({ unit_name: 'Dotación 12', unit_type: 'BOMBEROS', personnel_count: 6, arrived_at: new Date().toISOString() });
    expect(unit.status).toBe(201);

    const resource = await request(app).post(`/api/incidents/${inc.uuid}/resources`).set(auth(operador.token))
      .send({ resource_type: 'EQUIPO', resource_name: 'Motobomba', quantity: 2 });
    expect(resource.status).toBe(201);

    const detail = await request(app).get(`/api/incidents/${inc.uuid}`).set(auth(lector.token));
    expect(detail.body.units).toHaveLength(1);
    expect(detail.body.resources).toHaveLength(1);

    await request(app).delete(`/api/incidents/${inc.uuid}/units/${unit.body.id}`).set(auth(operador.token)).expect(200);
    await request(app).delete(`/api/incidents/${inc.uuid}/units/${unit.body.id}`).set(auth(operador.token)).expect(404);
  });

  test('el tablero devuelve totales y la serie de los últimos 14 días', async () => {
    const res = await request(app).get('/api/incidents/dashboard').set(auth(lector.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      today: expect.any(Number), open: expect.any(Number), critical: expect.any(Number), month: expect.any(Number),
    });
    expect(res.body.byDay).toHaveLength(14);
    expect(res.body.byDay.at(-1).count).toBeGreaterThan(0);
    expect(res.body.byType.length).toBeGreaterThan(0);
  });

  test('los operadores ven solo sus incidentes en el listado', async () => {
    const user = await createUser(admin.token, 'medium');
    const session = await login(user.username);
    await create(session.token, { title: 'Incidente propio del operador nuevo' });

    const res = await request(app).get('/api/incidents').set(auth(session.token));
    expect(res.body.total).toBe(1);
  });
});
