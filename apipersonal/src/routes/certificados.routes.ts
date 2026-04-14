// src/routes/certificados.routes.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { Sequelize, QueryTypes } from "sequelize";

/**
 * Word fragmenta el texto entre múltiples <w:r><w:t> runs (para corrector ortográfico, etc.).
 * Antes de reemplazar, consolidamos el texto visible dentro de cada <w:p> en un solo run,
 * preservando el formato del primer run del párrafo.
 */
function consolidarRunsEnParrafos(xml: string): string {
  // Reemplaza secuencias de <w:r>...<w:t>texto</w:t></w:r> adyacentes dentro de un <w:p>
  // Estrategia: dentro de cada párrafo, concatenar todos los <w:t> en el primer <w:r> que tenga <w:t>
  return xml.replace(
    /(<w:p\b[^>]*>)([\s\S]*?)(<\/w:p>)/g,
    (_match, open, inner, close) => {
      // Extraer todos los fragmentos de texto de los <w:r>
      const textos: string[] = [];
      const reT = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let m: RegExpExecArray | null;
      while ((m = reT.exec(inner)) !== null) {
        textos.push(m[1]);
      }
      const textoTotal = textos.join('');

      // Si no hay texto o solo tiene un run, no tocamos
      if (textos.length <= 1) return open + inner + close;

      // Reemplazar los <w:r>...</w:r> por un único run con el texto consolidado
      // Conservamos el primer <w:rPr> encontrado para mantener el formato
      const rprMatch = inner.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      const rpr = rprMatch ? `<w:rPr>${rprMatch[1]}</w:rPr>` : '';

      // Quitar todos los <w:r>...</w:r> del inner y las marcas de corrección
      const sinRuns = inner
        .replace(/<w:r\b[\s\S]*?<\/w:r>/g, '')
        .replace(/<w:proofErr[^/]*\/>/g, '');

      // Agregar el run consolidado al final del inner limpio
      const nuevoRun = `<w:r>${rpr}<w:t xml:space="preserve">${textoTotal}</w:t></w:r>`;
      return open + sinRuns + nuevoRun + close;
    }
  );
}

/**
 * Reemplaza placeholders en los XML del DOCX.
 * Consolida runs fragmentados por Word antes de reemplazar.
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

    // Consolidar runs fragmentados antes de reemplazar
    xml = consolidarRunsEnParrafos(xml);

    for (const [k, v] of Object.entries(replacements)) {
      xml = xml.split(k).join(v ?? "");
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
    `SELECT dni, apellido, nombre, dependencia, ley, estado_empleo, fecha_ingreso, legajo, decreto_designacion
     FROM personaldetalle WHERE dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] ?? null;
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

    const ingresoTxt    = formatDateDMY(p.fecha_ingreso);
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

  // POST /api/v1/certificados/certificado-trabajo
  router.post("/certificado-trabajo", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) {
      return res.status(400).json({ ok: false, error: "dni requerido (number)" });
    }

    const p = await queryPersonaldetalle(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });

    const ingresoTxt     = formatDateDMY(p.fecha_ingreso);
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

  return router;
}