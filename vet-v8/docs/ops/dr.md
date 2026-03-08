# Disaster Recovery (DR) - Day 1

## Objetivo
Poder recuperar:
- Master DB (tenant registry, billing, keys)
- Tenant DBs (DB por veterinaria)
- Redis (cache; se puede reconstruir)

## Backups (AWS RDS)
- Activar backups automáticos (retention >= 14 días).
- Activar snapshots manuales antes de cambios críticos.
- Para tenants: si están en una sola instancia con varias DB, el snapshot cubre todas.
- Si un tenant migra a RDS dedicado, sigue el mismo esquema.

## Restore verificado (runbook)
1. Restaurar snapshot a una instancia nueva.
2. Correr checks:
   - conexión
   - queries esenciales en master: `tenants`, `tenant_data_keys`
   - para un tenant: `users`, `pacientes`, `mascotas`
3. Re-apuntar la API (env vars) temporalmente a la instancia restaurada.
4. Ejecutar smoke tests (`/health`, `/api/v1/me`, login + refresh + CRUD).

## Game day
Frecuencia recomendada: mensual.
- Simular pérdida de master.
- Simular corrupción de un tenant.
- Medir RTO/RPO y ajustar.
