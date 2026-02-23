/**
 * @file domains/_template/domain.ts
 *
 * ─── PLANTILLA PARA NUEVO DOMINIO ─────────────────────────────────────────
 *
 * Cómo crear un dominio nuevo (ej: veterinaria):
 *
 *   1. Copiar esta carpeta:
 *      cp -r src/domains/_template src/domains/veterinaria
 *
 *   2. Editar src/domains/veterinaria/domain.ts:
 *      - Cambiar name, description, mainTables
 *      - Agregar las rutas del nuevo dominio en mount()
 *
 *   3. Crear tus propias rutas/controllers/services/schemas
 *      siguiendo el patrón de personalv5/
 *
 *   4. En src/gateways/apiGateway.ts (o src/routes/index.ts),
 *      cambiar el import del dominio:
 *      - import { PersonalV5Domain } from '../domains/personalv5/domain';
 *      + import { VeterinariaDoamin } from '../domains/veterinaria/domain';
 *
 *   5. ¡Listo! El kernel, auth, cache, metrics, webhooks siguen funcionando.
 *      Solo cambiaste el "qué hace" el negocio, no la infraestructura.
 *
 * ─── QUÉ NO TOCAR ─────────────────────────────────────────────────────────
 * src/core/          ← núcleo genérico
 * src/auth/          ← autenticación y permisos
 * src/middlewares/   ← todos los middlewares
 * src/infra/         ← Redis, cache
 * src/logging/       ← logs
 * src/metrics/       ← Prometheus
 * src/webhooks/      ← webhooks
 * src/db/            ← conexión DB, introspección
 * src/config/        ← variables de entorno
 * scripts/           ← arranque, backup, etc.
 */

import type { Domain, PluginContext } from '../../core/plugin';

// ─── CAMBIAR ESTOS VALORES ─────────────────────────────────────────────────
const DOMAIN_NAME        = 'mi-nuevo-dominio';   // sin espacios, en minúsculas
const DOMAIN_DESCRIPTION = 'Descripción breve del sistema';
const MAIN_TABLES        = ['tabla1', 'tabla2']; // tablas principales

// ─── CAMBIAR ESTAS RUTAS ───────────────────────────────────────────────────
// Importar los routers del nuevo dominio acá:
// import { buildMiRecursoRoutes } from './routes/mi-recurso.routes';

export const TemplateDomain: Domain = {
  name:        DOMAIN_NAME,
  description: DOMAIN_DESCRIPTION,
  mainTables:  MAIN_TABLES,

  async mount({ app, sequelize, schema, apiPrefix }: PluginContext): Promise<void> {
    // Agregar las rutas del dominio acá:
    // app.use(`${apiPrefix}/mi-recurso`, buildMiRecursoRoutes(sequelize));

    // Para usar el CRUD dinámico (cubre TODAS las tablas del schema):
    // const { buildCrudRouter } = await import('../../routes/crud.routes');
    // app.use(apiPrefix, buildCrudRouter(sequelize, schema));

    console.log(`[${DOMAIN_NAME}] domain mounted at ${apiPrefix}`);
  },
};
