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

    // Validar nombre (solo texto)
    if (!/^[a-zA-Z\s]+$/.test(nombre)) {
        console.error('[LOG Middleware] Nombre inválido:', nombre);
        return res.status(400).json({
            success: false,
            message: 'El nombre debe contener solo letras y espacios'
        });
    }

    // Validar email
    if (!validator.isEmail(email)) {
        console.error('[LOG Middleware] Email inválido:', email);
        return res.status(400).json({
            success: false,
            message: 'El email no es válido'
        });
    }

    // Validar contraseña (mínimo 6 caracteres)
    if (password.length < 6) {
        console.error('[LOG Middleware] Contraseña demasiado corta');
        return res.status(400).json({
            success: false,
            message: 'La contraseña debe tener al menos 6 caracteres'
        });
    }

    // Validar dirección (sin caracteres especiales peligrosos)
    if (!/^[a-zA-Z0-9\s,.-]+$/.test(direccion)) {
        console.error('[LOG Middleware] Dirección inválida:', direccion);
        return res.status(400).json({
            success: false,
            message: 'La dirección contiene caracteres no válidos'
        });
    }

    // Validar teléfono (solo números y longitud aceptable)
    if (!validator.isMobilePhone(telefono, 'any')) {
        console.error('[LOG Middleware] Teléfono inválido:', telefono);
        return res.status(400).json({
            success: false,
            message: 'El teléfono no es válido'
        });
    }

    console.log('[LOG Middleware] Validación exitosa');
    // Si todo está bien, continuar al siguiente middleware
    next();
};

module.exports = validateRegistro;

