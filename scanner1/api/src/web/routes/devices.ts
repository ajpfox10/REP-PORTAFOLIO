// routes/devices.ts — Dispositivos + capacidades + descubrimiento en red
import { Router } from "express"
import { exec } from "child_process"
import { promisify } from "util"
import dgram from "dgram"
import net from "net"
import os from "os"
import http from "http"
import https from "https"
import { validate } from "../validate.js"
import { createDeviceSchema, paginationSchema } from "../../shared/index.js"
import { pool } from "../../db/mysql.js"
import { ApiError } from "../errorHandler.js"

const r = Router()
const execAsync = promisify(exec)

type DiscoveredDevice = {
  ip: string
  hostname: string
  name: string
  driver: "wia" | "twain" | "virtual"
  protocol: "wsd" | "mdns" | "snmp" | "wia" | "twain" | "tcp" | "manual"
  source?: "network" | "local" | "manual"
  manufacturer?: string | null
  model?: string | null
  online?: boolean
  confidence?: number
  raw?: any
}

type DiscoverMethod = "wsd" | "mdns" | "snmp" | "wia" | "twain" | "probe"

// ── GET /v1/devices ───────────────────────────────────────────────────────────
r.get("/", validate(paginationSchema, "query"), async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const { limit, cursor } = req.query as any
  const [rows] = await pool.query(
    "SELECT id,name,driver,device_key,is_active,hostname,agent_version,last_seen_at,created_at FROM devices WHERE tenant_id=? AND id>? ORDER BY id ASC LIMIT ?",
    [tenant_id, cursor, limit]
  )
  const rows_ = rows as any[]
  const items = await Promise.all(rows_.map(async (dev: any) => ({
    ...dev,
    online: await isOnline(dev.last_seen_at, dev.hostname),
  })))
  res.json({ items, next_cursor: items.at(-1)?.id || cursor })
})

// ── GET /v1/devices/:id ───────────────────────────────────────────────────────
r.get("/:id", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const [rows] = await pool.query(
    "SELECT * FROM devices WHERE tenant_id=? AND id=?", [tenant_id, Number(req.params.id)]
  )
  const dev = (rows as any[])[0]
  if (!dev) throw new ApiError(404, "device_not_found")
  res.json(dev)
})

// ── GET /v1/devices/:id/capabilities ─────────────────────────────────────────
r.get("/:id/capabilities", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const id = Number(req.params.id)
  const [rows] = await pool.query(
    "SELECT id, hostname, driver, last_seen_at FROM devices WHERE tenant_id=? AND id=?",
    [tenant_id, id]
  )
  const dev = (rows as any[])[0]
  if (!dev) throw new ApiError(404, "device_not_found")
  const [capRows] = await pool.query(
    "SELECT capabilities_json FROM device_capabilities WHERE device_id=?", [id]
  ).catch(() => [[]] as any)
  const stored = (capRows as any[])[0]
  const online = await isOnline(dev.last_seen_at, dev.hostname)
  if (stored?.capabilities_json) {
    try {
      const caps = typeof stored.capabilities_json === "string"
        ? JSON.parse(stored.capabilities_json)
        : stored.capabilities_json
      return res.json({ ...caps, online })
    } catch {}
  }
  res.json(defaultCapabilities(dev.driver, online))
})

// ── POST /v1/devices ──────────────────────────────────────────────────────────
r.post("/", validate(createDeviceSchema, "body"), async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const b = req.body as any
  const [result] = await pool.query(
    "INSERT INTO devices (tenant_id,name,driver,device_key,is_active,created_at) VALUES (?,?,?,?,?,now())",
    [tenant_id, b.name, b.driver, b.device_key, b.is_active ? 1 : 0]
  )
  const id = Number((result as any).insertId)
  if (!id) throw new ApiError(500, "device_create_failed")
  res.status(201).json({ id })
})

// ── PATCH /v1/devices/:id ─────────────────────────────────────────────────────
r.patch("/:id", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const id = Number(req.params.id)
  const { name, is_active } = req.body || {}
  await pool.query(
    "UPDATE devices SET name=COALESCE(?,name), is_active=COALESCE(?,is_active), updated_at=now() WHERE tenant_id=? AND id=?",
    [name ?? null, is_active != null ? (is_active ? 1 : 0) : null, tenant_id, id]
  )
  res.json({ ok: true })
})

// ── GET /v1/devices/:id/ping ──────────────────────────────────────────────────
r.get("/:id/ping", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const id = Number(req.params.id)
  const [rows] = await pool.query(
    "SELECT hostname, last_seen_at FROM devices WHERE tenant_id=? AND id=?",
    [tenant_id, id]
  )
  const dev = (rows as any[])[0]
  if (!dev) throw new ApiError(404, "device_not_found")
  const byHeartbeat = isOnlineByHeartbeat(dev.last_seen_at)
  const byNetwork = await isOnlineByNetwork(dev.hostname)
  const online = byHeartbeat || byNetwork
  if (byNetwork && !byHeartbeat) {
    await pool.query("UPDATE devices SET last_seen_at=now() WHERE id=?", [id]).catch(() => {})
  }
  res.json({ online, method: byHeartbeat ? "heartbeat" : byNetwork ? "network" : "none" })
})

