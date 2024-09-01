// middlewares/auth.js
const jwt = require('jsonwebtoken');

exports.verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    const serverTime = new Date().toISOString();

    console.log('Hora actual del servidor:', serverTime);
    console.log('Token recibido:', token);

    if (!token) {
        return res.status(401).json({ message: 'No token provided', redirectTo: '/login' });
    }

    try {
        const decoded = jwt.verify(token, 'xxxxxxxx'); // Decodifica el token con la clave secreta

        if (!decoded.role) {
            console.log('Error: El token no contiene información de rol');
            return res.status(403).json({ message: 'Access denied. Role information missing in token.' });
        }

        req.user = decoded; // Guardar la información decodificada del token en la solicitud
        next(); // Continuar al siguiente middleware o ruta
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

