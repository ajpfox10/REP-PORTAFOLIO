const express = require('express');
const path = require('path');
const { registerUser } = require('./BACKEND/CONTROLLERS/userController');
const validateRegistro = require('./BACKEND/middleware/validateRegistro');
const app = express();
const port = process.env.PORT || 1337;

// Middleware para procesar datos del formulario
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Log de todas las solicitudes
app.use((req, res, next) => {
    console.log(`[LOG] Solicitud recibida: ${req.method} ${req.url}`);
    next();
});

// Ruta principal
app.get('/', (req, res) => {
    console.log('[LOG] Serviendo archivo index.html');
    app.use(express.static(path.join(__dirname, 'FRONTEND', 'RECURSOS')));
});

// Ruta temporal para probar GET
app.get('/api/register-user', (req, res) => {
    console.log('[LOG] GET /api/register-user ejecutado');
    res.send('Ruta GET /api/register-user activa');
});

// Ruta POST para registro de usuario
app.post('/api/register-user', validateRegistro, registerUser);

// Inicia el servidor
app.listen(port, () => {
    console.log(`[LOG] Servidor ejecutándose en http://localhost:${port}`);
});
