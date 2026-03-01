import request from "supertest";
import { buildTestApp } from "../helpers/testApp";

describe("middleware requestId", () => {
  it("setea header x-request-id y lo expone en req.requestId", async () => {
    const app = buildTestApp({}, (app) => {
      app.get("/rid", (req, res) => {
        res.json({ requestId: (req as any).requestId });
      });
    });

    const res = await request(app).get("/rid").expect(200);

    const headerRid = res.headers["x-request-id"];
    expect(typeof headerRid).toBe("string");
    expect(headerRid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    expect(res.body.requestId).toBe(headerRid);
  });
});
