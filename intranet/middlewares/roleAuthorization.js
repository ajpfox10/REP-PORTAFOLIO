// middlewares/roleAuthorization.js
exports.checkRole = (requiredRole) => {
    return (req, res, next) => {
        if (req.user && req.user.role) {
            if (req.user.role === requiredRole) {
                return next(); // Permite el acceso si el rol coincide
            } else {
                console.log(`Acceso denegado para el rol: ${req.user.role}`);
                return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
            }
        } else {
            console.log('Acceso denegado: Información de usuario o rol no definida');
            return res.status(403).json({ message: 'Access denied. User or role information not found.' });
        }
    };
};
