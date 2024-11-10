// validations/loginValidation.js

const Joi = require('joi');

const loginSchema = Joi.object({
    email: Joi.string().required().messages({
        'string.email': 'El correo debe ser válido.',
        'any.required': 'El correo es obligatorio.'
    }),
    password: Joi.string().min(1).required().messages({
        'string.min': 'La contraseña debe tener al menos 6 caracteres.',
        'any.required': 'La contraseña es obligatoria.'
    })
});

module.exports = loginSchema;
