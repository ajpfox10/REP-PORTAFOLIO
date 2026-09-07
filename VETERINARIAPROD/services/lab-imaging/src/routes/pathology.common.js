'use strict';

const { validationResult } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('lab-imaging.pathology');

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
};

function logPathologyError(route, err, meta = {}) {
  log.error(`${route} failed`, {
    message: err?.message,
    code: err?.code,
    errno: err?.errno,
    sqlState: err?.sqlState,
    sqlMessage: err?.sqlMessage,
    sql: err?.sql,
    meta,
    stack: err?.stack,
  });
}

module.exports = {
  db,
  R,
  validate,
  logPathologyError,
};
