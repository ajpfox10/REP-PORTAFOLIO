# Scanner API v3

API independiente de escaneo documental con integración al backend `api_personal`.

## Stack

| Componente | Tecnología |
|-----------|-----------|
| API        | Express 4 + TypeScript |
| Worker     | BullMQ (Redis) |
| OCR        | tesseract.js (puro JS, sin binarios) |
| AI         | Keyword classifier + OpenAI opcional |
| Storage    | Local filesystem / S3 / MinIO |
| DB         | MySQL 8 |
| Antivirus  | ClamAV (opcional, opt-in) |

## Puerto

**3001** (diferente al `api_personal` que usa 3000)

## Inicio rápido

```bash
cp .env.example .env
# editar .env con tus valores

# Docker (recomendado)
docker compose up -d

# O local
cd api && npm install && npm run dev
cd worker && npm install && npm run dev
```

## Endpoints principales

### Auth
```
POST /v1/auth/login           → { access_token, role, tenant_id }
POST /v1/auth/logout
POST /v1/auth/change-password
```

### Dispositivos
```
GET  /v1/devices
POST /v1/devices              → { id }
```

### Perfiles de escaneo
```
GET    /v1/profiles
POST   /v1/profiles
PUT    /v1/profiles/:id
DELETE /v1/profiles/:id
```

### Jobs de escaneo
```
GET  /v1/scan-jobs            ?status=queued&personal_dni=12345678
POST /v1/scan-jobs            → { id, upload_nonce, pending_tramites }
GET  /v1/scan-jobs/:id
POST /v1/scan-jobs/:id/cancel
POST /v1/scan-jobs/:id/upload  (agent only, x-device-key)
```

### Documentos
```
GET    /v1/documents          ?personal_dni=&doc_class=&scan_job_id=
GET    /v1/documents/search   ?q=texto
GET    /v1/documents/:id
GET    /v1/documents/:id/ocr
GET    /v1/documents/files/:key
PATCH  /v1/documents/:id      { title, personal_ref }
DELETE /v1/documents/:id      (soft delete)
```

### Agent (x-device-key, sin JWT)
```
GET  /v1/agent/poll      → próximo job pendiente
POST /v1/agent/heartbeat
POST /v1/agent/fail      { job_id, error_message }
```

### Integración api_personal (admin only)
```
GET  /v1/integration
PUT  /v1/integration     { base_url, api_key }
POST /v1/integration/test
```

### Webhooks
```
GET    /v1/webhooks
POST   /v1/webhooks      { url, events, secret? }
PATCH  /v1/webhooks/:id
DELETE /v1/webhooks/:id
GET    /v1/webhooks/:id/deliveries
```

## Integración con api_personal

### 1. Configurar la integración
```bash
curl -X PUT http://localhost:3001/v1/integration \
  -H "Authorization: Bearer <token>" \
  -H "x-tenant: 1" \
  -d '{"base_url":"http://localhost:3000","api_key":"tu-api-key"}'
```

### 2. Crear un job vinculado a un DNI
```bash
curl -X POST http://localhost:3001/v1/scan-jobs \
  -H "Authorization: Bearer <token>" \
  -H "x-tenant: 1" \
  -d '{
    "device_id": 1,
    "personal_dni": 12345678,
    "personal_ref": "pedido:45"
  }'
# Respuesta incluye pending_tramites del agente (trámites pendientes del DNI)
```

### 3. Recibir notificación en api_personal
El scanner notifica automáticamente vía:
```
POST /api/v1/scanner/document-ready
{
  "scanner_document_id": 5,
  "scanner_job_id": 3,
  "personal_dni": 12345678,
  "personal_ref": "pedido:45",
  "doc_class": "resolution",
  "page_count": 3,
  "storage_key": "t1/j3/uuid.pdf",
  "ocr_summary": "primeros 500 chars del OCR..."
}
```

## Flujo completo

```
Usuario crea job (POST /v1/scan-jobs)
    → Agent hace poll (GET /v1/agent/poll)
    → Agent escanea (WIA / TWAIN / virtual)
    → Agent sube páginas (POST /v1/scan-jobs/:id/upload)
    → Worker finaliza (scan_queue)
        → Crea documento en DB
        → Encola OCR (ocr_queue)
    → Worker OCR (tesseract.js)
        → Extrae texto
        → Encola AI (ai_queue)
    → Worker AI
        → Clasifica (keyword / OpenAI)
        → Extrae entidades
        → Notifica api_personal (si hay personal_dni)
        → Encola indexación (index_queue)
    → Worker index
        → Actualiza search_text para FULLTEXT
    → Webhooks emitidos en cada etapa
```

## Drivers de escaneo (agent)

| Driver   | Descripción |
|----------|-------------|
| virtual  | Genera páginas sintéticas (dev/test) |
| wia      | Windows Image Acquisition (requiere Windows + PowerShell) |
| twain    | Requiere node-twain (no incluido) |

## Variables de entorno relevantes

```
PORT=3001
OCR_PROVIDER=tesseract    # tesseract | none
AI_PROVIDER=none          # none | openai
OPENAI_API_KEY=sk-...     # solo si AI_PROVIDER=openai
CLAMAV_ENABLED=false      # true activa antivirus
AUTO_MIGRATE=true         # migra al iniciar
SCAN_DRIVER=virtual       # en el agent: virtual | wia | twain
```
