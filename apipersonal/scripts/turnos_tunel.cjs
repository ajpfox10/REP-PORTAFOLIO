// scripts/turnos_tunel.cjs
// Túnel RÁPIDO de Cloudflare (sin dominio, gratis) para la página pública de turnos (publico/turnosPublicoServer.ts).
// Lo corre pm2 (turnos-tunel-dev / turnos-tunel-prod); al reiniciar el servidor pm2 lo levanta solo.
// Cada vez que arranca, Cloudflare da una dirección NUEVA (https://xxxx.trycloudflare.com): este script la lee
// y la guarda en app_runtime_config.agenda_turnos.url_publica, así los enlaces salen siempre con la vigente.
// OJO: los enlaces mandados con la dirección anterior dejan de abrir → reenviarlos desde la ficha (mismo token).
// Cuando haya dominio propio se reemplaza por un túnel con nombre (dirección fija) y este script deja de usarse.
//
// Variables (.env): TURNOS_PUBLICO_PORT (3010), CLOUDFLARED_EXE (ruta), DB_*.
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// prod 3011 / dev 3010 (mismo criterio que publico/turnosPublicoServer.ts)
const PORT = Number(process.env.TURNOS_PUBLICO_PORT || (process.env.NODE_ENV === 'production' ? 3011 : 3010));
const EXE = process.env.CLOUDFLARED_EXE
  || ['C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'].find(p => fs.existsSync(p))
  || 'cloudflared';
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

async function guardarUrl(url) {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const [r] = await c.query(`SELECT config_json FROM app_runtime_config WHERE config_key = 'agenda_turnos'`);
    const cfg = r[0] ? (typeof r[0].config_json === 'string' ? JSON.parse(r[0].config_json) : r[0].config_json) || {} : {};
    const anterior = cfg.url_publica || '';
    if (anterior && !/\.trycloudflare\.com$/i.test(anterior)) {
      // ya hay una dirección fija (dominio propio): el túnel rápido no la pisa
      log(`Hay dirección fija (${anterior}): no se cambia. Este túnel rápido (${url}) queda sin usar.`);
      return;
    }
    cfg.url_publica = url;
    cfg.url_publica_temporal = true;
    cfg.url_publica_desde = new Date().toISOString();
    if (anterior && anterior !== url) cfg.url_publica_anterior = anterior;
    await c.query(
      `INSERT INTO app_runtime_config (config_key, config_json, created_at, updated_at) VALUES ('agenda_turnos', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()`, [JSON.stringify(cfg)]);
    log(`url_publica = ${url} (base ${process.env.DB_NAME}${anterior && anterior !== url ? `, antes ${anterior}` : ''})`);
  } finally { await c.end(); }
}

// ── Procesos ─────────────────────────────────────────────────────────────────
// En Windows matar un proceso NO mata a sus hijos, y pm2 a veces da por terminado un túnel que sigue vivo
// (24/11/2026: quedaron 3 cloudflared a la vez, cada uno con su dirección, y pm2 levantó dos instancias juntas).
// Por eso: (1) el túnel caído se reinicia ADENTRO de este proceso (no se sale para que pm2 lo levante),
// (2) cloudflared se mata siempre con taskkill /T /F (árbol completo), (3) al arrancar se limpian los
// cloudflared huérfanos de este puerto y (4) si pm2 ya tiene otra instancia como la vigente, esta se apaga sola.
function matarArbol(pid) {
  if (!pid) return;
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
  } catch { /* noop */ }
}

