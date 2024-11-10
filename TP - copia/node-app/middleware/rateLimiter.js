// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limitar cada IP a 100 solicitudes por ventana
    message: 'Demasiadas solicitudes desde esta IP, por favor intenta más tarde.'
});

module.exports = limiter;
