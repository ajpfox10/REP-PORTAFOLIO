import request from "supertest";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config/loadConfig.js";

describe("Contract: /health", () => {
  it("matches OpenAPI", async () => {
    const app = await buildApp(loadConfig());
    const res = await request(app).get("/health").set("Host", "demo.localhost");
    expect(res.status).toBe(200);
    expect(res).toSatisfyApiSpec();
  });
});
