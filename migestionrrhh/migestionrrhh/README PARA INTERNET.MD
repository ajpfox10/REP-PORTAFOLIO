# 🌐 Configuración de Nginx para exponer la API de RRHH con HTTPS

Este archivo contiene la configuración de Nginx para que puedas exponer tu API al exterior de forma segura, con soporte para HTTPS mediante Let's Encrypt. Aun si no lo usás ahora, quedará listo para más adelante.

---

## ✅ Requisitos previos

- Tener un dominio real (ej: `api.tuservidor.com`) apuntando a tu IP pública.
- Tener Nginx instalado en tu servidor (Linux, VPS, etc.)
- Tener Certbot (Let's Encrypt) instalado para generar los certificados SSL
- La API debe estar corriendo con PM2 en el puerto 4000

---

## 📄 Archivo de configuración Nginx para la API

Ruta recomendada: `/etc/nginx/sites-available/rrhh-api`

```nginx
server {
    listen 80;
    server_name api.tuservidor.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 🔒 Habilitar HTTPS con Let's Encrypt (Certbot)

Una vez configurado el archivo anterior y reiniciado Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/rrhh-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Luego ejecutar Certbot:

```bash
sudo certbot --nginx -d api.tuservidor.com
```

Certbot actualizará automáticamente tu archivo de Nginx para soportar HTTPS.

---

## 🔁 Renovación automática del certificado

Certbot ya instala un cronjob automático. Para verificar:

```bash
sudo certbot renew --dry-run
```

---

## 🧪 Test local + externo

- En red local:
  - `http://localhost:4000` o `http://192.168.x.x:4000`
- Desde internet:
  - `https://api.tuservidor.com` (si ya está abierto el puerto 443)

---

## ✅ Resultado final

Tu API RRHH está protegida por:

- 🔐 JWT + Refresh
- 🛡️ Helmet + RateLimit + IPFilter
- 🔄 PM2 para reinicio automático
- 🌍 Expuesta a internet con HTTPS seguro (opcional)

---

Esto queda listo para activarlo cuando decidas abrir los puertos o mover a producción real.

