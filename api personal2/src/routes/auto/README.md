# Auto Routes (DX)

Objetivo: agregar rutas sin tocar `src/routes/index.ts`.

## Cómo crear una ruta nueva
1) Crear un archivo en `src/routes/auto/` (o subcarpetas) que termine en `.routes.ts`
2) Exportar:
- `basePath: string`
- `buildRouter(ctx): Router`

Ejemplo:

```ts
import { Router } from "express";

export const basePath = "/api/v1/foo";

export function buildRouter({ sequelize, schema, env }) {
  const r = Router();
  r.get("/", (req, res) => res.json({ ok: true }));
  return r;
}
```

## Importante
- Los endpoints existentes NO se modifican.
- El manifest `auto.manifest.ts` se genera automáticamente con `npm run gen:routes`.
