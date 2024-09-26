// models/consultasEchasModel.js
const db = require('../config/db');

module.exports = {
    /**
     * Obtiene todas las consultas echas.
     * @returns {Array} - Lista de consultas echas.
     */
    getAllConsultasEchas: async () => {
        try {
            const [rows] = await db.query('SELECT * FROM consultas_echas');
            return rows; // Devuelve todas las filas
        } catch (error) {
            console.error('Error al obtener consultas echas:', error);
            throw error; // Lanza el error para manejo posterior
        }
    },

    /**
     * Obtiene una consulta echa por su ID.
     * @param {number} id - ID de la consulta.
     * @returns {Object|null} - Consulta echa o null si no se encuentra.
     */
    getConsultaEchaById: async (id) => {
        try {
            const [rows] = await db.query('SELECT * FROM consultas_echas WHERE id = ?', [id]); // Consulta segura
            return rows[0] || null; // Devuelve la consulta o null
        } catch (error) {
            console.error('Error al obtener consulta echa por ID:', error);
            throw error; // Lanza el error para manejo posterior
        }
    }
};
