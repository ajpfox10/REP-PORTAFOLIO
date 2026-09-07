'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const { buildApp, startService, guardWrite } = require('../../../shared/serviceBase');
const { router: stripeRouter, stripeWebhookHandler } = require('./routes/stripe.routes');
const { invoicesRouter, paymentsRouter, priceListsRouter, inventoryRouter, suppliersRouter, purchaseOrdersRouter, consolidatedRouter, mpRouter, mpWebhookRouter, afipRouter } = require('./routes/billing.routes');

const stripeRawBody = express.raw({
  type: 'application/json',
  limit: process.env.JSON_BODY_LIMIT || '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
});

const app = buildApp('billing', (app, requirePerm) => {
  app.use('/invoices', requirePerm('invoices:read'), guardWrite('invoices'), invoicesRouter);
  app.use('/invoices', requirePerm('invoices:create'), afipRouter);
  app.use('/payments/mp/webhook', (req, res, next) => {
    if (req.method === 'POST' && (req.path === '/' || req.path === '')) {
      return mpWebhookRouter(req, res, next);
    }
    return next();
  });
  app.post('/payments/stripe/webhook', stripeWebhookHandler);
  app.use('/payments/mp', requirePerm('payments:read'), mpRouter);
  app.use('/payments', requirePerm('payments:read'), guardWrite('payments'), paymentsRouter);
  app.use('/price-lists', requirePerm('invoices:read'), guardWrite('invoices'), priceListsRouter);
  app.use('/inventory', requirePerm('inventory:read'), guardWrite('inventory'), inventoryRouter);
  app.use('/suppliers', requirePerm('inventory:read'), guardWrite('inventory'), suppliersRouter);
  app.use('/purchase-orders', requirePerm('inventory:read'), guardWrite('inventory'), purchaseOrdersRouter);
  app.use('/billing/consolidated', requirePerm('reports:read'), consolidatedRouter);
  app.use('/billing', requirePerm('billing:read'), stripeRouter);
}, {
  specPath: path.join(__dirname, 'openapi.yaml'),
  preJsonMiddlewares: (req, res, next) => {
    if (req.path === '/payments/stripe/webhook') return stripeRawBody(req, res, next);
    return next();
  },
});

const PORT = parseInt(process.env.PORT || '4055');
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'billing', PORT);
}

module.exports = app;
