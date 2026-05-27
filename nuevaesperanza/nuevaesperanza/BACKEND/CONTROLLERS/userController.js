const { executePHP } = require('../services/phpExecutor');

// Controlador para manejar el registro de usuario
const registerUser = async (req, res) => {
    const { nombre, email, password, direccion, telefono } = req.body;

    try {
        // Ejecutar el script PHP usando el servicio
        const output = await executePHP('registro.php', {
            nombre,
            email,
            password,
            direccion,
            telefono
        });

        const parsed = JSON.parse(output);
        const status = parsed.success ? 200 : 400;
        res.status(status).json(parsed);
    } catch (err) {
        console.error(`Error ejecutando PHP: ${err.message}`);
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
};

module.exports = { registerUser };
