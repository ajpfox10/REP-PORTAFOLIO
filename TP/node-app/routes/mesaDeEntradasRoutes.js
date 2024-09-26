// routes/mesaDeEntradasRoutes.js

const express = require('express');
const mesaDeEntradasController = require('../controllers/mesaDeEntradasController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const userController = require('../controllers/userController');
const router = express.Router();

// Ruta para manejar la sumisión del formulario de Mesa de Entradas
router.get(
    '/mesaDeEntradas',
    authMiddleware,
    roleMiddleware(['USER', 'admin']),
    userController.getMesaDeEntradas
);

// Rutas API para obtener detalles de registros
router.get('/api/consultasEchas/:id', authMiddleware, mesaDeEntradasController.getConsultaEchasById);
router.get('/api/expedientes/:id', authMiddleware, mesaDeEntradasController.getExpedienteById);
router.get('/api/citaciones/:id', authMiddleware, mesaDeEntradasController.getCitacionById);
router.get('/api/pedidos/:id', authMiddleware, mesaDeEntradasController.getPedidoById);
router.get('/api/resoluciones/:id', authMiddleware, mesaDeEntradasController.getResolucionById);

module.exports = router;
