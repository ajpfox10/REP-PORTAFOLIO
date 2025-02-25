document.addEventListener('DOMContentLoaded', function () {
    const registroForm = document.getElementById('registroForm');
    registroForm.addEventListener('submit', function (event) {
        event.preventDefault();

        const nombre = document.getElementById('nombre').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirmarPassword = document.getElementById('confirmarPassword').value;
        const direccion = document.getElementById('direccion').value.trim();
        const telefono = document.getElementById('telefono').value.trim();

        if (password !== confirmarPassword) {
            alert('Las contraseñas no coinciden. Por favor, inténtalo de nuevo.');
            return;
        }

        // Crear un objeto con los datos del formulario
        const formData = new FormData();
        formData.append('nombre', nombre);
        formData.append('email', email);
        formData.append('password', password);
        formData.append('direccion', direccion);
        formData.append('telefono', telefono);

        // Enviar el formulario con el método POST
        fetch('../../BACKEND/API/registro.php', {
            method: 'POST',
            body: formData
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Error en la solicitud de red: ' + response.status);
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    console.log('Registro exitoso.');
                    alert('Registro exitoso.');
                    window.location.href = '/';
                } else {
                    console.log('Error: ' + data.message);
                    alert('Error: ' + data.message);
                }
            })
            .catch(error => {
                console.error('Error al enviar el formulario:', error);
                alert('Ocurrió un error al registrarse. Por favor, intenta de nuevo.');
            });
    });
});
