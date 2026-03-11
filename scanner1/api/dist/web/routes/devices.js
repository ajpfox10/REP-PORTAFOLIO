// routes/devices.ts — Dispositivos + capacidades + descubrimiento en red
import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import dgram from "dgram";
import net from "net";
import os from "os";
import { validate } from "../validate.js";
import { createDeviceSchema, paginationSchema } from "../../shared/index.js";
import { pool } from "../../db/mysql.js";
import { ApiError } from "../errorHandler.js";
const r = Router();
const execAsync = promisify(exec);
// ── GET /v1/devices ───────────────────────────────────────────────────────────
r.get("/", validate(paginationSchema, "query"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const { limit, cursor } = req.query;
    const [rows] = await pool.query("SELECT id,name,driver,device_key,is_active,hostname,agent_version,last_seen_at,created_at FROM devices WHERE tenant_id=? AND id>? ORDER BY id ASC LIMIT ?", [tenant_id, cursor, limit]);
    const rows_ = rows;
    // Check online status for each device in parallel
    const items = await Promise.all(rows_.map(async (dev) => ({
        ...dev,
        online: await isOnline(dev.last_seen_at, dev.hostname),
    })));
    res.json({ items, next_cursor: items.at(-1)?.id || cursor });
});
// ── GET /v1/devices/:id ───────────────────────────────────────────────────────
r.get("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    const [rows] = await pool.query("SELECT * FROM devices WHERE tenant_id=? AND id=?", [tenant_id, Number(req.params.id)]);
    const dev = rows[0];
    if (!dev)
        throw new ApiError(404, "device_not_found");
    res.json(dev);
});
// ── GET /v1/devices/:id/capabilities — capacidades reportadas por el agent ────
r.get("/:id/capabilities", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT id, hostname, driver, last_seen_at FROM devices WHERE tenant_id=? AND id=?", [tenant_id, id]);
    const dev = rows[0];
    if (!dev)
        throw new ApiError(404, "device_not_found");
    // Leer capacidades guardadas (el agent las reporta en heartbeat)
    const [capRows] = await pool.query("SELECT capabilities_json FROM device_capabilities WHERE device_id=?", [id]).catch(() => [[]]);
    const stored = capRows[0];
    const online = await isOnline(dev.last_seen_at, dev.hostname);
    if (stored?.capabilities_json) {
        try {
            const caps = typeof stored.capabilities_json === "string"
                ? JSON.parse(stored.capabilities_json)
                : stored.capabilities_json;
            return res.json({ ...caps, online });
        }
        catch { }
    }
    // Fallback: capacidades genéricas según driver
    res.json(defaultCapabilities(dev.driver, online));
});
// ── POST /v1/devices ──────────────────────────────────────────────────────────
r.post("/", validate(createDeviceSchema, "body"), async (req, res) => {
    const tenant_id = req.tenant_id;
    const b = req.body;
    const [result] = await pool.query("INSERT INTO devices (tenant_id,name,driver,device_key,is_active,created_at) VALUES (?,?,?,?,?,now())", [tenant_id, b.name, b.driver, b.device_key, b.is_active ? 1 : 0]);
    const id = Number(result.insertId);
    if (!id)
        throw new ApiError(500, "device_create_failed");
    res.status(201).json({ id });
});
// ── PATCH /v1/devices/:id ─────────────────────────────────────────────────────
r.patch("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const { name, is_active } = req.body || {};
    await pool.query("UPDATE devices SET name=COALESCE(?,name), is_active=COALESCE(?,is_active), updated_at=now() WHERE tenant_id=? AND id=?", [name ?? null, is_active != null ? (is_active ? 1 : 0) : null, tenant_id, id]);
    res.json({ ok: true });
});
// ── GET /v1/devices/:id/ping — estado en vivo (no requiere agent) ─────────────
r.get("/:id/ping", async (req, res) => {
    const tenant_id = req.tenant_id;
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT hostname, last_seen_at FROM devices WHERE tenant_id=? AND id=?", [tenant_id, id]);
    const dev = rows[0];
    if (!dev)
        throw new ApiError(404, "device_not_found");
    const byHeartbeat = isOnlineByHeartbeat(dev.last_seen_at);
    const byNetwork = await isOnlineByNetwork(dev.hostname);
    const online = byHeartbeat || byNetwork;
    // Update last_seen_at if responding on network but no agent
    if (byNetwork && !byHeartbeat) {
        await pool.query("UPDATE devices SET last_seen_at=now() WHERE id=?", [id]).catch(() => { });
    }
    res.json({ online, method: byHeartbeat ? "heartbeat" : byNetwork ? "network" : "none" });
});
// ── DELETE /v1/devices/:id ────────────────────────────────────────────────────
r.delete("/:id", async (req, res) => {
    const tenant_id = req.tenant_id;
    await pool.query("DELETE FROM devices WHERE tenant_id=? AND id=?", [tenant_id, Number(req.params.id)]);
    res.json({ ok: true });
});
// ── POST /v1/devices/discover — descubrimiento híbrido ───────────────────────
r.post("/discover", async (req, res) => {
    const tenant_id = req.tenant_id;
    const body = (req.body || {});
    const methods = normalizeMethods(body?.methods);
    const rangeBase = typeof body?.range_base === "string" ? body.range_base.trim() : undefined;
    const manualIps = Array.isArray(body?.ips) ? body.ips.filter((x) => typeof x === "string" && x.trim()) : [];
    const { devices, diagnostics } = await discoverAll({ methods, rangeBase, ips: manualIps });
    const found = dedupeDevices(devices);
    const newDevices = [];
    for (const dev of found) {
        const key = buildDeviceKey(dev);
        const [existing] = await pool.query("SELECT id FROM devices WHERE tenant_id=? AND (device_key=? OR hostname=? OR (hostname IS NULL AND name=?))", [tenant_id, key, dev.hostname || null, dev.name]);
        if (existing.length)
            continue;
        const [result] = await pool.query("INSERT INTO devices (tenant_id,name,driver,device_key,is_active,hostname,created_at) VALUES (?,?,?,?,1,?,now())", [tenant_id, dev.name || dev.ip, dev.driver || "wia", key, dev.hostname || dev.ip]);
        newDevices.push({ id: Number(result.insertId), ...dev });
    }
    res.json({ devices: found, registered: newDevices.length, diagnostics });
});
// ── POST /v1/devices/probe-ip — prueba puntual por IP ────────────────────────
r.post("/probe-ip", async (req, res) => {
    const ip = String(req.body?.ip || "").trim();
    if (!ip)
        throw new ApiError(400, "ip_required", "Debe enviar body.ip");
    const { devices, diagnostics } = await discoverAll({ methods: ["wsd", "mdns", "snmp", "probe"], ips: [ip] });
    res.json({ ip, devices: dedupeDevices(devices), diagnostics });
});
// ── POST /v1/devices/discover-local — WIA/TWAIN del host Windows ─────────────
r.post("/discover-local", async (_req, res) => {
    const [wia, twain] = await Promise.allSettled([discoverLocalWIA(), discoverLocalTWAIN()]);
    const devices = dedupeDevices([
        ...(wia.status === "fulfilled" ? wia.value : []),
        ...(twain.status === "fulfilled" ? twain.value : []),
    ]);
    res.json({
        devices,
        diagnostics: {
            wia: wia.status === "fulfilled" ? { ok: true, count: wia.value.length } : { ok: false, error: String(wia.reason?.message || wia.reason) },
            twain: twain.status === "fulfilled" ? { ok: true, count: twain.value.length } : { ok: false, error: String(twain.reason?.message || twain.reason) },
        },
    });
});
// ── Helpers ───────────────────────────────────────────────────────────────────
// Agent-based check (USB/agent devices)
function isOnlineByHeartbeat(lastSeen) {
    if (!lastSeen)
        return false;
    return (Date.now() - new Date(lastSeen).getTime()) < 90_000;
}
function checkTcpPort(ip, port, timeout = 500) {
    return new Promise((resolve) => {
        const s = net.createConnection({ host: ip, port });
        let done = false;
        const finish = (value) => {
            if (done)
                return;
            done = true;
            s.destroy();
            resolve(value);
        };
        s.setTimeout(timeout);
        s.on("connect", () => finish(true));
        s.on("error", () => finish(false));
        s.on("timeout", () => finish(false));
    });
}
// Network-based check — uses OS ping (ICMP) as primary method, TCP as fallback
// ICMP ping is the most reliable way to check if a device is reachable on LAN
async function isOnlineByNetwork(hostname) {
    if (!hostname || hostname === "127.0.0.1")
        return false;
    // Try ICMP ping first — works for all network devices including scanners
    const icmpResult = pingICMP(hostname);
    // Fallback: TCP on common scanner ports in parallel
    const tcpPorts = [80, 443, 631, 9100, 515, 5357, 8080];
    const tcpResult = Promise.all(tcpPorts.map((p) => checkTcpPort(hostname, p, 2000)))
        .then((r) => r.some(Boolean));
    // WSD UDP probe — used by most network scanners (Kyocera, HP, Canon, etc.)
    const wsdResult = probeWsdUdp(hostname);
    // Return as soon as any method succeeds
    return new Promise((resolve) => {
        let resolved = false;
        const done = (v) => { if (!resolved && v) {
            resolved = true;
            resolve(true);
        } };
        icmpResult.then(done);
        tcpResult.then(done);
        wsdResult.then(done);
        // Global timeout — if nothing responds in 3s, declare offline
        setTimeout(() => { if (!resolved) {
            resolved = true;
            resolve(false);
        } }, 3000);
    });
}
// ICMP ping using OS ping command (Windows: ping -n 1 -w 1000)
// No extra packages needed — ping.exe is always available on Windows
function pingICMP(ip) {
    return new Promise((resolve) => {
        // Windows: ping -n 1 (1 packet) -w 1000 (1s timeout)
        // Linux/Mac: ping -c 1 -W 1 (fallback)
        const isWin = process.platform === "win32";
        const args = isWin ? ["-n", "1", "-w", "1000", ip] : ["-c", "1", "-W", "1", ip];
        const proc = exec(`ping ${args.join(" ")}`, { timeout: 3000 });
        let out = "";
        proc.stdout?.on("data", (d) => { out += d; });
        proc.on("close", (code) => {
            // Windows: exit 0 = alive, exit 1 = timeout/unreachable
            // Also check stdout for TTL which confirms real response
            const alive = code === 0 && /TTL=/i.test(out);
            resolve(alive);
        });
        proc.on("error", () => resolve(false));
    });
}
// WSD UDP probe — sends a minimal WS-Discovery Probe and waits for any response
function probeWsdUdp(ip) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket("udp4");
        let done = false;
        const finish = (v) => {
            if (done)
                return;
            done = true;
            try {
                sock.close();
            }
            catch { }
            resolve(v);
        };
        const id = `uuid:${Math.random().toString(16).slice(2)}`;
        const xml = Buffer.from(`<?xml version="1.0"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><e:Header><w:MessageID>${id}</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe/></e:Body></e:Envelope>`);
        sock.on("message", () => finish(true));
        sock.on("error", () => finish(false));
        sock.bind(0, () => {
            sock.send(xml, 3702, ip, (err) => { if (err)
                finish(false); });
        });
        setTimeout(() => finish(false), 1500);
    });
}
// Unified: uses heartbeat if agent active, falls back to TCP probe for network devices
async function isOnline(lastSeen, hostname) {
    if (isOnlineByHeartbeat(lastSeen))
        return true;
    return isOnlineByNetwork(hostname);
}
function defaultCapabilities(driver, online) {
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
    };
}
function normalizeMethods(raw) {
    const allowed = ["wsd", "mdns", "snmp", "wia", "twain", "probe"];
    if (!Array.isArray(raw) || !raw.length)
        return allowed;
    const set = new Set(raw.map((x) => String(x).toLowerCase()));
    return allowed.filter((m) => set.has(m));
}
function buildDeviceKey(dev) {
    const proto = dev.protocol || "manual";
    const hostish = (dev.ip || dev.hostname || dev.name || "device").replace(/[^a-zA-Z0-9]+/g, "_");
    return `discovered_${proto}_${hostish}`.toLowerCase();
}
function dedupeDevices(items) {
    const map = new Map();
    for (const item of items) {
        const key = (item.ip || item.hostname || item.name).toLowerCase();
        const prev = map.get(key);
        if (!prev) {
            map.set(key, item);
            continue;
        }
        map.set(key, mergeDevices(prev, item));
    }
    return [...map.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || a.name.localeCompare(b.name));
}
function mergeDevices(a, b) {
    return {
        ...a,
        ...b,
        name: chooseBetter(a.name, b.name),
        hostname: chooseBetter(a.hostname, b.hostname),
        manufacturer: chooseBetter(a.manufacturer || undefined, b.manufacturer || undefined) || null,
        model: chooseBetter(a.model || undefined, b.model || undefined) || null,
        confidence: Math.max(a.confidence || 0, b.confidence || 0),
        raw: { ...(a.raw || {}), ...(b.raw || {}) },
    };
}
function chooseBetter(a, b) {
    const aa = String(a || "").trim();
    const bb = String(b || "").trim();
    if (!aa)
        return bb;
    if (!bb)
        return aa;
    return bb.length > aa.length ? bb : aa;
}
function getLocalIPv4Bases() {
    const out = new Set();
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
        for (const addr of list || []) {
            if (addr.family !== "IPv4" || addr.internal)
                continue;
            const parts = addr.address.split(".");
            if (parts.length === 4)
                out.add(parts.slice(0, 3).join("."));
        }
    }
    return [...out];
}
// Returns all non-internal IPv4 addresses of the server (one per NIC)
function getLocalIPv4Addresses() {
    const out = [];
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
        for (const addr of list || []) {
            if (addr.family !== "IPv4" || addr.internal)
                continue;
            out.push(addr.address);
        }
    }
    return out;
}
async function discoverAll(opts) {
    const devices = [];
    const diagnostics = {};
    const promises = [];
    if (opts.methods.includes("wsd")) {
        promises.push((async () => {
            try {
                const list = await discoverWSD(opts.ips);
                devices.push(...list);
                diagnostics.wsd = { ok: true, count: list.length };
            }
            catch (e) {
                diagnostics.wsd = { ok: false, error: String(e?.message || e) };
                console.warn("[discover] WSD error", e?.message || e);
            }
        })());
    }
    if (opts.methods.includes("mdns")) {
        promises.push((async () => {
            try {
                const list = await discoverMDNS();
                devices.push(...list);
                diagnostics.mdns = { ok: true, count: list.length };
            }
            catch (e) {
                diagnostics.mdns = { ok: false, error: String(e?.message || e) };
                console.warn("[discover] mDNS error", e?.message || e);
            }
        })());
    }
    if (opts.methods.includes("snmp")) {
        promises.push((async () => {
            try {
                const list = await discoverSNMP(opts.rangeBase, opts.ips);
                devices.push(...list);
                diagnostics.snmp = { ok: true, count: list.length };
            }
            catch (e) {
                diagnostics.snmp = { ok: false, error: String(e?.message || e) };
                console.warn("[discover] SNMP error", e?.message || e);
            }
        })());
    }
    if (opts.methods.includes("wia")) {
        promises.push((async () => {
            try {
                const list = await discoverLocalWIA();
                devices.push(...list);
                diagnostics.wia = { ok: true, count: list.length };
            }
            catch (e) {
                diagnostics.wia = { ok: false, error: String(e?.message || e) };
                console.warn("[discover] WIA error", e?.message || e);
            }
        })());
    }
    if (opts.methods.includes("twain")) {
        promises.push((async () => {
            try {
                const list = await discoverLocalTWAIN();
                devices.push(...list);
                diagnostics.twain = { ok: true, count: list.length };
            }
            catch (e) {
                diagnostics.twain = { ok: false, error: String(e?.message || e) };
                console.warn("[discover] TWAIN error", e?.message || e);
            }
        })());
    }
    if (opts.methods.includes("probe") && opts.ips?.length) {
        promises.push((async () => {
            try {
                const list = await probeIPs(opts.ips);
                devices.push(...list);
                diagnostics.probe = { ok: true, count: list.length };
            }
            catch (e) {
                diagnostics.probe = { ok: false, error: String(e?.message || e) };
                console.warn("[discover] probe error", e?.message || e);
            }
        })());
    }
    await Promise.all(promises);
    return { devices, diagnostics };
}
// ── WSD Discovery ─────────────────────────────────────────────────────────────
async function discoverWSD(targetIps) {
    const found = [];
    const localAddrs = getLocalIPv4Addresses();
    const targets = targetIps?.length ? targetIps : ["239.255.255.250"];
    // When doing multicast, send from every local interface so all networks are covered
    const sendFrom = (targetIps?.length) ? [undefined] : (localAddrs.length ? localAddrs : [undefined]);
    await Promise.all(targets.flatMap((target) => sendFrom.map((localAddr) => new Promise((resolve) => {
        const sock = dgram.createSocket("udp4");
        const multicast = target === "239.255.255.250";
        const msg = Buffer.from([
            "M-SEARCH * HTTP/1.1",
            `HOST: ${multicast ? "239.255.255.250:1900" : `${target}:3702`}`,
            'MAN: "ssdp:discover"',
            "MX: 2",
            "ST: urn:schemas-microsoft-com:device:PrintDevice:1",
            "",
            "",
        ].join("\r\n"));
        sock.bind(0, localAddr || "0.0.0.0", () => {
            try {
                sock.setBroadcast(true);
                if (multicast && localAddr) {
                    try {
                        sock.setMulticastInterface(localAddr);
                    }
                    catch { }
                    sock.send(msg, 1900, "239.255.255.250");
                }
                else if (multicast) {
                    sock.send(msg, 1900, "239.255.255.250");
                }
                else {
                    const probe = buildWsDiscoveryProbe();
                    sock.send(probe, 3702, target);
                }
            }
            catch {
                resolve();
            }
        });
        sock.on("message", (buf, rinfo) => {
            const text = buf.toString();
            const server = (text.match(/SERVER:\s*(.+)/i) || [])[1]?.trim() || null;
            const location = (text.match(/LOCATION:\s*(.+)/i) || [])[1]?.trim() || null;
            const display = server || location || rinfo.address;
            if (!found.some((f) => f.ip === rinfo.address)) {
                found.push({
                    ip: rinfo.address,
                    hostname: rinfo.address,
                    name: `WSD Scanner (${display})`,
                    driver: "wia",
                    protocol: "wsd",
                    source: "network",
                    online: true,
                    confidence: 90,
                    raw: { server, location, text: text.slice(0, 500) },
                });
            }
        });
        sock.on("error", () => { try {
            sock.close();
        }
        catch { } ; resolve(); });
        setTimeout(() => { try {
            sock.close();
        }
        catch { } ; resolve(); }, targetIps?.length ? 1200 : 3000);
    }))));
    return found;
}
function buildWsDiscoveryProbe() {
    const id = `uuid:${Math.random().toString(16).slice(2)}-${Date.now()}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <e:Header>
    <w:MessageID>${id}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe/>
  </e:Body>
</e:Envelope>`;
    return Buffer.from(xml);
}
// ── mDNS Discovery ────────────────────────────────────────────────────────────
async function discoverMDNS() {
    const serviceNames = ["_scanner._tcp.local", "_uscan._tcp.local", "_ipp._tcp.local", "_printer._tcp.local"];
    const localAddrs = getLocalIPv4Addresses();
    const found = [];
    // Send mDNS query from each local interface so both networks are probed
    const ifaceTargets = localAddrs.length ? localAddrs : ["0.0.0.0"];
    await Promise.all(serviceNames.flatMap((service) => ifaceTargets.map((localAddr) => new Promise((resolve) => {
        const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
        const query = buildMdnsQuery(service);
        sock.bind(0, localAddr, () => {
            try {
                sock.setMulticastTTL(255);
                sock.setMulticastInterface(localAddr);
                sock.send(query, 5353, "224.0.0.251");
            }
            catch {
                resolve();
            }
        });
        sock.on("message", (buf, rinfo) => {
            const parsed = parseMdnsPacket(buf);
            const name = parsed.instance || parsed.target || service;
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
                });
            }
        });
        sock.on("error", () => { try {
            sock.close();
        }
        catch { } ; resolve(); });
        setTimeout(() => { try {
            sock.close();
        }
        catch { } ; resolve(); }, 1800);
    }))));
    return found;
}
function buildMdnsQuery(name) {
    const labels = name.split(".").filter(Boolean);
    const parts = [
        0x00, 0x00,
        0x00, 0x00,
        0x00, 0x01,
        0x00, 0x00,
        0x00, 0x00,
        0x00, 0x00,
    ];
    for (const label of labels) {
        parts.push(label.length, ...Buffer.from(label));
    }
    parts.push(0x00);
    parts.push(0x00, 0x0c); // PTR
    parts.push(0x00, 0x01); // IN
    return Buffer.from(parts);
}
function parseMdnsPacket(buf) {
    const readName = (offset, depth = 0) => {
        if (depth > 10)
            return { name: "", next: offset + 1 };
        const labels = [];
        let i = offset;
        let jumped = false;
        let next = offset;
        while (i < buf.length) {
            const len = buf[i];
            if (len === 0) {
                if (!jumped)
                    next = i + 1;
                break;
            }
            if ((len & 0xc0) === 0xc0) {
                const ptr = ((len & 0x3f) << 8) | buf[i + 1];
                const sub = readName(ptr, depth + 1);
                if (sub.name)
                    labels.push(sub.name);
                if (!jumped)
                    next = i + 2;
                jumped = true;
                break;
            }
            const start = i + 1;
            const end = start + len;
            labels.push(buf.toString("utf8", start, end));
            i = end;
            if (!jumped)
                next = i;
        }
        return { name: labels.join("."), next };
    };
    const qd = buf.readUInt16BE(4);
    const an = buf.readUInt16BE(6);
    let off = 12;
    for (let i = 0; i < qd; i++) {
        const q = readName(off);
        off = q.next + 4;
    }
    let target = "";
    let instance = "";
    for (let i = 0; i < an; i++) {
        const n = readName(off);
        off = n.next;
        const type = buf.readUInt16BE(off);
        off += 2;
        off += 2; // class
        off += 4; // ttl
        const rdlen = buf.readUInt16BE(off);
        off += 2;
        if (type === 12) {
            const ptr = readName(off);
            instance = ptr.name;
        }
        else if (type === 33) {
            const name = readName(off + 6);
            target = name.name;
        }
        else if (type === 1 && !target) {
            target = n.name;
        }
        off += rdlen;
    }
    return { instance, target };
}
// ── SNMP Discovery ────────────────────────────────────────────────────────────
async function discoverSNMP(rangeBase, manualIps) {
    const localBases = getLocalIPv4Bases(); // e.g. ["192.168.1", "10.0.0"]
    const localAddrs = getLocalIPv4Addresses(); // full IPs per base
    const ips = manualIps?.length
        ? manualIps
        : expandIpBases(rangeBase || process.env.NETWORK_SCAN_RANGE || "", localBases);
    const limited = ips.slice(0, Number(process.env.DISCOVERY_MAX_IPS || 254));
    const results = await promisePool(limited, 12, async (ip) => {
        // Find the local interface in the same /24 subnet as this target IP
        const targetBase = ip.split(".").slice(0, 3).join(".");
        const localAddr = localAddrs.find((a) => a.startsWith(targetBase + "."));
        return probeSNMP(ip, localAddr);
    });
    return results.filter(Boolean);
}
function expandIpBases(explicitBase, discoveredBases) {
    const bases = explicitBase
        ? explicitBase.split(",").map((x) => x.trim()).filter(Boolean)
        : discoveredBases;
    const ips = [];
    for (const base of bases) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(base)) {
            ips.push(base);
            continue;
        }
        for (let i = 1; i <= 254; i++)
            ips.push(`${base}.${i}`);
    }
    return ips;
}
async function probeSNMP(ip, localAddress) {
    const payload = buildSnmpGetSysDescr(process.env.SNMP_COMMUNITY || "public");
    const response = await udpRequest(ip, 161, payload, 500, localAddress);
    if (!response)
        return null;
    const descr = parseSnmpSysDescr(response);
    if (!descr)
        return null;
    const model = descr.length > 80 ? descr.slice(0, 80) : descr;
    return {
        ip,
        hostname: ip,
        name: `SNMP Device (${ip})`,
        driver: "wia",
        protocol: "snmp",
        source: "network",
        online: true,
        confidence: 70,
        manufacturer: guessManufacturer(descr),
        model,
        raw: { sysDescr: descr },
    };
}
function buildSnmpGetSysDescr(community) {
    const oid = Buffer.from([0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00]); // 1.3.6.1.2.1.1.1.0
    const varBind = seq(Buffer.concat([oidTag(oid), Buffer.from([0x05, 0x00])]));
    const varBinds = seq(varBind);
    const requestId = intTag(1);
    const error = intTag(0);
    const errorIndex = intTag(0);
    const pduInner = Buffer.concat([requestId, error, errorIndex, varBinds]);
    const pdu = tag(0xa0, pduInner);
    const version = intTag(0);
    const comm = octetString(Buffer.from(community, "utf8"));
    return seq(Buffer.concat([version, comm, pdu]));
}
function parseSnmpSysDescr(buf) {
    const s = buf.toString("latin1");
    const match = s.match(/[\x20-\x7e]{6,}/g);
    if (!match?.length)
        return null;
    const candidate = match.find((x) => /kyocera|canon|hp|brother|epson|xerox|ricoh|scanner|printer/i.test(x)) || match.at(-1);
    return candidate?.trim() || null;
}
function seq(inner) { return tag(0x30, inner); }
function intTag(n) { return tag(0x02, Buffer.from([n])); }
function octetString(inner) { return tag(0x04, inner); }
function oidTag(inner) { return tag(0x06, inner); }
function tag(t, inner) {
    const len = inner.length < 128 ? Buffer.from([inner.length]) : Buffer.from([0x81, inner.length]);
    return Buffer.concat([Buffer.from([t]), len, inner]);
}
function udpRequest(host, port, payload, timeoutMs, localAddress) {
    return new Promise((resolve) => {
        const sock = dgram.createSocket("udp4");
        let done = false;
        const finish = (value) => {
            if (done)
                return;
            done = true;
            try {
                sock.close();
            }
            catch { }
            resolve(value);
        };
        sock.on("message", (msg) => finish(msg));
        sock.on("error", () => finish(null));
        // Bind to the specific local interface so packets go out the right NIC
        sock.bind(0, localAddress || "0.0.0.0", () => {
            sock.send(payload, port, host, (err) => {
                if (err)
                    finish(null);
            });
        });
        setTimeout(() => finish(null), timeoutMs);
    });
}
// ── Local WIA/TWAIN Discovery ─────────────────────────────────────────────────
async function discoverLocalWIA() {
    if (process.platform !== "win32")
        return [];
    const script = String.raw `
$wia = New-Object -ComObject WIA.DeviceManager
$list = @()
foreach ($dev in $wia.DeviceInfos) {
  $name = $dev.Properties.Item("Name").Value
  $id = $dev.DeviceID
  $type = $dev.Type
  $list += [PSCustomObject]@{ name=$name; id=$id; type=$type }
}
$list | ConvertTo-Json -Compress`;
    const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 });
    const parsed = parseJsonArray(stdout);
    return parsed.map((d) => ({
        ip: "127.0.0.1",
        hostname: os.hostname(),
        name: d.name || "WIA Scanner",
        driver: "wia",
        protocol: "wia",
        source: "local",
        online: true,
        confidence: 100,
        raw: d,
    }));
}
async function discoverLocalTWAIN() {
    if (process.platform !== "win32")
        return [];
    const script = String.raw `
$paths = @("HKLM:\SOFTWARE\TWAIN\DSM","HKLM:\SOFTWARE\WOW6432Node\TWAIN\DSM")
$list = @()
foreach ($p in $paths) {
  if (Test-Path $p) {
    Get-ChildItem $p -ErrorAction SilentlyContinue | ForEach-Object {
      $list += [PSCustomObject]@{ name=$_.PSChildName; path=$_.Name }
    }
  }
}
$list | ConvertTo-Json -Compress`;
    const { stdout } = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 });
    const parsed = parseJsonArray(stdout);
    return parsed.map((d) => ({
        ip: "127.0.0.1",
        hostname: os.hostname(),
        name: d.name || "TWAIN Scanner",
        driver: "twain",
        protocol: "twain",
        source: "local",
        online: true,
        confidence: 95,
        raw: d,
    }));
}
function parseJsonArray(text) {
    const raw = String(text || "").trim();
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    }
    catch {
        return [];
    }
}
// ── IP probing / fallback ─────────────────────────────────────────────────────
async function probeIPs(ips) {
    const results = await promisePool(ips, 12, async (ip) => probeSingleIp(ip));
    return results.filter(Boolean);
}
async function probeSingleIp(ip) {
    const ports = [80, 443, 515, 631, 9100];
    const open = await Promise.all(ports.map((port) => checkTcpPort(ip, port, 350).then((ok) => ok ? port : null)));
    const openPorts = open.filter(Boolean);
    if (!openPorts.length)
        return null;
    return {
        ip,
        hostname: ip,
        name: `Network MFP (${ip})`,
        driver: "wia",
        protocol: "tcp",
        source: "manual",
        online: true,
        confidence: 60,
        raw: { openPorts },
    };
}
function guessManufacturer(text) {
    const lower = text.toLowerCase();
    if (lower.includes("kyocera"))
        return "Kyocera";
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
    return null;
}
async function promisePool(items, concurrency, worker) {
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
export default r;
