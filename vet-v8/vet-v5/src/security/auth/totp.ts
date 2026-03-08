import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateBase32Secret(bytes = 20): string {
  const b = crypto.randomBytes(bytes);
  let out = "";
  let bits = "";
  for (const byte of b) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5);
    if (chunk.length < 5) break;
    out += ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

export function totpCode(secretBase32: string, stepSeconds = 30, digits = 6, forTimeMs = Date.now()): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(forTimeMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | (hmac[offset + 3]);
  const otp = (bin % 10 ** digits).toString().padStart(digits, "0");
  return otp;
}

export function verifyTotp(opts: { secretBase32: string; code: string; window?: number }): boolean {
  const window = opts.window ?? 1;
  const code = String(opts.code).trim();
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    const t = now + w * 30_000;
    if (totpCode(opts.secretBase32, 30, 6, t) === code) return true;
  }
  return false;
}
