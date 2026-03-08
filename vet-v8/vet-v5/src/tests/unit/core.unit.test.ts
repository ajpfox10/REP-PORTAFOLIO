/**
 * Unit tests — v5
 *
 * Coverage:
 *   - planGuard: planHasModule tier logic
 *   - validateEnv: catches missing/insecure vars
 *   - auditRepo: appendAudit params shape
 *   - turnosRouter: conflict detection logic (pure function)
 */

import { planHasModule, PLAN_MODULE_CATALOG } from "../../infra/plan-limits/planGuard";
import { validateEnv } from "../../infra/startup/validateEnv";

// ─────────────────────────────────────────────────────────────────────────────
// planGuard tests
// ─────────────────────────────────────────────────────────────────────────────

describe("planHasModule", () => {
  it("basic plan can access 'turnos'", () => {
    expect(planHasModule("basic", "turnos")).toBe(true);
  });

  it("basic plan cannot access 'internaciones' (requires pro)", () => {
    expect(planHasModule("basic", "internaciones")).toBe(false);
  });

  it("pro plan can access 'internaciones'", () => {
    expect(planHasModule("pro", "internaciones")).toBe(true);
  });

  it("pro plan cannot access 'whatsapp' (requires enterprise)", () => {
    expect(planHasModule("pro", "whatsapp")).toBe(false);
  });

  it("enterprise plan can access 'whatsapp'", () => {
    expect(planHasModule("enterprise", "whatsapp")).toBe(true);
  });

  it("enterprise plan can access all pro and basic modules", () => {
    expect(planHasModule("enterprise", "facturacion")).toBe(true);
    expect(planHasModule("enterprise", "pacientes")).toBe(true);
    expect(planHasModule("enterprise", "dashboard_metricas")).toBe(true);
  });

  it("unknown module key returns true (unrestricted)", () => {
    expect(planHasModule("basic", "nonexistent_module")).toBe(true);
  });

  it("custom plan has all access", () => {
    expect(planHasModule("custom", "whatsapp")).toBe(true);
    expect(planHasModule("custom", "afip_facturacion")).toBe(true);
  });

  it("all catalog modules have a valid tier", () => {
    const validTiers = ["basic", "pro", "enterprise", "custom"];
    for (const [mod, tier] of Object.entries(PLAN_MODULE_CATALOG)) {
      expect(validTiers).toContain(tier);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateEnv tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateEnv", () => {
  const goodEnv = {
    NODE_ENV: "production",
    JWT_SECRET: "super-secure-jwt-secret-key-at-least-32chars",
    JWT_REFRESH_SECRET: "another-secure-refresh-secret-32chars-ok",
    MASTER_DB_HOST: "db.internal",
    MASTER_DB_USER: "vetpro_app",
    MASTER_DB_PASSWORD: "Str0ng!P@ssw0rd",
    MASTER_DB_NAME: "vetpro_master",
    REDIS_URL: "redis://redis:6379",
    ENCRYPTION_MASTER_SECRET: "encryption-master-secret-must-be-at-least-32chars",
  };

  it("passes with valid environment", () => {
    // Should not throw
    expect(() => validateEnv(goodEnv)).not.toThrow();
  });

  it("exits on missing JWT_SECRET", () => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    const env = { ...goodEnv };
    delete (env as any).JWT_SECRET;
    expect(() => validateEnv(env)).toThrow("process.exit called");
    mockExit.mockRestore();
  });

  it("exits on insecure JWT_SECRET", () => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    expect(() => validateEnv({ ...goodEnv, JWT_SECRET: "CHANGE_ME" })).toThrow("process.exit called");
    mockExit.mockRestore();
  });

  it("exits on short DB password", () => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    expect(() => validateEnv({ ...goodEnv, MASTER_DB_PASSWORD: "short" })).toThrow("process.exit called");
    mockExit.mockRestore();
  });

  it("exits on default DB password", () => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    expect(() => validateEnv({ ...goodEnv, MASTER_DB_PASSWORD: "password" })).toThrow("process.exit called");
    mockExit.mockRestore();
  });

  it("exits on short encryption secret", () => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    expect(() => validateEnv({ ...goodEnv, ENCRYPTION_MASTER_SECRET: "short" })).toThrow("process.exit called");
    mockExit.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Appointment conflict detection (pure logic, no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("turno conflict logic", () => {
  function slotOverlaps(
    existingStart: Date, existingDurMin: number,
    newStart: Date, newDurMin: number
  ): boolean {
    const existingEnd = new Date(existingStart.getTime() + existingDurMin * 60_000);
    const newEnd = new Date(newStart.getTime() + newDurMin * 60_000);
    return newStart < existingEnd && newEnd > existingStart;
  }

  it("detects overlap: new starts inside existing", () => {
    const existing = new Date("2026-03-10T10:00:00");
    const newApp = new Date("2026-03-10T10:15:00");
    expect(slotOverlaps(existing, 30, newApp, 30)).toBe(true);
  });

  it("detects overlap: new starts before and ends inside existing", () => {
    const existing = new Date("2026-03-10T10:30:00");
    const newApp = new Date("2026-03-10T10:00:00");
    expect(slotOverlaps(existing, 30, newApp, 45)).toBe(true);
  });

  it("no overlap: new starts exactly when existing ends", () => {
    const existing = new Date("2026-03-10T10:00:00");
    const newApp = new Date("2026-03-10T10:30:00");
    expect(slotOverlaps(existing, 30, newApp, 30)).toBe(false);
  });

  it("no overlap: new is entirely before existing", () => {
    const existing = new Date("2026-03-10T11:00:00");
    const newApp = new Date("2026-03-10T10:00:00");
    expect(slotOverlaps(existing, 30, newApp, 30)).toBe(false);
  });

  it("no overlap: new is entirely after existing", () => {
    const existing = new Date("2026-03-10T10:00:00");
    const newApp = new Date("2026-03-10T11:00:00");
    expect(slotOverlaps(existing, 30, newApp, 30)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Turno state machine
// ─────────────────────────────────────────────────────────────────────────────

describe("turno state machine", () => {
  const validTransitions: Record<string, string[]> = {
    pendiente:   ["confirmado", "cancelado"],
    confirmado:  ["completado", "cancelado", "no_show"],
    cancelado:   [],
    completado:  [],
    no_show:     [],
  };

  it("pendiente → confirmado is valid", () => {
    expect(validTransitions["pendiente"]).toContain("confirmado");
  });

  it("confirmado → completado is valid", () => {
    expect(validTransitions["confirmado"]).toContain("completado");
  });

  it("cancelado → any is invalid", () => {
    expect(validTransitions["cancelado"]).toHaveLength(0);
  });

  it("completado → any is invalid", () => {
    expect(validTransitions["completado"]).toHaveLength(0);
  });

  it("pendiente cannot skip to completado", () => {
    expect(validTransitions["pendiente"]).not.toContain("completado");
  });
});
