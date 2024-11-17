import Swal from 'sweetalert2';

// Manejar el registro
document.getElementById('register-form')?.addEventListener('submit', function (event) {
    event.preventDefault();

    const usernameInput = document.getElementById('username') as HTMLInputElement | null;
    const passwordInput = document.getElementById('password') as HTMLInputElement | null;

    // Verifica que los inputs no sean null
    if (usernameInput && passwordInput) {
        const username = usernameInput.value;
        const password = passwordInput.value;

        fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        })
            .then(response => response.json())
            .then(data => {
                if (data.showAlert) {
                    Swal.fire({
                        title: data.title,
                        text: data.text,
                        icon: data.icon,
                        confirmButtonText: 'Aceptar'
                    });
                }
            })
            .catch(error => console.error('Error:', error));
    }
});

// Manejar el login
document.getElementById('login-form')?.addEventListener('submit', function (event) {
    event.preventDefault();

    const usernameInput = document.getElementById('username') as HTMLInputElement | null;
    const passwordInput = document.getElementById('password') as HTMLInputElement | null;

    // Verifica que los inputs no sean null
    if (usernameInput && passwordInput) {
        const username = usernameInput.value;
        const password = passwordInput.value;

        fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        })
            .then(response => response.json())
            .then(data => {
                if (data.showAlert) {
                    Swal.fire({
                        title: data.title,
                        text: data.text,
                        icon: data.icon,
                        confirmButtonText: 'Aceptar'
                    });
                }

                if (data.token) {
                    // Guardar el token y redirigir a la página de gestión
                    localStorage.setItem('token', data.token);
                    window.location.href = '/dashboard';
                }
            })
            .catch(error => console.error('Error:', error));
    }
});