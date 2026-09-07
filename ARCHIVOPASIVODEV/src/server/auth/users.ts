import { query } from "../db/pool.js";

export type AuthUser = {
  id: number;
  username: string | null;
  email: string;
  nombre: string;
  password_hash: string;
  rol_id: number;
  activo: number;
  token_version: number;
  two_factor_enabled: number;
  two_factor_secret: string | null;
};

// Busca el usuario por email para el flujo de login.
export async function findUserByEmail(email: string) {
  const rows = await query<AuthUser[]>(
    `SELECT id, username, email, nombre, password_hash, rol_id, activo, token_version,
            two_factor_enabled, two_factor_secret
       FROM usuarios
      WHERE email = :email AND deleted_at IS NULL
      LIMIT 1`,
    { email }
  );
  return rows[0] ?? null;
}

// Busca el usuario por username o email para permitir credenciales simples.
export async function findUserByIdentifier(identifier: string) {
  const rows = await query<AuthUser[]>(
    `SELECT id, username, email, nombre, password_hash, rol_id, activo, token_version,
            two_factor_enabled, two_factor_secret
       FROM usuarios
      WHERE deleted_at IS NULL
        AND (email = :identifier OR username = :identifier)
      LIMIT 1`,
    { identifier }
  );
  return rows[0] ?? null;
}

// Busca el usuario por id para refresh y validacion de access token.
export async function findUserById(id: number) {
  const rows = await query<AuthUser[]>(
    `SELECT id, username, email, nombre, password_hash, rol_id, activo, token_version,
            two_factor_enabled, two_factor_secret
       FROM usuarios
      WHERE id = :id AND deleted_at IS NULL
      LIMIT 1`,
    { id }
  );
  return rows[0] ?? null;
}
