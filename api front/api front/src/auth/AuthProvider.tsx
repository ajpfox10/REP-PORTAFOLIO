// src/auth/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, type ApiError } from '../api/http';
import { clearSession, loadSession, saveSession, type Session } from './session';
import { isJwtExpired } from './jwt';
import { logEvent } from '../logging/clientLogger';

type AuthCtx = {
  session: Session | null;
  isReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (perm: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

function pickMessageFromApi(res: any): string {
  // API estándar: { ok:false, error:"..." } o { ok:false, error:{...} }
  const e = res?.error;
  if (!e) return 'Error';
  if (typeof e === 'string') return e;
  if (typeof e?.message === 'string') return e.message;

  // zod/validator style: { formErrors:[], fieldErrors:{...} }
  if (e?.fieldErrors && typeof e.fieldErrors === 'object') {
    const firstKey = Object.keys(e.fieldErrors)[0];
    const firstVal = e.fieldErrors?.[firstKey];
    if (Array.isArray(firstVal) && firstVal[0]) return String(firstVal[0]);
  }

  try {
    return JSON.stringify(e);
  } catch {
    return 'Error';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [isReady, setIsReady] = useState(false);

  // Harden: al boot no confiamos en localStorage. Validamos token (exp) + ping auth-protected.
  useEffect(() => {
    let alive = true;

    // Listener global: cuando api/http detecta 401 final, avisa y acá bajamos sesión.
    const onExpired = (ev: any) => {
      const msg = ev?.detail?.message || 'Sesión expirada';
      logEvent({ level: 'warn', what: 'auth_expired_event', where: 'AuthProvider.listener', details: { msg } });
      clearSession();
      if (alive) setSession(null);
    };
    window.addEventListener('p5:auth_expired', onExpired as any);

    (async () => {
      try {
        const s = loadSession();
        if (!s) return;

        // 1) si access expiró, intentamos refresh
        if (isJwtExpired(s.accessToken)) {
          if (!s.refreshToken) {
            clearSession();
            if (alive) setSession(null);
            return;
          }
          const r = await apiFetch('/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: s.refreshToken }),
          });

          if (!r?.ok || !r?.data?.accessToken) {
            logEvent({ level: 'warn', what: 'boot_refresh_failed', where: 'AuthProvider.boot', status: 401, details: r });
            clearSession();
            if (alive) setSession(null);
            return;
          }

          const next: Session = {
            ...s,
            accessToken: r.data.accessToken,
            refreshToken: r.data.refreshToken ?? s.refreshToken ?? null,
          };
          saveSession(next);
          if (alive) setSession(next);
        }

        // 2) ping a un endpoint protegido SIN RBAC (documents) para confirmar que el token sirve.
        // Si alguien “inyectó” una session fake en storage, acá se cae.
        const check = await apiFetch('/documents?limit=1&page=1', { method: 'GET' });
        if (!check?.ok) {
          logEvent({ level: 'warn', what: 'boot_token_invalid', where: 'AuthProvider.boot', status: 401, details: check });
          clearSession();
          if (alive) setSession(null);
        }
      } catch (e: any) {
        // cualquier cosa rara -> sesión afuera
        logEvent({ level: 'warn', what: 'boot_auth_exception', where: 'AuthProvider.boot', details: e });
        clearSession();
        if (alive) setSession(null);
      } finally {
        if (alive) setIsReady(true);
      }
    })();

    return () => {
      alive = false;
      window.removeEventListener('p5:auth_expired', onExpired as any);
    };
  }, []);

  async function login(email: string, password: string) {
    // ✅ OJO: NO pongas /api/v1 acá porque el BASE_URL ya tiene /api/v1
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res?.ok) {
      throw { message: pickMessageFromApi(res) } as ApiError;
    }

    const accessToken = res?.data?.accessToken;
    const refreshToken = res?.data?.refreshToken;

    if (!accessToken) {
      throw { message: 'Respuesta inválida (falta accessToken)' } as ApiError;
    }

    const next: Session = {
      accessToken,
      refreshToken: refreshToken ?? null,
      user: res?.data?.user ?? null,
      permissions: Array.isArray(res?.data?.permissions) ? res.data.permissions : [],
    };

    saveSession(next);
    setSession(next);
  }

  async function logout() {
    const s = loadSession();
    try {
      if (s?.refreshToken) {
        // ✅ mismo criterio: sin /api/v1
        await apiFetch('/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: s.refreshToken }),
        });
      }
    } finally {
      clearSession();
      setSession(null);
    }
  }

  const hasPerm = (perm: string) => {
    if (!session) return false;
    return session.permissions.includes(perm) || session.permissions.includes('crud:*:*');
  };

  const value = useMemo<AuthCtx>(() => ({ session, isReady, login, logout, hasPerm }), [session, isReady]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
