'use strict';

const mockDb = { query: jest.fn(), queryOne: jest.fn() };
const mockSend = jest.fn();

jest.mock('../../services/reports/src/reports.common', () => ({
  db: mockDb,
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sendReportEmail: (...args) => mockSend(...args),
  calcNextRun: jest.fn(() => new Date('2026-10-26T07:00:00Z')),
  fetchReportData: jest.fn().mockResolvedValue([{ period: '2026-10', gross_revenue: '100.00' }]),
  defaultCols: jest.fn(() => [{ key: 'period', header: 'Período' }]),
  toExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
  toCsv: jest.fn(() => 'period\n2026-10'),
  generateRevenuePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
  generateAppointmentsReportPdf: jest.fn(),
  generateDiagnosesReportPdf: jest.fn(),
}));

const scheduler = require('../../services/reports/src/scheduler');

const REPORT = {
  id: 9, org_id: 3, branch_id: 4, name: 'Ingresos', report_type: 'revenue', format: 'excel',
  frequency: 'weekly', day_of_week: 1, recipients: ['a@clinica.test', 'b@clinica.test'],
  next_run_at: new Date('2026-10-19T07:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockReset();
  mockSend.mockReset().mockResolvedValue(undefined);
});

describe('reports scheduler — destinatarios', () => {
  test('acepta columna JSON ya parseada, string JSON o lista separada por comas', () => {
    const { parseRecipients } = scheduler._private;
    expect(parseRecipients(['a@x.com', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
    expect(parseRecipients('["a@x.com"]')).toEqual(['a@x.com']);
    expect(parseRecipients('a@x.com, b@x.com')).toEqual(['a@x.com', 'b@x.com']);
    expect(parseRecipients('no-es-un-email')).toEqual([]);
  });
});

describe('reports scheduler — runDueReports', () => {
  test('ejecuta un reporte vencido, lo envía y reprograma', async () => {
    mockDb.query
      .mockResolvedValueOnce([REPORT])                    // SELECT vencidos
      .mockResolvedValueOnce([{ affectedRows: 1 }])       // reclamo
      .mockResolvedValueOnce([{ insertId: 77 }])          // INSERT report_runs
      .mockResolvedValue([{ affectedRows: 1 }]);          // updates finales

    await expect(scheduler.runDueReports()).resolves.toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0]).toMatchObject({ email: 'a@clinica.test', filename: 'revenue.xlsx' });
    const completed = mockDb.query.mock.calls.find(([sql]) => sql.includes("status='completed'"));
    expect(completed[1]).toEqual({ sz: 4, id: 77 });
  });

  test('no ejecuta un reporte que otra instancia ya reclamó', async () => {
    mockDb.query
      .mockResolvedValueOnce([REPORT])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(scheduler.runDueReports()).resolves.toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockDb.query).toHaveBeenCalledTimes(2);
  });

  test('marca la ejecución como fallida si no llega a ningún destinatario', async () => {
    mockSend.mockRejectedValue(new Error('SMTP caído'));
    mockDb.query.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await scheduler.executeScheduledReport(REPORT, 5);

    expect(result.status).toBe('failed');
    const failed = mockDb.query.mock.calls.find(([sql]) => sql.includes("status='failed'"));
    expect(failed[1]).toMatchObject({ id: 5 });
  });

  test('genera CSV cuando ese es el formato elegido', async () => {
    mockDb.query.mockResolvedValue([{ affectedRows: 1 }]);
    await scheduler.executeScheduledReport({ ...REPORT, format: 'csv' }, 6);
    expect(mockSend.mock.calls[0][0]).toMatchObject({ filename: 'revenue.csv', mimeType: 'text/csv; charset=utf-8' });
  });
});
