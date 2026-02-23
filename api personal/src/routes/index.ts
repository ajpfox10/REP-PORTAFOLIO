/**
 * @file routes/index.ts
 * @description Stub de compatibilidad. El montaje real de rutas esta en
 * src/gateways/apiGateway.ts (llamado desde server.ts).
 *
 * ARQUITECTURA NUEVA:
 *   server.ts  →  mountApiGateway(app, { sequelize, schema })
 *                 (en src/gateways/apiGateway.ts)
 *
 * Este archivo solo existe para no romper imports legacy.
 */
