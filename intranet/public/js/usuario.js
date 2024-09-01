//----------------------------------------------------------------------------------------------------------------
// Botón para cargar novedades (muestra la tabla)
document.getElementById('cargaNovedadesBtn').addEventListener('click', function() {
    document.getElementById('novedadesForm').style.display = 'block';
    document.getElementById('novedadesRangoForm').style.display = 'none';
    document.getElementById('formDestino').style.display = 'none';
    document.getElementById('contenedorAgentesServicios').style.display = 'none'; // Asegúra de ocultar la tabla de agentes servicios
    document.getElementById('tablaContainer').style.display = 'block'; // Mostrar la tabla
    loadAgentes();
    loadTiposDeNovedad();
    setMaxFecha(); 
});
//----------------------------------------------------------------------------------------------------------------
// Botón para cargar novedades por rango (muestra la tabla)
document.getElementById('cargaNovedadesRangoBtn').addEventListener('click', function() {
    document.getElementById('novedadesForm').style.display = 'none';
    document.getElementById('formDestino').style.display = 'none';
    document.getElementById('contenedorAgentesServicios').style.display = 'none'; // Asegúra de ocultar la tabla de agentes servicios
    document.getElementById('novedadesRangoForm').style.display = 'block';
    document.getElementById('tablaContainer').style.display = 'block'; // Mostrar la tabla
    loadAgentesRango();
    loadTiposDeNovedadRango();
    setMaxFechaRango();    
});
//----------------------------------------------------------------------------------------------------------------
// Botón para cargar el formulario de destino (muestra el formulario de destino y oculta los demás)
document.getElementById('cargaDestinoBtn').addEventListener('click', function() {
    console.log("Cargar Destino activado");
    document.getElementById('novedadesForm').style.display = 'none';
    document.getElementById('novedadesRangoForm').style.display = 'none';
    document.getElementById('formDestino').style.display = 'block';
    document.getElementById('contenedorAgentesServicios').style.display = 'block';
    document.getElementById('tablaContainer').style.display = 'none';

    const tablaAgentesServicios = document.getElementById('tablaAgentesServicios');
    if (tablaAgentesServicios) {
        tablaAgentesServicios.style.display = 'table'; // Asegúra de mostrar la tabla
    }

    try {
        cargarAgentesAsignables(); // Usa la nueva función para cargar agentes asignables
        loadServicios();
        setMinFechaDestino();
        loadTiposCuidado();
        loadAgentesServicios(); // Cargar datos en la tabla de agentes y servicios
    } catch (error) {
        console.error('Error al cargar los datos para el destino:', error);
    }
});

