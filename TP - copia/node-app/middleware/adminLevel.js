// middleware/adminLevel.js

module.exports = (requiredRole, requiredLvl) => {
    return (req, res, next) => {
        if (req.user && req.user.role === requiredRole && req.user.lvl === requiredLvl) {
            next();
        } else {
            return res.status(403).json({ message: 'Acceso denegado: No tienes los permisos necesarios' });
        }
    };
};
