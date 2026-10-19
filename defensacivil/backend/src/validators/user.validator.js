const { body, param } = require('express-validator');
const { PASSWORD_RULE } = require('./auth.validator');

const ROLES = ['admin', 'medium', 'read', 'telefonista', 'chofer'];

const uuidParam = [param('uuid').isUUID().withMessage('Identificador inválido')];

const createUserRules = [
  body('username')
    .isString().trim()
    .notEmpty().withMessage('El usuario es requerido')
    .isAlphanumeric().withMessage('Solo letras y números')
    .isLength({ min: 3, max: 50 }).withMessage('Entre 3 y 50 caracteres')
    .toLowerCase(),
  body('email')
    .isString().trim()
    .isEmail().withMessage('Email inválido')
    .isLength({ max: 100 })
    .normalizeEmail({ gmail_remove_dots: false }),
  body('password')
    .isString()
    .isLength({ min: 8, max: 200 }).withMessage('Mínimo 8 caracteres')
    .matches(PASSWORD_RULE)
    .withMessage('Debe contener mayúsculas, minúsculas y números'),
  body('role')
    .isIn(ROLES).withMessage('Rol inválido'),
  body('full_name')
    .isString().trim()
    .notEmpty().withMessage('El nombre completo es requerido')
    .isLength({ min: 2, max: 100 }).withMessage('Entre 2 y 100 caracteres'),
];

const updateUserRules = [
  ...uuidParam,
  body('email').optional().isString().trim().isEmail().withMessage('Email inválido')
    .isLength({ max: 100 }).normalizeEmail({ gmail_remove_dots: false }),
  body('role').optional().isIn(ROLES).withMessage('Rol inválido'),
  body('full_name').optional().isString().trim()
    .isLength({ min: 2, max: 100 }).withMessage('Entre 2 y 100 caracteres'),
];

const resetPasswordRules = [
  ...uuidParam,
  body('newPassword')
    .isString()
    .isLength({ min: 8, max: 200 }).withMessage('Mínimo 8 caracteres')
    .matches(PASSWORD_RULE)
    .withMessage('Debe contener mayúsculas, minúsculas y números'),
];

module.exports = { createUserRules, updateUserRules, resetPasswordRules, uuidParam, ROLES };
