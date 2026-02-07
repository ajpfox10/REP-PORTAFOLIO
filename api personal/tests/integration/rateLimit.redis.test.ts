import request from "supertest";
import { buildTestApp } from "../helpers/testApp";

// ✅ Test de rate limit distribuido con Redis.
// Se ejecuta solo si:
// - TEST_INTEGRATION=1
// - REDIS_URL está configurado

const shouldRun = process.env.TEST_INTEGRATION === "1" && !!(process.env.REDIS_URL || "").trim();

(shouldRun ? describe : describe.skip)("rate limit (redis store)", () => {
  it("devuelve 429 cuando supera el max usando Redis", async () => {
    const ip = `10.10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

    const app = buildTestApp({
      RATE_LIMIT_ENABLE: "true",
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX: "2",
      RATE_LIMIT_USE_REDIS: "true",
      REDIS_URL: process.env.REDIS_URL,
      TRUST_PROXY: "true", // para que tome X-Forwarded-For
    });

    await request(app).get("/health").set("X-Forwarded-For", ip).expect(200);
    await request(app).get("/health").set("X-Forwarded-For", ip).expect(200);
    await request(app).get("/health").set("X-Forwarded-For", ip).expect(429);
  });
});
