import request from "supertest";
import { buildTestApp } from "../helpers/testApp";

describe("CORS denylist", () => {
  it("si Origin está en denylist, falla (cors bloqueado)", async () => {
    const app = buildTestApp({
      CORS_ALLOW_ALL: "true",
      CORS_DENYLIST: "http://evil.local",
    });

    // cors al tirar error entra por next(err) -> sin handler termina 500
    await request(app)
      .get("/health")
      .set("Origin", "http://evil.local")
      .expect(500);
  });

  it("si Origin NO está en denylist, responde con allow-origin", async () => {
    const app = buildTestApp({
      CORS_ALLOW_ALL: "true",
      CORS_DENYLIST: "http://evil.local",
    });

    const res = await request(app)
      .get("/health")
      .set("Origin", "http://ok.local")
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe("http://ok.local");
  });
});
