'use strict';

const { validationResult } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('lab-imaging.surgery');
const { resolveMedicalRecordId } = require('../lib/clinicalContext');

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
};

function logSurgeryError(scope, error, meta = {}) {
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
  validate,
  resolveMedicalRecordId,
  logSurgeryError,
};
