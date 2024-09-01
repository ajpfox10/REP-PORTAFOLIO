// routes/adminRoutes.js
const express = require('express');
const { verifyToken } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleAuthorization');
const authController = require('../controllers/authController'); 
const path = require('path');
const router = express.Router();
router.post('/login', authController.login);
// Ruta protegida para el panel de administración
router.get('/admin-page', verifyToken, checkRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../public/html/admin.html'));
});

// Exportar el enrutador
module.exports = router;