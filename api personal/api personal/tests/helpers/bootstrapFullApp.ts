import { createSequelize } from "../../src/db/sequelize";
import { schemaBootstrap } from "../../src/bootstrap/schemaBootstrap";
import { buildModels } from "../../src/db/dynamic/modelFactory";
import { createApp } from "../../src/app";
import { mountRoutes } from "../../src/routes";
import { runMigrations } from "../../src/db/migrations/runMigrations";
import { auditAllApi } from "../../src/middlewares/auditAllApi";

import type { Sequelize } from "sequelize";
import type { Express } from "express";
import type { SchemaSnapshot } from "../../src/db/schema/types";
import type { Model } from "sequelize";

export async function bootstrapFullApp(openapiPath?: string): Promise<{
  app: Express;
  sequelize: Sequelize;
  schema: SchemaSnapshot;
  models: Record<string, typeof Model>;
}> {
  const sequelize = createSequelize();
  await sequelize.authenticate();

  await runMigrations(sequelize);
  const schema = await schemaBootstrap(sequelize);
  const models = buildModels(sequelize, schema);

  // 👇 AÑADIR PERMISO API:ACCESS PARA EL USUARIO DEV (ID=1)
  try {
    await sequelize.query(`
      INSERT IGNORE INTO permisos (clave, descripcion)
      VALUES ('api:access', 'Acceso a API');
    `);

    const [permisoRows] = await sequelize.query(
      `SELECT id FROM permisos WHERE clave = 'api:access' LIMIT 1`
    );
    const permisoId = (permisoRows as any[])[0]?.id;

    if (permisoId) {
      // Asignar a rol admin (asumiendo que existe)
      await sequelize.query(`
        INSERT IGNORE INTO roles_permisos (rol_id, permiso_id)
        SELECT id, ${permisoId} FROM roles WHERE nombre = 'admin'
      `);
    }
  } catch (error) {
    console.warn("⚠️ No se pudieron asignar permisos:", error);
  }

  // ✅ IMPORTANTE:
  // createApp() agrega el 404 *después* del callback mount.
  // Si montás rutas después de createApp(), quedan debajo del 404 y todo da 404.
  const app = createApp(openapiPath, (appInstance) => {
    appInstance.use(auditAllApi(sequelize));
    mountRoutes(appInstance, sequelize, schema);
  });

  return { app, sequelize, schema, models };
}