// ── DELETE /v1/devices/:id ────────────────────────────────────────────────────
r.delete("/:id", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  await pool.query("DELETE FROM devices WHERE tenant_id=? AND id=?", [tenant_id, Number(req.params.id)])
  res.json({ ok: true })
})

// ── POST /v1/devices/discover ─────────────────────────────────────────────────
r.post("/discover", async (req, res) => {
  const tenant_id = (req as any).tenant_id as number
  const body = (req.body || {}) as any
  const methods = normalizeMethods(body?.methods)
  const rangeBase = typeof body?.range_base === "string" ? body.range_base.trim() : undefined
  const manualIps = Array.isArray(body?.ips) ? body.ips.filter((x: any) => typeof x === "string" && x.trim()) : []

  const { devices, diagnostics } = await discoverAll({ methods, rangeBase, ips: manualIps })
  const found = dedupeDevices(devices)

  const newDevices: any[] = []
  const updatedDevices: any[] = []
  for (const dev of found) {
    const key = buildDeviceKey(dev)
    const hostname = dev.hostname || dev.ip || null
    const [existing] = await pool.query(
      "SELECT id FROM devices WHERE tenant_id=? AND (device_key=? OR hostname=? OR (hostname IS NULL AND name=?))",
      [tenant_id, key, hostname, dev.name]
    )
    const existingRows = existing as any[]
    if (existingRows.length) {
      const existingId = existingRows[0].id
      await pool.query(
        "UPDATE devices SET hostname=COALESCE(?,hostname), name=COALESCE(?,name), updated_at=now() WHERE id=?",
        [hostname, dev.name || null, existingId]
      ).catch(() => {})
      updatedDevices.push({ id: existingId, ...dev })
      continue
    }
    const [result] = await pool.query(
      "INSERT INTO devices (tenant_id,name,driver,device_key,is_active,hostname,created_at) VALUES (?,?,?,?,1,?,now())",
      [tenant_id, dev.name || dev.ip || "Device", dev.driver || "wia", key, hostname]
    )
    newDevices.push({ id: Number((result as any).insertId), ...dev })
  }

  res.json({ devices: found, registered: newDevices.length, updated: updatedDevices.length, diagnostics })
})

// ── POST /v1/devices/probe-ip ─────────────────────────────────────────────────
r.post("/probe-ip", async (req, res) => {
  const ip = String(req.body?.ip || "").trim()
  if (!ip) throw new ApiError(400, "ip_required", "Debe enviar body.ip")
  const { devices, diagnostics } = await discoverAll({ methods: ["wsd", "mdns", "snmp", "probe"], ips: [ip] })
  res.json({ ip, devices: dedupeDevices(devices), diagnostics })
})

// ── POST /v1/devices/discover-local ──────────────────────────────────────────
r.post("/discover-local", async (_req, res) => {
  const [wia, twain] = await Promise.allSettled([discoverLocalWIA(), discoverLocalTWAIN()])
  const devices = dedupeDevices([
    ...(wia.status === "fulfilled" ? wia.value : []),
    ...(twain.status === "fulfilled" ? twain.value : []),
  ])
  res.json({
    devices,
    diagnostics: {
      wia: wia.status === "fulfilled" ? { ok: true, count: wia.value.length } : { ok: false, error: String((wia as any).reason?.message || (wia as any).reason) },
      twain: twain.status === "fulfilled" ? { ok: true, count: twain.value.length } : { ok: false, error: String((twain as any).reason?.message || (twain as any).reason) },
    },
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOnlineByHeartbeat(lastSeen: string | null): boolean {
  if (!lastSeen) return false
  return (Date.now() - new Date(lastSeen).getTime()) < 90_000
}

function checkTcpPort(ip: string, port: number, timeout = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: ip, port })
    let done = false
    const finish = (value: boolean) => {
      if (done) return
      done = true
      s.destroy()
      resolve(value)
    }
    s.setTimeout(timeout)
    s.on("connect", () => finish(true))
    s.on("error", () => finish(false))
    s.on("timeout", () => finish(false))
  })
}

// ICMP ping using OS ping.exe — no packages needed
function pingICMP(ip: string): Promise<boolean> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32"
    const cmd = isWin ? `ping -n 1 -w 1000 ${ip}` : `ping -c 1 -W 1 ${ip}`
    const proc = exec(cmd, { timeout: 3000 })
    let out = ""
    proc.stdout?.on("data", (d: string) => { out += d })
    proc.on("close", (code: number) => {
      const alive = code === 0 && /TTL=/i.test(out)
      console.log(`[ping] ${ip} code=${code} TTL=${/TTL=/i.test(out)} => ${alive}`)
      resolve(alive)
    })
    proc.on("error", (e) => { console.log(`[ping] ${ip} error: ${e.message}`); resolve(false) })
  })
}

