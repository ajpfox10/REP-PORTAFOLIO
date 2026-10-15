# Changelog

Todos los cambios notables de este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

---

## [1.0.0] - 2026-02-17

### Agregado

#### Autenticación y Seguridad
- **Password Reset** - Sistema completo de recuperación de contraseña
  - Endpoint `/api/v1/auth/forgot-password` - Solicitar reset
  - Endpoint `/api/v1/auth/reset-password` - Resetear con token
  - Tokens seguros con SHA-256 y expiración de 1 hora
  - Migración SQL `010__password_reset_tokens.sql`
  - Servicio `passwordReset.service.ts` con cleanup automático

- **Two-Factor Authentication (2FA)**
  - Códigos de 6 dígitos enviados por email
  - Expiración automática (10 minutos por defecto)
  - Rate limiting de intentos (máximo 3)
  - Flag `two_factor_enabled` por usuario
  - Migración SQL `011__two_factor_auth.sql`
  - Servicio `twoFactor.service.ts` completo

#### Email System
- **Servicio de Email** (`email.service.ts`)
  - Integración con nodemailer
  - Soporte para SMTP (Gmail, custom servers, etc.)
  - Templates HTML profesionales para:
    - Password reset
    - 2FA codes
  - Configuración via env vars:
    - `EMAIL_ENABLE`, `EMAIL_HOST`, `EMAIL_PORT`
    - `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`

#### Tests Completos
- **Tests de Autenticación** (`tests/integration/auth.test.ts`)
  - 20+ tests cubriendo:
    - Login con credenciales válidas/inválidas
    - Refresh token y detección de reuso
    - Logout y revocación de tokens
    - Forgot password flow
    - Reset password con token válido/inválido/expirado

- **Tests de API Keys** (`tests/integration/apiKeys.test.ts`)
  - 15+ tests cubriendo:
    - Creación de API keys
    - Listado y obtención por ID
    - Revocación de keys
    - Autenticación con API keys
    - Permisos RBAC para API keys

- **Tests de Webhooks** (`tests/integration/webhooks.test.ts`)
  - 15+ tests cubriendo:
    - CRUD completo de webhooks
    - Validación de URLs y eventos
    - Firma HMAC y verificación
    - Queue system (básico)

#### Documentación
- **DEPLOYMENT.md** - Guía completa de producción
  - Setup de servidor (Ubuntu/Debian/RHEL)
  - Configuración de MySQL, Redis, Nginx
  - Setup de SSL con Let's Encrypt
  - Configuración de PM2 y logrotate
  - Checklist de seguridad
  - Troubleshooting guide
  - Mantenimiento periódico

- **README.md** actualizado
  - Features completas documentadas
  - Guías de uso con ejemplos
  - Estructura del proyecto
  - Roadmap futuro
  - Guías de contribución

- **CHANGELOG.md** (este archivo)

