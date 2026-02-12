import request from "supertest";
import { buildTestApp } from "../helpers/testApp";

describe("rate limiting", () => {
  it("devuelve 429 cuando supera el max", async () => {
    const app = buildTestApp({
      RATE_LIMIT_ENABLE: "true",
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX: "2",
      TRUST_PROXY: "false",
    });

    await request(app).get("/health").expect(200);
    await request(app).get("/health").expect(200);
    await request(app).get("/health").expect(429);
  });
});