// WSD UDP probe to port 3702
function probeWsdUdp(ip: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4")
    let done = false
    const finish = (v: boolean) => {
      if (done) return; done = true
      try { sock.close() } catch {}
      resolve(v)
    }
    const probe = buildWsDiscoveryProbe()
    sock.on("message", () => finish(true))
    sock.on("error", () => finish(false))
    sock.bind(0, () => { sock.send(probe, 3702, ip, (err) => { if (err) finish(false) }) })
    setTimeout(() => finish(false), 1500)
  })
}

// Network-based online check — ping + TCP (all manufacturer ports) + WSD UDP
async function isOnlineByNetwork(hostname: string | null): Promise<boolean> {
  if (!hostname || hostname === "127.0.0.1") return false
  console.log(`[online] checking ${hostname}`)

  const icmpResult = pingICMP(hostname)

  // All major scanner/MFP TCP ports:
  // 5357 = WSD-HTTP (Kyocera, Olivetti, Canon, Ricoh, Brother, Xerox, Konica Minolta)
  // 5358 = WSD-HTTPS
  // 80/443 = web panel (universal)
  // 631 = IPP (HP, Brother, Epson, Canon, Ricoh, Xerox)
  // 9100 = RAW print (HP JetDirect, Brother, Kyocera, Ricoh)
  // 515 = LPD/LPR
  // 8080/8443 = alt web panel (Ricoh, Konica Minolta, Sharp, Toshiba)
  // 9090 = Kyocera status monitor
  // 9280 = HP scan EWS
  // 8000 = alt HTTP (Epson, Canon)
  const tcpPorts = [5357, 80, 443, 631, 9100, 515, 5358, 8080, 8443, 9090, 9280, 8000]
  const tcpResult = Promise.all(tcpPorts.map((p) => checkTcpPort(hostname, p, 2000)))
    .then((r) => {
      const open = tcpPorts.filter((_, i) => r[i])
      console.log(`[tcp] ${hostname} open ports: ${open.length ? open.join(",") : "none"}`)
      return r.some(Boolean)
    })

  const wsdResult = probeWsdUdp(hostname).then(r => { console.log(`[wsd-udp] ${hostname} => ${r}`); return r })

  return new Promise<boolean>((resolve) => {
    let resolved = false
    const done = (v: boolean) => { if (!resolved && v) { resolved = true; resolve(true) } }
    icmpResult.then(done)
    tcpResult.then(done)
    wsdResult.then(done)
    setTimeout(() => { if (!resolved) { resolved = true; console.log(`[online] ${hostname} => OFFLINE (timeout)`); resolve(false) } }, 4000)
  })
}

async function isOnline(lastSeen: string | null, hostname: string | null): Promise<boolean> {
  if (isOnlineByHeartbeat(lastSeen)) return true
  return isOnlineByNetwork(hostname)
}

function defaultCapabilities(driver: string, online: boolean) {
  return {
    online,
    model: null,
    manufacturer: null,
    sources: driver === "virtual" ? ["flatbed"] : ["flatbed", "adf"],
    resolutions: [150, 300, 600],
    paper_sizes: ["A4", "Carta", "Oficio"],
    color_modes: ["color", "gris"],
    duplex: driver !== "virtual",
    max_pages_adf: driver === "virtual" ? null : 50,
  }
}

function normalizeMethods(raw: any): DiscoverMethod[] {
  const allowed: DiscoverMethod[] = ["wsd", "mdns", "snmp", "wia", "twain", "probe"]
  if (!Array.isArray(raw) || !raw.length) return allowed
  const set = new Set<string>(raw.map((x) => String(x).toLowerCase()))
  return allowed.filter((m) => set.has(m))
}

function buildDeviceKey(dev: DiscoveredDevice): string {
  const proto = dev.protocol || "manual"
  const hostish = (dev.ip || dev.hostname || dev.name || "device").replace(/[^a-zA-Z0-9]+/g, "_")
  return `discovered_${proto}_${hostish}`.toLowerCase()
}

function dedupeDevices(items: DiscoveredDevice[]): DiscoveredDevice[] {
  const map = new Map<string, DiscoveredDevice>()
  for (const item of items) {
    const key = (item.ip || item.hostname || item.name).toLowerCase()
    const prev = map.get(key)
    if (!prev) { map.set(key, item); continue }
    map.set(key, mergeDevices(prev, item))
  }
  return [...map.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || a.name.localeCompare(b.name))
}

function mergeDevices(a: DiscoveredDevice, b: DiscoveredDevice): DiscoveredDevice {
  return {
    ...a, ...b,
    name: chooseBetter(a.name, b.name),
    hostname: chooseBetter(a.hostname, b.hostname),
    manufacturer: chooseBetter(a.manufacturer || undefined, b.manufacturer || undefined) || null,
    model: chooseBetter(a.model || undefined, b.model || undefined) || null,
    confidence: Math.max(a.confidence || 0, b.confidence || 0),
    raw: { ...(a.raw || {}), ...(b.raw || {}) },
  }
}

function chooseBetter(a?: string | null, b?: string | null): string {
  const aa = String(a || "").trim()
  const bb = String(b || "").trim()
  if (!aa) return bb
  if (!bb) return aa
  return bb.length > aa.length ? bb : aa
}

