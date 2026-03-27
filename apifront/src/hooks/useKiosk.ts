// src/hooks/useKiosk.ts
// Detecta si la petición viene desde una PC de kiosco (atención al público)
// comparando la IP del cliente contra VITE_KIOSK_IPS (lista separada por comas).
// Cachea el resultado en sessionStorage para evitar múltiples fetches por render.

import { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../api/env';

const CACHE_KEY = '__p5_kiosk__';

function getCached(): boolean | null {
  try {
    const v = sessionStorage.getItem(CACHE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  } catch { return null; }
}

function setCache(v: boolean) {
  try { sessionStorage.setItem(CACHE_KEY, String(v)); } catch {}
}

export function useKiosk(): { isKiosk: boolean; kioskLoading: boolean } {
  const cached = getCached();
  const [isKiosk,      setIsKiosk]      = useState<boolean>(cached ?? false);
  const [kioskLoading, setKioskLoading] = useState<boolean>(cached === null);

  useEffect(() => {
    // Ya teníamos resultado en caché — no repetimos el fetch
    if (getCached() !== null) return;

    const kioskIps = ((import.meta as any).env?.VITE_KIOSK_IPS || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (!kioskIps.length) {
      // Sin IPs configuradas → nunca es kiosco
      setCache(false);
      setKioskLoading(false);
      return;
    }

    const base = String(getApiBaseUrl() || '').replace(/\/+$/, '');

    fetch(`${base}/my-ip`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const ip    = String(data?.ip || '').trim();
        const match = kioskIps.some((k: string) =>
          k.toLowerCase() === ip.toLowerCase()
        );
        setCache(match);
        setIsKiosk(match);
      })
      .catch(() => {
        setCache(false);
      })
      .finally(() => setKioskLoading(false));
  }, []);

  return { isKiosk, kioskLoading };
}
