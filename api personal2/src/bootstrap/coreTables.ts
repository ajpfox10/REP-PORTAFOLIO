export const CORE_TABLES: string[] = [
  // Auth / RBAC core
  "usuarios",
  "roles",
  "permisos",
  "usuarios_roles",
  "roles_permisos",

  // Tokens / seguridad
  "refresh_tokens",
  "auth_login_guard",
  "security_bans",

  // Auditoría
  "audit_log",
];
