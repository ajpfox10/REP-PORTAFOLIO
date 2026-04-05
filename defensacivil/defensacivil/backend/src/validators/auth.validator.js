const { body } = require('express-validator');

const loginRules = [
  body('username').notEmpty().withMessage('El usuario es requerido').trim(),
  body('password').notEmpty().withMessage('La contraseña es requerida'),
];

const refreshRules = [
  body('refreshToken').notEmpty().withMessage('El refresh token es requerido'),
];

const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('La contraseña actual es requerida'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Mínimo 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Debe contener mayúsculas, minúsculas y números'),
];

module.exports = { loginRules, refreshRules, changePasswordRules };
