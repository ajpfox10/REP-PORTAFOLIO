// controllers/userController.js
const consultasEchasModel = require('../models/consultasEchasModel');
const expedientesModel = require('../models/expedientesModel');
const citacionesModel = require('../models/citacionesModel');
const pedidosModel = require('../models/pedidosModel');
const resolucionesModel = require('../models/resolucionesModel');
const Joi = require('joi');

// Función para renderizar el dashboard del usuario
exports.getUserDashboard = (req, res) => {
    res.render('dashboard', { user: req.user, csrfToken: req.csrfToken() });
};

// Funciones para servir los formularios
exports.getMesaDeEntradas = async (req, res) => {
    try {
        const [consultasEchas, expedientes, citaciones, pedidos, resoluciones] = await Promise.all([
            consultasEchasModel.getAllConsultasEchas(),
            expedientesModel.getAllExpedientes(),
            citacionesModel.getAllCitaciones(),
            pedidosModel.getAllPedidos(),
            resolucionesModel.getAllResoluciones()
        ]);
        res.render('forms/mesaDeEntradas', { 
            csrfToken: req.csrfToken(),
            consultasEchas,
            expedientes,
            citaciones,
            pedidos,
            resoluciones
        });
    } catch (error) {
        console.error('Error al cargar el formulario de Mesa de Entradas:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.getGestion = (req, res) => {
    res.render('forms/gestion', { csrfToken: req.csrfToken() });
};

exports.getDireccion = (req, res) => {
    res.render('forms/direccion', { csrfToken: req.csrfToken() });
};

// Validación de los formularios con Joi
const mesaDeEntradasSchema = Joi.object({
    field1: Joi.string().min(1).max(100).required()
});

const gestionSchema = Joi.object({
    field2: Joi.string().min(1).max(100).required()
});

const direccionSchema = Joi.object({
    field3: Joi.string().min(1).max(100).required()
});

// Funciones para manejar las sumisiones de los formularios
exports.handleMesaDeEntradas = (req, res) => {
    const { error, value } = mesaDeEntradasSchema.validate(req.body);
    if (error) {
        console.log('Validación fallida en Mesa de Entradas:', error.details[0].message);
        return res.status(400).send('Datos inválidos en Mesa de Entradas');
    }

    const { field1 } = value;
    // Procesa los datos de Mesa de Entradas de manera segura
    console.log('Mesa de Entradas recibida y validada:', field1);
    // Realiza operaciones necesarias (base de datos, lógica de negocio, etc.)
    res.redirect('/auth/user/dashboard');
};

exports.handleGestion = (req, res) => {
    const { error, value } = gestionSchema.validate(req.body);
    if (error) {
        console.log('Validación fallida en Gestión:', error.details[0].message);
        return res.status(400).send('Datos inválidos en Gestión');
    }

    const { field2 } = value;
    // Procesa los datos de Gestión de manera segura
    console.log('Gestión recibida y validada:', field2);
    // Realiza operaciones necesarias (base de datos, lógica de negocio, etc.)
    res.redirect('/auth/user/dashboard');
};

exports.handleDireccion = (req, res) => {
    const { error, value } = direccionSchema.validate(req.body);
    if (error) {
        console.log('Validación fallida en Dirección:', error.details[0].message);
        return res.status(400).send('Datos inválidos en Dirección');
    }

    const { field3 } = value;
    // Procesa los datos de Dirección de manera segura
    console.log('Dirección recibida y validada:', field3);
    // Realiza operaciones necesarias (base de datos, lógica de negocio, etc.)
    res.redirect('/auth/user/dashboard');
};
