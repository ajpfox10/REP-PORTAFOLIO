'use strict';

const { createLogger } = require('./logger');

const log = createLogger('dependency-policy');
const VALID_MODES = new Set(['strict', 'degraded', 'open']);

let _dependencyDegradations;
function getDependencyDegradationsMetric() {
  if (_dependencyDegradations) return _dependencyDegradations;
  try {
    _dependencyDegradations = require('./metrics').dependencyDegradations;
  } catch (err) {
    log.warn('Dependency degradation metric unavailable', { error: err.message });
  }
  return _dependencyDegradations;
}

function normaliseDependencyName(name) {
  return String(name || 'dependency')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function normaliseMode(mode, fallback = 'degraded') {
  return VALID_MODES.has(mode) ? mode : fallback;
}

function getDependencyMode(name, defaultMode = 'degraded') {
  const normalisedName = normaliseDependencyName(name);
  const envMode = process.env[`DEPENDENCY_MODE_${normalisedName}`]
    || process.env[`${normalisedName}_MODE`]
    || process.env.DEPENDENCY_DEFAULT_MODE;
  return normaliseMode(String(envMode || defaultMode).toLowerCase(), defaultMode);
}

function recordDependencyDegradation(name, mode, outcome, meta = {}) {
  getDependencyDegradationsMetric()?.inc({
    dependency: name,
    mode,
    outcome,
    service: meta.service || meta.component || 'shared',
  });
}

function logDependencyIssue(logger, name, mode, message, err, meta = {}) {
  const target = logger || log;
  target.warn(message, {
    dependency: name,
    mode,
    message: err?.message,
    code: err?.code,
    ...meta,
  });
}

function dependencyFailureResponse(res, {
  statusCode = 503,
  message = 'Required dependency unavailable',
  code = 'DEPENDENCY_UNAVAILABLE',
  details = null,
} = {}) {
  const R = require('./response');
  return R.error(res, statusCode, message, details, code);
}

module.exports = {
  VALID_MODES,
  normaliseMode,
  normaliseDependencyName,
  getDependencyMode,
  recordDependencyDegradation,
  logDependencyIssue,
  dependencyFailureResponse,
};
