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
  // prioridad: runtime-config.json -> .env -> default
  const cfg = runtime();

  const r1 = cfg?.VITE_API_BASE_URL;
  const r2 = cfg?.apiBaseUrl; // ✅ tu runtime-config.json actual
  const v = fromVite('VITE_API_BASE_URL');

  const base =
    (typeof r1 === 'string' && r1.trim()) ||
    (typeof r2 === 'string' && r2.trim()) ||
    (typeof v === 'string' && v.trim()) ||
    'http://192.168.0.21:3000/api/v1';

  return base.replace(/\/+$/, ''); // sin trailing slash
}


export function getAuthStorageKind(): 'memory' | 'session' | 'local' {
  // ✅ NUEVO: una sola variable, todas las opciones
  const r = runtime().VITE_AUTH_STORAGE;
  const v = fromVite('VITE_AUTH_STORAGE');
  const raw = (typeof r === 'string' && r) || (typeof v === 'string' && v) || '';

  if (raw === 'memory' || raw === 'session' || raw === 'local') return raw;

  // compat con lo viejo — si no hay VITE_AUTH_STORAGE, usar 'local' por defecto
  const persistR = runtime().VITE_AUTH_PERSIST;
  const persistV = fromVite('VITE_AUTH_PERSIST');
  const persistRaw = persistR ?? persistV;
  // Solo ir a memory si está explícitamente seteado en false
  if (persistRaw !== undefined && String(persistRaw).toLowerCase() === 'false') return 'local';

  const kindR = runtime().VITE_AUTH_PERSIST_KIND;
  const kindV = fromVite('VITE_AUTH_PERSIST_KIND');
  const kind = (typeof kindR === 'string' && kindR) || (typeof kindV === 'string' && kindV) || 'local';
  if (kind === 'local') return 'local';
  if (kind === 'session') return 'session';
  return 'local'; // default seguro
}
