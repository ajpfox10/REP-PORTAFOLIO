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

router.get('/mesaDeEntradas', authMiddleware, roleMiddleware(['USER', 'admin']), userController.getMesaDeEntradas);

router.post('/buscarAgente', authMiddleware, async (req, res) => {
    const { tipoBusqueda, valorBusqueda } = req.body;
    try {
        const agente = await personalModel.buscarAgente(tipoBusqueda, valorBusqueda);
        if (!agente) {
            return res.json({ success: false, message: 'Agente no encontrado' });
        }
        res.json({ success: true, agente });
    } catch (error) {
        console.error('Error al buscar agente:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});


module.exports = router;
