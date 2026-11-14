// scripts/turnos_tunel.cjs
// Túnel RÁPIDO de Cloudflare (sin dominio, gratis) para la página pública de turnos (publico/turnosPublicoServer.ts).
// Lo corre pm2 (turnos-tunel-dev); al reiniciar el servidor pm2 lo levanta solo.
// Cada vez que arranca, Cloudflare da una dirección NUEVA (https://xxxx.trycloudflare.com): este script la lee
// y la guarda en app_runtime_config.agenda_turnos.url_publica, así los enlaces salen siempre con la vigente.
// OJO: los enlaces mandados con la dirección anterior dejan de abrir → reenviarlos desde la ficha (mismo token).
// Cuando haya dominio propio se reemplaza por un túnel con nombre (dirección fija) y este script deja de usarse.
//
// Variables (.env): TURNOS_PUBLICO_PORT (3010), CLOUDFLARED_EXE (ruta), DB_*.
const { spawn } = require('child_process');
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

// La red del hospital bloquea QUIC (UDP): va por HTTP/2 (443)
const cf = spawn(EXE, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${PORT}`], { windowsHide: true });
let guardada = false;
const leer = (buf) => {
  const s = buf.toString();
  process.stdout.write(s);
  const m = !guardada && s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) {
    guardada = true;
    guardarUrl(m[0]).catch(err => { log(`ERROR guardando la URL: ${err.message}`); guardada = false; });
  }
};
cf.stdout.on('data', leer);
cf.stderr.on('data', leer);
cf.on('exit', (code) => { log(`cloudflared terminó (código ${code}); pm2 lo vuelve a levantar`); process.exit(1); });
const cortar = () => { try { cf.kill(); } catch { /* noop */ } process.exit(0); };
process.on('SIGINT', cortar);
process.on('SIGTERM', cortar);
log(`Túnel rápido → http://127.0.0.1:${PORT} (${EXE})`);
