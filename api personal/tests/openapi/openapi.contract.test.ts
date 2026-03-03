import request from "supertest";
import crypto from "crypto";
import { createTestApp, cleanupTestApp } from "../helpers/createTestApp";

type OpenApiDoc = {
  paths?: Record<string, any>;
};

const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function pickPathParamValue(name: string) {
  const n = name.toLowerCase();
  if (n.includes("dni")) return "12345678";
  if (n.includes("id")) return "1";
  return "1";
}

function buildUrl(openPath: string) {
  // reemplaza {param} por valores default
  return openPath.replace(/\{([^}]+)\}/g, (_m, p1) => encodeURIComponent(pickPathParamValue(String(p1))));
}

function pickMethodBody(method: string) {
  const m = method.toLowerCase();
  if (m === "post" || m === "put" || m === "patch") return {};
  return undefined;
}

async function ensureTestApiKey(sequelize: any) {
  // 1) encontrar un rol que tenga api:access (si existe)
  const [roleRows] = await sequelize.query(
    `
    SELECT rp.rol_id AS roleId
    FROM roles_permisos rp
    JOIN permisos p ON p.id = rp.permiso_id
    WHERE rp.deleted_at IS NULL
      AND p.deleted_at IS NULL
      AND p.clave = 'api:access'
    LIMIT 1
    `
  );

  const roleId = (roleRows?.[0]?.roleId ?? null) ? Number(roleRows[0].roleId) : null;

  // 2) crear una api key nueva (plaintext conocida) en api_keys
  const plaintext = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const keyHash = sha256Hex(plaintext);

  await sequelize.query(
    `
    INSERT INTO api_keys (name, key_hash, role_id, created_at, updated_at)
    VALUES (:name, :keyHash, :roleId, NOW(), NOW())
    `,
    {
      replacements: {
        name: "jest-openapi-contract",
        keyHash,
        roleId,
      },
    }
  );

  return plaintext;
}

describe("OpenAPI contract (smoke)", () => {
  let app: any;
  let sequelize: any;
  let xApiKey: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    sequelize = ctx.sequelize;

    // api key real (creada en DB) para que no dependa de data previa
    xApiKey = await ensureTestApiKey(sequelize);

    // sanity checks
    await request(app).get("/health").timeout({ response: 5000, deadline: 10000 }).expect(200);
    await request(app).get("/ready").timeout({ response: 8000, deadline: 15000 }).expect(200);
  });

  afterAll(async () => {
    await cleanupTestApp();
  });

  it("recorre paths del OpenAPI y exige que el status esté documentado (con timeouts)", async () => {
    // sacamos el openapi desde el server (tu autogenerado)
    const specRes = await request(app)
      .get("/docs/openapi.json")
      .set("x-api-key", xApiKey)
      .timeout({ response: 8000, deadline: 15000 });

    expect(specRes.status).toBe(200);

    const doc = specRes.body as OpenApiDoc;
    expect(doc && typeof doc === "object").toBe(true);
    expect(doc.paths && typeof doc.paths === "object").toBe(true);

    const methods = ["get", "post", "put", "patch", "delete"] as const;

    // opcional: limitar cantidad para iterar rápido
    const MAX = Number(process.env.OPENAPI_CONTRACT_MAX ?? 9999);
    let count = 0;

    for (const [openPath, item] of Object.entries<any>(doc.paths || {})) {
      for (const m of methods) {
        const op = item?.[m];
        if (!op) continue;

        // si querés evitar endpoints peligrosos en un contrato “smoke”
        // (podés comentar esto si querés TODO)
        const url = buildUrl(openPath);

        // evitamos cosas que casi siempre fallan sin fixtures (y cuelgan)
        if (url.includes("/documents/") && url.includes("/file")) continue;

        const responses = op.responses || {};
        const documented = new Set(
          Object.keys(responses)
            .map(String)
            .filter((x) => x !== "default")
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n))
        );
        const hasDefault = !!responses.default;

        const body = pickMethodBody(m);
        const title = `${m.toUpperCase()} ${openPath}`;

        const req = request(app)[m](url)
          .set("x-api-key", xApiKey)
          .timeout({ response: 8000, deadline: 15000 });

        const res = body !== undefined ? await req.send(body) : await req;

        const ok =
          (hasDefault && res.status >= 100 && res.status < 600) ||
          documented.has(res.status);

        if (!ok) {
          // log útil para debug
          // eslint-disable-next-line no-console
          console.log("❌ Unexpected", {
            title,
            url,
            status: res.status,
            body: res.body,
            documented: Array.from(documented).sort((a, b) => a - b),
            hasDefault,
          });
        }

        expect(ok).toBe(true);

        count++;
        if (count >= MAX) return;
      }
    }
  });
});
