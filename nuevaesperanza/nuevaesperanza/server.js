const express = require('express');
const path = require('path');
const { registerUser } = require('./BACKEND/CONTROLLERS/userController');
const validateRegistro = require('./BACKEND/MIDDLEWARE/validateRegistro');
const app = express();
const port = process.env.PORT || 1337;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'FRONTEND', 'RECURSOS')));

app.use((req, res, next) => {
    console.log(`[LOG] Solicitud recibida: ${req.method} ${req.url}`);
    next();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'FRONTEND', 'RECURSOS', 'index.html'));
});

// Ruta temporal para probar GET
app.get('/api/register-user', (req, res) => {
    res.send('Ruta GET /api/register-user activa');
});

// Ruta POST para registro de usuario
app.post('/api/register-user', validateRegistro, registerUser);

app.listen(port, () => {
    console.log(`[LOG] Servidor ejecutandose en http://localhost:${port}`);
});
