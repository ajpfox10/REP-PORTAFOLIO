/// <reference types="vite/client" />

/**
 * Tipos de las VITE_* del .env.
 *
 * Sin este archivo `import.meta.env` no existe para TypeScript y `tsc --noEmit`
 * falla, aunque el bundle de Vite compile igual (esbuild no hace typecheck).
 *
 * OJO: Vite sólo reemplaza `import.meta.env.VITE_X` escrito de forma ESTÁTICA.
 * Un acceso dinámico (`import.meta.env[key]`) queda undefined en el build de
 * producción — por eso la configuración real viaja en runtime-config.json y
 * estas variables son sólo el fallback de desarrollo.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AUTH_STORAGE?: string;
  readonly VITE_AUTH_PERSIST?: string;
  readonly VITE_AUTH_PERSIST_KIND?: string;
  readonly VITE_SCANNER_API_URL?: string;
  readonly VITE_SCANNER_TENANT_ID?: string;
  readonly VITE_SCANNER_TOKEN?: string;
  readonly VITE_SCAN_BYPASS_CODE?: string;
  readonly VITE_KIOSK_HOSTNAMES?: string;
  readonly VITE_KIOSK_IPS?: string;
  readonly VITE_JUB_WINDOW_DAY_START?: string;
  readonly VITE_JUB_WINDOW_DAY_END?: string;
}