#### Configuración
- Variables de entorno para email en `src/config/env.ts`:
  - `EMAIL_ENABLE`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`
  - `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`

- Variables de entorno para password reset:
  - `PASSWORD_RESET_TOKEN_TTL_HOURS`
  - `PASSWORD_RESET_URL_BASE`

- Variables de entorno para 2FA:
  - `ENABLE_2FA`
  - `TWO_FA_CODE_TTL_MINUTES`
  - `TWO_FA_CODE_LENGTH`

- `.env.example` actualizado con todas las nuevas variables

#### Dependencias
- `nodemailer@^6.9.16` - Sistema de email
- `@types/nodemailer@^6.4.16` - TypeScript types

---

### Corregido

#### Tests
- **jest.env.ts** - Agregado `DOCS_PROTECT='false'` para evitar 403 en tests del contrato OpenAPI
  - El test `openapi.contract.test.ts` ahora pasa correctamente
  - Consistente con el patrón de `METRICS_PROTECT='0'`

#### Limpieza de Código
- **Archivos eliminados** (código muerto):
  - `tests/unit/example.test.ts` - Placeholder vacío
  - `tests/openapi/openapiTestConfig.ts` - No usado por ningún test
  - `tests/security/openapi.test.yaml` - Duplicado de `tests/fixtures/`
  - `Object.values(r)[0]))` - Archivo corrupto en raíz

#### Configuración
- **.gitignore** actualizado:
  - `proyecto_completo*.txt` - Archivos de dump
  - `runtime.log` - Log temporal
  - `server.log` - Log temporal

- **.env** limpio (removidas duplicaciones)
  - `DOCS_ENABLE` ya no está duplicado
  - `DOCS_PATH` ya no está duplicado

---

### Cambiado

#### Autenticación
- **auth.routes.ts** - Agregados endpoints de password reset
  - `/auth/forgot-password` (POST)
  - `/auth/reset-password` (POST)
  - Schemas de validación Zod para ambos

#### Estructura
- Reorganización de servicios en `src/services/`:
  - `email.service.ts` - Nuevo
  - `passwordReset.service.ts` - Nuevo
  - `twoFactor.service.ts` - Nuevo
  - `documentVersion.service.ts` - Existente
  - `ocr.service.ts` - Existente

---

### Seguridad

#### Tokens
- **Password reset tokens** usan SHA-256 hash para almacenamiento
- **2FA codes** usan SHA-256 hash para almacenamiento
- Expiración automática de tokens y códigos
- Rate limiting de intentos para 2FA (máximo 3)

#### Email
- No exponer si un email existe en el sistema (forgot password)
- Mensajes genéricos para evitar enumeración de usuarios

---

### Rendimiento

#### Queries Optimizadas
- Índices agregados en `password_reset_tokens`:
  - `idx_token_hash` para lookups rápidos
  - `idx_usuario_id` para queries por usuario
  - `idx_cleanup` para limpieza eficiente de tokens expirados

- Índices agregados en `two_factor_codes`:
  - `idx_usuario_id` para lookups por usuario
  - `idx_code_hash` para verificación rápida
  - `idx_cleanup` para limpieza eficiente

---

## [0.9.0] - 2026-02-01 (Versión anterior al upgrade)

### Features existentes antes de esta actualización:

#### Core
- Express + TypeScript
- Sequelize ORM con MySQL
- OpenAPI 3.0 con validación automática
- Swagger UI integrado

#### Autenticación
- JWT con access + refresh tokens
- API Keys con RBAC
- Login guard con bloqueo por intentos
- Soft delete

#### CRUD
- CRUD dinámico para todas las tablas
- RBAC granular (read/write/delete por tabla)
- Soft delete respetando permisos

#### Monitoreo
- Prometheus metrics (HTTP, dominio, socket)
- Grafana dashboards
- Winston logging con rotación
- Request ID tracking
- Audit log (lecturas y escrituras)

#### Integraciones
- WebSockets (Socket.IO)
- Webhooks con firma HMAC
- OCR de documentos (Tesseract)
- File scanning (ClamAV)
- Document versioning

#### DevOps
- Docker Compose completo
- PM2 ecosystem
- Automated backups
- Migrations system
- Health checks

#### Tests
- Health checks
- Security (CORS, rate limit, sanitize, IP guard)
- CRUD (operaciones básicas)
- Certificados
- Documentos
- Eventos
- OpenAPI validation (parcial)

---

## [Unreleased] - Futuras features planificadas

### Considerado para próximas versiones:

#### Autenticación
- [ ] WebAuthn / FIDO2
- [ ] OAuth2 / OIDC provider
- [ ] SMS 2FA (Twilio)
- [ ] TOTP 2FA (Authenticator apps)

#### Features
- [ ] GraphQL API alternativa
- [ ] Multi-tenancy
- [ ] Advanced analytics dashboard
- [ ] Mobile push notifications
- [ ] Internationalization (i18n)

#### Infraestructura
- [ ] Elasticsearch para búsqueda avanzada
- [ ] S3/MinIO para almacenamiento de archivos
- [ ] Kubernetes manifests
- [ ] Terraform scripts

#### Tests
- [ ] E2E tests para mobile app
- [ ] Performance tests con Artillery
- [ ] Mutation testing
- [ ] Contract tests con Pact

---

## Notas de Migración

### De 0.9.0 a 1.0.0

#### Base de Datos
Ejecutar las nuevas migraciones:
```bash
npm run db:migrate
```

Esto creará:
- Tabla `password_reset_tokens`
- Tabla `two_factor_codes`
- Columna `two_factor_enabled` en `usuarios`

#### Variables de Entorno
Agregar al `.env`:
```env
# Email
EMAIL_ENABLE=false
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM="Personal v5" <noreply@example.com>

# Password Reset
PASSWORD_RESET_TOKEN_TTL_HOURS=1
PASSWORD_RESET_URL_BASE=http://localhost:3000

# 2FA
ENABLE_2FA=false
TWO_FA_CODE_TTL_MINUTES=10
TWO_FA_CODE_LENGTH=6
```

#### Dependencias
Reinstalar dependencias:
```bash
npm install
```

#### Tests
El archivo `tests/jest.env.ts` ahora incluye `DOCS_PROTECT='false'`.
Si habías hecho override personalizado, asegúrate de mantenerlo.

---

## Links y Referencias

- [Repositorio GitHub](https://github.com/tu-repo)
- [Documentación](https://docs.tu-dominio.com)
- [Issues](https://github.com/tu-repo/issues)
- [Pull Requests](https://github.com/tu-repo/pulls)

---

**Formato de fechas**: YYYY-MM-DD  
**Versionado**: [Semantic Versioning 2.0.0](https://semver.org/)  
**Mantenido por**: Tu Nombre <tu-email@example.com>