function getLocalIPv4Bases(): string[] {
  const out = new Set<string>()
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const addr of list || []) {
      if (addr.family !== "IPv4" || addr.internal) continue
      const parts = addr.address.split(".")
      if (parts.length === 4) out.add(parts.slice(0, 3).join("."))
    }
  }
  return [...out]
}

function getLocalIPv4Addresses(): string[] {
  const out: string[] = []
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const addr of list || []) {
      if (addr.family !== "IPv4" || addr.internal) continue
      out.push(addr.address)
    }
  }
  return out
}

async function discoverAll(opts: { methods: DiscoverMethod[]; rangeBase?: string; ips?: string[] }) {
  const devices: DiscoveredDevice[] = []
  const diagnostics: Record<string, any> = {}
  const promises: Promise<void>[] = []

  if (opts.methods.includes("wsd")) {
    promises.push((async () => {
      try {
        const list = await discoverWSD(opts.ips)
        devices.push(...list)
        diagnostics.wsd = { ok: true, count: list.length }
        console.log(`[discover] WSD found ${list.length}:`, list.map(d => `${d.name}@${d.ip}`))
      } catch (e: any) {
        diagnostics.wsd = { ok: false, error: String(e?.message || e) }
        console.warn("[discover] WSD error", e?.message || e)
      }
    })())
  }

  if (opts.methods.includes("mdns")) {
    promises.push((async () => {
      try {
        const list = await discoverMDNS()
        devices.push(...list)
        diagnostics.mdns = { ok: true, count: list.length }
        console.log(`[discover] mDNS found ${list.length}:`, list.map(d => `${d.name}@${d.ip}`))
      } catch (e: any) {
        diagnostics.mdns = { ok: false, error: String(e?.message || e) }
        console.warn("[discover] mDNS error", e?.message || e)
      }
    })())
  }

  if (opts.methods.includes("snmp")) {
    promises.push((async () => {
      try {
        const list = await discoverSNMP(opts.rangeBase, opts.ips)
        devices.push(...list)
        diagnostics.snmp = { ok: true, count: list.length }
        console.log(`[discover] SNMP found ${list.length}:`, list.map(d => `${d.name}@${d.ip}`))
      } catch (e: any) {
        diagnostics.snmp = { ok: false, error: String(e?.message || e) }
        console.warn("[discover] SNMP error", e?.message || e)
      }
    })())
  }

  if (opts.methods.includes("wia")) {
    promises.push((async () => {
      try {
        const list = await discoverLocalWIA()
        devices.push(...list)
        diagnostics.wia = { ok: true, count: list.length }
        console.log(`[discover] WIA found ${list.length}:`, list.map(d => d.name))
      } catch (e: any) {
        diagnostics.wia = { ok: false, error: String(e?.message || e) }
        console.warn("[discover] WIA error", e?.message || e)
      }
    })())
  }

  if (opts.methods.includes("twain")) {
    promises.push((async () => {
      try {
        const list = await discoverLocalTWAIN()
        devices.push(...list)
        diagnostics.twain = { ok: true, count: list.length }
        console.log(`[discover] TWAIN found ${list.length}:`, list.map(d => d.name))
      } catch (e: any) {
        diagnostics.twain = { ok: false, error: String(e?.message || e) }
        console.warn("[discover] TWAIN error", e?.message || e)
      }
    })())
  }

  if (opts.methods.includes("probe") && opts.ips?.length) {
    promises.push((async () => {
      try {
        const list = await probeIPs(opts.ips)
        devices.push(...list)
        diagnostics.probe = { ok: true, count: list.length }
        console.log(`[discover] probe found ${list.length}:`, list.map(d => `${d.name}@${d.ip}`))
      } catch (e: any) {
        diagnostics.probe = { ok: false, error: String(e?.message || e) }
        console.warn("[discover] probe error", e?.message || e)
      }
    })())
  }

  await Promise.all(promises)
  return { devices, diagnostics }
}

