const { body } = require('express-validator');

const createUserRules = [
  body('username')
    .notEmpty().withMessage('El usuario es requerido')
    .isAlphanumeric().withMessage('Solo letras y números')
    .isLength({ min: 3, max: 50 }).withMessage('Entre 3 y 50 caracteres')
    .trim().toLowerCase(),
  body('email')
    .isEmail().withMessage('Email inválido')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Mínimo 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Debe contener mayúsculas, minúsculas y números'),
  body('role')
    .isIn(['admin', 'medium', 'read', 'telefonista', 'chofer']).withMessage('Rol inválido'),
  body('full_name')
    .notEmpty().withMessage('El nombre completo es requerido')
    .isLength({ min: 2, max: 100 }).withMessage('Entre 2 y 100 caracteres')
    .trim(),
];

const updateUserRules = [
  body('email').optional().isEmail().withMessage('Email inválido').normalizeEmail(),
  body('role').optional().isIn(['admin', 'medium', 'read', 'telefonista', 'chofer']).withMessage('Rol inválido'),
  body('full_name').optional().isLength({ min: 2, max: 100 }).trim(),
];

const resetPasswordRules = [
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Mínimo 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Debe contener mayúsculas, minúsculas y números'),
];

module.exports = { createUserRules, updateUserRules, resetPasswordRules };
