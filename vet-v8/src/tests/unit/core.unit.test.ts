/**
 * Unit tests — funciones puras, sin DB ni HTTP.
 * Ejecutar: jest --testPathPattern=unit
 */

import { planHasModule, PLAN_MODULE_CATALOG } from "../../infra/plan-limits/planGuard";
import { validateEnv } from "../../infra/startup/validateEnv";
import { toCents, fromCents, calcIva, sumCents, formatARS } from "../../infra/money/money";
import { TURNO_TRANSITIONS } from "../../modules/turnos/turnosRouter";
import { defaultRolePerms } from "../../security/rbac/rbacService";
import { hasPermission } from "../../security/rbac/rbacService";

// ─────────────────────────────────────────────────────────────────────────────
// planGuard
// ─────────────────────────────────────────────────────────────────────────────

describe("planHasModule", () => {
  it("basic → turnos: permitido", () => expect(planHasModule("basic", "turnos")).toBe(true));
  it("basic → facturacion: bloqueado (requiere pro)", () => expect(planHasModule("basic", "facturacion")).toBe(false));
  it("basic → internaciones: bloqueado (requiere pro)", () => expect(planHasModule("basic", "internaciones")).toBe(false));
  it("pro → facturacion: permitido", () => expect(planHasModule("pro", "facturacion")).toBe(true));
  it("pro → internaciones: permitido", () => expect(planHasModule("pro", "internaciones")).toBe(true));
  it("pro → whatsapp: bloqueado (requiere enterprise)", () => expect(planHasModule("pro", "whatsapp")).toBe(false));
  it("enterprise → whatsapp: permitido", () => expect(planHasModule("enterprise", "whatsapp")).toBe(true));
  it("enterprise → afip_facturacion: permitido", () => expect(planHasModule("enterprise", "afip_facturacion")).toBe(true));
  it("enterprise → todos los módulos pro y basic: permitido", () => {
    expect(planHasModule("enterprise", "facturacion")).toBe(true);
    expect(planHasModule("enterprise", "pacientes")).toBe(true);
    expect(planHasModule("enterprise", "portal_propietario")).toBe(true);
  });
  it("custom → todo: permitido", () => {
    expect(planHasModule("custom", "whatsapp")).toBe(true);
    expect(planHasModule("custom", "sso")).toBe(true);
  });
  it("módulo desconocido → sin restricción (fail-open)", () => {
    expect(planHasModule("basic", "modulo_inventado")).toBe(true);
  });
  it("desparasitaciones es basic (no pro)", () => {
    expect(planHasModule("basic", "desparasitaciones")).toBe(true);
  });
  it("prescripciones es basic", () => {
    expect(planHasModule("basic", "prescripciones")).toBe(true);
  });
  it("todos los módulos del catálogo tienen tier válido", () => {
    const valid = new Set(["basic", "pro", "enterprise", "custom"]);
    for (const [mod, tier] of Object.entries(PLAN_MODULE_CATALOG)) {
      expect(valid.has(tier)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateEnv
// ─────────────────────────────────────────────────────────────────────────────

describe("validateEnv", () => {
  const goodEnv = {
    NODE_ENV: "production",
    JWT_SECRET: "super-secure-jwt-secret-key-at-least-32chars!!",
    JWT_REFRESH_SECRET: "another-secure-refresh-secret-32chars-ok!!",
    MASTER_DB_HOST: "db.internal",
    MASTER_DB_USER: "vetpro_app",
    MASTER_DB_PASSWORD: "Str0ng!P@ssw0rd#2024",
    MASTER_DB_NAME: "vetpro_master",
    REDIS_URL: "redis://:password@redis:6379",
    ENCRYPTION_MASTER_SECRET: "encryption-master-secret-must-be-at-least-32chars!!",
  };

  it("pasa con entorno bien configurado", () => {
    expect(() => validateEnv(goodEnv)).not.toThrow();
  });

  it.each([
    ["JWT_SECRET"],
    ["JWT_REFRESH_SECRET"],
    ["MASTER_DB_PASSWORD"],
    ["REDIS_URL"],
    ["ENCRYPTION_MASTER_SECRET"],
  ] as [string][][])("falla cuando %s está ausente", (key) => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    const env = { ...goodEnv };
    delete (env as any)[key];
    expect(() => validateEnv(env)).toThrow();
    mockExit.mockRestore();
  });

  it.each([
    ["JWT_SECRET",              "CHANGE_ME"],
    ["JWT_SECRET",              "short"],
    ["MASTER_DB_PASSWORD",      "password"],
    ["MASTER_DB_PASSWORD",      "root"],
    ["MASTER_DB_PASSWORD",      "1234"],
    ["MASTER_DB_PASSWORD",      "CHANGE_IN_PRODUCTION"],
    ["ENCRYPTION_MASTER_SECRET","short_key"],
  ] as [string, string][][])("falla con valor inseguro %s=%s", (key, val) => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });
    expect(() => validateEnv({ ...goodEnv, [key]: val })).toThrow();
    mockExit.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Money helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("money — aritmética en centavos", () => {
  describe("toCents", () => {
    it("convierte pesos a centavos", () => {
      expect(toCents(10.99)).toBe(1099);
      expect(toCents(0)).toBe(0);
      expect(toCents(100)).toBe(10000);
    });
    it("resuelve el problema clásico de float (0.1+0.2)", () => {
      expect(toCents(0.1 + 0.2)).toBe(30); // no 29 ni 31
    });
    it("redondea al centavo más cercano", () => {
      expect(toCents(0.995)).toBe(100);
      expect(toCents(0.994)).toBe(99);
    });
  });

  describe("fromCents", () => {
    it("convierte centavos a pesos", () => {
      expect(fromCents(1099)).toBe(10.99);
      expect(fromCents(0)).toBe(0);
      expect(fromCents(10000)).toBe(100);
    });
    it("round-trip sin pérdida de precisión", () => {
      for (const a of [10.99, 0.01, 999.99, 1234.56, 0.10]) {
        expect(fromCents(toCents(a))).toBe(a);
      }
    });
  });

  describe("calcIva", () => {
    it("calcula IVA 21% correctamente", () => {
      expect(calcIva(1000, 21)).toBe(210); // 21% de $10.00 = $2.10
    });
    it("calcula IVA 10.5% correctamente", () => {
      expect(calcIva(1000, 10.5)).toBe(105);
    });
    it("IVA 0% devuelve 0", () => {
      expect(calcIva(1000, 0)).toBe(0);
    });
    it("subtotal 0 devuelve IVA 0", () => {
      expect(calcIva(0, 21)).toBe(0);
    });
  });

  describe("sumCents", () => {
    it("suma array de centavos", () => expect(sumCents([100, 200, 300])).toBe(600));
    it("array vacío devuelve 0", () => expect(sumCents([])).toBe(0));
    it("redondea valores antes de sumar", () => expect(sumCents([100.4, 200.6])).toBe(301));
  });

  describe("factura sin floating point errors", () => {
    it("3 ítems con IVA mixto → total es entero", () => {
      const items = [
        { precio: 10.99, qty: 2, iva: 21 },
        { precio: 5.50,  qty: 1, iva: 10.5 },
        { precio: 100.0, qty: 1, iva: 21 },
      ];
      let subtotal = 0, iva = 0;
      for (const it of items) {
        const sub = toCents(it.precio * it.qty);
        subtotal += sub;
        iva += calcIva(sub, it.iva);
      }
      const total = subtotal + iva;
      expect(total % 1).toBe(0);          // entero
      expect(fromCents(total)).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TURNO state machine
// ─────────────────────────────────────────────────────────────────────────────

describe("TURNO_TRANSITIONS — máquina de estados", () => {
  it("pendiente puede pasar a confirmado", () => {
    expect(TURNO_TRANSITIONS["pendiente"]).toContain("confirmado");
  });
  it("pendiente puede pasar a cancelado", () => {
    expect(TURNO_TRANSITIONS["pendiente"]).toContain("cancelado");
  });
  it("pendiente NO puede pasar directo a completado", () => {
    expect(TURNO_TRANSITIONS["pendiente"]).not.toContain("completado");
  });
  it("confirmado puede pasar a completado", () => {
    expect(TURNO_TRANSITIONS["confirmado"]).toContain("completado");
  });
  it("confirmado puede pasar a no_show", () => {
    expect(TURNO_TRANSITIONS["confirmado"]).toContain("no_show");
  });
  it("cancelado es terminal — sin transiciones posibles", () => {
    expect(TURNO_TRANSITIONS["cancelado"]).toHaveLength(0);
  });
  it("completado es terminal", () => {
    expect(TURNO_TRANSITIONS["completado"]).toHaveLength(0);
  });
  it("no_show es terminal", () => {
    expect(TURNO_TRANSITIONS["no_show"]).toHaveLength(0);
  });
  it("todos los estados están definidos en la tabla", () => {
    for (const e of ["pendiente","confirmado","cancelado","completado","no_show"]) {
      expect(TURNO_TRANSITIONS).toHaveProperty(e);
    }
  });
  it("ningún estado terminal tiene transiciones hacia cancelado (desde él)", () => {
    for (const [from, to] of Object.entries(TURNO_TRANSITIONS)) {
      if (["cancelado","completado","no_show"].includes(from)) {
        expect((to as string[]).length).toBe(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conflicto de horarios (lógica pura)
// ─────────────────────────────────────────────────────────────────────────────

describe("conflicto de horarios de turnos", () => {
  function overlaps(
    existStart: string, existDur: number,
    newStart: string,   newDur: number
  ): boolean {
    const es = new Date(existStart).getTime();
    const ee = es + existDur * 60_000;
    const ns = new Date(newStart).getTime();
    const ne = ns + newDur * 60_000;
    return ns < ee && ne > es;
  }

  it("solapamiento total: nuevo empieza dentro del existente", () => {
    expect(overlaps("2026-03-10T10:00", 30, "2026-03-10T10:15", 30)).toBe(true);
  });
  it("solapamiento: nuevo engloba al existente", () => {
    expect(overlaps("2026-03-10T10:15", 15, "2026-03-10T10:00", 60)).toBe(true);
  });
  it("sin solapamiento: nuevo empieza al terminar el existente", () => {
    expect(overlaps("2026-03-10T10:00", 30, "2026-03-10T10:30", 30)).toBe(false);
  });
  it("sin solapamiento: nuevo es antes del existente", () => {
    expect(overlaps("2026-03-10T11:00", 30, "2026-03-10T10:00", 30)).toBe(false);
  });
  it("sin solapamiento: nuevo es después", () => {
    expect(overlaps("2026-03-10T10:00", 30, "2026-03-10T11:00", 30)).toBe(false);
  });
  it("solapamiento exacto (mismo horario, mismo vet)", () => {
    expect(overlaps("2026-03-10T10:00", 30, "2026-03-10T10:00", 30)).toBe(true);
  });
  it("solapamiento parcial: nuevo termina dentro del existente", () => {
    expect(overlaps("2026-03-10T10:00", 60, "2026-03-10T09:45", 30)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC — permisos por rol
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC — defaultRolePerms", () => {
  it("admin tiene permisos globales", () => {
    const perms = defaultRolePerms("admin");
    expect(perms).toContain("db:*:*");
    expect(perms).toContain("billing:*");
    expect(perms).toContain("audit:*");
  });

  it("vet puede acceder a prescripciones (fix v6)", () => {
    const perms = defaultRolePerms("vet");
    expect(perms.some(p => p.includes("prescripciones"))).toBe(true);
  });

  it("vet puede acceder a internaciones (fix v6)", () => {
    const perms = defaultRolePerms("vet");
    expect(perms.some(p => p.includes("internaciones"))).toBe(true);
  });

  it("staff puede vender (fix v6)", () => {
    const perms = defaultRolePerms("staff");
    expect(perms.some(p => p.includes("ventas"))).toBe(true);
  });

  it("staff NO tiene permisos de billing ni admin", () => {
    const perms = defaultRolePerms("staff");
    expect(perms).not.toContain("billing:*");
    expect(perms).not.toContain("db:*:*");
  });

  it("owner (portal) tiene solo permisos de portal:read", () => {
    const perms = defaultRolePerms("owner");
    expect(perms).toContain("portal:read");
    expect(perms).not.toContain("db:*:*");
  });

  it("viewer tiene acceso mínimo solo lectura", () => {
    const perms = defaultRolePerms("viewer");
    expect(perms.every(p => p.includes(":read"))).toBe(true);
  });

  it("rol desconocido devuelve array vacío (no falla)", () => {
    expect(defaultRolePerms("rol_inventado")).toEqual([]);
  });

  describe("hasPermission", () => {
    it("wildcard * hace match de cualquier acción", () => {
      expect(hasPermission(["db:pacientes:*"], "db:pacientes:read")).toBe(true);
      expect(hasPermission(["db:pacientes:*"], "db:pacientes:create")).toBe(true);
    });
    it("doble wildcard hace match de cualquier recurso y acción", () => {
      expect(hasPermission(["db:*:*"], "db:facturas:delete")).toBe(true);
    });
    it("permiso específico NO hace match de otro recurso", () => {
      expect(hasPermission(["db:pacientes:read"], "db:facturas:read")).toBe(false);
    });
    it("array vacío no tiene ningún permiso", () => {
      expect(hasPermission([], "db:pacientes:read")).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Availability slots — lógica pura
// ─────────────────────────────────────────────────────────────────────────────

describe("slots de disponibilidad", () => {
  function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function fromMinutes(mins: number): string {
    return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`;
  }
  function generateSlots(horaInicio: string, horaFin: string, slotDur: number): string[] {
    const slots: string[] = [];
    const start = toMinutes(horaInicio);
    const end = toMinutes(horaFin);
    for (let m = start; m + slotDur <= end; m += slotDur) {
      slots.push(fromMinutes(m));
    }
    return slots;
  }

  it("09:00-12:00 con slots de 30min genera 6 slots", () => {
    expect(generateSlots("09:00", "12:00", 30)).toHaveLength(6);
  });
  it("primer slot es 09:00", () => {
    expect(generateSlots("09:00", "12:00", 30)[0]).toBe("09:00");
  });
  it("último slot es 11:30 (no 12:00 ya que dura 30 min)", () => {
    const slots = generateSlots("09:00", "12:00", 30);
    expect(slots[slots.length - 1]).toBe("11:30");
  });
  it("slots de 15min genera el doble que slots de 30min", () => {
    const s30 = generateSlots("09:00", "12:00", 30);
    const s15 = generateSlots("09:00", "12:00", 15);
    expect(s15.length).toBe(s30.length * 2);
  });
  it("rango vacío genera 0 slots", () => {
    expect(generateSlots("09:00", "09:00", 30)).toHaveLength(0);
  });
  it("slot que no cabe en el rango no se genera", () => {
    // 09:00-09:20 con slots de 30min → no cabe ninguno
    expect(generateSlots("09:00", "09:20", 30)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Numeración AFIP
// ─────────────────────────────────────────────────────────────────────────────

describe("numeración AFIP", () => {
  function buildNumero(tipo: string, puntoVenta: number, num: number): string {
    return `${tipo}-${String(puntoVenta).padStart(4,"0")}-${String(num).padStart(8,"0")}`;
  }

  it("formato correcto TIPO-PPPP-NNNNNNNN", () => {
    expect(buildNumero("B", 1, 1)).toBe("B-0001-00000001");
  });
  it("tipo A con punto de venta 2, número 100", () => {
    expect(buildNumero("A", 2, 100)).toBe("A-0002-00000100");
  });
  it("regex de validación del formato", () => {
    expect(/^[A-Z]-\d{4}-\d{8}$/.test("B-0001-00000001")).toBe(true);
    expect(/^[A-Z]-\d{4}-\d{8}$/.test("B-1-1")).toBe(false);
  });
  it("números grandes no rompen el formato", () => {
    const n = buildNumero("C", 9999, 99999999);
    expect(n).toBe("C-9999-99999999");
    expect(n.length).toBe(15); // 1+1+4+1+8
  });
});
