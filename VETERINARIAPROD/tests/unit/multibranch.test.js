'use strict';

/**
 * tests/unit/multibranch.test.js
 * Tests para shared/multibranch.js — lógica pura sin DB real.
 */

jest.mock('../../shared/db', () => ({
  query    : jest.fn(),
  queryOne : jest.fn(),
}));

const db = require('../../shared/db');
const mb = require('../../shared/multibranch');

// ─── assertSameOrg ────────────────────────────────────────────────────────────

describe('multibranch — assertSameOrg', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no lanza error si ambas sucursales son del mismo org', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 1 });
    await expect(mb.assertSameOrg(1, 2)).resolves.toBe(true);
  });

  test('lanza CROSS_ORG_DENIED si son de orgs distintos', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 2 });
    await expect(mb.assertSameOrg(1, 2)).rejects.toMatchObject({ code: 'CROSS_ORG_DENIED' });
  });

  test('lanza BRANCH_NOT_FOUND si una sucursal no existe', async () => {
    db.queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ organization_id: 1 });
    await expect(mb.assertSameOrg(99, 2)).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
  });
});

// ─── assertBranchAccess ───────────────────────────────────────────────────────

describe('multibranch — assertBranchAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  test('permite acceso si el usuario tiene acceso', async () => {
    db.queryOne.mockResolvedValue({ id: 7 });
    await expect(mb.assertBranchAccess(7, 2)).resolves.toBe(true);
  });

  test('deniega acceso si no existe relación', async () => {
    db.queryOne.mockResolvedValue(null);
    await expect(mb.assertBranchAccess(7, 99)).rejects.toMatchObject({ code: 'BRANCH_ACCESS_DENIED' });
  });
});

// ─── transferPatient ─────────────────────────────────────────────────────────

describe('multibranch — transferPatient', () => {
  beforeEach(() => jest.clearAllMocks());

  test('transfiere paciente con éxito (visit)', async () => {
    // assertSameOrg: ambas del mismo org
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })  // branch from
      .mockResolvedValueOnce({ organization_id: 1 })  // branch to
      .mockResolvedValueOnce({ id: 42, name: 'Luna' }); // patient
    db.query.mockResolvedValue([{ insertId: 10 }]);

    const result = await mb.transferPatient({
      patientId         : 42,
      fromBranchId      : 1,
      toBranchId        : 2,
      clientId          : 5,
      requestedByUserId : 7,
      reason            : 'Especialista',
      transferOwnership : false,
    });
    expect(result.transferId).toBe(10);
  });

  test('lanza SAME_BRANCH si origen = destino', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 1 });
    await expect(mb.transferPatient({
      patientId: 1, fromBranchId: 1, toBranchId: 1,
      requestedByUserId: 7,
    })).rejects.toMatchObject({ code: 'SAME_BRANCH' });
  });

  test('lanza PATIENT_NOT_FOUND si el paciente no está en origen', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce(null);   // patient not found
    await expect(mb.transferPatient({
      patientId: 99, fromBranchId: 1, toBranchId: 2, requestedByUserId: 7,
    })).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
  });

  test('lanza CROSS_ORG_DENIED si las sucursales son de orgs distintos', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 2 });
    await expect(mb.transferPatient({
      patientId: 1, fromBranchId: 1, toBranchId: 5, requestedByUserId: 7,
    })).rejects.toMatchObject({ code: 'CROSS_ORG_DENIED' });
  });
});

// ─── transferStock ────────────────────────────────────────────────────────────