// ── WSD Discovery ─────────────────────────────────────────────────────────────
// Step 1: UDP multicast probe port 3702 → get device XAddrs URL
// Step 2: HTTP GET to XAddrs port 5357 → get real name/model/manufacturer
async function discoverWSD(targetIps?: string[]): Promise<DiscoveredDevice[]> {
  const found: DiscoveredDevice[] = []
  const localAddrs = getLocalIPv4Addresses()
  const sendFrom = localAddrs.length ? localAddrs : ["0.0.0.0"]
  const rawResponses: { ip: string; xaddrs: string[]; xml: string }[] = []

  const probePromises: Promise<void>[] = []

  console.log(`[WSD] starting discovery, local IPs: ${sendFrom.join(", ")}`)

  if (!targetIps?.length) {
    // WS-Discovery multicast on port 3702 (Kyocera, Olivetti, Canon, Ricoh, Brother)
    for (const localAddr of sendFrom) {
      probePromises.push(new Promise<void>((resolve) => {
        const sock = dgram.createSocket("udp4")
        const probe = buildWsDiscoveryProbe()
        sock.bind(0, localAddr === "0.0.0.0" ? undefined : localAddr, () => {
          try {
            if (localAddr !== "0.0.0.0") {
              try { sock.setMulticastTTL(4); sock.setMulticastInterface(localAddr) } catch {}
            }
            sock.send(probe, 3702, "239.255.255.250")
            console.log(`[WSD] sent probe from ${localAddr} to 239.255.255.250:3702`)
          } catch (e) { console.warn(`[WSD] send error from ${localAddr}:`, e); resolve() }
        })
        sock.on("message", (buf, rinfo) => {
          const xml = buf.toString("utf8")
          console.log(`[WSD] response from ${rinfo.address}: ${xml.slice(0, 200)}`)
          const xaddrs = extractXAddrs(xml)
          if (!rawResponses.some(r => r.ip === rinfo.address)) {
            rawResponses.push({ ip: rinfo.address, xaddrs, xml })
          }
        })
        sock.on("error", (e) => { console.warn(`[WSD] socket error:`, e.message); try { sock.close() } catch {}; resolve() })
        setTimeout(() => { try { sock.close() } catch {}; resolve() }, 4000)
      }))
    }

    // SSDP M-SEARCH port 1900 fallback (some HP, Brother older models)
    for (const localAddr of sendFrom) {
      probePromises.push(new Promise<void>((resolve) => {
        const sock = dgram.createSocket("udp4")
        const msg = Buffer.from([
          "M-SEARCH * HTTP/1.1",
          "HOST: 239.255.255.250:1900",
          'MAN: "ssdp:discover"',
          "MX: 2",
          "ST: urn:schemas-microsoft-com:device:PrintDevice:1",
          "", "",
        ].join("\r\n"))
        sock.bind(0, localAddr === "0.0.0.0" ? undefined : localAddr, () => {
          try {
            sock.setBroadcast(true)
            if (localAddr !== "0.0.0.0") { try { sock.setMulticastInterface(localAddr) } catch {} }
            sock.send(msg, 1900, "239.255.255.250")
            console.log(`[SSDP] sent M-SEARCH from ${localAddr}`)
          } catch (e) { console.warn(`[SSDP] send error:`, e); resolve() }
        })
        sock.on("message", (buf, rinfo) => {
          const text = buf.toString()
          const location = (text.match(/LOCATION:\s*(.+)/i) || [])[1]?.trim()
          console.log(`[SSDP] response from ${rinfo.address} location=${location}`)
          if (!rawResponses.some(r => r.ip === rinfo.address)) {
            rawResponses.push({ ip: rinfo.address, xaddrs: location ? [location] : [], xml: text })
          }
        })
        sock.on("error", () => { try { sock.close() } catch {}; resolve() })
        setTimeout(() => { try { sock.close() } catch {}; resolve() }, 4000)
      }))
    }
  } else {
    for (const ip of targetIps) {
      probePromises.push(new Promise<void>((resolve) => {
        const sock = dgram.createSocket("udp4")
        sock.bind(0, () => {
          sock.send(buildWsDiscoveryProbe(), 3702, ip, err => { if (err) resolve() })
        })
        sock.on("message", (buf, rinfo) => {
          const xml = buf.toString("utf8")
          if (!rawResponses.some(r => r.ip === rinfo.address)) {
            rawResponses.push({ ip: rinfo.address, xaddrs: extractXAddrs(xml), xml })
          }
        })
        sock.on("error", () => { try { sock.close() } catch {}; resolve() })
        setTimeout(() => { try { sock.close() } catch {}; resolve() }, 1500)
      }))
    }
  }

  await Promise.all(probePromises)
  console.log(`[WSD] probe done — responses: ${rawResponses.length}`, rawResponses.map(r => r.ip))

  // Step 2: fetch metadata from XAddrs HTTP (port 5357)
  await Promise.all(rawResponses.map(async (resp) => {
    let name = extractXmlField(resp.xml, ["FriendlyName", "d:FriendlyName"])
    let model = extractXmlField(resp.xml, ["Model", "d:Model"])
    let manufacturer = extractXmlField(resp.xml, ["Manufacturer", "d:Manufacturer"])

    const metaUrl = resp.xaddrs.find(u => /^https?:\/\//i.test(u))
      || `http://${resp.ip}:5357/`

    if (!name || !model) {
      console.log(`[WSD] fetching metadata from ${metaUrl}`)
      try {
        const meta = await fetchWsdMetadata(metaUrl)
        if (meta.name) name = meta.name
        if (meta.model) model = meta.model
        if (meta.manufacturer) manufacturer = meta.manufacturer
        console.log(`[WSD] metadata for ${resp.ip}: name="${name}" model="${model}" mfr="${manufacturer}"`)
      } catch (e: any) {
        console.warn(`[WSD] metadata fetch failed for ${resp.ip}:`, e.message)
      }
    }

    if (!name) name = model || `WSD Device (${resp.ip})`

    found.push({
      ip: resp.ip,
      hostname: resp.ip,
      name,
      driver: "wia",
      protocol: "wsd",
      source: "network",
      online: true,
      confidence: 90,
      manufacturer: manufacturer || guessManufacturer(name + " " + (model || "")) || null,
      model: model || null,
      raw: { xaddrs: resp.xaddrs, xml: resp.xml.slice(0, 500) },
    })
  }))

  return found
}

function buildWsDiscoveryProbe(): Buffer {
  const id = `uuid:${Math.random().toString(16).slice(2)}-${Date.now()}`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <e:Header>
    <w:MessageID>${id}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body><d:Probe/></e:Body>
</e:Envelope>`
  return Buffer.from(xml)
}

function extractXAddrs(xml: string): string[] {
  const match = xml.match(/<[^>]*:?XAddrs[^>]*>([^<]+)</)
  if (!match) return []
  return match[1].trim().split(/\s+/).filter(u => u.startsWith("http"))
}

function extractXmlField(xml: string, tags: string[]): string {
  for (const tag of tags) {
    const safe = tag.replace(/:/g, "[^>]*:")
    const m = xml.match(new RegExp(`<${safe}[^>]*>([^<]{2,200})<`))
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return ""
}

async function fetchWsdMetadata(url: string): Promise<{ name: string; model: string; manufacturer: string }> {
  const empty = { name: "", model: "", manufacturer: "" }
  return new Promise((resolve) => {
    try {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/09/mex">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2004/09/mex/GetMetadata/Request</a:Action>
    <a:MessageID>uuid:${Math.random().toString(16).slice(2)}</a:MessageID>
    <a:To>${url}</a:To>
  </s:Header>
  <s:Body><w:GetMetadata/></s:Body>
</s:Envelope>`
      const parsed = new URL(url)
      const mod = parsed.protocol === "https:" ? https : http
      const options = {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (parsed.protocol === "https:" ? 5358 : 5357),
        path: parsed.pathname || "/",
        method: "POST",
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 2500,
        rejectUnauthorized: false,
      }
      const req = (mod as any).request(options, (res: any) => {
        let data = ""
        res.on("data", (chunk: any) => { data += chunk })
        res.on("end", () => {
          resolve({
            name: extractXmlField(data, ["FriendlyName", "wsdp:FriendlyName", "wprt:PrinterName"]),
            model: extractXmlField(data, ["ModelName", "wsdp:ModelName", "Model"]),
            manufacturer: extractXmlField(data, ["Manufacturer", "wsdp:Manufacturer"]),
          })
        })
      })
      req.on("error", (e: any) => { console.warn(`[WSD] HTTP error ${url}:`, e.message); resolve(empty) })
      req.on("timeout", () => { req.destroy(); resolve(empty) })
      req.write(body)
      req.end()
    } catch (e: any) { console.warn(`[WSD] fetchWsdMetadata error:`, e.message); resolve(empty) }
  })
}

