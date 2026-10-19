const { app, request, login, auth } = require('./helpers');

let admin, operador, lector;

beforeAll(async () => {
  admin    = await login('admin');
  operador = await login('operador1');
  lector   = await login('lector1');
});

describe('Datos geográficos', () => {
  test('provincias, partidos y localidades', async () => {
    const provinces = await request(app).get('/api/geo/provinces').set(auth(lector.token));
    expect(provinces.status).toBe(200);
    expect(provinces.body.length).toBe(24);

    const caba = provinces.body.find(p => p.code === 'AR-B');
    const partidos = await request(app).get(`/api/geo/provinces/${caba.id}/partidos`).set(auth(lector.token));
    expect(partidos.body.length).toBeGreaterThan(100);

    // Sin partidos repetidos dentro de una provincia
    const names = partidos.body.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('tipos de incidente con sus subtipos', async () => {
    const res = await request(app).get('/api/geo/incident-types').set(auth(lector.token));
    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('subtypes');
  });
});

describe('Infraestructura y comisarías', () => {
  const hospital = {
    type: 'HOSPITAL', name: 'Hospital de prueba', address: 'Calle Falsa 123', phone: '011 4000-0000',
    latitude: -34.6, longitude: -58.45, beds: 120, level: 'Alta complejidad',
  };

  test('alta, edición y baja de un punto de infraestructura', async () => {
    const created = await request(app).post('/api/geo/infrastructure').set(auth(operador.token)).send(hospital);
    expect(created.status).toBe(201);
    const id = created.body.id;

    // La caché se invalida: el nuevo punto aparece enseguida
    let list = await request(app).get('/api/geo/infrastructure').query({ type: 'HOSPITAL' }).set(auth(lector.token));
    expect(list.body.some(p => p.id === id)).toBe(true);

    await request(app).put(`/api/geo/infrastructure/${id}`).set(auth(admin.token)).send({ beds: 150 }).expect(200);
    list = await request(app).get('/api/geo/infrastructure').query({ type: 'HOSPITAL' }).set(auth(lector.token));
    expect(list.body.find(p => p.id === id)).toMatchObject({ beds: 150, name: 'Hospital de prueba' });

    await request(app).delete(`/api/geo/infrastructure/${id}`).set(auth(admin.token)).expect(200);
    list = await request(app).get('/api/geo/infrastructure').set(auth(lector.token));
    expect(list.body.some(p => p.id === id)).toBe(false);

    expect((await request(app).put(`/api/geo/infrastructure/${id}`).set(auth(admin.token)).send({ beds: 1 })).status).toBe(404);
  });

  test('valida tipo, nombre y coordenadas', async () => {
    const res = await request(app).post('/api/geo/infrastructure').set(auth(admin.token))
      .send({ type: 'CASINO', name: '', latitude: 51.5, longitude: 0 });
    expect(res.status).toBe(422);
    expect(res.body.errors.map(e => e.field)).toEqual(expect.arrayContaining(['type', 'name', 'latitude', 'longitude']));
  });

  test('el rol de lectura no puede modificar', async () => {
    const res = await request(app).post('/api/geo/infrastructure').set(auth(lector.token)).send(hospital);
    expect(res.status).toBe(403);
  });

  test('alta y baja de comisarías', async () => {
    const created = await request(app).post('/api/geo/police-stations').set(auth(operador.token))
      .send({ name: 'Comisaría Vecinal 99', latitude: -34.62, longitude: -58.44 });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/geo/police-stations').set(auth(lector.token));
    expect(list.body.some(s => s.id === created.body.id)).toBe(true);

    await request(app).delete(`/api/geo/police-stations/${created.body.id}`).set(auth(operador.token)).expect(200);
  });
});
