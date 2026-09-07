'use strict';

const { body, validationResult } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('patients.branches');
const mb = require('../../../../shared/multibranch');
const { enqueue } = require('../../../../shared/webhooks/dispatcher');
const eventBus = require('../../../../shared/eventBus');

function validate(req, res, next) {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
}

function logBranchesError(scope, error, meta = {}) {
  log.error(`${scope}`, {
    message: error?.message,
    stack: error?.stack,
    ...meta,
  });
}

module.exports = {
  body,
  db,
  R,
  mb,
  enqueue,
  eventBus,
  validate,
  logBranchesError,
};
