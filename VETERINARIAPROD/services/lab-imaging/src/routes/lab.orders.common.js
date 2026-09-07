'use strict';

const { db, R, logLabError } = require('./lab.common');
const { resolveMedicalRecordId } = require('../lib/clinicalContext');

module.exports = {
  db,
  R,
  logLabError,
  resolveMedicalRecordId,
};
