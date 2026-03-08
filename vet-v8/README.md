# 🐾 Veterinaria SaaS Platform v4.0

> Multi-tenant SaaS backend para clínicas veterinarias. Producción-ready, deploy-ready.

---

## Novedades v4.0 (vs v2.1)

| # | Gap resuelto | Implementación |
|---|--------------|----------------|
| 1 | **KMS Envelope Encryption completo** | `kmsEnvelope.ts` — DEK por tenant en `tenant_data_keys`, AES-256-GCM, rotación automática via worker |
| 2 | **Refresh token rotation** con detección de robo | `authRouter.ts` — familia de tokens en Redis, theft detection revoca sesión completa |
| 3 | **Worker con handlers reales** | Stripe webhook processing, vacuna reminders, turno reminders, DEK rotation batch |
| 4 | **SQL ultra profesional** | `sql/master.sql` + `sql/tenant.sql` — FK constraints, índices compuestos, FULLTEXT, CHECK constraints |
| 5 | **`logout-all` + `change-password`** | `token_version` bump invalida todos los JWTs activos globalmente |
| 6 | **`DELETE /mfa`** | Desactivación segura de MFA requiriendo código TOTP |
| 7 | **Impersonación auditada** | `/api/internal/support/impersonate` escribe en `auditoria_log` con reason |
| 8 | **Feature flags en internal API** | `PUT /api/internal/tenants/:id/features/:key` |
| 9 | **DEK rotation endpoint** | `POST /api/internal/tenants/:id/dek-rotate` → encola job en BullMQ |
| 10 | **Schema SQL adicional** | Prescripciones, Internaciones, Movimientos de stock, Facturación, Items de factura |

---

## KMS Envelope Encryption

```
                    AWS KMS (o HKDF fallback)
                           │
                   GenerateDataKey
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
   Plaintext DEK (32 bytes)         Encrypted DEK (ciphertext)
         │                                   │
   AES-256-GCM encrypt          stored in tenant_data_keys
   (field value)                (never the plaintext)
         │
   EncryptedBlob { v:2, alg, kid, iv, tag, ct }
   stored in DB column (TEXT)
```

### Rotation flow

```
POST /api/internal/tenants/:id/dek-rotate
  → enqueues "dek-rotation" job in BullMQ
  → worker: generateNewDek(tenantId, version+1)
  → worker: re-encrypts all *_enc columns with new DEK
```

---

## Refresh Token Rotation

```
Login → RT_v1 stored in Redis
   ↓
Refresh with RT_v1 → issue RT_v2, store RT_v2, invalidate RT_v1
   ↓
If someone reuses RT_v1 → THEFT DETECTED → delete RT_v2 → all sessions revoked
```

`token_version` en tabla `users`:
- `POST /logout-all` → bump version → todos los JWTs previos inválidos
- `change-password` → bump version automáticamente

---

## SQL Schemas

```
sql/
├── master.sql    → veterinaria_master (tenant registry, billing, KMS keys)
└── tenant.sql    → schema por tenant (todas las tablas de dominio)
```

### Tablas de dominio (tenant)

| Tabla | Descripción |
|-------|-------------|
| `users` | Staff, login, MFA TOTP encrypted, token_version |
| `sucursales` | Clínicas físicas del tenant |
| `veterinarios` | Staff médico, matrícula, color agenda |
| `propietarios` | Dueños de mascotas, FULLTEXT search |
| `pacientes` | Animales — microchip, especie, FULLTEXT |
| `turnos` | Agenda — estado workflow completo |
| `consultas` | Historia clínica SOAP + signos vitales |
| `prescripciones` | Recetas médicas por consulta |
| `vacunas` | Cartilla vacunación + reminder flag |
| `desparasitaciones` | Control antiparasitario |
| `internaciones` | Hospitalización |
| `productos` | Inventario / farmacia, SKU, IVA |
| `stock_movimientos` | Trazabilidad de inventario |
| `facturas` | Comprobantes A/B/C, AFIP |
| `factura_items` | Ítems de factura |
| `files` | Metadata S3: radiografías, resultados |
| `auditoria_log` | Append-only audit trail |

### Tablas de master

