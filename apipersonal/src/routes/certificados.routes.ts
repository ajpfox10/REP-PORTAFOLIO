// src/routes/certificados.routes.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { Sequelize, QueryTypes } from "sequelize";
import { generateCvJpg } from "../services/cvImage";
import { env } from "../config/env";

let ExcelJS: any;
try { ExcelJS = require("exceljs"); } catch { ExcelJS = null; }

const DIR_INTRANET = "D:\\G\\DIRECCIONES INTRANET";
const DIR_DOCU_DEFAULT = "D:\\G\\DOCU";

function resolveCvDocuDir(): string {
  return (
    process.env.CV_DOCU_DIR?.trim() ||
    env.DOCUMENTS_SCAN_DIR?.trim() ||
    env.PHOTOS_BASE_DIR?.trim() ||
    DIR_DOCU_DEFAULT
  );
}

function resolveCvDniDir(dni: number): string {
  const docuDir = resolveCvDocuDir();
  if (!docuDir) throw new Error("Carpeta DOCU no configurada");
  const dniDir = path.join(docuDir, String(dni));
  fs.mkdirSync(dniDir, { recursive: true });
  return dniDir;
}

function resolveExistingInDir(dir: string, candidates: string[]): string | null {
  if (!fs.existsSync(dir)) return null;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const files = fs.readdirSync(dir);
  for (const candidate of candidates) {
    const direct = path.join(dir, candidate);
    if (fs.existsSync(direct)) return direct;
    const wanted = normalize(candidate);
    const found = files.find((f) => normalize(f) === wanted);
    if (found) return path.join(dir, found);
  }
  return null;
}

