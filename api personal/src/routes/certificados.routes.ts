// src/routes/certificados.routes.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { Sequelize, QueryTypes } from "sequelize";

/**
 * Reemplaza placeholders simples en los XML del DOCX.
 * Nota: esto funciona bien si los placeholders no están cortados en runs.
 */
export async function fillDocxTemplate(templateBuffer: Buffer, replacements: Record<string, string>) {
  const zip = await JSZip.loadAsync(templateBuffer);

  const candidates = Object.keys(zip.files).filter((p) =>
    p.startsWith("word/") &&
    p.endsWith(".xml") &&
    (p.includes("document.xml") || p.includes("header") || p.includes("footer"))
  );

  for (const p of candidates) {
    const f = zip.file(p);
    if (!f) continue;
    let xml = await f.async("string");

    for (const [k, v] of Object.entries(replacements)) {
      // reemplazo literal de token
      xml = xml.split(k).join(v ?? "");
    }

    zip.file(p, xml);
  }

  return await zip.generateAsync({ type: "nodebuffer" });
}

export function buildCertificadosRouter(sequelize: Sequelize) {
  const router = Router();

  // POST /api/v1/certificados/certificado-trabajo
  router.post("/certificado-trabajo", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) {
      return res.status(400).json({ ok: false, error: "dni requerido (number)" });
    }

    // 1) Buscar persona en la vista personaldetalle
    const rows = await sequelize.query(
      `SELECT dni, apellido, nombre, dependencia, ley, estado_empleo, fecha_ingreso
       FROM personaldetalle
       WHERE dni = :dni
       LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT }
    );

    const p: any = (rows as any[])[0];
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });

    // 2) Regla IOMA: HASTA
    const leyTxt = String(p.ley ?? "").toLowerCase();
    const estadoTxt = String(p.estado_empleo ?? "").toLowerCase();

    const aplicaActualidad =
      leyTxt.includes("10430") ||
      leyTxt.includes("10471") ||
      estadoTxt.includes("becario") ||
      estadoTxt.includes("residente");

    const anioActual = new Date().getFullYear();
    const hastaTxt = aplicaActualidad ? "a la actualidad" : `31/12/${anioActual}`;

    const formatDate = (d: any) => {
      if (!d) return "";
      const dt = new Date(d);
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    const ingresoTxt = formatDate(p.fecha_ingreso);

    // 3) Armar replacements
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();

    const replacements: Record<string, string> = {
      APELLIDOYNOMBRE: apellidoNombre,
      DNIP: String(p.dni ?? dni),

      // dependencia sale de la vista personaldetalle
      DEPENDENCIA: String(p.dependencia ?? ""),

      // estos quedan como opcionales (si el doc los usa)
      LEGAJO: String(req.body?.legajo ?? ""),
      DECRETO: String(req.body?.decreto ?? ""),
      LUGARYFECHA: String(req.body?.lugar_y_fecha ?? ""),

      // texto fijo dentro del doc 1
      "DIA/_MES/_AÑO": ingresoTxt,
      "/_   /_": hastaTxt,
    };

    // 4) Leer plantilla (doc 1)
    const templatePath = path.join(process.cwd(), "src", "templates", "1.docx");
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ ok: false, error: "Plantilla no encontrada: src/templates/1.docx" });
    }
    const tpl = fs.readFileSync(templatePath);

    // 5) Generar docx
    const out = await fillDocxTemplate(tpl, replacements);

    // Auditoría (para auditAllApi)
    (res.locals as any).audit = {
      action: "certificado_ioma_generate",
      table_name: "personaldetalle",
      record_pk: dni,
      request_json: { dni, ...replacements },
      response_json: { status: 200, bytes: out.length },
    };

    // 6) Responder como archivo
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="certificado_ioma_${dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  return router;
}