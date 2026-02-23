# PersonalV5 API

API REST para gestión de personal hospitalario y documentos digitales.  
Node.js · Express · TypeScript · MySQL · Sequelize · JWT

---

## Para el administrador del sistema (sin conocimientos técnicos)

### ¿Qué es esta API?

Imaginate una telefonista muy inteligente que se para entre el programa de gestión de personal (lo que ven los usuarios) y la base de datos (donde se guardan todos los datos). Todo lo que el programa quiere saber o guardar, lo pide a través de esta "telefonista" (la API). Ella se encarga de:

- Verificar que quien pregunta tiene permiso de preguntar
- Guardar un registro de quién preguntó qué y cuándo
- Responder de forma ordenada con la información pedida
- Evitar que personas no autorizadas accedan a datos sensibles

### ¿Por qué los documentos no se abren?

Los documentos están en `D:\G\DOCUMENTOS Y VARIOS\`.  
Asegurate de que en el archivo `.env` esté configurado: `DOCUMENTS_BASE_DIR=D:\G\DOCUMENTOS Y VARIOS`

Si un documento muestra "archivo no encontrado", puede ser que:
1. El archivo fue registrado en el sistema viejo y nunca se subió al nuevo servidor
2. El archivo fue movido o eliminado del disco

Para ver qué documentos tienen problemas: **npm run arranque → opción 18**

### ¿Cómo instalar por primera vez?

1. Instalar [Node.js 18+](https://nodejs.org) y [MySQL 8+](https://dev.mysql.com/downloads/)
2. Copiar `.env.example` a `.env` y completar las contraseñas
3. Abrir una terminal en la carpeta del proyecto
4. Ejecutar: `npm install`
5. Ejecutar: `npm run arranque` → opción **12** (Instalar base de datos)
6. Ejecutar: `npm run arranque` → opción **13** (Crear usuario admin)
7. Ejecutar: `npm run arranque` → opción **1** (Iniciar en modo desarrollo)

---

## Para desarrolladores

### Arquitectura

La API usa un patrón de **núcleo + dominio intercambiable**. Esto significa que toda la infraestructura (autenticación, seguridad, logs, caché, métricas) está separada de la lógica de negocio. Si mañana querés usar el mismo sistema para una veterinaria, solo tenés que crear un nuevo "dominio" sin tocar nada del núcleo.

```
src/
├── core/
│   └── plugin.ts              → Interface base para plugins y dominios
├── gateways/
│   └── apiGateway.ts          → Punto central de montaje de rutas (API Gateway pattern)
├── domains/
│   ├── personalv5/            → DOMINIO ACTIVO: gestión de personal hospitalario
│   │   ├── domain.ts          → Registro del dominio y sus rutas
│   │   ├── services/          → Lógica de negocio PURA (sin Express, testeable)
│   │   │   ├── auth.service.ts       → Login, refresh, registro
│   │   │   ├── document.service.ts   → Resolución de rutas, búsqueda de archivos
│   │   │   └── agente.service.ts     → Alta atómica de agentes
│   │   └── controllers/       → Handlers HTTP: validan input, llaman services
│   │       ├── document.controller.ts
│   │       └── agente.controller.ts
│   └── veterinaria/           → EJEMPLO: cómo crear un nuevo dominio
│       ├── domain.ts
│       ├── services/paciente.service.ts
│       └── controllers/paciente.controller.ts
├── infra/
│   ├── cache.ts               → Caché Redis con tags
│   └── invalidateOnWrite.ts   → Patrón Invalidate-on-Write
├── middlewares/               → Seguridad, auth, rate limiting, audit
├── routes/                    → Rutas legacy (se mantienen por compatibilidad)
├── auth/                      → JWT, bcrypt, permisos, refresh tokens
├── db/                        → Sequelize, migraciones, introspección de esquema
└── webhooks/                  → Sistema de webhooks con cola y reintentos
```

### Patrón Route → Controller → Service

Cada petición HTTP sigue este camino:

```
HTTP Request
    ↓
