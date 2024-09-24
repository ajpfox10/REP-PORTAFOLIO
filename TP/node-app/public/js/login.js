// public/js/login.js

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevenir el envío tradicional del formulario

        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'CSRF-Token': data._csrf // Incluir el token CSRF en las cabeceras
                },
                body: JSON.stringify({
                    email: data.email,
                    password: data.password
                }),
                credentials: 'include' // Asegurar que las cookies se envían con la solicitud
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Error al iniciar sesión');
            }

            console.log('Inicio de sesión exitoso:', result.message);
            // Redirigir al dashboard o manejar el éxito según tus necesidades
            window.location.href = '/auth/user/dashboard';
        } catch (error) {
            console.error('Error al iniciar sesión:', error.message);
            alert(`Error al iniciar sesión: ${error.message}`);
        }
    });
});
