// controllers/authController.js

const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/config');
const { findUserByEmail, verifyPassword } = require('../models/userModel');
const sessionModel = require('../models/sessionModel');

exports.login = async (req, res) => {
    const { email, password } = req.body;

    // Validación básica
    if (!email || !password) {
        return res.status(400).json({ message: 'Por favor, ingresa tu correo y contraseña' });
    }

    try {
        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(400).json({ message: 'Correo o contraseña incorrectos' });
        }

        const isPasswordValid = await verifyPassword(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Correo o contraseña incorrectos' });
        }

        // Generar JWT
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.TIPOUSUARIO },
            jwtSecret,
            { expiresIn: '1h' }
        );

        // Crear una sesión activa
        await sessionModel.createSession(user.id, token);

        // Establecer la cookie HTTP-only
        res.cookie('token', token, {
            httpOnly: true, // No accesible desde JavaScript
            secure: process.env.NODE_ENV === 'production', // Solo HTTPS en producción
            maxAge: 3600000, // 1 hora
            sameSite: 'strict', // Protege contra ataques CSRF
        });

        // Responder con éxito
        res.status(200).json({ message: 'Inicio de sesión exitoso' });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.logout = async (req, res) => {
    try {
        const token = req.cookies.token;
        if (token) {
            await sessionModel.deleteSession(token);
            res.clearCookie('token');
        }
        res.status(200).json({ message: 'Cierre de sesión exitoso' });
    } catch (err) {
        console.error('Error en logout:', err);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};
