# Changelog

## 2026-04-30

- Endurecimiento de autenticación: access token también en cookie `httpOnly`, eliminación de persistencia en `localStorage`.
- RBAC dinámico aplicado en middleware y UI admin para cambios de rol y overrides.
- Auditoría de cambios de permisos con migración dedicada.
- Read replica y retry de warm-up en capa DB.
- Device fingerprint activo por defecto en producción.
- Health checks `live` y `ready`.
- Cobertura mínima obligatoria en Jest.
- CI con CodeQL, Trivy y deploy de staging por SSH.
- Circuit breaker en `shared/ai`.
- Cola persistente de reintentos para notificaciones.
- README raíz, arquitectura, runbook, rollback y backup/restore documentados.
