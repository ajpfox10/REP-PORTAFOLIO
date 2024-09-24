// routes/authRoutes.js

const express = require('express');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');

const router = express.Router();

// Rutas de autenticación
router.get('/login', (req, res) => {
    res.render('login', { csrfToken: req.csrfToken() });
});

router.post('/login', authController.login);
router.post('/logout', authController.logout);

// Rutas del dashboard de usuario
router.get('/user/dashboard', authMiddleware, roleMiddleware('USER'), userController.getUserDashboard);

// Rutas para servir los formularios de usuario
router.get('/user/form1', authMiddleware, roleMiddleware('USER'), userController.getForm1);
router.get('/user/form2', authMiddleware, roleMiddleware('USER'), userController.getForm2);
router.get('/user/form3', authMiddleware, roleMiddleware('USER'), userController.getForm3);

// Rutas para manejar las sumisiones de los formularios
router.post('/user/form1', authMiddleware, roleMiddleware('USER'), userController.handleForm1);
router.post('/user/form2', authMiddleware, roleMiddleware('USER'), userController.handleForm2);
router.post('/user/form3', authMiddleware, roleMiddleware('USER'), userController.handleForm3);

// Rutas del dashboard de admin
router.get('/admin/dashboard', authMiddleware, roleMiddleware('admin'), adminController.getAdminDashboard);
// routes/authRoutes.js

console.log('authController.login:', authController.login);
console.log('authController.logout:', authController.logout);
console.log('userController.getUserDashboard:', userController.getUserDashboard);
console.log('userController.getForm1:', userController.getForm1);
console.log('userController.getForm2:', userController.getForm2);
console.log('userController.getForm3:', userController.getForm3);
console.log('userController.handleForm1:', userController.handleForm1);
console.log('userController.handleForm2:', userController.handleForm2);
console.log('userController.handleForm3:', userController.handleForm3);
console.log('adminController.getAdminDashboard:', adminController.getAdminDashboard);

module.exports = router;
