document.addEventListener("DOMContentLoaded", function () {
    const menuPath = "./PLANTILLAS/menu_lateral.html";
    const menuContainer = document.getElementById("menu-lateral-container-menu-lateral");
    const tab = document.getElementById("menu-tab-menu-lateral");
    let hideMenuTimeout;
    let hideTabTimeout;

    // Verificar que el contenedor del menú lateral y la pestaña existan
    if (menuContainer && tab) {
        // Asegurar que la pestaña esté visible al cargar la página
        tab.style.display = 'block';

        // Cargar el menú lateral desde un archivo HTML
        fetch(menuPath)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Error al cargar el menú lateral: ${response.statusText}`);
                }
                return response.text();
            })
            .then(data => {
                menuContainer.innerHTML = data;
                agregarEventosPestana(); // Llamar a la función para agregar eventos después de cargar el menú
                inicializarTemporizadores(); // Iniciar los temporizadores para ocultar el menú y la pestaña
            })
            .catch(error => {
                console.error('Hubo un problema con la carga del menú lateral:', error);
            });
    } else {
        console.error('El contenedor del menú lateral o la pestaña no se encontraron en el DOM.');
    }

    function agregarEventosPestana() {
        // Mostrar el menú lateral al pasar el ratón por la pestaña
        tab.addEventListener("mouseenter", function () {
            console.log("Ratón sobre la pestaña. Mostrando menú y pestaña.");
            clearTimeout(hideMenuTimeout);
            clearTimeout(hideTabTimeout);
            mostrarMenuYTab();
        });

        // Ocultar el menú y la pestaña después de que el ratón salga de la pestaña
        tab.addEventListener("mouseleave", function () {
            console.log("Ratón salió de la pestaña. Iniciando temporizadores para ocultar.");
            iniciarTemporizadoresParaOcultar();
        });

        // Mantener el menú visible si el ratón está sobre el menú lateral
        menuContainer.addEventListener("mouseenter", function () {
            console.log("Ratón sobre el menú lateral. Cancelando ocultamiento.");
            clearTimeout(hideMenuTimeout);
            clearTimeout(hideTabTimeout);
        });

        // Iniciar temporizadores para ocultar al salir del menú lateral
        menuContainer.addEventListener("mouseleave", function () {
            console.log("Ratón salió del menú lateral. Iniciando temporizadores para ocultar.");
            iniciarTemporizadoresParaOcultar();
        });
    }

    function mostrarMenuYTab() {
        const menuLateral = document.getElementById("menu-lateral-menu-lateral");
        if (menuLateral) {
            console.log("Mostrando el menú lateral y pestaña.");
            menuLateral.classList.remove("oculto-menu-lateral");
            tab.classList.remove("reducido-menu-lateral");
        }
    }

    function ocultarMenu() {
        const menuLateral = document.getElementById("menu-lateral-menu-lateral");
        if (menuLateral) {
            console.log("Ocultando el menú lateral.");
            menuLateral.classList.add("oculto-menu-lateral");
        }
    }

    function reducirPestana() {
        console.log("Reduciendo la pestaña.");
        tab.classList.add("reducido-menu-lateral");
    }

    function inicializarTemporizadores() {
        // Iniciar los temporizadores para la primera carga
        console.log("Configurando temporizadores iniciales para ocultar el menú y la pestaña.");
        hideMenuTimeout = setTimeout(ocultarMenu, 10000); // 10 segundos para ocultar el menú inicialmente
        hideTabTimeout = setTimeout(reducirPestana, 12000); // 12 segundos para reducir la pestaña (2 segundos después de ocultar el menú)
    }

    function iniciarTemporizadoresParaOcultar() {
        // Reiniciar los temporizadores para ocultar el menú y reducir la pestaña
        console.log("Iniciando temporizadores para ocultar el menú y reducir la pestaña después de la interacción.");
        clearTimeout(hideMenuTimeout);
        clearTimeout(hideTabTimeout);
        hideMenuTimeout = setTimeout(ocultarMenu, 8000); // 8 segundos para ocultar el menú después de la interacción
        hideTabTimeout = setTimeout(reducirPestana, 10000); // 10 segundos para reducir la pestaña (2 segundos después de ocultar el menú)
    }
});

