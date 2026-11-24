// watchdog.mjs - vigila pm2. Lo corre la tarea programada "PM2 Watchdog" (cada 30 min + al iniciar sesion).
// Copia de respaldo en C:\apps\personaldev\apipersonal\scripts\pm2-watchdog.mjs (el original se perdio el 21/11/2026).
//
// 1. Daemon muerto o sin apps -> pm2 resurrect. (Mira pm2.pid ANTES de llamar a pm2: un `pm2 ls`
//    con el daemon caido levanta uno nuevo vacio.)
// 2. Apps "errored" -> pm2 restart. Las "stopped" solo se loguean (alguien las paro a proposito).
// 3. HUERFANOS: en Windows pm2 a veces deja vivo el node viejo. Sigue con el puerto y el codigo viejo,
//    y la instancia que pm2 maneja entra en bucle de EADDRINUSE (miles de reinicios).
//    Deteccion: el log de error de la app se escribio hace poco con EADDRINUSE en el puerto N, y el
//    dueno de N es un node hijo del daemon de pm2 que NO es el pid de ninguna app de la lista.
//    Arreglo: pm2 stop app -> matar al dueno del puerto -> pm2 start app (SIN --update-env: la
//    maquina tiene NODE_ENV=production y pisaria el env de las apps dev) -> comprobar pid == dueno.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PM2_HOME = 'C:\\Users\\Administrator\\.pm2';
const LOG = 'C:\\apps\\logs\\pm2-watchdog.log';
const LOG_RECIENTE_MS = 10 * 60 * 1000; // log de error escrito en los ultimos 10 min
const COLA_LOG_BYTES = 6000;

