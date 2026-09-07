export type Session = {
  accessToken: string;
  refreshToken: string;
  user: { id: number; username?: string | null; email: string; nombre: string; roleId: number };
  permissions: string[];
};

const KEY = "archivo_pasivo.session";

// Lee la sesion del navegador y descarta datos con forma invalida.
export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken || !parsed?.refreshToken || !Array.isArray(parsed?.permissions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Guarda la sesion activa del usuario.
export function saveSession(session: Session) {
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

// Elimina toda credencial del navegador.
export function clearSession() {
  window.localStorage.removeItem(KEY);
}
