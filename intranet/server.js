const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');  // Asegúrate de haber importado el módulo path
const authRoutes = require('./routes/authRoutes');  // Importa las rutas de autenticación
const userRoutes = require('./routes/userRoutes');  // Importa las rutas de usuario
const serviciosRoutes = require('./routes/serviciosRoutes');  // Importa las rutas de servicios

const app = express();

app.use(bodyParser.json());
app.use(cookieParser()); // Middleware para analizar las cookies
app.use('/css', express.static(__dirname + '/public/css'));
app.use('/html', express.static(__dirname + '/public/html'));
app.use('/js', express.static(__dirname + '/public/js'));

app.get('/', (req, res) => {
    res.redirect('/login'); // O redirigir a la página principal si tienes una
});
// Ruta para la página de login (ruta raíz)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/login.html')); // Ajusta la ruta aquí
});


// Usa las rutas importadas sin prefijo
app.use(authRoutes);
app.use(userRoutes);
app.use(serviciosRoutes); // Sin prefijo, las rutas estarán directamente accesibles

// Rutas para servir las páginas estáticas de admin y usuario general
/*
app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/public/html/admin.html');
});

app.get('/usuario', (req, res) => {
    res.sendFile(__dirname + '/public/html/usuario.html');
});

// Rutas específicas para sectores
app.get('/usuario/sector1', (req, res) => {
    res.sendFile(__dirname + '/public/html/usuario_sector1.html');
});

app.get('/usuario/sector2', (req, res) => {
    res.sendFile(__dirname + '/public/html/usuario_sector2.html');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'path-to-your-login-page.html'));
});
*/
app.listen(3000, () => {
    console.log('Server is running on port 3000');
});

