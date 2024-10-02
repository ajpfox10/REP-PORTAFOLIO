document.addEventListener('DOMContentLoaded', () => {
    const btnMesaDeEntradas = document.getElementById('btnMesaDeEntradas');
    const btnGestion = document.getElementById('btnGestion');
    const btnDireccion = document.getElementById('btnDireccion');
    const formContainer = document.getElementById('formContainer');
    const dashboardSidebar = document.getElementById('dashboardSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const hoverZone = document.getElementById('hoverZone');
    const mainContent = document.querySelector('.dashboard-main');
    const sidebarButtons = document.querySelectorAll('.sidebar-button');
    let timeout; // Variable para almacenar el temporizador

    // **Crear el loader para formularios**
    const formLoader = document.createElement('div');
    formLoader.className = 'form-loader';
    formLoader.innerHTML = '<div class="spinner"></div>';
    formContainer.appendChild(formLoader); // Lo añadimos al contenedor de formularios

    // Función para mostrar el sidebar
    function showSidebar() {
        clearTimeout(timeout); // Cancela cualquier temporizador existente
        dashboardSidebar.classList.add('visible');
        mainContent.style.marginLeft = '250px';
        sidebarOverlay.classList.add('visible');
    }

    // Función para ocultar el sidebar
    function hideSidebar() {
        dashboardSidebar.classList.remove('visible');
        mainContent.style.marginLeft = '0';
        sidebarOverlay.classList.remove('visible');
    }

    // Mostrar el sidebar al acercar el mouse al borde izquierdo
    hoverZone.addEventListener('mouseenter', showSidebar);

    // Ocultar sidebar automáticamente después de 4 segundos si el mouse no está sobre él
    dashboardSidebar.addEventListener('mouseleave', () => {
        timeout = setTimeout(hideSidebar, 4000); // Ocultar después de 4 segundos
    });

    // Ocultar sidebar cuando se hace clic en un botón del formulario o en el overlay
    sidebarButtons.forEach(button => {
        button.addEventListener('click', hideSidebar);
    });

    sidebarOverlay.addEventListener('click', hideSidebar);

    // Manejar el clic en el botón para abrir el sidebar (en dispositivos móviles)
    if (document.getElementById('openSidebarButton')) {
        document.getElementById('openSidebarButton').addEventListener('click', showSidebar);
    }

    // Función para resaltar el botón activo
    function setActiveButton(activeBtn) {
        sidebarButtons.forEach(btn => {
            btn.classList.remove('active-button');
        });
        activeBtn.classList.add('active-button');
    }

    // Función para cargar formularios
    function loadForm(url) {
        formLoader.style.display = 'block'; // Mostrar el loader
        formContainer.style.display = 'none'; // Ocultar el contenedor mientras carga el formulario

        fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'text/html'
            },
            credentials: 'include'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar el formulario');
            }
            return response.text();
        })
        .then(html => {
            formContainer.innerHTML = html;
            formContainer.style.display = 'block'; // Mostrar el contenedor con el formulario cargado
            formContainer.style.minHeight = '100vh'; // Asegurar que el contenedor ocupe toda la altura de la pantalla
            formLoader.style.display = 'none'; // Ocultar el loader una vez cargado el contenido
            hideSidebar();
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Ocurrió un error al cargar el formulario.');
            formContainer.style.display = 'block'; // Asegurar que el contenedor del formulario sea visible aunque falle la carga
        })
        .finally(() => {
            formLoader.style.display = 'none'; // Ocultar el loader cuando se cargue el formulario o falle
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
 // **Nueva Función: Manejar la búsqueda de agentes por DNI o Apellido**
    const buscarAgente = document.getElementById('buscarAgente');
    if (buscarAgente) {
        buscarAgente.addEventListener('click', () => {
            const tipoBusqueda = document.getElementById('tipoBusqueda').value;
            const valorBusqueda = document.getElementById('valorBusqueda').value;

            // Llamada AJAX para buscar el agente
            fetch('/auth/user/buscarAgente', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('input[name="_csrf"]').value
                },
                body: JSON.stringify({
                    tipoBusqueda: tipoBusqueda,
                    valorBusqueda: valorBusqueda
                }),
                credentials: 'include'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('dniAgente').value = data.agente.dni;
                    document.getElementById('apellidoAgente').value = data.agente.apellido;
                } else {
                    alert('No se encontró ningún agente.');
                }
            })
            .catch(error => {
                console.error('Error en la búsqueda:', error);
                alert('Ocurrió un error en la búsqueda.');
            });
        });
    }
    // **Cargar DataTables**
    $(document).ready(function() {
        var table = $('#dataTable').DataTable();

        // Función para mostrar datos emergentes al hacer clic en el botón de detalles
        $('#dataTable tbody').on('click', '.btn-detail', function() {
            var tr = $(this).closest('tr');
            var row = table.row(tr);

            if (row.child.isShown()) {
                row.child.hide();
                tr.removeClass('shown');
            } else {
                row.child(format(row.data())).show();
                tr.addClass('shown');
            }
        });

        // Función para formatear los detalles que se mostrarán
        function format(rowData) {
            return '<div>Detalles adicionales de la consulta:<br>' +
                   'ID: ' + rowData[0] + '<br>' +
                   'Nombre: ' + rowData[1] + '<br>' +
                   'Motivo: ' + rowData[2] + '<br>' +
                   'Fecha: ' + rowData[3] + '</div>';
        }
    });
});
