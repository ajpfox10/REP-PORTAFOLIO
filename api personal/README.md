# 🚀 Personal v5 Enterprise API

> Sistema completo de gestión de personal y RRHH con autenticación JWT, RBAC, OpenAPI, métricas, webhooks, y más.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

---

## ⚠️ IMPORTANTE - LEER PRIMERO

**ANTES de instalar o correr tests, DEBES ejecutar la migración SQL:**

```bash
# 1. Ejecutar migración SQL
mysql -u root -p personalv5_test < scripts/migrations/000__fix_schema_for_production.sql

# 2. Crear usuario admin
mysql -u root -p personalv5_test < scripts/migrations/seed_test_users.sql

# 3. Ahora sí - instalar y testear
npm install
npm test
```

👉 **Ver [INSTALLATION.md](INSTALLATION.md) para instrucciones detalladas**

---

## ✨ Características Principales

### 🔐 Autenticación y Seguridad
- ✅ **JWT Authentication** con access y refresh tokens
- ✅ **API Keys** con gestión completa y revocación
- ✅ **RBAC** (Role-Based Access Control) granular por tabla y operación
- ✅ **Password Reset** con email y tokens seguros
- ✅ **2FA/MFA** con códigos por email
- ✅ **Rate Limiting** distribuido con Redis
- ✅ **Login Guard** con bloqueo por intentos fallidos
- ✅ **IP Whitelist/Blacklist**
- ✅ **Security Headers** (Helmet)
- ✅ **Input Sanitization**

### 📊 Monitoreo y Observabilidad
- ✅ **Prometheus** metrics (HTTP, dominio, WebSocket)
- ✅ **Grafana** dashboards incluidos
- ✅ **Winston** logging estructurado con rotación diaria
- ✅ **Request ID** tracking
- ✅ **Audit Log** completo (lecturas y escrituras)

### 🔌 Integraciones
- ✅ **Webhooks** con firma HMAC y sistema de colas
- ✅ **WebSockets** (Socket.IO) para eventos en tiempo real
- ✅ **Email** transaccional con templates HTML (nodemailer)
- ✅ **OCR** de documentos (Tesseract.js)
- ✅ **File Scanning** antivirus (ClamAV)
- ✅ **Document Versioning**

### 📝 Documentación y Validación
- ✅ **OpenAPI 3.0** spec autogenerada
- ✅ **Swagger UI** integrado
- ✅ **Request/Response** validation automática
- ✅ **TypeScript** con tipos estrictos

### 🔄 DevOps y Deployment
- ✅ **Docker Compose** completo (app, MySQL, Redis, Prometheus, Grafana, Nginx)
- ✅ **PM2** ecosystem config
- ✅ **Automated Backups** con scheduler
- ✅ **Migrations** system
- ✅ **Health Checks** (health + ready endpoints)
- ✅ **Graceful Shutdown**
- ✅ **Zero-Downtime Deployments**

### 📱 Aplicación Móvil
- ✅ **React Native** app (Expo) con screens de login, documentos y viewer

---

## 📦 Instalación

### Pre-requisitos
- Node.js >= 18.0.0
- MySQL >= 8.0
- Redis >= 6.0 (opcional, para rate limiting distribuido)

### Setup Rápido

```bash
# Clonar repositorio
git clone <tu-repo>
cd personalv5-enterprise-api

# Instalar dependencias
npm install

# Configurar entorno
cp .env.example .env
# Editar .env con tus credenciales

# Ejecutar migraciones
npm run db:migrate

# Crear usuario administrador
npm run seed:admin

# Desarrollo
npm run dev

# Producción
npm run build
npm start
```

---

## 🔧 Configuración

### Variables de Entorno Críticas

Ver `.env.example` para la lista completa. Las más importantes:

```env
# Base de datos
DB_HOST=localhost
DB_NAME=personalv5
DB_USER=root
DB_PASSWORD=tu-password

# JWT (generar con: openssl rand -hex 32)
JWT_ACCESS_SECRET=tu-secret-largo-aleatorio
JWT_REFRESH_SECRET=tu-secret-largo-aleatorio

# Email
EMAIL_ENABLE=true
EMAIL_HOST=smtp.gmail.com
EMAIL_USER=tu-email@gmail.com
EMAIL_PASSWORD=tu-app-password

# Redis (opcional)
RATE_LIMIT_USE_REDIS=true
REDIS_URL=redis://localhost:6379
```

---

## 🚀 Uso

### Endpoints Principales

