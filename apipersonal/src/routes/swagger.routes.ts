// src/routes/swagger.routes.ts
import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { env } from "../config/env";
import { logger } from "../logging/logger";

export function buildSwaggerRouter() {
  const router = Router();

  // GET /docs/ui - Swagger UI embebido
  router.get('/ui', async (req: Request, res: Response) => {
    try {
      // 1. Obtener la ruta del spec OpenAPI
      const specPath = env.ENABLE_OPENAPI_VALIDATION && env.OPENAPI_AUTO_GENERATE
        ? env.OPENAPI_AUTO_OUTPUT
        : env.OPENAPI_PATH;
      
      const absPath = path.resolve(process.cwd(), specPath);
      
      if (!fs.existsSync(absPath)) {
        return res.status(404).send('OpenAPI spec no encontrado. Ejecutá npm run openapi:export');
      }

      // 2. Determinar si es YAML o JSON
      const isYaml = absPath.endsWith('.yaml') || absPath.endsWith('.yml');
      const specUrl = `/docs/openapi.${isYaml ? 'yaml' : 'json'}`;

      // 3. HTML de Swagger UI
      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PersonalV5 API - Documentación</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background: #0b1020; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .scheme-container { background: rgba(255,255,255,0.02); }
    .swagger-ui .info .title { color: white; }
    .swagger-ui .info .title small { background: #7c3aed; }
    .swagger-ui .opblock-tag-section { background: rgba(255,255,255,0.02); }
    .swagger-ui .opblock { background: rgba(255,255,255,0.05); }
    .swagger-ui .opblock .opblock-summary-path { color: #22d3ee; }
    .swagger-ui .btn { background: rgba(124,58,237,0.2); border-color: #7c3aed; color: white; }
    .swagger-ui .btn:hover { background: rgba(124,58,237,0.3); }
    .swagger-ui .response-col_status { color: #22d3ee; }
    .swagger-ui table tbody tr td { color: rgba(255,255,255,0.8); }
    .swagger-ui .markdown code { background: rgba(0,0,0,0.3); color: #22d3ee; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "BaseLayout",
        docExpansion: 'list',
        defaultModelsExpandDepth: -1,
        filter: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        tryItOutEnabled: true,
        syntaxHighlight: { theme: "monokai" }
      });
    };
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      logger.error({ msg: 'Error serving Swagger UI', err });
      res.status(500).send('Error al cargar Swagger UI');
    }
  });

  // GET /docs/swagger.json - Redirigir a openapi.json
  router.get('/swagger.json', (req, res) => {
    res.redirect('/docs/openapi.json');
  });

  // GET /docs/swagger.yaml - Redirigir a openapi.yaml
  router.get('/swagger.yaml', (req, res) => {
    res.redirect('/docs/openapi.yaml');
  });

  return router;
}