//----------------------------------------------------------------------------------------------------------------
document.getElementById('formNovedadesRango').addEventListener('submit', async function(e) {
    e.preventDefault();
    const agente = document.getElementById('agenteRango').value;
    const apellido = document.getElementById('agenteRango').options[document.getElementById('agenteRango').selectedIndex].text; // Captura Apellido y Nombre
    const tipoNovedad = document.getElementById('tipoNovedadRango').options[document.getElementById('tipoNovedad').selectedIndex].text;
    const fechaDesde = document.getElementById('fechaDesde').value;
    const fechaHasta = document.getElementById('fechaHasta').value;
    const observaciones = document.getElementById('observacionesRango').value;
    const response = await fetch('/cargar-novedades-rango', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agente, apellido, tipoNovedad, fechaDesde, fechaHasta, observaciones })
    });
    const result = await response.json();
    if (response.ok) {
        Swal.fire('Éxito', result.message, 'success');
        document.getElementById('formNovedadesRango').reset();
        setMaxFecha();  // Llama a esta función si quieres restablecer la fecha a los límites definidos
        loadNovedadesCargadas();
    } else {
        Swal.fire('Error', result.message, 'error');
    }
});
//---------------------------------------------------------------------------------------------------------------
function loadAgentesRango() {
    const agenteSelect = document.getElementById('agenteRango');
    loadAgentes().then(() => {
        agenteSelect.innerHTML = document.getElementById('agente').innerHTML;
    });
}
//---------------------------------------------------------------------------------------------------------------
function loadTiposDeNovedadRango() {
    const tipoNovedadSelect = document.getElementById('tipoNovedadRango');
    loadTiposDeNovedad().then(() => {
        tipoNovedadSelect.innerHTML = document.getElementById('tipoNovedad').innerHTML;
    });
}
//----------------------------------------------------------------------------------------------------------------
function setMaxFechaRango() {
    const fechaDesdeInput = document.getElementById('fechaDesde');
    const fechaHastaInput = document.getElementById('fechaHasta');
    const today = new Date();
    const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    fechaDesdeInput.min = firstDayLastMonth.toISOString().split('T')[0];
    fechaHastaInput.max = lastDayLastMonth.toISOString().split('T')[0];
    fechaHastaInput.min = firstDayLastMonth.toISOString().split('T')[0];
    fechaHastaInput.max = lastDayLastMonth.toISOString().split('T')[0];
    fechaDesdeInput.value = firstDayLastMonth.toISOString().split('T')[0];
}
//----------------------------------------------------------------------------------------------------------------
document.getElementById('formDestino').addEventListener('submit', async function(e) {
    e.preventDefault();

    const agente = document.getElementById('agenteAsignable').value; // Captura el DNI
    const agenteNombre = document.getElementById('agenteAsignable').options[document.getElementById('agenteAsignable').selectedIndex].text; // Captura Apellido y Nombre
    const servicio_id = document.getElementById('servicioDestino').options[document.getElementById('servicioDestino').selectedIndex].text;
    const tipoCuidado = document.getElementById('tipoCuidado').options[document.getElementById('tipoCuidado').selectedIndex].text;
    const fecha_desde = document.getElementById('fechaDestino').value;

    console.log("Agente capturado:", agenteNombre);

    // Realizar la solicitud POST al servidor para insertar datos
    const response = await fetch('/insert-agente-servicio', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agente, agenteNombre, servicio_id, tipoCuidado, fecha_desde })
    });


    const result = await response.json();
    if (response.ok) {
        Swal.fire('Éxito', result.message, 'success');     
        document.getElementById('formDestinoForm').reset(); // Restablecer el formulario después de la inserción
        loadAgentesServicios(); // Actualizar la lista de agentes y servicios cargados   
        cargarAgentesAsignables();
    } else {
        Swal.fire('Error', result.message, 'error');
    }

});

