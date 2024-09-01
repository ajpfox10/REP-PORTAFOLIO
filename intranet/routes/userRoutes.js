const express = require('express');
const userController = require('../controllers/userController');
const auth = require('../middlewares/auth'); // Middleware de autenticación
const { checkRole } = require('../middlewares/roleAuthorization'); // Middleware de autorización
const router = express.Router();
const path = require('path');

// Rutas para gestionar usuarios (protegidas, solo admin)
router.post('/register', auth.verifyToken, checkRole('admin'), userController.register);
router.post('/deactivate', auth.verifyToken, checkRole('admin'), userController.deactivate);
router.post('/activate', auth.verifyToken, checkRole('admin'), userController.activate);
router.post('/change-role', auth.verifyToken, checkRole('admin'), userController.changeRole);
router.post('/change-level', auth.verifyToken, checkRole('admin'), userController.changeLevel);


// Rutas para obtener agentes y tipos de novedad (protegidas, accesibles por usuarios comunes y admin)
router.get('/get-agentes', auth.verifyToken, userController.getAgentes);
router.get('/get-tipos-novedad', auth.verifyToken, userController.getTiposDeNovedad);
router.get('/buscar-apellido', auth.verifyToken, userController.buscarApellido);

// Rutas para manejar novedades (protegidas)
router.post('/cargar-novedad', auth.verifyToken, userController.cargarNovedad);
router.post('/cargar-novedades-rango', auth.verifyToken, userController.cargarNovedadesPorRango);
router.get('/get-novedades-cargadas', auth.verifyToken, userController.getNovedadesCargadas);
router.post('/eliminar-novedad', auth.verifyToken, userController.eliminarNovedad);

// Rutas adicionales (protegidas)
router.get('/get-users', auth.verifyToken, checkRole('admin'), userController.getUsers);
router.get('/get-tipos-cuidado', auth.verifyToken, userController.getTiposCuidado);
router.get('/get-agentes-servicios', auth.verifyToken, userController.getAgentesServicios);
router.post('/eliminar-agente-servicio', auth.verifyToken, userController.eliminarAgenteServicio);
router.post('/cambiar-servicio', auth.verifyToken, userController.cambiarServicio);
router.get('/reporte-pdf', auth.verifyToken, userController.generarReportePDF);
router.post('/logout', auth.verifyToken, userController.logout);
router.post('/change-service', auth.verifyToken, userController.changeService);
router.get('/api/filtered-novedades', auth.verifyToken, userController.getFilteredNovedades);
router.get('/cargar-agentes-asignables', auth.verifyToken, userController.cargarAgentesAsignables);

// Ruta para destino, accesible solo por usuarios autenticados
router.get('/usuario', auth.verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/html/usuario.html'));
});

module.exports = router;
