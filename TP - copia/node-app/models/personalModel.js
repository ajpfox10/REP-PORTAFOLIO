const db = require('../config/db');

module.exports = {
    buscarAgente: async (tipoBusqueda, valorBusqueda) => {
        let query = '';
        let params = [];

        if (tipoBusqueda === 'dni') {
            query = 'SELECT * FROM personal WHERE dni = ?';
            params = [valorBusqueda];
        } else if (tipoBusqueda === 'apellido') {
            query = 'SELECT * FROM personal WHERE apellido LIKE ?';
            params = [`%${valorBusqueda}%`];
        }

        try {
            const [rows] = await db.query(query, params);
            return rows[0] || null;
        } catch (error) {
            console.error('Error al buscar agente:', error);
            throw error;
        }
    }
};
