/**
 * pdfRouter — v11  (Punto 9)
 *
 * Generación de PDFs clínicos:
 *   - Ficha completa del paciente
 *   - Receta médica firmada (con datos del veterinario y matrícula)
 *   - Certificado de vacunación
 *   - Historia clínica paginada
 *
 * La generación real usa pdfmake o puppeteer en el servidor.
 * Este router retorna JSON estructurado listo para el generador.
 * Para producción: integrar con @pdfmake/pdfmake o playwright.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { getCtx, requireRole, ok } from "../../core/context.js";
import { AppError } from "../../core/errors/appError.js";

export function buildPdfRouter(_deps?: { featureFlags?: any }): Router {
  const r = Router();

  // ── GET /ficha/:pacienteId — ficha clínica completa ─────────────────────
  r.get("/ficha/:pacienteId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet", "staff");

      const id = parseInt(req.params.pacienteId);
      if (isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");

      const [pac] = await ctx.tenantPool.query<any[]>(
        `SELECT p.*, CONCAT(prop.nombre,' ',prop.apellido) AS propietario_nombre,
                prop.telefono, prop.email, prop.dni, prop.direccion
         FROM pacientes p LEFT JOIN propietarios prop ON prop.id=p.propietario_id
         WHERE p.id=? AND p.tenant_id=? AND p.is_active=1`,
        [id, ctx.tenantId]
      );
      if (!pac[0]) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      const [consultas] = await ctx.tenantPool.query<any[]>(
        `SELECT c.fecha, c.motivo, c.anamnesis, c.examen_fisico, c.diagnostico,
                c.diagnostico_cie10, c.tratamiento, c.temperatura, c.peso_kg,
                c.frecuencia_cardiaca, c.proxima_consulta,
                CONCAT(v.nombre,' ',v.apellido) AS veterinario, v.matricula
         FROM consultas c LEFT JOIN veterinarios v ON v.id=c.veterinario_id
         WHERE c.paciente_id=? AND c.tenant_id=? AND c.is_active=1
         ORDER BY c.fecha DESC LIMIT 20`,
        [id, ctx.tenantId]
      );

      const [vacunas] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM vacunas WHERE paciente_id=? AND tenant_id=? ORDER BY fecha_aplicacion DESC",
        [id, ctx.tenantId]
      );

      const [desparasitaciones] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM desparasitaciones WHERE paciente_id=? AND tenant_id=? ORDER BY fecha_aplicacion DESC",
        [id, ctx.tenantId]
      );

      // Retorna estructura lista para pdfmake/puppeteer
      const pdfData = {
        tipo: "ficha_clinica",
        generado_at: new Date().toISOString(),
        paciente: pac[0],
        consultas,
        vacunas,
        desparasitaciones,
      };

      // Header para que el frontend sepa que puede abrir el PDF
      res.setHeader("X-PDF-Type", "ficha_clinica");
      res.json(ok(pdfData));
    } catch (e) { next(e); }
  });

  // ── GET /receta/:prescripcionId — receta médica ──────────────────────────
  r.get("/receta/:prescripcionId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet");

      const id = parseInt(req.params.prescripcionId);
      if (isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           pr.id, pr.fecha, pr.medicamento, pr.dosis, pr.frecuencia,
           pr.duracion_dias, pr.instrucciones, pr.via_administracion,
           p.nombre AS paciente_nombre, p.especie, p.raza, p.peso_kg,
           p.fecha_nacimiento, p.microchip,
           CONCAT(prop.nombre,' ',prop.apellido) AS propietario_nombre,
           prop.dni AS propietario_dni,
           CONCAT(v.nombre,' ',v.apellido) AS veterinario_nombre,
           v.matricula AS veterinario_matricula,
           v.especialidad AS veterinario_especialidad,
           suc.nombre AS sucursal_nombre,
           suc.direccion AS sucursal_direccion,
           suc.telefono AS sucursal_telefono,
           suc.email AS sucursal_email
         FROM prescripciones pr
         JOIN pacientes p ON p.id=pr.paciente_id
         LEFT JOIN propietarios prop ON prop.id=p.propietario_id
         LEFT JOIN veterinarios v ON v.id=pr.veterinario_id
         LEFT JOIN sucursales suc ON suc.id=pr.sucursal_id
         WHERE pr.id=? AND pr.tenant_id=?`,
        [id, ctx.tenantId]
      );

      if (!rows[0]) throw new AppError("NOT_FOUND", "Prescripción no encontrada");

      const pdfData = {
        tipo: "receta_medica",
        numero_receta: `RX-${String(id).padStart(8, "0")}`,
        generado_at: new Date().toISOString(),
        valida_hasta: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        ...rows[0],
      };

      res.setHeader("X-PDF-Type", "receta_medica");
      res.json(ok(pdfData));
    } catch (e) { next(e); }
  });

  // ── GET /certificado-vacunacion/:pacienteId ──────────────────────────────
  r.get("/certificado-vacunacion/:pacienteId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet", "staff");

      const id = parseInt(req.params.pacienteId);
      if (isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");

      const [pac] = await ctx.tenantPool.query<any[]>(
        `SELECT p.*, CONCAT(prop.nombre,' ',prop.apellido) AS propietario_nombre
         FROM pacientes p LEFT JOIN propietarios prop ON prop.id=p.propietario_id
         WHERE p.id=? AND p.tenant_id=? AND p.is_active=1`,
        [id, ctx.tenantId]
      );
      if (!pac[0]) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      const [vacunas] = await ctx.tenantPool.query<any[]>(
        `SELECT v.nombre_vacuna, v.fecha_aplicacion, v.proxima_dosis,
                v.lote, v.laboratorio,
                CONCAT(vet.nombre,' ',vet.apellido) AS veterinario, vet.matricula
         FROM vacunas v LEFT JOIN veterinarios vet ON vet.id=v.veterinario_id
         WHERE v.paciente_id=? AND v.tenant_id=?
         ORDER BY v.fecha_aplicacion ASC`,
        [id, ctx.tenantId]
      );

      res.json(ok({
        tipo: "certificado_vacunacion",
        generado_at: new Date().toISOString(),
        paciente: pac[0],
        vacunas,
      }));
    } catch (e) { next(e); }
  });

  return r;
}
