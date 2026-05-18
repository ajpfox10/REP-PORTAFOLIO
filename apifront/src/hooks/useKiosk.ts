// src/hooks/useKiosk.ts
// Detecta si la PC es un kiosco por tres mecanismos en orden de prioridad:
//   1. Flag manual en localStorage (persistente, no depende de red)
//   2. Cache de sesión (sessionStorage)
//   3. Fetch a /my-ip y comparación contra VITE_KIOSK_IPS / VITE_KIOSK_HOSTNAMES

import { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../api/env';

const SESSION_CACHE_KEY = '__p5_kiosk__';
const MANUAL_LOCK_KEY   = '__p5_kiosk_lock__';

export function isKioskManual(): boolean {
  try { return localStorage.getItem(MANUAL_LOCK_KEY) === '1'; } catch { return false; }
}
export function setKioskManual(v: boolean) {
  try {
    if (v) localStorage.setItem(MANUAL_LOCK_KEY, '1');
    else   localStorage.removeItem(MANUAL_LOCK_KEY);
    sessionStorage.removeItem(SESSION_CACHE_KEY); // invalida caché de sesión
  } catch {}
}

function getCached(): boolean | null {
  try {
    const v = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  } catch { return null; }
}
function setCache(v: boolean) {
  try { sessionStorage.setItem(SESSION_CACHE_KEY, String(v)); } catch {}
}
function parseList(envVal: string): string[] {
  return envVal.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function useKiosk(): { isKiosk: boolean; kioskLoading: boolean } {
  // Flag manual tiene prioridad inmediata — sin fetch, sin espera
  const manual = isKioskManual();
  const cached = manual ? null : getCached();

  const [isKiosk,      setIsKiosk]      = useState<boolean>(manual || (cached ?? false));
  const [kioskLoading, setKioskLoading] = useState<boolean>(!manual && cached === null);

  useEffect(() => {
    if (manual || getCached() !== null) return;

    const env = (import.meta as any).env ?? {};
    const kioskIps       = parseList(env.VITE_KIOSK_IPS      || '');
    const kioskHostnames = parseList(env.VITE_KIOSK_HOSTNAMES || '');

    if (!kioskIps.length && !kioskHostnames.length) {
      setCache(false);
      setKioskLoading(false);
      return;
    }

    const base = String(getApiBaseUrl() || '').replace(/\/+$/, '');

    fetch(`${base}/my-ip`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const ip       = String(data?.ip       || '').trim().toLowerCase();
        const hostname = String(data?.hostname || '').trim().toLowerCase();
        const match = !!(
          (kioskIps.length       && kioskIps.some(k => k === ip))            ||
          (kioskHostnames.length && kioskHostnames.some(k => k === hostname))
        );
        setCache(match);
        setIsKiosk(match);
      })
      .catch(() => setCache(false))
      .finally(() => setKioskLoading(false));
  }, []);

  return { isKiosk, kioskLoading };
}
