const jwt    = require('jsonwebtoken');
const config = require('../config/env');
const { queryOne } = require('../config/database');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }

  try {
    // El rol y el estado se leen de la base: si un administrador desactiva a
    // alguien o le cambia el rol, el cambio rige en la siguiente solicitud y
    // no recién cuando vence el token.
    const user = await queryOne(
      'SELECT id, uuid, username, role, is_active FROM users WHERE id = ?',
      [decoded.id]
    );
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
    }
    req.user = { id: user.id, uuid: user.uuid, role: user.role, username: user.username };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticateToken };
