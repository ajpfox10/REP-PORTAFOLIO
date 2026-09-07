# Rollback

## Aplicación

1. Identificar el commit estable previo.
2. En el host de staging/producción:

```bash
git fetch origin
git checkout <commit-o-tag-estable>
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

3. Validar:

- `GET /health/live`
- `GET /health/ready`
- login
- refresh token
- lectura de pacientes
- facturación básica

## Base de datos

El runner `scripts/migrate.js` sigue siendo forward-only. No hay rollback automático por migración SQL.

Política recomendada:

1. Tomar backup antes de deploy.
2. Si la migración rompe compatibilidad:
   - detener tráfico de escritura,
   - restaurar backup en una instancia limpia,
   - re-point de app al restore,
   - volver a desplegar el commit estable.

## Qué no hacer

- No correr `git reset --hard` sobre producción sin tener claro el commit objetivo.
- No revertir a mitad de una migración manual.
- No restaurar sobre la misma DB sin snapshot previo.
