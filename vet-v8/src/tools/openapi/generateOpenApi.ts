/**
 * generateOpenApi.ts — Genera la especificación OpenAPI 3.0 completa.
 *
 * Ejecutar: npx ts-node src/tools/openapi/generateOpenApi.ts
 * Output:   docs/openapi.yaml
 */

import fs from "node:fs";
import path from "node:path";

const VERSION = "7.0.0";

function ref(schema: string) { return { $ref: `#/components/schemas/${schema}` }; }

function paginated(schema: string) {
  return {
    type: "object",
    properties: {
      data: { type: "array", items: ref(schema) },
      meta: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
        },
      },
      errors: { type: "array", items: { type: "string" } },
    },
  };
}

function single(schema: string) {
  return {
    type: "object",
    properties: {
      data: ref(schema),
      meta: { type: "object", properties: { requestId: { type: "string" } } },
      errors: { type: "array", items: { type: "string" } },
    },
  };
}

const bearerAuth = { bearerAuth: [] };

const doc = {
  openapi: "3.0.3",
  info: {
    title: "VetPro SaaS Platform API",
    version: VERSION,
    description: "API multi-tenant para clínicas veterinarias. Todos los endpoints (excepto /health, /auth/login, /auth/refresh, /portal/login, /portal/register) requieren Bearer JWT.",
    contact: { name: "VetPro", email: "api@vetpro.ar" },
  },
  servers: [
    { url: "https://{subdomain}.vetpro.ar", description: "Producción", variables: { subdomain: { default: "demo" } } },
    { url: "http://localhost:3000", description: "Desarrollo local" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          requestId: { type: "string" },
        },
      },
      Turno: {
        type: "object",
        properties: {
          id: { type: "integer" }, veterinario_id: { type: "integer" }, paciente_id: { type: "integer" },
          propietario_id: { type: "integer" }, sucursal_id: { type: "integer" },
          fecha_hora: { type: "string", format: "date-time" }, duracion_min: { type: "integer" },
          motivo: { type: "string" }, estado: { type: "string", enum: ["pendiente","confirmado","cancelado","completado","no_show"] },
          notas: { type: "string" }, vet_nombre: { type: "string" }, paciente_nombre: { type: "string" },
          propietario_nombre: { type: "string" },
        },
      },
      Propietario: {
        type: "object",
        properties: {
          id: { type: "integer" }, nombre: { type: "string" }, apellido: { type: "string" },
          email: { type: "string" }, telefono: { type: "string" }, dni: { type: "string" }, ciudad: { type: "string" },
        },
      },
      Paciente: {
        type: "object",
        properties: {
          id: { type: "integer" }, nombre: { type: "string" }, especie: { type: "string" },
          raza: { type: "string" }, sexo: { type: "string" }, fecha_nacimiento: { type: "string", format: "date" },
          peso_kg: { type: "number" }, microchip: { type: "string" }, propietario_id: { type: "integer" },
        },
      },
      Vacuna: {
        type: "object",
        properties: {
          id: { type: "integer" }, paciente_id: { type: "integer" }, nombre: { type: "string" },
          laboratorio: { type: "string" }, lote: { type: "string" },
          fecha_aplicacion: { type: "string", format: "date" }, fecha_vencimiento: { type: "string", format: "date" },
          proxima_dosis: { type: "string", format: "date" },
        },
      },
      Consulta: {
        type: "object",
        properties: {
          id: { type: "integer" }, paciente_id: { type: "integer" }, veterinario_id: { type: "integer" },
          fecha: { type: "string", format: "date-time" }, motivo: { type: "string" },
          anamnesis: { type: "string" }, diagnostico: { type: "string" }, tratamiento: { type: "string" },
          temperatura: { type: "number" }, peso_kg: { type: "number" }, proxima_consulta: { type: "string", format: "date" },
        },
      },
      Prescripcion: {
        type: "object",
        properties: {
          id: { type: "integer" }, consulta_id: { type: "integer" }, paciente_id: { type: "integer" },
          medicamento: { type: "string" }, dosis: { type: "string" }, frecuencia: { type: "string" },
          duracion: { type: "string" }, via: { type: "string" }, instrucciones: { type: "string" },
        },
      },
      Internacion: {
        type: "object",
        properties: {
          id: { type: "integer" }, paciente_id: { type: "integer" }, veterinario_id: { type: "integer" },
          fecha_ingreso: { type: "string", format: "date-time" }, fecha_egreso: { type: "string", format: "date-time" },
          motivo: { type: "string" }, tratamiento: { type: "string" }, jaula_num: { type: "string" },
          estado: { type: "string", enum: ["internado","alta","fallecido"] },
        },
      },
      Factura: {
        type: "object",
        properties: {
          id: { type: "integer" }, numero: { type: "string" },
          tipo: { type: "string", enum: ["A","B","C","X","presupuesto"] },
          estado: { type: "string", enum: ["borrador","emitida","pagada","anulada"] },
          subtotal: { type: "number" }, iva_total: { type: "number" }, total: { type: "number" },
          items: { type: "array", items: { type: "object" } },
        },
      },
      Veterinario: {
        type: "object",
        properties: {
          id: { type: "integer" }, nombre: { type: "string" }, apellido: { type: "string" },
          matricula: { type: "string" }, especialidad: { type: "string" },
          email: { type: "string" }, color_agenda: { type: "string" }, sucursal_id: { type: "integer" },
        },
      },
      Sucursal: {
        type: "object",
        properties: {
          id: { type: "integer" }, nombre: { type: "string" }, direccion: { type: "string" },
          ciudad: { type: "string" }, telefono: { type: "string" }, email: { type: "string" },
        },
      },
      DashboardResumen: {
        type: "object",
        properties: {
          turnos: { type: "object", properties: { hoy: { type: "integer" }, este_mes: { type: "integer" } } },
          pacientes: { type: "object", properties: { total: { type: "integer" }, nuevos_este_mes: { type: "integer" } } },
          internados: { type: "integer" },
          vacunas_proximas_30d: { type: "integer" },
          facturacion_mes_ars: { type: "number" },
          stock_critico: { type: "array", items: { type: "object" } },
        },
      },
      Slot: {
        type: "object",
        properties: { hora: { type: "string", example: "10:00" }, disponible: { type: "boolean" } },
      },
    },
  },
  security: [bearerAuth],
  paths: {
    "/health": {
      get: {
        tags: ["System"], summary: "Health check", security: [],
        responses: { "200": { description: "OK" }, "503": { description: "Degraded" } },
      },
    },

    // ── Auth ──────────────────────────────────────────────────────────────
    "/api/v1/auth/login": {
      post: {
        tags: ["Auth"], summary: "Login", security: [],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email","password"], properties: { email: { type: "string" }, password: { type: "string" }, mfaCode: { type: "string" } } } } } },
        responses: { "200": { description: "Tokens" }, "401": { description: "Invalid credentials" } },
      },
    },
    "/api/v1/auth/refresh": {
      post: { tags: ["Auth"], summary: "Refresh access token", security: [], responses: { "200": { description: "New tokens" } } },
    },
    "/api/v1/auth/logout": { post: { tags: ["Auth"], summary: "Logout current session", responses: { "200": { description: "OK" } } } },
    "/api/v1/auth/logout-all": { post: { tags: ["Auth"], summary: "Revoke all sessions", responses: { "200": { description: "OK" } } } },
    "/api/v1/auth/me": { get: { tags: ["Auth"], summary: "Current user profile", responses: { "200": { description: "User" } } } },
    "/api/v1/auth/change-password": { post: { tags: ["Auth"], summary: "Change password", responses: { "200": { description: "OK" } } } },
    "/api/v1/auth/forgot-password": { post: { tags: ["Auth"], summary: "Request password reset email", security: [], responses: { "200": { description: "Always 200 (anti-enumeration)" } } } },
    "/api/v1/auth/reset-password": { post: { tags: ["Auth"], summary: "Reset password with token", security: [], responses: { "200": { description: "OK" } } } },
    "/api/v1/auth/sessions": { get: { tags: ["Auth"], summary: "List active sessions", responses: { "200": { description: "Sessions" } } } },
    "/api/v1/auth/mfa/setup": { post: { tags: ["Auth"], summary: "Setup TOTP MFA", responses: { "200": { description: "QR data" } } } },
    "/api/v1/auth/mfa/verify": { post: { tags: ["Auth"], summary: "Verify and enable MFA", responses: { "200": { description: "OK" } } } },

    // ── Turnos ────────────────────────────────────────────────────────────
    "/api/v1/turnos": {
      get: { tags: ["Turnos"], summary: "Listar turnos", responses: { "200": { description: "Lista paginada", content: { "application/json": { schema: paginated("Turno") } } } } },
      post: { tags: ["Turnos"], summary: "Crear turno", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["veterinario_id","fecha_hora"], properties: { veterinario_id: { type: "integer" }, paciente_id: { type: "integer" }, propietario_id: { type: "integer" }, fecha_hora: { type: "string" }, duracion_min: { type: "integer", default: 30 }, motivo: { type: "string" } } } } } }, responses: { "201": { description: "Creado" }, "409": { description: "Conflicto de horario" } } },
    },
    "/api/v1/turnos/slots": {
      get: { tags: ["Turnos"], summary: "Ver slots disponibles para un veterinario en una fecha", parameters: [{ name: "veterinario_id", in: "query", required: true, schema: { type: "integer" } }, { name: "fecha", in: "query", required: true, schema: { type: "string", format: "date" } }], responses: { "200": { description: "Slots", content: { "application/json": { schema: { type: "object", properties: { slots: { type: "array", items: ref("Slot") } } } } } } } },
    },
    "/api/v1/turnos/hoy/agenda": {
      get: { tags: ["Turnos"], summary: "Agenda del día actual", responses: { "200": { description: "Turnos de hoy" } } },
    },
    "/api/v1/turnos/{id}": {
      get: { tags: ["Turnos"], summary: "Obtener turno por ID", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Turno" }, "404": { description: "No encontrado" } } },
      patch: { tags: ["Turnos"], summary: "Actualizar turno", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
      delete: { tags: ["Turnos"], summary: "Cancelar turno (soft)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },
    "/api/v1/turnos/{id}/estado": {
      patch: { tags: ["Turnos"], summary: "Cambiar estado del turno", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["estado"], properties: { estado: { type: "string", enum: ["pendiente","confirmado","cancelado","completado","no_show"] } } } } } }, responses: { "200": { description: "OK" }, "409": { description: "Transición inválida" } } },
    },

    // ── Propietarios ──────────────────────────────────────────────────────
    "/api/v1/propietarios": {
      get: { tags: ["Propietarios"], summary: "Listar propietarios", responses: { "200": { description: "Lista", content: { "application/json": { schema: paginated("Propietario") } } } } },
      post: { tags: ["Propietarios"], summary: "Crear propietario", responses: { "201": { description: "Creado" } } },
    },
    "/api/v1/propietarios/{id}": {
      get: { tags: ["Propietarios"], summary: "Obtener propietario", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Propietario" } } },
      patch: { tags: ["Propietarios"], summary: "Actualizar propietario", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
      delete: { tags: ["Propietarios"], summary: "Eliminar propietario (soft)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },

    // ── Vacunas ───────────────────────────────────────────────────────────
    "/api/v1/vacunas": {
      get: { tags: ["Vacunas"], summary: "Listar vacunas", responses: { "200": { description: "Lista" } } },
      post: { tags: ["Vacunas"], summary: "Registrar vacuna", responses: { "201": { description: "Creada" } } },
    },

    // ── Consultas ─────────────────────────────────────────────────────────
    "/api/v1/clinical/visits": {
      get: { tags: ["Consultas"], summary: "Listar consultas", responses: { "200": { description: "Lista paginada" } } },
      post: { tags: ["Consultas"], summary: "Registrar consulta", responses: { "201": { description: "Creada" } } },
    },
    "/api/v1/clinical/visits/{id}": {
      get: { tags: ["Consultas"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Consulta" } } },
      patch: { tags: ["Consultas"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
      delete: { tags: ["Consultas"], summary: "Soft delete", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },

    // ── Prescripciones ────────────────────────────────────────────────────
    "/api/v1/prescripciones": {
      get: { tags: ["Clínica"], summary: "Listar prescripciones", responses: { "200": { description: "Lista" } } },
      post: { tags: ["Clínica"], summary: "Crear prescripción (solo vets)", responses: { "201": { description: "Creada" } } },
    },

    // ── Internaciones ─────────────────────────────────────────────────────
    "/api/v1/internaciones": {
      get: { tags: ["Clínica"], summary: "Listar internaciones activas", responses: { "200": { description: "Lista" } } },
      post: { tags: ["Clínica"], summary: "Internar paciente (plan pro)", responses: { "201": { description: "Creado" } } },
    },
    "/api/v1/internaciones/{id}/alta": {
      patch: { tags: ["Clínica"], summary: "Dar de alta", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },

    // ── Facturación (plan pro) ────────────────────────────────────────────
    "/api/v1/facturacion": {
      get: { tags: ["Facturación"], summary: "Listar facturas (plan pro)", responses: { "200": { description: "Lista" } } },
      post: { tags: ["Facturación"], summary: "Crear factura borrador", responses: { "201": { description: "Creada" } } },
    },
    "/api/v1/facturacion/{id}/emitir": {
      post: { tags: ["Facturación"], summary: "Emitir factura (genera número correlativo)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Emitida con número" } } },
    },
    "/api/v1/facturacion/{id}/pagar": {
      post: { tags: ["Facturación"], summary: "Marcar como pagada", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },

    // ── Dashboard (plan pro) ──────────────────────────────────────────────
    "/api/v1/dashboard/resumen": {
      get: { tags: ["Dashboard"], summary: "KPIs del día/mes (cacheado 5 min)", responses: { "200": { description: "KPIs", content: { "application/json": { schema: single("DashboardResumen") } } } } },
    },
    "/api/v1/dashboard/turnos-semana": {
      get: { tags: ["Dashboard"], summary: "Turnos por día esta semana", responses: { "200": { description: "Datos" } } },
    },
    "/api/v1/dashboard/especies": {
      get: { tags: ["Dashboard"], summary: "Distribución de pacientes por especie", responses: { "200": { description: "Datos" } } },
    },

    // ── Veterinarios ──────────────────────────────────────────────────────
    "/api/v1/veterinarios": {
      get: { tags: ["Configuración"], summary: "Listar veterinarios", responses: { "200": { description: "Lista" } } },
      post: { tags: ["Configuración"], summary: "Crear veterinario (admin)", responses: { "201": { description: "Creado" } } },
    },

    // ── Sucursales (plan pro) ─────────────────────────────────────────────
    "/api/v1/sucursales": {
      get: { tags: ["Configuración"], summary: "Listar sucursales", responses: { "200": { description: "Lista" } } },
      post: { tags: ["Configuración"], summary: "Crear sucursal (plan pro, admin)", responses: { "201": { description: "Creada" } } },
    },

    // ── PDF (plan pro) ────────────────────────────────────────────────────
    "/api/v1/pdf/paciente/{id}/historia": {
      get: { tags: ["PDF"], summary: "PDF historia clínica", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "PDF", content: { "application/pdf": {} } } } },
    },
    "/api/v1/pdf/paciente/{id}/vacunas": {
      get: { tags: ["PDF"], summary: "PDF cartilla de vacunación", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "PDF", content: { "application/pdf": {} } } } },
    },
    "/api/v1/pdf/factura/{id}": {
      get: { tags: ["PDF"], summary: "PDF de factura", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "PDF", content: { "application/pdf": {} } } } },
    },

    // ── Portal propietario (plan pro) ─────────────────────────────────────
    "/api/v1/portal/login": {
      post: { tags: ["Portal"], summary: "Login del propietario", security: [], responses: { "200": { description: "Token del portal" } } },
    },
    "/api/v1/portal/register": {
      post: { tags: ["Portal"], summary: "Auto-registro del propietario", security: [], responses: { "201": { description: "Cuenta creada" } } },
    },
    "/api/v1/portal/me": {
      get: { tags: ["Portal"], summary: "Perfil del propietario", responses: { "200": { description: "Datos" } } },
    },
    "/api/v1/portal/mis-mascotas": {
      get: { tags: ["Portal"], summary: "Mascotas del propietario", responses: { "200": { description: "Lista" } } },
    },
    "/api/v1/portal/mis-turnos": {
      get: { tags: ["Portal"], summary: "Turnos del propietario", responses: { "200": { description: "Lista" } } },
    },
    "/api/v1/portal/turnos": {
      post: { tags: ["Portal"], summary: "Solicitar un turno desde el portal", responses: { "201": { description: "Turno creado" } } },
    },
    "/api/v1/portal/turnos/{id}": {
      delete: { tags: ["Portal"], summary: "Cancelar turno desde el portal", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },

    // ── WhatsApp (plan enterprise) ────────────────────────────────────────
    "/api/v1/whatsapp/send/turno-reminder": {
      post: { tags: ["WhatsApp"], summary: "Enviar recordatorio de turno por WhatsApp (plan enterprise)", responses: { "200": { description: "Encolado" } } },
    },
    "/api/v1/whatsapp/webhook": {
      get: { tags: ["WhatsApp"], summary: "Verificación del webhook de Meta", security: [], responses: { "200": { description: "Challenge" } } },
      post: { tags: ["WhatsApp"], summary: "Recibir mensajes/estados de WhatsApp", security: [], responses: { "200": { description: "OK" } } },
    },

    // ── Agenda ────────────────────────────────────────────────────────────
    "/api/v1/agenda/availability": {
      get: { tags: ["Agenda"], summary: "Disponibilidad de veterinario en un rango de fechas", parameters: [{ name: "veterinario_id", in: "query", required: true, schema: { type: "integer" } }, { name: "fecha_desde", in: "query", required: true, schema: { type: "string", format: "date" } }, { name: "fecha_hasta", in: "query", required: true, schema: { type: "string", format: "date" } }], responses: { "200": { description: "Disponibilidad por día" } } },
    },

    // ── Ventas ────────────────────────────────────────────────────────────
    "/api/v1/sales": {
      get: { tags: ["Ventas"], summary: "Listar ventas", responses: { "200": { description: "Lista" } } },
      post: { tags: ["Ventas"], summary: "Registrar venta (con descuento de stock)", responses: { "201": { description: "Venta creada" } } },
    },
    "/api/v1/sales/{id}": {
      get: { tags: ["Ventas"], summary: "Detalle de venta con ítems", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Venta" } } },
    },
  },
};

const outDir = path.resolve("docs");
fs.mkdirSync(outDir, { recursive: true });

// JSON
const jsonPath = path.join(outDir, "openapi.json");
fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2), "utf-8");
console.log("OpenAPI JSON written:", jsonPath);

// Simple YAML (sin dep externa)
function toYaml(obj: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return String(obj);
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    if (obj.includes("\n") || obj.includes(":") || obj.includes("#") || obj.startsWith("-")) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (!obj.length) return "[]";
    return "\n" + obj.map(v => `${pad}- ${toYaml(v, indent + 2)}`).join("\n");
  }
  const entries = Object.entries(obj as object);
  if (!entries.length) return "{}";
  return "\n" + entries.map(([k, v]) => {
    const val = toYaml(v, indent + 2);
    return `${pad}${k}: ${val}`;
  }).join("\n");
}

const yamlContent = `openapi: "${doc.openapi}"\ninfo:\n  title: "${doc.info.title}"\n  version: "${doc.info.version}"\n  description: "${doc.info.description}"\n` +
  `# Full spec in openapi.json\n# Generated by generateOpenApi.ts\n`;

const yamlPath = path.join(outDir, "openapi.yaml");
fs.writeFileSync(yamlPath, yamlContent, "utf-8");
console.log("OpenAPI YAML stub written:", yamlPath);
console.log(`Total paths documented: ${Object.keys(doc.paths).length}`);

if (process.argv[1]?.includes("generateOpenApi")) {
  // run directly
}
