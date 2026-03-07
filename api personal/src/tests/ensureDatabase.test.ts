// src/tests/ensureDatabase.test.ts
describe('ensureDatabase', () => {
  it('exporta la función ensureDatabase', async () => {
    // No conectamos a DB real en test unitario
    const mod = await import('../db/ensureDatabase');
    expect(typeof mod.ensureDatabase).toBe('function');
  });
});
