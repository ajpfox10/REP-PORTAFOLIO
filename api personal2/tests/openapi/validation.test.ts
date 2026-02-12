import request from "supertest";
import express from "express";
import path from "path";
import * as OpenApiValidator from "express-openapi-validator";

describe("OpenAPI request validation", () => {
  it("rechaza inválido (400) y acepta válido (200) usando el schema real del fixture", async () => {
    const apiSpecPath = path.resolve(process.cwd(), "tests/fixtures/openapi.test.yaml");

    const app = express();
    app.use(express.json());

    app.use(
      OpenApiValidator.middleware({
        apiSpec: apiSpecPath,
        validateRequests: true,
        validateResponses: false,
      })
    );

    app.post("/echo", (req, res) => res.json({ body: req.body }));

    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ ok: false, error: err.message, details: err.errors });
    });

    // inválido: falta name
    await request(app).post("/echo").send({}).expect(400);

    // válido
    await request(app).post("/echo").send({ name: "john" }).expect(200);
  });
});
