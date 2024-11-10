// scripts/createTestUser.js

const { createUser } = require('../models/userModel');

const crearUsuarioPrueba = async () => {
    const email = 'testuser@example.com';
    const password = 'password123'; // Contraseña en texto plano
    const role = 'USER'; // o 'admin'

    try {
        await createUser(email, password, role);
        console.log('Usuario de prueba creado exitosamente.');
    } catch (error) {
        console.error('Error al crear usuario de prueba:', error);
    }
};

crearUsuarioPrueba();
