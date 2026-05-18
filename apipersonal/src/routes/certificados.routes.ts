// src/routes/certificados.routes.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { Sequelize, QueryTypes } from "sequelize";

let ExcelJS: any;
try { ExcelJS = require("exceljs"); } catch { ExcelJS = null; }

const DIR_INTRANET = "D:\\G\\DIRECCIONES INTRANET";

function resolveExcelDirecciones(dependencia: string): string | null {
  if (!ExcelJS) return null;
  const dep = String(dependencia ?? "").toUpperCase();
  let filename: string;
  if (dep.includes("UPA 18") || dep.includes("UPA18") || dep.includes("18"))
    filename = "direccionesupa18.xlsx";
  else if (dep.includes("UPA 4") || dep.includes("UPA4") || dep.includes("UPA4"))
    filename = "direccionesupa4.xlsx";
  else
    filename = "direccioneshtal.xlsx";
  const fp = path.join(DIR_INTRANET, filename);
  return fs.existsSync(fp) ? fp : path.join(DIR_INTRANET, "direccioneshtal.xlsx");
}

async function readDireccionFromExcel(dependencia: string, dni: number): Promise<{
  domicilio: string; numeroDom: string; piso: string; depto: string;
  localidad: string; cp: string;
} | null> {
  if (!ExcelJS) return null;
  const fp = resolveExcelDirecciones(dependencia);
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fp);
    const ws = wb.worksheets[0];
    if (!ws) return null;
    const dniStr = String(dni);
    let found: any = null;
    ws.eachRow((row: any, rn: number) => {
      if (rn === 1 || found) return;
      const cellDni = String(row.getCell(3).value ?? "").replace(/\D/g, "");
      if (cellDni === dniStr) found = row;
    });
    if (!found) return null;
    return {
      domicilio:  String(found.getCell(6).value  ?? "").trim(),
      numeroDom:  String(found.getCell(7).value  ?? "").trim(),
      piso:       String(found.getCell(10).value ?? "").trim(),
      depto:      String(found.getCell(11).value ?? "").trim(),
      localidad:  String(found.getCell(12).value ?? "").trim(),
      cp:         String(found.getCell(13).value ?? "").trim(),
    };
  } catch { return null; }
}

/**
 * Reemplaza placeholders fragmentados por Word entre dos <w:t> separados por
 * runs/proofErr intermedios. Aplica solo para placeholders {{...}} que Word
 * suele partir en el corrector ortográfico.
 *
 * En lugar de consolidar todos los runs (lo que rompe VML/txbxContent anidados),
 * hace un reemplazo quirúrgico buscando el patrón exacto: parte1</w:t>...XML...parte2
 */
function reemplazarFragmentados(xml: string, placeholder: string, valor: string): string {
  // Intentar cada posible punto de corte del placeholder
  for (let i = 1; i < placeholder.length; i++) {
    const parte1 = placeholder.substring(0, i);
    const parte2 = placeholder.substring(i);
    // Escapar para uso en regex
    const esc1 = parte1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const esc2 = parte2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Reemplazar: parte1</w:t> + XML intermedio (no más de ~300 chars) + parte2
    const re = new RegExp(`${esc1}<\\/w:t>(?:[\\s\\S]{0,300}?)<w:t[^>]*>${esc2}`, 'g');
    if (re.test(xml)) {
      xml = xml.replace(re, valor);
    }
  }
  return xml;
}

