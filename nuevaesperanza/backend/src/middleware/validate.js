'use strict';

const { badRequest } = require('../lib/http');

// Valida req[source] con un esquema zod y deja el resultado limpio en req.valid
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || source;
        if (!fields[key]) fields[key] = issue.message;
      }
      return next(badRequest('Revisá los datos ingresados', 'VALIDATION_ERROR', fields));
    }
    req.valid = { ...(req.valid || {}), [source]: result.data };
    return next();
  };
}

module.exports = { validate };
