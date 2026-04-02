function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Acceso denegado',
        detail: `Se requiere uno de los roles: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = { authorize };
