import crypto from "node:crypto";

// Genera SHA-256 en hexadecimal para tokens que no deben guardarse en texto plano.
export function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

// Genera valores aleatorios para jti y secretos temporales.
export function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}
