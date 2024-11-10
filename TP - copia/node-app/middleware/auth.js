// middleware/auth.js

const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/config');
const sessionModel = require('../models/sessionModel');

module.exports = async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        console.log('No se encontró el token en las cookies.');
        return res.status(401).json({ message: 'Acceso denegado, inicia sesión' });
    }
    try {
        const verified = jwt.verify(token, jwtSecret);
        console.log(`Token verificado para user_id: ${verified.id}`);

        // Verificar si la sesión está activa
        const session = await sessionModel.findActiveSession(verified.id);
        if (!session) {
            console.log('No se encontró ninguna sesión activa para el usuario.');
            return res.status(401).json({ message: 'Sesión inválida o expirada' });
        }

        if (session.token !== token) {
            console.log('El token en la sesión no coincide con el token proporcionado.');
            return res.status(401).json({ message: 'Sesión inválida o expirada' });
        }

        console.log('Sesión verificada exitosamente.');
        req.user = verified;
        next();
    } catch (err) {
        console.error('Error en middleware de autenticación:', err);
        res.status(400).json({ message: 'Token no válido' });
    }
};
