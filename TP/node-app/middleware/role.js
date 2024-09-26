// middleware/role.js

module.exports = (requiredRoles) => {
    return (req, res, next) => {
        if (!req.user || !requiredRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Acceso denegado: No tienes los permisos necesarios' });
        }
        next();
    };
};
