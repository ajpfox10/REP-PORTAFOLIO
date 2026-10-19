const rateLimit = require('express-rate-limit');
const config    = require('../config/env');

const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiadas solicitudes, intente más tarde' },
});

// Solo cuentan los intentos fallidos: un operador que entra bien no se bloquea
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos de autenticación, intente en 15 minutos' },
});

module.exports = { generalLimiter, authLimiter };
