// src/types/openapi/build.ts
import { SchemaSnapshot, TableInfo, ColumnInfo } from "../../db/schema/types";

/**
 * Construye un OpenAPI básico (humano) a partir del snapshot del schema.
 * Esto es “build-only”: no toca runtime.
 */

export type BuildOpenApiOptions = {
  allowedTables?: Set<string>;
  views?: Set<string>;
  readonly?: boolean;
};

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, any>;
  components: {
    schemas: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
};

function mapColumnToSchema(col: ColumnInfo) {
  const t = (col as any).dataType || (col as any).type || "string";
  const nullable = Boolean((col as any).isNullable);

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

function tableCreateSchemaName(table: TableInfo) {
  return `Table_${table.name}_Create`;
}

/** ✅ PATCH schema name (parcial, sin required) */
function tablePatchSchemaName(table: TableInfo) {
  return `Table_${table.name}_Patch`;
}

function tableToComponentSchema(table: TableInfo, mode: "full" | "create" = "full") {
  const props: Record<string, any> = {};
  const required: string[] = [];

  for (const col of table.columns || []) {
    const isAutoIncrement = Boolean((col as any).isAutoIncrement);

    // Para CREATE: si es autoincrement (ej: id), NO lo incluimos ni como required ni como property
    if (mode === "create" && isAutoIncrement) continue;

    props[col.name] = mapColumnToSchema(col);

    const allowNull = Boolean((col as any).isNullable);
    const hasDefault = (col as any).columnDefault !== null && (col as any).columnDefault !== undefined;

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

/** ✅ PATCH: mismo shape, pero sin required (update parcial) */
function tableToPatchSchema(table: TableInfo) {
  const full = tableToComponentSchema(table, "full");
  const { required, ...rest } = full as any;
  return rest;
}

function normalizeTables(snapshot: SchemaSnapshot): TableInfo[] {
  const tablesAny: any = (snapshot as any)?.tables ?? [];

  // ✅ soporta ambos formatos: array o record
  if (Array.isArray(tablesAny)) return tablesAny as TableInfo[];
  if (tablesAny && typeof tablesAny === "object") return Object.values(tablesAny) as TableInfo[];

  return [];
}

export function buildOpenApiFromSchema(snapshot: SchemaSnapshot, opts: BuildOpenApiOptions = {}): OpenApiDoc {
  const doc: OpenApiDoc = {
    openapi: "3.0.3",
    info: { title: "personalv5-enterprise-api", version: "1.0.0" },
    tags: [
      { name: "system", description: "Health/ready/endpoints base" },
      { name: "meta", description: "Endpoints auxiliares del CRUD" },
      { name: "auth", description: "Autenticación (login/refresh/logout)" },
      { name: "personal", description: "Búsqueda de personal (dni / apellido / nombre)" },
      { name: "crud", description: "CRUD genérico por tabla/vista" },
      { name: "docs", description: "OpenAPI spec" },
    ],
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  };

  const tables = normalizeTables(snapshot);

  // =========================
  // Rutas fijas (no dependen del schema)
  // =========================
  doc.paths["/health"] = {
    get: {
      tags: ["system"],
      summary: "Health check",
      responses: { 200: { description: "OK" } },
    },
  };

  doc.paths["/ready"] = {
    get: {
      tags: ["system"],
      summary: "Readiness check (DB ping)",
      "x-internal": true,
      responses: {
        200: { description: "Ready" },
        503: { description: "DB not ready" },
      },
    },
  };

  doc.paths["/api/v1/tables"] = {
    get: {
      tags: ["meta"],
      summary: "List tables/views available for CRUD",
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: "OK" } },
    },
  };

  // ======================
  // Personal search
  // ======================
  doc.paths["/api/v1/personal/search"] = {
    get: {
      tags: ["personal"],
      security: [{ bearerAuth: [] }],
      summary: "Buscar personal por dni / apellido / nombre",
      parameters: [
        { name: "dni", in: "query", schema: { type: "string" } },
        { name: "apellido", in: "query", schema: { type: "string" } },
        { name: "nombre", in: "query", schema: { type: "string" } },
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
      ],
      responses: {
        200: { description: "OK" },
        400: { description: "Parámetros inválidos" },
        401: { description: "No autenticado" },
        403: { description: "No autorizado" },
      },
    },
  };

  // ======================
  // Agentes: Foto credencial (filesystem)
  // ======================
  doc.paths["/api/v1/agentes/{dni}/foto"] = {
    get: {
      tags: ["agentes"],
      security: [{ bearerAuth: [] }],
      summary: "Obtener foto credencial por DNI",
      parameters: [
        {
          name: "dni",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "Imagen",
          content: {
            "image/jpeg": { schema: { type: "string", format: "binary" } },
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/webp": { schema: { type: "string", format: "binary" } },
          },
        },
        400: { description: "DNI inválido" },
        401: { description: "No autenticado" },
        403: { description: "No autorizado" },
        404: { description: "Not found" },
      },
    },
  };

  doc.paths["/docs/openapi.yaml"] = {
    get: {
      tags: ["docs"],
      summary: "Get OpenAPI spec (yaml)",
      responses: { 200: { description: "OK" } },
    },
  };

  doc.paths["/docs/openapi.json"] = {
    get: {
      tags: ["docs"],
      summary: "Get OpenAPI spec (json)",
      responses: { 200: { description: "OK" } },
    },
  };

  // ======================
  // Auth endpoints
  // ======================
  doc.paths["/api/v1/auth/login"] = {
    post: {
      tags: ["auth"],
      summary: "Login de usuario",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email" },
                password: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Login OK" },
        401: { description: "Credenciales inválidas" },
      },
    },
  };

  doc.paths["/api/v1/auth/refresh"] = {
    post: {
      tags: ["auth"],
      summary: "Refresh token",
      responses: {
        200: { description: "Token renovado" },
        401: { description: "No autorizado" },
      },
    },
  };

  doc.paths["/api/v1/auth/logout"] = {
    post: {
      tags: ["auth"],
      summary: "Logout",
      responses: { 200: { description: "Logout OK" } },
    },
  };

  for (const table of tables) {
    // allow/deny/strict (ya aplicado por opts.allowedTables)
    if (opts.allowedTables && !opts.allowedTables.has(table.name)) continue;

    const isView = Boolean(opts.views && opts.views.has(table.name));
    const allowWrites = !Boolean(opts.readonly) && !isView;
    const name = tableSchemaName(table);
    const createName = tableCreateSchemaName(table);
    const patchName = tablePatchSchemaName(table);

    doc.components.schemas[name] = tableToComponentSchema(table, "full");
    doc.components.schemas[createName] = tableToComponentSchema(table, "create");
    doc.components.schemas[patchName] = tableToPatchSchema(table);

    const base = `/api/v1/${table.name}`;

    doc.paths[base] = {
      get: {
        tags: ["crud"],
        security: [{ bearerAuth: [] }],
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
    };

    if (allowWrites) {
      (doc.paths[base] as any).post = {
        tags: ["crud"],
        security: [{ bearerAuth: [] }],
        summary: `Create ${table.name}`,
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${createName}` } },
          },
        },
        responses: { 201: { description: "Created" } },
      };
    }

    doc.paths[`${base}/{id}`] = {
      get: {
        tags: ["crud"],
        security: [{ bearerAuth: [] }],
        summary: `Get ${table.name} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      },
    };

    if (allowWrites) {
      (doc.paths[`${base}/{id}`] as any).put = {
        tags: ["crud"],
        security: [{ bearerAuth: [] }],
        summary: `Update ${table.name} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
          },
        },
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      };

        // ======================
       // Exportacion de datos para certificados
      // ======================

      doc.paths["/api/v1/certificados/certificado-trabajo"] = {
  post: {
    tags: ["docs"],
    security: [{ bearerAuth: [] }],
    summary: "Generar Certificado de Trabajo (DOCX) desde plantilla",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["dni"],
            additionalProperties: false,
            properties: {
              dni: { type: "number" },
              dependencia: { type: "string" },
              legajo: { type: "string" },
              decreto: { type: "string" },
              lugar_y_fecha: { type: "string" },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: "DOCX generado",
        content: {
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      400: { description: "Bad request" },
      404: { description: "No encontrado" },
    },
  },
};

      

      /** ✅ PATCH agregado */
      (doc.paths[`${base}/{id}`] as any).patch = {
        tags: ["crud"],
        security: [{ bearerAuth: [] }],
        summary: `Patch ${table.name} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: `#/components/schemas/${patchName}` } },
          },
        },
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      };

      (doc.paths[`${base}/{id}`] as any).delete = {
        tags: ["crud"],
        security: [{ bearerAuth: [] }],
        summary: `Delete ${table.name} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 404: { description: "Not found" } },
      };
    }
  }

  return doc;
}
