/**
 * Scanner Agent v3 — MULTI-DEVICE
 * Un solo proceso maneja TODOS los escáneres de red (Kyocera, Olivetti, HP, Ricoh, etc.)
 *
 * Flujo:
 *   1. Al iniciar → obtiene lista de devices del API
 *   2. Heartbeat cada 30s → actualiza last_seen_at de todos los devices online
 *   3. Poll cada 5s → busca jobs pendientes de CUALQUIER device
 *   4. Por cada job → escanea via IPP/WSD a la IP del device → sube páginas
 */
import "dotenv/config";
import os from "os";
import fs from "fs";
import path from "path";
import http from "http";
import { exec } from "child_process";
import { promisify } from "util";
import FormData from "form-data";
import axios from "axios";
const execAsync = promisify(exec);
// Re-export explícito para evitar problemas de scope en ESM con tsx
const _execAsync = execAsync;
const API = (process.env.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const TENANT = process.env.AGENT_TENANT_ID || "1";
const EMAIL = process.env.AGENT_EMAIL || "admin@local.com";
const PASSWORD = process.env.AGENT_PASSWORD || "Admin12345@";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 4000);
const BEAT_MS = Number(process.env.HEARTBEAT_MS || 30000);
const HOSTNAME = os.hostname();
// ── HTTP client (usa JWT Bearer para endpoints de usuario) ───────────────────
let jwt_token = "";
let token_expires = 0;
async function login() {
    try {
        const res = await axios.post(`${API}/v1/auth/login`, {
            email: EMAIL,
            password: PASSWORD,
            tenant_id: Number(TENANT),
        }, {
            headers: { "x-tenant": TENANT, "content-type": "application/json" },
            timeout: 10_000,
        });
        jwt_token = res.data?.access_token || res.data?.token || "";
        token_expires = Date.now() + 7 * 60 * 60 * 1000; // reloguear cada 7h
        if (jwt_token) {
            console.log("[agent] ✅ login OK");
        }
        else {
            console.error("[agent] ❌ login returned no token, response:", JSON.stringify(res.data));
        }
    }
    catch (e) {
        console.error("[agent] ❌ login failed:", e?.response?.data || e?.message);
    }
}
async function ensureToken() {
    if (!jwt_token || Date.now() > token_expires)
        await login();
}
const http_client = axios.create({
    baseURL: `${API}/v1`,
    timeout: 30_000,
});
http_client.interceptors.request.use((cfg) => {
    cfg.headers.set("x-tenant", TENANT);
    cfg.headers.set("content-type", "application/json");
    if (jwt_token)
        cfg.headers.set("Authorization", `Bearer ${jwt_token}`);
    return cfg;
});
// ── Client para endpoints de agente (usa device-key) ────────────────────────
function makeDeviceClient(deviceKey) {
    const c = axios.create({ baseURL: `${API}/v1`, timeout: 60_000 });
    c.interceptors.request.use((cfg) => {
        cfg.headers.set("x-tenant", TENANT);
        cfg.headers.set("x-device-key", deviceKey);
        cfg.headers.set("x-agent-version", "3.1.0-multi");
        cfg.headers.set("content-type", "application/json");
        // NO enviamos x-agent-hostname para no sobreescribir la IP del escáner en la BD
        return cfg;
    });
    return c;
}
// ── Obtener lista de devices activos ─────────────────────────────────────────
async function getDevices() {
    try {
        await ensureToken();
        const res = await http_client.get("/devices?limit=100");
        return (res.data.items || []).filter(d => d.is_active && d.hostname);
    }
    catch (e) {
        if (e?.response?.status === 401) {
            jwt_token = "";
            console.warn("[agent] getDevices 401 — token expired, will re-login next cycle");
        }
        else {
            console.warn("[agent] getDevices error:", e?.message);
        }
        return [];
    }
}
// ══════════════════════════════════════════════════════════════════════════════
// DRIVER IPP — manda el trabajo al escáner de red via IPP (puerto 631)
// Compatible con Kyocera, Olivetti, HP, Ricoh, Brother, Xerox
// ══════════════════════════════════════════════════════════════════════════════
async function scanIPP(ip, profile) {
    const dpi = profile?.dpi || 300;
    const color = profile?.color !== false;
    const source = profile?.source || "flatbed";
    console.log(`[ipp] scanning ${ip} dpi=${dpi} color=${color} source=${source}`);
    // Intentar con WSD (Windows Scan Service) si está disponible — más compatible con Kyocera
    if (process.platform === "win32") {
        try {
            return await scanWSD_Windows(ip, profile);
        }
        catch (e) {
            console.warn(`[ipp] WSD failed for ${ip}, trying IPP:`, e.message);
        }
    }
    // Fallback: IPP scan via HTTP POST al puerto 631
    return await scanViaIPP(ip, dpi, color, source);
}
// WSD scan via PowerShell (Windows Image Acquisition)
async function scanWSD_Windows(ip, profile) {
    const dpi = profile?.dpi || 300;
    const color = profile?.color !== false;
    const tmpDir = path.join(os.tmpdir(), `scan_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const ps = `
$ErrorActionPreference = 'Stop'
try {
  # Buscar el escáner por IP en WIA
  $wia = New-Object -ComObject WIA.DeviceManager
  $scanner = $null
  foreach ($dev in $wia.DeviceInfos) {
    $props = @{}
    foreach ($p in $dev.Properties) { $props[$p.Name] = $p.Value }
    $name = $props['Name'] + '' + $props['Description'] + ''
    if ($name -match '${ip.replace(/\./g, "\\.")}' -or $props['Network Address'] -eq '${ip}') {
      $scanner = $dev.Connect()
      break
    }
  }
  # Si no encontró por IP, usar el primero disponible (modo servidor)
  if ($null -eq $scanner -and $wia.DeviceInfos.Count -gt 0) {
    $scanner = $wia.DeviceInfos.Item(1).Connect()
  }
  if ($null -eq $scanner) { throw "No scanner found" }

  $item = $scanner.Items(1)
  $item.Properties("Horizontal Resolution").Value = ${dpi}
  $item.Properties("Vertical Resolution").Value   = ${dpi}
  $item.Properties("Current Intent").Value        = ${color ? 4 : 2}

  $img = $item.Transfer("{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}")
  $outPath = "${tmpDir.replace(/\\/g, "\\\\")}\\\\page001.jpg"
  $img.SaveFile($outPath)
  Write-Output "OK:$outPath"
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim();
    const psFile = path.join(tmpDir, "wsd_scan.ps1");
    fs.writeFileSync(psFile, ps, "utf8");
    try {
        const { stdout } = await _execAsync(`powershell -NonInteractive -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 120_000 });
        const files = fs.readdirSync(tmpDir)
            .filter(f => /\.(jpg|png|tif|bmp)$/i.test(f))
            .sort()
            .map(f => fs.readFileSync(path.join(tmpDir, f)));
        if (!files.length)
            throw new Error("WIA produced no output");
        console.log(`[wsd] ${ip} → ${files.length} page(s) via WIA`);
        return files;
    }
    finally {
        try {
            fs.rmSync(tmpDir, { recursive: true });
        }
        catch { }
    }
}
// IPP scan via protocolo HTTP (RFC 2911)
async function scanViaIPP(ip, dpi, color, source) {
    // IPP scan request
    const ippBody = buildIppScanRequest(dpi, color, source);
    return new Promise((resolve, reject) => {
        const options = {
            hostname: ip,
            port: 631,
            path: "/ipp/scan",
            method: "POST",
            headers: {
                "Content-Type": "application/ipp",
                "Content-Length": ippBody.length,
            },
            timeout: 60000,
        };
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const data = Buffer.concat(chunks);
                if (res.statusCode !== 200) {
                    return reject(new Error(`IPP HTTP ${res.statusCode}`));
                }
                // El response IPP contiene los datos de la imagen
                const image = extractIppDocument(data);
                if (!image || image.length < 100) {
                    return reject(new Error("IPP response had no document data"));
                }
                console.log(`[ipp] ${ip} → 1 page (${image.length} bytes)`);
                resolve([image]);
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("IPP timeout")); });
        req.write(ippBody);
        req.end();
    });
}
// Construye un IPP Scan request mínimo (operation-id=0x003B = Scan-Job)
function buildIppScanRequest(dpi, color, source) {
    const colorSpace = color ? 5 : 1; // 5=sRGB, 1=grayscale
    const ippSource = source === "adf" ? "feeder" : "flatbed";
    // IPP binary protocol — version 2.0
    const parts = [
        // version
        0x02, 0x00,
        // operation: Create-Job (0x0005) — some scanners use this
        0x00, 0x05,
        // request-id
        0x00, 0x00, 0x00, 0x01,
        // begin-attribute-group: operation-attributes-tag
        0x01,
        // attributes-charset
        0x47, 0x00, 0x12, ...strBytes("attributes-charset"),
        0x00, 0x05, ...strBytes("utf-8"),
        // attributes-natural-language
        0x48, 0x00, 0x1B, ...strBytes("attributes-natural-language"),
        0x00, 0x05, ...strBytes("es-ar"),
        // printer-uri
        0x45, 0x00, 0x0B, ...strBytes("printer-uri"),
        ...ippUri(`ipp://${source === "adf" ? "feeder" : "scanner"}`),
        // end
        0x03,
    ];
    return Buffer.from(parts);
}
function strBytes(s) {
    return [...Buffer.from(s, "utf8")];
}
function ippUri(uri) {
    const b = Buffer.from(uri, "utf8");
    return [0x00, b.length, ...b];
}
// Extrae el documento del response IPP (busca el payload tras los atributos)
function extractIppDocument(data) {
    // Buscar inicio de JPEG (FF D8) o PNG (89 50 4E 47)
    for (let i = 0; i < data.length - 4; i++) {
        if ((data[i] === 0xFF && data[i + 1] === 0xD8) ||
            (data[i] === 0x89 && data[i + 1] === 0x50)) {
            return data.slice(i);
        }
    }
    return null;
}
// ── Fallback: virtual scan (para testing) ────────────────────────────────────
function scanVirtual() {
    const PNG_1X1 = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de" +
        "0000000c4944415408d76360f8cfc00000000200016b60b8160000000049454e44ae426082", "hex");
    return [PNG_1X1];
}
// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD
// ══════════════════════════════════════════════════════════════════════════════
async function uploadPages(_deviceKey, jobId, nonce, pages) {
    // Upload usa JWT Bearer (ruta protegida), no device-key
    await ensureToken();
    const form = new FormData();
    form.append("nonce", nonce);
    for (let i = 0; i < pages.length; i++) {
        form.append("pages", pages[i], {
            filename: `page${String(i + 1).padStart(3, "0")}.png`,
            contentType: "image/png",
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
    console.log(`[agent] ✅ job ${jobId} → uploaded ${pages.length} page(s)`);
}
// ══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT — actualiza last_seen_at de todos los devices
// ══════════════════════════════════════════════════════════════════════════════
async function heartbeatAll(devices) {
    const caps = {
        model: "Multi-Device Agent",
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
            if (e?.response?.status !== 401) {
                console.warn(`[heartbeat] device ${dev.id} (${dev.hostname}):`, e?.response?.status || e?.message);
            }
        }
    }));
    console.log(`[heartbeat] ✅ ${devices.length} devices updated`);
}
// ══════════════════════════════════════════════════════════════════════════════
// POLL — busca jobs en TODOS los devices en paralelo
// ══════════════════════════════════════════════════════════════════════════════
let polling = false;
async function pollAll(devices) {
    if (polling || !devices.length)
        return;
    polling = true;
    try {
        // Buscar jobs en todos los devices en paralelo
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
                    if (!ip || ip === "127.0.0.1" || ip === HOSTNAME) {
                        // device local → WIA
                        pages = await scanWSD_Windows(ip, { ...profile, source: src, duplex: dup });
                    }
                    else {
                        // device de red → IPP/WSD
                        pages = await scanIPP(ip, { ...profile, source: src, duplex: dup });
                    }
                }
                catch (scanErr) {
                    console.error(`[scan] ❌ job ${job_id} scan failed:`, scanErr.message);
                    await client.post("/agent/fail", {
                        job_id,
                        error_message: `Scan error: ${scanErr.message}`
                    }).catch(() => { });
                    return;
                }
                console.log(`[poll] nonce recibido:`, upload_nonce, typeof upload_nonce);
                if (!upload_nonce || upload_nonce === "null") {
                    console.error(`[poll] ❌ nonce inválido`);
                    return;
                }
                await uploadPages(dev.device_key, job_id, upload_nonce, pages);
            }
            catch (e) {
                if (e?.response?.status !== 404) {
                    console.warn(`[poll] device ${dev.id}:`, e?.code || e?.message, e?.response?.status ? `HTTP ${e.response.status}` : "", e?.response?.data ? JSON.stringify(e.response.data) : "");
                }
            }
        }));
    }
    finally {
        polling = false;
    }
}
// ══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
    console.log(`[agent] 🚀 Multi-Device Scanner Agent v3.1 starting`);
    console.log(`[agent]    API:      ${API}`);
    console.log(`[agent]    Tenant:   ${TENANT}`);
    console.log(`[agent]    Hostname: ${HOSTNAME}`);
    // Primer login
    await login();
    if (!jwt_token) {
        console.error("[agent] ❌ Could not login, retrying in 10s...");
        setTimeout(() => main(), 10_000);
        return;
    }
    // Obtener devices
    let devices = await getDevices();
    console.log(`[agent] 🖨️  Found ${devices.length} active devices:`);
    devices.forEach(d => console.log(`[agent]    - ${d.name} (${d.hostname}) key=${d.device_key}`));
    if (!devices.length) {
        console.warn("[agent] ⚠️  No devices found — retrying in 30s...");
    }
    // Primer heartbeat
    if (devices.length)
        await heartbeatAll(devices);
    // Refrescar lista de devices cada 60s (por si se agregan nuevos)
    setInterval(async () => {
        devices = await getDevices();
        console.log(`[agent] 🔄 refreshed device list: ${devices.length} devices`);
    }, 60_000);
    // Heartbeat de todos los devices
    setInterval(() => heartbeatAll(devices), BEAT_MS);
    // Poll de jobs
    setInterval(() => pollAll(devices), POLL_MS);
}
process.on("SIGTERM", () => { console.log("[agent] 🛑 Stopping..."); process.exit(0); });
process.on("SIGINT", () => process.exit(0));
main().catch(e => { console.error("[agent] Startup error:", e); process.exit(1); });
