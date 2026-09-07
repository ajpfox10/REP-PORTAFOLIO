'use strict';

const { validationResult } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('billing');
const { httpCacheHeaders } = require('../../../../shared/cache');
const mp = require('../../../../shared/mercadopago');
const afip = require('../../../../shared/afip');
const { generateInvoicePdf } = require('../../../../shared/pdf');
const { enqueue } = require('../../../../shared/webhooks/dispatcher');
const eventBus = require('../../../../shared/eventBus');
const mb = require('../../../../shared/multibranch');

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
};

function buildInvoiceNumber(branchId, seq) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${branchId}-${ymd}-${String(seq).padStart(5, '0')}`;
}

const notDeleted = (alias) => `${alias}.deleted_at IS NULL`;

function logBillingError(scope, error, meta = {}) {
  log.error(`${scope}`, {
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    sqlState: error?.sqlState,
    sqlMessage: error?.sqlMessage,
    meta,
  });
}

module.exports = {
  db,
  R,
  mp,
  afip,
  mb,
  enqueue,
  eventBus,
  validate,
  httpCacheHeaders,
  generateInvoicePdf,
  buildInvoiceNumber,
  notDeleted,
  logBillingError,
};
