/**
 * Integration tests — HTTP real con Express + DB/Redis mockeados.
 *
 * No requieren DB ni Redis reales. Usan mocks que retornan datos predecibles.
 * El objetivo: detectar bugs de routing, validación, RBAC, y serialización.
 *
 * Ejecutar: jest --testPathPattern=integration
 */

import express from "express";
import request from "supertest";

// ── Mock factory ────────────────────────────────────────────────────────────

function makeMockPool(rows: any[] = [], insertId = 1) {
  const mockQuery = jest.fn().mockImplementation((sql: string) => {
    if (String(sql).includes("COUNT(*)")) return [[{ total: rows.length }]];
    if (String(sql).toLowerCase().startsWith("insert")) return [{ insertId, affectedRows: 1 }];
    if (/^(update|delete)/i.test(String(sql).trim())) return [{ affectedRows: 1 }];
    if (String(sql).toLowerCase().startsWith("create")) return [[]];
    return [rows];
  });

  return {
    query: mockQuery,
    getConnection: jest.fn().mockResolvedValue({
      query: mockQuery,
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    }),
  };
}

function makeCtx(overrides: Partial<any> = {}) {
  return {
    tenantId: "tenant-test-01",
    tenantPool: makeMockPool(),
    userId: "user-001",
    sessionId: "sess-001",
    roles: ["admin"],
    plan: "pro",
    sucursalId: null,
    veterinarioId: null,
    propietarioId: null,
    ip: "127.0.0.1",
    ...overrides,
  };
}

function withCtx(ctx: any) {
  return (req: any, _res: any, next: any) => {
    req.ctx = ctx;
    req.id  = "test-request-id";
    next();
  };
}

function errHandler(err: any, _req: any, res: any, _next: any) {
  res.status(err.status ?? err.statusCode ?? 500).json({
    code: err.code ?? "ERROR",
    message: err.message,
  });
}

// ── turnosRouter ────────────────────────────────────────────────────────────

describe("turnosRouter", () => {
  const mockTurno = {
    id: 1, fecha_hora: "2026-03-10 10:00:00", duracion_min: 30,
    motivo: "vacuna", estado: "pendiente",
    vet_nombre: "Juan", vet_apellido: "Pérez", color_agenda: "#3b82f6",
    paciente_nombre: "Firulais", especie: "perro",
    propietario_nombre: "María", propietario_apellido: "García",
    propietario_telefono: "1122334455", propietario_email: "maria@test.com",
    sucursal_nombre: "Sede Central", recordatorio_env: 0,
    created_at: "2026-03-05T00:00:00Z",
  };

  function buildApp(ctxOverrides: any = {}) {
    const pool = makeMockPool([mockTurno]);
    const ctx = makeCtx({ tenantPool: pool, ...ctxOverrides });
    // Dynamic import because module has side-effects
    const { buildTurnosRouter } = require("../../modules/turnos/turnosRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/api/v1/turnos", buildTurnosRouter());
    app.use(errHandler);
    return { app, pool };
  }

  it("GET / — devuelve lista paginada con meta.total", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/turnos");
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 50 });
    expect(res.body.meta).toHaveProperty("total");
  });

  it("GET /hoy/agenda — ruta estática NO es capturada por /:id", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/turnos/hoy/agenda");
    // El bug de v5 retornaba 400 "id inválido". Ahora debe ser 200.
    expect(res.status).toBe(200);
  });

  it("GET /slots — sin params retorna 400", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/turnos/slots");
    expect(res.status).toBe(400);
  });

  it("GET /slots — con params válidos devuelve slots array", async () => {
    const { app, pool } = buildApp();
    // Sin reglas de agenda → devuelve vacío igual pero sin error
    pool.query.mockResolvedValue([[]]);
    const res = await request(app)
      .get("/api/v1/turnos/slots?veterinario_id=1&fecha=2026-03-10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("slots");
  });

  it("POST / — sin veterinario_id retorna 400", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/turnos")
      .send({ fecha_hora: "2026-03-10 10:00", motivo: "consulta" });
    expect(res.status).toBe(400);
  });

  it("POST / — detecta conflicto y retorna 409", async () => {
    const { app, pool } = buildApp();
    pool.query.mockImplementation((sql: string) => {
      if (String(sql).includes("AND estado NOT IN")) return [[{ id: 99 }]]; // conflicto
      return [[]];
    });
    const res = await request(app)
      .post("/api/v1/turnos")
      .send({ veterinario_id: 1, fecha_hora: "2026-03-10 10:00" });
    expect(res.status).toBe(409);
  });

  it("PATCH /:id/estado — transición cancelado→confirmado retorna 409", async () => {
    const { app, pool } = buildApp();
    pool.query.mockImplementation((sql: string) => {
      if (String(sql).includes("SELECT estado")) return [[{ estado: "cancelado" }]];
      return [[]];
    });
    const res = await request(app)
      .patch("/api/v1/turnos/1/estado")
      .send({ estado: "confirmado" });
    expect(res.status).toBe(409);
  });

  it("DELETE /:id — viewer recibe 403", async () => {
    const { app } = buildApp({ roles: ["viewer"] });
    const res = await request(app).delete("/api/v1/turnos/1");
    expect(res.status).toBe(403);
  });

  it("GET /:id con id=hoy retorna 400 (id inválido)", async () => {
    const { app } = buildApp();
    // Ahora /:id valida que sea número
    const res = await request(app).get("/api/v1/turnos/hoy");
    expect(res.status).toBe(400);
  });
});

