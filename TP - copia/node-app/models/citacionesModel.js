// models/citacionesModel.js
const db = require('../config/db');

module.exports = {
    /**
     * Obtiene todas las citaciones.
     * @returns {Array} - Lista de citaciones.
     */
    getAllCitaciones: async () => {
        try {
            const [rows] = await db.query('SELECT * FROM citaciones');
            return rows; // Devuelve todas las filas
        } catch (error) {
            console.error('Error al obtener citaciones:', error);
            throw error; // Lanza el error para manejo posterior
        }
    },

    /**
     * Obtiene una citación por su ID.
     * @param {number} id - ID de la citación.
     * @returns {Object|null} - Citación o null si no se encuentra.
     */
    getCitacionById: async (id) => {
        try {
            const [rows] = await db.query('SELECT * FROM citaciones WHERE id = ?', [id]); // Consulta segura
            return rows[0] || null; // Devuelve la citación o null
        } catch (error) {
            console.error('Error al obtener citación por ID:', error);
            throw error; // Lanza el error para manejo posterior
        }
    }
};