//-------------------------------------------------------------------------------------------------------------------
// Función para cargar agentes en el combobox de agentes
async function loadAgentes() {
    // Suponiendo que tienes una función o una llamada para obtener los agentes
    const response = await fetch('/api/agentes');
    const agentes = await response.json();
    const agenteSelect = document.getElementById('agente');
    agenteSelect.innerHTML = '';

    agentes.forEach(agente => {
        const option = document.createElement('option');
        option.value = agente.DNI; // Usar el DNI como valor del option
        option.textContent = agente['APELLDO Y NOMBRE']; // Mostrar el nombre completo en el combobox
        option.setAttribute('data-ley', agente.LEY); // Almacenar la columna LEY en un atributo data

        agenteSelect.appendChild(option);
    });

    // Añadir listener para cambios en el combobox de agentes
    agenteSelect.addEventListener('change', function () {
        const selectedOption = this.options[this.selectedIndex];
        const ley = selectedOption.getAttribute('data-ley'); // Obtener el valor de LEY
        loadFilteredNovedades(ley);
    });
}
//------------------------------------------------------------------------------------------------------------------------------------------------------------
// Función para cargar novedades filtradas basadas en el valor de LEY del agente seleccionado
async function loadFilteredNovedades(ley) {
    if (!ley) {
        console.error('LEY no definido');
        return;
    }

    try {
        const url = `/api/filtered-novedades?ley=${ley}`;
        console.log(`URL de solicitud: ${url}`); // Verifica la URL generada
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}` // Asegúra de que el token JWT esté presente
            }
        });

        if (!response.ok) {
            console.error('Error al obtener novedades:', response.statusText);
            return;
        }

        const novedades = await response.json();
        const tipoNovedadSelect = document.getElementById('tipoNovedad');
        tipoNovedadSelect.innerHTML = ''; // Limpiar las opciones existentes

        novedades.forEach(novedad => {
            const option = document.createElement('option');
            option.value = novedad.id;
            option.textContent = novedad.nombre;

            tipoNovedadSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar novedades:', error);
    }
}


//-------------------------------------------------------------------------------------------------------------------
async function loadTiposDeNovedad() {
    const response = await fetch('/get-tipos-novedad');
    const tiposNovedad = await response.json();
    const tipoNovedadSelect = document.getElementById('tipoNovedad');
    tipoNovedadSelect.innerHTML = '';
    tiposNovedad.forEach(tipo => {
        const option = document.createElement('option');
        option.value = tipo.id;
        option.textContent = tipo.nombre;
        tipoNovedadSelect.appendChild(option);
    });
}
//---------------------------------------------------------------------------------------------------------------------
async function loadNovedadesCargadas() {
    const response = await fetch('/get-novedades-cargadas');
    const novedades = await response.json();
    const tbody = document.querySelector('#tablaNovedades tbody');
    tbody.innerHTML = '';
    novedades.forEach(novedad => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${novedad.agente}</td>
            <td>${novedad.apellido}</td> <!-- Muestra el apellido -->
            <td>${novedad.tipoNovedad}</td>
            <td>${novedad.fecha}</td>
            <td>${novedad.observaciones || ''}</td>
            <td><button onclick="eliminarNovedad('${novedad.id}')">Eliminar</button></td>
        `;
        tbody.appendChild(row);
    });
}
//-----------------------------------------------------------------------------------------------------------------------
async function eliminarNovedad(id) {
     const response = await fetch('/eliminar-novedad', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id })
    });
    const result = await response.json();
    if (response.ok) {
        Swal.fire('Éxito', result.message, 'success');
        loadNovedadesCargadas();
    } else {
        Swal.fire('Error', result.message, 'error');
    }
}
//------------------------------------------------------------------------------------------------------------------------
document.getElementById('exportPdf').addEventListener('click', function () {
    const { jsPDF } = window.jspdf;
    
    // Usar 'let' para permitir la reasignación
    let orientation = 'portrait'; // Orientación predeterminada
    let format = 'a4'; // Formato predeterminado

    // Calcular el ancho total de las columnas
    const columnWidths = [50, 60, 50, 30, 70];
    const totalColumnWidth = columnWidths.reduce((a, b) => a + b, 0);

    // Evaluar si el contenido necesita orientación horizontal o un formato más grande
    if (totalColumnWidth > 210) { // Si es mayor que el ancho de A4 en portrait
        orientation = 'landscape';
        format = 'a4';
        if (totalColumnWidth > 297) { // Si es mayor que el ancho de A4 en landscape
            format = 'legal';
        }
    }

    let doc = new jsPDF(orientation, 'mm', format); // Crear un nuevo documento jsPDF con orientación y tamaño
    const totalPagesExp = "{total_pages_count_string}";

    // Añadir título y fecha
    doc.setFontSize(18);
    doc.text('Reporte de Novedades Cargadas', 14, 22);
    const fechaActual = new Date().toLocaleDateString();
    doc.setFontSize(12);
    doc.text(`Fecha de generación: ${fechaActual}`, 14, 30);

    // Generar la tabla con los datos obtenidos del servidor
    doc.autoTable({
        startY: 40,
        head: [['Agente', 'Apellido', 'Tipo de Novedad', 'Fecha', 'Observaciones']],
        body: Array.from(document.querySelectorAll('#tablaNovedades tbody tr')).map(tr => 
            Array.from(tr.children).map(td => td.innerText)
        ),
        margin: { top: 10, bottom: 30, left: 14, right: 14 },  // Ajuste de márgenes
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 255] },
        styles: { 
            fontSize: 10,
            cellWidth: 'wrap', // Ajustar contenido dentro de la celda permitiendo múltiples líneas
            overflow: 'linebreak' // Permitir salto de línea dentro de las celdas
        },
        columnStyles: {
            0: { cellWidth: 40 },  // Ancho dinámico para la columna de 'Agente'
            1: { cellWidth: 50 },  // Ancho dinámico para la columna de 'Apellido'
            2: { cellWidth: 50 },  // Ancho dinámico para la columna de 'Tipo de Novedad'
            3: { cellWidth: 30 },  // Ancho dinámico para la columna de 'Fecha'
            4: { cellWidth: 60 }   // Ancho dinámico para la columna de 'Observaciones'
        },
        pageBreak: 'auto',  // Habilitar saltos de página automáticos
        didDrawPage: function (data) {
            // Añadir el pie de página en cada página
            let str = "Página " + doc.internal.getCurrentPageInfo().pageNumber;
            if (typeof doc.putTotalPages === 'function') {
                str = str + " de " + totalPagesExp;
            }
            doc.setFontSize(10);
            const pageSize = doc.internal.pageSize;
            const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
            doc.text(str, data.settings.margin.left, pageHeight - 10);
            doc.text('Firma del Jefe Inmediato:', data.settings.margin.left, pageHeight - 20);
            doc.text(`Fecha: ${fechaActual}`, data.settings.margin.left + 140, pageHeight - 10);
        }
    });
    
    if (typeof doc.putTotalPages === 'function') {
        doc.putTotalPages(totalPagesExp);
    }
    
    doc.save('novedades.pdf');
});





