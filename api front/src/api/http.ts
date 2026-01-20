// src/api/http.ts
import { getApiBaseUrl, loadRuntimeConfig } from "./env";
import { clearSession, loadSession, saveSession } from "../auth/session";
import { logEvent } from "../logging/clientLogger";

export type ApiError = {
  message: string;     // SIEMPRE string
  status?: number;
  details?: any;
  aborted?: boolean;
};

function baseUrl() {
  // evita doble barra si base viene con / al final
  return String(getApiBaseUrl() || "").replace(/\/+$/, "");
}

function joinUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl()}${p}`;
}

function isAuthEndpoint(path: string) {
  return path.startsWith('/auth/login') || path.startsWith('/auth/refresh') || path.startsWith('/auth/logout');
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
  );
  return m ? decodeURIComponent(m[1]) : null;
}

let refreshPromise: Promise<void> | null = null;

async function refreshTokensIfPossible(): Promise<void> {
  if (refreshPromise) return refreshPromise;

  const s = loadSession();
  const refreshToken = s?.refreshToken;
  // CIA mode: refresh puede venir solo por cookie HttpOnly, entonces NO bloqueamos si falta.

  refreshPromise = (async () => {
    await loadRuntimeConfig();
    const csrf = getCookie('p5_csrf');
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (csrf) headers['x-csrf-token'] = csrf;

    const res = await fetch(joinUrl('/auth/refresh'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });

    const body = await parseJsonSafe(res);
    if (!res.ok || !body?.ok) {
      logEvent({ level: 'warn', what: 'refresh_failed', where: 'apiFetch.refresh', status: res.status, details: body });
      throw { message: errorToString(body?.error ?? body?.message ?? 'Refresh falló'), status: res.status || 401, details: body } as ApiError;
    }

    const accessToken = body?.data?.accessToken;
    const newRefresh = body?.data?.refreshToken;
    if (!accessToken) {
      throw { message: 'Respuesta inválida (refresh sin accessToken)', status: 500, details: body } as ApiError;
    }

    const next = {
      ...s,
      accessToken,
      // En CIA mode, el refresh suele quedar en cookie y puede no volver por JSON.
      refreshToken: typeof newRefresh === 'string' ? newRefresh : s?.refreshToken ?? null,
    };
    saveSession(next);
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function parseJsonSafe(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  const txt = await res.text().catch(() => "");
  if (!txt) return null;

  // si parece JSON o content-type json, parseamos
  if (ct.includes("application/json") || txt.trim().startsWith("{") || txt.trim().startsWith("[")) {
    try {
      return JSON.parse(txt);
    } catch {
      // si no parsea, devolvemos texto
      return { raw: txt };
    }
  }

  return { raw: txt };
}

function isAbortError(err: any) {
  return err?.name === "AbortError";
}

// Convierte cualquier "error" a string usable (especialmente {formErrors, fieldErrors})
function errorToString(e: any): string {
  if (!e) return "Error";

  if (typeof e === "string") return e;

  // Zod / validator: { formErrors, fieldErrors }
  if (e.fieldErrors && typeof e.fieldErrors === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(e.fieldErrors)) {
      if (Array.isArray(v) && v.length) parts.push(`${k}: ${v.join(", ")}`);
      else if (typeof v === "string") parts.push(`${k}: ${v}`);
    }
    if (parts.length) return parts.join(" | ");
    return "Datos inválidos";
  }

  if (typeof e.message === "string") return e.message;

  try {
    return JSON.stringify(e);
  } catch {
    return "Error";
  }
}

function buildHeaders(initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders || {});
  // defaults para JSON (solo si no existen ya)
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const session = loadSession();
  if (session?.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  // CIA mode: CSRF header para endpoints que usan cookies (refresh/logout)
  const csrf = getCookie('p5_csrf');
  if (csrf && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', csrf);
  }
  return headers;
}

async function doFetch(path: string, init: RequestInit, headers: Headers) {
  const res = await fetch(joinUrl(path), {
    ...init,
    headers,
    credentials: 'include',
    signal: init.signal,
  });
  return res;
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  await loadRuntimeConfig();

  let headers = buildHeaders(init.headers);

  try {
    let res = await doFetch(path, init, headers);

    // 401: intentamos refresh + retry UNA vez (salvo endpoints de auth)
    if (res.status === 401 && !isAuthEndpoint(path)) {
      const s = loadSession();
      if (s?.refreshToken) {
        try {
          await refreshTokensIfPossible();
          headers = buildHeaders(init.headers); // ya trae el nuevo accessToken
          res = await doFetch(path, init, headers);
        } catch (e: any) {
          clearSession();
          const body = await parseJsonSafe(res);
          const raw = body?.error?.message ?? body?.error ?? body?.message ?? e?.message ?? 'Sesión expirada';
          logEvent({ level: 'warn', what: 'auth_401_refresh_failed', where: `apiFetch:${path}`, status: 401, details: { original: body, refreshError: e } });
          throw { message: errorToString(raw), status: 401, details: body } as ApiError;
        }
      } else {
        clearSession();
      }
    }

    // 401 final
    if (res.status === 401) {
      const body = await parseJsonSafe(res);
      const raw = body?.error?.message ?? body?.error ?? body?.message ?? 'Sesión expirada';
      logEvent({ level: 'warn', what: 'auth_401', where: `apiFetch:${path}`, status: 401, details: body });
      throw { message: errorToString(raw), status: 401, details: body } as ApiError;
    }

    // error general
    if (!res.ok) {
      const body = await parseJsonSafe(res);

      // el backend puede mandar: { ok:false, error:"..." } o { ok:false, error:{fieldErrors...} }
      const raw =
        body?.error?.message ??
        body?.error ??
        body?.message ??
        `Error ${res.status}`;

      throw {
        message: errorToString(raw),     // ✅ SIEMPRE string
        status: res.status,
        details: body,                   // queda el objeto para debug
      } as ApiError;
    }

    const data = await parseJsonSafe(res);

    // ✅ IMPORTANTE: NO "desenvolvemos" data.
    // La API ya responde con el wrapper estándar: { ok, data, error, meta, ... }
    // y el resto del front (AuthProvider, tablas, etc.) espera acceder a res.ok y res.data.
    return data as T;
  } catch (err: any) {
    if (isAbortError(err)) {
      throw { message: "Request abortada", aborted: true } as ApiError;
    }
    logEvent({ level: 'error', what: 'api_fetch_error', where: `apiFetch:${path}`, status: err?.status, details: err });
    // si alguien tiró un objeto sin message string, lo normalizamos
    if (err && typeof err === "object" && typeof err.message !== "string") {
      throw { message: errorToString(err), details: err } as ApiError;
    }
    throw err;
  }
}

export async function apiFetchBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  await loadRuntimeConfig();

  // Para blob NO forzamos Content-Type (puede ser multipart / etc.)
  const headers = new Headers(init.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "*/*");

  let session = loadSession();
  if (session?.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  try {
    let res = await fetch(joinUrl(path), {
      ...init,
      headers,
      signal: init.signal,
    });

    // 401: refresh + retry UNA vez (salvo auth endpoints)
    if (res.status === 401 && !isAuthEndpoint(path)) {
      session = loadSession();
      if (session?.refreshToken) {
        try {
          await refreshTokensIfPossible();
          const s2 = loadSession();
          if (s2?.accessToken) headers.set('Authorization', `Bearer ${s2.accessToken}`);
          res = await fetch(joinUrl(path), { ...init, headers, signal: init.signal });
        } catch (e: any) {
          clearSession();
          logEvent({ level: 'warn', what: 'auth_401_refresh_failed', where: `apiFetchBlob:${path}`, status: 401, details: e });
          throw { message: e?.message ?? 'Sesión expirada', status: 401, details: e } as ApiError;
        }
      } else {
        clearSession();
      }
    }

    if (res.status === 401) {
      clearSession();
      logEvent({ level: 'warn', what: 'auth_401', where: `apiFetchBlob:${path}`, status: 401 });
      throw { message: "Sesión expirada", status: 401 } as ApiError;
    }

    if (!res.ok) {
      const body = await parseJsonSafe(res);
      const raw = body?.error?.message ?? body?.error ?? body?.message ?? `Error ${res.status}`;
      throw { message: errorToString(raw), status: res.status, details: body } as ApiError;
    }

    return await res.blob();
  } catch (err: any) {
    if (isAbortError(err)) {
      throw { message: "Request abortada", aborted: true } as ApiError;
    }
    logEvent({ level: 'error', what: 'api_fetch_blob_error', where: `apiFetchBlob:${path}`, status: err?.status, details: err });
    if (err && typeof err === "object" && typeof err.message !== "string") {
      throw { message: errorToString(err), details: err } as ApiError;
    }
    throw err;
  }
}
