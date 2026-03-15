# 🐾 Ejemplo: Dominio Veterinaria

Estructura mínima para un nuevo dominio usando el mismo kernel de PersonalV5.

```
src/domains/veterinaria/
├── domain.ts                ← Registro del dominio (tablas, rutas)
├── schemas/
│   ├── paciente.schema.ts   ← Zod: validar datos de pacientes
│   └── consulta.schema.ts   ← Zod: validar datos de consultas
├── services/
│   ├── paciente.service.ts  ← Lógica de negocio (sin Express)
│   └── consulta.service.ts
├── controllers/
│   ├── paciente.controller.ts  ← Valida input → llama service → responde
│   └── consulta.controller.ts
└── routes/
    ├── paciente.routes.ts   ← Solo define endpoints
    └── consulta.routes.ts
```

## Tablas de ejemplo (veterinaria)

```sql
CREATE TABLE propietarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(30),
  email VARCHAR(200)
);

CREATE TABLE pacientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  propietario_id INT REFERENCES propietarios(id),
  nombre VARCHAR(100) NOT NULL,
  especie VARCHAR(50),  -- 'perro', 'gato', etc.
  raza VARCHAR(100),
  fecha_nacimiento DATE
);

CREATE TABLE consultas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paciente_id INT REFERENCES pacientes(id),
  veterinario VARCHAR(100),
  fecha DATETIME NOT NULL,
  diagnostico TEXT,
  tratamiento TEXT
);
```

## Para activar el dominio veterinaria

En `src/routes/index.ts` (o en `src/gateways/apiGateway.ts`):

```typescript
// Antes (personal):
import { PersonalV5Domain } from '../domains/personalv5/domain';

// Después (veterinaria):
import { VeterinariaDoamin } from '../domains/veterinaria/domain';

// Y en mountRoutes:
await mountGateway({ ..., domain: VeterinariaDoamin });
```

## Lo que hereda GRATIS del kernel

- ✅ JWT + Refresh tokens + 2FA
- ✅ RBAC (roles y permisos)
- ✅ Audit log automático
- ✅ Rate limiting
- ✅ Cache Redis con invalidate-on-write
- ✅ Webhooks con firma HMAC
- ✅ Métricas Prometheus
- ✅ Logs estructurados
- ✅ Health checks
- ✅ Swagger/OpenAPI
- ✅ CRUD dinámico para cualquier tabla
- ✅ Schema introspection
- ✅ Migración SQL automática
