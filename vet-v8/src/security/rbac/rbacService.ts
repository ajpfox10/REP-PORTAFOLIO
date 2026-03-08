import { matchPermission, type Permission } from "./permissions.js";

export function hasPermission(perms: Permission[], required: Permission) {
  return perms.some(p => matchPermission(p, required));
}

export function defaultRolePerms(roleKey: string): Permission[] {
  switch (roleKey) {
    case "admin":
      return [
        "db:*:*", "billing:*", "plugins:*", "audit:*",
        "internal:*", "auth:*", "agenda:*", "clinical:*",
      ];

    case "vet":
      return [
        "agenda:*",
        "db:pacientes:read",
        "db:consultas:*",
        "db:vacunas:*",
        "db:desparasitaciones:*",
        "db:prescripciones:*",   // FIX: vets prescriben
        "db:internaciones:*",    // FIX: vets internan
        "db:turnos:read",
        "db:turnos:update",
        "db:propietarios:read",
      ];

    case "receptionist":
      return [
        "agenda:*",
        "db:pacientes:*",
        "db:propietarios:*",
        "db:turnos:*",
        "db:vacunas:read",
        "db:ventas:*",           // FIX: recepcionistas venden
        "billing:read",
        "billing:create",        // FIX: puede crear facturas
      ];

    case "staff":
      return [
        "db:pacientes:read",
        "db:propietarios:read",
        "db:turnos:read",
        "db:vacunas:read",
        "db:ventas:*",           // FIX: staff puede vender
        "db:productos:read",
        "agenda:read",
      ];

    case "owner":
      // Portal propietario — solo ve sus propios datos
      // La restricción por propietario_id se aplica en el portalRouter (ABAC)
      return [
        "portal:read",
      ];

    case "viewer":
      return [
        "db:pacientes:read",
        "db:turnos:read",
      ];

    default:
      return [];
  }
}
