const validator = require('validator');

// Middleware para validar datos de registro
const validateRegistro = (req, res, next) => {
    console.log('[LOG Middleware] Datos recibidos en la solicitud:', req.body);

    const { nombre, email, password, direccion, telefono } = req.body;

    // Validar campos requeridos
    if (!nombre || !email || !password || !direccion || !telefono) {
        console.error('[LOG Middleware] Faltan campos requeridos');
        return res.status(400).json({
            success: false,
            message: 'Todos los campos son obligatorios'
        });
    }

    // Validar nombre (letras Unicode + espacios, admite tildes y caracteres latinos)
    if (!/^[\p{L}\s]+$/u.test(nombre)) {
        console.error('[LOG Middleware] Nombre inv�lido:', nombre);
        return res.status(400).json({
            success: false,
            message: 'El nombre debe contener solo letras y espacios'
        });
    }

    // Validar email
    if (!validator.isEmail(email)) {
        console.error('[LOG Middleware] Email inv�lido:', email);
        return res.status(400).json({
            success: false,
            message: 'El email no es v�lido'
        });
    }

    // Validar contrase�a (m�nimo 6 caracteres)
    if (password.length < 6) {
        console.error('[LOG Middleware] Contrase�a demasiado corta');
        return res.status(400).json({
            success: false,
            message: 'La contrase�a debe tener al menos 6 caracteres'
        });
    }

    // Validar direcci�n (sin caracteres especiales peligrosos)
    if (!/^[a-zA-Z0-9\s,.-]+$/.test(direccion)) {
        console.error('[LOG Middleware] Direcci�n inv�lida:', direccion);
        return res.status(400).json({
            success: false,
            message: 'La direcci�n contiene caracteres no v�lidos'
        });
    }

    // Validar tel�fono (solo n�meros y longitud aceptable)
    if (!validator.isMobilePhone(telefono, 'any')) {
        console.error('[LOG Middleware] Tel�fono inv�lido:', telefono);
        return res.status(400).json({
            success: false,
            message: 'El tel�fono no es v�lido'
        });
    }

    console.log('[LOG Middleware] Validaci�n exitosa');
    // Si todo est� bien, continuar al siguiente middleware
    next();
};

module.exports = validateRegistro;

