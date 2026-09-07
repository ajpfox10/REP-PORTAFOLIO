'use strict';
/**
 * Rules Engine — evalúa reglas de negocio configurables por org/branch.
 *
 * Las reglas se almacenan en DB como condiciones JSON:
 *   conditions: [{ field, operator, value }]
 *
 * Operadores: eq, neq, gt, lt, gte, lte, in, nin, contains, day_of_week
 *
 * Resultado de evaluación:
 *   { passed: true }  — todas las condiciones se cumplen
 *   { passed: false, violations: [{ ruleId, name, message, action }] }
 *
 * Uso típico (en un handler de appointments):
 *   const engine = require('../../../../shared/rulesEngine');
 *   const ctx = { appointment: { day_of_week: 6, hour: 14 }, patient: {...} };
 *   const result = await engine.evaluate('appointment_restriction', orgId, branchId, ctx);
 *   if (!result.passed) return res.status(422).json({ error: result.violations[0] });
 */

const db     = require('./db');
const cache  = require('./cache');
const logger = require('./logger');

const RULES_CACHE_TTL = 300; // 5 minutos

/**
 * Obtiene reglas de DB (con cache Redis).
 */
async function getRules(ruleType, orgId, branchId = null) {
  const cacheKey = `rules:${orgId}:${branchId || 'all'}:${ruleType}`;

  try {
    const rc = await cache.getClient();
    const cached = await rc.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* ignorar */ }

  const rows = await db.query(
    `SELECT * FROM business_rules
     WHERE org_id = :orgId
       AND rule_type = :ruleType
       AND is_active = TRUE
       AND (branch_id IS NULL OR branch_id = :branchId)
     ORDER BY priority ASC`,
    { orgId, ruleType, branchId: branchId || 0 },
  );

  // Parsear conditions JSON si viene como string
  const rules = rows.map(r => ({
    ...r,
    conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions,
  }));

  try {
    const rc = await cache.getClient();
    await rc.setEx(cacheKey, RULES_CACHE_TTL, JSON.stringify(rules));
  } catch { /* ignorar */ }

  return rules;
}

// SEC: lista de segmentos de campo prohibidos para prevenir acceso a propiedades
// del prototipo (__proto__, constructor, prototype) via dot-notation.
const FORBIDDEN_FIELD_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resuelve el valor de un campo en el contexto usando dot-notation.
 * Ej: 'appointment.day_of_week' → context.appointment.day_of_week
 * SEC: rechaza segmentos de prototipo para prevenir prototype pollution.
 */
function resolveField(context, field) {
  const parts = field.split('.');
  // SEC: validar cada segmento antes de la traversal
  for (const part of parts) {
    if (FORBIDDEN_FIELD_PARTS.has(part)) return undefined;
  }
  let val = context;
  for (const part of parts) {
    if (val == null || typeof val !== 'object') return undefined;
    // SEC: solo acceder a propiedades propias, no heredadas
    if (!Object.prototype.hasOwnProperty.call(val, part)) return undefined;
    val = val[part];
  }
  return val;
}

/**
 * Evalúa una condición simple contra el contexto.
 */
function evaluateCondition(condition, context) {
  const { field, operator, value } = condition;
  const actual = resolveField(context, field);

  switch (operator) {
    case 'eq':          return actual == value; // eslint-disable-line eqeqeq
    case 'neq':         return actual != value; // eslint-disable-line eqeqeq
    case 'gt':          return Number(actual) >  Number(value);
    case 'lt':          return Number(actual) <  Number(value);
    case 'gte':         return Number(actual) >= Number(value);
    case 'lte':         return Number(actual) <= Number(value);
    case 'in':          return Array.isArray(value) && value.includes(actual);
    case 'nin':         return Array.isArray(value) && !value.includes(actual);
    case 'contains':    return String(actual || '').toLowerCase().includes(String(value).toLowerCase());
    case 'day_of_week': {
      // value: 0=Dom, 1=Lun, ..., 6=Sab
      const d = actual ? new Date(actual) : new Date();
      return d.getDay() == value; // eslint-disable-line eqeqeq
    }
    case 'between': {
      const [min, max] = Array.isArray(value) ? value : [value, value];
      return Number(actual) >= Number(min) && Number(actual) <= Number(max);
    }
    default:
      logger.warn('[rulesEngine] Unknown operator', { operator });
      return false; // operador desconocido → fail-safe (no disparar la regla)
  }
}

/**
 * Evalúa todas las condiciones de una regla (AND entre condiciones).
 */
function evaluateRule(rule, context) {
  const conditions = rule.conditions || [];
  return conditions.every(cond => evaluateCondition(cond, context));
}

/**
 * Evalúa todas las reglas activas de un tipo para un org/branch.
 *
 * @param {string} ruleType - tipo de regla ('appointment_restriction', etc.)
 * @param {string|number} orgId
 * @param {string|number|null} branchId
 * @param {Object} context - datos del contexto para evaluar
 * @returns {{ passed: boolean, violations: Array, warnings: Array }}
 */
async function evaluate(ruleType, orgId, branchId, context) {
  let rules;
  try {
    rules = await getRules(ruleType, orgId, branchId);
  } catch (err) {
    logger.warn('[rulesEngine] Could not load rules', { err: err.message, ruleType, orgId });
    return { passed: true, violations: [], warnings: [] };
  }

  const violations = [];
  const warnings   = [];

  for (const rule of rules) {
    const triggered = evaluateRule(rule, context);
    if (triggered) {
      const entry = {
        ruleId:  rule.id,
        name:    rule.name,
        message: rule.action_message || `Rule violated: ${rule.name}`,
        action:  rule.action,
      };

      if (rule.action === 'block') {
        violations.push(entry);
      } else if (rule.action === 'warn' || rule.action === 'alert') {
        warnings.push(entry);
      }
    }
  }

  return {
    passed:     violations.length === 0,
    violations,
    warnings,
  };
}

/**
 * Invalida el cache de reglas de un org (llamar al crear/modificar reglas).
 */
async function invalidateCache(orgId) {
  let rc;
  try {
    rc = await cache.getClient();
  } catch {
    logger.warn('[rulesEngine] invalidateCache: Redis not available', { orgId });
    return;
  }
  try {
    const pattern = `rules:${orgId}:*`;
    let cursor = 0;
    do {
      const reply = await rc.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = reply.cursor;
      if (reply.keys && reply.keys.length > 0) {
        await rc.del(reply.keys);
      }
    } while (cursor !== 0);
    logger.info('[rulesEngine] invalidateCache: cleared', { orgId });
  } catch (err) {
    logger.error('[rulesEngine] invalidateCache: failed', { err: err.message, orgId });
  }
}

module.exports = { evaluate, getRules, invalidateCache };
