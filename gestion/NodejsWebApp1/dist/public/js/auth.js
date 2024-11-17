"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
const sweetalert2_1 = __importDefault(require("sweetalert2"));
// Manejar el registro
(_a = document.getElementById('register-form')) === null || _a === void 0 ? void 0 : _a.addEventListener('submit', function (event) {
    event.preventDefault();
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    // Verifica que los inputs no sean null
    if (usernameInput && passwordInput) {
        const username = usernameInput.value;
        const password = passwordInput.value;
        fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        })
            .then(response => response.json())
            .then(data => {
            if (data.showAlert) {
                sweetalert2_1.default.fire({
                    title: data.title,
                    text: data.text,
                    icon: data.icon,
                    confirmButtonText: 'Aceptar'
                });
            }
        })
            .catch(error => console.error('Error:', error));
    }
});
// Manejar el login
(_b = document.getElementById('login-form')) === null || _b === void 0 ? void 0 : _b.addEventListener('submit', function (event) {
    event.preventDefault();
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    // Verifica que los inputs no sean null
    if (usernameInput && passwordInput) {
        const username = usernameInput.value;
        const password = passwordInput.value;
        fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        })
            .then(response => response.json())
            .then(data => {
            if (data.showAlert) {
                sweetalert2_1.default.fire({
                    title: data.title,
                    text: data.text,
                    icon: data.icon,
                    confirmButtonText: 'Aceptar'
                });
            }
            if (data.token) {
                // Guardar el token y redirigir a la p�gina de gesti�n
                localStorage.setItem('token', data.token);
                window.location.href = '/dashboard';
            }
        })
            .catch(error => console.error('Error:', error));
    }
});
