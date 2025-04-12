# 🚀 Despliegue de la API RRHH con PM2 (modo local o producción)

Este documento guía el proceso para ejecutar tu aplicación NestJS en una red cerrada (local) o preparar para producción abierta a internet.

---

## ✅ Requisitos

- Node.js (>= 18)
- npm
- NestJS ya buildado (`npm run build`)
- PM2 instalado globalmente

```bash
npm install -g pm2
```

---

## 📁 Archivo de configuración PM2

Crear un archivo llamado `ecosystem.config.js` en la raíz del proyecto:

```js
module.exports = {
  apps: [
    {
      name: 'rrhh-api',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
```

---

## 🧱 Construcción del proyecto

```bash
npm run build
```

Esto genera el contenido en la carpeta `/dist`.

---

## 🟢 Iniciar la API con PM2

**Modo desarrollo:**
```bash
pm2 start ecosystem.config.js --env development
```

**Modo producción:**
```bash
pm2 start ecosystem.config.js --env production
```

---

## 🔁 Comandos útiles de PM2

| Acción                  | Comando                            |
|------------------------|------------------------------------|
| Ver apps corriendo     | `pm2 list`                         |
| Ver logs               | `pm2 logs`                         |
| Ver logs de tu app     | `pm2 logs rrhh-api`                |
| Detener app            | `pm2 stop rrhh-api`                |
| Reiniciar app          | `pm2 restart rrhh-api`             |
| Eliminar app de PM2    | `pm2 delete rrhh-api`              |
| Guardar procesos       | `pm2 save`                         |
| Iniciar en arranque    | `pm2 startup` (seguir instrucciones) |

---

## 🌐 Preparado para internet

Cuando decidas abrir tu red:

1. Añadir proxy inverso (Nginx o Traefik)
2. Redirigir el dominio a tu IP pública
3. Instalar certificado SSL con Let's Encrypt
4. Abrir el puerto 80/443 (firewall)

---

## 🔐 Seguridad

Tu app está protegida con:
- JWT + Refresh Tokens
- Validaciones estrictas DTO
- CORS + Helmet + Rate limit + IP Filter
- Swagger solo en desarrollo
- Sentry y Logger activo

---

Listo ✅ Ahora tu API se ejecuta segura, reiniciable, escalable y profesional.

