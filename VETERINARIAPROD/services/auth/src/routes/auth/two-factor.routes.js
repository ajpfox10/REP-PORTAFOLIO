'use strict';

const rateLimit = require('express-rate-limit');
const { Router } = require('express');
const ctrl = require('../../controllers/auth.controller');
const {
  body,
  requireInternalSig,
  fromHeaders,
  validateRequest,
} = require('./_common');

const router = Router();

router.post('/2fa/setup', requireInternalSig, fromHeaders, ctrl.setup2fa);

router.post('/2fa/verify',
  requireInternalSig,
  fromHeaders,
  body('token').isLength({ min: 6, max: 6 }).isNumeric(),
  validateRequest,
  ctrl.verify2fa
);

router.delete('/2fa',
  requireInternalSig,
  fromHeaders,
  body('token').isLength({ min: 6, max: 6 }).isNumeric(),
  validateRequest,
  ctrl.disable2fa
);

const twoFaChallengeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  // Usar userId del token JWT (req.user) si está disponible tras autenticación;
  // en rutas públicas de challenge, req.user aún no existe, así que se cae a IP.
  // NO usar req.body.userId ni req.headers['x-user-id'] porque son manipulables
  // por un atacante para causar lockout (DoS) de otros usuarios.
  keyGenerator: (req) => req.user?.userId ? `2fa:${req.user.userId}` : `2fa:ip:${req.ip}`,
  handler: (_req, res) => res.status(429).json({
    success: false,
    error: { message: 'Too many 2FA attempts. Try again in 15 minutes.', code: 'RATE_LIMIT_EXCEEDED' },
  }),
});

router.post('/2fa/challenge',
  requireInternalSig,
  twoFaChallengeLimit,
  body('pendingToken').notEmpty(),
  body('token').optional().isLength({ min: 6, max: 6 }).isNumeric(),
  body('code').optional().isLength({ min: 6, max: 6 }).isNumeric(),
  validateRequest,
  ctrl.challenge2fa
);

module.exports = router;
