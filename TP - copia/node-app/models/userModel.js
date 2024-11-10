// models/userModel.js

const db = require('../config/db');
const bcrypt = require('bcrypt');

module.exports = {
    /**
     * Busca un usuario por su correo electrónico.
     * @param {string} email - El correo electrónico del usuario.
     * @returns {Object|null} - Retorna el usuario si se encuentra, de lo contrario null.
     */
    findUserByEmail: async (email) => {
        try {
            const [rows] = await db.query(`
                SELECT 
                    iduser AS id,
                    email, 
                    pass AS password, 
                    TIPOUSUARIO AS TIPOUSUARIO,
                    nameuser,
                    lvl,
                    fondo_imagen,
                    user_fondo,
                    color_preferido,
                    ACTIVO
                FROM users 
                WHERE email = ?
            `, [email]);

            if (rows.length === 0) {
                console.log('No se encontró ningún usuario con el email:', email);
                return null;
            }

            console.log('Usuario encontrado:', rows[0]);
            return rows[0];
        } catch (error) {
            console.error('Error al buscar usuario por email:', error);
            throw error;
        }
    },

    /**
     * Crea un nuevo usuario en la base de datos.
     * @param {string} email - El correo electrónico del usuario.
     * @param {string} password - La contraseña del usuario.
     * @param {string} [role='USER'] - El rol del usuario.
     * @returns {Object} - Resultado de la inserción.
     */
    createUser: async (email, password, role = 'USER') => {
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const [result] = await db.query(`
                INSERT INTO users (email, pass, TIPOUSUARIO, nameuser, lvl, ACTIVO) 
                VALUES (?, ?, ?, ?, ?, ?)
            `, [email, hashedPassword, role, 'NombreUsuario', 1, 1]); // Ajusta otros campos según tu esquema
            return result;
        } catch (error) {
            console.error('Error al crear usuario:', error);
            throw error;
        }
    },

    /**
     * Verifica si la contraseña ingresada coincide con la almacenada.
     * @param {string} inputPassword - La contraseña ingresada por el usuario.
     * @param {string} storedPassword - La contraseña hasheada almacenada en la base de datos.
     * @returns {boolean} - Retorna true si las contraseñas coinciden, de lo contrario false.
     */
    verifyPassword: async (inputPassword, storedPassword) => {
        try {
            console.log('Verificando contraseña: inputPassword:', inputPassword, 'storedPassword:', storedPassword);
            if (!inputPassword || !storedPassword) {
                throw new Error('Se requieren ambos argumentos: data y hash.');
            }
            return await bcrypt.compare(inputPassword, storedPassword);
        } catch (error) {
            console.error('Error en verifyPassword:', error);
            throw error;
        }
    }
};
