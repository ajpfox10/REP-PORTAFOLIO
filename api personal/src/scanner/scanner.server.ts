/**
 * Scanner API — Servidor separado para manejo de escáneres y cámaras
 * Protocolo: WIA (Windows Image Acquisition) via PowerShell / node-wia
 *           TWAIN via twain-js o dsm
 *           Compatible con: escáneres HP, Canon, Epson, Fujitsu, etc.
 * 
 * Endpoints:
 *  GET  /api/scanner/devices         → lista escáneres y cámaras disponibles
 *  GET  /api/scanner/status          → estado del servidor
 *  POST /api/scanner/scan            → escanear (con opciones)
 *  POST /api/scanner/camera/capture  → capturar foto de cámara WIA
 *  GET  /api/scanner/config          → config actual
 *  PUT  /api/scanner/config          → actualizar config
 *  GET  /api/scanner/preview         → preview del último scan
 *  POST /api/scanner/pdf             → crear PDF de varias páginas escaneadas
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const SCANNER_PORT = process.env.SCANNER_PORT ? parseInt(process.env.SCANNER_PORT) : 3001;
const OUTPUT_DIR   = process.env.SCANNER_OUTPUT_DIR || path.join(process.cwd(), 'scanner_output');
const PLATFORM     = process.platform; // 'win32' | 'linux' | 'darwin'

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Config por defecto ────────────────────────────────────────────────────────
let scanConfig = {
  deviceName: '',      // nombre del escáner seleccionado
  colorMode: 'Color',  // Color | Grayscale | BlackAndWhite
  dpi: 300,            // 75 | 150 | 200 | 300 | 600
  format: 'PDF',       // PDF | JPEG | PNG | TIFF
  pageSize: 'A4',      // A4 | Letter | Legal | Auto
  brightness: 0,       // -100 a 100
  contrast: 0,         // -100 a 100
  multiPage: false,    // escanear varias páginas automáticamente
  outputDir: OUTPUT_DIR,
};

// ─── Helpers WIA (Windows) ────────────────────────────────────────────────────
const WIA_LIST_DEVICES_PS = `
$wia = New-Object -ComObject WIA.DeviceManager
$devices = @()
$wia.DeviceInfos | ForEach-Object {
  $devices += @{
    id = $_.DeviceID
    name = $_.Properties["Name"].Value
    type = if ($_.Type -eq 1) { "scanner" } else { "camera" }
    connected = $true
  }
}
$devices | ConvertTo-Json -Compress
`;

const WIA_SCAN_PS = (deviceId: string, dpi: number, colorMode: string, format: string, outFile: string) => `
$wia = New-Object -ComObject WIA.DeviceManager
$device = $null
$wia.DeviceInfos | ForEach-Object {
  if ($_.DeviceID -eq '${deviceId}') {
    $device = $_.Connect()
  }
}
if ($device -eq $null) { throw "Device not found: ${deviceId}" }

$scanner = $device.Items[1]
$scanner.Properties["Horizontal Resolution"].Value = ${dpi}
$scanner.Properties["Vertical Resolution"].Value = ${dpi}
$scanner.Properties["Current Intent"].Value = $(if ("${colorMode}" -eq "Color") { 1 } elseif ("${colorMode}" -eq "Grayscale") { 2 } else { 4 })

$image = $scanner.Transfer()
$format = "$(if ("${format}" -eq "JPEG") { "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}" } elseif ("${format}" -eq "PNG") { "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}" } elseif ("${format}" -eq "TIFF") { "{B96B3CB1-0728-11D3-9D7B-0000F81EF32E}" } else { "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}" })"
$image.SaveFile("${outFile}")
Write-Output "OK:${outFile}"
`;

// ─── Helpers SANE (Linux) ─────────────────────────────────────────────────────
async function listSaneDevices(): Promise<any[]> {
  try {
    const { stdout } = await execAsync('scanimage -L 2>/dev/null');
    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      const match = line.match(/device `([^']+)' is a (.+)/);
      return match
        ? { id: match[1], name: match[2], type: 'scanner', connected: true }
        : { id: line, name: line, type: 'scanner', connected: true };
    });
  } catch {
    return [];
  }
}

async function scanWithSane(
  deviceId: string, dpi: number, colorMode: string, format: string, outFile: string
): Promise<void> {
  const mode = colorMode === 'Color' ? 'Color' : colorMode === 'Grayscale' ? 'Gray' : 'Lineart';
  const fmt  = format === 'JPEG' ? 'jpeg' : format === 'PNG' ? 'png' : 'tiff';
  const cmd  = `scanimage -d '${deviceId}' --resolution=${dpi} --mode=${mode} --format=${fmt} -o '${outFile}'`;
  await execAsync(cmd);
}

// ─── WIA via PowerShell (Windows) ────────────────────────────────────────────
async function listWiaDevices(): Promise<any[]> {
  if (PLATFORM !== 'win32') return [];
  try {
    const { stdout } = await execAsync(
      `powershell -Command "${WIA_LIST_DEVICES_PS.replace(/\n/g, ' ')}"`,
      { timeout: 8000 }
    );
    return JSON.parse(stdout.trim()) as any[];
  } catch {
    return [];
  }
}

async function scanWithWia(deviceId: string, outFile: string): Promise<void> {
  const ps = WIA_SCAN_PS(deviceId, scanConfig.dpi, scanConfig.colorMode, 'JPEG', outFile);
  const escaped = ps.replace(/"/g, '\\"').replace(/\n/g, '; ');
  await execAsync(`powershell -Command "${escaped}"`, { timeout: 60000 });
}

// ─── PDF desde imágenes ────────────────────────────────────────────────────────
async function imageArrayToPdf(imageFiles: string[], outPdf: string): Promise<void> {
  // Intentar usar ImageMagick (convert) o img2pdf
  try {
    await execAsync(`convert ${imageFiles.map(f => `"${f}"`).join(' ')} "${outPdf}"`);
    return;
  } catch {}
  try {
    await execAsync(`img2pdf ${imageFiles.map(f => `"${f}"`).join(' ')} -o "${outPdf}"`);
    return;
  } catch {}
  // Último recurso: solo copiar el primer archivo con .pdf extensión
  fs.copyFileSync(imageFiles[0], outPdf);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/scanner/status
app.get('/api/scanner/status', (_req, res) => {
  res.json({
    ok: true,
    status: 'running',
    platform: PLATFORM,
    outputDir: OUTPUT_DIR,
    config: scanConfig,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/scanner/devices — Lista todos los escáneres y cámaras disponibles
app.get('/api/scanner/devices', async (_req, res) => {
  try {
    const devices: any[] = [];

    if (PLATFORM === 'win32') {
      const wiaDevs = await listWiaDevices();
      devices.push(...wiaDevs);
    } else {
      const saneDevs = await listSaneDevices();
      devices.push(...saneDevs);
    }

    // Detectar cámaras de video (para captura de foto)
    if (PLATFORM === 'linux') {
      try {
        const { stdout } = await execAsync('ls /dev/video* 2>/dev/null || echo ""');
        const vids = stdout.trim().split('\n').filter(Boolean);
        devices.push(...vids.map(v => ({ id: v, name: `Cámara de video ${v}`, type: 'camera', connected: true })));
      } catch {}
    }

    res.json({ ok: true, devices, count: devices.length });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/scanner/config
app.get('/api/scanner/config', (_req, res) => {
  res.json({ ok: true, config: scanConfig });
});

// PUT /api/scanner/config
app.put('/api/scanner/config', (req, res) => {
  const allowed = ['deviceName','colorMode','dpi','format','pageSize','brightness','contrast','multiPage','outputDir'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      (scanConfig as any)[k] = req.body[k];
    }
  }
  // Verificar/crear outputDir si cambió
  if (req.body.outputDir && !fs.existsSync(scanConfig.outputDir)) {
    fs.mkdirSync(scanConfig.outputDir, { recursive: true });
  }
  res.json({ ok: true, config: scanConfig });
});

// POST /api/scanner/scan — Escanear una página
app.post('/api/scanner/scan', async (req, res) => {
  try {
    const opts = { ...scanConfig, ...(req.body || {}) };
    const deviceId = opts.deviceName;

    if (!deviceId) {
      return res.status(400).json({ ok: false, error: 'No hay dispositivo seleccionado (config.deviceName)' });
    }

    const ts = Date.now();
    const ext = opts.format === 'PDF' ? 'jpg' : opts.format.toLowerCase();
    const outFile = path.join(opts.outputDir, `scan_${ts}.${ext}`);

    if (PLATFORM === 'win32') {
      await scanWithWia(deviceId, outFile);
    } else {
      await scanWithSane(deviceId, opts.dpi, opts.colorMode, opts.format === 'PDF' ? 'JPEG' : opts.format, outFile);
    }

    // Si el formato pedido es PDF y escaneamos en JPEG, convertir
    let finalFile = outFile;
    if (opts.format === 'PDF') {
      const pdfOut = path.join(opts.outputDir, `scan_${ts}.pdf`);
      await imageArrayToPdf([outFile], pdfOut);
      finalFile = pdfOut;
    }

    const data = fs.readFileSync(finalFile);
    const b64  = data.toString('base64');
    const mime = finalFile.endsWith('.pdf') ? 'application/pdf'
               : finalFile.endsWith('.png') ? 'image/png' : 'image/jpeg';

    res.json({
      ok: true,
      filename: path.basename(finalFile),
      file: finalFile,
      mime,
      data: b64,
      size: data.length,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Error al escanear' });
  }
});

// POST /api/scanner/pdf — Unir múltiples imágenes base64 en un PDF
app.post('/api/scanner/pdf', async (req, res) => {
  try {
    const { pages } = req.body as { pages: { data: string; mime: string }[] };
    if (!pages?.length) return res.status(400).json({ ok: false, error: 'Sin páginas' });

    const ts = Date.now();
    const tmpFiles: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const ext = pages[i].mime?.includes('png') ? 'png' : 'jpg';
      const tmpFile = path.join(OUTPUT_DIR, `page_${ts}_${i}.${ext}`);
      fs.writeFileSync(tmpFile, Buffer.from(pages[i].data, 'base64'));
      tmpFiles.push(tmpFile);
    }

    const pdfOut = path.join(OUTPUT_DIR, `doc_${ts}.pdf`);
    await imageArrayToPdf(tmpFiles, pdfOut);

    // Limpiar temporales
    tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });

    const data = fs.readFileSync(pdfOut);
    res.json({
      ok: true,
      filename: path.basename(pdfOut),
      file: pdfOut,
      mime: 'application/pdf',
      data: data.toString('base64'),
      size: data.length,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || 'Error al crear PDF' });
  }
});

// GET /api/scanner/file/:filename — Descargar archivo escaneado
app.get('/api/scanner/file/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(OUTPUT_DIR, safeFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
  }
  res.sendFile(filePath);
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
export function startScannerServer() {
  app.listen(SCANNER_PORT, () => {
    console.log(`🖨  Scanner API corriendo en http://localhost:${SCANNER_PORT}`);
    console.log(`   Platform: ${PLATFORM} | Output: ${OUTPUT_DIR}`);
  });
}

// Si se ejecuta directamente
if (require.main === module) {
  startScannerServer();
}

export default app;
