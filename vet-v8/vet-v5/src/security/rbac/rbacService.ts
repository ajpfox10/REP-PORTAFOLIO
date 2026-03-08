import { matchPermission, type Permission } from "./permissions.js";

export function hasPermission(perms: Permission[], required: Permission) {
  return perms.some(p => matchPermission(p, required));
}

export function defaultRolePerms(roleKey: string): Permission[] {
  switch (roleKey) {
    case "admin":
      return ["db:*:*", "billing:*", "plugins:*", "audit:*", "internal:*", "auth:*"];
    case "vet":
      return [
        "agenda:*",
        "db:pacientes:read",
        "db:consultas:*",
        "db:vacunas:*",
        "db:turnos:read",
        "db:turnos:update"
      ];
    case "receptionist":
      return [
        "agenda:*",
        "db:pacientes:*",
        "db:propietarios:*",
        "db:turnos:*",
        "billing:read"
      ];
    case "viewer":
      return [
        "db:pacientes:read",
        "db:turnos:read"
      ];
    default:
      return [];
  }
}
