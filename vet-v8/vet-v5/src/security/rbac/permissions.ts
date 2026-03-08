export type Permission = string;
export function matchPermission(granted: Permission, required: Permission): boolean {
  if (granted === "*") return true;
  const g = granted.split(":");
  const r = required.split(":");
  for (let i = 0; i < Math.max(g.length, r.length); i++) {
    const gv = g[i] ?? "";
    const rv = r[i] ?? "";
    if (gv === "*" || gv === rv) continue;
    return false;
  }
  return true;
}