// ── visitsRouter — aislamiento multi-tenant ─────────────────────────────────

describe("visitsRouter — tenant isolation (bug crítico v6)", () => {
  it("GET /:id incluye tenant_id=tenantA en el WHERE (no puede ver datos de tenantB)", async () => {
    const pool = makeMockPool([{ id: 1, paciente_id: 1, is_active: 1 }]);
    pool.query.mockImplementation((sql: string, params: any[]) => {
      // Para SELECT que incluye id=? debería también tener tenant_id
      if (String(sql).includes("c.id=?")) {
        expect(params).toContain("tenant-A");
      }
      return [[{ id: 1, paciente_id: 1, is_active: 1, paciente_nombre: "Test", especie: "perro", vet_nombre: null, vet_apellido: null }]];
    });

    const ctx = makeCtx({ tenantPool: pool, tenantId: "tenant-A" });
    const { buildVisitsRouter } = require("../../modules/clinical/visitsRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/api/v1/visits", buildVisitsRouter());

    await request(app).get("/api/v1/visits/1");
    // Si llega aquí sin lanzar en el expect, el test pasó
  });

  it("PATCH /:id incluye tenant_id en UPDATE", async () => {
    const visit = { id: 1, paciente_id: 5, tenant_id: "tenant-A", motivo: "original", is_active: 1 };
    const pool = makeMockPool([visit]);
    let updateParams: any[] = [];
    pool.query.mockImplementation((sql: string, params: any[]) => {
      if (/^update consultas/i.test(String(sql).trim())) updateParams = params ?? [];
      if (/^select/i.test(String(sql).trim())) return [[visit]];
      return [{ affectedRows: 1 }];
    });

    const ctx = makeCtx({ tenantPool: pool, tenantId: "tenant-A" });
    const { buildVisitsRouter } = require("../../modules/clinical/visitsRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/api/v1/visits", buildVisitsRouter());
    app.use(errHandler);

    await request(app).patch("/api/v1/visits/1").send({ motivo: "nuevo" });
    expect(updateParams).toContain("tenant-A");
  });
});

// ── planGuard ────────────────────────────────────────────────────────────────

