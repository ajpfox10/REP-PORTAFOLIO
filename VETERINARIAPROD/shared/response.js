'use strict';

/**
 * Standard API response envelope.
 * { success, data, meta, error }
 */

function ok(res, data = null, meta = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    meta,
  });
}

function created(res, data = null) {
  return ok(res, data, {}, 201);
}

function paginated(res, rows, total, page, limit) {
  return ok(res, rows, {
    total,
    page:       parseInt(page),
    limit:      parseInt(limit),
    totalPages: Math.ceil(total / limit),
  });
}

function noContent(res) {
  return res.status(204).end();
}

function error(res, statusCode, message, details = null, code = null) {
  const body = {
    success: false,
    error: {
      message,
      ...(code ? { code } : {}),
      ...(res?.locals?.requestId ? { requestId: res.locals.requestId } : {}),
      ...(res?.locals?.traceId ? { traceId: res.locals.traceId } : {}),
    },
  };
  if (details) body.error.details = details;
  return res.status(statusCode).json(body);
}

function accepted(res, data = null) {
  return ok(res, data, {}, 202);
}

const badRequest    = (res, msg = 'Bad request', details = null, code = null) => error(res, 400, msg, details, code);
const unauthorized  = (res, msg = 'Unauthorized', code = null)                => error(res, 401, msg, null, code);
const forbidden     = (res, msg = 'Forbidden', code = null)                   => error(res, 403, msg, null, code);
const notFound      = (res, msg = 'Not found', code = null)                   => error(res, 404, msg, null, code);
const conflict      = (res, msg = 'Conflict', code = null)                    => error(res, 409, msg, null, code);
const serverError   = (res, msg = 'Internal server error', code = null)       => error(res, 500, msg, null, code);
const tooMany       = (res, msg = 'Too many requests', code = null)           => error(res, 429, msg, null, code);

module.exports = {
  ok, created, accepted, paginated, noContent,
  error, badRequest, unauthorized, forbidden,
  notFound, conflict, serverError, tooMany,
};
