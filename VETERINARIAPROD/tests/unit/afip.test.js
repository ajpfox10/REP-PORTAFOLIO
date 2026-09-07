'use strict';

const { getTipoComprobante, TIPOS_COMPROBANTE, TIPO_DOC } = require('../../shared/afip');

describe('AFIP — lógica de comprobantes', () => {

  describe('getTipoComprobante', () => {
    test('Responsable Inscripto → Factura A (1)',    () => expect(getTipoComprobante('RI')).toBe(1));
    test('Monotributo → Factura B (6)',              () => expect(getTipoComprobante('MO')).toBe(6));
    test('Consumidor Final → Factura B (6)',         () => expect(getTipoComprobante('CF')).toBe(6));
    test('Exento → Factura B (6)',                   () => expect(getTipoComprobante('EX')).toBe(6));
    test('Sin condición → Factura B (6)',            () => expect(getTipoComprobante(undefined)).toBe(6));
  });

  describe('TIPOS_COMPROBANTE', () => {
    test('Factura A = 1',        () => expect(TIPOS_COMPROBANTE.FACTURA_A).toBe(1));
    test('Factura B = 6',        () => expect(TIPOS_COMPROBANTE.FACTURA_B).toBe(6));
    test('Factura C = 11',       () => expect(TIPOS_COMPROBANTE.FACTURA_C).toBe(11));
    test('NC A = 3',             () => expect(TIPOS_COMPROBANTE.NOTA_CREDITO_A).toBe(3));
    test('NC B = 8',             () => expect(TIPOS_COMPROBANTE.NOTA_CREDITO_B).toBe(8));
  });

  describe('TIPO_DOC', () => {
    test('CUIT = 80',            () => expect(TIPO_DOC.CUIT).toBe(80));
    test('DNI = 96',             () => expect(TIPO_DOC.DNI).toBe(96));
    test('Consumidor Final = 99',() => expect(TIPO_DOC.CONSUMIDOR_FINAL).toBe(99));
  });

  describe('Cálculo de IVA 21%', () => {
    function calcIva(total) {
      const neto = total / 1.21;
      const iva  = total - neto;
      return { neto: Number(neto.toFixed(2)), iva: Number(iva.toFixed(2)) };
    }

    test('$121 → neto $100, IVA $21', () => {
      const r = calcIva(121);
      expect(r.neto).toBeCloseTo(100, 1);
      expect(r.iva).toBeCloseTo(21, 1);
    });

    test('$0 → neto $0, IVA $0', () => {
      const r = calcIva(0);
      expect(r.neto).toBe(0);
      expect(r.iva).toBe(0);
    });
  });

  describe('Número de comprobante formateado', () => {
    function formatNroComp(puntoVenta, nro) {
      return `${String(puntoVenta).padStart(4,'0')}-${String(nro).padStart(8,'0')}`;
    }
    test('0001-00000001', () => expect(formatNroComp(1, 1)).toBe('0001-00000001'));
    test('0002-00000042', () => expect(formatNroComp(2, 42)).toBe('0002-00000042'));
  });
});

describe('PDF — validación de datos de factura', () => {
  function isValidInvoiceForPdf(inv) {
    return !!(inv.invoice_number && inv.total_amount >= 0 && inv.issued_date);
  }

  test('factura válida para PDF',    () => expect(isValidInvoiceForPdf({ invoice_number: 'F-001', total_amount: 100, issued_date: new Date() })).toBe(true));
  test('sin invoice_number → inválida', () => expect(isValidInvoiceForPdf({ total_amount: 100, issued_date: new Date() })).toBe(false));
  test('monto negativo → inválida',  () => expect(isValidInvoiceForPdf({ invoice_number: 'F-001', total_amount: -1, issued_date: new Date() })).toBe(false));
});
