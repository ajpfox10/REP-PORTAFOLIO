import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

// Hashea contrasenas antes de persistirlas en MySQL.
export function hashPassword(password: string) {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

// Compara una contrasena ingresada con el hash almacenado.
export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}
