// src/auth/session.ts
import { getAuthStorageKind } from '../api/env';

export type Session = {
  accessToken: string;
  refreshToken?: string | null;
  user?: any;
  permissions: string[];
};

const KEY = 'personalv5.session';

let mem: Session | null = null;

export function isSessionShapeValid(s: any): s is Session {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.accessToken !== 'string' || !s.accessToken) return false;
  if (!Array.isArray(s.permissions)) return false;
  // refreshToken puede ser string/null/undefined
  if (typeof s.refreshToken !== 'undefined' && s.refreshToken !== null && typeof s.refreshToken !== 'string') return false;
  return true;
}

function storage() {
  const kind = getAuthStorageKind(); // 'memory' | 'session' | 'local'
  if (kind === 'local') return window.localStorage;
  if (kind === 'session') return window.sessionStorage;
  return null; // memory
}

export function loadSession(): Session | null {
  const st = storage();
  if (!st) return mem;

  const raw = st.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isSessionShapeValid(parsed)) {
      // harden: si hay basura/tampering, limpiamos
      st.removeItem(KEY);
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  const st = storage();
  if (!st) {
    mem = s;
    return;
  }
  st.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  const st = storage();
  if (!st) {
    mem = null;
    return;
  }
  st.removeItem(KEY);
}
