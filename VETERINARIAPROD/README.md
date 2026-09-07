# VetManager Pro

Plataforma veterinaria basada en microservicios para gestión clínica, pacientes, historia médica, facturación, notificaciones, telemedicina e IA.

## Componentes

- `gateway/`: entrypoint HTTP/WebSocket, seguridad, proxy y versionado.
- `services/auth/`: autenticación, sesiones, API keys, RBAC dinámico y administración.
- `services/patients/`: clientes, pacientes y sucursales.
- `services/medical/`: turnos, historias clínicas, diagnósticos y prescripciones.
- `services/billing/`: facturación, pagos, inventario y MercadoPago/Stripe.
- `services/notifications/`: bandeja interna, SMS, WhatsApp, FCM y cola de reintentos.
- `services/documents/`: cuentas de correo, bandeja de documentos entrantes y asociación manual a pacientes.
- `services/reports/`: KPIs, reportes exportables y programados.
- `services/ai/`: diagnóstico asistido, riesgo e imágenes con circuit breaker.
- `andromeda-front/`: frontend Vue.
- `shared/`: librerías comunes de seguridad, DB, JWT, auditoría y utilidades.

## Seguridad implementada

- Access y refresh token en cookies `httpOnly`.
- CSRF token separado.
- RBAC dinámico por organización.
- Audit trail de accesos y cambios de permisos.
- Device fingerprint habilitado por defecto en producción.
- Circuit breaker para IA y proxies.
- Cola persistente de reintentos para notificaciones.
- CodeQL, Trivy y threshold de cobertura en CI.

## Arranque local

```bash
npm install
node scripts/migrate.js
npm test
```

Servicios individuales:

```bash
node gateway/src/index.js
node services/auth/src/index.js
node services/notifications/src/index.js
node services/documents/src/index.js
```

Frontend:

```bash
cd andromeda-front
npm install
npm run dev
```

## Documentación operativa

- [Arquitectura](docs/architecture.md)
- [Runbook](docs/runbook.md)
- [Rollback](docs/rollback.md)
- [Backups y restore](docs/backup-restore.md)
- [Retencion y costo](docs/RETENTION_AND_COST_POLICY.txt)
- [Secrets management](docs/SECRETS_MANAGEMENT_BASELINE.txt)
- [Chaos scenarios](docs/CHAOS_SCENARIOS_MATRIX.txt)

## Estado

Los cambios recientes quedaron registrados en [CHANGELOG.md](CHANGELOG.md).
