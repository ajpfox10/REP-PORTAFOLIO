'use strict';

const { Router } = require('express');
const engine = require('../../../../shared/rulesEngine');
const { body, validate, logMedicalError } = require('./medical.common');
const { VALID_TYPES } = require('./rules.admin.routes');

const router = Router();

// Límite de tamaño del objeto context para prevenir ataques DoS por objetos masivos
const MAX_CONTEXT_JSON_BYTES = 8192; // 8 KB

function validateContextSize(value) {
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_CONTEXT_JSON_BYTES) {
    throw new Error(`El contexto supera el tamaño máximo permitido (${MAX_CONTEXT_JSON_BYTES} bytes)`);
  }
  // Verificar profundidad máxima para evitar ataques de anidamiento
  function checkDepth(obj, depth = 0) {
    if (depth > 5) throw new Error('El contexto supera la profundidad máxima permitida (5 niveles)');
    if (obj && typeof obj === 'object') {
      for (const v of Object.values(obj)) checkDepth(v, depth + 1);
    }
  }
  checkDepth(value);
  return true;
}

router.post('/evaluate',
  body('rule_type').isIn(VALID_TYPES),
  body('context').isObject().custom(validateContextSize),
  validate,
  async (req, res, next) => {
    try {
      const orgId = req.user?.orgId;
      const branchId = req.user?.branchId;
      const { rule_type, context } = req.body;
      const result = await engine.evaluate(rule_type, orgId, branchId, context);
      res.json({ success: true, data: result });
    } catch (err) {
      logMedicalError('rules.POST /rules/evaluate', err, { orgId: req.user?.orgId, branchId: req.user?.branchId, body: req.body });
      next(err);
    }
  }
);

module.exports = { router };
