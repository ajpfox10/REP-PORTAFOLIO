import { SchemaSnapshot, TableInfo, ColumnInfo } from "../db/schema/types";

const toSchema = (c: ColumnInfo) => {
  const t = (c.dataType || "").toLowerCase();
  const s: any = {};

  if (t.includes("int")) s.type = "integer";
  else if (["decimal", "numeric", "float", "double"].includes(t)) s.type = "number";
  else if (["date", "datetime", "timestamp"].includes(t)) {
    s.type = "string";
    s.format = "date-time";
  } else if (t === "json") s.type = "object";
  else s.type = "string";

  if (c.maxLength) s.maxLength = c.maxLength;
  if (c.isNullable) s.nullable = true;

  return s;
};

const tableBodySchema = (table: TableInfo) => {
  const props: any = {};
  const required: string[] = [];

  for (const c of table.columns) {
    props[c.name] = toSchema(c);
    if (!c.isNullable && c.columnDefault === null && !c.isAutoIncrement) required.push(c.name);
  }

  const out: any = { type: "object", properties: props, additionalProperties: false };
  if (required.length) out.required = required;
  return out;
};

export const buildOpenApi = (schema: SchemaSnapshot) => {
  const doc: any = {
    openapi: "3.0.3",
    info: {
      title: "personalv5-enterprise-api",
      version: "1.0.0",
      description: "Enterprise API (generic CRUD + request validation)"
    },
    servers: [{ url: "/" }],
    tags: [{ name: "Health" }, { name: "Schema" }, { name: "CRUD" }],
    paths: {
      "/health": {
        get: { tags: ["Health"], responses: { "200": { description: "OK" } } }
      },
      "/ready": {
        get: { tags: ["Health"], responses: { "200": { description: "OK" } } }
      },
      "/api/v1/tables": {
        get: {
          tags: ["Schema"],
          responses: {
            "200": {
              description: "Tables",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
            }
          }
        }
      }
    },
    components: { schemas: {} }
  };

  doc.paths["/api/v1/{table}"] = {
    get: {
      tags: ["CRUD"],
      parameters: [
        { name: "table", in: "path", required: true, schema: { type: "string" } },
        { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } }
      ],
      responses: {
        "200": {
          description: "List",
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
        }
      }
    },
    post: {
      tags: ["CRUD"],
      parameters: [{ name: "table", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
      },
      responses: {
        "201": {
          description: "Created",
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
        }
      }
    }
  };

  doc.paths["/api/v1/{table}/{id}"] = {
    get: {
      tags: ["CRUD"],
      parameters: [
        { name: "table", in: "path", required: true, schema: { type: "string" } },
        { name: "id", in: "path", required: true, schema: { type: "string" } }
      ],
      responses: {
        "200": {
          description: "Get",
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
        }
      }
    },
    put: {
      tags: ["CRUD"],
      parameters: [
        { name: "table", in: "path", required: true, schema: { type: "string" } },
        { name: "id", in: "path", required: true, schema: { type: "string" } }
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
      },
      responses: {
        "200": {
          description: "Updated",
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
        }
      }
    },
    delete: {
      tags: ["CRUD"],
      parameters: [
        { name: "table", in: "path", required: true, schema: { type: "string" } },
        { name: "id", in: "path", required: true, schema: { type: "string" } }
      ],
      responses: {
        "200": {
          description: "Deleted",
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
        }
      }
    }
  };

  for (const table of Object.values(schema.tables || {})) {
    const name = `Table_${table.name}`;
    doc.components.schemas[name] = tableBodySchema(table);
  }

  return doc;
};