#### Autenticación
```bash
# Login
POST /api/v1/auth/login
{
  "email": "admin@example.com",
  "password": "tu-password"
}

# Refresh Token
POST /api/v1/auth/refresh
{
  "refreshToken": "..."
}

# Logout
POST /api/v1/auth/logout
{
  "refreshToken": "..."
}

# Forgot Password
POST /api/v1/auth/forgot-password
{
  "email": "admin@example.com"
}

# Reset Password
POST /api/v1/auth/reset-password
{
  "token": "...",
  "newPassword": "..."
}
```

#### CRUD Dinámico
```bash
# Listar registros de cualquier tabla
GET /api/v1/crud/:table?limit=10&offset=0

# Crear registro
POST /api/v1/crud/:table
{
  "campo1": "valor1",
  "campo2": "valor2"
}

# Actualizar registro
PUT /api/v1/crud/:table/:id
{
  "campo1": "nuevo-valor"
}

# Eliminar registro (soft delete)
DELETE /api/v1/crud/:table/:id
```

#### API Keys
```bash
# Crear API key
POST /api/v1/api-keys
{
  "name": "Mi API Key",
  "roleId": 1
}

# Listar keys
GET /api/v1/api-keys

# Revocar key
DELETE /api/v1/api-keys/:id/revoke
```

#### Webhooks
```bash
# Crear webhook
POST /api/v1/webhooks
{
  "url": "https://example.com/webhook",
  "events": ["user.created", "user.updated"],
  "active": true
}

# Listar webhooks
GET /api/v1/webhooks
```

### Autenticación en Requests

**Opción 1: API Key**
```bash
curl -H "x-api-key: tu-api-key" http://localhost:3000/api/v1/crud/personal
```

**Opción 2: JWT Bearer Token**
```bash
curl -H "Authorization: Bearer tu-jwt-token" http://localhost:3000/api/v1/crud/personal
```

---

## 🧪 Tests

```bash
# Todos los tests
npm test

# Tests de integración
npm run test:integration

# Tests con coverage
npm run test:coverage

# Test del contrato OpenAPI
npm run test:openapi

# Load testing (k6)
npm run test:load:smoke
npm run test:load:load
npm run test:load:stress
```

### Cobertura de Tests
- ✅ **Autenticación**: Login, refresh, logout, password reset
- ✅ **API Keys**: Crear, listar, revocar, autenticar
- ✅ **Webhooks**: CRUD completo y firma HMAC
- ✅ **CRUD**: Operaciones básicas y RBAC
- ✅ **Seguridad**: CORS, rate limit, sanitize, IP guard
- ✅ **Health checks**: /health y /ready
- ✅ **OpenAPI**: Validación de contratos

---

## 📊 Monitoreo

### Métricas (Prometheus)
```bash
# Endpoint de métricas (protegido con token)
curl -H "x-metrics-token: TU_TOKEN" http://localhost:3000/metrics
```

### Grafana Dashboard
```bash
# Iniciar stack completo con Docker
docker-compose up -d

# Acceder a Grafana
open http://localhost:3001
# Usuario: admin / Password: admin
```

### PM2 Monitoring
```bash
pm2 monit
pm2 logs
```

---

## 🔄 Backups

### Backup Manual
```bash
# Linux
npm run backup:linux

# Windows
npm run backup:win
```

### Backup Automático (Cron)
```bash
# Configurar backup diario
npm run backup:schedule:linux

# O agregar manualmente al crontab
crontab -e
0 2 * * * /path/to/app/scripts/backup/backup.sh
```

### Restaurar Backup
```bash
npm run restore
```

---

## 🐳 Docker

### Desarrollo Local
```bash
# Iniciar todos los servicios
docker-compose up -d

# Ver logs
docker-compose logs -f

# Detener
docker-compose down
```

### Producción
Ver `DEPLOYMENT.md` para guía completa de despliegue.

---

## 📁 Estructura del Proyecto

