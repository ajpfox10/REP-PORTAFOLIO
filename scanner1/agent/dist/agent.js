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
import net from "net";
import { exec } from "child_process";
import { promisify } from "util";
import FormData from "form-data";
import axios from "axios";
import { Jimp } from "jimp";
const execAsync = promisify(exec);
const _execAsync = execAsync;
const API = (process.env.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const TENANT = process.env.AGENT_TENANT_ID || "1";
const EMAIL = process.env.AGENT_EMAIL || "admin@local.com";
const PASSWORD = process.env.AGENT_PASSWORD || "Admin12345@";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 4000);
const BEAT_MS = Number(process.env.HEARTBEAT_MS || 30000);
const SCAN_CONCURRENCY = Math.max(1, Number(process.env.SCAN_CONCURRENCY || 2));
const AUTO_DISCOVERY_ENABLED = process.env.AUTO_DISCOVERY_ENABLED !== "false";
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
        const out = [];
        let cursor = 0;
        for (let i = 0; i < 10; i++) {
            const res = await http_client.get("/devices", {
                params: { limit: 200, cursor }
            });
            const items = res.data.items || [];
            out.push(...items);
            const next = Number(res.data.next_cursor || 0);
            if (!items.length || next <= cursor)
                break;
            cursor = next;
        }
        return out.filter(d => d.is_active && (d.hostname || d.driver === "virtual"));
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
// Prioridad: eSCL/AirScan → WS-Scan → IPP con probe → WIA local
// ══════════════════════════════════════════════════════════════════════════════
async function scanDevice(ip, profile) {
    const dpi = profile?.dpi ?? 300;
    const color = profile?.color !== false;
    const source = profile?.source ?? "flatbed";
    const duplex = !!profile?.duplex;
    const escl_port = profile?.escl_port ?? null; // puerto real del mDNS SRV record
    const driver = profile?.driver ?? "wia";
    const errors = [];
    const isLocalDevice = !ip || ip === "127.0.0.1" || ip.toLowerCase() === HOSTNAME.toLowerCase();
    if (driver === "virtual") {
        return await scanVirtual(profile);
    }
    // 1. Windows WIA solo para dispositivos locales registrados en este equipo.
    // En red los Olivetti/Kyocera anuncian eSCL/WSD, y WIA en este servidor suele estar vacio.
    if (process.platform === "win32" && isLocalDevice) {
        try {
            const pages = await scanWIA(ip, { dpi, color, source, duplex });
            console.log(`[wia] ✅ ${ip} → ${pages.length} pág.`);
            return pages;
        }
        catch (e) {
            errors.push(`WIA: ${e.message}`);
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
        errors.push(`eSCL: ${e.message}`);
        console.warn(`[escl] ${ip} falló: ${e.message} — probando Kyocera private…`);
    }
    // 2b. Kyocera private scan API (KMTWAIN / Boxless Scanning Module)
    try {
        const pages = await scanKyoceraPrivate(ip, { dpi, color, source, duplex });
        console.log(`[kyocera] ✅ ${ip} → ${pages.length} pág.`);
        return pages;
    }
    catch (e) {
        errors.push(`Kyocera: ${e.message}`);
        console.warn(`[kyocera] ${ip} falló: ${e.message} — probando WSD-Scan…`);
    }
    // 3. WS-Scan / WSD-Scan via puerto 5357 (Kyocera, Olivetti, Canon)
    try {
        const pages = await scanWSDScan(ip, { dpi, color, source, duplex });
        console.log(`[wsd-scan] ✅ ${ip} → ${pages.length} pág.`);
        return pages;
    }
    catch (e) {
        errors.push(`WSD-Scan: ${e.message}`);
        console.warn(`[wsd-scan] ${ip} falló: ${e.message} — probando IPP…`);
    }
    // 4. IPP con probe de paths (fallback legacy)
    try {
        return await scanIPP(ip, { dpi, color, source });
    }
    catch (e) {
        errors.push(`IPP: ${e.message}`);
    }
    throw new Error(errors.join(" | "));
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
    // Crear trabajo de escaneo
    const variants = buildEsclScanSettingsVariants({
        inputSource,
        colorMode,
        dpi,
        width: Math.round(w * 300 / dpi),
        height: Math.round(h * 300 / dpi),
        duplex: opts.duplex,
    });
    let jobLocation = "";
    let lastPostError = null;
    for (const variant of variants) {
        try {
            console.log(`[escl] ${ip} creando job (${variant.label})`);
            jobLocation = await httpPostWithRetry(`${base}/eSCL/ScanJobs`, variant.xml, "text/xml; charset=utf-8", 20_000, 2);
            if (jobLocation)
                break;
            lastPostError = new Error("respuesta sin Location");
        }
        catch (e) {
            lastPostError = e;
            console.warn(`[escl] ${ip} ScanJobs ${variant.label} falló: ${e.message}`);
            await sleep(800);
        }
    }
    if (!jobLocation) {
        const detail = lastPostError?.message ? ` (${lastPostError.message})` : "";
        throw new Error(`eSCL: no se recibió Location en la respuesta${detail}`);
    }
    console.log(`[escl] job creado: ${jobLocation}`);
    // Obtener páginas hasta que responda 404
    const pages = [];
    const fullJobUrl = resolveDeviceUrl(base, jobLocation);
    const startedAt = Date.now();
    let missesAfterPage = 0;
    await sleep(1_500);
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const pageData = await httpGetBinary(`${fullJobUrl}/NextDocument`, 30_000);
            if (!pageData || pageData.length < 100) {
                missesAfterPage++;
                if (pages.length && missesAfterPage >= 2)
                    break;
                await sleep(1_000);
                continue;
            }
            missesAfterPage = 0;
            pages.push(pageData);
            console.log(`[escl] página ${pages.length} → ${pageData.length} bytes`);
        }
        catch (e) {
            // 404 = no más páginas, es el fin normal
            const msg = e?.message || String(e);
            if (msg.includes("404") || msg.includes("503")) {
                if (pages.length)
                    break;
                if (Date.now() - startedAt > 60_000)
                    break;
                await sleep(1_500);
                continue;
            }
            if (isTransientHttpError(e) && Date.now() - startedAt <= 75_000) {
                console.warn(`[escl] ${ip} NextDocument transitorio: ${msg}; reintentando...`);
                await sleep(1_500);
                continue;
            }
            throw e;
        }
    }
    // Limpiar el job
    httpDelete(`${fullJobUrl}`).catch(() => { });
    if (!pages.length)
        throw new Error("eSCL: el escáner no devolvió páginas");
    return pages;
}
function buildEsclScanSettingsVariants(opts) {
    const scanRegion = `  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:Width>${opts.width}</pwg:Width>
      <pwg:Height>${opts.height}</pwg:Height>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>`;
    const common = `  <scan:Intent>Document</scan:Intent>
  <scan:ColorMode>${opts.colorMode}</scan:ColorMode>
  <scan:XResolution>${opts.dpi}</scan:XResolution>
  <scan:YResolution>${opts.dpi}</scan:YResolution>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  ${opts.duplex ? "<scan:Duplex>true</scan:Duplex>" : ""}`.trimEnd();
    const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
                   xmlns:escl="http://schemas.hp.com/imaging/escl/2011/05/03"
                   xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
${body}
</scan:ScanSettings>`;
    return [
        {
            label: "pwg-region-jpeg",
            xml: wrap(`${scanRegion}
  <pwg:InputSource>${opts.inputSource}</pwg:InputSource>
${common}`),
        },
        {
            label: "pwg-simple-jpeg",
            xml: wrap(`  <pwg:InputSource>${opts.inputSource}</pwg:InputSource>
${common}`),
        },
        {
            label: "scan-input-jpeg",
            xml: wrap(`${scanRegion}
  <scan:InputSource>${opts.inputSource}</scan:InputSource>
${common}`),
        },
    ];
}
// ── 2b. WS-Scan / WSD-Scan ───────────────────────────────────────────────────
// Protocolo nativo de Kyocera, Olivetti, Canon, Ricoh y Brother via puerto 5357
// Más confiable que eSCL para MFPs de red en entornos Windows
// Kyocera KMTWAIN / Boxless Scanning Module.
// Some d-COPIA/TASKalfa devices keep standard WSD scan stopped but accept this API.
async function scanKyoceraPrivate(ip, opts) {
    const base = `http://${ip}:9090/ws/km-wsdl/job/scan_operation`;
    const serviceInfo = await kyoceraSoap(base, "get_service_information", "<k:get_service_informationRequest/>", 8_000);
    if (xmlValue(serviceInfo.text, "result") !== "SUCCESS") {
        throw new Error("servicio privado no disponible");
    }
    let operationId = "";
    try {
        const open = await kyoceraSoap(base, "open_session", "<k:open_sessionRequest/>", 15_000);
        const openResult = xmlValue(open.text, "result");
        operationId = xmlValue(open.text, "operation_id");
        if (openResult !== "SUCCESS" || !operationId) {
            throw new Error(`open_session ${openResult || "sin operation_id"}`);
        }
        const dpi = nearestKyoceraDpi(opts.dpi || 300);
        const colorSelection = opts.color ? "FULL_COLOR" : "GRAYSCALE";
        const duplexMode = opts.duplex ? "DUPLEX" : "SIMPLEX";
        const scanSettings = `<k:scan_image_configuration>
  <k:color_selection>${colorSelection}</k:color_selection>
  <k:scan_resolution>RESOLUTION_${dpi}X${dpi}</k:scan_resolution>
  <k:duplex_mode>${duplexMode}</k:duplex_mode>
</k:scan_image_configuration>
<k:original_configuration>
  <k:original_size>A4_R</k:original_size>
</k:original_configuration>
<k:output_image_configuration>
  <k:image_file_format>JPEG</k:image_file_format>
</k:output_image_configuration>`;
        const start = await kyoceraSoap(base, "start_scan", `<k:start_scanRequest><k:operation_id>${operationId}</k:operation_id>${scanSettings}</k:start_scanRequest>`, 30_000);
        const startResult = xmlValue(start.text, "result");
        const jobId = xmlValue(start.text, "job_id");
        if (startResult !== "SUCCESS" || !jobId || jobId === "0") {
            throw new Error(`start_scan ${startResult || "sin job_id"}`);
        }
        const pages = [];
        for (let attempt = 0; attempt < 30; attempt++) {
            await sleep(attempt === 0 ? 3_000 : 2_000);
            const retrieve = await kyoceraSoap(base, "retrieve_image", `<k:retrieve_imageRequest><k:operation_id>${operationId}</k:operation_id><k:job_id>${jobId}</k:job_id></k:retrieve_imageRequest>`, 60_000);
            const page = extractKyoceraImage(retrieve);
            if (page && page.length > 100) {
                pages.push(page);
                break;
            }
            const result = xmlValue(retrieve.text, "result");
            if (result && !["SUCCESS", "PROCESSING", "SCAN_CONTINUE", "WAITING"].includes(result)) {
                throw new Error(`retrieve_image ${result}`);
            }
        }
        if (!pages.length)
            throw new Error("retrieve_image sin imagen");
        return pages;
    }
    finally {
        if (operationId) {
            await kyoceraSoap(base, "close_session", `<k:close_sessionRequest><k:operation_id>${operationId}</k:operation_id></k:close_sessionRequest>`, 10_000).catch(() => { });
        }
    }
}
function nearestKyoceraDpi(dpi) {
    if (dpi <= 200)
        return 200;
    if (dpi <= 300)
        return 300;
    if (dpi <= 400)
        return 400;
    return 600;
}
function kyoceraSoap(base, actionName, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(base);
        const actionNs = "http://www.kyoceramita.com/ws/km-wsdl/job/scan_operation";
        const action = `${actionNs}/${actionName}`;
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
                   xmlns:wsa="http://www.w3.org/2005/08/addressing"
                   xmlns:k="${actionNs}">
  <SOAP-ENV:Header>
    <wsa:Action>${action}</wsa:Action>
    <wsa:To>${base}</wsa:To>
    <wsa:MessageID>urn:uuid:${Math.random().toString(16).slice(2)}-${Date.now()}</wsa:MessageID>
    <wsa:ReplyTo><wsa:Address>http://www.w3.org/2005/08/addressing/anonymous</wsa:Address></wsa:ReplyTo>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>${body}</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
        const bodyBuf = Buffer.from(xml, "utf8");
        const req = http.request({
            hostname: parsed.hostname,
            port: Number(parsed.port) || 9090,
            path: parsed.pathname,
            method: "POST",
            headers: {
                "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
                "SOAPAction": `"${action}"`,
                "Content-Length": bodyBuf.length,
            },
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const buffer = Buffer.concat(chunks);
                const text = buffer.toString("utf8");
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`SOAP HTTP ${res.statusCode}: ${extractSoapFault(text)}`));
                    return;
                }
                resolve({ text, buffer });
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.write(bodyBuf);
        req.end();
    });
}
function xmlValue(xml, tag) {
    return xml.match(new RegExp(`<[^>]*:?${tag}[^>]*>([^<]*)</[^>]+>`, "i"))?.[1]?.trim() || "";
}
function extractKyoceraImage(res) {
    const jpeg = res.buffer.indexOf(Buffer.from([0xFF, 0xD8]));
    if (jpeg >= 0)
        return res.buffer.slice(jpeg);
    const pdf = res.buffer.indexOf(Buffer.from("%PDF"));
    if (pdf >= 0)
        return res.buffer.slice(pdf);
    const b64 = res.text.match(/<[^>]*:?image_data[^>]*>([A-Za-z0-9+/=\r\n\s]+)</i)?.[1];
    if (!b64)
        return null;
    try {
        return Buffer.from(b64.replace(/\s/g, ""), "base64");
    }
    catch {
        return null;
    }
}
async function scanWSDScan(ip, opts) {
    // Probar puertos WSD en paralelo. Algunos Kyocera/Olivetti publican SOAP HTTP en 5358.
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
        tryPort(5358, http);
    });
    const wsdBase = `${wsdPort.mod === https ? "https" : "http"}://${ip}:${wsdPort.port}`;
    console.log(`[wsd-scan] ${ip} → accesible en ${wsdBase}`);
    const msgId = () => `urn:uuid:${Math.random().toString(16).slice(2)}-${Date.now()}`;
    const colorMode = opts.color ? "RGB24" : "Grayscale8";
    const inputSrc = (opts.source === "adf" || opts.source === "adf_duplex") ? "ADF" : "Platen";
    const dpi = opts.dpi || 300;
    const regionWidth = 8266;
    const regionHeight = 11690;
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
          <w:ImagesToTransfer>1</w:ImagesToTransfer>
          <w:InputSource>${inputSrc}</w:InputSource>
          <w:ContentType>Auto</w:ContentType>
          <w:InputSize>
            <w:InputMediaSize>
              <w:Width>${regionWidth}</w:Width>
              <w:Height>${regionHeight}</w:Height>
            </w:InputMediaSize>
          </w:InputSize>
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
                  <w:ScanRegionWidth>${regionWidth}</w:ScanRegionWidth>
                  <w:ScanRegionHeight>${regionHeight}</w:ScanRegionHeight>
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
                  <w:ScanRegionWidth>${regionWidth}</w:ScanRegionWidth>
                  <w:ScanRegionHeight>${regionHeight}</w:ScanRegionHeight>
                </w:ScanRegion>
                <w:ColorProcessing>${colorMode}</w:ColorProcessing>
                <w:Resolution>
                  <w:Width>${dpi}</w:Width>
                  <w:Height>${dpi}</w:Height>
                </w:Resolution>
              </w:MediaBack>` : ""}
            </w:MediaSides>
          </w:ImagingParameters>
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
                    reject(new Error(`SOAP HTTP ${res.statusCode}: ${extractSoapFault(data)}`));
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
function extractSoapFault(xml) {
    const subcode = xml.match(/<[^>]*:?Subcode>[\s\S]*?<[^>]*:?Value>([^<]+)</i)?.[1]?.trim();
    const reason = xml.match(/<[^>]*:?Reason>[\s\S]*?<[^>]*:?Text[^>]*>([^<]+)</i)?.[1]?.trim() ||
        xml.match(/<faultstring[^>]*>([^<]+)</i)?.[1]?.trim();
    const detail = [subcode, reason].filter(Boolean).join(": ");
    return detail || xml.replace(/\s+/g, " ").slice(0, 300);
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
                    reject(new Error(`SOAP HTTP ${res.statusCode}: ${extractSoapFault(txt)}`));
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
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRedirectStatus(status) {
    return [301, 302, 303, 307, 308].includes(Number(status));
}
function resolveRedirectUrl(current, location) {
    return new URL(location, current.href).toString();
}
function resolveDeviceUrl(base, location) {
    if (location.startsWith("http"))
        return location;
    return new URL(location, base.endsWith("/") ? base : `${base}/`).toString();
}
function isTransientHttpError(err) {
    const msg = err?.message || String(err);
    const code = err?.code || "";
    return /socket hang up|ECONNRESET|EPIPE|ETIMEDOUT|timeout/i.test(`${code} ${msg}`);
}
function httpGet(url, timeoutMs = 5000, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;
        const req = mod.get(url, {
            timeout: timeoutMs,
            rejectUnauthorized: false,
            headers: { "Connection": "close" },
        }, (res) => {
            // Seguir redirects 301/302 (fix: antes fallaba con HTTP 301 en Kyocera)
            if (isRedirectStatus(res.statusCode) && res.headers?.location && maxRedirects > 0) {
                res.resume();
                const redirectUrl = resolveRedirectUrl(parsed, res.headers.location);
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
function httpGetBinary(url, timeoutMs = 30000, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;
        const req = mod.get(url, {
            timeout: timeoutMs,
            rejectUnauthorized: false,
            headers: {
                "Accept": "image/jpeg,image/png,image/tiff,application/pdf,*/*",
                "Connection": "close",
            },
        }, (res) => {
            if (isRedirectStatus(res.statusCode) && res.headers?.location && maxRedirects > 0) {
                res.resume();
                const redirectUrl = resolveRedirectUrl(parsed, res.headers.location);
                httpGetBinary(redirectUrl, timeoutMs, maxRedirects - 1).then(resolve).catch(reject);
                return;
            }
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
async function httpPostWithRetry(url, body, contentType, timeoutMs = 15000, attempts = 2) {
    let lastError = null;
    for (let i = 0; i < Math.max(1, attempts); i++) {
        try {
            return await httpPost(url, body, contentType, timeoutMs);
        }
        catch (e) {
            lastError = e;
            if (!isTransientHttpError(e) || i === attempts - 1)
                break;
            await sleep(700);
        }
    }
    throw lastError;
}
function httpPost(url, body, contentType, timeoutMs = 15000, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === "https:" ? https : http;
        const bodyBuf = Buffer.from(body, "utf8");
        const opts = {
            hostname: parsed.hostname,
            port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            method: "POST",
            headers: {
                "Accept": "application/xml,text/xml,*/*",
                "Content-Type": contentType,
                "Content-Length": bodyBuf.length,
                "Connection": "close",
            },
            timeout: timeoutMs,
            rejectUnauthorized: false,
        };
        const req = mod.request(opts, (res) => {
            // Seguir redirect 301/302 para POST → GET (fix: Kyocera redirige /eSCL/ScanJobs)
            if (isRedirectStatus(res.statusCode) && res.headers?.location && maxRedirects > 0) {
                res.resume();
                const redirectUrl = resolveRedirectUrl(parsed, res.headers.location);
                // Retry como POST a la nueva URL
                httpPost(redirectUrl, body, contentType, timeoutMs, maxRedirects - 1).then(resolve).catch(reject);
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
async function scanVirtual(profile) {
    const page = new Jimp({ width: 1600, height: 1100, color: 0xffffffff });
    const black = 0x111111ff;
    for (let y = 120; y < 980; y += 70) {
        for (let x = 180; x < 1380; x++) {
            page.setPixelColor(black, x, y);
            page.setPixelColor(black, x, y + 1);
            page.setPixelColor(black, x, y + 2);
        }
    }
    const pages = [];
    pages.push(await page.getBuffer("image/jpeg", { quality: 90 }));
    if (profile?.source === "adf" || profile?.source === "adf_duplex" || profile?.duplex) {
        const blank = new Jimp({ width: 1200, height: 1600, color: 0xffffffff });
        pages.push(await blank.getBuffer("image/jpeg", { quality: 90 }));
    }
    return pages;
}
function detectUploadFile(page, index) {
    const sig4 = page.subarray(0, 4).toString("ascii");
    const sig8Hex = page.subarray(0, 8).toString("hex");
    if (sig4 === "%PDF") {
        return { filename: `page${String(index + 1).padStart(3, "0")}.pdf`, contentType: "application/pdf" };
    }
    if (sig8Hex === "89504e470d0a1a0a") {
        return { filename: `page${String(index + 1).padStart(3, "0")}.png`, contentType: "image/png" };
    }
    if (sig4 === "II*\u0000" || sig4 === "MM\u0000*") {
        return { filename: `page${String(index + 1).padStart(3, "0")}.tif`, contentType: "image/tiff" };
    }
    return { filename: `page${String(index + 1).padStart(3, "0")}.jpg`, contentType: "image/jpeg" };
}
function getSoftwareProcessingCapabilities() {
    return {
        auto_rotate: true,
        blank_page_detection: true,
        compression: ["low", "medium", "high"],
        output_format: {
            pdf: true,
            pdf_a: true,
            tiff: null,
        },
    };
}
function getCompressionQuality(level) {
    if (level === "high")
        return 55;
    if (level === "low")
        return 88;
    return 72;
}
function shouldAutoRotate(image) {
    return image.bitmap.width > (image.bitmap.height * 1.08);
}
function isLikelyBlankPage(image) {
    const { width, height, data } = image.bitmap;
    if (!width || !height || !data.length)
        return false;
    const stepX = Math.max(1, Math.floor(width / 160));
    const stepY = Math.max(1, Math.floor(height / 220));
    let samples = 0;
    let nonWhite = 0;
    let strongInk = 0;
    for (let y = 0; y < height; y += stepY) {
        for (let x = 0; x < width; x += stepX) {
            const idx = ((width * y) + x) * 4;
            const avg = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            samples++;
            if (avg < 245)
                nonWhite++;
            if (avg < 220)
                strongInk++;
        }
    }
    const nonWhiteRatio = nonWhite / Math.max(1, samples);
    const strongInkRatio = strongInk / Math.max(1, samples);
    return nonWhiteRatio < 0.015 && strongInkRatio < 0.003;
}
async function normalizePageForUpload(page, profile) {
    const detected = detectUploadFile(page, 0);
    if (detected.contentType === "application/pdf")
        return page;
    let image;
    try {
        image = await Jimp.read(page);
    }
    catch {
        return page;
    }
    if (profile?.auto_rotate && shouldAutoRotate(image)) {
        image.rotate(90);
    }
    if (profile && profile.color === false) {
        image.greyscale();
    }
    return image.getBuffer("image/jpeg", {
        quality: getCompressionQuality(profile?.compression),
    });
}
async function processScannedPages(pages, profile) {
    if (!profile)
        return pages;
    const processed = [];
    const fallback = [];
    for (const page of pages) {
        const normalized = await normalizePageForUpload(page, profile);
        fallback.push(normalized);
        if (!profile.blank_page_detection) {
            processed.push(normalized);
            continue;
        }
        const detected = detectUploadFile(normalized, 0);
        if (detected.contentType === "application/pdf") {
            processed.push(normalized);
            continue;
        }
        try {
            const image = await Jimp.read(normalized);
            if (!isLikelyBlankPage(image)) {
                processed.push(normalized);
            }
        }
        catch {
            processed.push(normalized);
        }
    }
    if (processed.length)
        return processed;
    return fallback.length ? [fallback[0]] : pages;
}
// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD
// ══════════════════════════════════════════════════════════════════════════════
async function uploadPages(_deviceKey, jobId, nonce, pages) {
    await ensureToken();
    const form = new FormData();
    form.append("nonce", nonce);
    for (let i = 0; i < pages.length; i++) {
        const file = detectUploadFile(pages[i], i);
        form.append("pages", pages[i], {
            filename: file.filename,
            contentType: file.contentType,
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
async function uploadPagesWithRetry(deviceKey, jobId, nonce, pages) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await uploadPages(deviceKey, jobId, nonce, pages);
            return;
        }
        catch (e) {
            lastError = e;
            if (!isTransientHttpError(e) || attempt >= 3)
                break;
            console.warn(`[agent] upload job ${jobId} transitorio (${attempt}/3): ${e.message}; reintentando...`);
            await sleep(1_500 * attempt);
        }
    }
    throw lastError;
}
const capabilityCache = new Map();
const reachabilityCache = new Map();
function parseNameCapabilities(dev, online = true) {
    const name = dev.name || "Scanner";
    const manufacturer = guessManufacturer(name);
    const hasAdfHint = /adf|feeder|mfp|scanner/i.test(name);
    const hasDuplexHint = /duplex|dúplex|2-sided|2 sided/i.test(name);
    return {
        model: name,
        manufacturer,
        sources: hasAdfHint ? ["flatbed", "adf"] : ["flatbed"],
        resolutions: null,
        paper_sizes: null,
        color_modes: null,
        duplex: hasAdfHint ? (hasDuplexHint ? true : null) : false,
        max_pages_adf: null,
        online,
        processing: getSoftwareProcessingCapabilities(),
    };
}
function guessManufacturer(text) {
    const lower = text.toLowerCase();
    if (lower.includes("kyocera"))
        return "Kyocera";
    if (lower.includes("olivetti"))
        return "Olivetti";
    if (lower.includes("hewlett") || lower.includes(" hp ") || lower.startsWith("hp"))
        return "HP";
    if (lower.includes("canon"))
        return "Canon";
    if (lower.includes("brother"))
        return "Brother";
    if (lower.includes("epson"))
        return "Epson";
    if (lower.includes("xerox"))
        return "Xerox";
    if (lower.includes("ricoh"))
        return "Ricoh";
    if (lower.includes("samsung"))
        return "Samsung";
    if (lower.includes("lexmark"))
        return "Lexmark";
    if (lower.includes("konica") || lower.includes("minolta"))
        return "Konica Minolta";
    if (lower.includes("sharp"))
        return "Sharp";
    if (lower.includes("toshiba"))
        return "Toshiba";
    return null;
}
function uniqueSortedNumbers(values) {
    return [...new Set(values.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}
function firstXmlValue(xml, tags) {
    for (const tag of tags) {
        const match = xml.match(new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}>([^<]+)</`, "i"));
        const value = match?.[1]?.trim();
        if (value)
            return value;
    }
    return null;
}
function xmlValues(xml, tag) {
    return [...xml.matchAll(new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}>([^<]+)</`, "gi"))]
        .map((m) => m[1].trim())
        .filter(Boolean);
}
async function mapWithConcurrency(items, concurrency, worker) {
    const out = [];
    let index = 0;
    const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
        while (index < items.length) {
            const current = index++;
            out[current] = await worker(items[current]);
        }
    });
    await Promise.all(runners);
    return out;
}
function tcpProbe(host, port, timeoutMs = 1200) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        const done = (ok) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
    });
}
async function isDeviceReachable(host) {
    const cached = reachabilityCache.get(host);
    if (cached && Date.now() - cached.at < 5 * 60_000)
        return cached.online;
    const ports = [80, 443, 515, 631, 9100, 5357, 5358, 8080, 9090, 9095, 9096, 9280];
    const online = await new Promise((resolve) => {
        let settled = false;
        let pending = ports.length;
        for (const port of ports) {
            tcpProbe(host, port).then((ok) => {
                if (settled)
                    return;
                if (ok) {
                    settled = true;
                    resolve(true);
                    return;
                }
                pending--;
                if (pending === 0)
                    resolve(false);
            });
        }
    });
    reachabilityCache.set(host, { at: Date.now(), online });
    return online;
}
function parseEsclCapabilitiesXml(xml, fallbackName) {
    const manufacturer = firstXmlValue(xml, ["Manufacturer", "MakeAndModel"]) ||
        guessManufacturer(fallbackName);
    const model = firstXmlValue(xml, ["ModelName", "Model", "ScannerName", "MakeAndModel"]) ||
        fallbackName;
    const feeder = /<(?:[A-Za-z0-9_.-]+:)?InputSource>[^<]*Feeder[^<]*</i.test(xml) || /<(?:[A-Za-z0-9_.-]+:)?Adf/i.test(xml);
    const platen = /<(?:[A-Za-z0-9_.-]+:)?InputSource>[^<]*Platen[^<]*</i.test(xml) || /<(?:[A-Za-z0-9_.-]+:)?Platen/i.test(xml);
    const duplex = /<(?:[A-Za-z0-9_.-]+:)?Duplex>(?:true|1)</i.test(xml) ||
        /<(?:[A-Za-z0-9_.-]+:)?DuplexSupported>(?:true|1)</i.test(xml) ||
        /<(?:[A-Za-z0-9_.-]+:)?AdfDuplexInputCaps/i.test(xml);
    const resolutions = uniqueSortedNumbers([...xml.matchAll(/<(?:[A-Za-z0-9_.-]+:)?XResolution>(\d+)</gi)].map((m) => Number(m[1])));
    const colorModes = [...new Set(xmlValues(xml, "ColorMode")
            .map((m) => m.toLowerCase())
            .map((mode) => mode.includes("gray") ? "grayscale" : mode.includes("bw") || mode.includes("lineart") ? "blackwhite" : "color"))];
    const feederCapacity = Number(firstXmlValue(xml, ["FeederCapacity"]) || "");
    return {
        model: model || fallbackName,
        manufacturer: manufacturer || null,
        sources: platen || !feeder ? feeder ? ["flatbed", "adf"] : ["flatbed"] : ["adf"],
        resolutions: resolutions.length ? resolutions : [200, 300],
        paper_sizes: ["A4", "Letter", "Legal"],
        color_modes: colorModes.length ? colorModes : ["color", "grayscale"],
        duplex,
        max_pages_adf: feeder ? (Number.isFinite(feederCapacity) && feederCapacity > 0 ? feederCapacity : 50) : null,
        online: true,
        processing: getSoftwareProcessingCapabilities(),
    };
}
async function fetchEsclCapabilities(ip, esclPort) {
    const targets = esclPort
        ? [`${(esclPort === 443 || esclPort === 9096) ? "https" : "http"}://${ip}:${esclPort}`]
        : [
            `http://${ip}:80`,
            `https://${ip}:443`,
            `https://${ip}:9096`,
            `http://${ip}:8080`,
            `http://${ip}:9090`,
            `http://${ip}:9095`,
            `http://${ip}:9280`,
        ];
    for (const base of targets) {
        try {
            const xml = await httpGet(`${base}/eSCL/ScannerCapabilities`, 3000);
            return parseEsclCapabilitiesXml(xml, ip);
        }
        catch { }
    }
    return null;
}
async function detectDeviceCapabilities(dev) {
    const cached = capabilityCache.get(dev.id);
    if (cached && (Date.now() - cached.at) < 5 * 60_000)
        return cached.caps;
    let caps = null;
    const host = dev.hostname || "";
    let online = true;
    if (dev.driver === "virtual") {
        caps = parseNameCapabilities(dev, true);
    }
    else if (host && host !== "127.0.0.1" && host !== HOSTNAME) {
        online = await isDeviceReachable(host);
        if (online)
            caps = await fetchEsclCapabilities(host, dev.escl_port ?? null);
    }
    if (!caps) {
        caps = parseNameCapabilities(dev, online);
    }
    capabilityCache.set(dev.id, { at: Date.now(), caps });
    return caps;
}
// ══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT
// ══════════════════════════════════════════════════════════════════════════════
async function heartbeatAll(devices) {
    await mapWithConcurrency(devices, 8, async (dev) => {
        try {
            const caps = await detectDeviceCapabilities(dev);
            const client = makeDeviceClient(dev.device_key);
            await client.post("/agent/heartbeat", { capabilities: caps });
        }
        catch (e) {
            if (e?.response?.status !== 401)
                console.warn(`[heartbeat] device ${dev.id} (${dev.hostname}):`, e?.response?.status || e?.message);
        }
    });
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
        await mapWithConcurrency(devices, SCAN_CONCURRENCY, async (dev) => {
            try {
                const caps = await detectDeviceCapabilities(dev);
                if (caps.online === false)
                    return;
                const client = makeDeviceClient(dev.device_key);
                const { data } = await client.get("/agent/poll");
                if (!data.job_id)
                    return;
                const { job_id, upload_nonce, profile, personal_ref, personal_dni } = data;
                const src = data.source || "flatbed";
                const dup = !!data.duplex;
                const ip = dev.hostname || "127.0.0.1";
                console.log(`[poll] 📋 job ${job_id} → device "${dev.name}" (${ip})`);
                let pages;
                try {
                    pages = await scanDevice(ip, { ...profile, source: src, duplex: dup, escl_port: dev.escl_port || null, driver: dev.driver });
                    pages = await processScannedPages(pages, profile || null);
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
                try {
                    await uploadPagesWithRetry(dev.device_key, job_id, upload_nonce, pages);
                }
                catch (uploadErr) {
                    console.error(`[upload] job ${job_id} falló:`, uploadErr.message);
                    await client.post("/agent/fail", {
                        job_id,
                        error_message: `Upload error: ${uploadErr.message}`
                    }).catch(() => { });
                }
            }
            catch (e) {
                if (e?.response?.status !== 404) {
                    console.warn(`[poll] device ${dev.id}:`, e?.code || e?.message, e?.response?.status ? `HTTP ${e.response.status}` : "");
                }
            }
        });
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
    if (AUTO_DISCOVERY_ENABLED) {
        await discoverAndRegister();
    }
    let devices = await getDevices();
    console.log(`[agent] 🖨️  Found ${devices.length} active devices:`);
    devices.forEach(d => console.log(`[agent]    - ${d.name} (${d.hostname}) key=${d.device_key}`));
    if (!devices.length)
        console.warn("[agent] ⚠️  Sin devices — reintentando en 30s…");
    if (devices.length)
        await heartbeatAll(devices);
    // Autodiscovery cada 5 minutos + refresh de device list
    if (AUTO_DISCOVERY_ENABLED) {
        const DISCOVER_MS = Number(process.env.DISCOVER_INTERVAL_MS || 5 * 60_000);
        setInterval(async () => {
            await discoverAndRegister();
            devices = await getDevices();
            console.log(`[agent] 🔄 device list: ${devices.length} devices`);
        }, DISCOVER_MS);
    }
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