routes/*.ts          → Define la URL y los middlewares
    ↓
controllers/*.ts     → Valida input (Zod), llama al service, devuelve respuesta HTTP
    ↓
services/*.ts        → Lógica de negocio pura (sin Express, testeable sin HTTP)
    ↓
Base de datos (Sequelize o raw SQL)
```

**¿Por qué esta separación?**

- Los **services** son testeables sin levantar el servidor
- Los **controllers** son delgados: solo traducen HTTP ↔ dominio
- Si cambiás de Express a Fastify, los services no cambian

### Invalidate-on-Write (Invalidar al Escribir)

El caché se invalida automáticamente cuando se modifica un recurso:

```typescript
// En AgenteService.alta():
await invalidate([...personalTags.all(dto.dni), ...agenteTags.all(dto.dni)], 'agente.alta');

// Tags que se invalidan:
// - personal:{dni}    → datos de ese agente
// - personal:list     → listado de personal  
// - agentes:{dni}     → datos laborales del agente
// - agentes:list      → listado de agentes
```

Para agregar invalidación a un nuevo servicio:

```typescript
import { invalidate } from '../../../infra/invalidateOnWrite';

async function update(id: number, data: any) {
  await sequelize.query('UPDATE tabla SET ...', { replacements: { id, ...data } });
  // Después de cada escritura exitosa, invalidar los tags relacionados:
  await invalidate([`mitabla:${id}`, 'mitabla:list'], 'miservicio.update');
}
```

### API Gateway Pattern

Todo pasa por `src/gateways/apiGateway.ts`. Es el único lugar donde se registran rutas. Ventajas:

- Un solo lugar para ver todas las rutas disponibles
- Fácil agregar middleware global (logging, rate limiting, auth)
- Versionado centralizado: cambiar de `/api/v1` a `/api/v2` en un solo lugar

### Crear un nuevo dominio

**Paso a paso para adaptar la API a otro propósito (ej: veterinaria):**

```bash
# 1. Copiar el dominio personalv5 como plantilla
cp -r src/domains/personalv5 src/domains/veterinaria

# 2. Borrar los servicios/controllers específicos de personal
rm src/domains/veterinaria/services/agente.service.ts
rm src/domains/veterinaria/controllers/agente.controller.ts

# 3. Crear tus propios servicios y controllers
# (ver src/domains/veterinaria/ como ejemplo ya implementado)

# 4. Editar src/domains/veterinaria/domain.ts con tus rutas

# 5. En src/server.ts, cambiar el dominio activo:
```

```typescript
// src/server.ts - cambiar estas líneas:
import { VeterinariaDomail } from './domains/veterinaria/domain';
pluginRegistry.setDomain(new VeterinariaDomail());
```

```bash
# 6. En .env:
DOMAIN=veterinaria
```

**Lo que NO cambia** al cambiar de dominio:
- Autenticación JWT y refresh tokens
- Sistema de roles y permisos (RBAC)
- Rate limiting y protección contra ataques
- Audit log (quién hizo qué y cuándo)
- Caché Redis con invalidación por tags
- Métricas Prometheus
- Health checks
- Webhooks con firma HMAC
- Documentación OpenAPI automática
- CRUD dinámico para todas las tablas
- Socket.IO para tiempo real
- Sistema de archivos con seguridad anti path-traversal

**Lo que SÍ cambia** (lógica de negocio del dominio):
- Services: reglas de negocio específicas
- Controllers: validaciones de input
- Rutas específicas del dominio

### Fix: resolución de rutas de documentos

El sistema resuelve automáticamente rutas Windows absolutas almacenadas en la BD.  
Ver `src/domains/personalv5/services/document.service.ts` → `tryResolvePath()`.

Estrategia de resolución:
1. Ruta es número puro → documento legacy sin archivo
2. Ruta empieza con `DOCUMENTS_BASE_DIR` → quitar el prefijo y usar como relativa
3. Ruta es relativa (`2025/archivo.pdf`) → unir con `DOCUMENTS_BASE_DIR`
4. Si falla → buscar por nombre de archivo en todo el árbol de directorios

### Variables de entorno principales

```env
# Base de datos
DB_HOST=127.0.0.1
DB_NAME=personalv5
DB_USER=root
DB_PASSWORD=<tu_password>

# Documentos (directorio raíz donde están los archivos)
DOCUMENTS_BASE_DIR=D:\G\DOCUMENTOS Y VARIOS

# Dominio activo
DOMAIN=personalv5

# JWT
JWT_ACCESS_SECRET=<secreto_seguro>
JWT_REFRESH_SECRET=<otro_secreto>

# Email (para notificaciones y registro de usuarios)
EMAIL_ENABLE=true
EMAIL_HOST=smtp.gmail.com
EMAIL_USER=tu@email.com
EMAIL_PASSWORD=<app_password>
ADMIN_EMAIL=admin@ejemplo.com
```

### Scripts disponibles

```bash
npm run arranque     # Wizard interactivo (recomendado para todo)
npm run dev          # Servidor en modo desarrollo con hot-reload
npm run build        # Compilar TypeScript → dist/
npm run start        # Servidor en modo producción
npm run test         # Tests unitarios
npm run lint         # Análisis de código
npm run scanner      # Servidor de escáner en puerto 3001
```

### Endpoints principales

| Método | URL | Descripción |
|--------|-----|-------------|
| POST | `/api/v1/auth/login` | Login → tokens JWT |
| POST | `/api/v1/auth/refresh` | Renovar access token |
| POST | `/api/v1/auth/logout` | Cerrar sesión |
| POST | `/api/v1/auth/request-access` | Solicitar cuenta nueva |
| GET  | `/api/v1/documents` | Listar documentos |
| GET  | `/api/v1/documents/:id/file` | Descargar archivo |
| POST | `/api/v1/documents/upload` | Subir documento |
| GET  | `/api/v1/agentes-v2/alta` | Alta atómica de agente |
| GET  | `/api/v1/personal` | Listar personal (CRUD dinámico) |
| GET  | `/api/v1/:tabla` | CRUD dinámico para cualquier tabla |
| GET  | `/health` | Estado del servidor |
| GET  | `/ready` | Servidor listo para recibir tráfico |
| GET  | `/docs` | Documentación Swagger (requiere login) |

### Requisitos del sistema

- Node.js 18 o superior
- MySQL 8.0 o superior
- Redis (opcional, para caché distribuido y rate limiting)
- ImageMagick (opcional, para scanner de documentos)
- Antivirus ClamAV (opcional, para escaneo de archivos subidos)

---

*Generado automáticamente · PersonalV5 Enterprise API*
