import request from "supertest";
import fs from "fs";
import path from "path";
import YAML from "yaml";

type AnyObj = Record<string, any>;

function loadSpec(apiSpecPath: string): AnyObj {
  const raw = fs.readFileSync(apiSpecPath, "utf-8");
  return YAML.parse(raw);
}

function getByRef(spec: AnyObj, ref: string): any {
  // Solo refs locales tipo "#/components/schemas/X"
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/").map(decodeURIComponent);
  let cur: any = spec;
  for (const p of parts) cur = cur?.[p];
  return cur;
}

function normalizeSchema(spec: AnyObj, schema: any, depth = 0): any {
  if (!schema || depth > 25) return schema;

  if (schema.$ref) {
    const resolved = getByRef(spec, schema.$ref);
    return normalizeSchema(spec, resolved, depth + 1);
  }

  // Elegimos el primero para generar un ejemplo válido (suficiente para el test)
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return normalizeSchema(spec, schema.oneOf[0], depth + 1);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return normalizeSchema(spec, schema.anyOf[0], depth + 1);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    // merge simple (propiedades y required) del allOf
    const merged: any = { type: "object", properties: {}, required: [] as string[] };
    for (const part of schema.allOf) {
      const s = normalizeSchema(spec, part, depth + 1) || {};
      if (s.type && merged.type === "object") merged.type = s.type;
      if (s.properties && typeof s.properties === "object") {
        merged.properties = { ...(merged.properties || {}), ...s.properties };
      }
      if (Array.isArray(s.required)) merged.required = Array.from(new Set([...(merged.required || []), ...s.required]));
      if (s.enum) merged.enum = s.enum;
      if (s.default !== undefined) merged.default = s.default;
      if (s.example !== undefined) merged.example = s.example;
      if (s.items) merged.items = s.items;
      if (s.format) merged.format = s.format;
      if (s.nullable !== undefined) merged.nullable = s.nullable;
    }
    return merged;
  }

  return schema;
}

function buildValid(spec: AnyObj, schema: any, depth = 0): any {
  const s = normalizeSchema(spec, schema, 0) || {};
  if (depth > 10) return null;

  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];

  const t = s.type;

  if (t === "object" || (t === undefined && (s.properties || s.required))) {
    const obj: AnyObj = {};
    const props: AnyObj = s.properties || {};
    const required: string[] = Array.isArray(s.required) ? s.required : [];

    // primero, completar required
    for (const key of required) {
      const propSchema = props[key];
      obj[key] = propSchema ? buildValid(spec, propSchema, depth + 1) : "x";
    }

    // si no hay required, metemos al menos 1 prop para evitar casos minProperties
    if (required.length === 0) {
      const firstKey = Object.keys(props)[0];
      if (firstKey) obj[firstKey] = buildValid(spec, props[firstKey], depth + 1);
      else obj["foo"] = "bar"; // fallback (por si el schema es vacío)
    }

    return obj;
  }

  if (t === "array") {
    const item = s.items ? buildValid(spec, s.items, depth + 1) : "x";
    return [item];
  }

  if (t === "integer" || t === "number") return 1;
  if (t === "boolean") return true;

  // string + formatos comunes
  if (t === "string" || !t) {
    const fmt = String(s.format || "").toLowerCase();
    if (fmt === "date-time") return "2000-01-01T00:00:00.000Z";
    if (fmt === "date") return "2000-01-01";
    if (fmt === "uuid") return "00000000-0000-4000-8000-000000000000";
    if (fmt === "email") return "test@example.com";
    return "x";
  }

  return "x";
}

function buildInvalid(spec: AnyObj, schema: any): any {
  const s = normalizeSchema(spec, schema, 0) || {};
  const t = s.type;

  // Queremos forzar 400 por schema, no 415 por media type:
  // por eso el test siempre manda Content-Type: application/json.
  // Acá generamos algo que choque contra el schema.
  if (t === "object" || (t === undefined && (s.properties || s.required))) {
    // Si NO es nullable, null rompe type object casi siempre.
    if (!s.nullable) return null;

    // Si es nullable, mandamos un tipo incorrecto que no sea null
    return "invalid";
  }

  if (t === "array") return null;
  if (t === "string") return 123;
  if (t === "integer" || t === "number") return "nope";
  if (t === "boolean") return "nope";

  return null;
}

function getEchoPostSchema(spec: AnyObj): any {
  const p = spec?.paths?.["/echo"]?.post;
  if (!p) throw new Error("El fixture OpenAPI no tiene paths['/echo'].post");

  const rb = p.requestBody;
  if (!rb) throw new Error("El fixture OpenAPI no tiene requestBody para POST /echo");

  const content = rb.content || {};
  const json = content["application/json"] || content["application/*+json"];
  if (!json) throw new Error("El fixture OpenAPI no declara content application/json para POST /echo");

  const schema = json.schema;
  if (!schema) throw new Error("El fixture OpenAPI no tiene schema en requestBody.content.application/json");

  return schema;
}

describe("OpenAPI request validation", () => {
  it("rechaza inválido (400) y acepta válido (200) usando el schema real del fixture", async () => {
    jest.resetModules();

    // Aseguramos que el app en tests levante el validador OpenAPI
    process.env.NODE_ENV = "test";
    process.env.ENABLE_OPENAPI_VALIDATION = "true";

    // (Opcional) evitamos warnings/ruido en tests por rate-limit + trust proxy
    process.env.TRUST_PROXY = "false";
    process.env.RATE_LIMIT_ENABLE = "false";
    process.env.METRICS_ENABLE = "false";

    const openapiPath = path.resolve(process.cwd(), "tests", "fixtures", "openapi.test.yaml");
    const spec = loadSpec(openapiPath);
    const schema = getEchoPostSchema(spec);

    // Import tardío para que tome process.env ya seteado
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require("../../src/app");

    const app = createApp(openapiPath);

    // Route dummy que devuelve el body (para poder assert)
    app.post("/echo", (req: any, res: any) => {
      res.status(200).json({ body: req.body });
    });

    // inválido -> 400
    await request(app)
      .post("/echo")
      .set("Content-Type", "application/json") // evita 415 Unsupported Media Type
      .send(buildInvalid(spec, schema))
      .expect(400);

    // válido -> 200
    const validPayload = buildValid(spec, schema);

    const ok = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(validPayload)
      .expect(200);

    // el echo devuelve lo mismo
    expect(ok.body).toHaveProperty("body");
    expect(ok.body.body).toMatchObject(validPayload);
  });
});
