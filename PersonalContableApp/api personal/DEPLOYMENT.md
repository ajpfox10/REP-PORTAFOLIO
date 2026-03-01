# 🚀 Guía de Despliegue a Producción - Personal v5 Enterprise API

## ✅ Pre-requisitos

### Infraestructura requerida:
- **Servidor**: Ubuntu 20.04+ / Debian 11+ / RHEL 8+
- **Node.js**: v18+ (LTS recomendado)
- **MySQL**: 8.0+
- **Redis**: 6.0+ (para rate limiting distribuido)
- **Memoria RAM**: Mínimo 2GB, recomendado 4GB+
- **CPU**: Mínimo 2 cores, recomendado 4+ cores
- **Almacenamiento**: 50GB+ para logs y documentos

### Software adicional:
- **PM2**: Para gestión de procesos
- **Nginx**: Como reverse proxy
- **ClamAV** (opcional): Para escaneo de archivos subidos
- **Postfix/SMTP** (opcional): Para envío de emails

---

## 📦 Paso 1: Preparar el servidor

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js (v18 LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar PM2 globalmente
sudo npm install -g pm2

# Instalar MySQL
sudo apt install -y mysql-server
sudo mysql_secure_installation

# Instalar Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Instalar Nginx
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# (Opcional) Instalar ClamAV
sudo apt install -y clamav clamav-daemon
sudo freshclam
sudo systemctl enable clamav-daemon
sudo systemctl start clamav-daemon
```

---

## 📂 Paso 2: Desplegar la aplicación

```bash
# Crear usuario para la aplicación
sudo adduser --disabled-password --gecos "" api-personal
sudo usermod -aG sudo api-personal

# Cambiar a usuario api-personal
sudo su - api-personal

# Clonar/copiar el proyecto
mkdir -p /home/api-personal/app
cd /home/api-personal/app

# Copiar archivos del proyecto aquí
# (usa scp, rsync, git clone, etc.)

# Instalar dependencias
npm ci --production

# Build del proyecto
npm run build
```

---

## 🗄️ Paso 3: Configurar la base de datos

```bash
# Conectar a MySQL
sudo mysql -u root -p

# Crear base de datos y usuario
CREATE DATABASE personalv5 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'personalv5_user'@'localhost' IDENTIFIED BY 'YOUR_STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON personalv5.* TO 'personalv5_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# Ejecutar migraciones
cd /home/api-personal/app
npm run db:migrate
```

---

## ⚙️ Paso 4: Configurar variables de entorno

```bash
# Crear archivo .env en producción
cd /home/api-personal/app
cp .env.example .env
nano .env
```

### ⚠️ CRÍTICO - Variables obligatorias en producción:

```env
NODE_ENV=production
PORT=3000

# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_NAME=personalv5
DB_USER=personalv5_user
DB_PASSWORD=YOUR_STRONG_PASSWORD_HERE

# JWT Secrets (generar con: openssl rand -hex 32)
JWT_ACCESS_SECRET=<tu-secret-largo-aleatorio-32-chars-minimo>
JWT_REFRESH_SECRET=<tu-secret-largo-aleatorio-32-chars-minimo>

# Redis
RATE_LIMIT_USE_REDIS=true
REDIS_URL=redis://localhost:6379

# Métricas
METRICS_ENABLE=true
METRICS_PROTECT=true
METRICS_TOKEN=<tu-token-largo-aleatorio-16-chars-minimo>

# Documentación
DOCS_ENABLE=true
DOCS_PROTECT=true

# CORS (ajustar según tu frontend)
CORS_ALLOW_ALL=false
CORS_ALLOWLIST=https://tu-dominio.com,https://app.tu-dominio.com

# Hardening
ENABLE_HARDENING=true
ENABLE_REQUEST_BODY_LIMITS=true
ENABLE_COMPRESSION=true

# Logging
LOG_DIR=/home/api-personal/app/logs
LOG_LEVEL=info
LOG_RETENTION_DAYS=90

# Documentos
DOCUMENTS_BASE_DIR=/home/api-personal/documents
DOCUMENTS_SCAN_ENABLE=true
DOCUMENTS_SCAN_MODE=clamd

# Email (usar servicio SMTP real)
EMAIL_ENABLE=true
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=tu-email@gmail.com
EMAIL_PASSWORD=tu-app-password
EMAIL_FROM="Personal v5" <noreply@tu-dominio.com>

# Password Reset
PASSWORD_RESET_URL_BASE=https://tu-dominio.com

# Trust Proxy (importante si usas Nginx)
TRUST_PROXY=true

# Production safeguards
PROD_FAIL_FAST=true
PROD_REQUIRE_DOCS_PROTECT=true
PROD_REQUIRE_METRICS_PROTECT=true
PROD_DISALLOW_CORS_ALLOW_ALL=true
```

### Crear directorio para documentos:
```bash
sudo mkdir -p /home/api-personal/documents
sudo chown api-personal:api-personal /home/api-personal/documents
sudo chmod 750 /home/api-personal/documents
```

---

## 🔄 Paso 5: Configurar PM2

```bash
cd /home/api-personal/app

# Iniciar aplicación con PM2
pm2 start ecosystem.config.js

# Guardar configuración
pm2 save

# Setup PM2 para arranque automático
pm2 startup

# Verificar estado
pm2 status
pm2 logs
```

### Configurar logrotate para PM2:
```bash
sudo nano /etc/logrotate.d/pm2-api-personal
```

Contenido:
```
/home/api-personal/.pm2/logs/*.log {
    daily
    rotate 30
    missingok
    notifempty
    compress
    delaycompress
    dateext
    dateformat -%Y-%m-%d
    postrotate
        pm2 reloadLogs
    endscript
}
```

---

## 🌐 Paso 6: Configurar Nginx como Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/api-personal
```

### Configuración básica:
```nginx
upstream api_backend {
    server 127.0.0.1:3000 fail_timeout=0;
}

server {
    listen 80;
    server_name api.tu-dominio.com;

    # Redirigir a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.tu-dominio.com;

    # SSL certificates (usar Certbot/Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/api.tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.tu-dominio.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Logging
    access_log /var/log/nginx/api-personal-access.log;
    error_log /var/log/nginx/api-personal-error.log;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;

    # Proxy settings
    location / {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Documentos estáticos (si se sirven desde nginx)
    location /documents/ {
        alias /home/api-personal/documents/;
        internal;
    }
}
```

### Activar sitio:
```bash
sudo ln -s /etc/nginx/sites-available/api-personal /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Configurar SSL con Let's Encrypt:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.tu-dominio.com
```

---

## 🔒 Paso 7: Configurar Firewall

```bash
# UFW (Ubuntu Firewall)
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
sudo ufw status
```

---

## 📊 Paso 8: Configurar Monitoreo

### 1. Prometheus (opcional)
```bash
# Acceso a métricas (protegido con METRICS_TOKEN)
curl -H "x-metrics-token: TU_METRICS_TOKEN" http://localhost:3000/metrics
```

### 2. Grafana (opcional)
```bash
# Usar Docker Compose del proyecto
cd /home/api-personal/app/docker
docker-compose up -d grafana prometheus
```

### 3. PM2 Monitoring
```bash
pm2 monit
pm2 web  # Dashboard web en puerto 9615
```

---

## 🔐 Paso 9: Crear usuario administrador

```bash
cd /home/api-personal/app
npm run seed:admin
```

Esto creará:
- Email: `admin@example.com`
- Password: (se generará aleatoriamente y se mostrará en consola)

**¡IMPORTANTE!** Cambiar la contraseña inmediatamente después del primer login.

---

## 🧪 Paso 10: Verificar despliegue

```bash
# Health check
curl https://api.tu-dominio.com/health

# Ready check (verifica DB)
curl https://api.tu-dominio.com/ready

# Login test
curl -X POST https://api.tu-dominio.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"TU_PASSWORD"}'
```

---

## 🔄 Actualización de la aplicación

```bash
# Entrar como usuario api-personal
sudo su - api-personal
cd /home/api-personal/app

# Pull últimos cambios (si usas git)
git pull

# O copiar archivos nuevos
# scp -r ./dist user@server:/home/api-personal/app/

# Instalar nuevas dependencias (si hay)
npm ci --production

# Rebuild
npm run build

# Ejecutar migraciones nuevas
npm run db:migrate

# Reload con PM2 (zero-downtime)
pm2 reload ecosystem.config.js
```

---

## 🔍 Troubleshooting

### Ver logs:
```bash
# PM2 logs
pm2 logs api-personal

# Nginx logs
sudo tail -f /var/log/nginx/api-personal-error.log

# Application logs
tail -f /home/api-personal/app/logs/app-$(date +%Y-%m-%d).log
```

### Reiniciar servicios:
```bash
# Aplicación
pm2 restart api-personal

# Nginx
sudo systemctl restart nginx

# Redis
sudo systemctl restart redis-server

# MySQL
sudo systemctl restart mysql
```

### Verificar conexiones:
```bash
# Ver puertos en uso
sudo netstat -tulpn | grep LISTEN

# Verificar Node.js corriendo
ps aux | grep node

# Verificar PM2
pm2 status
```

---

## 📋 Checklist de Seguridad

- [ ] **JWT_ACCESS_SECRET y JWT_REFRESH_SECRET** con mínimo 32 caracteres aleatorios
- [ ] **METRICS_TOKEN** con mínimo 16 caracteres aleatorios
- [ ] **DOCS_PROTECT=true** en producción
- [ ] **METRICS_PROTECT=true** en producción
- [ ] **CORS_ALLOW_ALL=false** con allowlist configurado
- [ ] **SSL/HTTPS** configurado con certificado válido
- [ ] **Firewall** (UFW) activo permitiendo solo puertos necesarios
- [ ] **Backups** automáticos configurados (ver `scripts/backup/`)
- [ ] **Rate limiting** habilitado con Redis
- [ ] **ClamAV** instalado y actualizado (si DOCUMENTS_SCAN_ENABLE=true)
- [ ] **PM2** configurado para arranque automático
- [ ] **Logrotate** configurado para PM2 y Nginx
- [ ] **Monitoring** configurado (PM2, Prometheus, Grafana)
- [ ] **Password de admin** cambiado después del seed inicial

---

## 🔄 Backups Automáticos

### Configurar backup automático:
```bash
cd /home/api-personal/app

# Linux (cron)
npm run backup:schedule:linux

# O agregar manualmente al crontab
crontab -e

# Agregar línea (backup diario a las 2 AM):
0 2 * * * /home/api-personal/app/scripts/backup/backup.sh >> /home/api-personal/app/logs/backup.log 2>&1
```

### Restaurar desde backup:
```bash
npm run restore
# Seguir las instrucciones en pantalla
```

---

## 📝 Mantenimiento Periódico

### Semanal:
- Revisar logs de errores
- Verificar métricas de uso (CPU, RAM, disco)
- Revisar logs de Nginx para tráfico anómalo

### Mensual:
- Actualizar dependencias npm: `npm audit fix`
- Actualizar sistema operativo: `sudo apt update && sudo apt upgrade`
- Revisar y limpiar logs antiguos
- Verificar backups

### Trimestral:
- Rotar API keys antiguas: `npm run keys:rotate`
- Auditoría de seguridad: `npm run security:audit:prod`
- Revisar permisos RBAC y usuarios

---

## 🆘 Contacto y Soporte

Para soporte técnico, reportar bugs o contribuir:
- **GitHub**: [tu-repo]
- **Email**: support@tu-dominio.com
- **Docs**: https://docs.tu-dominio.com

---

## 📚 Referencias Adicionales

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx Security Guide](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
- [MySQL Performance Tuning](https://dev.mysql.com/doc/refman/8.0/en/optimization.html)

---

**Última actualización**: Febrero 2026  
**Versión de la API**: 1.0.0
