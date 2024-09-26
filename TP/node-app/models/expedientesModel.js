// models/expedientesModel.js
const db = require('../config/db');

module.exports = {
    /**
     * Obtiene todos los expedientes.
     * @returns {Array} - Lista de expedientes.
     */
    getAllExpedientes: async () => {
        try {
            const [rows] = await db.query('SELECT * FROM expedientes');
            return rows; // Devuelve todas las filas
        } catch (error) {
            console.error('Error al obtener expedientes:', error);
            throw error; // Lanza el error para manejo posterior
        }
    },

    /**
     * Obtiene un expediente por su ID.
     * @param {number} id - ID del expediente.
     * @returns {Object|null} - Expediente o null si no se encuentra.
     */
    getExpedienteById: async (id) => {
        try {
            const [rows] = await db.query('SELECT * FROM expedientes WHERE id = ?', [id]); // Consulta segura
            return rows[0] || null; // Devuelve el expediente o null
        } catch (error) {
            console.error('Error al obtener expediente por ID:', error);
            throw error; // Lanza el error para manejo posterior
        }
    }
};
