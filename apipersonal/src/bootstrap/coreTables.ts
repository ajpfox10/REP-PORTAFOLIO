// src/bootstrap/coreTables.ts
import { env } from '../config/env';

/**
 * Tablas consideradas "core" del sistema.
 * - Se excluyen del CRUD público por defecto
 * - Se protegen de operaciones masivas
 * - Se consideran parte del schema de seguridad/auditoría
 * 
 * AHORA CONFIGURABLE DESDE .env
 * Formato: CORE_TABLES=usuarios,roles,permisos,refresh_tokens
 */
function parseCoreTables(): string[] {
  // 1. Si hay variable de entorno, usarla
  if (env.CORE_TABLES && typeof env.CORE_TABLES === 'string' && env.CORE_TABLES.trim()) {
    return env.CORE_TABLES
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
  }

  // 2. Fallback: hardcodeo original (mantiene compatibilidad)
  return [
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
    
    // API Keys
    "api_keys",
    
    // Idempotency
    "idempotency_keys",
    
    // Migraciones
    "schema_migrations",
    "sequelizemeta"
  ];
}

export const CORE_TABLES: string[] = parseCoreTables();

export function getCoreTables(): string[] {
  return parseCoreTables();
}