// ── mDNS Discovery ────────────────────────────────────────────────────────────
async function discoverMDNS(): Promise<DiscoveredDevice[]> {
  const serviceNames = ["_scanner._tcp.local", "_uscan._tcp.local", "_ipp._tcp.local", "_printer._tcp.local"]
  const localAddrs = getLocalIPv4Addresses()
  const found: DiscoveredDevice[] = []
  const ifaceTargets = localAddrs.length ? localAddrs : ["0.0.0.0"]
  console.log(`[mDNS] scanning from: ${ifaceTargets.join(", ")}`)

  await Promise.all(serviceNames.flatMap((service) =>
    ifaceTargets.map((localAddr) => new Promise<void>((resolve) => {
      const sock = dgram.createSocket({ type: "udp4", reuseAddr: true })
      const query = buildMdnsQuery(service)
      sock.bind(0, localAddr === "0.0.0.0" ? undefined : localAddr, () => {
        try {
          sock.setMulticastTTL(255)
          if (localAddr !== "0.0.0.0") sock.setMulticastInterface(localAddr)
          sock.send(query, 5353, "224.0.0.251")
        } catch { resolve() }
      })
      sock.on("message", (buf, rinfo) => {
        const parsed = parseMdnsPacket(buf)
        const name = parsed.instance || parsed.target || service
        console.log(`[mDNS] ${rinfo.address} => ${name}`)
        if (!found.some((f) => f.ip === rinfo.address)) {
          found.push({
            ip: rinfo.address,
            hostname: parsed.target || rinfo.address,
            name: `${name} (${rinfo.address})`,
            driver: "wia",
            protocol: "mdns",
            source: "network",
            online: true,
            confidence: 80,
            raw: parsed,
          })
        }
      })
      sock.on("error", () => { try { sock.close() } catch {}; resolve() })
      setTimeout(() => { try { sock.close() } catch {}; resolve() }, 2000)
    }))
  ))
  return found
}

