/**
 * Scanner Agent v4 — MULTI-DEVICE con eSCL/AirScan
 *
 * Protocolo de escaneo (por prioridad):
 *   1. Windows → WIA via PowerShell (local Y red, via WSD)
 *   2. eSCL/AirScan → estándar moderno soportado por Kyocera, Olivetti, HP, Canon, Ricoh, Brother
 *   3. IPP con probe de paths → fallback legacy
 */
import "dotenv/config";
import os from "os";
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { exec } from "child_process";
import { promisify } from "util";
import FormData from "form-data";
import axios from "axios";
const execAsync = promisify(exec);
const _execAsync = execAsync;
const API = (process.env.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const TENANT = process.env.AGENT_TENANT_ID || "1";
const EMAIL = process.env.AGENT_EMAIL || "admin@local.com";
const PASSWORD = process.env.AGENT_PASSWORD || "Admin12345@";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 4000);
const BEAT_MS = Number(process.env.HEARTBEAT_MS || 30000);
const HOSTNAME = os.hostname();
// ── Auth JWT ──────────────────────────────────────────────────────────────────
let jwt_token = "";
let token_expires = 0;
async function login() {
    try {
        const res = await axios.post(`${API}/v1/auth/login`, {
            email: EMAIL, password: PASSWORD, tenant_id: Number(TENANT),
        }, { headers: { "x-tenant": TENANT, "content-type": "application/json" }, timeout: 10_000 });
        jwt_token = res.data?.access_token || res.data?.token || "";
        token_expires = Date.now() + 7 * 60 * 60 * 1000;
        if (jwt_token)
            console.log("[agent] ✅ login OK");
        else
            console.error("[agent] ❌ login returned no token:", JSON.stringify(res.data));
    }
    catch (e) {
        console.error("[agent] ❌ login failed:", e?.response?.data || e?.message);
    }
}
async function ensureToken() {
    if (!jwt_token || Date.now() > token_expires)
        await login();
}
const http_client = axios.create({ baseURL: `${API}/v1`, timeout: 30_000 });
http_client.interceptors.request.use((cfg) => {
    cfg.headers.set("x-tenant", TENANT);
    cfg.headers.set("content-type", "application/json");
    if (jwt_token)
        cfg.headers.set("Authorization", `Bearer ${jwt_token}`);
    return cfg;
});
function makeDeviceClient(deviceKey) {
    const c = axios.create({ baseURL: `${API}/v1`, timeout: 30_000 });
    c.interceptors.request.use((cfg) => {
        cfg.headers.set("x-tenant", TENANT);
        cfg.headers.set("x-device-key", deviceKey);
        cfg.headers.set("x-agent-version", "4.0.0");
        cfg.headers.set("content-type", "application/json");
        return cfg;
    });
    return c;
}
// ── Devices ───────────────────────────────────────────────────────────────────
async function getDevices() {
    try {
        await ensureToken();
        const res = await http_client.get("/devices?limit=100");
        return (res.data.items || []).filter(d => d.is_active && d.hostname);
    }
    catch (e) {
        if (e?.response?.status === 401) {
            jwt_token = "";
            console.warn("[agent] getDevices 401 — will re-login");
        }
        else
            console.warn("[agent] getDevices error:", e?.message);
        return [];
    }
}
// ══════════════════════════════════════════════════════════════════════════════
// MOTOR DE ESCANEO
// Prioridad: WIA (Windows) → eSCL/AirScan → IPP con probe
// ══════════════════════════════════════════════════════════════════════════════
async function scanDevice(ip, profile) {
    const dpi = profile?.dpi ?? 300;
    const color = profile?.color !== false;
    const source = profile?.source ?? "flatbed";
    const duplex = !!profile?.duplex;
    const escl_port = profile?.escl_port ?? null; // puerto real del mDNS SRV record
    // 1. Windows → WIA (más confiable para Kyocera/Olivetti via WSD)
    if (process.platform === "win32") {
        try {
            const pages = await scanWIA(ip, { dpi, color, source, duplex });
            console.log(`[wia] ✅ ${ip} → ${pages.length} pág.`);
            return pages;
        }
        catch (e) {
            console.warn(`[wia] ${ip} falló: ${e.message} — probando eSCL…`);
        }
    }
    // 2. eSCL / AirScan (estándar moderno, HP/Canon/Ricoh/Brother)
    try {
        const pages = await scanESCL(ip, { dpi, color, source, duplex, escl_port });
        console.log(`[escl] ✅ ${ip} → ${pages.length} pág.`);
        return pages;
    }
    catch (e) {
        console.warn(`[escl] ${ip} falló: ${e.message} — probando WSD-Scan…`);
    }
    // 3. WS-Scan / WSD-Scan via puerto 5357 (Kyocera, Olivetti, Canon)
    try {
        const pages = await scanWSDScan(ip, { dpi, color, source, duplex });
        console.log(`[wsd-scan] ✅ ${ip} → ${pages.length} pág.`);
        return pages;
    }
    catch (e) {
        console.warn(`[wsd-scan] ${ip} falló: ${e.message} — probando IPP…`);
    }
    // 4. IPP con probe de paths (fallback legacy)
    return await scanIPP(ip, { dpi, color, source });
}
// ── 1. WIA via PowerShell (Windows) ─────────────────────────────────────────
// Funciona para escáneres locales Y de red (via WSD/WIA)
async function scanWIA(ip, opts) {
    const tmpDir = path.join(os.tmpdir(), `scan_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const isLocal = !ip || ip === "127.0.0.1" || ip === HOSTNAME;
    // PowerShell: busca el escáner WIA por IP/hostname, luego escanea
    const ps = `
$ErrorActionPreference = 'Stop'
$outDir = "${tmpDir.replace(/\\/g, "\\\\")}"

try {
  $wia = New-Object -ComObject WIA.DeviceManager
  $scanner = $null

  # Intentar encontrar por Network Address exacta
  foreach ($dev in $wia.DeviceInfos) {
    if ($dev.Type -ne 1) { continue }  # 1 = scanner
    try {
      $netAddr = $dev.Properties.Item("Network Address").Value
      if ($netAddr -eq "${ip}") {
        $scanner = $dev.Connect()
        Write-Host "[wia] Encontrado por Network Address: $netAddr"
        break
      }
    } catch {}
  }

  # Fallback: buscar por nombre que contenga la IP
  if ($null -eq $scanner) {
    foreach ($dev in $wia.DeviceInfos) {
      if ($dev.Type -ne 1) { continue }
      try {
        $name = $dev.Properties.Item("Name").Value
        if ($name -match [regex]::Escape("${ip}")) {
          $scanner = $dev.Connect()
          Write-Host "[wia] Encontrado por nombre: $name"
          break
        }
      } catch {}
    }
  }

  ${isLocal ? `
  # Para dispositivo local: usar el primero disponible
  if ($null -eq $scanner -and $wia.DeviceInfos.Count -gt 0) {
    foreach ($dev in $wia.DeviceInfos) {
      if ($dev.Type -ne 1) { continue }
      $scanner = $dev.Connect()
      $name = try { $dev.Properties.Item("Name").Value } catch { "?" }
      Write-Host "[wia] Usando primer escáner local disponible: $name"
      break
    }
  }` : `
  if ($null -eq $scanner) {
    throw "No se encontró escáner con IP ${ip} en WIA"
  }`}

  if ($null -eq $scanner) { throw "Sin escáneres disponibles en WIA" }

  $item = $scanner.Items(1)

  # Configurar resolución
  try { $item.Properties("Horizontal Resolution").Value = ${opts.dpi} } catch {}
  try { $item.Properties("Vertical Resolution").Value   = ${opts.dpi} } catch {}

  # Configurar color: 4=color, 2=gris, 1=b&w
  try { $item.Properties("Current Intent").Value = ${opts.color ? 4 : 2} } catch {}

  # Configurar fuente si ADF
  ${opts.source === "adf" || opts.source === "adf_duplex" ? `
  try { $item.Properties("Document Feeder").Value = 1 } catch {}
  ` : ``}

  # Escanear — formato BMP para mejor compatibilidad
  $img = $item.Transfer("{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}")
  $outFile = Join-Path $outDir "page001.jpg"
  $img.SaveFile($outFile)
  Write-Host "SAVED:$outFile"

} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim();
    const psFile = path.join(tmpDir, "wia_scan.ps1");
    fs.writeFileSync(psFile, ps, "utf8");
    try {
        const { stdout, stderr } = await _execAsync(`powershell -NonInteractive -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 55_000 });
        console.log(`[wia] stdout: ${stdout.trim().slice(0, 200)}`);
        if (stderr.trim())
            console.warn(`[wia] stderr: ${stderr.trim().slice(0, 200)}`);
        const files = fs.readdirSync(tmpDir)
            .filter(f => /\.(jpg|jpeg|png|tif|bmp)$/i.test(f))
            .sort()
            .map(f => fs.readFileSync(path.join(tmpDir, f)));
        if (!files.length)
            throw new Error("WIA no generó archivos de imagen");
        return files;
    }
    finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { }
    }
}
// ── 2. eSCL / AirScan ────────────────────────────────────────────────────────
// Protocolo estándar soportado por Kyocera, Olivetti, HP, Canon, Ricoh, Brother, Epson
// RFC: https://www.mopria.org/spec-archive
async function scanESCL(ip, opts) {
    let base;
    if (opts.escl_port) {
        // Puerto conocido del registro mDNS SRV — no necesitamos probe
        const proto = opts.escl_port === 443 || opts.escl_port === 9096 ? "https" : "http";
        base = `${proto}://${ip}:${opts.escl_port}`;
        console.log(`[escl] ${ip} → usando puerto mDNS: ${base}`);
        // Verificar que responde
        await httpGet(`${base}/eSCL/ScannerCapabilities`, 4000).catch((e) => {
            throw new Error(`eSCL port ${opts.escl_port} no responde: ${e.message}`);
        });
    }
    else {
        // Puerto desconocido — probar en paralelo los más comunes
        const candidates = [
            { proto: "http", port: 80 },
            { proto: "https", port: 443 },
            { proto: "https", port: 9096 }, // Kyocera/Olivetti (d-COPIA, TASKalfa)
            { proto: "http", port: 8080 },
            { proto: "http", port: 9090 },
            { proto: "https", port: 5358 },
            { proto: "http", port: 9280 }, // HP
            { proto: "http", port: 9095 }, // Kyocera alt
        ];
        base = await new Promise((resolve, reject) => {
            let resolved = false;
            let pending = candidates.length;
            for (const c of candidates) {
                const url = `${c.proto}://${ip}:${c.port}/eSCL/ScannerCapabilities`;
                httpGet(url, 2000)
                    .then(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve(`${c.proto}://${ip}:${c.port}`);
                        console.log(`[escl] ${ip} → accesible en ${c.proto}:${c.port}`);
                    }
                })
                    .catch(() => {
                    pending--;
                    if (pending === 0 && !resolved) {
                        reject(new Error(`No se encontró eSCL en ${ip} (probados 80,443,8080,9090,5358,9280)`));
                    }
                });
            }
        });
    }
    // Construir XML de scan settings
    const inputSource = (opts.source === "adf" || opts.source === "adf_duplex") ? "Feeder" : "Platen";
    const colorMode = opts.color ? "RGB24" : "Grayscale8";
    const dpi = opts.dpi || 300;
    // A4: 2480 x 3508 a 300dpi (en unidades de 1/300")
    const w = Math.round(dpi * (210 / 25.4));
    const h = Math.round(dpi * (297 / 25.4));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
                   xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:Width>${Math.round(w * 300 / dpi)}</pwg:Width>
      <pwg:Height>${Math.round(h * 300 / dpi)}</pwg:Height>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${inputSource}</pwg:InputSource>
  <scan:ColorMode>${colorMode}</scan:ColorMode>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>
  ${opts.duplex ? "<scan:Duplex>true</scan:Duplex>" : ""}
</scan:ScanSettings>`;
    // Crear trabajo de escaneo
    const jobLocation = await httpPost(`${base}/eSCL/ScanJobs`, xml, "text/xml", 15_000);
    if (!jobLocation)
        throw new Error("eSCL: no se recibió Location en la respuesta");
    console.log(`[escl] job creado: ${jobLocation}`);
    // Obtener páginas hasta que responda 404
    const pages = [];
    const fullJobUrl = jobLocation.startsWith("http") ? jobLocation : `${base}${jobLocation}`;
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const pageData = await httpGetBinary(`${fullJobUrl}/NextDocument`, 30_000);
            if (!pageData || pageData.length < 100)
                break;
            pages.push(pageData);
            console.log(`[escl] página ${pages.length} → ${pageData.length} bytes`);
        }
        catch (e) {
            // 404 = no más páginas, es el fin normal
            if (e?.message?.includes("404") || e?.message?.includes("503"))
                break;
            throw e;
        }
    }
    // Limpiar el job
    httpDelete(`${fullJobUrl}`).catch(() => { });
    if (!pages.length)
        throw new Error("eSCL: el escáner no devolvió páginas");
    return pages;
}
// ── 2b. WS-Scan / WSD-Scan ───────────────────────────────────────────────────
// Protocolo nativo de Kyocera, Olivetti, Canon, Ricoh y Brother via puerto 5357
// Más confiable que eSCL para MFPs de red en entornos Windows
async function scanWSDScan(ip, opts) {
    // Probar puertos WSD en paralelo: 5357 (HTTP) y 5358 (HTTPS) — Kyocera usa ambos
    const wsdPort = await new Promise((resolve, reject) => {
        let done = false;
        let pending = 2;
        const tryPort = (port, mod) => {
            const req = mod.request({ hostname: ip, port, path: "/", method: "GET",
                timeout: 2000, rejectUnauthorized: false }, (res) => { res.resume(); if (!done) {
                done = true;
                resolve({ port, mod });
            } });
            req.on("error", () => { pending--; if (pending === 0 && !done)
                reject(new Error("WSD puertos 5357/5358 no disponibles")); });
            req.on("timeout", () => { req.destroy(); pending--; if (pending === 0 && !done)
                reject(new Error("WSD timeout")); });
            req.end();
        };
        tryPort(5357, http);
        tryPort(5358, https);
    });
    const wsdBase = `${wsdPort.mod === https ? "https" : "http"}://${ip}:${wsdPort.port}`;
    console.log(`[wsd-scan] ${ip} → accesible en ${wsdBase}`);
    const msgId = () => `urn:uuid:${Math.random().toString(16).slice(2)}-${Date.now()}`;
    const colorMode = opts.color ? "RGB" : "Grayscale";
    const inputSrc = (opts.source === "adf" || opts.source === "adf_duplex") ? "ADF" : "Platen";
    const dpi = opts.dpi || 300;
    // ── Paso 1: CreateScanJobRequest ──────────────────────────────────────────
    const createJobXml = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope
  xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:w="http://schemas.microsoft.com/windows/2006/08/wdp/scan">
  <s:Header>
    <a:To>${wsdBase}/</a:To>
    <a:Action>http://schemas.microsoft.com/windows/2006/08/wdp/scan/CreateScanJob</a:Action>
    <a:MessageID>${msgId()}</a:MessageID>
    <a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>
  </s:Header>
  <s:Body>
    <w:CreateScanJobRequest>
      <w:ScanTicket>
        <w:JobDescription>
          <w:JobName>Scan</w:JobName>
          <w:JobOriginatingUserName>scanner-agent</w:JobOriginatingUserName>
        </w:JobDescription>
        <w:DocumentParameters>
          <w:Format>jfif</w:Format>
          <w:CompressionQualityFactor>75</w:CompressionQualityFactor>
          <w:ImagingParameters>
            <w:Exposure>
              <w:AutoExposure/>
            </w:Exposure>
            <w:Scaling>
              <w:ScalingHeight>100</w:ScalingHeight>
              <w:ScalingWidth>100</w:ScalingWidth>
            </w:Scaling>
            <w:MediaSides>
              <w:MediaFront>
                <w:ScanRegion>
                  <w:ScanRegionXOffset>0</w:ScanRegionXOffset>
                  <w:ScanRegionYOffset>0</w:ScanRegionYOffset>
                  <w:ScanRegionWidth>${Math.round(dpi * 8.27)}</w:ScanRegionWidth>
                  <w:ScanRegionHeight>${Math.round(dpi * 11.69)}</w:ScanRegionHeight>
                </w:ScanRegion>
                <w:ColorProcessing>${colorMode}</w:ColorProcessing>
                <w:Resolution>
                  <w:Width>${dpi}</w:Width>
                  <w:Height>${dpi}</w:Height>
                </w:Resolution>
              </w:MediaFront>
              ${opts.duplex ? `<w:MediaBack>
                <w:ScanRegion>
                  <w:ScanRegionXOffset>0</w:ScanRegionXOffset>
                  <w:ScanRegionYOffset>0</w:ScanRegionYOffset>
                  <w:ScanRegionWidth>${Math.round(dpi * 8.27)}</w:ScanRegionWidth>
                  <w:ScanRegionHeight>${Math.round(dpi * 11.69)}</w:ScanRegionHeight>
                </w:ScanRegion>
                <w:ColorProcessing>${colorMode}</w:ColorProcessing>
                <w:Resolution>
                  <w:Width>${dpi}</w:Width>
                  <w:Height>${dpi}</w:Height>
                </w:Resolution>
              </w:MediaBack>` : ""}
            </w:MediaSides>
          </w:ImagingParameters>
          <w:InputSource>${inputSrc}</w:InputSource>
        </w:DocumentParameters>
      </w:ScanTicket>
    </w:CreateScanJobRequest>
  </s:Body>
</s:Envelope>`;
    const createResp = await httpPostSoap(wsdBase, createJobXml, "http://schemas.microsoft.com/windows/2006/08/wdp/scan/CreateScanJob", 15_000);
    // Extraer JobId y JobToken del response
    const jobIdMatch = createResp.match(/<[^:>]*:?JobId[^>]*>([^<]+)<\//);
    const jobTokenMatch = createResp.match(/<[^:>]*:?JobToken[^>]*>([^<]+)<\//);
    if (!jobIdMatch?.[1])
        throw new Error("WSD-Scan: no se recibió JobId en CreateScanJob");
    const jobId = jobIdMatch[1].trim();
    const jobToken = jobTokenMatch?.[1]?.trim() || "";
    console.log(`[wsd-scan] JobId=${jobId} JobToken=${jobToken}`);
    // ── Paso 2: RetrieveImageRequest (repetir hasta que no haya más páginas) ──
    const pages = [];
    for (let pageNum = 1; pageNum <= 50; pageNum++) {
        const retrieveXml = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope
  xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:w="http://schemas.microsoft.com/windows/2006/08/wdp/scan">
  <s:Header>
    <a:To>${wsdBase}/</a:To>
    <a:Action>http://schemas.microsoft.com/windows/2006/08/wdp/scan/RetrieveImage</a:Action>
    <a:MessageID>${msgId()}</a:MessageID>
    <a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>
  </s:Header>
  <s:Body>
    <w:RetrieveImageRequest>
      <w:JobId>${jobId}</w:JobId>
      <w:JobToken>${jobToken}</w:JobToken>
    </w:RetrieveImageRequest>
  </s:Body>
</s:Envelope>`;
        try {
            const imgData = await httpPostSoapBinary(wsdBase, retrieveXml, "http://schemas.microsoft.com/windows/2006/08/wdp/scan/RetrieveImage", 30_000);
            if (!imgData || imgData.length < 100)
                break;
            pages.push(imgData);
            console.log(`[wsd-scan] página ${pageNum} → ${imgData.length} bytes`);
        }
        catch (e) {
            // ServerErrorNotAvailable o similar = no más páginas
            if (e?.message?.includes("NotAvail") || e?.message?.includes("JobEnded") ||
                e?.message?.includes("404") || e?.message?.includes("500"))
                break;
            throw e;
        }
    }
    if (!pages.length)
        throw new Error("WSD-Scan: el escáner no devolvió páginas");
    return pages;
}
async function httpPostSoap(base, xml, action, timeoutMs) {
    const parsed = new URL(base);
    const mod = parsed.protocol === "https:" ? https : http;
    const defaultPort = parsed.protocol === "https:" ? 5358 : 5357;
    const bodyBuf = Buffer.from(xml, "utf8");
    return new Promise((resolve, reject) => {
        const req = mod.request({
            hostname: parsed.hostname,
            port: Number(parsed.port) || defaultPort,
            path: "/",
            method: "POST",
            rejectUnauthorized: false,
            headers: {
                "Content-Type": "application/soap+xml; charset=utf-8",
                "Content-Length": bodyBuf.length,
                "SOAPAction": `"${action}"`,
            },
            timeout: timeoutMs,
        }, (res) => {
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 400)
                    reject(new Error(`SOAP HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
                else
                    resolve(data);
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("SOAP timeout")); });
        req.write(bodyBuf);
        req.end();
    });
}
// RetrieveImage puede devolver MTOM (multipart con imagen binaria) o base64 inline
async function httpPostSoapBinary(base, xml, action, timeoutMs) {
    const parsed = new URL(base);
    const mod = parsed.protocol === "https:" ? https : http;
    const defaultPort = parsed.protocol === "https:" ? 5358 : 5357;
    const bodyBuf = Buffer.from(xml, "utf8");
    return new Promise((resolve, reject) => {
        const req = mod.request({
            hostname: parsed.hostname,
            port: Number(parsed.port) || defaultPort,
            path: "/",
            method: "POST",
            rejectUnauthorized: false,
            headers: {
                "Content-Type": "application/soap+xml; charset=utf-8",
                "Content-Length": bodyBuf.length,
                "SOAPAction": `"${action}"`,
                "Accept": "application/soap+xml, multipart/related, */*",
            },
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 400) {
                    const txt = Buffer.concat(chunks).toString("utf8");
                    reject(new Error(`SOAP HTTP ${res.statusCode}: ${txt.slice(0, 300)}`));
                    return;
                }
                const data = Buffer.concat(chunks);
                const ct = res.headers["content-type"] || "";
                // MTOM multipart
                if (ct.includes("multipart/related")) {
                    const img = extractMTOMImage(data);
                    if (img && img.length > 100) {
                        resolve(img);
                        return;
                    }
                }
                // Intentar extraer imagen inline (JPEG/PNG) del body
                const img = extractIppDocument(data);
                if (img && img.length > 100) {
                    resolve(img);
                    return;
                }
                // Base64 en XML
                const b64Match = data.toString("utf8").match(new RegExp("<[^>]*ImageData[^>]*>([A-Za-z0-9+\/=\r\n\s]+)<"));
                if (b64Match?.[1]) {
                    try {
                        const decoded = Buffer.from(b64Match[1].replace(/\s/g, ""), "base64");
                        if (decoded.length > 100) {
                            resolve(decoded);
                            return;
                        }
                    }
                    catch { }
                }
                reject(new Error("WSD-Scan: no se pudo extraer imagen del response"));
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("SOAP timeout")); });
        req.write(bodyBuf);
        req.end();
    });
}
function extractMTOMImage(data) {
    // Buscar boundary en el body y extraer la parte binaria
    const str = data.slice(0, 500).toString("ascii");
    const boundaryMatch = str.match(/boundary="?([^"\r\n;]+)"?/i);
    if (!boundaryMatch)
        return null;
    const boundary = Buffer.from("--" + boundaryMatch[1].trim());
    let pos = data.indexOf(boundary);
    while (pos !== -1) {
        pos += boundary.length;
        // Saltar headers de esta parte
        const headerEnd = data.indexOf(Buffer.from("\r\n\r\n"), pos);
        if (headerEnd === -1)
            break;
        const partStart = headerEnd + 4;
        const nextBoundary = data.indexOf(boundary, partStart);
        const partEnd = nextBoundary === -1 ? data.length : nextBoundary - 2;
        const part = data.slice(partStart, partEnd);
        // Verificar si es JPEG o PNG
        if ((part[0] === 0xFF && part[1] === 0xD8) ||
            (part[0] === 0x89 && part[1] === 0x50)) {
            return part;
        }
        pos = nextBoundary;
    }
    return null;
}
// ── 3. IPP con probe de paths ────────────────────────────────────────────────
// Fallback para escáneres más viejos
const IPP_PATHS = ["/ipp/scan", "/ipp", "/ipp/printer", "/ipp/print", "/ipp/scan/0", "/scanner"];
async function scanIPP(ip, opts) {
    let lastError = new Error("IPP: ningún path respondió");
    for (const tryPath of IPP_PATHS) {
        try {
            // Enviar directamente un IPP request real — más confiable que GET probe
            // (Kyocera responde a GET con 200 pero ECONNRESET al POST real)
            console.log(`[ipp] ${ip} probando ${tryPath}…`);
            const pages = await scanViaIPP(ip, tryPath, opts.dpi, opts.color, opts.source);
            return pages;
        }
        catch (e) {
            lastError = new Error(`IPP ${tryPath}: ${e.message}`);
            console.warn(`[ipp] ${ip}${tryPath}: ${e.message}`);
        }
    }
    throw lastError;
}
async function scanViaIPP(ip, ippPath, dpi, color, source) {
    // Construir un IPP Scan request correcto (operation 0x0033 = Get-Jobs como probe,
    // luego 0x003B = Scan-Job para el escaneo real)
    const ippBody = buildIppScanRequest(ip, ippPath, dpi, color, source);
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: ip, port: 631, path: ippPath,
            method: "POST",
            headers: {
                "Content-Type": "application/ipp",
                "Content-Length": ippBody.length,
            },
            timeout: 30_000,
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const data = Buffer.concat(chunks);
                if (res.statusCode !== 200)
                    return reject(new Error(`IPP HTTP ${res.statusCode} en ${ippPath}`));
                const image = extractIppDocument(data);
                if (!image || image.length < 100)
                    return reject(new Error("IPP sin datos de imagen"));
                console.log(`[ipp] ${ip}${ippPath} → 1 pág. (${image.length} bytes)`);
                resolve([image]);
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("IPP timeout")); });
        req.write(ippBody);
        req.end();
    });
}
function buildIppScanRequest(ip, ippPath, dpi, color, source) {
    const scannerUri = `ipp://${ip}:631${ippPath}`;
    const ippSource = (source === "adf" || source === "adf_duplex") ? "feeder" : "platen";
    // IPP 2.0 — operation 0x003B = Scan-Job
    const parts = [
        0x02, 0x00, // version 2.0
        0x00, 0x3B, // operation: Scan-Job
        0x00, 0x00, 0x00, 0x01, // request-id
        0x01, // operation-attributes-tag
    ];
    function addAttr(tag, name, value) {
        const nameBuf = Buffer.from(name, "utf8");
        parts.push(tag);
        parts.push(0x00, nameBuf.length);
        parts.push(...nameBuf);
        if (typeof value === "string") {
            const valBuf = Buffer.from(value, "utf8");
            parts.push(0x00, valBuf.length);
            parts.push(...valBuf);
        }
        else if (typeof value === "number") {
            parts.push(0x00, 0x04, (value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF);
        }
        else if (typeof value === "boolean") {
            parts.push(0x00, 0x01, value ? 0x01 : 0x00);
        }
    }
    addAttr(0x47, "attributes-charset", "utf-8");
    addAttr(0x48, "attributes-natural-language", "es-ar");
    addAttr(0x45, "printer-uri", scannerUri);
    addAttr(0x22, "x-resolution", dpi);
    addAttr(0x22, "y-resolution", dpi);
    addAttr(0x44, "document-format", "image/jpeg");
    addAttr(0x44, "scan-color-mode", color ? "RGB" : "Grayscale");
    addAttr(0x44, "input-source", ippSource);
    parts.push(0x03); // end-of-attributes
    return Buffer.from(parts);
}
function extractIppDocument(data) {
    for (let i = 0; i < data.length - 4; i++) {
        if ((data[i] === 0xFF && data[i + 1] === 0xD8) ||
            (data[i] === 0x89 && data[i + 1] === 0x50)) {
            return data.slice(i);
        }
    }
    return null;
}
// ── Helpers HTTP ─────────────────────────────────────────────────────────────
function httpGet(url, timeoutMs = 5000, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;
        const req = mod.get(url, {
            timeout: timeoutMs,
            rejectUnauthorized: false,
        }, (res) => {
            // Seguir redirects 301/302 (fix: antes fallaba con HTTP 301 en Kyocera)
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers?.location && maxRedirects > 0) {
                res.resume();
                const redirectUrl = res.headers.location.startsWith("http")
                    ? res.headers.location
                    : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
                httpGet(redirectUrl, timeoutMs, maxRedirects - 1).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => resolve(data));
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.end();
    });
}
function httpGetBinary(url, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;
        const req = mod.get(url, {
            timeout: timeoutMs,
            rejectUnauthorized: false,
        }, (res) => {
            if (res.statusCode === 404 || res.statusCode === 503) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            if (res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.end();
    });
}
function httpPost(url, body, contentType, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;
        const bodyBuf = Buffer.from(body, "utf8");
        const opts = {
            hostname: parsed.hostname,
            port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
            path: parsed.pathname,
            method: "POST",
            headers: {
                "Content-Type": contentType,
                "Content-Length": bodyBuf.length,
            },
            timeout: timeoutMs,
            rejectUnauthorized: false,
        };
        const req = mod.request(opts, (res) => {
            // Seguir redirect 301/302 para POST → GET (fix: Kyocera redirige /eSCL/ScanJobs)
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers?.location) {
                res.resume();
                const redirectUrl = res.headers.location.startsWith("http")
                    ? res.headers.location
                    : `${parsed.protocol}//${parsed.hostname}:${opts.port}${res.headers.location}`;
                // Retry como POST a la nueva URL
                httpPost(redirectUrl, body, contentType, timeoutMs).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode === 201 || res.statusCode === 200) {
                const loc = res.headers?.["location"] || "";
                resolve(loc);
                res.resume();
            }
            else {
                let d = "";
                res.on("data", (c) => d += c);
                res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`)));
            }
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.write(bodyBuf);
        req.end();
    });
}
function httpDelete(url) {
    return new Promise((resolve) => {
        try {
            const parsed = new URL(url);
            const mod = parsed.protocol === "https:" ? https : http;
            const req = mod.request({
                hostname: parsed.hostname,
                port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
                path: parsed.pathname,
                method: "DELETE",
                rejectUnauthorized: false,
                timeout: 5000,
            }, () => resolve());
            req.on("error", () => resolve());
            req.end();
        }
        catch {
            resolve();
        }
    });
}
// ── Fallback virtual (solo para testing) ──────────────────────────────────────
function scanVirtual() {
    const PNG_1X1 = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de" +
        "0000000c4944415408d76360f8cfc00000000200016b60b8160000000049454e44ae426082", "hex");
    return [PNG_1X1];
}
// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD
// ══════════════════════════════════════════════════════════════════════════════
async function uploadPages(_deviceKey, jobId, nonce, pages) {
    await ensureToken();
    const form = new FormData();
    form.append("nonce", nonce);
    for (let i = 0; i < pages.length; i++) {
        form.append("pages", pages[i], {
            filename: `page${String(i + 1).padStart(3, "0")}.jpg`,
            contentType: "image/jpeg",
        });
    }
    await axios.post(`${API}/v1/scan-jobs/${jobId}/upload`, form, {
        headers: {
            ...form.getHeaders(),
            "Authorization": `Bearer ${jwt_token}`,
            "x-tenant": TENANT,
            "x-device-key": _deviceKey,
        },
        timeout: 120_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    console.log(`[agent] ✅ job ${jobId} → subidas ${pages.length} pág.`);
}
// ══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT
// ══════════════════════════════════════════════════════════════════════════════
async function heartbeatAll(devices) {
    const caps = {
        model: "Multi-Device Agent v4",
        manufacturer: "Scanner SaaS",
        sources: ["flatbed", "adf"],
        resolutions: [150, 300, 600],
        paper_sizes: ["A4", "Carta", "Oficio"],
        color_modes: ["color", "gris"],
        duplex: true,
        max_pages_adf: 100,
        online: true,
    };
    await Promise.all(devices.map(async (dev) => {
        try {
            const client = makeDeviceClient(dev.device_key);
            await client.post("/agent/heartbeat", { capabilities: caps });
        }
        catch (e) {
            if (e?.response?.status !== 401)
                console.warn(`[heartbeat] device ${dev.id} (${dev.hostname}):`, e?.response?.status || e?.message);
        }
    }));
    console.log(`[heartbeat] ✅ ${devices.length} devices`);
}
// ══════════════════════════════════════════════════════════════════════════════
// POLL
// ══════════════════════════════════════════════════════════════════════════════
let polling = false;
async function pollAll(devices) {
    if (polling || !devices.length)
        return;
    polling = true;
    try {
        await Promise.all(devices.map(async (dev) => {
            try {
                const client = makeDeviceClient(dev.device_key);
                const { data } = await client.get("/agent/poll");
                if (!data.job_id)
                    return;
                const { job_id, upload_nonce, profile, personal_ref, personal_dni } = data;
                const src = data.source || "flatbed";
                const dup = !!data.duplex;
                const ip = dev.hostname;
                console.log(`[poll] 📋 job ${job_id} → device "${dev.name}" (${ip})`);
                let pages;
                try {
                    pages = await scanDevice(ip, { ...profile, source: src, duplex: dup, escl_port: dev.escl_port || null });
                }
                catch (scanErr) {
                    console.error(`[scan] ❌ job ${job_id} falló:`, scanErr.message);
                    await client.post("/agent/fail", {
                        job_id,
                        error_message: `Scan error: ${scanErr.message}`
                    }).catch(() => { });
                    return;
                }
                if (!upload_nonce || upload_nonce === "null") {
                    console.error(`[poll] ❌ nonce inválido para job ${job_id}`);
                    return;
                }
                await uploadPages(dev.device_key, job_id, upload_nonce, pages);
            }
            catch (e) {
                if (e?.response?.status !== 404) {
                    console.warn(`[poll] device ${dev.id}:`, e?.code || e?.message, e?.response?.status ? `HTTP ${e.response.status}` : "");
                }
            }
        }));
    }
    finally {
        polling = false;
    }
}
// ══════════════════════════════════════════════════════════════════════════════
// AUTODISCOVERY — llama al endpoint /discover de la API para escanear la red
// y registrar automáticamente los escáneres encontrados vía mDNS/WSD/SNMP
// ══════════════════════════════════════════════════════════════════════════════
async function discoverAndRegister() {
    try {
        await ensureToken();
        console.log("[autodiscovery] 🔍 Escaneando red en busca de escáneres…");
        const res = await http_client.post("/devices/discover", {
            methods: ["wsd", "mdns", "snmp", "probe"],
        });
        const { registered, updated, diagnostics } = res.data;
        console.log(`[autodiscovery] ✅ Nuevos: ${registered} | Actualizados: ${updated}`);
        for (const [method, info] of Object.entries(diagnostics)) {
            if (info.ok) {
                console.log(`[autodiscovery]    ${method}: ${info.count} encontrado(s)`);
            }
            else {
                console.warn(`[autodiscovery]    ${method}: ⚠️  ${info.error}`);
            }
        }
    }
    catch (e) {
        console.warn("[autodiscovery] ⚠️  Error al descubrir:", e?.response?.data?.message || e?.message);
    }
}
// ══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
    console.log(`[agent] 🚀 Multi-Device Scanner Agent v4.0 arrancando`);
    console.log(`[agent]    API:      ${API}`);
    console.log(`[agent]    Tenant:   ${TENANT}`);
    console.log(`[agent]    Hostname: ${HOSTNAME}`);
    console.log(`[agent]    Platform: ${process.platform}`);
    await login();
    if (!jwt_token) {
        console.error("[agent] ❌ No se pudo hacer login, reintentando en 10s…");
        setTimeout(() => main(), 10_000);
        return;
    }
    // Autodiscovery al arrancar
    await discoverAndRegister();
    let devices = await getDevices();
    console.log(`[agent] 🖨️  Found ${devices.length} active devices:`);
    devices.forEach(d => console.log(`[agent]    - ${d.name} (${d.hostname}) key=${d.device_key}`));
    if (!devices.length)
        console.warn("[agent] ⚠️  Sin devices — reintentando en 30s…");
    if (devices.length)
        await heartbeatAll(devices);
    // Autodiscovery cada 5 minutos + refresh de device list
    const DISCOVER_MS = Number(process.env.DISCOVER_INTERVAL_MS || 5 * 60_000);
    setInterval(async () => {
        await discoverAndRegister();
        devices = await getDevices();
        console.log(`[agent] 🔄 device list: ${devices.length} devices`);
    }, DISCOVER_MS);
    // Refresh de device list cada 60s (por si se agregan/modifican desde la UI)
    setInterval(async () => {
        devices = await getDevices();
        console.log(`[agent] 🔄 device list: ${devices.length} devices`);
    }, 60_000);
    setInterval(() => heartbeatAll(devices), BEAT_MS);
    setInterval(() => pollAll(devices), POLL_MS);
}
process.on("SIGTERM", () => { console.log("[agent] 🛑 Stopping…"); process.exit(0); });
process.on("SIGINT", () => process.exit(0));
main().catch(e => { console.error("[agent] Startup error:", e); process.exit(1); });