const ts = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const log = (msg) => {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `${ts()} ${msg}\n`);
};
const sh = (cmd, timeout = 60000) =>
  execSync(cmd, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const ps = (script, timeout = 30000) =>
  sh(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, timeout).trim();
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function daemonVivo() {
  try {
    const pid = Number(fs.readFileSync(path.join(PM2_HOME, 'pm2.pid'), 'utf8').trim());
    if (!pid) return 0;
    process.kill(pid, 0);
    return pid;
  } catch {
    return 0;
  }
}

function jlist() {
  const out = sh('pm2 jlist');
  const i = out.indexOf('[');
  return JSON.parse(out.slice(i));
}

function duenoPuerto(puerto) {
  const r = ps(`(Get-NetTCPConnection -LocalPort ${puerto} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`);
  return /^\d+$/.test(r) ? Number(r) : 0;
}

function infoProceso(pid) {
  const r = ps(`$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { '' + $p.ParentProcessId + '|' + $p.Name + '|' + $p.CommandLine }`);
  if (!r) return null;
  const [padre, nombre, ...cmd] = r.split('|');
  return { padre: Number(padre), nombre, cmd: cmd.join('|') };
}

// Puerto del ultimo EADDRINUSE en la cola del log de error, si el log es reciente
function puertoEnConflicto(app) {
  const f = app.pm2_env.pm_err_log_path;
  if (!f || !fs.existsSync(f)) return 0;
  const st = fs.statSync(f);
  if (Date.now() - st.mtimeMs > LOG_RECIENTE_MS) return 0;
  const fd = fs.openSync(f, 'r');
  const n = Math.min(COLA_LOG_BYTES, st.size);
  const buf = Buffer.alloc(n);
  fs.readSync(fd, buf, 0, n, st.size - n);
  fs.closeSync(fd);
  const txt = buf.toString('utf8');
  const ult = txt.lastIndexOf('EADDRINUSE');
  if (ult < 0) return 0;
  const m = txt.slice(ult).match(/EADDRINUSE[^\n]*?:(\d{2,5})\b/) || txt.slice(ult).match(/port:\s*(\d{2,5})/);
  return m ? Number(m[1]) : 0;
}

function sanarHuerfano(app, puerto, daemonPid) {
  const nombre = app.name;
  const envAntes = app.pm2_env.NODE_ENV;
  log(`HUERFANO: ${nombre} en bucle EADDRINUSE :${puerto} (${app.pm2_env.restart_time} reinicios). Reinicio limpio...`);
  sh(`pm2 stop ${nombre}`);
  dormir(2000);
  for (let i = 0; i < 5; i++) {
    const d = duenoPuerto(puerto);
    if (!d) break;
    const inf = infoProceso(d);
    // Solo se mata un node hijo del daemon de pm2: nunca otra cosa que use el puerto
    if (!inf || !/^node(\.exe)?$/i.test(inf.nombre) || inf.padre !== daemonPid) {
      log(`  NO se toca el pid ${d} de :${puerto} (${inf ? inf.nombre + ', padre ' + inf.padre : 'desconocido'}). Queda ${nombre} parada.`);
      return;
    }
    log(`  matando pid ${d}: ${inf.cmd}`);
    try { process.kill(d, 'SIGKILL'); } catch {}
    dormir(2000);
  }
  if (duenoPuerto(puerto)) {
    log(`  ERROR: :${puerto} sigue ocupado. ${nombre} queda parada.`);
    return;
  }
  sh(`pm2 start ${nombre}`);
  let okDesde = 0;
  for (let t = 0; t < 45; t++) {
    dormir(2000);
    const a = jlist().find((x) => x.name === nombre);
    const d = duenoPuerto(puerto);
    if (a && a.pid && d === a.pid) {
      if (!okDesde) okDesde = Date.now();
      else if (Date.now() - okDesde >= 8000) {
        const envDespues = a.pm2_env.NODE_ENV;
        log(`  OK: ${nombre} pid ${a.pid} escuchando :${puerto}` + (envDespues !== envAntes ? ` (OJO NODE_ENV ${envAntes} -> ${envDespues})` : ''));
        return;
      }
    } else okDesde = 0;
  }
  log(`  ERROR: ${nombre} no quedo escuchando :${puerto}. Ver pm2 logs ${nombre}`);
}

function main() {
  let daemonPid = daemonVivo();
  if (!daemonPid) {
    log('daemon pm2 caido -> pm2 resurrect');
    sh('pm2 resurrect', 120000);
    return;
  }
  let apps = jlist();
  if (!apps.length) {
    log('pm2 sin apps -> pm2 resurrect');
    sh('pm2 resurrect', 120000);
    return;
  }

  const errored = apps.filter((a) => a.pm2_env.status === 'errored');
  for (const a of errored) {
    log(`app errored -> restart: ${a.name}`);
    sh(`pm2 restart ${a.name}`);
  }
  const paradas = apps.filter((a) => a.pm2_env.status === 'stopped').map((a) => a.name);
  if (paradas.length) log(`apps detenidas (no se tocan): ${paradas.join(', ')}`);

  // Huerfanos
  const pidsPm2 = new Set(apps.map((a) => a.pid).filter(Boolean));
  for (const a of apps) {
    if (a.pm2_env.status === 'stopped') continue;
    const puerto = puertoEnConflicto(a);
    if (!puerto) continue;
    const d = duenoPuerto(puerto);
    if (!d || pidsPm2.has(d)) continue; // nadie lo tiene, o lo tiene una app legitima de pm2
    const inf = infoProceso(d);
    if (!inf || inf.padre !== daemonPid) continue; // no es un huerfano de pm2
    sanarHuerfano(a, puerto, daemonPid);
  }

  apps = jlist();
  const noOnline = apps.filter((a) => a.pm2_env.status !== 'online');
  if (noOnline.length) log(`  estado final no-online: ${noOnline.map((a) => `${a.name}=${a.pm2_env.status}`).join(', ')}`);
  else log(`OK ${apps.length} apps online`);
}

try {
  main();
} catch (err) {
  log(`ERROR watchdog: ${err.message}`);
}