function buildMdnsQuery(name: string): Buffer {
  const labels = name.split(".").filter(Boolean)
  const parts: number[] = [0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
  for (const label of labels) {
    const encoded = Buffer.from(label, "utf8")
    parts.push(encoded.length)
    for (const b of encoded) parts.push(b)
  }
  parts.push(0x00)
  parts.push(0x00, 0x0c)
  parts.push(0x80, 0x01)
  return Buffer.from(parts)
}

function parseMdnsPacket(buf: Buffer) {
  const readName = (offset: number, depth = 0): { name: string; next: number } => {
    if (depth > 10) return { name: "", next: offset + 1 }
    const labels: string[] = []
    let i = offset; let jumped = false; let next = offset
    while (i < buf.length) {
      const len = buf[i]
      if (len === 0) { if (!jumped) next = i + 1; break }
      if ((len & 0xc0) === 0xc0) {
        const ptr = ((len & 0x3f) << 8) | buf[i + 1]
        const sub = readName(ptr, depth + 1)
        if (sub.name) labels.push(sub.name)
        if (!jumped) next = i + 2
        jumped = true; break
      }
      labels.push(buf.toString("utf8", i + 1, i + 1 + len))
      i += 1 + len
      if (!jumped) next = i
    }
    return { name: labels.join("."), next }
  }
  const qd = buf.readUInt16BE(4); const an = buf.readUInt16BE(6)
  let off = 12
  for (let i = 0; i < qd; i++) { const q = readName(off); off = q.next + 4 }
  let target = ""; let instance = ""
  for (let i = 0; i < an; i++) {
    const n = readName(off); off = n.next
    const type = buf.readUInt16BE(off); off += 2
    off += 2; off += 4
    const rdlen = buf.readUInt16BE(off); off += 2
    if (type === 12) { instance = readName(off).name }
    else if (type === 33) { target = readName(off + 6).name }
    else if (type === 1 && !target) { target = n.name }
    off += rdlen
  }
  return { instance, target }
}

// ── SNMP Discovery ────────────────────────────────────────────────────────────
async function discoverSNMP(rangeBase?: string, manualIps?: string[]): Promise<DiscoveredDevice[]> {
  const localBases = getLocalIPv4Bases()
  const localAddrs = getLocalIPv4Addresses()
  const ips = manualIps?.length
    ? manualIps
    : expandIpBases(rangeBase || process.env.NETWORK_SCAN_RANGE || "", localBases)
  const limited = ips.slice(0, Number(process.env.DISCOVERY_MAX_IPS || 254))
  console.log(`[SNMP] scanning ${limited.length} IPs across bases: ${localBases.join(", ")}`)
  const results = await promisePool(limited, 16, async (ip) => {
    const targetBase = ip.split(".").slice(0, 3).join(".")
    const localAddr = localAddrs.find((a) => a.startsWith(targetBase + "."))
    return probeSNMP(ip, localAddr)
  })
  return results.filter(Boolean) as DiscoveredDevice[]
}

function expandIpBases(explicitBase: string, discoveredBases: string[]): string[] {
  const bases = explicitBase
    ? explicitBase.split(",").map((x) => x.trim()).filter(Boolean)
    : discoveredBases
  const ips: string[] = []
  for (const base of bases) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(base)) { ips.push(base); continue }
    for (let i = 1; i <= 254; i++) ips.push(`${base}.${i}`)
  }
  return ips
}

async function probeSNMP(ip: string, localAddress?: string): Promise<DiscoveredDevice | null> {
  const payload = buildSnmpGetSysDescr(process.env.SNMP_COMMUNITY || "public")
  const response = await udpRequest(ip, 161, payload, 500, localAddress)
  if (!response) return null
  const descr = parseSnmpSysDescr(response)
  if (!descr) return null
  const model = descr.length > 80 ? descr.slice(0, 80) : descr
  return {
    ip, hostname: ip,
    name: `${guessManufacturer(descr) || "SNMP"} Device (${ip})`,
    driver: "wia", protocol: "snmp", source: "network", online: true, confidence: 70,
    manufacturer: guessManufacturer(descr),
    model,
    raw: { sysDescr: descr },
  }
}

function buildSnmpGetSysDescr(community: string): Buffer {
  const oid = Buffer.from([0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00])
  const varBind = seq(Buffer.concat([oidTag(oid), Buffer.from([0x05, 0x00])]))
  const varBinds = seq(varBind)
  const pduInner = Buffer.concat([intTag(1), intTag(0), intTag(0), varBinds])
  const pdu = tag(0xa0, pduInner)
  return seq(Buffer.concat([intTag(0), octetString(Buffer.from(community, "utf8")), pdu]))
}

function parseSnmpSysDescr(buf: Buffer): string | null {
  const s = buf.toString("latin1")
  const match = s.match(/[\x20-\x7e]{6,}/g)
  if (!match?.length) return null
  const known = match.find((x) => /kyocera|olivetti|canon|hp|hewlett|brother|epson|xerox|ricoh|scanner|printer|mfp|imaging|konica|minolta|sharp|toshiba|lexmark|samsung/i.test(x))
  if (known) return known.trim()
  const longest = match.reduce((a, b) => b.length > a.length ? b : a, "")
  return longest.length >= 6 ? longest.trim() : null
}