/**
 * Reemplaza placeholders en los XML del DOCX.
 * No modifica la estructura de runs (evita romper VML/txbxContent anidados).
 * Para placeholders {{...}} fragmentados entre runs, usa reemplazo quirúrgico.
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
      // Reemplazo directo (placeholder en un solo run)
      xml = xml.split(k).join(v ?? "");
      // Reemplazo de placeholder fragmentado entre dos runs (solo para {{...}})
      if (k.startsWith("{{") && xml.includes(k.substring(0, k.indexOf("}")))) {
        xml = reemplazarFragmentados(xml, k, v ?? "");
      }
    }

    zip.file(p, xml);
  }

  return await zip.generateAsync({ type: "nodebuffer" });
}

// ─── helpers compartidos ─────────────────────────────────────────────────────

function formatDateDMY(d: any): string {
  if (!d) return "";
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function calcHasta(leyTxt: string): string {
  const l = String(leyTxt ?? "").toLowerCase();
  const esBecaOResidente =
    l.includes("beca") || l.includes("residente") || l.includes("irab") ||
    l.includes("art. 48") || l.includes("art48") || l.includes("perinatal") ||
    l.includes("vacunacion") || l.includes("contingencia");
  return esBecaOResidente ? `31/12/${new Date().getFullYear()}` : "y continúa";
}

async function queryPersonaldetalle(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.dependencia, pd.ley,
            pd.estado_empleo, pd.fecha_ingreso, pd.decreto_designacion,
            COALESCE(pd.legajo, a.legajo) AS legajo
     FROM personaldetalle pd
     LEFT JOIN agentes a ON a.dni = pd.dni AND a.deleted_at IS NULL
     WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] ?? null;
}

async function queryPersonalConDomicilio(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.dependencia, pd.ley,
            pd.estado_empleo, pd.fecha_ingreso, pd.decreto_designacion,
            pd.localidad,
            COALESCE(pd.legajo, a.legajo) AS legajo,
            p.domicilio, p.numerodomicilio, p.piso, p.depto, p.cp
     FROM personaldetalle pd
     LEFT JOIN agentes a   ON a.dni = pd.dni AND a.deleted_at IS NULL
     LEFT JOIN personal p  ON p.dni = pd.dni AND p.deleted_at IS NULL
     WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] ?? null;
}

function resolveTemplatePath(filename: string): string {
  const prodPath = path.join(process.cwd(), "templates", filename);
  const devPath  = path.join(process.cwd(), "src", "templates", filename);
  return fs.existsSync(prodPath) ? prodPath : devPath;
}

export function buildCertificadosRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /api/v1/certificados/certificado-trabajo/datos?dni=X
  // Devuelve los datos resueltos (sin generar el DOCX) para mostrar el preview
  router.get("/certificado-trabajo/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) {
      return res.status(400).json({ ok: false, error: "dni requerido" });
    }
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });

    const ingresoTxt    = formatDateDMY(p.fecha_ingreso) + " ";
    const hasta         = calcHasta(p.ley);
    const hoy           = new Date();
    const lugarFecha    = `González Catán, ${formatDateDMY(hoy)}`;
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();

    return res.json({
      ok: true,
      data: {
        apellidoNombre,
        dni:         String(p.dni ?? dni),
        dependencia: String(p.dependencia ?? ""),
        ley:         String(p.ley ?? ""),
        legajo:      String(p.legajo ?? ""),
        decreto:     String(p.decreto_designacion ?? ""),
        fechaIngreso: ingresoTxt,
        hasta,
        lugarFecha,
      },
    });
  });

  // GET /api/v1/certificados/certificado-trabajo/preview?dni=X
  // Devuelve HTML renderizado del DOCX relleno (para mostrar en iframe del preview)
  router.get("/certificado-trabajo/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) {
      return res.status(400).json({ ok: false, error: "dni requerido" });
    }

    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });

    const ingresoTxt     = formatDateDMY(p.fecha_ingreso) + " ";
    const hastaTxt       = calcHasta(p.ley);
    const lugarFechaAuto = `González Catán, ${formatDateDMY(new Date())}`;
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();

    const replacements: Record<string, string> = {
      "APELLIDOYNOMBRE":    apellidoNombre,
      "APELLIDOYNOMBRE ":   apellidoNombre,
      "DNIP":               String(p.dni ?? dni),
      "DEPENDENCIA":        String(p.dependencia ?? ""),
      "LEGAJO":             String(p.legajo ?? ""),
      "DECRETO":            String(p.decreto_designacion ?? ""),
      "LUGARYFECHA":        lugarFechaAuto,
      "{{FECHA_INGRESO }}": ingresoTxt,
      "{{FECHA_INGRESO}}":  ingresoTxt,
      "{{HASTA}}":          hastaTxt,
      "FECHA_INGRESO":      ingresoTxt,
      "HASTA":              hastaTxt,
    };

    const templatePath = (() => {
      const prodPath = path.join(process.cwd(), "templates", "1.docx");
      const devPath  = path.join(process.cwd(), "src", "templates", "1.docx");
      return fs.existsSync(prodPath) ? prodPath : devPath;
    })();
    if (!fs.existsSync(templatePath)) {
      return res.status(500).send("<p>Plantilla no encontrada</p>");
    }


    const tpl = fs.readFileSync(templatePath);
    const docxBuffer = await fillDocxTemplate(tpl, replacements);

    // Convertir DOCX a HTML con mammoth
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ buffer: docxBuffer });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; padding: 40px 56px; color: #111; font-size: 13px; line-height: 1.8; max-width: 800px; margin: 0 auto; }
    p { margin: 0 0 14px 0; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 4px 8px; }
  </style>
</head>
<body>${result.value}</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  // POST /api/v1/certificados/certificado-trabajo
  router.post("/certificado-trabajo", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) {
      return res.status(400).json({ ok: false, error: "dni requerido (number)" });
    }

    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });

    const ingresoTxt     = formatDateDMY(p.fecha_ingreso) + " ";
    const hastaTxt       = calcHasta(p.ley);
    const lugarFechaAuto = `González Catán, ${formatDateDMY(new Date())}`;
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();

    const legajoVal = String(p.legajo ?? req.body?.legajo ?? "");
    const decretoVal = String(p.decreto_designacion ?? req.body?.decreto ?? "");

    const replacements: Record<string, string> = {
      // Placeholders exactos del template (luego de consolidar runs)
      "APELLIDOYNOMBRE":    apellidoNombre,
      "APELLIDOYNOMBRE ":   apellidoNombre,   // con espacio al final por si Word lo agrega
      "DNIP":               String(p.dni ?? dni),
      "DEPENDENCIA":        String(p.dependencia ?? ""),
      "LEGAJO":             legajoVal,
      "DECRETO":            decretoVal,
      "LUGARYFECHA":        lugarFechaAuto,
      // Fecha de ingreso — el template tiene "{{FECHA_INGRESO }}" fragmentado en dos runs
      // Después de consolidar quedará junto; cubrimos todas las variantes:
      "{{FECHA_INGRESO }}": ingresoTxt,
      "{{FECHA_INGRESO}}":  ingresoTxt,
      "{{HASTA}}":          hastaTxt,
      "FECHA_INGRESO":      ingresoTxt,
      "HASTA":              hastaTxt,
    };

    // En dev: process.cwd()/src/templates/  En prod: process.cwd()/templates/
    // El deploy copia src/templates/ → dist/../templates/ (raíz del proyecto prod)
    const templatePath = (() => {
      const prodPath = path.join(process.cwd(), "templates", "1.docx");
      const devPath  = path.join(process.cwd(), "src", "templates", "1.docx");
      return fs.existsSync(prodPath) ? prodPath : devPath;
    })();
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ ok: false, error: "Plantilla no encontrada (buscada en templates/ y src/templates/)" });
    }
    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);

    (res.locals as any).audit = {
      action: "certificado_ioma_generate",
      table_name: "personaldetalle",
      record_pk: dni,
      request_json: { dni, ...replacements },
      response_json: { status: 200, bytes: out.length },
    };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="certificado_ioma_${dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  // ─── Cédula de Notificación ───────────────────────────────────────────────

  // GET /api/v1/certificados/cedula/datos?dni=X
  router.get("/cedula/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalConDomicilio(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();

    // Intentar leer dirección desde Excel de DIRECCIONES INTRANET
    const excelDir = await readDireccionFromExcel(String(p.dependencia ?? ""), dni);

    return res.json({
      ok: true,
      data: {
        apellidoNombre,
        dni:       String(p.dni ?? dni),
        domicilio: excelDir?.domicilio ?? String(p.domicilio      ?? ""),
        numeroDom: excelDir?.numeroDom ?? String(p.numerodomicilio ?? ""),
        piso:      excelDir?.piso      ?? String(p.piso            ?? ""),
        depto:     excelDir?.depto     ?? String(p.depto           ?? ""),
        localidad: excelDir?.localidad ?? String(p.localidad       ?? ""),
        cp:        excelDir?.cp        ?? String(p.cp              ?? ""),
        lugarFecha: `González Catán, ${formatDateDMY(new Date())}`,
      },
    });
  });

  // GET /api/v1/certificados/cedula/preview
  router.get("/cedula/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalConDomicilio(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });

    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const excelDir       = await readDireccionFromExcel(String(p.dependencia ?? ""), dni);
    const replacements   = buildCedulaReplacements(p, apellidoNombre, req.query as Record<string, string>, excelDir);

    const templatePath = resolveTemplatePath("cedula.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).send("<p>Plantilla cedula.docx no encontrada</p>");

    const tpl = fs.readFileSync(templatePath);
    const docxBuffer = await fillDocxTemplate(tpl, replacements);
    const mammoth = await import("mammoth");
    const result  = await mammoth.convertToHtml({ buffer: docxBuffer });

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Georgia,serif;padding:40px 56px;color:#111;font-size:13px;line-height:1.8;max-width:800px;margin:0 auto}
p{margin:0 0 10px 0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}</style>
</head><body>${result.value}</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  // POST /api/v1/certificados/cedula
  router.post("/cedula", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalConDomicilio(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });

    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const excelDir       = await readDireccionFromExcel(String(p.dependencia ?? ""), dni);
    const replacements   = buildCedulaReplacements(p, apellidoNombre, req.body, excelDir);

    const templatePath = resolveTemplatePath("cedula.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: "Plantilla cedula.docx no encontrada" });

    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);

    (res.locals as any).audit = {
      action: "cedula_notificacion_generate",
      table_name: "personaldetalle",
      record_pk: dni,
      request_json: { dni },
      response_json: { status: 200, bytes: out.length },
    };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="cedula_${dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  // ─── Nota Comisaría ──────────────────────────────────────────────────────

  router.get("/nota-comisaria/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    return res.json({
      ok: true,
      data: {
        apellidoNombre,
        dni: String(p.dni ?? dni),
        lugarFecha: `González Catán, ${formatDateDMY(new Date())}`,
      },
    });
  });

  router.get("/nota-comisaria/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const replacements: Record<string, string> = {
      "LUGARYFECHA":    `González Catán, ${formatDateDMY(new Date())}`,
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":      String(p.dni ?? dni),
    };
    const templatePath = resolveTemplatePath("notaComisaria.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).send("<p>Plantilla notaComisaria.docx no encontrada</p>");
    const tpl = fs.readFileSync(templatePath);
    const docxBuffer = await fillDocxTemplate(tpl, replacements);
    const mammoth = await import("mammoth");
    const result  = await mammoth.convertToHtml({ buffer: docxBuffer });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Georgia,serif;padding:40px 56px;color:#111;font-size:13px;line-height:1.8;max-width:800px;margin:0 auto}
p{margin:0 0 10px 0}</style></head><body>${result.value}</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  router.post("/nota-comisaria", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const replacements: Record<string, string> = {
      "LUGARYFECHA":    `González Catán, ${formatDateDMY(new Date())}`,
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":      String(p.dni ?? dni),
    };
    const templatePath = resolveTemplatePath("notaComisaria.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: "Plantilla notaComisaria.docx no encontrada" });
    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="nota_comisaria_${dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  // ─── Certificado Base Vieja ───────────────────────────────────────────────

  router.get("/cert-base-vieja/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    return res.json({
      ok: true,
      data: {
        apellidoNombre,
        dni:         String(p.dni ?? dni),
        legajo:      String(p.legajo ?? ""),
        fechaIngreso: formatDateDMY(p.fecha_ingreso),
        dependencia: String(p.dependencia ?? ""),
      },
    });
  });

  router.get("/cert-base-vieja/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const replacements: Record<string, string> = {
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":      String(p.dni ?? dni),
      "LEGAJOAGENTE":   String(p.legajo ?? ""),
      "FECHAINGRESO":   formatDateDMY(p.fecha_ingreso),
      "CARGO":          String(req.query?.cargo ?? ""),
      "HSSEMANALES":    String(req.query?.hsSemanales ?? ""),
      "SERVICIO":       String(req.query?.servicio ?? ""),
    };
    const templatePath = resolveTemplatePath("certBaseVieja.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).send("<p>Plantilla certBaseVieja.docx no encontrada</p>");
    const tpl = fs.readFileSync(templatePath);
    const docxBuffer = await fillDocxTemplate(tpl, replacements);
    const mammoth = await import("mammoth");
    const result  = await mammoth.convertToHtml({ buffer: docxBuffer });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Georgia,serif;padding:40px 56px;color:#111;font-size:13px;line-height:1.8;max-width:800px;margin:0 auto}
p{margin:0 0 10px 0}</style></head><body>${result.value}</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  router.post("/cert-base-vieja", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const replacements: Record<string, string> = {
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":      String(p.dni ?? dni),
      "LEGAJOAGENTE":   String(p.legajo ?? ""),
      "FECHAINGRESO":   formatDateDMY(p.fecha_ingreso),
      "CARGO":          String(req.body?.cargo ?? ""),
      "HSSEMANALES":    String(req.body?.hsSemanales ?? ""),
      "SERVICIO":       String(req.body?.servicio ?? ""),
    };
    const templatePath = resolveTemplatePath("certBaseVieja.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: "Plantilla certBaseVieja.docx no encontrada" });
    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="cert_base_vieja_${dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  // ─── Certificado Laboral Rotación ─────────────────────────────────────────

  router.get("/cert-rotacion/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    return res.json({
      ok: true,
      data: {
        apellidoNombre,
        dni:         String(p.dni ?? dni),
        legajo:      String(p.legajo ?? ""),
        fechaIngreso: formatDateDMY(p.fecha_ingreso),
        dependencia: String(p.dependencia ?? ""),
      },
    });
  });

  router.get("/cert-rotacion/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const replacements: Record<string, string> = {
      "LUGARYFECHA":    `González Catán, ${formatDateDMY(new Date())}`,
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":      String(p.dni ?? dni),
      "LEGAJOAGENTE":   String(p.legajo ?? ""),
      "FECHAINGRESO":   formatDateDMY(p.fecha_ingreso),
      "SERVICIO":       String(req.query?.servicio ?? ""),
      "NUMART":         String(req.query?.numArt ?? ""),
    };
    const templatePath = resolveTemplatePath("certRotacion.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).send("<p>Plantilla certRotacion.docx no encontrada</p>");
    const tpl = fs.readFileSync(templatePath);
    const docxBuffer = await fillDocxTemplate(tpl, replacements);
    const mammoth = await import("mammoth");
    const result  = await mammoth.convertToHtml({ buffer: docxBuffer });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Georgia,serif;padding:40px 56px;color:#111;font-size:13px;line-height:1.8;max-width:800px;margin:0 auto}
p{margin:0 0 10px 0}</style></head><body>${result.value}</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  router.post("/cert-rotacion", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const replacements: Record<string, string> = {
      "LUGARYFECHA":    `González Catán, ${formatDateDMY(new Date())}`,
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":      String(p.dni ?? dni),
      "LEGAJOAGENTE":   String(p.legajo ?? ""),
      "FECHAINGRESO":   formatDateDMY(p.fecha_ingreso),
      "SERVICIO":       String(req.body?.servicio ?? ""),
      "NUMART":         String(req.body?.numArt ?? ""),
    };
    const templatePath = resolveTemplatePath("certRotacion.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: "Plantilla certRotacion.docx no encontrada" });
    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="cert_rotacion_${dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  return router;
}

const SUFIJOS_ORD = ["","1º","2º","3º","4º","5º","6º","7º"];

function buildCedulaReplacements(
  p: any,
  apellidoNombre: string,
  fields: Record<string, string>,
  domicilioOverride?: { domicilio: string; numeroDom: string; piso: string; depto: string; localidad: string; cp: string } | null,
): Record<string, string> {
  const artReplacements: Record<string, string> = {};
  for (let i = 1; i <= 7; i++) {
    const text = String(fields?.[`art${i}`] ?? "").trim();
    artReplacements[`ART${i}FULL`] = text ? `ARTICULO ${SUFIJOS_ORD[i]}. ${text}` : "";
  }
  return {
    "LUGARYFECHA":        `González Catán, ${formatDateDMY(new Date())}`,
    "APELLIDOYNOMBRE":    apellidoNombre,
    "DOMICILIOAGENTE":    domicilioOverride?.domicilio ?? String(p.domicilio      ?? ""),
    "NUMERODOM":          domicilioOverride?.numeroDom ?? String(p.numerodomicilio ?? ""),
    "PISOAGENTE":         domicilioOverride?.piso      ?? String(p.piso            ?? ""),
    "DEPTOAGENTE":        domicilioOverride?.depto     ?? String(p.depto           ?? ""),
    "LOCALIDADAGENTE":    domicilioOverride?.localidad ?? String(p.localidad       ?? ""),
    "CPAGENTE":           domicilioOverride?.cp        ?? String(p.cp              ?? ""),
    "TIPONOTIF":          String(fields?.tipoNotif ?? fields?.tiponotif ?? "la Resolución"),
    "VISTOTEXT":          String(fields?.vistoText ?? fields?.vistotext ?? ""),
    "CONSIDERANDOTEXT":   String(fields?.considerandoText ?? fields?.considerandotext ?? ""),
    ...artReplacements,
  };
}