describe("planGuard middleware", () => {
  it("bloquea módulo pro para tenant basic con 403 PLAN_REQUIRED", async () => {
    const ctx = makeCtx({ plan: "basic" });
    const { buildFacturacionRouter } = require("../../modules/facturacion/facturacionRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/facturacion", buildFacturacionRouter());
    app.use(errHandler);

    const res = await request(app).get("/facturacion");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_REQUIRED");
  });

  it("permite módulo pro para tenant pro", async () => {
    const pool = makeMockPool([]);
    const ctx = makeCtx({ plan: "pro", tenantPool: pool });
    const { buildFacturacionRouter } = require("../../modules/facturacion/facturacionRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/facturacion", buildFacturacionRouter());

    const res = await request(app).get("/facturacion");
    expect(res.status).toBe(200);
  });

  it("bloquea módulo enterprise para tenant pro", async () => {
    const ctx = makeCtx({ plan: "pro" });
    const { buildWhatsAppRouter } = require("../../infra/whatsapp/whatsappRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/whatsapp", buildWhatsAppRouter({ config: {} as any }));
    app.use(errHandler);

    const res = await request(app).get("/whatsapp/any");
    expect(res.status).toBe(403);
  });
});

// ── salesRouter ──────────────────────────────────────────────────────────────

describe("salesRouter", () => {
  it("GET /:id — endpoint existe (bug v5: era 404)", async () => {
    const pool = makeMockPool([{ id: "order-1", total_cents: 5000, status: "paid", created_at: "2026-01-01" }]);
    const ctx = makeCtx({ tenantPool: pool });
    const { buildSalesRouter } = require("../../modules/inventory/salesRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/sales", buildSalesRouter());
    app.use(errHandler);

    const res = await request(app).get("/sales/order-1");
    // 200 o 404, pero nunca 404 de "ruta no encontrada" (que sería distinto)
    expect([200, 404]).toContain(res.status);
    // Verificar que hay body JSON, no HTML de Express
    expect(res.type).toMatch(/json/);
  });

  it("POST / — viewer no puede crear venta", async () => {
    const ctx = makeCtx({ roles: ["viewer"] });
    const { buildSalesRouter } = require("../../modules/inventory/salesRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/sales", buildSalesRouter());
    app.use(errHandler);

    const res = await request(app)
      .post("/sales")
      .send({ items: [{ producto_id: 1, qty: 1 }] });
    expect(res.status).toBe(403);
  });
});

// ── facturacionRouter — fix bug body fuera de scope ──────────────────────────

describe("facturacionRouter — /emitir", () => {
  it("POST /emitir — NO crashea con TypeError (body.tipo fuera de scope)", async () => {
    const factura = { id: 1, estado: "borrador", tipo: "B", sucursal_id: null };
    const pool = makeMockPool([factura]);
    pool.query.mockImplementation((sql: string) => {
      if (String(sql).includes("SELECT id, estado")) return [[factura]];
      if (/create table/i.test(String(sql))) return [[]];
      if (/insert into factura_numeracion/i.test(String(sql))) return [{ affectedRows: 1 }];
      if (/select ultimo_num/i.test(String(sql))) return [[{ ultimo_num: 1 }]];
      if (/update facturas/i.test(String(sql))) return [{ affectedRows: 1 }];
      return [[]];
    });
    pool.getConnection.mockResolvedValue({
      query: pool.query,
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    });

    const ctx = makeCtx({ tenantPool: pool, plan: "pro" });
    const { buildFacturacionRouter } = require("../../modules/facturacion/facturacionRouter");
    const app = express();
    app.use(express.json());
    app.use(withCtx(ctx));
    app.use("/facturacion", buildFacturacionRouter());
    app.use(errHandler);

    const res = await request(app).post("/facturacion/1/emitir");
    // Antes crasheaba con 500 ReferenceError: body is not defined
    expect(res.status).not.toBe(500);
    if (res.status === 200) {
      expect(res.body.data.numero).toMatch(/^[A-Z]-\d{4}-\d{8}$/);
    }
  });
});
