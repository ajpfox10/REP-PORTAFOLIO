const jwt = require('jsonwebtoken');
const config = require('./config');

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: '8h' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'Sesion invalida o vencida' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Permiso insuficiente' });
  }
  return next();
}

function requireRotulos(req, res, next) {
  if (!['admin', 'operador'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Permiso insuficiente' });
  }
  return next();
}

module.exports = { signToken, requireAuth, requireAdmin, requireRotulos };
