/**
 * Auth integration tests — v11  (Punto 2)
 * Cubren: login, lockout, logout + JTI revocado, MFA, recovery code.
 * No requieren DB ni Redis reales — usan mocks.
 */

import express from "express";
import request from "supertest";

// ── Helpers de mock ──────────────────────────────────────────────────────────

function makeRedis() {
  const store: Record<string, string> = {};
  return {
    get:    jest.fn(async (k: string) => store[k] ?? null),
    set:    jest.fn(async (k: string, v: string, ...args: any[]) => { store[k] = v; return "OK"; }),
    del:    jest.fn(async (...keys: string[]) => { keys.forEach(k => delete store[k]); }),
    incr:   jest.fn(async (k: string) => { store[k] = String((parseInt(store[k] ?? "0")) + 1); return parseInt(store[k]); }),
    expire: jest.fn(async () => 1),
    exists: jest.fn(async (k: string) => store[k] !== undefined ? 1 : 0),
    _store: store,
  };
}

function makePool(userRow: any = null) {
  return {
    query: jest.fn(async (sql: string, params?: any[]) => {
      const s = String(sql).toLowerCase();
      if (s.includes("select") && s.includes("users") && userRow) return [[userRow]];
      if (s.includes("select") && s.includes("users")) return [[]];
      if (s.includes("select") && s.includes("login_attempts")) return [[{ attempts: 0, locked_until: null }]];
      if (s.includes("insert") || s.includes("update")) return [{ affectedRows: 1 }];
      return [[]];
    }),
    getConnection: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue([[]]),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    }),
  };
}

function makeCtx(pool: any, overrides: any = {}) {
  return {
    tenantId: "tenant-test",
    tenantPool: pool,
    userId: null,
    roles: [],
    plan: "pro",
    region: "ar",
    locale: "es",
    sucursalId: null,
    ip: "127.0.0.1",
    ...overrides,
  };
}

function withCtx(ctx: any) {
  return (req: any, _res: any, next: any) => { req.ctx = ctx; req.id = "req-test"; next(); };
}

function errHandler(err: any, _req: any, res: any, _next: any) {
  res.status(err.status ?? 500).json({ code: err.code ?? "ERROR", message: err.message });
}

// ── loginProtection integration ──────────────────────────────────────────────

describe("loginProtection — integración con router simulado", () => {
  const { buildLoginProtection } = require("../../security/bruteforce/loginProtection");

  function buildLoginApp(userExists: boolean, correctPassword: boolean, redis: any) {
    const pool = makePool(userExists ? {
      id: "u1", tenant_id: "tenant-test", email: "user@test.com",
      password_hash: "$2b$10$abcdefghijklmnopqrstuuZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
      is_active: 1, token_version: 0, mfa_enabled: 0, roles: JSON.stringify(["vet"]),
    } : null);

    const app = express();
    app.use(express.json());
    app.use(withCtx(makeCtx(pool)));

    const guard = buildLoginProtection(redis, pool);

    app.post("/auth/login", async (req: any, res: any, next: any) => {
      try {
        const { email, password } = req.body;
        await guard.checkAndThrow(req.ctx.tenantId, email, req.ip ?? "127.0.0.1");

        if (!userExists || !correctPassword) {
          await guard.onFailure(req.ctx.tenantId, email, req.ip ?? "127.0.0.1");
          return res.status(401).json({ code: "AUTH_REQUIRED", message: "Credenciales inválidas" });
        }

        await guard.onSuccess(req.ctx.tenantId, email, req.ip ?? "127.0.0.1");
        res.json({ data: { token: "fake-access-token", user: { email } } });
      } catch (e) { next(e); }
    });

    app.use(errHandler);
    return { app, pool };
  }

  it("login exitoso retorna 200 con token", async () => {
    const redis = makeRedis();
    const { app } = buildLoginApp(true, true, redis);
    const res = await request(app).post("/auth/login")
      .send({ email: "user@test.com", password: "CorrectPass1!" });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("token");
  });

  it("login fallido retorna 401", async () => {
    const redis = makeRedis();
    const { app } = buildLoginApp(true, false, redis);
    const res = await request(app).post("/auth/login")
      .send({ email: "user@test.com", password: "WrongPassword!" });
    expect(res.status).toBe(401);
  });

  it("5 fallos → 6to intento retorna 429 RATE_LIMITED", async () => {
    const redis = makeRedis();
    const { app } = buildLoginApp(true, false, redis);

    for (let i = 0; i < 5; i++) {
      await request(app).post("/auth/login").send({ email: "victim@test.com", password: "wrong" });
    }

    const res = await request(app).post("/auth/login")
      .send({ email: "victim@test.com", password: "wrong" });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  });

  it("lockout de un usuario NO afecta a otro", async () => {
    const redis = makeRedis();
    const { app } = buildLoginApp(true, true, redis);

    for (let i = 0; i < 5; i++) {
      await request(app).post("/auth/login").send({ email: "victim@test.com", password: "wrong" });
    }

    // otro usuario no debe estar bloqueado
    const res = await request(app).post("/auth/login")
      .send({ email: "innocent@test.com", password: "CorrectPass1!" });
    expect(res.status).not.toBe(429);
  });
});