function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function procesos(filtroPs) {
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { ${filtroPs} } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`],
      { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    const txt = (r.stdout || '').trim();
    if (!txt) return [];
    const j = JSON.parse(txt);
    return Array.isArray(j) ? j : [j];
  } catch { return []; }
}

// cloudflared de ESTE puerto cuyo padre ya no existe (o no es un turnos_tunel vivo) → huérfano
function limpiarCloudflaredHuerfanos() {
  const lista = procesos(`$_.Name -eq 'cloudflared.exe' -and $_.CommandLine -match '--url http://127\\.0\\.0\\.1:${PORT}(\\s|$)'`);
  for (const p of lista) {
    const padre = p.ParentProcessId;
    if (padre === process.pid) continue;
    const padreEsTunel = vivo(padre) && procesos(`$_.ProcessId -eq ${padre}`).some(x => /turnos_tunel\.cjs/i.test(x.CommandLine || ''));
    if (!padreEsTunel) {
      log(`cloudflared huérfano (pid ${p.ProcessId}, padre ${padre} ya no está): se mata`);
      matarArbol(p.ProcessId);
    }
  }
}

// ¿pm2 tiene a OTRA instancia viva como la vigente de esta app? (pid file de pm2)
function soyHuerfano() {
  const nombre = process.env.name;
  const id = process.env.pm_id;
  if (!nombre || id === undefined) return false; // no corre bajo pm2
  try {
    const home = process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
    const pid = Number(fs.readFileSync(path.join(home, 'pids', `${nombre}-${id}.pid`), 'utf8').trim());
    return !!pid && pid !== process.pid && vivo(pid);
  } catch { return false; }
}

// ── Túnel ────────────────────────────────────────────────────────────────────
// La red del hospital bloquea QUIC (UDP): va por HTTP/2 (443)
// Auto-reinicio: Cloudflare da de baja los túneles rápidos cada tanto (pasó 13/11 y 18/11) y cloudflared se queda
// reintentando para siempre con "Tunnel not found". Si aparece 3 veces en 15 min se mata cloudflared y se pide
// una dirección nueva (que se guarda sola). Los enlaces ya mandados hay que reenviarlos desde la ficha.
const NOT_FOUND_MAX = 3;
const NOT_FOUND_VENTANA_MS = 15 * 60 * 1000;
let cf = null;
let guardada = false;
let notFound = [];
let reiniciando = false;
let saliendo = false;
let fallosSeguidos = 0;
let ultimoArranque = 0;

function apagar(motivo, codigo = 0) {
  if (saliendo) return;
  saliendo = true;
  log(motivo);
  if (cf) matarArbol(cf.pid);
  process.exit(codigo);
}

function reiniciarTunel(motivo) {
  if (reiniciando || saliendo) return;
  reiniciando = true;
  log(motivo);
  const viejo = cf;
  cf = null;
  if (viejo) matarArbol(viejo.pid);
  // Si un arranque dura poco, esperar más antes del siguiente (red caída, etc.)
  const espera = fallosSeguidos >= 5 ? 60_000 : 10_000;
  setTimeout(() => {
    reiniciando = false;
    if (soyHuerfano()) return apagar('pm2 ya tiene otra instancia de este túnel como la vigente: esta se apaga');
    arrancar();
  }, espera);
}

function arrancar() {
  limpiarCloudflaredHuerfanos();
  guardada = false;
  notFound = [];
  ultimoArranque = Date.now();
  log(`Túnel rápido → http://127.0.0.1:${PORT} (${EXE})`);
  const hijo = spawn(EXE, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${PORT}`], { windowsHide: true });
  cf = hijo;

  const vigilar = (s) => {
    if (reiniciando || cf !== hijo || !/Tunnel not found/i.test(s)) return;
    const ahora = Date.now();
    notFound = notFound.filter(t => ahora - t < NOT_FOUND_VENTANA_MS);
    notFound.push(ahora);
    if (notFound.length >= NOT_FOUND_MAX) {
      fallosSeguidos = 0;
      reiniciarTunel(`Cloudflare dio de baja el túnel ("Tunnel not found" x${notFound.length}): se mata cloudflared (pid ${hijo.pid}) y se pide una dirección nueva`);
    }
  };

  const leer = (buf) => {
    if (cf !== hijo) return; // salida de un cloudflared viejo
    const s = buf.toString();
    process.stdout.write(s);
    vigilar(s);
    const m = !guardada && s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      if (soyHuerfano()) return apagar('pm2 ya tiene otra instancia de este túnel como la vigente: esta se apaga sin guardar su dirección');
      guardada = true;
      fallosSeguidos = 0;
      guardarUrl(m[0]).catch(err => { log(`ERROR guardando la URL: ${err.message}`); guardada = false; });
    }
  };
  hijo.stdout.on('data', leer);
  hijo.stderr.on('data', leer);
  hijo.on('exit', (code) => {
    if (cf !== hijo || saliendo) return; // ya reemplazado o apagando
    if (Date.now() - ultimoArranque < 60_000) fallosSeguidos++;
    reiniciarTunel(`cloudflared terminó solo (código ${code}): se vuelve a levantar`);
  });
  hijo.on('error', (err) => {
    if (cf !== hijo || saliendo) return;
    fallosSeguidos++;
    reiniciarTunel(`no se pudo ejecutar cloudflared (${err.message}): reintento`);
  });
}

process.on('SIGINT', () => apagar('SIGINT: se apaga el túnel'));
process.on('SIGTERM', () => apagar('SIGTERM: se apaga el túnel'));
process.on('SIGBREAK', () => apagar('SIGBREAK: se apaga el túnel'));
// Pase lo que pase al salir, cloudflared no queda vivo
process.on('exit', () => { if (cf) matarArbol(cf.pid); });

arrancar();
