'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../../controllers/auth.controller');
const {
  body,
  captchaMiddleware,
  validateRequest,
  strongPasswordField,
} = require('./_common');
const { getCaptchaPublicConfig } = require('../../../../../shared/captcha');

const router = Router();

function preserveRawEmail(req, _res, next) {
  req.rawEmail = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : null;
  next();
}

router.get('/captcha/config', (_req, res) => {
  res.json({ success: true, data: getCaptchaPublicConfig() });
});

// BUG-015: rate limit en password-reset/confirm para prevenir brute force de tokens
const passwordResetConfirmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Demasiados intentos. Intente de nuevo en 1 hora.' } },
});

router.post('/login',
  captchaMiddleware,
  preserveRawEmail,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  validateRequest,
  ctrl.login
);

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts' },
});
const ssoConnectLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many SSO requests', code: 'RATE_LIMIT_EXCEEDED' } },
});
router.post('/refresh', refreshLimiter, ctrl.refresh);
router.post('/logout', ctrl.logout);
router.get('/sso/:provider/connect', ssoConnectLimiter, ctrl.ssoConnect);
router.get('/sso/:provider/callback', ctrl.ssoCallback);

router.post('/password-reset/request',
  captchaMiddleware,
  preserveRawEmail,
  body('email').isEmail().normalizeEmail(),
  validateRequest,
  ctrl.requestPasswordReset
);

router.post('/password-reset/confirm',
  passwordResetConfirmLimiter,
  body('token').notEmpty(),
  strongPasswordField('newPassword'),
  validateRequest,
  ctrl.confirmPasswordReset
);

module.exports = router;
