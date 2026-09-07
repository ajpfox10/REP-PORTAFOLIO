# Archivo Pasivo Dev

Proyecto monolitico inicial para un sistema web administrativo.

- Backend: Node, Express, TypeScript y MySQL.
- Frontend: React, Vite y TypeScript.
- Seguridad: JWT access/refresh, refresh tokens en DB, RBAC por permisos, auditoria, rate limit, bloqueo de login, CORS cerrado y 2FA opcional por entorno.
- Deploy previsto: PM2, sin Docker.

## Primer arranque

1. Copiar `.env.example` a `.env`.
2. Completar `DB_USER`, `DB_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` y `ADMIN_PASSWORD`.
3. Ejecutar `npm install`.
4. Ejecutar `npm run db:migrate`.
5. Ejecutar `npm run db:seed-admin`.
6. Ejecutar `npm run dev`.

Las contrasenas reales y secretos no deben quedar en codigo fuente.