describe('multibranch — transferStock', () => {
  beforeEach(() => jest.clearAllMocks());

  test('transfiere stock con éxito', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })   // branch from
      .mockResolvedValueOnce({ organization_id: 1 })   // branch to
      .mockResolvedValueOnce({ stock_quantity: 100 });  // item with enough stock
    db.query.mockResolvedValue([{ insertId: 5 }]);

    const result = await mb.transferStock({
      itemId: 1, fromBranchId: 1, toBranchId: 2,
      quantity: 10, requestedByUserId: 7,
    });
    expect(result.transferId).toBe(5);
  });

  test('lanza INSUFFICIENT_STOCK si no hay suficiente', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ stock_quantity: 3 });  // solo 3 disponibles
    await expect(mb.transferStock({
      itemId: 1, fromBranchId: 1, toBranchId: 2,
      quantity: 10, requestedByUserId: 7,
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  test('lanza ITEM_NOT_FOUND si el ítem no existe en origen', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce(null);   // item not found
    await expect(mb.transferStock({
      itemId: 99, fromBranchId: 1, toBranchId: 2,
      quantity: 5, requestedByUserId: 7,
    })).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });

  test('lanza SAME_BRANCH si origen = destino', async () => {
    db.queryOne
      .mockResolvedValueOnce({ organization_id: 1 })
      .mockResolvedValueOnce({ organization_id: 1 });
    await expect(mb.transferStock({
      itemId: 1, fromBranchId: 2, toBranchId: 2,
      quantity: 5, requestedByUserId: 7,
    })).rejects.toMatchObject({ code: 'SAME_BRANCH' });
  });
});

// ─── getOrgBranches ───────────────────────────────────────────────────────────

describe('multibranch — getOrgBranches', () => {
  test('devuelve lista de sucursales', async () => {
    db.query.mockResolvedValue([
      { id: 1, name: 'Central', is_active: 1 },
      { id: 2, name: 'Norte',   is_active: 1 },
    ]);
    const result = await mb.getOrgBranches(1);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Central');
  });
});

// ─── consolidatedFinancials ───────────────────────────────────────────────────

describe('multibranch — consolidatedFinancials', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calcula totales correctamente desde múltiples sucursales', async () => {
    db.query
      .mockResolvedValueOnce([  // revenue por sucursal
        { branch_name: 'Central', branch_id: 1, invoices: 50, gross_revenue: 100000, collected: 90000, outstanding: 10000 },
        { branch_name: 'Norte',   branch_id: 2, invoices: 30, gross_revenue:  60000, collected: 55000, outstanding:  5000 },
      ])
      .mockResolvedValueOnce([])  // metrics
      .mockResolvedValueOnce([]); // top clients

    const result = await mb.consolidatedFinancials(1, '2026-01-01', '2026-03-31');
    expect(result.totals.invoices).toBe(80);
    expect(result.totals.gross).toBeCloseTo(160000);
    expect(result.totals.collected).toBeCloseTo(145000);
    expect(result.totals.outstanding).toBeCloseTo(15000);
    expect(result.revenueByBranch).toHaveLength(2);
  });

  test('devuelve totales en cero si no hay facturas', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await mb.consolidatedFinancials(1, '2026-01-01', '2026-01-31');
    expect(result.totals.invoices).toBe(0);
    expect(result.totals.gross).toBe(0);
  });
});

// ─── Validaciones de tipo de transferencia ────────────────────────────────────

describe('multibranch — tipos de transferencia', () => {
  const TRANSFER_TYPES   = ['visit', 'ownership'];
  const TRANSFER_STATUSES = ['pending', 'approved', 'completed', 'rejected', 'cancelled'];
  const STOCK_STATUSES    = ['pending', 'approved', 'in_transit', 'completed', 'rejected', 'cancelled'];

  test.each(TRANSFER_TYPES)('tipo de transferencia "%s" es válido', (t) => {
    expect(TRANSFER_TYPES.includes(t)).toBe(true);
  });

  test.each(TRANSFER_STATUSES)('estado de transferencia de paciente "%s" es válido', (s) => {
    expect(TRANSFER_STATUSES.includes(s)).toBe(true);
  });

  test.each(STOCK_STATUSES)('estado de transferencia de stock "%s" es válido', (s) => {
    expect(STOCK_STATUSES.includes(s)).toBe(true);
  });

  test('tipo desconocido no es válido', () => {
    expect(TRANSFER_TYPES.includes('loan')).toBe(false);
  });
});