//-----------------------------------------------------------------------------------------------------------------------------------------------------
function setDefaultFechaDesde() {
    const fechaDesdeInput = document.getElementById('fechaDesde');
    const today = new Date();
    const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    fechaDesdeInput.value = firstDayLastMonth.toISOString().split('T')[0];
}
//------------------------------------------------------------------------------------------------------------------------------------------------------
function setMaxFecha() {
    const fechaInput = document.getElementById('fecha');
    const today = new Date();
    // Primer día del mes anterior
    const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    // Último día del mes anterior
    const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    // Establece los límites en el campo de fecha
    fechaInput.min = firstDayLastMonth.toISOString().split('T')[0];
    fechaInput.max = lastDayLastMonth.toISOString().split('T')[0];
}
//-------------------------------------------------------------------------------------------------------------------------------------------------------
const agenteSearchNovedades = document.getElementById('search-apellido');
const agenteSearchRango = document.getElementById('search-apellido-rango');
const agenteSearchDestino = document.getElementById('search-agente-destino'); // Nuevo campo de búsqueda

if (agenteSearchNovedades) agenteSearchNovedades.addEventListener('input', filterAgentes);
if (agenteSearchRango) agenteSearchRango.addEventListener('input', filterAgentes);
if (agenteSearchDestino) agenteSearchDestino.addEventListener('input', filterAgentes); // Nuevo evento

function filterAgentes() {
    const filter = this.value.toUpperCase();
    let agenteSelect;
    
    // Determina cuál input está siendo utilizado para seleccionar el select correspondiente
    if (this.id === 'search-apellido') {
        agenteSelect = document.getElementById('agente');
    } else if (this.id === 'search-apellido-rango') {
        agenteSelect = document.getElementById('agenteRango');
    } else if (this.id === 'search-agente-destino') { // Nuevo caso para el campo de búsqueda de destino
        agenteSelect = document.getElementById('agenteDestino');
    }

    const options = agenteSelect.options;
    let found = false;

    for (let i = 0; i < options.length; i++) {
        const txtValue = options[i].textContent || options[i].innerText;
        if (txtValue.toUpperCase().indexOf(filter) > -1) {
            options[i].style.display = "";
            if (!found) {
                agenteSelect.selectedIndex = i;  // Selecciona automáticamente la primera coincidencia
                found = true;
            }
        } else {
            options[i].style.display = "none";
        }
    }

    if (!found) {
        agenteSelect.selectedIndex = -1; // Deselecciona cualquier opción
    }
}



