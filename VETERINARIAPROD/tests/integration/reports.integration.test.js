'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/multibranch', () => ({
  consolidatedFinancials: jest.fn(),
}));
jest.mock('../../shared/export', () => ({
  toExcel: jest.fn(),
  toCsv: jest.fn(),
}));
jest.mock('../../shared/pdf', () => ({
  generateRevenuePdf: jest.fn(),
  generateAppointmentsReportPdf: jest.fn(),
  generateDiagnosesReportPdf: jest.fn(),
}));
jest.mock('../../shared/email', () => ({
  sendReportEmail: jest.fn(),
}));
jest.mock('redis', () => {
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    isReady: true,
  };
  return { createClient: jest.fn(() => client) };
});

process.env.INTERNAL_SECRET = '';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const db = require('../../shared/db');
const { consolidatedFinancials } = require('../../shared/multibranch');
const app = require('../../services/reports/src/index');

const AUTH = {
  'X-User-Id': '1',
  'X-Org-Id': '3',
  'X-Branch-Id': '11',
  'X-User-Roles': 'org_admin',
  'X-User-Email': 'admin@clinic.com',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reports service', () => {
  test('GET /reports/dashboard uses direct branch aggregates', async () => {
    db.query
      .mockResolvedValueOnce([{ total_patients: 50, new_patients: 3 }])
      .mockResolvedValueOnce([{ total_appointments: 10, completed_appointments: 8, cancelled_appointments: 1, no_show_appointments: 1, avg_duration_minutes: 25 }])
      .mockResolvedValueOnce([{ total_invoices: 4, gross_revenue: 1000, collected_revenue: 800, outstanding_revenue: 200 }])
      .mockResolvedValueOnce([{ total_payments: 3, paid_amount: 800 }]);

    const res = await request(app).get('/reports/dashboard').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.totalPatients).toBe(50);
    expect(res.body.data.totalAppointments).toBe(10);
    expect(db.callProc).not.toHaveBeenCalled();
  });

  test('GET /reports/kpis no longer depends on v_branch_daily_kpis', async () => {
    db.query
      .mockResolvedValueOnce([{ total_patients: 40, new_patients: 5 }])
      .mockResolvedValueOnce([{ total_appointments: 20, completed_appointments: 12, cancelled_appointments: 3, no_show_appointments: 2, avg_duration_minutes: 30 }])
      .mockResolvedValueOnce([{ total_invoices: 7, gross_revenue: 2000, collected_revenue: 1500, outstanding_revenue: 500 }])
      .mockResolvedValueOnce([{ total_payments: 5, paid_amount: 1500 }]);

    const res = await request(app).get('/reports/kpis?from=2026-04-01&to=2026-04-30').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.grossRevenue).toBe(2000);
    expect(db.callProc).not.toHaveBeenCalled();
  });

  test('GET /reports/security falls back to base tables', async () => {
    db.query
      .mockResolvedValueOnce([{ id: 1, email: 'u@example.com' }])
      .mockResolvedValueOnce([{ id: 2, user_id: 1 }])
      .mockResolvedValueOnce([{ id: 3, alert_type: 'dlp' }]);

    const res = await request(app).get('/reports/security').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.loginFailures).toHaveLength(1);
    expect(res.body.data.activeSessions).toHaveLength(1);
    expect(res.body.data.unresolvedAlerts).toHaveLength(1);
  });

  test('GET /reports/executive uses consolidatedFinancials instead of stored procedure', async () => {
    consolidatedFinancials.mockResolvedValueOnce({
      totals: { invoices: 9, gross: 5000, collected: 4200, outstanding: 800 },
      revenueByBranch: [{ branch_id: 11, gross_revenue: 5000 }],
      metricsByBranch: [{ branch_id: 11, active_patients: 33, appointments: 44, completion_rate: 90 }],
      topClients: [{ client_name: 'Jane Doe', total_spent: 1000 }],
    });
    db.query
      .mockResolvedValueOnce([{ diagnosis_name: 'Otitis', frequency: 6 }])
      .mockResolvedValueOnce([{ branch_id: 11, occupancy_pct: 50 }]);

    const res = await request(app).get('/reports/executive?from=2026-04-01&to=2026-04-30').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.gross).toBe(5000);
    expect(res.body.data.topDiagnoses).toHaveLength(1);
    expect(db.callProc).not.toHaveBeenCalled();
  });
});
