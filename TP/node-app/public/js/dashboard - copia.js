// public/js/dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    const btnMesaDeEntradas = document.getElementById('btnMesaDeEntradas');
    const btnGestion = document.getElementById('btnGestion');
    const btnDireccion = document.getElementById('btnDireccion');
    const formContainer = document.getElementById('formContainer');
    const dashboardSidebar = document.getElementById('dashboardSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const openSidebarButton = document.getElementById('openSidebarButton');

    // Opcional: Loader
    const formLoader = document.createElement('div');
    formLoader.className = 'form-loader';
    formLoader.innerHTML = '<div class="spinner"></div>';
    formContainer.appendChild(formLoader);

    // Función para cargar formularios
    function loadForm(url) {
        formLoader.style.display = 'block'; // Mostrar el loader
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
            hideSidebar(); // Ocultar el sidebar al cargar un formulario
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Ocurrió un error al cargar el formulario.');
        })
        .finally(() => {
            formLoader.style.display = 'none'; // Ocultar el loader
        });
    }

    // Event listeners para los botones
    if (btnMesaDeEntradas) {
        btnMesaDeEntradas.addEventListener('click', () => {
            loadForm('/auth/user/mesaDeEntradas');
            setActiveButton(btnMesaDeEntradas);
        });
    }

    if (btnGestion) {
        btnGestion.addEventListener('click', () => {
            loadForm('/auth/user/gestion');
            setActiveButton(btnGestion);
        });
    }

    if (btnDireccion) {
        btnDireccion.addEventListener('click', () => {
            loadForm('/auth/user/direccion');
            setActiveButton(btnDireccion);
        });
    }

    // Función para resaltar el botón activo
    function setActiveButton(activeBtn) {
        const buttons = document.querySelectorAll('.sidebar-button');
        buttons.forEach(btn => {
            btn.classList.remove('active-button');
        });
        activeBtn.classList.add('active-button');
    }

    // Función para ocultar el sidebar
    function hideSidebar() {
        dashboardSidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
    }

    // Función para mostrar el sidebar
    function showSidebar() {
        dashboardSidebar.classList.add('active');
        sidebarOverlay.classList.add('active');
    }

    // Manejar la aparición del sidebar al acercar el mouse al borde izquierdo
    document.addEventListener('mousemove', (e) => {
        if (e.clientX <= 50 && !dashboardSidebar.classList.contains('active')) {
            showSidebar();
        }
    });

    // Manejar el clic en el overlay para ocultar el sidebar
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', hideSidebar);
    }

    // Manejar el clic en el botón para abrir el sidebar (en dispositivos móviles)
    if (openSidebarButton) {
        openSidebarButton.addEventListener('click', () => {
            showSidebar();
        });
    }
});

    // Opcional: Cargar un formulario predeterminado al iniciar
    // Por ejemplo, cargar "Mesa de Entradas" por defecto
    // loadForm('/auth/user/mesaDeEntradas');
    // setActiveButton(btnMesaDeEntradas);

