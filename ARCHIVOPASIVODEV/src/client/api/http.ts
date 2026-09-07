import { clearSession, loadSession, saveSession } from "../auth/session";

// Construye URLs de API relativas al monolito.
function url(path: string) {
  return path.startsWith("/api") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
}

// Realiza refresh una sola vez cuando el access token vence.
async function refreshSession() {
  const session = loadSession();
  if (!session?.refreshToken) throw new Error("Sesion expirada");
  const res = await fetch(url("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(body.error || "Refresh invalido");
  saveSession(body.data);
}

// Fetch comun con Bearer token y reintento ante 401.
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let session = loadSession();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);

  let res = await fetch(url(path), { ...init, headers });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    try {
      await refreshSession();
      session = loadSession();
      if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);
      res = await fetch(url(path), { ...init, headers });
    } catch {
      clearSession();
    }
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok === false) throw new Error(body?.error || `Error ${res.status}`);
  return body as T;
}
