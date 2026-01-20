// src/api/env.ts
type RuntimeConfig = Record<string, any>;

let loaded = false;

function runtime(): RuntimeConfig {
  return (window as any).__RUNTIME_CONFIG__ || {};
}

export async function loadRuntimeConfig() {
  // si ya está cargado desde main.tsx, no hacemos nada
  loaded = true;
  return;
}

function fromVite(key: string): string | undefined {
  // Vite expone import.meta.env en runtime del bundle (no en consola del browser)
  // Acá lo usamos normalmente.
  // @ts-ignore
  const v = import.meta?.env?.[key];
  return typeof v === 'string' ? v : undefined;
}

export function getApiBaseUrl(): string {
  // prioridad: runtime-config.json -> .env
  const r = runtime().VITE_API_BASE_URL;
  const v = fromVite('VITE_API_BASE_URL');
  const base = (typeof r === 'string' && r) || (typeof v === 'string' && v) || 'http://localhost:3000/api/v1';
  return base.replace(/\/+$/, ''); // sin trailing slash
}

export function getAuthStorageKind(): 'memory' | 'session' | 'local' {
  // ✅ NUEVO: una sola variable, todas las opciones
  const r = runtime().VITE_AUTH_STORAGE;
  const v = fromVite('VITE_AUTH_STORAGE');
  const raw = (typeof r === 'string' && r) || (typeof v === 'string' && v) || '';

  if (raw === 'memory' || raw === 'session' || raw === 'local') return raw;

  // compat con lo viejo:
  const persistR = runtime().VITE_AUTH_PERSIST;
  const persistV = fromVite('VITE_AUTH_PERSIST');
  const persist = String(persistR ?? persistV ?? 'false').toLowerCase() === 'true';
  if (!persist) return 'memory';

  const kindR = runtime().VITE_AUTH_PERSIST_KIND;
  const kindV = fromVite('VITE_AUTH_PERSIST_KIND');
  const kind = (typeof kindR === 'string' && kindR) || (typeof kindV === 'string' && kindV) || 'session';
  if (kind === 'local') return 'local';
  return 'session';
}
