import React, { createContext, useContext, useMemo, useState } from "react";
import { apiFetch } from "../api/http";
import { clearSession, loadSession, saveSession, type Session } from "./session";

type AuthContextValue = {
  session: Session | null;
  login: (identifier: string, password: string, twoFactorCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Provee sesion y helpers de permisos a toda la interfaz.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  async function login(identifier: string, password: string, twoFactorCode?: string) {
    const res = await apiFetch<{ ok: true; data: Session }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password, twoFactorCode }),
    });
    saveSession(res.data);
    setSession(res.data);
  }

  async function logout() {
    const current = loadSession();
    if (current) {
      await apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      }).catch(() => undefined);
    }
    clearSession();
    setSession(null);
  }

  function hasPermission(permission: string) {
    const permissions = session?.permissions ?? [];
    const module = permission.split(":")[0];
    return permissions.includes(permission) || permissions.includes(`${module}:*`) || permissions.includes("*:*");
  }

  const value = useMemo(() => ({ session, login, logout, hasPermission }), [session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Devuelve el contexto de autenticacion ya validado.
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider no montado");
  return context;
}
