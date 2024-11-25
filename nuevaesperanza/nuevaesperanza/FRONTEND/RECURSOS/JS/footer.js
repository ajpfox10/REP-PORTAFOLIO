document.addEventListener("DOMContentLoaded", function () {
    // Define la ruta al archivo footer.html
    var footerPath = './PLANTILLAS/footer.html';

    // Selecciona el contenedor donde se cargará el footer
    var footerContainer = document.getElementById("footer-container");

    // Usa fetch para cargar el contenido del footer
    fetch(footerPath)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Error al cargar el footer: ${response.statusText}`);
            }
            return response.text();
        })
        .then(data => {
            footerContainer.innerHTML = data;
        })
        .catch(error => {
            console.error('Hubo un problema con la carga del footer:', error);
        });
});
