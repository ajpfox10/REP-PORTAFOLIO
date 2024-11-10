// controllers/adminController.js

exports.getAdminDashboard = async (req, res) => {
    try {
        // Obtener datos del admin desde req.user o desde la base de datos si es necesario
        const adminData = {
            id: req.user.id,
            email: req.user.email,
            role: req.user.TIPOUSUARIO
            // Agrega más datos si es necesario
        };

        res.render('adminDashboard', { admin: adminData }); // Renderiza la vista adminDashboard.ejs
    } catch (error) {
        console.error('Error al cargar el dashboard de admin:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};
