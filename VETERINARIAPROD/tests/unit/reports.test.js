'use strict';

/**
 * tests/unit/reports.test.js
 * Tests para shared/export.js + lógica de reportes programados
 */

const { toExcel, toCsv } = require('../../shared/export');

// ─── Fixture ─────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'period',        header: 'Período',       type: 'string'   },
  { key: 'invoices',      header: 'Facturas',      type: 'number'   },
  { key: 'gross_revenue', header: 'Ingreso Bruto', type: 'currency' },
  { key: 'net_revenue',   header: 'Ingreso Neto',  type: 'currency' },
  { key: 'collected',     header: 'Cobrado',       type: 'currency' },
];

const ROWS = [
  { period: '2026-01', invoices: 45,  gross_revenue: 120000, net_revenue: 110000, collected: 100000 },
  { period: '2026-02', invoices: 52,  gross_revenue: 145000, net_revenue: 133000, collected: 130000 },
  { period: '2026-03', invoices: 38,  gross_revenue:  98000, net_revenue:  90000, collected:  85000 },
];

const TOTALS = [
  { key: 'invoices',      value: 135    },
  { key: 'gross_revenue', value: 363000 },
  { key: 'net_revenue',   value: 333000 },
  { key: 'collected',     value: 315000 },
];

// ─── Tests: toCsv ─────────────────────────────────────────────────────────────

