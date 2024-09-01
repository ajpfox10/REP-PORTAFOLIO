// authController.js
const pool = require('../config/db'); // Importar la conexión a la base de datos
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const [users] = await pool.query('SELECT * FROM usuarios WHERE username = ?', [username]);

        if (users.length === 0) {
            // Notificar con SweetAlert2 de un error de credenciales
            return res.status(401).json({ 
                message: 'Credenciales no válidas', 
                swAlert: { 
                    title: 'Error', 
                    text: 'Usuario o contraseña incorrectos', 
                    icon: 'error' 
                }
            });
        }

        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            // Notificar con SweetAlert2 de un error de credenciales
            return res.status(401).json({ 
                message: 'Credenciales no válidas', 
                swAlert: { 
                    title: 'Error', 
                    text: 'Usuario o contraseña incorrectos', 
                    icon: 'error' 
                }
            });
        }

        // Generar el token JWT incluyendo el rol y el servicio
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.rol,   // Incluye el rol aquí
                servicio: user.servicio
            },
            'Silencio2503', // Llave secreta
            { expiresIn: '1h' } // El token expirará en 1 hora
        );

        // Determinar la página a la que redirigir según el sector del usuario
        let userPage = `/usuario`;
        if (user.servicio === 'sector1') {
            userPage = `/usuario/sector1`;
        } else if (user.servicio === 'sector2') {
            userPage = `/usuario/sector2`;
        }

        res.cookie('token', token, {
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production',
            maxAge: 3600000 // 1 hora
        });

        // Notificar con SweetAlert2 de un inicio de sesión exitoso
        res.status(200).json({ 
            message: 'Login successful', 
            redirectTo: userPage,
            swAlert: {
                title: 'Bienvenido',
                text: 'Inicio de sesión exitoso',
                icon: 'success'
            }
        });
    } catch (error) {
        console.error('Error durante el inicio de sesión:', error);
        // Notificar con SweetAlert2 de un error del servidor
        return res.status(500).json({ 
            message: 'Error del servidor', 
            swAlert: {
                title: 'Error',
                text: 'Ocurrió un error en el servidor. Por favor, intenta de nuevo más tarde.',
                icon: 'error'
            }
        });
    }
};