| Tabla | Descripción |
|-------|-------------|
| `tenants` | Registry central |
| `tenant_plugins` | Marketplace plugins por tenant |
| `tenant_features` | Feature flags granulares |
| `tenant_plan_overrides` | Límites custom enterprise |
| `tenant_data_keys` | Encrypted DEKs (KMS envelope) |
| `billing_subscriptions` | Suscripciones Stripe |
| `billing_webhook_events` | Idempotency store |
| `admin_audit_log` | Audit de acciones de soporte |

---

## Setup deploy

```bash
# 1. Instalar
npm install

# 2. Variables de entorno
cp .env.example .env
# EDITAR: JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_MASTER_SECRET

# 3. Infra local
docker-compose up -d

# 4. Inicializar master DB
mysql -u root -psecret < sql/master.sql

# 5. Servidor
npm run dev

# 6. Worker (proceso separado)
npm run worker

# 7. Provisionar primer tenant
curl -X POST http://localhost:3000/api/internal/tenants/provision \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "demo",
    "plan": "pro",
    "region": "AR",
    "adminEmail": "admin@demo.vet",
    "adminPassword": "supersecret123"
  }'
```

---

## API completa

### Auth
```
POST   /api/v1/auth/login              { email, password, mfaCode? }
POST   /api/v1/auth/refresh            { refreshToken }
POST   /api/v1/auth/logout
POST   /api/v1/auth/logout-all         Invalida TODOS los tokens (token_version++)
POST   /api/v1/auth/change-password    { currentPassword, newPassword }
POST   /api/v1/auth/mfa/setup          → { secretBase32, otpauthUrl }
POST   /api/v1/auth/mfa/verify         { code }
DELETE /api/v1/auth/mfa                { code }
GET    /.well-known/jwks.json          JWKS pública para validación externa
```

### CRUD dinámico (JWT required)
```
GET    /api/v1/db/:table?limit=50&cursor=<b64>
GET    /api/v1/db/:table/:id
POST   /api/v1/db/:table
PATCH  /api/v1/db/:table/:id
DELETE /api/v1/db/:table/:id
```

### Internal (IP-restricted)
```
POST   /api/internal/tenants/provision
GET    /api/internal/tenants
PATCH  /api/internal/tenants/:id/status        { status }
PATCH  /api/internal/tenants/:id/plan          { plan }
POST   /api/internal/tenants/:id/users         { email, password, roles }
POST   /api/internal/support/impersonate       { tenantId, userId, reason }
PUT    /api/internal/tenants/:id/features/:key { enabled: bool }
POST   /api/internal/tenants/:id/dek-rotate    → enqueues rotation job
```

---

## Checklist para producción

- [ ] Cambiar `JWT_ALGORITHM=RS256` + generar RSA keypair
- [ ] Setear `KMS_KEY_ID` a un CMK en AWS KMS
- [ ] Setear `ENCRYPTION_MASTER_SECRET` (backup si KMS no disponible)
- [ ] Configurar `INTERNAL_API_IP_ALLOWLIST`
- [ ] `METRICS_PROTECT=true` + configurar bearer token para `/metrics`
- [ ] Configurar `S3_BUCKET` para archivos
- [ ] Conectar SES/SendGrid en `worker/index.ts` → `handleSendEmail`
- [ ] Conectar Twilio/SNS en `worker/index.ts` → `handleSendSms`
- [ ] Programar `dek-rotation` job periódico (recomendado: 90 días)
- [ ] Habilitar SSL en MySQL (`ssl: { rejectUnauthorized: true }`)
- [ ] Configurar backup automatizado de `tenant_data_keys`


## Auth: Multi-session refresh tokens
- Login returns `sessionId`.
- Refresh tokens are stored per session: `rt:{tenantId}:{userId}:{sessionId}`.
- Endpoints:
  - `GET /api/v1/auth/sessions`
  - `DELETE /api/v1/auth/sessions/:sessionId`
  - `POST /api/v1/auth/sessions/revoke-others`

## Internal API guard
- IP allowlist: `INTERNAL_API_IP_ALLOWLIST`
- Optional HMAC signature: set `INTERNAL_API_SHARED_SECRET` and send headers `x-internal-ts` and `x-internal-signature`.

## Notifications
- Email via AWS SES: set `SES_FROM_EMAIL`.
- SMS via AWS SNS: set `SNS_REGION` (optional) and `SNS_SENDER_ID` (optional).
