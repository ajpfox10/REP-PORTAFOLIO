// controllers/mesaDeEntradasController.js

const Joi = require('joi');
const consultasEchasModel = require('../models/consultasEchasModel');
const expedientesModel = require('../models/expedientesModel');
const citacionesModel = require('../models/citacionesModel');
const pedidosModel = require('../models/pedidosModel');
const resolucionesModel = require('../models/resolucionesModel');

// Definir el esquema de validación con Joi
const mesaDeEntradasSchema = Joi.object({
    motivoConsulta: Joi.string().min(1).max(500).required(),
    explicacionDada: Joi.string().min(1).max(1000).required(),
    // Añade más campos según tus necesidades
});

// Función para renderizar el formulario de Mesa de Entradas
exports.getMesaDeEntradas = async (req, res) => {
    try {
        const [
            consultasEchas,
            expedientes,
            citaciones,
            pedidos,
            resoluciones
        ] = await Promise.all([
            consultasEchasModel.getAllConsultasEchas(),
            expedientesModel.getAllExpedientes(),
            citacionesModel.getAllCitaciones(),
            pedidosModel.getAllPedidos(),
            resolucionesModel.getAllResoluciones()
        ]);

        console.log('consultasEchas:', consultasEchas); // Verificar datos

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

// Función para manejar la sumisión del formulario de Mesa de Entradas
exports.handleMesaDeEntradas = async (req, res) => {
    const { error, value } = mesaDeEntradasSchema.validate(req.body);
    if (error) {
        console.log('Validación fallida en Mesa de Entradas:', error.details[0].message);
        return res.status(400).send('Datos inválidos en Mesa de Entradas');
    }

    const { motivoConsulta, explicacionDada } = value;
    // Procesa los datos de Mesa de Entradas de manera segura
    console.log('Mesa de Entradas recibida y validada:', { motivoConsulta, explicacionDada });
    // Realiza operaciones necesarias (base de datos, lógica de negocio, etc.)
    res.redirect('/auth/user/dashboard');
};

// Rutas API para obtener detalles de registros
exports.getConsultaEchasById = async (req, res) => {
    try {
        const id = req.params.id;
        const consulta = await consultasEchasModel.getConsultaEchaById(id);
        if (!consulta) {
            return res.status(404).json({ message: 'Consulta Echa no encontrada' });
        }
        res.json(consulta);
    } catch (error) {
        console.error('Error en API /api/consultasEchas/:id:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.getExpedienteById = async (req, res) => {
    try {
        const id = req.params.id;
        const expediente = await expedientesModel.getExpedienteById(id);
        if (!expediente) {
            return res.status(404).json({ message: 'Expediente no encontrado' });
        }
        res.json(expediente);
    } catch (error) {
        console.error('Error en API /api/expedientes/:id:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.getCitacionById = async (req, res) => {
    try {
        const id = req.params.id;
        const citacion = await citacionesModel.getCitacionById(id);
        if (!citacion) {
            return res.status(404).json({ message: 'Citación no encontrada' });
        }
        res.json(citacion);
    } catch (error) {
        console.error('Error en API /api/citaciones/:id:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.getPedidoById = async (req, res) => {
    try {
        const id = req.params.id;
        const pedido = await pedidosModel.getPedidoById(id);
        if (!pedido) {
            return res.status(404).json({ message: 'Pedido no encontrado' });
        }
        res.json(pedido);
    } catch (error) {
        console.error('Error en API /api/pedidos/:id:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

exports.getResolucionById = async (req, res) => {
    try {
        const id = req.params.id;
        const resolucion = await resolucionesModel.getResolucionById(id);
        if (!resolucion) {
            return res.status(404).json({ message: 'Resolución no encontrada' });
        }
        res.json(resolucion);
    } catch (error) {
        console.error('Error en API /api/resoluciones/:id:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};
