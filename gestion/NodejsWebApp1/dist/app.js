"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const body_parser_1 = __importDefault(require("body-parser"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
// Inicializar la aplicación de Express
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Middleware para analizar las solicitudes JSON y formularios
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
// Middleware para servir archivos estáticos
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
// Ruta raíz para mostrar la página de inicio de sesión
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, 'public', 'html', 'auth.html'));
});
// Ruta de autenticación (ejemplo de manejo de inicio de sesión)
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    // Aquí iría la lógica de autenticación, comprobación de credenciales en la base de datos, etc.
    // Simulación de autenticación simple:
    if (username === 'admin' && password === 'password') {
        // Si la autenticación es exitosa, redirigir al dashboard
        res.redirect('/dashboard');
    }
    else {
        // Si falla la autenticación, redirigir de nuevo a la página de login
        res.redirect('/');
    }
});
// Ruta de dashboard para usuarios autenticados
app.get('/dashboard', (req, res) => {
    res.send('Bienvenido al dashboard. Aquí se mostrarían las opciones del usuario autenticado.');
});
// Ruta de cierre de sesión
app.get('/logout', (req, res) => {
    // Lógica de cierre de sesión, destrucción de sesión o token
    res.redirect('/');
});
// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor ejecutándose en http://localhost:${port}`);
});