//------------------------------------------------------------------------------------------------------------------------------------------------------------
function loadServicios() {
    fetch('/get-services')
        .then(response => response.json())
        .then(servicios => {
            if (!Array.isArray(servicios)) {
                throw new Error('La respuesta no es un array');
            }
            
            const servicioSelect = document.getElementById('servicioDestino');
            servicioSelect.innerHTML = ''; // Limpiar opciones previas

            servicios.forEach(servicio => {
                const option = document.createElement('option');
                option.value = servicio.id;
                option.textContent = servicio.servicio; // Usar 'servicio' en lugar de 'nombre'
                servicioSelect.appendChild(option);
            });
        })
        .catch(error => console.error('Error al cargar servicios:', error));
}
//--------------------------------------------------------------------------------------------------------------------------------------------------------------
function setMinFechaDestino() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('fechaDestino').setAttribute('min', today);
}
//--------------------------------------------------------------------------------------------------------------------------------------------------------------
function loadTiposCuidado() {
    fetch('/get-tipos-cuidado')
        .then(response => response.json())
        .then(tiposCuidado => {
            const tipoCuidadoSelect = document.getElementById('tipoCuidado');
            tipoCuidadoSelect.innerHTML = ''; // Limpiar opciones previas
            tiposCuidado.forEach(tipo => {
                const option = document.createElement('option');
                option.value = tipo.id; // Guardar el id como valor
                option.textContent = tipo.tipodecuidado; // Mostrar el nombre del tipo de cuidado al usuario
                tipoCuidadoSelect.appendChild(option);
            });
        })
        .catch(error => console.error('Error al cargar tipos de cuidado:', error));
}
//--------------------------------------------------------------------------------------------------------------------------------------------------------------
document.getElementById('formDestino').addEventListener('submit', function(event) {
    event.preventDefault();
    
    const agenteSelect = document.getElementById('agenteAsignable'); // ID corregido
    const fechaInput = document.getElementById('fechaDestino');
    const tipoCuidadoSelect = document.getElementById('tipoCuidado');
    const servicioSelect = document.getElementById('servicioDestino');

    // Verificar que todos los elementos existen
    if (!agenteSelect || !fechaInput || !tipoCuidadoSelect || !servicioSelect) {
        console.error('Uno o más elementos necesarios no se encontraron en el DOM');
        return;
    }

    const agente_id = agenteSelect.value;    
    const fecha_desde = fechaInput.value;    
    const tipoCuidado = tipoCuidadoSelect.selectedOptions[0].text;
    const servicio_id = servicioSelect.selectedOptions[0].text;
    let agente_nombre = agenteSelect.selectedOptions[0].text;

    const datos = {
        agente_id,
        servicio_id,
        fecha_desde,
        tipoCuidado,
        agente_nombre
    };

    console.log('Datos enviados:', datos);

    // Resto del código para manejar la carga de datos...
});

//-------------------------------------------------------------------------------------------------------------------------
// usuario.js o destino.js
async function loadAgentes() {
    const response = await fetch('/get-agentes'); // Ajuste la ruta aquí
    const agentes = await response.json();
    const agenteSelect = document.getElementById('agente');
    agenteSelect.innerHTML = '';

    agentes.forEach(agente => {
        const option = document.createElement('option');
        option.value = agente.DNI;
        option.textContent = agente['APELLDO Y NOMBRE'];
        option.setAttribute('data-ley', agente.LEY);

        agenteSelect.appendChild(option);
    });

    agenteSelect.addEventListener('change', function () {
        const selectedOption = this.options[this.selectedIndex];
        const ley = selectedOption.getAttribute('data-ley');
        loadFilteredNovedades(ley);
    });
}

