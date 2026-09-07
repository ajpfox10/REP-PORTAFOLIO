'use strict';

const { tracingMiddleware } = require('./tracing');

const correlationId = tracingMiddleware('gateway');

module.exports = { correlationId };
