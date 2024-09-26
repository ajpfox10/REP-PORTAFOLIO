// models/pedidosModel.js
const db = require('../config/db');

module.exports = {
    /**
     * Obtiene todos los pedidos.
     * @returns {Array} - Lista de pedidos.
     */
    getAllPedidos: async () => {
        try {
            const [rows] = await db.query('SELECT * FROM pedidos');
            return rows; // Devuelve todas las filas
        } catch (error) {
            console.error('Error al obtener pedidos:', error);
            throw error; // Lanza el error para manejo posterior
        }
    },

    /**
     * Obtiene un pedido por su ID.
     * @param {number} id - ID del pedido.
     * @returns {Object|null} - Pedido o null si no se encuentra.
     */
    getPedidoById: async (id) => {
        try {
            const [rows] = await db.query('SELECT * FROM pedidos WHERE id = ?', [id]); // Consulta segura
            return rows[0] || null; // Devuelve el pedido o null
        } catch (error) {
            console.error('Error al obtener pedido por ID:', error);
            throw error; // Lanza el error para manejo posterior
        }
    }
};