//------------------------------------------------------------------------------------------------------------------------------------------
async function eliminarAgenteServicio(id) {
    console.log('Intentando eliminar el ID:', id); // Log para verificar
    try {
        const response = await fetch('/eliminar-agente-servicio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id }) // Pasar el ID del agente/servicio a eliminar
        });

        const result = await response.json();
        if (response.ok) {
            Swal.fire('Éxito', 'El agente/servicio ha sido marcado como eliminado', 'success');
            loadAgentesServicios(); // Recargar la tabla para reflejar los cambios
        } else {
            Swal.fire('Error', result.message, 'error');
        }
    } catch (error) {
        console.error('Error al eliminar agente/servicio:', error.message, error.stack);
        Swal.fire('Error', 'Ocurrió un error al intentar eliminar el agente/servicio', 'error');
    }
}
//-------------------------------------------------------------------------------------------------------------------------------------------
async function cambiarServicio(id) {
    // Obtener todas las opciones del combobox de servicios y tipo de cuidado
    const servicioOptions = Array.from(document.querySelectorAll('#servicioDestino option'))
        .map(option => `<option value="${option.textContent}">${option.textContent}</option>`)
        .join('');
    
    const tipoCuidadoOptions = Array.from(document.querySelectorAll('#tipoCuidado option'))
        .map(option => `<option value="${option.textContent}">${option.textContent}</option>`)
        .join('');

    // Obtener la fecha actual y la última fecha del año en curso
    const today = new Date();
    const minDate = today.toISOString().split('T')[0];
    const endOfYear = new Date(today.getFullYear(), 11, 31);
    const maxDate = endOfYear.toISOString().split('T')[0];

    const { value: formValues, isConfirmed } = await Swal.fire({
        title: 'Cambiar Servicio y Tipo de Cuidado',
        html: `
            <select id="nuevoServicio" class="swal2-select">
                <option value="" disabled selected>Seleccione un servicio</option>
                ${servicioOptions} <!-- Cargar opciones de servicios con texto visible -->
            </select>
            <select id="nuevoTipoCuidado" class="swal2-select">
                <option value="" disabled selected>Seleccione tipo de cuidado</option>
                ${tipoCuidadoOptions} <!-- Cargar opciones de tipo de cuidado con texto visible -->
            </select>
            <input type="date" id="modificatore" class="swal2-input" min="${minDate}" max="${maxDate}">
        `,
        focusConfirm: false,
        showCancelButton: true, // Agrega un botón de cancelar
        cancelButtonText: 'Cancelar', // Texto del botón de cancelar
        confirmButtonText: 'Guardar cambios', // Texto del botón de confirmación
        preConfirm: () => {
            const nuevoServicio = document.getElementById('nuevoServicio').value;
            const nuevoTipoCuidado = document.getElementById('nuevoTipoCuidado').value;
            const modificatore = document.getElementById('modificatore').value;

            // Validar que todos los campos estén completos
            if (!nuevoServicio || !nuevoTipoCuidado || !modificatore) {
                Swal.showValidationMessage('Por favor, completa todos los campos.');
                return false; // Evita que se cierre el modal si no están completos
            }

            return { nuevoServicio, nuevoTipoCuidado, modificatore };
        }
    });

    // Verificar si el usuario confirmó o canceló
    if (isConfirmed && formValues) {
        const { nuevoServicio, nuevoTipoCuidado, modificatore } = formValues;

        // Log para depuración
        console.log('ID:', id);
        console.log('Nuevo Servicio:', nuevoServicio);
        console.log('Nuevo Tipo de Cuidado:', nuevoTipoCuidado);
        console.log('Fecha Modificatore:', modificatore);

        if (!id || !nuevoServicio || !nuevoTipoCuidado || !modificatore) {
            Swal.fire('Error', 'Todos los campos son obligatorios', 'error');
            return;
        }

        try {
            const response = await fetch('/cambiar-servicio', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id, nuevoServicio, nuevoTipoCuidado, modificatore })
            });

            const result = await response.json();
            if (response.ok) {
                Swal.fire('Éxito', 'El servicio y tipo de cuidado han sido cambiados con éxito', 'success');
                loadAgentesServicios(); // Recargar la tabla para reflejar los cambios
            } else {
                Swal.fire('Error', result.message, 'error');
            }
        } catch (error) {
            console.error('Error al cambiar el servicio:', error.message, error.stack);
            Swal.fire('Error', 'Ocurrió un error al intentar cambiar el servicio', 'error');
        }
    }
}
//--------------------------------------------------------------------------------------------------------------------
//reporte-pdf
document.getElementById('generarPDF').addEventListener('click', () => {
    console.log('Botón de generación de PDF clicado');
    
    // Solicitar el PDF desde el servidor
    fetch('/reporte-pdf', {  // Asegúrate de que esta ruta devuelve un PDF
        method: 'GET',
        headers: {
            'Accept': 'application/pdf',  // Aceptar contenido PDF
        },
    })
    .then(response => {
        // Verificar si la respuesta es OK
        if (!response.ok) {
            throw new Error('Error en la respuesta del servidor al generar el PDF.');
        }
        return response.blob();  // Convertir la respuesta en un Blob para manejar el archivo PDF
    })
    .then(blob => {
        const url = window.URL.createObjectURL(blob);  // Crear una URL para el Blob
        const a = document.createElement('a');  // Crear un elemento <a> para la descarga
        a.style.display = 'none';
        a.href = url;
        a.download = 'reporte_agentes_servicio.pdf';  // Nombre del archivo de descarga
        document.body.appendChild(a);
        a.click();  // Simular un clic para descargar el archivo
        window.URL.revokeObjectURL(url);  // Liberar la URL creada
    })
    .catch(error => console.error('Error al generar el PDF:', error));
});
//-------------------------------------------------------------------------------------------------------------------------------------------------------------
function filterTableNovedades() {
    const filter = document.getElementById('filterInputNovedades').value.toUpperCase();
    const filterField = parseInt(document.getElementById('filterField').value); // Cambiar a filterField
    const rows = document.querySelectorAll('#tablaNovedades tbody tr');
    
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (filterField >= 0 && filterField < cells.length) {
            const cellText = cells[filterField].innerText.toUpperCase();
            const match = cellText.includes(filter);
            row.style.display = match ? '' : 'none';
        } else {
            row.style.display = 'none'; // Ocultar si la columna no es válida
        }
    });
}

