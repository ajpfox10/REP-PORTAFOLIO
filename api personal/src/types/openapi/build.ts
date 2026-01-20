// src/types/openapi/build.ts
import { SchemaSnapshot, TableInfo, ColumnInfo } from "../../db/schema/types";

/**
 * Construye un OpenAPI básico (humano) a partir del snapshot del schema.
 * Esto es “build-only”: no toca runtime.
 */

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, any>;
  components: { schemas: Record<string, any> };
};

function mapColumnToSchema(col: ColumnInfo) {
  const t = (col as any).dataType || (col as any).type || "string";
  const nullable = Boolean((col as any).allowNull);

  let schema: any = { type: "string" };

  const tn = String(t).toLowerCase();
  if (tn.includes("int") || tn.includes("decimal") || tn.includes("float") || tn.includes("double")) {
    schema = { type: "number" };
  } else if (tn.includes("bool")) {
    schema = { type: "boolean" };
  } else if (tn.includes("date") || tn.includes("time")) {
    schema = { type: "string", format: "date-time" };
  } else {
    schema = { type: "string" };
  }

  if (nullable) schema.nullable = true;
  return schema;
}

function tableSchemaName(table: TableInfo) {
  return `Table_${table.name}`;
}

function tableToComponentSchema(table: TableInfo) {
  const props: Record<string, any> = {};
  const required: string[] = [];

  for (const col of table.columns || []) {
    props[col.name] = mapColumnToSchema(col);

    const allowNull = Boolean((col as any).allowNull);
    const hasDefault = (col as any).defaultValue !== undefined && (col as any).defaultValue !== null;

    if (!allowNull && !hasDefault) required.push(col.name);
  }

  const out: any = {
    type: "object",
    additionalProperties: false,
    properties: props,
  };

  if (required.length) out.required = required;
  return out;
}

function normalizeTables(snapshot: SchemaSnapshot): TableInfo[] {
  const tablesAny: any = (snapshot as any)?.tables ?? [];

  // ✅ soporta ambos formatos: array o record
  if (Array.isArray(tablesAny)) return tablesAny as TableInfo[];
  if (tablesAny && typeof tablesAny === "object") return Object.values(tablesAny) as TableInfo[];

  return [];
}

export function buildOpenApiFromSchema(snapshot: SchemaSnapshot): OpenApiDoc {
  const doc: OpenApiDoc = {
    openapi: "3.0.3",
    info: { title: "personalv5-enterprise-api", version: "1.0.0" },
    paths: {},
    components: { schemas: {} },
  };

  const tables = normalizeTables(snapshot);

  for (const table of tables) {
    const name = tableSchemaName(table);
    doc.components.schemas[name] = tableToComponentSchema(table);

    const base = `/api/v1/${table.name}`;

    doc.paths[base] = {
      get: {
        summary: `List ${table.name}`,
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    data: { type: "array", items: { $ref: `#/components/schemas/${name}` } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: `Create ${table.name}`,
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
          },
        },
        responses: { 201: { description: "Created" } },
      },
    };

    doc.paths[`${base}/{id}`] = {
      get: {
        summary: `Get ${table.name} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      },
      put: {
        summary: `Update ${table.name} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
          },
        },
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      },
      delete: {
        summary: `Delete ${table.name} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      },
    };
  }

  return doc;
}
