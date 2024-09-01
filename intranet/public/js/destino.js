//----------------------------------------------------------------------------------------------------------------
// destino.js

document.addEventListener('DOMContentLoaded', function() {
    // Aquí se pueden colocar todas las inicializaciones y eventos de los elementos
    const cargaDestinoBtn = document.getElementById('cargaDestinoBtn');
    if (cargaDestinoBtn) {
        cargaDestinoBtn.addEventListener('click', function() {
            const novedadesForm = document.getElementById('novedadesForm');
            const novedadesRangoForm = document.getElementById('novedadesRangoForm');
            const formDestino = document.getElementById('formDestino');
            const contenedorAgentesServicios = document.getElementById('contenedorAgentesServicios');
            const tablaContainer = document.getElementById('tablaContainer');

            if (novedadesForm) novedadesForm.style.display = 'none';
            if (novedadesRangoForm) novedadesRangoForm.style.display = 'none';
            if (formDestino) formDestino.style.display = 'block';
            if (contenedorAgentesServicios) contenedorAgentesServicios.style.display = 'block';
            if (tablaContainer) tablaContainer.style.display = 'none';
        });
    } else {
        console.error("El botón de Cargar Destino no se encontró en el DOM.");
    }
});

//-------------------------------------------------------------------------------------------------------------

//------------------------------------------------------------------------------------------------------------

