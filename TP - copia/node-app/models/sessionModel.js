// models/sessionModel.js

const db = require('../config/db');

module.exports = {
    /**
     * Busca una sesión activa por el ID del usuario.
     * @param {number} userId - El ID del usuario.
     * @returns {Object|null} - Retorna la sesión si se encuentra, de lo contrario null.
     */
    findActiveSession: async (userId) => {
        try {
            const [rows] = await db.query('SELECT * FROM sessions WHERE user_id = ? AND active = ?', [userId, true]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error al buscar sesión activa:', error);
            throw error;
        }
    },

    /**
     * Crea una nueva sesión en la base de datos.
     * @param {number} userId - El ID del usuario.
     * @param {string} token - El token de la sesión.
     */
    createSession: async (userId, token) => {
        try {
            await db.query('INSERT INTO sessions (user_id, token, active) VALUES (?, ?, ?)', [userId, token, true]);
        } catch (error) {
            console.error('Error al crear sesión:', error);
            throw error;
        }
    },

    /**
     * Elimina una sesión activa por el token.
     * @param {string} token - El token de la sesión.
     */
    deleteSession: async (token) => {
        try {
            await db.query('DELETE FROM sessions WHERE token = ?', [token]);
        } catch (error) {
            console.error('Error al eliminar sesión:', error);
            throw error;
        }
    }
};
