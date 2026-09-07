'use strict';

const {
  CircuitBreaker,
  getBreaker,
  getAllStatus,
  _resetAll,
  CLOSED, OPEN, HALF_OPEN,
} = require('../../shared/circuitBreaker');

beforeEach(() => _resetAll());

describe('CircuitBreaker — estado inicial', () => {
  test('estado inicial es CLOSED', () => {
    const cb = new CircuitBreaker('svc');
    expect(cb.state).toBe(CLOSED);
  });

  test('canRequest() devuelve true en CLOSED', () => {
    const cb = new CircuitBreaker('svc');
    expect(cb.canRequest()).toBe(true);
  });

  test('getStatus() devuelve name, state y failures', () => {
    const cb = new CircuitBreaker('svc');
    const s  = cb.getStatus();
    expect(s).toMatchObject({ name: 'svc', state: CLOSED, failures: 0 });
  });
});

describe('CircuitBreaker — transición CLOSED → OPEN', () => {
  test('abre al alcanzar threshold de fallos', () => {
    const cb = new CircuitBreaker('svc', { threshold: 3 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe(CLOSED);
    cb.onFailure();
    expect(cb.state).toBe(OPEN);
  });

  test('canRequest() devuelve false cuando OPEN (dentro del timeout)', () => {
    const cb = new CircuitBreaker('svc', { threshold: 1, timeout: 60000 });
    cb.onFailure();
    expect(cb.state).toBe(OPEN);
    expect(cb.canRequest()).toBe(false);
  });

  test('onSuccess() en CLOSED resetea el contador de fallos', () => {
    const cb = new CircuitBreaker('svc', { threshold: 3 });
    cb.onFailure();
    cb.onFailure();
    cb.onSuccess();
    expect(cb._failures).toBe(0);
    expect(cb.state).toBe(CLOSED);
  });
});

describe('CircuitBreaker — transición OPEN → HALF_OPEN → CLOSED', () => {
  test('canRequest() devuelve true cuando timeout expiró', () => {
    const cb = new CircuitBreaker('svc', { threshold: 1, timeout: 0 });
    cb.onFailure();
    expect(cb.state).toBe(OPEN);
    // timeout=0 → ya expiró
    expect(cb.canRequest()).toBe(true);
    expect(cb.state).toBe(HALF_OPEN);
  });

  test('suficientes successes en HALF_OPEN cierran el circuito', () => {
    const cb = new CircuitBreaker('svc', { threshold: 1, timeout: 0, successReq: 2 });
    cb.onFailure();
    cb.canRequest(); // → HALF_OPEN
    cb.onSuccess();
    expect(cb.state).toBe(HALF_OPEN); // aún necesita 1 más
    cb.onSuccess();
    expect(cb.state).toBe(CLOSED);
    expect(cb._failures).toBe(0);
  });

  test('fallo en HALF_OPEN vuelve a OPEN inmediatamente', () => {
    const cb = new CircuitBreaker('svc', { threshold: 1, timeout: 0 });
    cb.onFailure();
    cb.canRequest(); // → HALF_OPEN
    cb.onFailure();
    expect(cb.state).toBe(OPEN);
  });
});

describe('CircuitBreaker — registry (getBreaker / getAllStatus)', () => {
  test('getBreaker devuelve la misma instancia para el mismo nombre', () => {
    const a = getBreaker('patients');
    const b = getBreaker('patients');
    expect(a).toBe(b);
  });

  test('getBreaker crea instancias distintas para nombres distintos', () => {
    const a = getBreaker('patients');
    const b = getBreaker('medical');
    expect(a).not.toBe(b);
  });

  test('getAllStatus lista todos los breakers registrados', () => {
    getBreaker('auth');
    getBreaker('billing');
    const statuses = getAllStatus();
    const names = statuses.map(s => s.name);
    expect(names).toContain('auth');
    expect(names).toContain('billing');
  });

  test('_resetAll limpia el registro', () => {
    getBreaker('svc');
    _resetAll();
    expect(getAllStatus()).toHaveLength(0);
  });
});
