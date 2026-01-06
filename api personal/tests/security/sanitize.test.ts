import request from "supertest";
import { createApp } from "../../src/app";

describe("middleware sanitize", () => {
  it("trimea strings en body/query y bloquea prototype pollution (__proto__/constructor/prototype)", async () => {
    const app = createApp();

    // endpoint de prueba: devuelve lo que llega (ya sanitizado por el middleware global)
    app.post("/echo", (req, res) => {
      res.json({ body: req.body, query: req.query });
    });

    const res = await request(app)
      .post("/echo?name=%20john%20")
      .send({
        name: "  x  ",
        nested: { a: "  b  " },

        // intentos clásicos de prototype pollution
        __proto__: { polluted: "YES" },
        constructor: { prototype: { polluted2: "YES" } },
        prototype: { polluted3: "YES" },
      })
      .expect(200);

    // trims esperados
    expect(res.body.body.name).toBe("x");
    expect(res.body.body.nested.a).toBe("b");
    expect(res.body.query.name).toBe("john");

    // IMPORTANTE:
    // res.body.body.__proto__ NO puede testearse con "toBeUndefined()" porque
    // acceder a obj.__proto__ devuelve el prototype por defecto (Object.prototype).
    // Lo correcto es verificar que NO exista como propiedad propia.
    const body = res.body.body;

    expect(Object.prototype.hasOwnProperty.call(body, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "prototype")).toBe(false);

    // y que NO haya contaminación global del prototype
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).polluted2).toBeUndefined();
    expect(({} as any).polluted3).toBeUndefined();
  });
});
