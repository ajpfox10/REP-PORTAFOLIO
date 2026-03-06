import request from "supertest";
import { buildTestApp } from "../helpers/testApp";

describe("middleware ipGuard", () => {
  it("bloquea si no está en allowlist", async () => {
    const app = buildTestApp({
      TRUST_PROXY: "true",
      IP_ALLOWLIST: "10.0.0.1",
      IP_BLACKLIST: "",
      RATE_LIMIT_ENABLE: "false",
    });

    await request(app)
      .get("/health")
      .set("X-Forwarded-For", "10.0.0.2")
      .expect(403);
  });

  it("permite si está en allowlist", async () => {
    const app = buildTestApp({
      TRUST_PROXY: "true",
      IP_ALLOWLIST: "10.0.0.1",
      IP_BLACKLIST: "",
      RATE_LIMIT_ENABLE: "false",
    });

    await request(app)
      .get("/health")
      .set("X-Forwarded-For", "10.0.0.1")
      .expect(200);
  });

  it("bloquea si está en blacklist", async () => {
    const app = buildTestApp({
      TRUST_PROXY: "true",
      IP_ALLOWLIST: "",
      IP_BLACKLIST: "8.8.8.8",
      RATE_LIMIT_ENABLE: "false",
    });

    await request(app)
      .get("/health")
      .set("X-Forwarded-For", "8.8.8.8")
      .expect(403);
  });
});
