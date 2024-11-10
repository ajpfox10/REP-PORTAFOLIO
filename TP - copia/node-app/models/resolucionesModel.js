// models/resolucionesModel.js
const db = require('../config/db');

module.exports = {
    /**
     * Obtiene todas las resoluciones.
     * @returns {Array} - Lista de resoluciones.
     */
    getAllResoluciones: async () => {
        try {
            const [rows] = await db.query('SELECT * FROM resoluciones');
            return rows; // Devuelve todas las filas
        } catch (error) {
            console.error('Error al obtener resoluciones:', error);
            throw error; // Lanza el error para manejo posterior
        }
    },

    /**
     * Obtiene una resolución por su ID.
     * @param {number} id - ID de la resolución.
     * @returns {Object|null} - Resolución o null si no se encuentra.
     */
    getResolucionById: async (id) => {
        try {
            const [rows] = await db.query('SELECT * FROM resoluciones WHERE id = ?', [id]); // Consulta segura
            return rows[0] || null; // Devuelve la resolución o null
        } catch (error) {
            console.error('Error al obtener resolución por ID:', error);
            throw error; // Lanza el error para manejo posterior
        }
    }
};
