const { validationResult } = require('express-validator');

function validate(schemas) {
  const rules = Array.isArray(schemas) ? schemas : [schemas];
  return [
    ...rules,
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({
          error: 'Datos de entrada inválidos',
          errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
        });
      }
      next();
    },
  ];
}

module.exports = { validate };
