// src/auth/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, type ApiError } from '../api/http';
import { clearSession, loadSession, saveSession, type Session } from './session';
import { isJwtExpired } from './jwt';
import { logEvent } from '../logging/clientLogger';
import { canCrud, hasAll, hasAny, hasPermission, type CrudAction } from './permissions';

type AuthCtx = {
  session: Session | null;
  isReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPerm: (perm: string) => boolean;
  hasAny: (perms: string[]) => boolean;
  hasAll: (perms: string[]) => boolean;
  canCrud: (table: string, action: CrudAction) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

function pickMessageFromApi(res: any): string {
  const e = res?.error;
  if (!e) return 'Error';
  if (typeof e === 'string') return e;
  if (typeof e?.message === 'string') return e.message;

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

  useEffect(() => {
    let alive = true;

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

        // ping a endpoint protegido (no asume RBAC fino)
        const check = await apiFetch('/documents?limit=1&page=1', { method: 'GET' });
        if (!check?.ok) {
          logEvent({ level: 'warn', what: 'boot_token_invalid', where: 'AuthProvider.boot', status: 401, details: check });
          clearSession();
          if (alive) setSession(null);
        }
      } catch (e: any) {
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
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res?.ok) throw { message: pickMessageFromApi(res) } as ApiError;

    const accessToken = res?.data?.accessToken;
    const refreshToken = res?.data?.refreshToken;

    if (!accessToken) throw { message: 'Respuesta inválida (falta accessToken)' } as ApiError;

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

  const perms = session?.permissions ?? [];

  const hasPermFn = (perm: string) => !!session && hasPermission(perms, perm);
  const hasAnyFn = (list: string[]) => !!session && hasAny(perms, list);
  const hasAllFn = (list: string[]) => !!session && hasAll(perms, list);
  const canCrudFn = (table: string, action: CrudAction) => !!session && canCrud(perms, table, action);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      isReady,
      login,
      logout,
      hasPerm: hasPermFn,
      hasAny: hasAnyFn,
      hasAll: hasAllFn,
      canCrud: canCrudFn,
    }),
    [session, isReady]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
