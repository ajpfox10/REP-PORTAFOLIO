// middleware/role.js

module.exports = (requiredRole) => {
    return (req, res, next) => {
        const userRole = req.user.role;
        if (userRole !== requiredRole) {
            return res.status(403).json({ message: 'Acceso denegado: No tienes los permisos necesarios' });
        }
        next();
    };
};
