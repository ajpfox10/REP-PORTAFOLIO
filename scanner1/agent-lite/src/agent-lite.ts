/**
 * Scanner Agent Lite v1
 *
 * Agente liviano para PCs con escáner local o USB.
 * - Se registra automáticamente en la API como dispositivo usando el hostname de la PC.
 * - Escanea usando WIA (Windows Image Acquisition) — soporta escáneres USB y WSD locales.
 * - Sube los documentos a la API del scanner.
 * - Corre en cualquier Windows de la red sin instalación: solo Node.js + .env
 */
import "dotenv/config"
import os from "os"
import fs from "fs"
import path from "path"
import http from "http"
import https from "https"
import { exec } from "child_process"
import { promisify } from "util"
import FormData from "form-data"
import axios, { type AxiosInstance } from "axios"

const execAsync = promisify(exec)

const API      = (process.env.BASE_URL         || "http://192.168.0.21:3003").replace(/\/$/, "")
const TENANT   = process.env.AGENT_TENANT_ID   || "1"
const EMAIL    = process.env.AGENT_EMAIL       || "admin@scanner.local"
const PASSWORD = process.env.AGENT_PASSWORD    || "Admin1234"
const POLL_MS  = Number(process.env.POLL_INTERVAL_MS || 4000)
const BEAT_MS  = Number(process.env.HEARTBEAT_MS     || 30000)
const HOSTNAME = os.hostname()
const AGENT_NAME = (process.env.AGENT_NAME || "").trim() || `Lite-${HOSTNAME}`

// ── Auth JWT ──────────────────────────────────────────────────────────────────
let jwt_token  = ""
let token_expires = 0

async function login(): Promise<void> {
  try {
    const res = await axios.post(`${API}/v1/auth/login`, {
      email: EMAIL, password: PASSWORD, tenant_id: Number(TENANT),
    }, { headers: { "x-tenant": TENANT, "content-type": "application/json" }, timeout: 10_000 })
    jwt_token     = res.data?.access_token || res.data?.token || ""
    token_expires = Date.now() + 7 * 60 * 60 * 1000
    if (jwt_token) console.log("[lite] ✅ login OK")
    else console.error("[lite] ❌ login sin token:", JSON.stringify(res.data))
  } catch (e: any) {
    console.error("[lite] ❌ login failed:", e?.response?.data || e?.message)
  }
}

async function ensureToken(): Promise<void> {
  if (!jwt_token || Date.now() > token_expires) await login()
}

const http_client: AxiosInstance = axios.create({ baseURL: `${API}/v1`, timeout: 30_000 })
http_client.interceptors.request.use((cfg) => {
  cfg.headers.set("x-tenant", TENANT)
  cfg.headers.set("content-type", "application/json")
  if (jwt_token) cfg.headers.set("Authorization", `Bearer ${jwt_token}`)
  return cfg
})

// ── Device registration ───────────────────────────────────────────────────────
interface RegisteredDevice {
  id: number
  device_key: string
  name: string
}

let myDevice: RegisteredDevice | null = null

async function registerSelf(): Promise<void> {
  await ensureToken()
  // Buscar si ya existe un device con nuestro hostname
  try {
    const res = await http_client.get<{ items: any[] }>("/devices?limit=100")
    const existing = (res.data.items || []).find(
      (d: any) => d.hostname === HOSTNAME || d.name === AGENT_NAME
    )
    if (existing) {
      myDevice = { id: existing.id, device_key: existing.device_key, name: existing.name }
      console.log(`[lite] ✅ Device ya registrado: "${myDevice.name}" (id=${myDevice.id})`)
      return
    }
  } catch {}

  // Crear device nuevo
  try {
    const deviceKey = `agent_lite_${HOSTNAME.toLowerCase().replace(/[^a-z0-9]/g, "_")}`
    const res = await http_client.post<{ id: number }>("/devices", {
      name:       AGENT_NAME,
      driver:     "wia",
      device_key: deviceKey,
      is_active:  true,
    })
    const id = res.data.id
    // Actualizar hostname
    await http_client.patch(`/devices/${id}`, { hostname: HOSTNAME }).catch(() => {})
    myDevice = { id, device_key: deviceKey, name: AGENT_NAME }
    console.log(`[lite] ✅ Device registrado: "${AGENT_NAME}" (id=${id})`)
  } catch (e: any) {
    console.error("[lite] ❌ No se pudo registrar device:", e?.response?.data || e?.message)
  }
}

