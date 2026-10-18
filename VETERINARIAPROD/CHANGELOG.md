# Changelog

## 2026-10-18

- `package-lock.json` sincronizado: `npm ci` y los builds de Docker vuelven a funcionar.
- Dependencias actualizadas por seguridad: argon2 0.45, nodemailer 10, uuid 11, Jest 30, Vite 6, axios y overrides de protobufjs y fast-uri.
- Suite de tests en verde (565 tests unitarios, de seguridad y de contrato); se reemplazó `yamljs`, que estaba abandonado, por `js-yaml`.
- Corrección en service discovery: la lista de hosts permitidos para health checks no aceptaba IPs privadas ni nombres de servicio de Docker/Kubernetes.
- Telemedicina: se corrigió un error que impedía mostrar el aviso cuando falla el cambio de estado, y se reemplazaron los `alert()` nativos por notificaciones de la app.
- Textos con codificación rota corregidos (notificaciones push, OpenAPI y vacunas) y BOM eliminado de los archivos del frontend.
- README principal y del frontend reescritos; documentación y scripts sueltos de la raíz movidos a `docs/` y `scripts/`.

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
