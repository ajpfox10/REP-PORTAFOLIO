/**
 * openApiSpec.ts — v11  (Punto 11)
 *
 * Especificación OpenAPI 3.1 completa para la API pública de VetPro.
 * Incluye todos los endpoints, schemas, seguridad y ejemplos.
 *
 * Sirve como:
 *   - Documentación para integradores externos (laboratorios, seguros, facturación)
 *   - Base para generación de SDKs (openapi-generator)
 *   - Contrato de validación en tests (setupOpenApi.ts lo consume)
 *
 * Endpoints:
 *   GET  /api/v1/openapi.json   — spec cruda
 *   GET  /api/v1/docs           — Swagger UI
 *   GET  /api/v1/docs/redoc     — ReDoc
 */

import { Router, type Request, type Response } from "express";

// ── Spec completa ─────────────────────────────────────────────────────────────

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "VetPro SaaS API",
    version: "11.0.0",
    description: "API multi-tenant para plataforma veterinaria. Requiere autenticación JWT (Bearer) en todos los endpoints excepto /auth y /health.",
    contact: { name: "VetPro Support", email: "api@vetpro.app", url: "https://vetpro.app/docs" },
    license: { name: "Proprietary", url: "https://vetpro.app/terms" },
  },
  servers: [
    { url: "https://api.vetpro.app", description: "Producción" },
    { url: "https://staging.vetpro.app", description: "Staging" },
    { url: "http://localhost:3000", description: "Local" },
  ],
  tags: [
    { name: "auth",           description: "Autenticación y sesiones" },
    { name: "pacientes",      description: "Gestión de pacientes / mascotas" },
    { name: "turnos",         description: "Agenda y turnos" },
    { name: "agenda",         description: "Vista de agenda semanal/mensual" },
    { name: "clinical",       description: "Historia clínica (SOAP)" },
    { name: "prescripciones", description: "Recetas médicas" },
    { name: "vacunas",        description: "Vacunación y desparasitación" },
    { name: "stock",          description: "Inventario y stock" },
    { name: "facturacion",    description: "Facturación AFIP" },
    { name: "dashboard",      description: "KPIs y métricas de negocio" },
    { name: "portal",         description: "Portal de propietarios" },
    { name: "pdf",            description: "Generación de documentos PDF" },
    { name: "notificaciones", description: "Recordatorios y alertas" },
    { name: "system",         description: "Health, metrics, JWKS" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access token obtenido en POST /auth/login. Expira en 15 minutos.",
      },
    },
    schemas: {
      // ── Respuesta estándar ──
      ApiResponse: {
        type: "object",
        required: ["data", "meta", "errors"],
        properties: {
          data:   { description: "Payload de la respuesta" },
          meta:   { type: "object", description: "Metadata de paginación u otros" },
          errors: { type: "array", items: { type: "string" } },
        },
      },
      PaginatedMeta: {
        type: "object",
        properties: {
          page:  { type: "integer", example: 1 },
          limit: { type: "integer", example: 50 },
          total: { type: "integer", example: 243 },
          pages: { type: "integer", example: 5 },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code:    { type: "string", example: "VALIDATION_ERROR" },
          message: { type: "string", example: "nombre es obligatorio" },
          details: { description: "Detalles adicionales (opcional)" },
        },
      },
      // ── Pacientes ──
      Paciente: {
        type: "object",
        required: ["nombre", "especie"],
        properties: {
          id:               { type: "integer", readOnly: true },
          nombre:           { type: "string", example: "Firulais", maxLength: 128 },
          especie:          { type: "string", example: "perro", maxLength: 64 },
          raza:             { type: "string", example: "Labrador", nullable: true },
          sexo:             { type: "string", enum: ["M", "F", "desconocido"], default: "desconocido" },
          color:            { type: "string", nullable: true },
          fecha_nacimiento: { type: "string", format: "date", nullable: true },
          castrado:         { type: "boolean", nullable: true },
          peso_kg:          { type: "number", format: "float", nullable: true, example: 12.5 },
          microchip:        { type: "string", nullable: true, example: "985141000123456" },
          foto_url:         { type: "string", format: "uri", nullable: true },
          propietario_id:   { type: "integer", nullable: true },
          is_active:        { type: "boolean", readOnly: true },
          created_at:       { type: "string", format: "date-time", readOnly: true },
        },
      },
      // ── Turno ──
      Turno: {
        type: "object",
        required: ["veterinario_id", "fecha_hora"],
        properties: {
          id:             { type: "integer", readOnly: true },
          veterinario_id: { type: "integer" },
          paciente_id:    { type: "integer", nullable: true },
          propietario_id: { type: "integer", nullable: true },
          fecha_hora:     { type: "string", format: "date-time", example: "2026-04-01T10:00:00" },
          duracion_min:   { type: "integer", default: 30, minimum: 10, maximum: 240 },
          motivo:         { type: "string", nullable: true },
          estado:         { type: "string", enum: ["pendiente","confirmado","cancelado","completado","no_show"], readOnly: true },
          notas:          { type: "string", nullable: true },
        },
      },
      // ── Consulta (SOAP) ──
      Consulta: {
        type: "object",
        required: ["paciente_id"],
        properties: {
          id:                     { type: "integer", readOnly: true },
          paciente_id:            { type: "integer" },
          veterinario_id:         { type: "integer", nullable: true },
          fecha:                  { type: "string", format: "date-time" },
          motivo:                 { type: "string", description: "Subjective" },
          anamnesis:              { type: "string", nullable: true },
          examen_fisico:          { type: "string", nullable: true, description: "Objective" },
          diagnostico:            { type: "string", nullable: true, description: "Assessment" },
          diagnostico_cie10:      { type: "string", nullable: true },
          tratamiento:            { type: "string", nullable: true, description: "Plan" },
          temperatura:            { type: "number", nullable: true, description: "Celsius" },
          peso_kg:                { type: "number", nullable: true },
          frecuencia_cardiaca:    { type: "integer", nullable: true, description: "lpm" },
          frecuencia_respiratoria:{ type: "integer", nullable: true, description: "rpm" },
          proxima_consulta:       { type: "string", format: "date", nullable: true },
        },
      },
      // ── Prescripción ──
      Prescripcion: {
        type: "object",
        required: ["paciente_id", "medicamento", "dosis"],
        properties: {
          id:               { type: "integer", readOnly: true },
          paciente_id:      { type: "integer" },
          veterinario_id:   { type: "integer", nullable: true },
          medicamento:      { type: "string", example: "Amoxicilina 500mg" },
          dosis:            { type: "string", example: "1 comprimido" },
          frecuencia:       { type: "string", example: "cada 8 horas" },
          duracion_dias:    { type: "integer", example: 7 },
          via_administracion: { type: "string", nullable: true },
          instrucciones:    { type: "string", nullable: true },
          fecha:            { type: "string", format: "date-time", readOnly: true },
        },
      },
      // ── Vacuna ──
      Vacuna: {
        type: "object",
        required: ["paciente_id", "nombre_vacuna", "fecha_aplicacion"],
        properties: {
          id:                { type: "integer", readOnly: true },
          paciente_id:       { type: "integer" },
          nombre_vacuna:     { type: "string", example: "Antirrábica" },
          fecha_aplicacion:  { type: "string", format: "date" },
          proxima_dosis:     { type: "string", format: "date", nullable: true },
          lote:              { type: "string", nullable: true },
          laboratorio:       { type: "string", nullable: true },
          veterinario_id:    { type: "integer", nullable: true },
        },
      },
      // ── Dashboard KPI ──
      DashboardResumen: {
        type: "object",
        properties: {
          periodo:           { type: "object", properties: { desde: { type: "string" }, hasta: { type: "string" } } },
          consultas:         { type: "integer" },
          turnos_totales:    { type: "integer" },
          tasa_cancelacion:  { type: "integer", description: "Porcentaje 0-100" },
          revenue_cents:     { type: "integer" },
          pacientes_nuevos:  { type: "integer" },
        },
      },
      // ── Login ──
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email:    { type: "string", format: "email" },
          password: { type: "string", format: "password", writeOnly: true },
          totp_code:{ type: "string", description: "Código TOTP si MFA está activado", nullable: true },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          access_token:  { type: "string" },
          refresh_token: { type: "string" },
          expires_in:    { type: "integer", example: 900 },
          user: {
            type: "object",
            properties: {
              id:    { type: "string" },
              email: { type: "string" },
              roles: { type: "array", items: { type: "string" } },
              plan:  { type: "string" },
            },
          },
        },
      },
    },
    parameters: {
      PageParam:  { name: "page",  in: "query", schema: { type: "integer", default: 1, minimum: 1 } },
      LimitParam: { name: "limit", in: "query", schema: { type: "integer", default: 50, minimum: 1, maximum: 100 } },
      DesdeParam: { name: "desde", in: "query", schema: { type: "string", format: "date" }, description: "Fecha inicio (YYYY-MM-DD)" },
      HastaParam: { name: "hasta", in: "query", schema: { type: "string", format: "date" }, description: "Fecha fin (YYYY-MM-DD)" },
    },
    responses: {
      Unauthorized: { description: "No autenticado", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      Forbidden:    { description: "Sin permisos",   content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      NotFound:     { description: "No encontrado",  content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      Conflict:     { description: "Conflicto",      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
      TooMany:      { description: "Rate limit",     content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    // ── AUTH ──
    "/api/v1/auth/login": {
      post: {
        tags: ["auth"], operationId: "login", summary: "Iniciar sesión",
        security: [],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } } },
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { $ref: "#/components/schemas/LoginResponse" } } }] } } } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/TooMany" },
        },
      },
    },
    "/api/v1/auth/logout": {
      post: { tags: ["auth"], operationId: "logout", summary: "Cerrar sesión (revoca JTI)",
        responses: { "200": { description: "OK" }, "401": { $ref: "#/components/responses/Unauthorized" } } },
    },
    "/api/v1/auth/refresh": {
      post: { tags: ["auth"], operationId: "refreshToken", summary: "Renovar access token",
        security: [],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["refresh_token"], properties: { refresh_token: { type: "string" } } } } } },
        responses: { "200": { description: "OK" }, "401": { $ref: "#/components/responses/Unauthorized" } } },
    },
    // ── PACIENTES ──
    "/api/v1/pacientes": {
      get: {
        tags: ["pacientes"], operationId: "listPacientes", summary: "Listar pacientes",
        parameters: [
          { $ref: "#/components/parameters/PageParam" },
          { $ref: "#/components/parameters/LimitParam" },
          { name: "q", in: "query", description: "Búsqueda full-text por nombre o raza", schema: { type: "string" } },
          { name: "especie", in: "query", schema: { type: "string" } },
          { name: "microchip", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Lista paginada de pacientes" }, "401": { $ref: "#/components/responses/Unauthorized" } },
      },
      post: {
        tags: ["pacientes"], operationId: "createPaciente", summary: "Crear paciente",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Paciente" } } } },
        responses: { "201": { description: "Creado" }, "400": { description: "Validación" }, "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/v1/pacientes/{id}": {
      get:    { tags: ["pacientes"], operationId: "getPaciente",    summary: "Obtener paciente por ID",    parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" }, "404": { $ref: "#/components/responses/NotFound" } } },
      patch:  { tags: ["pacientes"], operationId: "updatePaciente", summary: "Actualizar paciente",        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Paciente" } } } }, responses: { "200": { description: "OK" } } },
      delete: { tags: ["pacientes"], operationId: "deletePaciente", summary: "Dar de baja paciente (soft)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },
    "/api/v1/pacientes/{id}/historial": {
      get: { tags: ["pacientes"], operationId: "getPacienteHistorial", summary: "Historial clínico paginado",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }, { $ref: "#/components/parameters/PageParam" }, { $ref: "#/components/parameters/LimitParam" }],
        responses: { "200": { description: "Historial completo: consultas, vacunas, desparasitaciones, prescripciones" } } },
    },
    "/api/v1/pacientes/{id}/ficha": {
      get: { tags: ["pacientes", "pdf"], operationId: "getFichaPaciente", summary: "Ficha completa (base para PDF)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Estructura JSON lista para renderizar PDF" } } },
    },
    // ── TURNOS ──
    "/api/v1/turnos": {
      get:  { tags: ["turnos"], operationId: "listTurnos",  summary: "Listar turnos", parameters: [{ $ref: "#/components/parameters/PageParam" }, { $ref: "#/components/parameters/LimitParam" }, { $ref: "#/components/parameters/DesdeParam" }, { $ref: "#/components/parameters/HastaParam" }], responses: { "200": { description: "OK" } } },
      post: { tags: ["turnos"], operationId: "createTurno", summary: "Crear turno", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Turno" } } } }, responses: { "201": { description: "Creado" }, "409": { $ref: "#/components/responses/Conflict" } } },
    },
    "/api/v1/turnos/{id}/estado": {
      patch: { tags: ["turnos"], operationId: "updateTurnoEstado", summary: "Cambiar estado del turno",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["estado"], properties: { estado: { type: "string", enum: ["confirmado","cancelado","completado","no_show"] } } } } } },
        responses: { "200": { description: "OK" }, "409": { description: "Transición de estado inválida" } } },
    },
    // ── AGENDA ──
    "/api/v1/agenda/semanal":       { get: { tags: ["agenda"], operationId: "getAgendaSemanal",   summary: "Vista de agenda semanal",  parameters: [{ name: "fecha", in: "query", schema: { type: "string", format: "date" } }, { name: "veterinario_id", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
    "/api/v1/agenda/mensual":       { get: { tags: ["agenda"], operationId: "getAgendaMensual",   summary: "Vista de agenda mensual",  parameters: [{ name: "anio", in: "query", schema: { type: "integer" } }, { name: "mes", in: "query", schema: { type: "integer", minimum: 1, maximum: 12 } }], responses: { "200": { description: "OK" } } } },
    "/api/v1/agenda/disponibilidad":{ get: { tags: ["agenda"], operationId: "getDisponibilidad",  summary: "Slots libres para agendar", parameters: [{ name: "veterinario_id", in: "query", required: true, schema: { type: "integer" } }, { name: "fecha", in: "query", required: true, schema: { type: "string", format: "date" } }, { name: "duracion", in: "query", schema: { type: "integer", default: 30 } }], responses: { "200": { description: "OK" } } } },
    "/api/v1/agenda/conflictos":    { get: { tags: ["agenda"], operationId: "getConflictos",      summary: "Turnos superpuestos del día", parameters: [{ name: "fecha", in: "query", schema: { type: "string", format: "date" } }], responses: { "200": { description: "OK" } } } },
    // ── DASHBOARD ──
    "/api/v1/dashboard/resumen":             { get: { tags: ["dashboard"], operationId: "getDashboardResumen",    summary: "KPIs del período", parameters: [{ $ref: "#/components/parameters/DesdeParam" }, { $ref: "#/components/parameters/HastaParam" }], responses: { "200": { description: "OK", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { $ref: "#/components/schemas/DashboardResumen" } } }] } } } } } } },
    "/api/v1/dashboard/consultas-por-dia":   { get: { tags: ["dashboard"], operationId: "getConsultasPorDia",    summary: "Serie temporal de consultas" } },
    "/api/v1/dashboard/revenue-por-sucursal":{ get: { tags: ["dashboard"], operationId: "getRevenuePorSucursal", summary: "Revenue por sucursal" } },
    "/api/v1/dashboard/ocupacion-agenda":    { get: { tags: ["dashboard"], operationId: "getOcupacionAgenda",    summary: "% ocupación por veterinario" } },
    "/api/v1/dashboard/top-diagnosticos":    { get: { tags: ["dashboard"], operationId: "getTopDiagnosticos",    summary: "Top diagnósticos", parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 10 } }] } },
    // ── PDF ──
    "/api/v1/pdf/ficha/{pacienteId}":               { get: { tags: ["pdf"], operationId: "getPdfFicha",       summary: "Ficha clínica completa", parameters: [{ name: "pacienteId", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "JSON estructura PDF" } } } },
    "/api/v1/pdf/receta/{prescripcionId}":           { get: { tags: ["pdf"], operationId: "getPdfReceta",      summary: "Receta médica firmada",   parameters: [{ name: "prescripcionId", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
    "/api/v1/pdf/certificado-vacunacion/{pacienteId}":{ get: { tags: ["pdf"], operationId: "getCertVacunacion", summary: "Certificado de vacunación", parameters: [{ name: "pacienteId", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
    // ── STOCK ──
    "/api/v1/stock/alertas":     { get:  { tags: ["stock"], operationId: "getStockAlertas",   summary: "Productos bajo stock mínimo" } },
    "/api/v1/stock/lotes":       { get:  { tags: ["stock"], operationId: "getStockLotes",     summary: "Lotes próximos a vencer", parameters: [{ name: "dias", in: "query", schema: { type: "integer", default: 90 } }] }, post: { tags: ["stock"], operationId: "createLote", summary: "Registrar nuevo lote" } },
    "/api/v1/stock/descuento":   { post: { tags: ["stock"], operationId: "stockDescuento",    summary: "Descontar stock (FEFO)" } },
    "/api/v1/stock/orden-compra":{ get:  { tags: ["stock"], operationId: "getOrdenCompra",    summary: "Sugerencia de reabastecimiento" } },
    // ── PORTAL ──
    "/api/v1/portal-propietario/mis-mascotas":   { get: { tags: ["portal"], operationId: "portalMisMascotas",  summary: "Mascotas del propietario autenticado" } },
    "/api/v1/portal-propietario/mis-turnos":     { get: { tags: ["portal"], operationId: "portalMisTurnos",    summary: "Turnos próximos" } },
    "/api/v1/portal-propietario/mis-recetas":    { get: { tags: ["portal"], operationId: "portalMisRecetas",   summary: "Recetas descargables" } },
    "/api/v1/portal-propietario/mis-facturas":   { get: { tags: ["portal"], operationId: "portalMisFacturas",  summary: "Facturas del propietario" } },
    "/api/v1/portal-propietario/perfil":         { get: { tags: ["portal"], operationId: "portalPerfil",       summary: "Perfil del propietario" }, patch: { tags: ["portal"], operationId: "updatePortalPerfil", summary: "Actualizar contacto" } },
    // ── SYSTEM ──
    "/health":       { get: { tags: ["system"], operationId: "healthLive",  summary: "Liveness probe",  security: [], responses: { "200": { description: "ok" } } } },
    "/health/ready": { get: { tags: ["system"], operationId: "healthReady", summary: "Readiness probe", responses: { "200": { description: "ok" } } } },
    "/.well-known/jwks.json": { get: { tags: ["system"], operationId: "getJwks", summary: "JWKS público", security: [], responses: { "200": { description: "JWK Set" } } } },
  },
};

// ── Router ────────────────────────────────────────────────────────────────────

export function buildOpenApiRouter(): Router {
  const r = Router();

  // Spec JSON cruda
  r.get("/api/v1/openapi.json", (_req: Request, res: Response) => {
    res.json(OPENAPI_SPEC);
  });

  // Swagger UI (CDN)
  r.get("/api/v1/docs", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8">
<title>VetPro API Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: "/api/v1/openapi.json",
    dom_id: "#swagger-ui",
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: "StandaloneLayout",
    tryItOutEnabled: true,
    persistAuthorization: true,
  });
</script></body></html>`);
  });

  // ReDoc
  r.get("/api/v1/docs/redoc", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8">
<title>VetPro API — ReDoc</title>
</head><body>
<redoc spec-url="/api/v1/openapi.json"></redoc>
<script src="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js"></script>
</body></html>`);
  });

  return r;
}
