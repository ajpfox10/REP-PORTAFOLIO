// server.js

const express = require('express');
const helmet = require('helmet');
const path = require('path');
const session = require('express-session');
const rateLimiter = require('./middleware/rateLimiter');
const xssProtection = require('./middleware/xssProtection');
const authRoutes = require('./routes/authRoutes');
const mesaDeEntradasRoutes = require('./routes/mesaDeEntradasRoutes'); // Importar el nuevo archivo de rutas
const { sessionSecret } = require('./config/config');
const morgan = require('morgan');
const fs = require('fs');
const { createStream } = require('rotating-file-stream'); // Para rotación de logs
const cookieParser = require('cookie-parser');
const csrf = require('csurf'); // Importar csurf
require('dotenv').config();

const app = express();

// Middlewares de seguridad con Helmet
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "https://cdn.datatables.net", // Permitir DataTables JS
                    "https://code.jquery.com"     // Permitir jQuery
                ],
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",            // Permitir estilos inline (opcional, si lo necesitas)
                    "https://cdn.datatables.net", // Permitir DataTables CSS
                ],
                //styleSrc: ["'self'", 'https:'],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'", 'https:', 'data:'],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: [],
            },
        },
    })
);

// Middleware para parsear cuerpos de solicitudes
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Middleware para parsear cookies
app.use(cookieParser());

// Limitar solicitudes
app.use(rateLimiter);

// Protección contra ataques XSS
app.use(xssProtection);

// Logger para registrar solicitudes en logs
const logDirectory = path.join(__dirname, 'logs');

// Asegurarse de que el directorio de logs existe
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

const accessLogStream = createStream('access.log', {
    interval: '1d', // Rotar diariamente
    path: logDirectory
});

app.use(morgan('combined', { stream: accessLogStream }));

// Gestión de sesión
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    }
}));

// Configurar csurf middleware después de cookieParser y session
app.use(csrf());

// Middleware para pasar el token CSRF a todas las vistas
app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
});

// Motor de plantillas EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware para servir archivos estáticos - DEBE ESTAR ANTES DE LAS RUTas
app.use(express.static(path.join(__dirname, 'public')));

// Rutas
app.use('/auth', authRoutes);
app.use('/auth/user', mesaDeEntradasRoutes); // Montar las rutas de Mesa de Entradas bajo /auth/user
// Ruta raíz redirige a login
app.get('/', (req, res) => {
    res.redirect('/auth/login');
});

// Manejo de errores global
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        // Manejar el error de CSRF
        res.status(403).json({ message: 'Formulario inválido' });
    } else {
        console.error(err.stack);
        res.status(500).json({ message: 'Ocurrió un error en el servidor' });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
