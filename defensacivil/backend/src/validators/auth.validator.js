const { body } = require('express-validator');

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

const loginRules = [
  body('username').isString().trim().notEmpty().withMessage('El usuario es requerido').isLength({ max: 50 }),
  body('password').isString().notEmpty().withMessage('La contraseña es requerida').isLength({ max: 200 }),
];

const changePasswordRules = [
  body('currentPassword').isString().notEmpty().withMessage('La contraseña actual es requerida'),
  body('newPassword')
    .isString()
    .isLength({ min: 8, max: 200 }).withMessage('Mínimo 8 caracteres')
    .matches(PASSWORD_RULE)
    .withMessage('Debe contener mayúsculas, minúsculas y números'),
];

module.exports = { loginRules, changePasswordRules, PASSWORD_RULE };
