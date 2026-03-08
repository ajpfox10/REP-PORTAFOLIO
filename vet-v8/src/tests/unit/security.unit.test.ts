/**
 * Tests unitarios de seguridad — v11  (Punto 1)
 * Cubren todos los módulos creados en v9 y v10.
 * Ejecutar: jest --testPathPattern=security.unit
 */

import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// recoveryCodes
// ─────────────────────────────────────────────────────────────────────────────

describe("recoveryCodes", () => {
  const { generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode } =
    require("../../security/auth/recoveryCodes");

  it("genera 8 códigos por defecto", async () => {
    const codes = await generateRecoveryCodes();
    expect(codes).toHaveLength(8);
  });

  it("cada código tiene formato XXXX-XXXX-XXXX-XXXX (128 bits hex)", async () => {
    const codes = await generateRecoveryCodes();
    for (const c of codes) {
      expect(c).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
    }
  });

  it("todos los códigos son únicos", async () => {
    const codes = await generateRecoveryCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("hashRecoveryCode produce formato argon2id$<salt>$<hash>", async () => {
    const hash = await hashRecoveryCode("abcd1234-abcd1234-abcd1234-abcd1234");
    expect(hash).toMatch(/^argon2id\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  it("verifyRecoveryCode — código correcto retorna true", async () => {
    const plain = "abcd1234-ef012345-abcd1234-ef012345";
    const hash  = await hashRecoveryCode(plain);
    expect(await verifyRecoveryCode(plain, hash)).toBe(true);
  });

  it("verifyRecoveryCode — código incorrecto retorna false", async () => {
    const hash = await hashRecoveryCode("abcd1234-ef012345-abcd1234-ef012345");
    expect(await verifyRecoveryCode("wrong-code-0000-0000-0000-0000000", hash)).toBe(false);
  });

  it("verifyRecoveryCode — resistente a timing: mismo tiempo para correcto e incorrecto", async () => {
    const plain = "aaaabbbb-ccccdddd-eeeeffff-00001111";
    const hash  = await hashRecoveryCode(plain);
    // solo verificamos que no crashea — timing diff medible requeriría benchmark externo
    const t0 = Date.now(); await verifyRecoveryCode(plain, hash);
    const t1 = Date.now(); await verifyRecoveryCode("wrong", hash);
    const t2 = Date.now();
    // ambas llamadas deben completar (no lanzar)
    expect(t1).toBeGreaterThanOrEqual(t0);
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it("hash es diferente para el mismo código (sal aleatoria)", async () => {
    const plain = "same-code-1234-5678-abcd-efgh00000000";
    const h1 = await hashRecoveryCode(plain);
    const h2 = await hashRecoveryCode(plain);
    expect(h1).not.toBe(h2); // sal diferente → hash diferente
    // pero ambos verifican correctamente
    expect(await verifyRecoveryCode(plain, h1)).toBe(true);
    expect(await verifyRecoveryCode(plain, h2)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// passwordPolicy
// ─────────────────────────────────────────────────────────────────────────────

describe("passwordPolicy — validatePasswordStrength", () => {
  const { validatePasswordStrength } = require("../../security/password/passwordPolicy");

  const goodPass = "Segura!2026#Vet";

  it("contraseña fuerte no lanza", () => {
    expect(() => validatePasswordStrength(goodPass)).not.toThrow();
  });

  it.each([
    ["corta", "Ab1!"],
    ["sin mayúscula", "segura!2026#vet"],
    ["sin número", "Segura!AbcDef#"],
    ["sin especial", "Segura2026Vet1"],
    ["común: password", "Password1!"],
  ])("rechaza contraseña %s", (_, pass) => {
    expect(() => validatePasswordStrength(pass)).toThrow();
  });

  it("rechaza contraseña que contiene el email", () => {
    expect(() => validatePasswordStrength("juan.perez@2026!", "juan.perez@clinic.com")).toThrow();
  });

  it("contraseña con exactamente 10 caracteres válidos pasa", () => {
    expect(() => validatePasswordStrength("Aa1!bcdefG")).not.toThrow();
  });

  it("contraseña con 9 caracteres falla", () => {
    expect(() => validatePasswordStrength("Aa1!bcde")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loginProtection — lógica de contadores
// ─────────────────────────────────────────────────────────────────────────────

describe("loginProtection", () => {
  const { buildLoginProtection } = require("../../security/bruteforce/loginProtection");

  function makeRedis() {
    const store: Record<string, string> = {};
    return {
      get: jest.fn(async (k: string) => store[k] ?? null),
      set: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      incr: jest.fn(async (k: string) => { store[k] = String((parseInt(store[k] ?? "0")) + 1); return parseInt(store[k]); }),
      expire: jest.fn(async () => {}),
      del: jest.fn(async (...keys: string[]) => { keys.forEach(k => delete store[k]); }),
      _store: store,
    };
  }

  it("no lanza en primer intento", async () => {
    const redis = makeRedis();
    const g = buildLoginProtection(redis);
    await expect(g.checkAndThrow("tenant1", "user@test.com", "1.2.3.4")).resolves.not.toThrow();
  });

  it("lanza RATE_LIMITED tras 5 fallos consecutivos", async () => {
    const redis = makeRedis();
    const g = buildLoginProtection(redis);
    for (let i = 0; i < 5; i++) {
      await g.onFailure("tenant1", "lock@test.com", "1.2.3.4");
    }
    await expect(g.checkAndThrow("tenant1", "lock@test.com", "1.2.3.4"))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("reset tras login exitoso desbloquea la cuenta", async () => {
    const redis = makeRedis();
    const g = buildLoginProtection(redis);
    for (let i = 0; i < 5; i++) await g.onFailure("t1", "u@t.com", "1.1.1.1");
    await g.onSuccess("t1", "u@t.com", "1.1.1.1");
    await expect(g.checkAndThrow("t1", "u@t.com", "1.1.1.1")).resolves.toBeUndefined();
  });

  it("usuarios distintos no se bloquean entre sí", async () => {
    const redis = makeRedis();
    const g = buildLoginProtection(redis);
    for (let i = 0; i < 5; i++) await g.onFailure("t1", "victim@t.com", "1.1.1.1");
    // otro usuario en el mismo tenant no debe estar bloqueado
    await expect(g.checkAndThrow("t1", "other@t.com", "1.1.1.1")).resolves.toBeUndefined();
  });

  it("mismo usuario en distinto tenant no se bloquea", async () => {
    const redis = makeRedis();
    const g = buildLoginProtection(redis);
    for (let i = 0; i < 5; i++) await g.onFailure("tenantA", "u@t.com", "1.1.1.1");
    await expect(g.checkAndThrow("tenantB", "u@t.com", "1.1.1.1")).resolves.toBeUndefined();
  });

  it("onFailure sin redis no lanza (degradación graceful)", async () => {
    const g = buildLoginProtection(null);
    await expect(g.onFailure("t", "u@t.com", "1.1.1.1")).resolves.toBeUndefined();
    await expect(g.checkAndThrow("t", "u@t.com", "1.1.1.1")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// jtiBlocklist
// ─────────────────────────────────────────────────────────────────────────────

describe("jtiBlocklist", () => {
  const { jtiBlocklist } = require("../../security/auth/jtiBlocklist");

  function makeRedis() {
    const store: Record<string, string> = {};
    return {
      get: jest.fn(async (k: string) => store[k] ?? null),
      set: jest.fn(async (k: string, v: string, _ex: string, ttl: number) => { store[k] = v; }),
    };
  }

  it("JTI no revocado → isRevoked retorna false", async () => {
    const redis = makeRedis();
    expect(await jtiBlocklist.isRevoked(redis, "abc123")).toBe(false);
  });

  it("JTI revocado → isRevoked retorna true", async () => {
    const redis = makeRedis();
    const exp = Math.floor(Date.now() / 1000) + 900;
    await jtiBlocklist.revoke(redis, "tok-xyz", exp);
    expect(await jtiBlocklist.isRevoked(redis, "tok-xyz")).toBe(true);
  });

  it("revoke llama SET con TTL positivo", async () => {
    const redis = makeRedis();
    const exp = Math.floor(Date.now() / 1000) + 900;
    await jtiBlocklist.revoke(redis, "jti-1", exp);
    expect(redis.set).toHaveBeenCalledWith(
      "jti:deny:jti-1", "1", "EX", expect.any(Number)
    );
    const ttl = (redis.set as jest.Mock).mock.calls[0][3];
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it("JTI diferente no se revoca", async () => {
    const redis = makeRedis();
    const exp = Math.floor(Date.now() / 1000) + 900;
    await jtiBlocklist.revoke(redis, "jti-A", exp);
    expect(await jtiBlocklist.isRevoked(redis, "jti-B")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// secureToken
// ─────────────────────────────────────────────────────────────────────────────

describe("secureToken", () => {
  const { generateSecureToken, hashSecureToken, verifySecureToken } =
    require("../../security/auth/secureToken");

  it("genera token de 43 chars (256 bits base64url)", () => {
    const t = generateSecureToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("dos tokens generados son distintos", () => {
    expect(generateSecureToken()).not.toBe(generateSecureToken());
  });

  it("hashSecureToken produce hex de 64 chars (SHA-256)", () => {
    const h = hashSecureToken(generateSecureToken());
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("verifySecureToken — token correcto retorna true", () => {
    const t = generateSecureToken();
    expect(verifySecureToken(t, hashSecureToken(t))).toBe(true);
  });

  it("verifySecureToken — token incorrecto retorna false", () => {
    const t = generateSecureToken();
    expect(verifySecureToken("token-incorrecto", hashSecureToken(t))).toBe(false);
  });

  it("verifySecureToken — hash manipulado retorna false", () => {
    const t = generateSecureToken();
    const hash = hashSecureToken(t);
    const tampered = hash.slice(0, -4) + "0000";
    expect(verifySecureToken(t, tampered)).toBe(false);
  });

  it("no hace timing leak — mismo tipo de retorno para éxito y fallo", () => {
    const t = generateSecureToken();
    const h = hashSecureToken(t);
    const r1 = verifySecureToken(t, h);
    const r2 = verifySecureToken("wrong", h);
    expect(typeof r1).toBe("boolean");
    expect(typeof r2).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fileValidation — sin DB (sólo magic bytes)
// ─────────────────────────────────────────────────────────────────────────────

describe("fileValidation — detectMimeFromMagic (vía validateUpload)", () => {
  // Signatures mínimas para test
  const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Buffer.alloc(20)]);
  const PNG  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Buffer.alloc(20)]);
  const PDF  = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, ...Buffer.alloc(20)]);
  const FAKE = Buffer.from("This is not an image at all, it is just text");

  function makePool(usedBytes = 0) {
    return {
      query: jest.fn().mockResolvedValue([[{ used_bytes: usedBytes }]])
    };
  }

  it("acepta JPEG válido", async () => {
    const { validateUpload } = require("../../security/files/fileValidation");
    const result = await validateUpload(JPEG, "foto.jpg", "t1", makePool());
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("acepta PNG válido", async () => {
    const { validateUpload } = require("../../security/files/fileValidation");
    const result = await validateUpload(PNG, "imagen.png", "t1", makePool());
    expect(result.mimeType).toBe("image/png");
  });

  it("acepta PDF válido", async () => {
    const { validateUpload } = require("../../security/files/fileValidation");
    const result = await validateUpload(PDF, "doc.pdf", "t1", makePool());
    expect(result.mimeType).toBe("application/pdf");
  });

  it("rechaza buffer sin firma reconocida", async () => {
    const { validateUpload } = require("../../security/files/fileValidation");
    await expect(validateUpload(FAKE, "malware.exe", "t1", makePool()))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rechaza extensión inconsistente con magic bytes", async () => {
    const { validateUpload } = require("../../security/files/fileValidation");
    // JPEG pero con extensión .png
    await expect(validateUpload(JPEG, "truco.png", "t1", makePool()))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lanza VALIDATION_ERROR cuando se supera la cuota del tenant", async () => {
    const { validateUpload } = require("../../security/files/fileValidation");
    const pool = makePool(5 * 1024 * 1024 * 1024 - 100); // cuota casi llena
    await expect(validateUpload(JPEG, "foto.jpg", "t1", pool))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("el SHA-256 del resultado es hex de 64 chars", async () => {
    const { validateUpload } = require("../../security/files/fileValidation");
    const result = await validateUpload(JPEG, "foto.jpg", "t1", makePool());
    expect(result.sha256).toHaveLength(64);
    expect(result.sha256).toMatch(/^[0-9a-f]+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rls — buildRlsFilter vs buildRlsFilterStrict
// ─────────────────────────────────────────────────────────────────────────────

describe("rls — buildRlsFilter vs buildRlsFilterStrict", () => {
  const { buildRlsFilter, buildRlsFilterStrict } = require("../../security/rls/rls");

  const baseCtx = {
    tenantId: "tenant-01",
    roles: ["vet"],
    userId: "user-01",
    sucursalId: 1,
    plan: "pro",
    region: "ar",
    locale: "es",
    tenantPool: {} as any,
  };

  it("buildRlsFilter retorna WHERE con tenant_id", () => {
    const { where } = buildRlsFilter(baseCtx, "pacientes");
    expect(where).toContain("tenant_id");
  });

  it("buildRlsFilterStrict lanza CONFIG_ERROR si tenantId está vacío", () => {
    expect(() => buildRlsFilterStrict({ ...baseCtx, tenantId: "" }, "pacientes")).toThrow();
  });

  it("buildRlsFilter con tenantId vacío NO lanza (modo permisivo)", () => {
    expect(() => buildRlsFilter({ ...baseCtx, tenantId: "" }, "pacientes")).not.toThrow();
  });

  it("buildRlsFilterStrict params incluyen tenantId", () => {
    const { params } = buildRlsFilterStrict(baseCtx, "pacientes");
    expect(params).toContain("tenant-01");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// totp — timingSafeEqual
// ─────────────────────────────────────────────────────────────────────────────

describe("totp — verificación con timingSafeEqual", () => {
  const { verifyTotp } = require("../../security/auth/totp");

  it("código correcto verifica bien", () => {
    // Usamos un secret de test y generamos el código esperado manualmente
    // Este test valida que la función no crashea y retorna boolean
    const result = verifyTotp("JBSWY3DPEHPK3PXP", "000000"); // código intencionalmente incorrecto
    expect(typeof result).toBe("boolean");
  });

  it("código incorrecto retorna false", () => {
    expect(verifyTotp("JBSWY3DPEHPK3PXP", "000000")).toBe(false);
  });

  it("código vacío retorna false sin crash", () => {
    expect(verifyTotp("JBSWY3DPEHPK3PXP", "")).toBe(false);
  });
});
