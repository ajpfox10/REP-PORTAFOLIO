// src/auth/permissions.ts
export type CrudAction = 'read' | 'create' | 'update' | 'delete';

const norm = (s: string) => String(s || '').trim().toLowerCase();

function matchPattern(pattern: string, wanted: string): boolean {
  const p = norm(pattern);
  const w = norm(wanted);

  if (!p || !w) return false;
  if (p === '*') return true;
  if (p === w) return true;

  // wildcard por segmentos "a:b:c"
  if (!p.includes('*')) return false;

  const pp = p.split(':');
  const ww = w.split(':');

  // match por segmentos si longitudes iguales
  if (pp.length === ww.length) {
    return pp.every((seg, i) => seg === '*' || seg === ww[i]);
  }

  // match flexible: patrón más corto (prefijo)
  if (pp.length < ww.length) {
    return pp.every((seg, i) => seg === '*' || seg === ww[i]);
  }

  return false;
}

export function hasPermission(permissions: string[], wanted: string): boolean {
  const perms = Array.isArray(permissions) ? permissions : [];
  const w = norm(wanted);
  if (!w) return false;

  // exact + wildcard
  for (const p of perms) {
    if (matchPattern(p, w)) return true;
  }
  return false;
}

export function hasAny(permissions: string[], wantedList: string[]): boolean {
  const list = (wantedList || []).map(norm).filter(Boolean);
  if (!list.length) return true;
  return list.some((w) => hasPermission(permissions, w));
}

export function hasAll(permissions: string[], wantedList: string[]): boolean {
  const list = (wantedList || []).map(norm).filter(Boolean);
  if (!list.length) return true;
  return list.every((w) => hasPermission(permissions, w));
}

/**
 * Permisos CRUD esperados (alineado al backend):
 * - crud:tabla:accion
 * - crud:tabla:*
 * - crud:*:accion
 * - crud:*:*
 */
export function canCrud(permissions: string[], table: string, action: CrudAction): boolean {
  const t = norm(table);
  const a = norm(action);
  const wanted = [`crud:${t}:${a}`, `crud:${t}:*`, `crud:*:${a}`, `crud:*:*`];
  return hasAny(permissions, wanted);
}