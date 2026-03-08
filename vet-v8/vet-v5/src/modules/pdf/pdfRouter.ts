/**
 * PDF Export — plan: pro+
 *
 * Genera PDFs de:
 *   - Historia clínica completa del paciente
 *   - Cartilla de vacunación
 *   - Factura
 *
 * Usa PDFKit (sin puppeteer, sin chrome) para máxima portabilidad.
 * Los PDFs se sirven inline o como attachment.
 */

import { Router } from "express";
import { AppError } from "../../core/errors/appError.js";
import { requireModule } from "../../infra/plan-limits/planGuard.js";

export function buildPdfRouter(opts: { featureFlags?: any } = {}) {
  const router = Router();

  router.use(requireModule("export_pdf", opts));

  /**
   * GET /api/v1/pdf/paciente/:id/historia
   * Descarga la historia clínica completa del paciente como PDF.
   */
  router.get("/paciente/:id/historia", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pacienteId = Number(req.params.id);

      // Load all data
      const [pac] = await ctx.tenantPool.query<any[]>(
        `SELECT p.*, pr.nombre as prop_nombre, pr.apellido as prop_apellido,
                pr.telefono as prop_telefono, pr.email as prop_email
         FROM pacientes p
         LEFT JOIN propietarios pr ON pr.id=p.propietario_id
         WHERE p.id=? AND p.tenant_id=? AND p.is_active=1 LIMIT 1`,
        [pacienteId, ctx.tenantId]
      );
      if (!pac?.length) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      const [consultas] = await ctx.tenantPool.query<any[]>(
        `SELECT c.*, v.nombre as vet_nombre, v.apellido as vet_apellido
         FROM consultas c LEFT JOIN veterinarios v ON v.id=c.veterinario_id
         WHERE c.paciente_id=? AND c.tenant_id=? ORDER BY c.fecha DESC`,
        [pacienteId, ctx.tenantId]
      );

      const [vacunas] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM vacunas WHERE paciente_id=? ORDER BY fecha_aplicacion DESC", [pacienteId]
      );

      const [prescripciones] = await ctx.tenantPool.query<any[]>(
        `SELECT pr.*, v.nombre as vet_nombre FROM prescripciones pr
         LEFT JOIN veterinarios v ON v.id=pr.veterinario_id
         WHERE pr.paciente_id=? ORDER BY pr.created_at DESC LIMIT 20`,
        [pacienteId]
      );

      // ── Dynamic import of PDFKit ──────────────────────────────────────────
      let PDFDocument: any;
      try {
        const mod = await import("pdfkit");
        PDFDocument = mod.default ?? mod;
      } catch {
        throw new AppError("SERVER_ERROR", "PDFKit no está instalado. Ejecutá: npm install pdfkit");
      }

      const p = pac[0];
      const now = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="historia_${p.nombre}_${pacienteId}.pdf"`);

      const doc = new PDFDocument({ margin: 50, size: "A4" });
      doc.pipe(res);

      // ── Header ────────────────────────────────────────────────────────────
      doc.fontSize(20).fillColor("#1e293b").text("VetPro — Historia Clínica", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#64748b").text(`Generado: ${now}`, { align: "right" });

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e2e8f0").stroke();
      doc.moveDown(0.5);

      // ── Datos del Paciente ─────────────────────────────────────────────────
      doc.fontSize(14).fillColor("#1e293b").text("Datos del Paciente");
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#374151");

      const fields: [string, any][] = [
        ["Nombre", p.nombre],
        ["Especie", p.especie],
        ["Raza", p.raza ?? "—"],
        ["Sexo", p.sexo ?? "—"],
        ["Fecha de Nacimiento", p.fecha_nacimiento ?? "—"],
        ["Microchip", p.microchip ?? "—"],
        ["Peso", p.peso_kg ? `${p.peso_kg} kg` : "—"],
        ["Alergias", p.alergias ?? "—"],
      ];

      for (const [label, value] of fields) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(String(value ?? "—"));
      }

      if (p.prop_nombre) {
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").text("Propietario: ", { continued: true });
        doc.font("Helvetica").text(`${p.prop_nombre} ${p.prop_apellido} — Tel: ${p.prop_telefono ?? "—"}`);
      }

      // ── Vacunas ───────────────────────────────────────────────────────────
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e2e8f0").stroke();
      doc.moveDown(0.5);
      doc.fontSize(14).fillColor("#1e293b").text("Cartilla de Vacunación");
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor("#374151");

      if (!vacunas?.length) {
        doc.text("Sin vacunas registradas.");
      } else {
        for (const v of vacunas) {
          doc.font("Helvetica-Bold").text(`• ${v.nombre}`, { continued: true });
          doc.font("Helvetica").text(
            ` — Aplicada: ${v.fecha_aplicacion}` +
            (v.proxima_dosis ? ` | Próxima dosis: ${v.proxima_dosis}` : "") +
            (v.laboratorio ? ` | Lab: ${v.laboratorio}` : "")
          );
        }
      }

      // ── Historia Clínica ──────────────────────────────────────────────────
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#e2e8f0").stroke();
      doc.moveDown(0.5);
      doc.fontSize(14).fillColor("#1e293b").text("Consultas Clínicas");

      if (!consultas?.length) {
        doc.moveDown(0.5).fontSize(9).text("Sin consultas registradas.");
      } else {
        for (const c of consultas) {
          doc.addPage();
          doc.fontSize(11).fillColor("#1e293b").font("Helvetica-Bold")
            .text(`Consulta del ${String(c.fecha).slice(0, 10)}`);
          if (c.vet_nombre) {
            doc.fontSize(9).fillColor("#64748b").font("Helvetica")
              .text(`Veterinario: Dr/a. ${c.vet_nombre} ${c.vet_apellido}`);
          }
          doc.moveDown(0.3);

          const soapFields: [string, any][] = [
            ["Motivo", c.motivo],
            ["Anamnesis", c.anamnesis],
            ["Examen Físico", c.examen_fisico],
            ["Diagnóstico", c.diagnostico],
            ["Tratamiento", c.tratamiento],
          ];

          for (const [label, value] of soapFields) {
            if (!value) continue;
            doc.fontSize(9).font("Helvetica-Bold").fillColor("#374151").text(`${label}:`, { continued: false });
            doc.font("Helvetica").fillColor("#4b5563").text(String(value), { indent: 20 });
            doc.moveDown(0.3);
          }

          // Signos vitales
          const vitals: [string, any][] = [
            ["Temperatura", c.temperatura ? `${c.temperatura} °C` : null],
            ["Peso", c.peso_kg ? `${c.peso_kg} kg` : null],
            ["FC", c.frecuencia_cardiaca ? `${c.frecuencia_cardiaca} lpm` : null],
            ["FR", c.frecuencia_respiratoria ? `${c.frecuencia_respiratoria} rpm` : null],
          ];
          const validVitals = vitals.filter(([, v]) => v);
          if (validVitals.length) {
            doc.fontSize(9).font("Helvetica-Bold").text("Signos Vitales: ", { continued: true });
            doc.font("Helvetica").text(validVitals.map(([l, v]) => `${l}: ${v}`).join(" | "));
          }
        }
      }

      // ── Prescripciones ─────────────────────────────────────────────────────
      if (prescripciones?.length) {
        doc.addPage();
        doc.fontSize(14).fillColor("#1e293b").font("Helvetica-Bold").text("Prescripciones recientes");
        doc.moveDown(0.5);
        for (const pr of prescripciones) {
          doc.fontSize(10).font("Helvetica-Bold").text(`• ${pr.medicamento}`);
          if (pr.dosis) doc.fontSize(9).font("Helvetica").text(`  Dosis: ${pr.dosis}`);
          if (pr.frecuencia) doc.font("Helvetica").text(`  Frecuencia: ${pr.frecuencia}`);
          if (pr.instrucciones) doc.font("Helvetica").text(`  Instrucciones: ${pr.instrucciones}`);
          doc.moveDown(0.3);
        }
      }

      doc.end();
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/pdf/paciente/:id/vacunas
   * Cartilla de vacunación solamente.
   */
  router.get("/paciente/:id/vacunas", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pacienteId = Number(req.params.id);

      const [pac] = await ctx.tenantPool.query<any[]>(
        "SELECT nombre, especie FROM pacientes WHERE id=? AND tenant_id=? LIMIT 1",
        [pacienteId, ctx.tenantId]
      );
      if (!pac?.length) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      const [vacunas] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM vacunas WHERE paciente_id=? ORDER BY fecha_aplicacion ASC", [pacienteId]
      );

      let PDFDocument: any;
      try {
        const mod = await import("pdfkit");
        PDFDocument = mod.default ?? mod;
      } catch {
        throw new AppError("SERVER_ERROR", "PDFKit no instalado");
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="vacunas_${pac[0].nombre}.pdf"`);

      const doc = new PDFDocument({ margin: 50, size: "A4" });
      doc.pipe(res);

      doc.fontSize(18).text(`Cartilla de Vacunación — ${pac[0].nombre}`, { align: "center" });
      doc.fontSize(11).fillColor("#64748b").text(`${pac[0].especie}`, { align: "center" });
      doc.moveDown(1);

      if (!vacunas?.length) {
        doc.fontSize(10).text("Sin vacunas registradas.");
      } else {
        for (const v of vacunas) {
          doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e293b").text(v.nombre);
          doc.fontSize(9).font("Helvetica").fillColor("#374151")
            .text(`Aplicada: ${v.fecha_aplicacion}`)
            .text(`Vencimiento: ${v.fecha_vencimiento ?? "—"}`)
            .text(`Próxima dosis: ${v.proxima_dosis ?? "—"}`);
          if (v.laboratorio) doc.text(`Laboratorio: ${v.laboratorio}`);
          doc.moveDown(0.5);
        }
      }

      doc.end();
    } catch (e) { next(e); }
  });

  return router;
}
