'use strict';

// Mock cache para no necesitar Redis
jest.mock('../../shared/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
}));

const cache = require('../../shared/cache');
const { isEnabled, getFlags, setFlag, requireFeature, DEFAULT_FLAGS } = require('../../shared/featureFlags');

beforeEach(() => {
  jest.clearAllMocks();
  cache.get.mockResolvedValue(null);
});

describe('DEFAULT_FLAGS', () => {
  test('tiene flags de AI definidos', () => {
    expect(DEFAULT_FLAGS).toHaveProperty('ai_diagnosis');
    expect(DEFAULT_FLAGS).toHaveProperty('ai_image_analysis');
    expect(DEFAULT_FLAGS).toHaveProperty('ai_chatbot');
    expect(DEFAULT_FLAGS).toHaveProperty('ai_risk_assessment');
  });

  test('AI flags desactivados por defecto', () => {
    expect(DEFAULT_FLAGS.ai_diagnosis).toBe(false);
    expect(DEFAULT_FLAGS.ai_chatbot).toBe(false);
  });

  test('telemedicine activo por defecto', () => {
    expect(DEFAULT_FLAGS.telemedicine).toBe(true);
  });
});

describe('isEnabled()', () => {
  test('devuelve false para flag AI sin override (default)', async () => {
    expect(await isEnabled('ai_diagnosis', '42')).toBe(false);
  });

  test('devuelve true para telemedicine sin override (default)', async () => {
    expect(await isEnabled('telemedicine', '42')).toBe(true);
  });

  test('override en cache cambia el valor', async () => {
    cache.get.mockResolvedValue({ ...DEFAULT_FLAGS, ai_diagnosis: true });
    expect(await isEnabled('ai_diagnosis', '42')).toBe(true);
  });

  test('flag desconocido devuelve false', async () => {
    expect(await isEnabled('flag_inexistente', '42')).toBe(false);
  });

  test('sin orgId devuelve default', async () => {
    expect(await isEnabled('ai_diagnosis', null)).toBe(false);
    expect(await isEnabled('telemedicine', null)).toBe(true);
  });
});

describe('getFlags()', () => {
  test('sin orgId devuelve todos los defaults', async () => {
    const flags = await getFlags(null);
    expect(flags).toMatchObject(DEFAULT_FLAGS);
  });

  test('miss de cache → guarda en cache y retorna defaults', async () => {
    await getFlags('99');
    expect(cache.set).toHaveBeenCalledWith('ff:org:99', expect.any(Object), expect.any(Number));
  });

  test('hit de cache → retorna valores sin llamar set', async () => {
    const custom = { ...DEFAULT_FLAGS, ai_diagnosis: true };
    cache.get.mockResolvedValue(custom);
    const flags = await getFlags('99');
    expect(flags.ai_diagnosis).toBe(true);
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe('setFlag()', () => {
  test('actualiza el flag en cache', async () => {
    cache.get.mockResolvedValue({ ...DEFAULT_FLAGS });
    await setFlag('42', 'ai_diagnosis', true);
    expect(cache.set).toHaveBeenCalledWith(
      'ff:org:42',
      expect.objectContaining({ ai_diagnosis: true }),
      expect.any(Number)
    );
  });
});

describe('requireFeature() middleware', () => {
  function makeReqRes(orgId) {
    const req = { user: { orgId }, headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    return { req, res, next };
  }

  test('pasa cuando el flag está activo', async () => {
    cache.get.mockResolvedValue({ ...DEFAULT_FLAGS, ai_diagnosis: true });
    const { req, res, next } = makeReqRes('42');
    await requireFeature('ai_diagnosis')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('bloquea con 403 cuando el flag está inactivo', async () => {
    const { req, res, next } = makeReqRes('42');
    await requireFeature('ai_diagnosis')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'FEATURE_DISABLED' }),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('pasa cuando cache falla (fail-open)', async () => {
    cache.get.mockRejectedValue(new Error('Redis down'));
    cache.set.mockRejectedValue(new Error('Redis down'));
    const { req, res, next } = makeReqRes('42');
    await requireFeature('ai_diagnosis')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
