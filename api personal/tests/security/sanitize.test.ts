import request from "supertest";
import { buildTestApp } from "../helpers/testApp";

describe("middleware sanitize", () => {
  it("trimea strings en body/query y neutraliza prototype pollution (__proto__/constructor/prototype)", async () => {
    const app = buildTestApp({}, (a) => {
      a.post("/_test/sanitize", (req, res) => {
        res.json({ ok: true, body: req.body, query: req.query });
      });
    });

    const hasOwn = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k);

    const expectNoPollution = () => {
      expect(({} as any).polluted).toBeUndefined();
      expect(({} as any).evil).toBeUndefined();
    };

    // 1) Trim: body + query
    const resTrim = await request(app)
      .post("/_test/sanitize?name=%20Juan%20")
      .send({ apellido: "  Perez  " })
      .expect(200);

    expect(resTrim.body.ok).toBe(true);
    expect(resTrim.body.query?.name).toBe("Juan");
    expect(resTrim.body.body?.apellido).toBe("Perez");
    expectNoPollution();

    // 2) "__proto__" como JSON crudo: NO debe quedar como propiedad propia y NO debe contaminar
    const resProto = await request(app)
      .post("/_test/sanitize")
      .set("Content-Type", "application/json")
      .send('{"__proto__":{"polluted":"yes"},"safe":1}')
      .expect(200);

    expect(resProto.body.ok).toBe(true);
    expect(resProto.body.body?.safe).toBe(1);

    // OJO: body.__proto__ siempre existe como accesor => NO testear "toBeUndefined"
    expect(hasOwn(resProto.body.body, "__proto__")).toBe(false);

    expectNoPollution();

    // 3) "constructor.prototype": NO debe poder inyectar en prototipo
    const resCtor = await request(app)
      .post("/_test/sanitize")
      .set("Content-Type", "application/json")
      .send('{"constructor":{"prototype":{"evil":"yes"}},"safe":2}')
      .expect(200);

    expect(resCtor.body.ok).toBe(true);
    expect(resCtor.body.body?.safe).toBe(2);

    // No exigimos que borre "constructor", pero sí que no deje el path peligroso utilizable
    if (resCtor.body.body?.constructor && typeof resCtor.body.body.constructor === "object") {
      expect(hasOwn(resCtor.body.body.constructor, "prototype")).toBe(false);
    }

    expectNoPollution();
  });
});
