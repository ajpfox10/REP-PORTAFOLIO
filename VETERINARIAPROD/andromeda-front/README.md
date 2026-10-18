# Andromeda: frontend

Aplicación web de Andromeda, construida con Vue 3, Vite, Pinia y Vue Router.

## Estructura

```
src/
├── api/           clientes HTTP (axios) con manejo de CSRF y refresh de sesión
├── components/    componentes reutilizables (base/, evolutions/)
├── composables/   lógica de cada dominio (pacientes, facturación, internación...)
├── i18n/          textos en es-AR y en-US
├── layouts/       layout principal con navegación por permisos
├── router/        rutas y guards de autenticación, rol y permiso
├── stores/        estado global (sesión, feedback de UI)
├── utils/         manejo de errores y helpers
└── views/         una vista por módulo
```

## Desarrollo

```bash
npm ci
npm run dev        # http://localhost:5173, con proxy de /api/v1 hacia el gateway
```

Variables de entorno (opcionales):

| Variable | Uso |
|---|---|
| `VITE_API_URL` | URL del gateway. Por defecto `/api/v1` en el mismo origen |
| `VITE_CAPTCHA_ENABLED` / `VITE_HCAPTCHA_SITE_KEY` | Captcha en el login |
| `VITE_PREVIEW_AUTH` | Solo en desarrollo: `true` entra con una sesión de demostración sin backend |

## Scripts

```bash
npm run build      # build de producción (con Subresource Integrity)
npm run preview    # servir el build localmente
npm run typecheck  # chequeo de tipos
npm run e2e        # tests end-to-end con Playwright
```

## Seguridad en el cliente

- La sesión vive en cookies `httpOnly`: el token nunca se guarda en `localStorage`.
- Cada request que modifica datos envía un token CSRF, que se renueva solo si expira.
- Los guards del router validan autenticación, roles y permisos antes de entrar a cada vista.
- El build agrega hashes SRI a scripts y estilos.
