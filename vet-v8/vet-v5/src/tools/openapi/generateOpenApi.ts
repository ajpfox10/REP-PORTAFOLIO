import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { loadConfig } from "../../config/loadConfig.js";

export async function generateOpenApi() {
  const config = loadConfig();
  const doc: any = {
    openapi: "3.0.3",
    info: { title: "Veterinaria SaaS Platform", version: "1.0.0" },
    servers: [{ url: "http://localhost:" + config.port }],
    paths: {
      "/health": { get: { responses: { "200": { description: "OK" } } } },
      "/api/v1/me": { get: { responses: { "200": { description: "OK" } } } },
      "/api/internal/tenants/provision": { post: { responses: { "201": { description: "Created" }, "403": { description: "INTERNAL_ONLY" } } } },
      "/api/v1/db/{table}": { get: { parameters: [{ name: "table", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "403": { description: "CRUD_NOT_ALLOWED" } } } }
    }
  };

  const out = path.resolve(process.cwd(), config.openApiOutput);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, YAML.stringify(doc), "utf-8");
  console.log("OpenAPI written:", out);
}

if (process.argv[1]?.includes("generateOpenApi")) generateOpenApi();