function makeDeviceClient(): AxiosInstance {
  if (!myDevice) throw new Error("Device no registrado")
  const c = axios.create({ baseURL: `${API}/v1`, timeout: 30_000 })
  c.interceptors.request.use((cfg) => {
    cfg.headers.set("x-tenant", TENANT)
    cfg.headers.set("x-device-key", myDevice!.device_key)
    cfg.headers.set("x-agent-version", "lite-1.0.0")
    cfg.headers.set("content-type", "application/json")
    return cfg
  })
  return c
}

// ── WIA scan via PowerShell ───────────────────────────────────────────────────
// Escanea usando el primer escáner disponible en WIA (USB, WSD, o red)
async function scanWIA(opts: {
  dpi: number; color: boolean; source: string; duplex: boolean
}): Promise<Buffer[]> {
  const tmpDir = path.join(os.tmpdir(), `scan_lite_${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  const ps = `
$ErrorActionPreference = 'Stop'
$outDir = "${tmpDir.replace(/\\/g, "\\\\")}"

try {
  $wia = New-Object -ComObject WIA.DeviceManager
  $scanner = $null
  $scannerName = ""

  # Usar el primer escáner disponible (USB, WSD, o red)
  foreach ($dev in $wia.DeviceInfos) {
    if ($dev.Type -ne 1) { continue }
    try {
      $scanner = $dev.Connect()
      $scannerName = try { $dev.Properties.Item("Name").Value } catch { "Escáner desconocido" }
      Write-Host "[wia] Usando: $scannerName"
      break
    } catch {
      Write-Host "[wia] No se pudo conectar a: $($dev.Properties.Item("Name").Value) — $($_.Exception.Message)"
    }
  }

  if ($null -eq $scanner) { throw "No hay escáneres disponibles en WIA" }

  $item = $scanner.Items(1)

  # Configurar resolución
  try { $item.Properties("Horizontal Resolution").Value = ${opts.dpi} } catch {}
  try { $item.Properties("Vertical Resolution").Value   = ${opts.dpi} } catch {}

  # Color: 4=RGB, 2=grayscale
  try { $item.Properties("Current Intent").Value = ${opts.color ? 4 : 2} } catch {}

  # Fuente ADF
  ${opts.source === "adf" || opts.source === "adf_duplex" ? `
  try { $item.Properties("Document Feeder").Value = 1 } catch {}
  ` : ``}

  # Escanear
  $img = $item.Transfer("{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}")
  $outFile = Join-Path $outDir "page001.jpg"
  $img.SaveFile($outFile)
  Write-Host "SAVED:$outFile"

} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

  const psFile = path.join(tmpDir, "wia_lite.ps1")
  fs.writeFileSync(psFile, ps, "utf8")

  try {
    const { stdout, stderr } = await execAsync(
      `powershell -NonInteractive -ExecutionPolicy Bypass -File "${psFile}"`,
      { timeout: 55_000 }
    )
    console.log(`[wia] stdout: ${stdout.trim().slice(0, 200)}`)
    if (stderr.trim()) console.warn(`[wia] stderr: ${stderr.trim().slice(0, 200)}`)

    const files = fs.readdirSync(tmpDir)
      .filter(f => /\.(jpg|jpeg|png|tif|bmp)$/i.test(f))
      .sort()
      .map(f => fs.readFileSync(path.join(tmpDir, f)))

    if (!files.length) throw new Error("WIA no generó archivos")
    return files
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

// ── eSCL fallback (si hay escáner en red con eSCL) ────────────────────────────
async function scanESCLFallback(ip: string, opts: {
  dpi: number; color: boolean; source: string
}): Promise<Buffer[]> {
  const candidates = [
    { proto: "http",  port: 80 },
    { proto: "http",  port: 8080 },
    { proto: "https", port: 443 },
    { proto: "http",  port: 9090 },
    { proto: "http",  port: 9280 },
  ]

  let base: string | null = null
  for (const c of candidates) {
    try {
      await httpGet(`${c.proto}://${ip}:${c.port}/eSCL/ScannerCapabilities`, 2000)
      base = `${c.proto}://${ip}:${c.port}`
      break
    } catch {}
  }
  if (!base) throw new Error(`eSCL no disponible en ${ip}`)

  const inputSource = opts.source === "adf" ? "Feeder" : "Platen"
  const colorMode   = opts.color ? "RGB24" : "Grayscale8"
  const dpi = opts.dpi || 300
  const w   = Math.round(dpi * (210 / 25.4))
  const h   = Math.round(dpi * (297 / 25.4))

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
</scan:ScanSettings>`

  const jobLocation = await httpPost(`${base}/eSCL/ScanJobs`, xml, "text/xml", 15_000)
  if (!jobLocation) throw new Error("eSCL: sin Location")

  const pages: Buffer[] = []
  const fullJobUrl = jobLocation.startsWith("http") ? jobLocation : `${base}${jobLocation}`

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const pageData = await httpGetBinary(`${fullJobUrl}/NextDocument`, 30_000)
      if (!pageData || pageData.length < 100) break
      pages.push(pageData)
    } catch (e: any) {
      if (e?.message?.includes("404") || e?.message?.includes("503")) break
      throw e
    }
  }
  httpDelete(fullJobUrl).catch(() => {})
  if (!pages.length) throw new Error("eSCL: sin páginas")
  return pages
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadPages(jobId: number, nonce: string, pages: Buffer[]): Promise<void> {
  if (!myDevice) return
  await ensureToken()
  const form = new FormData()
  form.append("nonce", nonce)
  for (let i = 0; i < pages.length; i++) {
    form.append("pages", pages[i], {
      filename: `page${String(i + 1).padStart(3, "0")}.jpg`,
      contentType: "image/jpeg",
    })
  }
  await axios.post(`${API}/v1/scan-jobs/${jobId}/upload`, form, {
    headers: {
      ...form.getHeaders(),
      "Authorization": `Bearer ${jwt_token}`,
      "x-tenant": TENANT,
      "x-device-key": myDevice.device_key,
    },
    timeout: 120_000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  })
  console.log(`[lite] ✅ job ${jobId} → ${pages.length} pág. subidas`)
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
async function heartbeat(): Promise<void> {
  if (!myDevice) return
  try {
    const client = makeDeviceClient()
    await client.post("/agent/heartbeat", {
      capabilities: {
        model: AGENT_NAME,
        manufacturer: "Agent Lite",
        sources: ["flatbed", "adf"],
        resolutions: [150, 300, 600],
        paper_sizes: ["A4", "Carta", "Oficio"],
        color_modes: ["color", "gris"],
        duplex: false,
        max_pages_adf: 50,
        online: true,
        agent_type: "lite",
        pc_hostname: HOSTNAME,
      },
    })
  } catch (e: any) {
    if (e?.response?.status !== 401)
      console.warn("[lite] heartbeat error:", e?.response?.status || e?.message)
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
let polling = false

async function poll(): Promise<void> {
  if (!myDevice || polling) return
  polling = true
  try {
    const client = makeDeviceClient()
    const { data } = await client.get<{
      job_id: number | null
      upload_nonce?: string
      profile?: { dpi: number; color: boolean; auto_rotate: boolean } | null
      source?: string
      duplex?: boolean
    }>("/agent/poll")

    if (!data.job_id) return

    const { job_id, upload_nonce, profile } = data
    const src = data.source || "flatbed"
    const dup = !!data.duplex
    const dpi   = profile?.dpi   ?? 300
    const color = profile?.color !== false

    console.log(`[lite] 📋 job ${job_id} recibido — escaneando…`)

    let pages: Buffer[]
    try {
      pages = await scanWIA({ dpi, color, source: src, duplex: dup })
      console.log(`[lite] ✅ WIA → ${pages.length} pág.`)
    } catch (e: any) {
      console.error(`[lite] ❌ scan falló: ${e.message}`)
      await client.post("/agent/fail", {
        job_id,
        error_message: `WIA error: ${e.message}`,
      }).catch(() => {})
      return
    }

    if (!upload_nonce || upload_nonce === "null") {
      console.error(`[lite] ❌ nonce inválido para job ${job_id}`)
      return
    }
    await uploadPages(job_id, upload_nonce, pages)
  } catch (e: any) {
    if (e?.response?.status !== 404) {
      console.warn("[lite] poll error:", e?.code || e?.message,
        e?.response?.status ? `HTTP ${e.response.status}` : "")
    }
  } finally {
    polling = false
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpGet(url: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === "https:" ? https : http
    const req = (mod as any).get(url, { timeout: timeoutMs, rejectUnauthorized: false }, (res: any) => {
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return }
      let data = ""
      res.on("data", (c: any) => data += c)
      res.on("end", () => resolve(data))
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.end()
  })
}

function httpGetBinary(url: string, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === "https:" ? https : http
    const req = (mod as any).get(url, { timeout: timeoutMs, rejectUnauthorized: false }, (res: any) => {
      if (res.statusCode === 404 || res.statusCode === 503) {
        reject(new Error(`HTTP ${res.statusCode}`)); return
      }
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return }
      const chunks: Buffer[] = []
      res.on("data", (c: any) => chunks.push(c))
      res.on("end", () => resolve(Buffer.concat(chunks)))
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.end()
  })
}

function httpPost(url: string, body: string, contentType: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === "https:" ? https : http
    const bodyBuf = Buffer.from(body, "utf8")
    const req = (mod as any).request({
      hostname: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname,
      method: "POST",
      headers: { "Content-Type": contentType, "Content-Length": bodyBuf.length },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    }, (res: any) => {
      if (res.statusCode === 201 || res.statusCode === 200) {
        const loc = res.headers?.["location"] || ""
        resolve(loc); res.resume()
      } else {
        let d = ""
        res.on("data", (c: any) => d += c)
        res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`)))
      }
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(bodyBuf)
    req.end()
  })
}

