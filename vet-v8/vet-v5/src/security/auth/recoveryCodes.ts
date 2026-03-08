import crypto from "node:crypto";

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(5).toString("hex")); // 10 chars
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}
