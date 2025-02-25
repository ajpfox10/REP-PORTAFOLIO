document.addEventListener("DOMContentLoaded", function () {
    var headerPath = "./PLANTILLAS/encabezado.html";
    var headerContainer = document.getElementById("encabezado-container");

    fetch(headerPath)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error al cargar el encabezado: ${response.statusText}`);
            }
            return response.text();
        })
        .then(data => {
            headerContainer.innerHTML = data;
        })
        .catch(error => {
            console.error('Hubo un problema con la carga del encabezado:', error);
        });
});