function httpDelete(url: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url)
      const mod = parsed.protocol === "https:" ? https : http
      const req = (mod as any).request({
        hostname: parsed.hostname,
        port: Number(parsed.port) || 80,
        path: parsed.pathname,
        method: "DELETE",
        rejectUnauthorized: false,
        timeout: 5000,
      }, () => resolve())
      req.on("error", () => resolve())
      req.end()
    } catch { resolve() }
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[lite] 🚀 Scanner Agent Lite v1.0 arrancando`)
  console.log(`[lite]    API:      ${API}`)
  console.log(`[lite]    Nombre:   ${AGENT_NAME}`)
  console.log(`[lite]    Hostname: ${HOSTNAME}`)

  await login()
  if (!jwt_token) {
    console.error("[lite] ❌ Login fallido, reintentando en 15s…")
    setTimeout(() => main(), 15_000)
    return
  }

  await registerSelf()
  if (!myDevice) {
    console.error("[lite] ❌ No se pudo registrar, reintentando en 30s…")
    setTimeout(() => main(), 30_000)
    return
  }

  await heartbeat()

  setInterval(heartbeat, BEAT_MS)
  setInterval(poll, POLL_MS)

  console.log(`[lite] ✅ Listo — escuchando jobs para "${AGENT_NAME}"`)
}

process.on("SIGTERM", () => { console.log("[lite] 🛑 Stopping…"); process.exit(0) })
process.on("SIGINT",  () => process.exit(0))

main().catch(e => { console.error("[lite] Startup error:", e); process.exit(1) })
