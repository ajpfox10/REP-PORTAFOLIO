// routes/authRoutes.js

const express = require('express');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const adminLevelMiddleware = require('../middleware/adminLevel'); // Importa el nuevo middleware

const router = express.Router();

// Rutas de autenticación
router.get('/login', (req, res) => {
    res.render('login', { csrfToken: req.csrfToken() });
});

router.post('/login', authController.login);
router.post('/logout', authController.logout);

// Rutas del dashboard de usuario
router.get('/user/dashboard', authMiddleware, roleMiddleware(['USER', 'admin']), userController.getUserDashboard);

// Rutas para servir los formularios de usuario
router.get('/user/mesaDeEntradas', authMiddleware, roleMiddleware(['USER', 'admin']), userController.getMesaDeEntradas);
router.get('/user/gestion', authMiddleware, roleMiddleware(['USER', 'admin']), userController.getGestion);

// Ruta para servir el formulario de Dirección solo para admin lvl 9
router.get('/user/direccion', authMiddleware, adminLevelMiddleware('admin', 9), userController.getDireccion);

// Rutas para manejar las sumisiones de los formularios
router.post('/user/mesaDeEntradas', authMiddleware, roleMiddleware(['USER', 'admin']), userController.handleMesaDeEntradas);
router.post('/user/gestion', authMiddleware, roleMiddleware(['USER', 'admin']), userController.handleGestion);
router.post('/user/direccion', authMiddleware, adminLevelMiddleware('admin', 9), userController.handleDireccion);

// Rutas del dashboard de admin
router.get('/admin/dashboard', authMiddleware, roleMiddleware(['admin']), adminController.getAdminDashboard);

// Log de las funciones de controlador (opcional)
console.log('authController.login:', authController.login);
console.log('authController.logout:', authController.logout);
console.log('userController.getUserDashboard:', userController.getUserDashboard);
console.log('userController.getMesaDeEntradas:', userController.getMesaDeEntradas);
console.log('userController.getGestion:', userController.getGestion);
console.log('userController.getDireccion:', userController.getDireccion);
console.log('userController.handleMesaDeEntradas:', userController.handleMesaDeEntradas);
console.log('userController.handleGestion:', userController.handleGestion);
console.log('userController.handleDireccion:', userController.handleDireccion);
console.log('adminController.getAdminDashboard:', adminController.getAdminDashboard);

module.exports = router;
