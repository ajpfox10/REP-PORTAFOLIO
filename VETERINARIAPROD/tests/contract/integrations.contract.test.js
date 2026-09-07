'use strict';

jest.mock('../../shared/mercadopago', () => ({
  validateWebhookSignature: jest.fn(() => ({ valid: true, reason: null })),
}));

describe('Contract - external integrations', () => {
  test('FCM module exports required methods', () => {
    const fcm = require('../../shared/fcm');
    expect(typeof fcm.sendToToken).toBe('function');
    expect(typeof fcm.sendToMultiple).toBe('function');
    expect(typeof fcm.sendToTopic).toBe('function');
    expect(typeof fcm.subscribeToTopic).toBe('function');
  });

  test('AFIP module exports billing helpers', () => {
    const afip = require('../../shared/afip');
    expect(typeof afip.getInstance).toBe('function');
    expect(typeof afip.authorizeVoucher).toBe('function');
    expect(typeof afip.getTipoComprobante).toBe('function');
  });

  test('MercadoPago module exposes webhook validation', () => {
    const mp = require('../../shared/mercadopago');
    expect(typeof mp.validateWebhookSignature).toBe('function');
  });
});
