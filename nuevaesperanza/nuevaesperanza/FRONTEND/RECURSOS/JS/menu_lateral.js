document.addEventListener("DOMContentLoaded", function () {
    const menuPath = "/PLANTILLAS/menu_lateral.html";
    const menuContainer = document.getElementById("menu-lateral-container-menu-lateral");
    const tab = document.getElementById("menu-tab-menu-lateral");
    let hideMenuTimeout;
    let hideTabTimeout;

    // Verificar que el contenedor del men� lateral y la pesta�a existan
    if (menuContainer && tab) {
        // Asegurar que la pesta�a est� visible al cargar la p�gina
        tab.style.display = 'block';

        // Cargar el men� lateral desde un archivo HTML
        fetch(menuPath)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Error al cargar el men� lateral: ${response.statusText}`);
                }
                return response.text();
            })
            .then(data => {
                menuContainer.innerHTML = data;
                agregarEventosPestana(); // Llamar a la funci�n para agregar eventos despu�s de cargar el men�
                inicializarTemporizadores(); // Iniciar los temporizadores para ocultar el men� y la pesta�a
            })
            .catch(error => {
                console.error('Hubo un problema con la carga del men� lateral:', error);
            });
    } else {
        console.error('El contenedor del men� lateral o la pesta�a no se encontraron en el DOM.');
    }

    function agregarEventosPestana() {
        // Mostrar el men� lateral al pasar el rat�n por la pesta�a
        tab.addEventListener("mouseenter", function () {
            console.log("Rat�n sobre la pesta�a. Mostrando men� y pesta�a.");
            clearTimeout(hideMenuTimeout);
            clearTimeout(hideTabTimeout);
            mostrarMenuYTab();
        });

        // Ocultar el men� y la pesta�a despu�s de que el rat�n salga de la pesta�a
        tab.addEventListener("mouseleave", function () {
            console.log("Rat�n sali� de la pesta�a. Iniciando temporizadores para ocultar.");
            iniciarTemporizadoresParaOcultar();
        });

        // Mantener el men� visible si el rat�n est� sobre el men� lateral
        menuContainer.addEventListener("mouseenter", function () {
            console.log("Rat�n sobre el men� lateral. Cancelando ocultamiento.");
            clearTimeout(hideMenuTimeout);
            clearTimeout(hideTabTimeout);
        });

        // Iniciar temporizadores para ocultar al salir del men� lateral
        menuContainer.addEventListener("mouseleave", function () {
            console.log("Rat�n sali� del men� lateral. Iniciando temporizadores para ocultar.");
            iniciarTemporizadoresParaOcultar();
        });
    }

    function mostrarMenuYTab() {
        const menuLateral = document.getElementById("menu-lateral-menu-lateral");
        if (menuLateral) {
            console.log("Mostrando el men� lateral y pesta�a.");
            menuLateral.classList.remove("oculto-menu-lateral");
            tab.classList.remove("reducido-menu-lateral");
        }
    }

    function ocultarMenu() {
        const menuLateral = document.getElementById("menu-lateral-menu-lateral");
        if (menuLateral) {
            console.log("Ocultando el men� lateral.");
            menuLateral.classList.add("oculto-menu-lateral");
        }
    }

    function reducirPestana() {
        console.log("Reduciendo la pesta�a.");
        tab.classList.add("reducido-menu-lateral");
    }

    function inicializarTemporizadores() {
        // Iniciar los temporizadores para la primera carga
        console.log("Configurando temporizadores iniciales para ocultar el men� y la pesta�a.");
        hideMenuTimeout = setTimeout(ocultarMenu, 10000); // 10 segundos para ocultar el men� inicialmente
        hideTabTimeout = setTimeout(reducirPestana, 12000); // 12 segundos para reducir la pesta�a (2 segundos despu�s de ocultar el men�)
    }

    function iniciarTemporizadoresParaOcultar() {
        // Reiniciar los temporizadores para ocultar el men� y reducir la pesta�a
        console.log("Iniciando temporizadores para ocultar el men� y reducir la pesta�a despu�s de la interacci�n.");
        clearTimeout(hideMenuTimeout);
        clearTimeout(hideTabTimeout);
        hideMenuTimeout = setTimeout(ocultarMenu, 8000); // 8 segundos para ocultar el men� despu�s de la interacci�n
        hideTabTimeout = setTimeout(reducirPestana, 10000); // 10 segundos para reducir la pesta�a (2 segundos despu�s de ocultar el men�)
    }
});

