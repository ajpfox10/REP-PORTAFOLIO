'use strict';

// Lógica de mapeo de estados de OC y tipos de alerta — sin DB

describe('Inventario avanzado — lógica de negocio', () => {

  describe('Estado de OC', () => {
    function calcPoStatus(items) {
      const pendingCount = items.filter(i => i.qty_received < i.qty_ordered).length;
      if (pendingCount === items.length) return 'sent';
      if (pendingCount === 0)            return 'received';
      return 'partial';
    }

    test('todos sin recibir → sent', () => {
      expect(calcPoStatus([
        { qty_ordered: 10, qty_received: 0 },
        { qty_ordered: 5,  qty_received: 0 },
      ])).toBe('sent');
    });

    test('todos recibidos → received', () => {
      expect(calcPoStatus([
        { qty_ordered: 10, qty_received: 10 },
        { qty_ordered: 5,  qty_received: 5  },
      ])).toBe('received');
    });

    test('recibido parcialmente → partial', () => {
      expect(calcPoStatus([
        { qty_ordered: 10, qty_received: 10 },
        { qty_ordered: 5,  qty_received: 2  },
      ])).toBe('partial');
    });
  });

  describe('Tipo de alerta de stock', () => {
    function getAlertType(available, reorderPoint) {
      if (available <= 0)           return 'out_of_stock';
      if (available <= reorderPoint) return 'low_stock';
      return null;
    }

    test('sin stock → out_of_stock',   () => expect(getAlertType(0, 5)).toBe('out_of_stock'));
    test('stock bajo → low_stock',     () => expect(getAlertType(3, 5)).toBe('low_stock'));
    test('stock ok → null',            () => expect(getAlertType(10, 5)).toBeNull());
    test('stock igual a reorder → low',() => expect(getAlertType(5, 5)).toBe('low_stock'));
  });

  describe('Tipo de alerta de vencimiento', () => {
    function getExpiryAlertType(expiryDate) {
      const now   = new Date();
      const expiry = new Date(expiryDate);
      if (expiry < now) return 'expired';
      const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);
      return diffDays <= 30 ? 'expiring_soon' : null;
    }

    test('vencido → expired', () => {
      expect(getExpiryAlertType('2020-01-01')).toBe('expired');
    });
    test('vence en 15 días → expiring_soon', () => {
      const d = new Date(); d.setDate(d.getDate() + 15);
      expect(getExpiryAlertType(d.toISOString())).toBe('expiring_soon');
    });
    test('vence en 60 días → null', () => {
      const d = new Date(); d.setDate(d.getDate() + 60);
      expect(getExpiryAlertType(d.toISOString())).toBeNull();
    });
  });

  describe('Número de OC', () => {
    function genPoNumber(count) {
      return `PO-${String(count).padStart(5, '0')}`;
    }
    test('genera PO-00001', () => expect(genPoNumber(1)).toBe('PO-00001'));
    test('genera PO-00042', () => expect(genPoNumber(42)).toBe('PO-00042'));
    test('genera PO-10000', () => expect(genPoNumber(10000)).toBe('PO-10000'));
  });
});
