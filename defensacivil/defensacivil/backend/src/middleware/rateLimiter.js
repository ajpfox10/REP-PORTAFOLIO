const rateLimit = require('express-rate-limit');
const config    = require('../config/env');

const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiadas solicitudes, intente más tarde' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Demasiados intentos de autenticación, intente en 15 minutos' },
});

module.exports = { generalLimiter, authLimiter };
