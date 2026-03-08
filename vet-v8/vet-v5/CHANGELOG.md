# Changelog — VetPro SaaS Platform

## [5.0.0] — 2026-03-04

### Sistema de Módulos por Suscripción
Cada módulo está protegido por `requireModule(key)` que combina:
1. Feature flag override por tenant (DB + Redis cache)
2. Plan-tier: basic < pro < enterprise < custom

| Módulo              | Plan min   |
|---------------------|------------|
| turnos              | basic      |
| propietarios        | basic      |
| vacunas             | basic      |
| pacientes           | basic      |
| consultas/prescripciones | basic |
| veterinarios        | basic      |
| inventario/ventas   | basic      |
| internaciones       | pro        |
| multi_sucursal      | pro        |
| facturacion         | pro        |
| dashboard_metricas  | pro        |
| portal_propietario  | pro        |
| export_pdf          | pro        |
| whatsapp            | enterprise |
| afip_facturacion    | enterprise |
| api_webhooks        | enterprise |

### Módulos nuevos
- **Turnos CRUD** — conflicto de horarios, máquina de estados, agenda del día
- **Propietarios** — CRUD + búsqueda full-text + mascotas anidadas
- **Vacunas + Desparasitaciones** — cartilla completa + recordatorios próximos
- **Prescripciones** — solo vets pueden prescribir
- **Internaciones** — ingreso, alta, fallecido
- **Sucursales + Veterinarios** — gestión completa de staff y sedes
- **Facturación** — A/B/C/X/presupuesto + IVA automático + hook AFIP (enterprise)
- **Dashboard** — KPIs con cache Redis 5min
- **Portal Propietario** — JWT separado, dueños ven SUS mascotas y turnos
- **PDF Export** — historia clínica + cartilla de vacunación (PDFKit, sin Chrome)
- **WhatsApp Business** — recordatorios via templates + inbound webhook (Meta Cloud API v20)

### Seguridad
- **Forgot-password** completo — token Redis TTL 15min, no enumera emails, invalida después de uso
- **validateEnv** — falla en startup si JWT/DB/encryption tienen valores inseguros

### Infraestructura
- **Scheduler** — BullMQ repeatable jobs cluster-safe (vacunas 08hs, turnos 18hs, outbox 5min)
- **Dockerfile multi-stage** — Alpine, usuario no-root, dumb-init, HEALTHCHECK
- **docker-compose** — MySQL 8.4 + Redis 7 + BullBoard con healthchecks completos
- **Migration 0004** — soft-delete en consultas/vacunas, portal_invite_tokens, webhook tables

### Tests
- 20 tests unitarios: planGuard, validateEnv, conflicto de turnos, máquina de estados

### Fixes (bugs de v4)
- salesRouter: race condition de stock → transacción + FOR UPDATE
- salesRouter: IDs inseguros → nanoid()
- salesRouter: no descuentaba stock en productos
- facturacionRouter: variable `body` fuera de scope en /emitir

## [4.0.0] — 2026-03-04
_(8 bugs críticos resueltos — ver CHANGELOG completo en docs/)_
