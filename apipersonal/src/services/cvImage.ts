// src/services/cvImage.ts
// Genera un JPG fiel de un CV (.docx) usando Word headless (COM vía PowerShell)
// para exportar a PDF/A (fuentes embebidas) y luego rasterizando con pdfjs.
// Pensado para correr en segundo plano: serializado (un Word a la vez) y
// best-effort (si falla, loguea y no rompe la generación del .docx).
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { logger } from "../logging/logger";

// pdfjs-dist 4.x es ESM-only. Este truco preserva un import() real aunque TS
// compile a CommonJS (evita que lo degrade a require(), que rompe con ESM).
const dynamicImport: (s: string) => Promise<any> = new Function("s", "return import(s)") as any;

// Cola: garantiza un solo Word a la vez dentro de este proceso.
let cola: Promise<unknown> = Promise.resolve();

// Script PowerShell (String.raw: backslashes y $ quedan literales).
const PS_SCRIPT = String.raw`
param([string]$In,[string]$Out)
$ErrorActionPreference='Stop'
# Workaround session-0: Word 32-bit bajo servicio necesita estas carpetas Desktop
foreach($d in @("$env:windir\SysWOW64\config\systemprofile\Desktop","$env:windir\System32\config\systemprofile\Desktop")){
  try { if(-not (Test-Path $d)){ New-Item -ItemType Directory -Path $d -Force | Out-Null } } catch {}
}
$word=$null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible=$false; $word.DisplayAlerts=0
  Start-Sleep -Milliseconds 1500
  $doc=$null
  for($i=0;$i -lt 20;$i++){ try { $doc=$word.Documents.Open($In,$false,$true); break } catch { if($_.Exception.Message -match '0x80010001|0x8001010A|rechaz|busy'){ Start-Sleep -Milliseconds 900 } else { throw } } }
  if(-not $doc){ throw "Documents.Open rechazado de forma persistente" }
  # ExportAsFixedFormat: 17=PDF, ultimo arg UseISO19005_1=$true => PDF/A (embebe fuentes)
  for($i=0;$i -lt 20;$i++){ try { $doc.ExportAsFixedFormat($Out,17,$false,0,0,0,0,0,$true,$true,0,$true,$true,$true); break } catch { if($_.Exception.Message -match '0x80010001|0x8001010A|rechaz|busy'){ Start-Sleep -Milliseconds 900 } else { throw } } }
  $doc.Close($false)
  exit 0
} catch { Write-Error $_.Exception.Message; exit 1 }
finally { if($word){ try { $word.Quit() } catch {} }; Get-Process WINWORD -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue }
`;

function docxToPdfA(docxPath: string, pdfPath: string, timeoutMs = 90000): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(os.tmpdir(), `cvword_${process.pid}_${Date.now()}.ps1`);
    fs.writeFileSync(scriptPath, PS_SCRIPT, "utf8");
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-In", docxPath, "-Out", pdfPath],
      { windowsHide: true }
    );
    let stderr = "";
    ps.stderr.on("data", (d) => (stderr += d.toString()));
    const killer = setTimeout(() => {
      try { ps.kill("SIGKILL"); } catch {}
      try { spawn("taskkill", ["/F", "/IM", "WINWORD.EXE"], { windowsHide: true }); } catch {}
      cleanup();
      reject(new Error("timeout Word->PDF"));
    }, timeoutMs);
    const cleanup = () => { try { fs.unlinkSync(scriptPath); } catch {} };
    ps.on("close", (code) => {
      clearTimeout(killer);
      cleanup();
      if (code === 0 && fs.existsSync(pdfPath)) resolve();
      else reject(new Error(`Word->PDF exit=${code} ${stderr.trim()}`.trim()));
    });
    ps.on("error", (err) => { clearTimeout(killer); cleanup(); reject(err); });
  });
}

async function pdfToJpg(pdfPath: string, jpgPath: string, scale = 3): Promise<void> {
  const { createCanvas, DOMMatrix, Path2D, ImageData } = require("@napi-rs/canvas");
  (globalThis as any).DOMMatrix = (globalThis as any).DOMMatrix ?? DOMMatrix;
  (globalThis as any).Path2D = (globalThis as any).Path2D ?? Path2D;
  (globalThis as any).ImageData = (globalThis as any).ImageData ?? ImageData;

  // Ruta directa al build legacy (cwd = raíz de la app en dev y prod): así no
  // dependemos del mapa "exports" de pdfjs, que no expone el .mjs bajo require.
  const pdfjsFile = path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs");
  const pdfUrl = require("url").pathToFileURL(pdfjsFile).href;
  const pdfjs = await dynamicImport(pdfUrl);

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const jpg = await canvas.encode("jpeg", 92);
  fs.writeFileSync(jpgPath, jpg);
}

/** docx -> PDF/A (Word) -> JPG. Lanza si falla. */
export async function generateCvJpg(docxPath: string, jpgPath: string): Promise<void> {
  const pdfPath = path.join(os.tmpdir(), `cv_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await docxToPdfA(docxPath, pdfPath);
    await pdfToJpg(pdfPath, jpgPath);
  } finally {
    try { fs.unlinkSync(pdfPath); } catch {}
  }
}

/**
 * Fire-and-forget serializado: encola la generación del JPG sin bloquear la
 * respuesta. Nunca lanza — loguea éxito o error.
 */
export function generateCvJpgBackground(docxPath: string, jpgPath: string, dni: number | string): void {
  cola = cola
    .then(() => generateCvJpg(docxPath, jpgPath))
    .then(() => logger.info({ msg: "CV JPG generado", dni, jpgPath }))
    .catch((e) => logger.error({ msg: "CV JPG fallo", dni, error: e?.message || String(e) }));
}