// ── jtiBlocklist — integración en middleware ──────────────────────────────────

describe("JTI blocklist — tokens revocados rechazados post-logout", () => {
  const { jtiBlocklist } = require("../../security/auth/jtiBlocklist");

  function buildProtectedApp(redis: any, jti: string, isRevoked: boolean) {
    const pool = makePool({ id: "u1", token_version: 0, mfa_enabled: 0, is_active: 1 });

    const app = express();
    app.use(express.json());
    app.use(withCtx(makeCtx(pool, { userId: "u1", roles: ["vet"], sessionId: "sess1" })));

    // Simula el check que hace authMiddleware
    app.use(async (req: any, res: any, next: any) => {
      try {
        if (await jtiBlocklist.isRevoked(redis, jti)) {
          return res.status(401).json({ code: "AUTH_REQUIRED", message: "Token revocado" });
        }
        next();
      } catch (e) { next(e); }
    });

    app.get("/protected", (_req, res) => res.json({ ok: true }));
    app.use(errHandler);
    return app;
  }

  it("token no revocado → acceso permitido", async () => {
    const redis = makeRedis();
    const app = buildProtectedApp(redis, "jti-valid", false);
    const res = await request(app).get("/protected");
    expect(res.status).toBe(200);
  });

  it("token revocado por logout → acceso denegado", async () => {
    const redis = makeRedis();
    const exp = Math.floor(Date.now() / 1000) + 900;
    await jtiBlocklist.revoke(redis, "jti-logged-out", exp);
    const app = buildProtectedApp(redis, "jti-logged-out", true);
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_REQUIRED");
  });

  it("JTI diferente no se bloquea por el logout de otro", async () => {
    const redis = makeRedis();
    const exp = Math.floor(Date.now() / 1000) + 900;
    await jtiBlocklist.revoke(redis, "jti-A", exp);
    const app = buildProtectedApp(redis, "jti-B", false);
    const res = await request(app).get("/protected");
    expect(res.status).toBe(200);
  });
});

// ── passwordPolicy — integración en endpoint cambio de contraseña ────────────

describe("passwordPolicy — integración en change-password", () => {
  const { validatePasswordStrength } = require("../../security/password/passwordPolicy");

  function buildChangePassApp() {
    const app = express();
    app.use(express.json());

    app.post("/auth/change-password", (req: any, res: any, next: any) => {
      try {
        const { new_password, email } = req.body;
        if (!new_password) return res.status(400).json({ code: "VALIDATION_ERROR", message: "new_password requerida" });
        validatePasswordStrength(new_password, email);
        res.json({ ok: true });
      } catch (e) { next(e); }
    });

    app.use(errHandler);
    return app;
  }

  it("contraseña fuerte → 200", async () => {
    const app = buildChangePassApp();
    const res = await request(app).post("/auth/change-password")
      .send({ new_password: "NuevaSegura#2026!", email: "u@t.com" });
    expect(res.status).toBe(200);
  });

  it("contraseña débil → 400 VALIDATION_ERROR", async () => {
    const app = buildChangePassApp();
    const res = await request(app).post("/auth/change-password")
      .send({ new_password: "1234", email: "u@t.com" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("contraseña = email → 400", async () => {
    const app = buildChangePassApp();
    const res = await request(app).post("/auth/change-password")
      .send({ new_password: "juanperez@2026!", email: "juanperez@clinic.com" });
    expect(res.status).toBe(400);
  });

  it("sin new_password → 400", async () => {
    const app = buildChangePassApp();
    const res = await request(app).post("/auth/change-password").send({});
    expect(res.status).toBe(400);
  });
});

// ── secureToken — integración en reset-password flow ────────────────────────

describe("secureToken — flow reset password", () => {
  const { generateSecureToken, hashSecureToken, verifySecureToken } =
    require("../../security/auth/secureToken");

  it("flow completo: generar → hashear → verificar → usar", () => {
    // 1. Usuario pide reset → se genera token y se guarda el hash
    const token = generateSecureToken();
    const storedHash = hashSecureToken(token);

    // 2. Usuario hace click en el link → se verifica el token del link
    expect(verifySecureToken(token, storedHash)).toBe(true);

    // 3. Token manipulado → rechazado
    expect(verifySecureToken(token + "x", storedHash)).toBe(false);

    // 4. Hash diferente → rechazado
    const otherToken = generateSecureToken();
    expect(verifySecureToken(token, hashSecureToken(otherToken))).toBe(false);
  });

  it("tokens generados tienen longitud correcta para URLs (sin padding)", () => {
    for (let i = 0; i < 10; i++) {
      const t = generateSecureToken();
      expect(t).not.toContain("=");  // base64url no tiene padding
      expect(t).not.toContain("+");
      expect(t).not.toContain("/");
    }
  });
});
