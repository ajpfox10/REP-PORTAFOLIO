const jwt    = require('jsonwebtoken');
const config = require('../config/env');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = {
      id:       decoded.id,
      uuid:     decoded.uuid,
      role:     decoded.role,
      username: decoded.username,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = { authenticateToken };
