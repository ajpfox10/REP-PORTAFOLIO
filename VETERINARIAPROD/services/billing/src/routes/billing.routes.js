'use strict';

const { Router } = require('express');
const { router: invoicesRouter } = require('./billing.invoices.routes');
const { router: paymentsRouter } = require('./billing.payments.routes');
const { router: priceListsRouter } = require('./billing.price-lists.routes');
const { router: inventoryRouter } = require('./billing.inventory.routes');
const { router: suppliersRouter } = require('./billing.suppliers.routes');
const { router: purchaseOrdersRouter } = require('./billing.purchase-orders.routes');
const { router: consolidatedRouter } = require('./billing.consolidated.routes');
const { router: mpRouter } = require('./billing.mp.routes');
const { router: mpWebhookRouter } = require('./billing.mp.webhook.routes');
const { router: afipRouter } = require('./billing.afip.routes');

module.exports = {
  Router,
  invoicesRouter,
  paymentsRouter,
  priceListsRouter,
  inventoryRouter,
  suppliersRouter,
  purchaseOrdersRouter,
  consolidatedRouter,
  mpRouter,
  mpWebhookRouter,
  afipRouter,
};
