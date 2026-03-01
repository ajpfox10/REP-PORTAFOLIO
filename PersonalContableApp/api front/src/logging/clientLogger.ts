// src/logging/clientLogger.ts

// Logger livianito: guarda los últimos errores en localStorage para debug.
// Nota: no es seguridad, es observabilidad.

import { loadSession } from '../auth/session';

export type ClientLogEvent = {
  ts: string; // ISO
  level: 'error' | 'warn' | 'info';
  what: string;
  where?: string;
  status?: number;
  user?: { id?: any; email?: any } | null;
  details?: any;
};

const KEY = 'personalv5.clientLogs';
const MAX = 300;

function safeJsonParse(raw: string | null) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function logEvent(e: Omit<ClientLogEvent, 'ts' | 'user'>) {
  const s = loadSession();
  const event: ClientLogEvent = {
    ts: new Date().toISOString(),
    user: s?.user ? { id: s.user?.id, email: s.user?.email } : null,
    ...e,
  };

  try {
    const cur = safeJsonParse(window.localStorage.getItem(KEY)) as ClientLogEvent[];
    cur.unshift(event);
    if (cur.length > MAX) cur.length = MAX;
    window.localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    // si localStorage está bloqueado, al menos consola
  }

  // consola (útil en dev)
  if (event.level === 'error') console.error('[clientLog]', event);
  else if (event.level === 'warn') console.warn('[clientLog]', event);
  else console.log('[clientLog]', event);
}

export function clearClientLogs() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