```
personalv5-enterprise-api/
├── src/
│   ├── app.ts                 # Express app setup
│   ├── server.ts              # Server entry point
│   ├── config/
│   │   └── env.ts             # Environment config (Zod)
│   ├── auth/                  # JWT, passwords, usuarios
│   ├── middlewares/           # Auth, RBAC, rate limit, etc.
│   ├── routes/                # API endpoints
│   ├── services/              # Business logic
│   │   ├── email.service.ts        # ✨ Nuevo: Email con nodemailer
│   │   ├── passwordReset.service.ts # ✨ Nuevo: Password reset
│   │   └── twoFactor.service.ts    # ✨ Nuevo: 2FA
│   ├── db/
│   │   ├── sequelize.ts       # DB connection
│   │   ├── migrations/        # SQL migrations
│   │   └── dynamic/           # Dynamic models
│   ├── logging/               # Winston logger
│   ├── metrics/               # Prometheus metrics
│   ├── webhooks/              # Webhook system
│   └── socket/                # Socket.IO handlers
├── tests/
│   ├── integration/
│   │   ├── auth.test.ts            # ✨ Nuevo: Tests completos de auth
│   │   ├── apiKeys.test.ts         # ✨ Nuevo: Tests de API keys
│   │   ├── webhooks.test.ts        # ✨ Nuevo: Tests de webhooks
│   │   ├── crud.readonly.test.ts
│   │   ├── certificados.test.ts
│   │   ├── documentos.test.ts
│   │   └── eventos.test.ts
│   ├── security/              # Tests de seguridad
│   ├── openapi/               # Tests de contrato OpenAPI
│   └── helpers/               # Test utilities
├── docs/                      # OpenAPI specs
├── docker/                    # Docker configs
├── scripts/                   # Utilidades y migrations
├── mobile/                    # React Native app
├── .env.example               # ✨ Actualizado con email y 2FA
├── package.json               # ✨ Actualizado con nodemailer
├── DEPLOYMENT.md              # ✨ Nuevo: Guía de producción
└── README.md                  # Este archivo
```

---

## 🆕 Changelog (Nuevas Features)

### ✅ Implementado en esta versión

1. **Password Reset Completo**
   - Endpoint `/auth/forgot-password`
   - Endpoint `/auth/reset-password`
   - Tokens seguros con expiración
   - Emails HTML con templates

2. **Sistema de Emails**
   - Servicio con nodemailer
   - Templates HTML profesionales
   - Soporte para Gmail, SMTP, etc.

3. **2FA/MFA**
   - Códigos de 6 dígitos por email
   - Expiración automática
   - Rate limiting de intentos
   - Flags por usuario

4. **Tests Completos**
   - ✅ Auth: 20+ tests (login, refresh, logout, password reset)
   - ✅ API Keys: 15+ tests (CRUD completo + autenticación)
   - ✅ Webhooks: 15+ tests (CRUD + firma HMAC)

5. **Mejoras de Configuración**
   - Variables de email en `env.ts`
   - Variables de 2FA en `env.ts`
   - `.env.example` actualizado
   - `.gitignore` mejorado

6. **Documentación**
   - `DEPLOYMENT.md` completo con checklist de producción
   - README actualizado con todas las features
   - Guía de troubleshooting

7. **Migraciones SQL**
   - `010__password_reset_tokens.sql`
   - `011__two_factor_auth.sql`

8. **Bug Fixes**
   - ✅ `jest.env.ts`: Agregado `DOCS_PROTECT=false`
   - ✅ Archivos innecesarios eliminados
   - ✅ `.gitignore` actualizado
   - ✅ `package.json` con nodemailer

---

## 🛣️ Roadmap Futuro

### Features Potenciales
- [ ] WebAuthn / FIDO2 para autenticación sin contraseña
- [ ] OAuth2 / OIDC provider
- [ ] GraphQL API alternativa
- [ ] Multi-tenancy
- [ ] Advanced analytics dashboard
- [ ] Mobile push notifications
- [ ] SMS 2FA (Twilio)
- [ ] Internationalization (i18n)
- [ ] Advanced search (Elasticsearch)
- [ ] File storage (S3/MinIO)

---

## 🤝 Contribuir

Las contribuciones son bienvenidas! Por favor:

1. Fork el proyecto
2. Crea un branch (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

### Guías de Estilo
- Usar Biome para linting: `npm run lint`
- Seguir convenciones de commitlint
- Escribir tests para nuevas features
- Actualizar documentación

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver `LICENSE` para más detalles.

---

## 👥 Autores

- **Tu Nombre** - *Trabajo Inicial* - [tu-github](https://github.com/tu-usuario)

---

## 🙏 Agradecimientos

- [Express](https://expressjs.com/)
- [Sequelize](https://sequelize.org/)
- [Socket.IO](https://socket.io/)
- [Prometheus](https://prometheus.io/)
- [Grafana](https://grafana.com/)
- [Jest](https://jestjs.io/)
- Y toda la comunidad open source ❤️

---

## 📞 Soporte

¿Tienes preguntas o problemas?

- 📧 Email: support@tu-dominio.com
- 🐛 Issues: [GitHub Issues](https://github.com/tu-repo/issues)
- 📚 Docs: [docs.tu-dominio.com](https://docs.tu-dominio.com)

---

**¡Gracias por usar Personal v5 Enterprise API!** 🚀