function filterTableServicios() {
    const filter = document.getElementById('filterInputServicios').value.toUpperCase();
    const filterField = parseInt(document.getElementById('filterFieldServicios').value); // Obtener el índice de la columna seleccionada
    const rows = document.querySelectorAll('#tablaAgentesServicios tbody tr');

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');

        // Verificar si el índice de filtro es válido y considerar la columna oculta (3)
        if (filterField >= 0 && filterField < cells.length) {
            const cellText = cells[filterField].innerText.toUpperCase();
            const match = cellText.includes(filter);
            row.style.display = match ? '' : 'none';
        } else {
            row.style.display = ''; // Mostrar todas las filas si no hay filtro válido
        }
    });
}
//-------------------------------------------------------------------------------------------------------------------------------------------------------------
document.getElementById('filterInputNovedades').addEventListener('input', filterTableNovedades);
document.getElementById('filterInputServicios').addEventListener('input', filterTableServicios);

document.getElementById('logoutButton').addEventListener('click', async () => {
    try {
        const response = await fetch('/logout', {
            method: 'POST',
            credentials: 'include' // Esto envía las cookies con la solicitud
        });

        if (response.ok) {
            window.location.href = '/login'; // Redirigir a la página de login
        } else {
            console.error('Failed to logout');
        }
    } catch (error) {
        console.error('Error during logout:', error);
    }
});
//-------------------------------------------------------------------------------------------------------------------------------------------------------------
async function loadFilteredNovedades(ley) {
    if (!ley) {
        console.error('LEY no definido');
        return;
    }

    const url = `/api/filtered-novedades?ley=${ley}`;
    console.log(`URL de solicitud: ${url}`); // Verifica que `ley` se esté incluyendo correctamente

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}` // Asegúrate de que el token JWT esté presente
            }
        });

        if (!response.ok) {
            console.error('Error al obtener novedades:', response.statusText);
            return;
        }

        const novedades = await response.json();
        const tipoNovedadSelect = document.getElementById('tipoNovedad');
        tipoNovedadSelect.innerHTML = ''; // Limpiar las opciones existentes

        novedades.forEach(novedad => {
            const option = document.createElement('option');
            option.value = novedad.id;
            option.textContent = novedad.nombre;

            tipoNovedadSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar novedades:', error);
    }
}

//---------------------------------------------------------------------------------------------------------------------------------------------------------------
document.getElementById('agente').addEventListener('change', function () {
    const selectedOption = this.options[this.selectedIndex];
    const ley = selectedOption.getAttribute('data-ley'); // Asegúrate de que 'ley' se obtenga correctamente
    console.log(`LEY seleccionado: ${ley}`); // Registro para depuración
    loadFilteredNovedades(ley); // Pasa el valor de LEY a la función de filtrado
});
//---------------------------------------------------------------------------------------------------------------------------------------------------------------
// usuario.js o destino.js

async function loadAgentesServicios() {
    try {
        const response = await fetch('/get-agentes-servicios');
        if (!response.ok) {
            throw new Error('Error en la respuesta del servidor');
        }
        const agentesServicios = await response.json();
        console.log(agentesServicios); // Añadir este log para verificar los datos

        const tbody = document.querySelector('#tablaAgentesServicios tbody');
        tbody.innerHTML = ''; // Limpiar contenido anterior

        agentesServicios.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.id}</td>
                <td>${item.agente_id}</td>
                <td>${item.agente_nombre || ''}</td>
                <td>${item.servicio_id || ''}</td> <!-- Debería mostrar "clínica" -->
                <!-- <td>${item.servicio || ''}</td> <!-- Esta línea es para el campo de "servicio" que se desea ocultar -->
                <td>${item.tipoCuidado || ''}</td>
                <td>${item.fecha_desde}</td>       
                
                <td>
                    <button onclick="eliminarAgenteServicio(${item.id})">Eliminar</button>
                    <button onclick="cambiarServicio(${item.id})">Cambiar Servicio</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error al cargar datos de agentes_servicios:', error);
    }
}

// Llamar a la función para cargar los datos al cargar la página
document.addEventListener('DOMContentLoaded', loadAgentesServicios);
//-----------------------------------------------------------------------------------------------------------------------------------
async function cargarAgentesAsignables() {
    try {
        const response = await fetch('/cargar-agentes-asignables');
        if (!response.ok) {
            console.error('Error en la respuesta del servidor al cargar agentes asignables:', response.statusText);
            throw new Error('Error al cargar agentes asignables');
        }

        const agentes = await response.json();
        console.log('Agentes asignables cargados:', agentes); // Log para depuración
        const agenteSelect = document.getElementById('agenteAsignable'); // Asumiendo que este es el combobox específico
        agenteSelect.innerHTML = '';

        agentes.forEach(agente => {
            const option = document.createElement('option');
            option.value = agente.DNI; // Usar el DNI del agente como valor del option
            option.textContent = agente['APELLDO Y NOMBRE']; // Mostrar el nombre completo en el combobox
            agenteSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar los agentes asignables:', error);
    }
}

// Llamar a la función al cargar la página o en un evento específico
document.getElementById('cargaDestinoBtn').addEventListener('click', cargarAgentesAsignables);
//-----------------------------------------------------------------------------------------------------------------------------------
// Asegúrate de que el ID del formulario coincida con 'formNovedades' en tu HTML
document.getElementById('formNovedades').addEventListener('submit', async function(e) {
    e.preventDefault();

    // Captura los datos del formulario utilizando los IDs correctos
    const agente = document.getElementById('agente').value;
    const apellido = document.getElementById('agente').options[document.getElementById('agente').selectedIndex].text;
    const tipoNovedad = document.getElementById('tipoNovedad').options[document.getElementById('tipoNovedad').selectedIndex].text;
    const fecha = document.getElementById('fecha').value;  // Cambiado a 'fecha'
    const observaciones = document.getElementById('observaciones').value;

    // Enviar los datos al servidor
    try {
        const response = await fetch('/cargar-novedad', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ agente, apellido, tipoNovedad, fecha, observaciones })
        });

        const result = await response.json();
        if (response.ok) {
            Swal.fire('Éxito', result.message, 'success');
            // Resetear el formulario y actualizar la tabla de novedades
            document.getElementById('formNovedades').reset();
            loadNovedadesCargadas(); // Asume que esta función actualiza la tabla
        } else {
            Swal.fire('Error', result.message, 'error');
        }
    } catch (error) {
        Swal.fire('Error', 'Ocurrió un error al enviar la novedad. Intenta de nuevo.', 'error');
    }
});















loadNovedadesCargadas();
loadAgentes();
loadTiposDeNovedad();
setMaxFecha();

