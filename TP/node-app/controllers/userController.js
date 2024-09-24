// controllers/userController.js

const Joi = require('joi');

// Función para renderizar el dashboard del usuario
exports.getUserDashboard = (req, res) => {
    res.render('dashboard', { user: req.user, csrfToken: req.csrfToken() });
};

// Funciones para servir los formularios
exports.getForm1 = (req, res) => {
    res.render('forms/form1', { csrfToken: req.csrfToken() });
};

exports.getForm2 = (req, res) => {
    res.render('forms/form2', { csrfToken: req.csrfToken() });
};

exports.getForm3 = (req, res) => {
    res.render('forms/form3', { csrfToken: req.csrfToken() });
};

// Validación de los formularios con Joi
const form1Schema = Joi.object({
    field1: Joi.string().min(1).max(100).required()
});

const form2Schema = Joi.object({
    field2: Joi.string().min(1).max(100).required()
});

const form3Schema = Joi.object({
    field3: Joi.string().min(1).max(100).required()
});

// Funciones para manejar las sumisiones de los formularios
exports.handleForm1 = (req, res) => {
    const { error, value } = form1Schema.validate(req.body);
    if (error) {
        console.log('Validación fallida en Formulario 1:', error.details[0].message);
        return res.status(400).send('Datos inválidos en Formulario 1');
    }

    const { field1 } = value;
    // Procesa los datos del formulario 1 de manera segura
    console.log('Formulario 1 recibido y validado:', field1);
    // Realiza operaciones necesarias (base de datos, lógica de negocio, etc.)
    res.redirect('/auth/user/dashboard');
};

exports.handleForm2 = (req, res) => {
    const { error, value } = form2Schema.validate(req.body);
    if (error) {
        console.log('Validación fallida en Formulario 2:', error.details[0].message);
        return res.status(400).send('Datos inválidos en Formulario 2');
    }

    const { field2 } = value;
    // Procesa los datos del formulario 2 de manera segura
    console.log('Formulario 2 recibido y validado:', field2);
    // Realiza operaciones necesarias
    res.redirect('/auth/user/dashboard');
};

exports.handleForm3 = (req, res) => {
    const { error, value } = form3Schema.validate(req.body);
    if (error) {
        console.log('Validación fallida en Formulario 3:', error.details[0].message);
        return res.status(400).send('Datos inválidos en Formulario 3');
    }

    const { field3 } = value;
    // Procesa los datos del formulario 3 de manera segura
    console.log('Formulario 3 recibido y validado:', field3);
    // Realiza operaciones necesarias
    res.redirect('/auth/user/dashboard');
};
