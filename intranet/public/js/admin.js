// public/js/admin.js

document.getElementById('alta-baja-btn').addEventListener('click', function() {
    const userForm = document.getElementById('user-form');
    const userTable = document.getElementById('user-table');
    userForm.classList.toggle('hidden');
    userTable.classList.toggle('hidden');
});

document.getElementById('userForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const rol = document.getElementById('rol').value;
    const servicio = document.getElementById('servicio').value;
    const nivel = document.getElementById('nivel').value;

    if (!validatePassword(password)) {
        showMessage('error', 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un símbolo.');
        return;
    }

    const response = await fetch('/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password, rol, servicio, nivel })
    });

    const result = await response.json();
    if (response.ok) {
        showMessage('success', result.message);
        document.getElementById('userForm').reset();
        loadUsers();
    } else {
        showMessage('error', result.message);
    }
});

function validatePassword(password) {
    const re = /^(?=.*[A-Z])(?=.*\W).{8,}$/;
    return re.test(password);
}

async function loadUsers() {
    const tbody = document.querySelector('#user-table tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Cargando datos...</td></tr>';

    const response = await fetch('/get-users');
    const users = await response.json();

    tbody.innerHTML = '';

    users.forEach(user => {
        const row = document.createElement('tr');

        const altaBajaButton = user.activo 
            ? `<button class="deactivate" onclick="toggleUserStatus('${user.username}', false)">Dar de baja</button>`
            : `<button class="activate" onclick="toggleUserStatus('${user.username}', true)">Dar de alta</button>`;

        row.innerHTML = `
            <td>${user.username}</td>
            <td>${user.rol}</td>
            <td>${user.servicio}</td>
            <td>${user.nivel}</td>
            <td>${user.activo ? 'Sí' : 'No'}</td>
            <td>
                ${altaBajaButton}
                <button class="change-role" onclick="changeRole('${user.username}', '${user.rol}')">Cambiar Rol</button>
                <button class="change-level" onclick="changeLevel('${user.username}', '${user.nivel}')">Cambiar Nivel</button>
                <button class="change-service" onclick="changeService('${user.username}', '${user.servicio}')">Cambiar Servicio</button>
            </td>
        `;

        tbody.appendChild(row);
    });
}

async function toggleUserStatus(username, activate) {
    const url = activate ? '/activate' : '/deactivate';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username })
    });

    const result = await response.json();
    if (response.ok) {
        showMessage('success', result.message);
        loadUsers();
    } else {
        showMessage('error', result.message);
    }
}

async function changeRole(username, currentRole) {
    const newRole = prompt('Ingrese el nuevo rol (admin/usuario):', currentRole);
    if (newRole && newRole !== currentRole) {
        const response = await fetch('/change-role', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, newRole })
        });

        const result = await response.json();
        if (response.ok) {
            showMessage('success', result.message);
            loadUsers();
        } else {
            showMessage('error', result.message);
        }
    }
}

async function changeLevel(username, currentLevel) {
    const newLevel = prompt('Ingrese el nuevo nivel:', currentLevel);
    if (newLevel && newLevel !== currentLevel) {
        const response = await fetch('/change-level', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, newLevel })
        });

        const result = await response.json();
        if (response.ok) {
            showMessage('success', result.message);
            loadUsers();
        } else {
            showMessage('error', result.message);
        }
    }
}

async function changeService(username, currentService) {
    const response = await fetch('/get-services');
    const services = await response.json();
    const newService = prompt(`Ingrese el nuevo servicio (${services.join('/')})`, currentService);

    if (newService && newService !== currentService) {
        const response = await fetch('/change-service', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, newService })
        });

        const result = await response.json();
        if (response.ok) {
            showMessage('success', result.message);
            loadUsers();
        } else {
            showMessage('error', result.message);
        }
    }
}

async function loadServices() {
    const response = await fetch('/get-services');
    const services = await response.json();

    const serviceSelect = document.getElementById('servicio');
    serviceSelect.innerHTML = '';

    services.forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service;
        serviceSelect.appendChild(option);
    });
}

function showMessage(type, message) {
    const messageBox = document.createElement('div');
    messageBox.className = `message-box ${type}`;
    messageBox.innerText = message;
    document.body.appendChild(messageBox);

    setTimeout(() => {
        document.body.removeChild(messageBox);
    }, 3000);  // El mensaje desaparece después de 3 segundos
}

// Llamadas iniciales
loadUsers();
loadServices();