function seq(inner: Buffer) { return tag(0x30, inner) }
function intTag(n: number) { return tag(0x02, Buffer.from([n])) }
function octetString(inner: Buffer) { return tag(0x04, inner) }
function oidTag(inner: Buffer) { return tag(0x06, inner) }
function tag(t: number, inner: Buffer) {
  const len = inner.length < 128 ? Buffer.from([inner.length]) : Buffer.from([0x81, inner.length])
  return Buffer.concat([Buffer.from([t]), len, inner])
}

function udpRequest(host: string, port: number, payload: Buffer, timeoutMs: number, localAddress?: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4")
    let done = false
    const finish = (value: Buffer | null) => {
      if (done) return; done = true
      try { sock.close() } catch {}
      resolve(value)
    }
    sock.on("message", (msg) => finish(msg))
    sock.on("error", () => finish(null))
    sock.bind(0, localAddress || "0.0.0.0", () => {
      sock.send(payload, port, host, (err) => { if (err) finish(null) })
    })
    setTimeout(() => finish(null), timeoutMs)
  })
}

// ── Local WIA/TWAIN Discovery ─────────────────────────────────────────────────
async function discoverLocalWIA(): Promise<DiscoveredDevice[]> {
  if (process.platform !== "win32") return []
  const script = String.raw`
$wia = New-Object -ComObject WIA.DeviceManager
$list = @()
foreach ($dev in $wia.DeviceInfos) {
  $name = $dev.Properties.Item("Name").Value
  $id = $dev.DeviceID
  $type = $dev.Type
  $list += [PSCustomObject]@{ name=$name; id=$id; type=$type }
}
$list | ConvertTo-Json -Compress`
  const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 })
  const parsed = parseJsonArray(stdout)
  return parsed.map((d: any) => ({
    ip: "127.0.0.1",
    hostname: os.hostname(),
    name: d.name || "WIA Scanner",
    driver: "wia" as const,
    protocol: "wia" as const,
    source: "local" as const,
    online: true,
    confidence: 100,
    raw: d,
  }))
}

async function discoverLocalTWAIN(): Promise<DiscoveredDevice[]> {
  if (process.platform !== "win32") return []
  const script = String.raw`
$paths = @("HKLM:\SOFTWARE\TWAIN\DSM","HKLM:\SOFTWARE\WOW6432Node\TWAIN\DSM")
$list = @()
foreach ($p in $paths) {
  if (Test-Path $p) {
    Get-ChildItem $p -ErrorAction SilentlyContinue | ForEach-Object {
      $list += [PSCustomObject]@{ name=$_.PSChildName; path=$_.Name }
    }
  }
}
$list | ConvertTo-Json -Compress`
  const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 })
  const parsed = parseJsonArray(stdout)
  return parsed.map((d: any) => ({
    ip: "127.0.0.1",
    hostname: os.hostname(),
    name: d.name || "TWAIN Scanner",
    driver: "twain" as const,
    protocol: "twain" as const,
    source: "local" as const,
    online: true,
    confidence: 95,
    raw: d,
  }))
}

function parseJsonArray(text: string): any[] {
  const raw = String(text || "").trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  } catch { return [] }
}

// ── IP probing fallback ────────────────────────────────────────────────────────
async function probeIPs(ips: string[]): Promise<DiscoveredDevice[]> {
  const results = await promisePool(ips, 12, async (ip) => probeSingleIp(ip))
  return results.filter(Boolean) as DiscoveredDevice[]
}

async function probeSingleIp(ip: string): Promise<DiscoveredDevice | null> {
  const ports = [5357, 80, 443, 631, 9100, 515, 5358, 8080, 8443, 9090, 9280, 8000]
  const open = await Promise.all(ports.map((port) => checkTcpPort(ip, port, 600).then((ok) => ok ? port : null)))
  const openPorts = open.filter(Boolean) as number[]
  if (!openPorts.length) return null
  return {
    ip, hostname: ip,
    name: `Network MFP (${ip})`,
    driver: "wia", protocol: "tcp", source: "manual", online: true, confidence: 60,
    raw: { openPorts },
  }
}

function guessManufacturer(text: string): string | null {
  const lower = text.toLowerCase()
  if (lower.includes("kyocera")) return "Kyocera"
  if (lower.includes("olivetti")) return "Olivetti"
  if (lower.includes("hewlett") || lower.includes(" hp ") || lower.startsWith("hp")) return "HP"
  if (lower.includes("canon")) return "Canon"
  if (lower.includes("brother")) return "Brother"
  if (lower.includes("epson")) return "Epson"
  if (lower.includes("xerox")) return "Xerox"
  if (lower.includes("ricoh")) return "Ricoh"
  if (lower.includes("samsung")) return "Samsung"
  if (lower.includes("lexmark")) return "Lexmark"
  if (lower.includes("konica") || lower.includes("minolta")) return "Konica Minolta"
  if (lower.includes("sharp")) return "Sharp"
  if (lower.includes("toshiba")) return "Toshiba"
  return null
}

async function promisePool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let index = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = index++
      out[current] = await worker(items[current])
    }
  })
  await Promise.all(runners)
  return out
}

export default r
