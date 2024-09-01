const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController'); 
const auth = require('../middlewares/auth'); // Importar el middleware de autenticación
const pool = require('../config/db'); 

// Endpoint para obtener la lista de servicios
router.get('/get-services', auth.verifyToken, userController.getServices);
router.post('/insert-agente-servicio', auth.verifyToken, userController.insertAgenteServicio);
module.exports = router;
