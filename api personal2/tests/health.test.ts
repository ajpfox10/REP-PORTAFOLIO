import request from "supertest";
import { buildTestApp } from "./helpers/testApp";

describe("health endpoints", () => {
  it("GET /health returns ok", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/health").expect(200);

    // Aceptamos cualquiera de estos formatos (enterprise-friendly)
    // - { ok: true }
    // - { status: "ok" }
    // - { ok: true, ... }
    expect(res.body).toBeDefined();
    if (typeof res.body === "object" && res.body !== null) {
      if ("ok" in res.body) expect(res.body.ok).toBe(true);
    }
  });

  it("GET /ready returns ok", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/ready").expect(200);

    expect(res.body).toBeDefined();
    if (typeof res.body === "object" && res.body !== null) {
      if ("ok" in res.body) expect(res.body.ok).toBe(true);
    }
  });
});
