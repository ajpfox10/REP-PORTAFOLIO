const { executePHP } = require('../services/phpExecutor');

// Controlador para manejar el registro de usuario
const registerUser = async (req, res) => {
    const { nombre, email, password, direccion, telefono } = req.body;

    try {
        // Ejecutar el script PHP usando el servicio
        const output = await executePHP('registro.php', [
            nombre,
            email,
            password,
            direccion,
            telefono
        ]);

        res.json({ success: true, data: output });
    } catch (err) {
        console.error(`Error ejecutando PHP: ${err.message}`);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

module.exports = { registerUser };