function resolveExcelDirecciones(dependencia: string): string | null {
  if (!ExcelJS) return null;
  const dep = String(dependencia ?? "").toUpperCase();
  const candidates =
    dep.includes("UPA 18") || dep.includes("UPA18") || dep.includes("18")
      ? ["direccionesupa18.xlsx", "Direcciones UPA18.xlsx", "Direcciones UPA 18.xlsx"]
      : dep.includes("UPA 4") || dep.includes("UPA4")
        ? ["direccionesupa4.xlsx", "Direcciones UPA 4.xlsx"]
        : ["direccioneshtal.xlsx", "Direcciones Hospital.xlsx"];
  return resolveExistingInDir(DIR_INTRANET, [...candidates, "direccioneshtal.xlsx", "Direcciones Hospital.xlsx"]);
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
 * "Plomería" que Word intercala entre dos fragmentos de texto del mismo párrafo:
 * cierre de run, marcadores self-closing (proofErr/bookmark/pageBreak) y apertura
 * del siguiente run con sus rPr. Está anclada a </w:t></w:r> ... <w:t>, por lo que
 * solo matchea en límites de run reales: no rompe VML/txbxContent ni genera falsos
 * positivos en texto plano.
 */
const RUN_GAP =
  '(?:</w:t></w:r>(?:<w:[a-zA-Z]+[^>]*/>)*<w:r\\b[^>]*>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:t[^>]*>)?';

/**
 * Reemplaza un placeholder aunque Word lo haya partido en varios runs.
 *
 * Word parte los placeholders cuando el corrector ortográfico marca el texto
 * interno (lo envuelve en <w:proofErr spellStart/spellEnd> y lo aísla en su propio
 * run), dejando los delimitadores $...$ / %...% en runs separados. El reemplazo
 * directo (split/join) no los encuentra porque la cadena literal ya no existe.
 *
 * Construye un patrón que tolera RUN_GAP entre cualquier par de caracteres del
 * placeholder, de modo que reconstruye $estadocivil$, %dire%, %piso$, %cp%, etc.
 * sin depender de cuántos runs los partan. El valor se inserta vía función de
 * reemplazo para no interpretar $ ni \ que pudiera contener.
 */
function reemplazarPlaceholderTolerante(xml: string, placeholder: string, valor: string): string {
  const pattern = placeholder
    .split('')
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(RUN_GAP);
  const re = new RegExp(pattern, 'g');
  return xml.replace(re, () => valor);
}

/**
 * Agrega <w:fitText> al run que contiene el valor indicado, para que Word
 * comprima el texto horizontalmente y no lo corte en líneas cuando la columna
 * es más angosta que el texto. Solo se aplica si el valor tiene más de
 * minChars caracteres (para no expandir textos cortos).
 */
function agregarFitText(xml: string, valor: string, anchoTwips: number, idBase: number, minChars = 16): string {
  if (!valor || valor.length <= minChars) return xml;
  const escaped = valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(<w:rPr>)([\\s\\S]*?)(</w:rPr>)(\\s*<w:t[^>]*>${escaped}</w:t>)`,
    'g'
  );
  return xml.replace(re, (_m, rprOpen, rprContent, rprClose, textPart) => {
    const cleaned = rprContent.replace(/<w:fitText[^/]*\/>\s*/g, '');
    return `${rprOpen}${cleaned}<w:fitText w:id="${idBase}" w:val="${anchoTwips}"/>${rprClose}${textPart}`;
  });
}

/**
 * Reemplaza placeholders en los XML del DOCX.
 * No modifica la estructura de runs (evita romper VML/txbxContent anidados).
 * Para placeholders {{...}} fragmentados entre runs, usa reemplazo quirúrgico.
 *
 * fitTextFields: opcional. Mapa de placeholder → ancho en twips. Para los
 * campos indicados, agrega <w:fitText> al run para evitar que el texto se
 * parta en varias líneas cuando la columna es angosta.
 */
export async function fillDocxTemplate(
  templateBuffer: Buffer,
  replacements: Record<string, string>,
  fitTextFields?: Record<string, number>
) {
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
      if (k === "SERVICIO") {
        xml = xml.replace(/(^|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])SERVICIO(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])/g, (_m, prefix) => `${prefix}${v ?? ""}`);
      } else {
        xml = xml.split(k).join(v ?? "");
      }
      // Reemplazo de placeholder fragmentado entre runs (Word lo parte cuando el
      // corrector marca el texto interno y lo aísla en su propio run).
      if (k.startsWith("{{") && xml.includes(k.substring(0, k.indexOf("}")))) {
        xml = reemplazarFragmentados(xml, k, v ?? "");
      } else if (/^[$%]/.test(k) && k.length >= 4 && !xml.includes(k)) {
        // Delimitadores $...$ / %...% (CV): reconstruye aunque estén partidos en
        // varios runs. El guard k.length >= 4 evita placeholders muy cortos
        // ($f$, $m$) que podrían generar falsos positivos.
        xml = reemplazarPlaceholderTolerante(xml, k, v ?? "");
      }
    }

    // Agregar fitText a campos que necesitan caber en columnas angostas
    if (fitTextFields && p.includes("document.xml")) {
      let idCounter = 201;
      for (const [placeholder, anchoTwips] of Object.entries(fitTextFields)) {
        const valor = replacements[placeholder];
        if (valor) {
          xml = agregarFitText(xml, valor, anchoTwips, idCounter++);
        }
      }
    }

    zip.file(p, xml);
  }

  return await zip.generateAsync({ type: "nodebuffer" });
}

// ─── helpers compartidos ─────────────────────────────────────────────────────

function datePartsFromInput(d: any): { dd: string; mm: string; yyyy: string } | null {
  if (!d) return null;
  const raw = String(d).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { dd: iso[3], mm: iso[2], yyyy: iso[1] };
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return {
      dd: dmy[1].padStart(2, "0"),
      mm: dmy[2].padStart(2, "0"),
      yyyy: dmy[3],
    };
  }
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getUTCHours() === 0 &&
    dt.getUTCMinutes() === 0 &&
    dt.getUTCSeconds() === 0 &&
    dt.getUTCMilliseconds() === 0
  ) {
    return {
      dd: String(dt.getUTCDate()).padStart(2, "0"),
      mm: String(dt.getUTCMonth() + 1).padStart(2, "0"),
      yyyy: String(dt.getUTCFullYear()),
    };
  }
  return {
    dd: String(dt.getDate()).padStart(2, "0"),
    mm: String(dt.getMonth() + 1).padStart(2, "0"),
    yyyy: String(dt.getFullYear()),
  };
}

function formatDateDMY(d: any): string {
  const parts = datePartsFromInput(d);
  if (!parts) return "";
  const { dd, mm, yyyy } = parts;
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateYear(d: any): string {
  const parts = datePartsFromInput(d);
  return parts?.yyyy ?? "";
}

function calcHasta(leyTxt: string): string {
  const l = String(leyTxt ?? "").toLowerCase();
  const esBecaOResidente =
    l.includes("beca") || l.includes("residente") || l.includes("irab") ||
    l.includes("art. 48") || l.includes("art48") || l.includes("perinatal") ||
    l.includes("vacunacion") || l.includes("contingencia");
  return esBecaOResidente ? `31/12/${new Date().getFullYear()}` : "y continúa";
}

function firstText(...values: any[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

async function queryPersonaldetalle(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.dependencia, pd.ley,
            pd.estado_empleo, pd.fecha_ingreso, pd.decreto_designacion,
            COALESCE(pd.legajo, a.legajo) AS legajo,
            COALESCE(
              (
                SELECT ags.nombre
                FROM agentes_servicios ags
                WHERE ags.dni = pd.dni
                  AND ags.deleted_at IS NULL
                  AND (ags.fecha_hasta IS NULL OR ags.fecha_hasta >= CURDATE())
                  AND ags.nombre IS NOT NULL
                  AND ags.nombre <> ''
                ORDER BY CASE WHEN ags.fecha_hasta IS NULL THEN 0 ELSE 1 END,
                         ags.fecha_desde DESC,
                         ags.id DESC
                LIMIT 1
              ),
              s.nombre
            ) AS servicio
     FROM personaldetalle pd
     LEFT JOIN agentes a ON a.dni = pd.dni AND a.deleted_at IS NULL
     LEFT JOIN agentes_servicios ags_c1 ON ags_c1.id = (SELECT id FROM agentes_servicios WHERE dni = pd.dni AND deleted_at IS NULL AND fecha_hasta IS NULL ORDER BY id DESC LIMIT 1)
     LEFT JOIN servicios s ON s.id = ags_c1.servicio_id AND s.deleted_at IS NULL
     WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] ?? null;
}

async function queryPersonalCertBaseVieja(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.dependencia, pd.ley,
            pd.estado_empleo, pd.fecha_ingreso,
            COALESCE(pd.legajo, a.legajo) AS legajo,
            COALESCE(
              (
                SELECT ags.nombre
                FROM agentes_servicios ags
                WHERE ags.dni = pd.dni
                  AND ags.deleted_at IS NULL
                  AND (ags.fecha_hasta IS NULL OR ags.fecha_hasta >= CURDATE())
                  AND ags.nombre IS NOT NULL
                  AND ags.nombre <> ''
                ORDER BY CASE WHEN ags.fecha_hasta IS NULL THEN 0 ELSE 1 END,
                         ags.fecha_desde DESC,
                         ags.id DESC
                LIMIT 1
              ),
              s.nombre
            ) AS servicio,
            o.nombre AS cargo,
            rh.nombre AS hs_semanales
     FROM personaldetalle pd
     LEFT JOIN agentes a ON a.dni = pd.dni AND a.deleted_at IS NULL
     LEFT JOIN agentes_servicios ags_c2 ON ags_c2.id = (SELECT id FROM agentes_servicios WHERE dni = pd.dni AND deleted_at IS NULL AND fecha_hasta IS NULL ORDER BY id DESC LIMIT 1)
     LEFT JOIN servicios s ON s.id = ags_c2.servicio_id AND s.deleted_at IS NULL
     LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id AND o.deleted_at IS NULL
     LEFT JOIN regimenes_horarios rh ON rh.id = a.regimen_horario_id AND rh.deleted_at IS NULL
     WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] ?? null;
}

async function queryPersonalCertServicios(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.ley,
            p.fecha_nacimiento,
            o.nombre AS ocupacion
     FROM personaldetalle pd
     LEFT JOIN personal p ON p.dni = pd.dni
     LEFT JOIN agentes a ON a.dni = pd.dni AND a.deleted_at IS NULL
     LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id
     WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] ?? null;
}

async function queryPersonalDesignacionBecario(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.ley,
            COALESCE(
              (
                SELECT rep.reparticion_nombre
                FROM agentes_servicios ags
                LEFT JOIN servicios srv ON srv.id = ags.servicio_id AND srv.deleted_at IS NULL
                LEFT JOIN reparticiones rep ON rep.id = srv.reparticion_id
                WHERE ags.dni = pd.dni
                  AND ags.deleted_at IS NULL
                  AND (ags.fecha_hasta IS NULL OR ags.fecha_hasta >= CURDATE())
                ORDER BY CASE WHEN ags.fecha_hasta IS NULL THEN 0 ELSE 1 END,
                         ags.fecha_desde DESC,
                         ags.id DESC
                LIMIT 1
              ),
              (
                SELECT dep.nombre
                FROM agentes_servicios ags
                LEFT JOIN dependencias dep ON dep.id = ags.dependencia_id AND dep.deleted_at IS NULL
                WHERE ags.dni = pd.dni
                  AND ags.deleted_at IS NULL
                  AND (ags.fecha_hasta IS NULL OR ags.fecha_hasta >= CURDATE())
                ORDER BY CASE WHEN ags.fecha_hasta IS NULL THEN 0 ELSE 1 END,
                         ags.fecha_desde DESC,
                         ags.id DESC
                LIMIT 1
              ),
              dep_age.nombre,
              rep_age.reparticion_nombre,
              pd.dependencia
            ) AS dependencia,
            COALESCE(pd.ocupacion, o.nombre) AS ocupacion,
            a.ley_id,
            l.nombre AS ley_agente,
            rh.nombre AS regimen_horario
     FROM personaldetalle pd
     LEFT JOIN agentes a ON a.dni = pd.dni AND a.deleted_at IS NULL
     LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
     LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id AND o.deleted_at IS NULL
     LEFT JOIN regimenes_horarios rh ON rh.id = a.regimen_horario_id AND rh.deleted_at IS NULL
     LEFT JOIN dependencias dep_age ON dep_age.id = a.dependencia_id AND dep_age.deleted_at IS NULL
     LEFT JOIN reparticiones rep_age ON rep_age.id = a.reparticion_id
     WHERE pd.dni = :dni LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT }
  );
  return (rows as any[])[0] ?? null;
}

function esBecarioContingencia(ley: string): boolean {
  return String(ley ?? "").toLowerCase().includes("contingencia");
}

type LeyDesignacion = "10471" | "10430";
type RegimenDesignacion10471 = "planta" | "guardia";

function escapeXml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeLeyDesignacion(value: any): LeyDesignacion {
  const text = String(value ?? "").replace(/\D/g, "");
  return text === "10430" ? "10430" : "10471";
}

function normalizeRegimenDesignacion10471(value: any): RegimenDesignacion10471 {
  return String(value ?? "").toLowerCase().includes("guardia") ? "guardia" : "planta";
}

function inferLeyDesignacion(p: any): LeyDesignacion {
  const leyId = Number(p?.ley_id ?? 0);
  const text = upperEs(`${p?.ley ?? ""} ${p?.ley_agente ?? ""}`);
  if (text.includes("10430") || text.includes("10.430") || [1, 2, 3, 14].includes(leyId)) return "10430";
  if (text.includes("10471") || text.includes("10.471") || [4, 5].includes(leyId)) return "10471";
  return "10471";
}

function buildRegimenDesignacion(ley: LeyDesignacion, regimen10471: RegimenDesignacion10471, conLabor = false): string {
  if (ley === "10430") return conLabor ? "48 horas semanales de labor" : "48 horas semanales";
  return regimen10471 === "guardia" ? "36 horas semanales guardia" : "36 horas semanales planta";
}

function buildTextoDesignacionBecario(params: {
  apellidoNombre: string;
  dni: string;
  cargo: string;
  ley: LeyDesignacion;
  regimen10471: RegimenDesignacion10471;
  dependencia: string;
}) {
  const leyTexto = ` LEY ${params.ley}`;
  const profesional = params.ley === "10471" ? " PROFESIONAL" : "";
  const regimen = buildRegimenDesignacion(params.ley, params.regimen10471);
  return `Mediante la presente solicito en esta instancia se designe al agente ${params.apellidoNombre}, DNI ${params.dni}, sin perjuicio de las condiciones en las que se ha certificado su prestaci\u00f3n como personal becario, para desempe\u00f1ar el cargo de ${params.cargo}${leyTexto}${profesional}, con r\u00e9gimen de ${regimen}.`;
}

function buildTextoElevacionBecario(params: {
  apellidoNombre: string;
  dni: string;
  cargo: string;
  ley: LeyDesignacion;
  regimen10471: RegimenDesignacion10471;
  dependencia: string;
}) {
  const leyTexto = ` LEY ${params.ley}`;
  const regimen = buildRegimenDesignacion(params.ley, params.regimen10471, true);
  return `Por intermedio de la presente solicito la designaci\u00f3n de ${params.apellidoNombre}, DNI ${params.dni}, como ${params.cargo}${leyTexto}, en el r\u00e9gimen horario de ${regimen}, en la dependencia ${params.dependencia}.`;
}

function buildDesignacionBecarioPayload(p: any, input: Record<string, any> = {}, tipo: "designacion" | "elevacion" = "designacion") {
  const ley = normalizeLeyDesignacion(input.ley ?? inferLeyDesignacion(p));
  const regimen10471 = normalizeRegimenDesignacion10471(input.regimen10471);
  const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
  const cargo = firstText(input.cargo, p.ocupacion);
  const dni = String(p.dni ?? input.dni ?? "");
  const dependencia = String(p.dependencia ?? "");
  const textoParams = { apellidoNombre, dni, cargo, ley, regimen10471, dependencia };
  return {
    apellidoNombre,
    dni,
    cargo,
    dependencia,
    ley,
    leySugerida: inferLeyDesignacion(p),
    leyBase: String(p.ley_agente ?? p.ley ?? ""),
    ocupacionSugerida: String(p.ocupacion ?? ""),
    regimen10471,
    regimenTexto: buildRegimenDesignacion(ley, regimen10471, tipo === "elevacion"),
    texto: tipo === "elevacion" ? buildTextoElevacionBecario(textoParams) : buildTextoDesignacionBecario(textoParams),
    lugarFecha: `Gonz\u00e1lez Cat\u00e1n, ${formatDateDMY(new Date())}`,
  };
}

function buildDesignacionBecarioHtml(data: ReturnType<typeof buildDesignacionBecarioPayload>): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
body{font-family:Arial,sans-serif;padding:56px 70px;color:#111;font-size:14px;line-height:1.8;max-width:800px;margin:0 auto}
.fecha{text-align:right;margin-bottom:48px}
p{text-align:justify;margin:0 0 18px 0}
@media print{body{padding:0;margin:2.5cm 3cm;max-width:none}}
</style></head><body>
<div class="fecha">${escapeHtml(data.lugarFecha)}</div>
<p>${escapeHtml(data.texto)}</p>
</body></html>`;
}

async function buildSimpleDocx(paragraphs: Array<{ text: string; align?: "left" | "right" | "both"; bold?: boolean }>): Promise<Buffer> {
  const zip = new JSZip();
  const pXml = paragraphs.map((p) => {
    const jc = p.align ? `<w:jc w:val="${p.align}"/>` : "";
    const bold = p.bold ? "<w:b/>" : "";
    return `<w:p><w:pPr>${jc}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/>${bold}</w:rPr><w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r></w:p>`;
  }).join("");

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${pXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1701" w:bottom="1440" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
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

async function queryPersonalCv(sequelize: Sequelize, dni: number) {
  const rows = await sequelize.query(
    `SELECT pd.dni, pd.apellido, pd.nombre, pd.fecha_nacimiento, pd.sexo,
            pd.telefono, pd.email, pd.domicilio, pd.localidad, pd.cuil,
            pd.nacionalidad, pd.fecha_ingreso, pd.dependencia,
            COALESCE(pd.ocupacion, o.nombre) AS ocupacion,
            p.domicilio AS personal_domicilio, p.numerodomicilio, p.piso, p.depto, p.cp,
            loc.localidad_nombre
     FROM personaldetalle pd
     LEFT JOIN personal p ON p.dni = pd.dni AND p.deleted_at IS NULL
     LEFT JOIN localidades loc ON loc.id = p.localidad_id AND loc.deleted_at IS NULL
     LEFT JOIN agentes a ON a.dni = pd.dni AND a.deleted_at IS NULL
     LEFT JOIN ocupaciones o ON o.id = a.ocupacion_id AND o.deleted_at IS NULL
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

function upperEs(value: any): string {
  return String(value ?? "").trim().toLocaleUpperCase("es-AR");
}

function formatDateParts(d: any): { dd: string; mm: string; yyyy: string } {
  if (!d) return { dd: "", mm: "", yyyy: "" };
  const [dd = "", mm = "", yyyy = ""] = formatDateDMY(d).split("/");
  return { dd, mm, yyyy };
}

function inferEstadoCivilDefault(sexo: any): string {
  return String(sexo ?? "").toUpperCase().includes("FEMENINO") ? "SOLTERA" : "SOLTERO";
}

function inferTerciarioFromOcupacion(ocupacion: any): string {
  const value = upperEs(ocupacion);
  if (!value) return "";
  const keywords = [
    "TECNIC", "ENFERMER", "MEDIC", "BIOQUIM", "FARMAC", "KINESIO",
    "INSTRUMENT", "RADIOLOG", "LABORATOR", "OBSTETR", "PSICOLOG",
    "TRABAJO SOCIAL", "NUTRIC", "FONOAUDIO", "ODONTO",
  ];
  return keywords.some((keyword) => value.includes(keyword)) ? value : "";
}

function buildCvFields(p: any, fields: Record<string, string>, domicilioOverride?: {
  domicilio: string; numeroDom: string; piso: string; depto: string; localidad: string; cp: string;
} | null): Record<string, string> {
  const nac = formatDateParts(p.fecha_nacimiento);
  const ocupacion = upperEs(p.ocupacion);
  const terciario = upperEs(fields?.terciario) || inferTerciarioFromOcupacion(ocupacion);
  const profesion = upperEs(fields?.profesion) || terciario || ocupacion;
  const domicilio = domicilioOverride?.domicilio ?? firstText(p.personal_domicilio, p.domicilio);
  const localidad = domicilioOverride?.localidad ?? firstText(p.localidad_nombre, p.localidad);
  return {
    "$apellido$":      upperEs(p.apellido),
    "$nombres$":       upperEs(p.nombre),
    "$estadocivil$":   upperEs(fields?.estadoCivil) || inferEstadoCivilDefault(p.sexo),
    "$dni$":           String(p.dni ?? ""),
    "$cuil$":          String(p.cuil ?? ""),
    "$f$":             nac.dd,
    "$m$":             nac.mm,
    [`$a\u00f1o%`]:    nac.yyyy,
    "$nacionalidad%":  upperEs(p.nacionalidad) || "ARGENTINA",
    "%dire%":          upperEs(domicilio),
    "%numero%":        domicilioOverride?.numeroDom ?? String(p.numerodomicilio ?? ""),
    "%piso$":          firstText(domicilioOverride?.piso, p.piso, "-"),
    "%dept$":          firstText(domicilioOverride?.depto, p.depto, "-"),
    "%localidad%":     upperEs(localidad),
    "%cp%":            domicilioOverride?.cp ?? String(p.cp ?? ""),
    "%tel%":           String(p.telefono ?? ""),
    "%email%":         String(p.email ?? ""),
    "%secundario%":    upperEs(fields?.secundario) || "BACHILLER",
    "%terciario%":     terciario,
    "%profesion%":     profesion,
    "DEPENDENCIA%":    upperEs(p.dependencia),
    "DEPENDENCIA":     upperEs(p.dependencia),
    "%FECHADEINGRESO%": formatDateDMY(p.fecha_ingreso),
  };
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
    const docxBuffer = await fillDocxTemplate(tpl, replacements, {
      "APELLIDOYNOMBRE": 1471,
      "DEPENDENCIA":     1471,
    });

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
    const out = await fillDocxTemplate(tpl, replacements, {
      "APELLIDOYNOMBRE": 1471,
      "DEPENDENCIA":     1471,
    });

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
    const p = await queryPersonalCertBaseVieja(sequelize, dni);
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
        servicio:    String(p.servicio ?? ""),
        cargo:       String(p.cargo ?? ""),
        hsSemanales: p.hs_semanales != null ? String(p.hs_semanales) : "",
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
      "SERVICIO":       firstText(req.query?.servicio, p.servicio),
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
      "SERVICIO":       firstText(req.body?.servicio, p.servicio),
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

  // ─── Certificación de Servicios (Becarios Vacunación) ────────────────────

  // Nota de designacion para becarios

  router.get("/designacion-becario/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalDesignacionBecario(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    return res.json({ ok: true, data: buildDesignacionBecarioPayload(p) });
  });

  router.get("/designacion-becario/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).send("<p>dni requerido</p>");
    const p = await queryPersonalDesignacionBecario(sequelize, dni);
    if (!p) return res.status(404).send("<p>Persona no encontrada</p>");
    const data = buildDesignacionBecarioPayload(p, {
      cargo: req.query?.cargo,
      ley: req.query?.ley,
      regimen10471: req.query?.regimen10471,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(buildDesignacionBecarioHtml(data));
  });

  router.post("/designacion-becario", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalDesignacionBecario(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const data = buildDesignacionBecarioPayload(p, {
      cargo: req.body?.cargo,
      ley: req.body?.ley,
      regimen10471: req.body?.regimen10471,
    });
    const out = await buildSimpleDocx([
      { text: data.lugarFecha, align: "right" },
      { text: "" },
      { text: data.texto, align: "both" },
    ]);
    const safeApellido = String(p.apellido ?? "").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="designacion_becario_${safeApellido}_${data.dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  // Nota de elevacion para becarios

  router.get("/elevacion-becario/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalDesignacionBecario(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    return res.json({ ok: true, data: buildDesignacionBecarioPayload(p, {}, "elevacion") });
  });

  router.get("/elevacion-becario/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).send("<p>dni requerido</p>");
    const p = await queryPersonalDesignacionBecario(sequelize, dni);
    if (!p) return res.status(404).send("<p>Persona no encontrada</p>");
    const data = buildDesignacionBecarioPayload(p, {
      cargo: req.query?.cargo,
      ley: req.query?.ley,
      regimen10471: req.query?.regimen10471,
    }, "elevacion");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(buildDesignacionBecarioHtml(data));
  });

  router.post("/elevacion-becario", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalDesignacionBecario(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const data = buildDesignacionBecarioPayload(p, {
      cargo: req.body?.cargo,
      ley: req.body?.ley,
      regimen10471: req.body?.regimen10471,
    }, "elevacion");
    const out = await buildSimpleDocx([
      { text: data.lugarFecha, align: "right" },
      { text: "" },
      { text: data.texto, align: "both" },
    ]);
    const safeApellido = String(p.apellido ?? "").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="elevacion_becario_${safeApellido}_${data.dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  router.get("/cert-servicios/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalCertServicios(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    if (!esBecarioContingencia(p.ley))
      return res.status(403).json({ ok: false, error: "solo_becarios" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const clase = formatDateYear(p.fecha_nacimiento);
    return res.json({
      ok: true,
      data: {
        apellidoNombre,
        dni: String(p.dni ?? dni),
        clase,
        ocupacion: String(p.ocupacion ?? ""),
      },
    });
  });

  router.get("/cert-servicios/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalCertServicios(sequelize, dni);
    if (!p) return res.status(404).send("<p>Persona no encontrada</p>");
    if (!esBecarioContingencia(p.ley)) return res.status(403).send("<p>Solo para becarios de vacunación</p>");
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const clase = formatDateYear(p.fecha_nacimiento);
    const ocupacion = String(req.query?.ocupacion ?? p.ocupacion ?? "");
    const replacements: Record<string, string> = {
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":       String(p.dni ?? dni),
      "CLASEAGENTE":     clase,
      "PROFESIONAGENTE": ocupacion,
    };
    const templatePath = resolveTemplatePath("certServicios.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).send("<p>Plantilla certServicios.docx no encontrada</p>");
    const tpl = fs.readFileSync(templatePath);
    const docxBuffer = await fillDocxTemplate(tpl, replacements);
    const mammoth = await import("mammoth");
    const result  = await mammoth.convertToHtml({ buffer: docxBuffer });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Arial,sans-serif;padding:40px 56px;color:#111;font-size:13px;line-height:1.8;max-width:800px;margin:0 auto}
p{margin:0 0 10px 0}</style></head><body>${result.value}</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  router.post("/cert-servicios", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalCertServicios(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    if (!esBecarioContingencia(p.ley)) return res.status(403).json({ ok: false, error: "solo_becarios" });
    const apellidoNombre = `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim();
    const clase = formatDateYear(p.fecha_nacimiento);
    const ocupacion = String(req.body?.ocupacion ?? p.ocupacion ?? "");
    const replacements: Record<string, string> = {
      "APELLIDOYNOMBRE": apellidoNombre,
      "DNIAGENTE":       String(p.dni ?? dni),
      "CLASEAGENTE":     clase,
      "PROFESIONAGENTE": ocupacion,
    };
    const templatePath = resolveTemplatePath("certServicios.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: "Plantilla certServicios.docx no encontrada" });
    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);
    const safeApellido = String(p.apellido ?? "").replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="nota_certificacion_${safeApellido}_${p.dni}.docx"`);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  // Curriculum Vitae

  router.get("/cv/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalCv(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const excelDir = await readDireccionFromExcel(String(p.dependencia ?? ""), dni);
    const defaults = buildCvFields(p, {}, excelDir);
    return res.json({
      ok: true,
      data: {
        apellidoNombre: `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim(),
        dni: String(p.dni ?? dni),
        ocupacion: upperEs(p.ocupacion),
        dependencia: upperEs(p.dependencia),
        estadoCivil: defaults["$estadocivil$"],
        secundario: defaults["%secundario%"],
        terciario: defaults["%terciario%"],
        profesion: defaults["%profesion%"],
        fechaIngreso: defaults["%FECHADEINGRESO%"],
        domicilio: defaults["%dire%"],
        numeroDom: defaults["%numero%"],
        piso: defaults["%piso$"],
        depto: defaults["%dept$"],
        localidad: defaults["%localidad%"],
        cp: defaults["%cp%"],
      },
    });
  });

  router.get("/cv/preview", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).send("<p>dni requerido</p>");
    const p = await queryPersonalCv(sequelize, dni);
    if (!p) return res.status(404).send("<p>Persona no encontrada</p>");
    const excelDir = await readDireccionFromExcel(String(p.dependencia ?? ""), dni);
    const replacements = buildCvFields(p, req.query as Record<string, string>, excelDir);
    const templatePath = resolveTemplatePath("CURRICULUM VITAE1.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).send("<p>Plantilla CURRICULUM VITAE1.docx no encontrada</p>");
    const tpl = fs.readFileSync(templatePath);
    const docxBuffer = await fillDocxTemplate(tpl, replacements);
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ buffer: docxBuffer });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Arial,sans-serif;padding:0 56px 24px 40px;color:#111;font-size:13px;line-height:1.45;max-width:800px;margin:0 auto}
p{margin:0 0 10px 0}</style></head><body>${result.value}</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  router.post("/cv", async (req: Request, res: Response) => {
    const dni = Number(req.body?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const p = await queryPersonalCv(sequelize, dni);
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    const excelDir = await readDireccionFromExcel(String(p.dependencia ?? ""), dni);
    const replacements = buildCvFields(p, req.body ?? {}, excelDir);
    const templatePath = resolveTemplatePath("CURRICULUM VITAE1.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: "Plantilla CURRICULUM VITAE1.docx no encontrada" });
    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);
    const safeApellido = String(p.apellido ?? "").replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    const filename = `cv_${safeApellido || dni}_${dni}.docx`;
    const dniDir = resolveCvDniDir(dni);
    const docxPath = path.join(dniDir, filename);
    fs.writeFileSync(docxPath, out);
    const jpgName = `cv_${safeApellido || dni}_${dni}.jpg`;
    const jpgPath = path.join(dniDir, jpgName);
    await generateCvJpg(docxPath, jpgPath);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Saved-Path", docxPath);
    res.setHeader("X-Saved-Jpg-Path", jpgPath);
    res.setHeader("Content-Length", String(out.length));
    return res.status(200).send(out);
  });

  // ─── Jubilación ──────────────────────────────────────────────────────────

  router.get("/jubilacion/datos", async (req: Request, res: Response) => {
    const dni = Number(req.query?.dni);
    if (!dni || Number.isNaN(dni)) return res.status(400).json({ ok: false, error: "dni requerido" });
    const rows = await sequelize.query(
      `SELECT pd.dni, pd.apellido, pd.nombre,
              COALESCE(
                rep_srv.reparticion_nombre,
                dep_srv.nombre,
                dep_age.nombre,
                rep_age.reparticion_nombre,
                pd.dependencia
              ) AS dependencia,
              pd.ley, pd.ley_id, pd.estado_empleo, pd.sexo,
              COALESCE(pd.legajo, a.legajo) AS legajo
       FROM personaldetalle pd
       LEFT JOIN agentes a ON a.dni = pd.dni AND a.deleted_at IS NULL
       /* dependencia via agentes_servicios activo */
       LEFT JOIN (
         SELECT dni, servicio_id, dependencia_id
         FROM agentes_servicios
         WHERE deleted_at IS NULL
           AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
         ORDER BY id DESC
         LIMIT 1
       ) ags_act ON ags_act.dni = pd.dni
       LEFT JOIN servicios srv       ON srv.id  = ags_act.servicio_id   AND srv.deleted_at IS NULL
       LEFT JOIN reparticiones rep_srv ON rep_srv.id = srv.reparticion_id
       LEFT JOIN dependencias  dep_srv ON dep_srv.id = ags_act.dependencia_id AND dep_srv.deleted_at IS NULL
       /* fallback: dependencia/reparticion directa del agente */
       LEFT JOIN dependencias  dep_age ON dep_age.id = a.dependencia_id  AND dep_age.deleted_at IS NULL
       LEFT JOIN reparticiones rep_age ON rep_age.id = a.reparticion_id
       WHERE pd.dni = :dni LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT }
    );
    const p = (rows as any[])[0];
    if (!p) return res.status(404).json({ ok: false, error: "Persona no encontrada" });
    return res.json({
      ok: true,
      data: {
        apellidoNombre: `${p.apellido ?? ""} ${p.nombre ?? ""}`.trim(),
        dni:         String(p.dni ?? dni),
        legajo:      String(p.legajo ?? ""),
        dependencia: String(p.dependencia ?? ""),
        sexo:        String(p.sexo ?? "FEMENINO"),
        ley_id:      Number(p.ley_id ?? 0),
        estado_empleo: String(p.estado_empleo ?? ""),
      },
    });
  });

  // ─── Disposición de Rectificación ────────────────────────────────────────

  router.get("/disp-rectificacion/preview", async (req: Request, res: Response) => {
    const { expNro = "", tramite = "", agentes = "", ifgra1 = "", orden1 = "", motivo1 = "", ifgra2 = "", orden2 = "", motivo2 = "" } = req.query as Record<string, string>;
    const replacements: Record<string, string> = {
      "EXPNRO":  expNro,
      "TRAMITE": tramite,
      "AGENTES": agentes,
      "IFGRA1":  ifgra1,
      "ORDEN1":  orden1,
      "MOTIVO1": motivo1,
      "IFGRA2":  ifgra2,
      "ORDEN2":  orden2,
      "MOTIVO2": motivo2,
    };
    const templatePath = resolveTemplatePath("dispRectificacion.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).send("<p>Plantilla dispRectificacion.docx no encontrada</p>");
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

  router.post("/disp-rectificacion", async (req: Request, res: Response) => {
    const { expNro = "", tramite = "", agentes = "", ifgra1 = "", orden1 = "", motivo1 = "", ifgra2 = "", orden2 = "", motivo2 = "" } = req.body ?? {};
    const replacements: Record<string, string> = {
      "EXPNRO":  expNro,
      "TRAMITE": tramite,
      "AGENTES": agentes,
      "IFGRA1":  ifgra1,
      "ORDEN1":  orden1,
      "MOTIVO1": motivo1,
      "IFGRA2":  ifgra2,
      "ORDEN2":  orden2,
      "MOTIVO2": motivo2,
    };
    const templatePath = resolveTemplatePath("dispRectificacion.docx");
    if (!fs.existsSync(templatePath)) return res.status(500).json({ ok: false, error: "Plantilla dispRectificacion.docx no encontrada" });
    const tpl = fs.readFileSync(templatePath);
    const out = await fillDocxTemplate(tpl, replacements);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="disp_rectificacion.docx"`);
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
