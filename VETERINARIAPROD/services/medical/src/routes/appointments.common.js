'use strict';

const { body, db, R, validate, logMedicalError } = require('./medical.common');
const calendar = require('../../../../shared/calendar');
const icalLib = require('../../../../shared/ical');

function logAppointmentsError(scope, error, meta = {}) {
  logMedicalError(`appointments.${scope}`, error, meta);
}

module.exports = {
  body,
  db,
  R,
  calendar,
  icalLib,
  validate,
  logAppointmentsError,
};
