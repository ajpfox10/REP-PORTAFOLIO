// public/js/dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    const btnForm1 = document.getElementById('btnForm1');
    const btnForm2 = document.getElementById('btnForm2');
    const btnForm3 = document.getElementById('btnForm3');
    const formContainer = document.getElementById('formContainer');

    btnForm1.addEventListener('click', () => {
        loadForm('/auth/user/form1');
    });

    btnForm2.addEventListener('click', () => {
        loadForm('/auth/user/form2');
    });

    btnForm3.addEventListener('click', () => {
        loadForm('/auth/user/form3');
    });

    function loadForm(url) {
        fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'text/html'
            },
            credentials: 'include' // Asegura que las cookies se envían con la solicitud
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar el formulario');
            }
            return response.text();
        })
        .then(html => {
            formContainer.innerHTML = html;
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Ocurrió un error al cargar el formulario.');
        });
    }
});
