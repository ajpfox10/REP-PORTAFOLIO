'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/multibranch', () => ({
  consolidatedFinancials: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/pdf', () => ({
  generateInvoicePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
}));
jest.mock('../../shared/mercadopago', () => ({
  createPreference: jest.fn().mockResolvedValue({ preferenceId: 'pref-1' }),
  getPayment: jest.fn().mockResolvedValue({ status: 'approved', transaction_amount: 100, payment_type_id: 'card' }),
  mapMpStatus: jest.fn((status) => (status === 'approved' ? 'completed' : status)),
  validateWebhookSignature: jest.fn().mockReturnValue(true),
  refundPayment: jest.fn().mockResolvedValue({ id: 'ref-1', status: 'refunded' }),
}));
jest.mock('../../shared/afip', () => ({
  getTipoComprobante: jest.fn(() => 1),
  TIPO_DOC: { CUIT: 80, DNI: 96, CONSUMIDOR_FINAL: 99 },
  authorizeVoucher: jest.fn().mockResolvedValue({ cae: 'CAE-1', caeFechaVencimiento: '2026-05-01', puntoVenta: 1, nroComprobante: 10 }),
}));
jest.mock('../../shared/webhooks/dispatcher', () => ({
  enqueue: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/stripe', () => ({
  createSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  getBillingPortalUrl: jest.fn(),
  constructWebhookEvent: jest.fn(),
}));
jest.mock('../../services/billing/src/routes/stripe.routes', () => ({
  router: require('express')(),
}));

const request = require('supertest');
const db = require('../../shared/db');

process.env.INTERNAL_SECRET = '';
process.env.NODE_ENV = 'test';

const app = require('../../services/billing/src/index');

const AUTH = {
  'x-user-id': '1',
  'x-org-id': '10',
  'x-branch-id': '5',
  'x-user-roles': 'org_admin',
  'x-user-email': 'admin@clinic.com',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('billing service', () => {
  test('POST /invoices creates invoice without stored procedure', async () => {
    const executed = [];
    db.transaction.mockImplementation(async (fn) => {
      const conn = {
        query: jest.fn(async (sql) => {
          executed.push(sql);
          if (sql.includes('SELECT COALESCE(MAX(id), 0) + 1 AS seq FROM invoices')) {
            return [{ seq: 42 }];
          }
          if (sql.includes('INSERT INTO invoices')) {
            return [{ insertId: 9001 }];
          }
          return [{}];
        }),
        queryOne: jest.fn(),
      };
      return fn(conn);
    });

    const res = await request(app)
      .post('/invoices')
      .set(AUTH)
      .send({
        clientId: 33,
        patientId: 44,
        currencyId: 1,
        items: [{ description: 'Consulta', quantity: 1, unitPrice: 1000, taxPct: 21, discountPct: 0 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.invoice_number).toMatch(/^INV-5-/);
    expect(executed.some(sql => sql.includes('sp_generate_invoice'))).toBe(false);
    expect(executed.some(sql => sql.includes('INSERT INTO invoices'))).toBe(true);
    expect(executed.some(sql => sql.includes('INSERT INTO invoice_items'))).toBe(true);
  });

  test('POST /payments records payment without stored procedure', async () => {
    const executed = [];
    db.transaction.mockImplementation(async (fn) => {
      const conn = {
        query: jest.fn(async (sql) => {
          executed.push(sql);
          if (sql.includes('SELECT id, total_amount, paid_amount, status')) {
            return [{ id: 77, total_amount: 500, paid_amount: 100, status: 'partial' }];
          }
          if (sql.includes('INSERT INTO payments')) {
            return [{ insertId: 12 }];
          }
          return [{}];
        }),
        queryOne: jest.fn(async (sql) => {
          executed.push(sql);
          return { id: 77, total_amount: 500, paid_amount: 100, status: 'partial' };
        }),
      };
      return fn(conn);
    });

    const res = await request(app)
      .post('/payments')
      .set(AUTH)
      .send({
        invoiceId: 77,
        amount: 150,
        paymentMethod: 'cash',
        reference: 'RC-1',
        notes: 'Pago parcial',
      });

    expect(res.status).toBe(201);
    expect(executed.some(sql => sql.includes('sp_record_payment'))).toBe(false);
    expect(executed.some(sql => sql.includes('INSERT INTO payments'))).toBe(true);
    expect(executed.some(sql => sql.includes('UPDATE invoices'))).toBe(true);
  });
});
