// src/auth/jwt.ts

// Parse JWT payload without verifying signature (frontend no tiene secretos).
// Sirve para validar forma y expiración.

export type JwtPayload = {
  exp?: number;
  iat?: number;
  sub?: string;
  roleId?: number;
  [k: string]: any;
};

function b64urlToString(input: string) {
  const pad = input.length % 4;
  const base64 = (input + (pad ? '='.repeat(4 - pad) : '')).replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(base64), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    // fallback (si no es UTF-8)
    try {
      return atob(base64);
    } catch {
      return '';
    }
  }
}

export function parseJwt(token: string): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadStr = b64urlToString(parts[1]);
  if (!payloadStr) return null;
  try {
    return JSON.parse(payloadStr) as JwtPayload;
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string, skewSeconds = 15): boolean {
  const p = parseJwt(token);
  const exp = p?.exp;
  if (!exp || typeof exp !== 'number') return true; // si no hay exp, tratamos como inválido
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}
