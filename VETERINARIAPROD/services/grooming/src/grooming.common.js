'use strict';

const path = require('path');
const db = require('../../../shared/db');
const R = require('../../../shared/response');
const { buildApp, guardWrite, startService } = require('../../../shared/serviceBase');
const { body, validationResult } = require('express-validator');
const { createLogger } = require('../../../shared/logger');

const log = createLogger('grooming');

function validate(req, res, next) {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
}

function logGroomingError(route, err, meta = {}) {
  log.error(route, {
    message: err?.message,
    code: err?.code,
    errno: err?.errno,
    sqlState: err?.sqlState,
    sqlMessage: err?.sqlMessage,
    sql: err?.sql,
    stack: err?.stack,
    ...meta,
  });
}

module.exports = { path, db, R, buildApp, guardWrite, startService, body, validate, log, logGroomingError };