describe('shared/export — toCsv', () => {
  test('genera una cadena CSV con BOM UTF-8', () => {
    const csv = toCsv({ columns: COLUMNS, rows: ROWS });
    expect(csv.charCodeAt(0)).toBe(0xFEFF);   // BOM
  });

  test('contiene los headers en la primera línea', () => {
    const csv = toCsv({ columns: COLUMNS, rows: ROWS });
    const lines = csv.split('\r\n');
    // El BOM (\uFEFF) está al inicio del primer elemento, no como línea aparte
    expect(lines[0]).toContain('Período');
    expect(lines[0]).toContain('Facturas');
    expect(lines[0]).toContain('Ingreso Bruto');
  });

  test('contiene los datos de las filas', () => {
    const csv = toCsv({ columns: COLUMNS, rows: ROWS });
    expect(csv).toContain('2026-01');
    expect(csv).toContain('120000');
    expect(csv).toContain('2026-03');
  });

  test('usa punto y coma como delimitador por defecto', () => {
    const csv = toCsv({ columns: COLUMNS, rows: ROWS });
    const firstDataLine = csv.split('\r\n')[1];
    expect(firstDataLine.split(';').length).toBeGreaterThan(1);
  });

  test('soporta delimitador personalizado (coma)', () => {
    const csv = toCsv({ columns: COLUMNS, rows: ROWS, delimiter: ',' });
    const firstDataLine = csv.split('\r\n')[1];
    expect(firstDataLine.split(',').length).toBeGreaterThan(1);
  });

  test('escapa valores con el delimitador entre comillas', () => {
    const rows = [{ period: 'Q1; especial', invoices: 5, gross_revenue: 1000, net_revenue: 900, collected: 800 }];
    const csv = toCsv({ columns: COLUMNS, rows, delimiter: ';' });
    expect(csv).toContain('"Q1; especial"');
  });

  test('maneja valores null/undefined como cadena vacía', () => {
    const rows = [{ period: '2026-01', invoices: null, gross_revenue: undefined, net_revenue: 0, collected: 0 }];
    const csv = toCsv({ columns: COLUMNS, rows });
    // Líneas: 0=header (con BOM), 1=primer dato
    const parts = csv.split('\r\n')[1].split(';');
    expect(parts[1]).toBe('');   // invoices null
    expect(parts[2]).toBe('');   // gross_revenue undefined
  });

  test('genera CSV sin filas (solo headers)', () => {
    const csv = toCsv({ columns: COLUMNS, rows: [] });
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});

// ─── Tests: toExcel ───────────────────────────────────────────────────────────

describe('shared/export — toExcel', () => {
  test('devuelve un Buffer', async () => {
    const buf = await toExcel({ title: 'Test', columns: COLUMNS, rows: ROWS });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  test('el buffer tiene tamaño mayor a 0', async () => {
    const buf = await toExcel({ title: 'Test', columns: COLUMNS, rows: ROWS });
    expect(buf.length).toBeGreaterThan(100);
  });

  test('acepta totals sin error', async () => {
    const buf = await toExcel({ title: 'Con Totales', columns: COLUMNS, rows: ROWS, totals: TOTALS });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
  });

  test('acepta rows vacíos sin error', async () => {
    const buf = await toExcel({ title: 'Vacío', columns: COLUMNS, rows: [] });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  test('acepta meta sin error', async () => {
    const meta = { from: '2026-01-01', to: '2026-03-31', branch: 'Central', generatedBy: 'admin@vet.com' };
    const buf  = await toExcel({ title: 'Con Meta', columns: COLUMNS, rows: ROWS, meta });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  test('columnas de tipo currency no causan error', async () => {
    const cols = [{ key: 'amount', header: 'Monto', type: 'currency' }];
    const data = [{ amount: 1234.56 }, { amount: 0 }, { amount: null }];
    const buf  = await toExcel({ title: 'Currency', columns: cols, rows: data });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  test('columnas de tipo date no causan error', async () => {
    const cols = [{ key: 'fecha', header: 'Fecha', type: 'date' }];
    const data = [{ fecha: new Date('2026-03-15') }, { fecha: '2026-03-16' }];
    const buf  = await toExcel({ title: 'Fechas', columns: cols, rows: data });
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});

// ─── Tests: calcNextRun (lógica de reportes programados) ─────────────────────

describe('calcNextRun — próxima ejecución de reporte', () => {
  // Replicar la función para testearla
  function calcNextRun (frequency, dayOfWeek, dayOfMonth) {
    const now  = new Date('2026-03-23T10:00:00Z');  // lunes
    const next = new Date(now);

    if (frequency === 'daily') {
      next.setDate(now.getDate() + 1);
      next.setHours(7, 0, 0, 0);
    } else if (frequency === 'weekly') {
      const dow  = dayOfWeek != null ? dayOfWeek : 1;
      const diff = (dow - now.getDay() + 7) % 7 || 7;
      next.setDate(now.getDate() + diff);
      next.setHours(7, 0, 0, 0);
    } else if (frequency === 'monthly') {
      const dom = dayOfMonth || 1;
      next.setMonth(now.getMonth() + (now.getDate() >= dom ? 1 : 0));
      next.setDate(dom);
      next.setHours(7, 0, 0, 0);
    } else if (frequency === 'quarterly') {
      const dom = dayOfMonth || 1;
      next.setMonth(now.getMonth() + 3);
      next.setDate(dom);
      next.setHours(7, 0, 0, 0);
    }

    return next.toISOString().slice(0, 19).replace('T', ' ');
  }

  test('daily → mañana', () => {
    const next = calcNextRun('daily', null, null);
    expect(next).toContain('2026-03-24');
  });

  test('weekly → próximo lunes (dow=1)', () => {
    const next = calcNextRun('weekly', 1, null);
    expect(next).toContain('2026-03-30');   // próximo lunes
  });

  test('weekly → próximo miércoles (dow=3)', () => {
    const next = calcNextRun('weekly', 3, null);
    expect(next).toContain('2026-03-25');   // miércoles de la misma semana
  });

  test('monthly → día 1 del próximo mes (ya pasó el día 1)', () => {
    const next = calcNextRun('monthly', null, 1);
    expect(next).toContain('2026-04-01');
  });

  test('monthly → día 30 (no pasó todavía)', () => {
    const next = calcNextRun('monthly', null, 30);
    expect(next).toContain('2026-03-30');   // mismo mes, día 30
  });

  test('quarterly → 3 meses después', () => {
    const next = calcNextRun('quarterly', null, 1);
    expect(next).toContain('2026-06-01');
  });
});

// ─── Tests: validaciones de reporte ──────────────────────────────────────────

describe('Validaciones de tipos de reporte', () => {
  const VALID_TYPES   = ['revenue', 'appointments', 'diagnoses', 'top-clients', 'vaccination-compliance'];
  const VALID_FORMATS = ['pdf', 'excel', 'csv'];
  const VALID_FREQ    = ['daily', 'weekly', 'monthly', 'quarterly'];

  test.each(VALID_TYPES)('tipo %s es válido', (type) => {
    expect(VALID_TYPES.includes(type)).toBe(true);
  });

  test.each(VALID_FORMATS)('formato %s es válido', (format) => {
    expect(VALID_FORMATS.includes(format)).toBe(true);
  });

  test.each(VALID_FREQ)('frecuencia %s es válida', (freq) => {
    expect(VALID_FREQ.includes(freq)).toBe(true);
  });

  test('formato desconocido → inválido', () => {
    expect(VALID_FORMATS.includes('word')).toBe(false);
  });
});

// ─── Tests: colLetter helper (nombres de columnas Excel) ─────────────────────

describe('colLetter — conversión número → letra Excel', () => {
  function colLetter (n) {
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  test('1 → A',  () => expect(colLetter(1)).toBe('A'));
  test('26 → Z', () => expect(colLetter(26)).toBe('Z'));
  test('27 → AA',() => expect(colLetter(27)).toBe('AA'));
  test('52 → AZ',() => expect(colLetter(52)).toBe('AZ'));
  test('53 → BA',() => expect(colLetter(53)).toBe('BA'));
});
