import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

// Inicializar la aplicación de Express
const app = express();
const port = process.env.PORT || 3000;

// Middleware para analizar las solicitudes JSON y formularios
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Middleware para servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Ruta raíz para mostrar la página de inicio de sesión
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'auth.html'));
});

// Ruta de autenticación (ejemplo de manejo de inicio de sesión)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Aquí iría la lógica de autenticación, comprobación de credenciales en la base de datos, etc.
    // Simulación de autenticación simple:
    if (username === 'admin' && password === 'password') {
        // Si la autenticación es exitosa, redirigir al dashboard
        res.redirect('/dashboard');
    } else {
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
