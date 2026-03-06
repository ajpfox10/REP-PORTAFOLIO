#!/usr/bin/env node
/**
 * @file scripts/arranque.mjs
 * @description Wizard de gestion completo para la API PersonalV5.
 *
 * USO: desde la raiz del proyecto (donde esta package.json):
 *   npm run arranque
 *   node scripts/arranque.mjs
 *
 * IMPORTANTE - correr desde la RAIZ del proyecto, no desde src/
 */

import readline from 'node:readline';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// ─── Helpers basicos ──────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));
const yn  = (s, def = true) => !s ? def : ['y','yes','s','si','sí','1'].includes(s.toLowerCase().trim());

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

// Lee el .env y carga variables que no esten ya en process.env
function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!exists(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (process.env[m[1]] == null) process.env[m[1]] = val;
  }
}

// Verifica que estamos en la raiz del proyecto
function assertRoot() {
  const pkg = path.resolve(process.cwd(), 'package.json');
  if (!exists(pkg)) {
    console.error('\n❌ ERROR: No se encontro package.json en este directorio.');
    console.error('   Corré este comando desde la RAIZ del proyecto.');
    console.error(`   Directorio actual: ${process.cwd()}`);
    console.error('\n   Ejemplo correcto:');
    console.error('     cd C:\\Users\\Administrator\\Desktop\\back_v9_completo');
    console.error('     npm run arranque\n');
    process.exit(1);
  }
}

// Lee scripts del package.json
function getScripts() {
  try { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')).scripts || {}; }
  catch { return {}; }
}
const hasScript = (name) => !!getScripts()[name];

// Ejecuta un comando y espera que termine (bloqueante)
function run(cmd, args = [], opts = {}) {
  const actualCmd = IS_WIN && cmd === 'npm' ? 'npm.cmd' : cmd;
  const r = spawnSync(actualCmd, args, {
    stdio: 'inherit',
    shell: IS_WIN,  // En Windows necesitamos shell para algunos comandos
    ...opts
  });
  return { ok: r.status === 0, code: r.status ?? -1 };
}

// Ejecuta en background (no bloqueante - para "start" en produccion)
function runBackground(cmd, args = [], envVars = {}) {
  const actualCmd = IS_WIN ? 'cmd.exe' : cmd;
  const actualArgs = IS_WIN ? ['/c', cmd === 'npm' ? 'npm.cmd' : cmd, ...args] : args;
  return spawn(actualCmd, actualArgs, {
    stdio: 'inherit',
    shell: false,
    detached: false,
    env: { ...process.env, ...envVars },
  });
}

// Borra un directorio
function rmDir(dirPath) {
  if (!exists(dirPath)) return;
  try { fs.rmSync(dirPath, { recursive: true, force: true }); }
  catch {
    if (IS_WIN) spawnSync('cmd.exe', ['/c', 'rmdir', '/s', '/q', dirPath], { shell: false });
    else spawnSync('rm', ['-rf', dirPath]);
  }
}

// Prueba un endpoint HTTP, reintenta N veces
async function probe(baseUrl, paths, retries = 30, delay = 300) {
  let last = {};
  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, delay));
    let allOk = true;
    for (const p of paths) {
      try {
        const ok = await new Promise((res) => {
          const req = http.get(baseUrl + p, (r) => {
            res(r.statusCode < 500);
          });
          req.on('error', () => res(false));
          req.setTimeout(2000, () => { req.destroy(); res(false); });
        });
        last[p] = ok ? '✅' : '❌';
        if (!ok) allOk = false;
      } catch { last[p] = '❌'; allOk = false; }
    }
    if (allOk) return { ok: true, last };
    if (i % 5 === 4) process.stdout.write('.');
  }
  return { ok: false, last };
}

// ─── Opciones del wizard ──────────────────────────────────────────────────────

// Genera el manifest de auto-routes si existe el script
async function ensureGenRoutes() {
  if (hasScript('gen:routes')) {
    console.log('📝 Generando manifest de rutas...');
    const r = run('npm', ['run', 'gen:routes']);
    if (!r.ok) { console.error('❌ gen:routes fallo'); return false; }
  }
  return true;
}

// Limpia dist/ y .cache/
async function doClean() {
  rmDir(path.resolve(process.cwd(), 'dist'));
  rmDir(path.resolve(process.cwd(), '.cache'));
  console.log('✅ Clean OK (dist/ y .cache/ eliminados)');
  return true;
}

// ── Opcion 12: Instalar base de datos ──────────────────────────────────────────
async function installDatabase() {
  console.log('\n🗄️  Instalacion de Base de Datos\n');

  const defHost = process.env.DB_HOST || '127.0.0.1';
  const defPort = process.env.DB_PORT || '3306';
  const defUser = process.env.DB_USER || 'root';
  const defDb   = process.env.DB_NAME || 'personalv5';

  const host   = (await ask(`Host MySQL [${defHost}]: `)) || defHost;
  const port   = (await ask(`Puerto    [${defPort}]: `)) || defPort;
  const user   = (await ask(`Usuario   [${defUser}]: `)) || defUser;
  const pw     = await ask('Password MySQL (Enter para vacio): ');
  const dbName = (await ask(`Nombre BD [${defDb}]: `)) || defDb;

  const mysqlCmd = IS_WIN ? 'mysql.exe' : 'mysql';
  const connArgs = [`-h${host}`, `-P${port}`, `-u${user}`, pw ? `-p${pw}` : '', '--batch', '--silent'].filter(Boolean);

  // Verificar que mysql CLI este disponible
  const test = spawnSync(mysqlCmd, [...connArgs, '-e', 'SELECT 1;'], { stdio: ['pipe','pipe','pipe'] });
  if (test.status !== 0) {
    const errMsg = test.stderr?.toString().trim() || 'Error desconocido';
    console.error(`\n❌ No pudo conectar a MySQL: ${errMsg}`);
    console.error('\n  Verificá:');
    console.error('  1. MySQL está corriendo (services.msc → MySQL)');
    console.error('  2. El usuario y contraseña son correctos');
    console.error('  3. mysql.exe está en el PATH de Windows');
    console.error('     (agregar C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin al PATH)');
    return;
  }

  // Crear base de datos
  console.log(`\n  Creando base de datos "${dbName}"...`);
  const r1 = spawnSync(mysqlCmd, [...connArgs, '-e',
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`
  ], { stdio: ['pipe','pipe','pipe'] });

  if (r1.status !== 0) {
    console.error('❌ Error:', r1.stderr?.toString().trim());
    return;
  }
  console.log(`  ✅ Base de datos "${dbName}" lista`);

  // Correr migraciones SQL (scripts/migrations/*.sql)
  const migrDir = path.resolve(process.cwd(), 'scripts/migrations');
  if (exists(migrDir)) {
    const sqlFiles = fs.readdirSync(migrDir)
      .filter(f => f.toLowerCase().endsWith('.sql'))
      .sort();

    if (sqlFiles.length > 0) {
      console.log(`\n  Ejecutando ${sqlFiles.length} archivos SQL de migracion...`);
      for (const f of sqlFiles) {
        const sql = fs.readFileSync(path.join(migrDir, f), 'utf8');
        const r = spawnSync(mysqlCmd, [...connArgs, dbName], {
          input: sql,
          stdio: ['pipe','pipe','pipe'],
        });
        if (r.status !== 0) {
          const warn = r.stderr?.toString().trim().split('\n')[0] || '';
          console.log(`  ⚠️  ${f}: ${warn.substring(0, 100)}`);
        } else {
          console.log(`  ✅ ${f}`);
        }
      }
    }
  }

  // Correr tambien las migraciones de src/db/migrations/
  const dbMigrDir = path.resolve(process.cwd(), 'src/db/migrations');
  if (exists(dbMigrDir)) {
    const sqlFiles = fs.readdirSync(dbMigrDir)
      .filter(f => f.toLowerCase().endsWith('.sql'))
      .sort();
    if (sqlFiles.length > 0) {
      console.log(`\n  Ejecutando ${sqlFiles.length} migraciones de src/db/migrations/...`);
      for (const f of sqlFiles) {
        const sql = fs.readFileSync(path.join(dbMigrDir, f), 'utf8');
        const r = spawnSync(mysqlCmd, [...connArgs, dbName], {
          input: sql,
          stdio: ['pipe','pipe','pipe'],
        });
        console.log(r.status === 0 ? `  ✅ ${f}` : `  ⚠️  ${f} (puede ser que ya exista)`);
      }
    }
  }

  console.log(`\n✅ Base de datos lista. Siguiente: opcion 13 (crear admin)\n`);
}

// ── Opcion 13: Crear admin ──────────────────────────────────────────────────
async function createAdmin() {
  console.log('\n👤 Crear usuario administrador\n');
  const scripts = ['seed:admin', 'user:create', 'seedAdmin'];
  for (const s of scripts) {
    if (hasScript(s)) {
      console.log(`  Ejecutando: npm run ${s}...`);
      const r = run('npm', ['run', s]);
      if (r.ok) console.log('  ✅ Admin creado exitosamente');
      else console.log(`  ❌ Fallo (codigo ${r.code})`);
      return;
    }
  }
  // Script directo
  const seedPath = path.resolve(process.cwd(), 'scripts/seedAdmin.mjs');
  if (exists(seedPath)) {
    const r = run('node', [seedPath]);
    console.log(r.ok ? '✅ Admin creado' : `❌ Error (codigo ${r.code})`);
    return;
  }
  console.log('⚠️  No se encontro script de creacion de admin.');
  console.log('   Intentá: node scripts/createUser.mjs');
}

// ── Opcion 14: Backup ─────────────────────────────────────────────────────────
async function doBackup() {
  console.log('\n💾 Backup de base de datos\n');

  // Scripts predefinidos
  if (IS_WIN && hasScript('backup:win')) { run('npm', ['run', 'backup:win']); return; }
  if (!IS_WIN && hasScript('backup:linux')) { run('npm', ['run', 'backup:linux']); return; }
  if (hasScript('backup')) { run('npm', ['run', 'backup']); return; }

  // Backup manual con mysqldump
  const backupDir = path.resolve(process.cwd(), 'backups');
  if (!exists(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(backupDir, `${process.env.DB_NAME || 'personalv5'}-${ts}.sql`);
  const dumpCmd = IS_WIN ? 'mysqldump.exe' : 'mysqldump';
  const pw = process.env.DB_PASSWORD || '';
  const args = [
    `-h${process.env.DB_HOST || '127.0.0.1'}`,
    `-P${process.env.DB_PORT || '3306'}`,
    `-u${process.env.DB_USER || 'root'}`,
    pw ? `-p${pw}` : '',
    '--single-transaction', '--quick', '--routines', '--triggers',
    process.env.DB_NAME || 'personalv5',
  ].filter(Boolean);

  console.log(`  Generando backup en: ${outFile}`);
  const fd = fs.openSync(outFile, 'w');
  const r = spawnSync(dumpCmd, args, { stdio: ['pipe', fd, 'pipe'] });
  fs.closeSync(fd);

  if (r.status === 0) {
    const kb = Math.round(fs.statSync(outFile).size / 1024);
    console.log(`  ✅ Backup guardado: ${path.basename(outFile)} (${kb} KB)`);
  } else {
    fs.unlinkSync(outFile);
    console.error(`  ❌ Error en backup: ${r.stderr?.toString().trim()}`);
    console.error('\n  Verificá que mysqldump.exe está en el PATH de Windows.');
    console.error('  (C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin)');
  }
}

// ── Opcion 15: Restaurar backup ────────────────────────────────────────────────
async function doRestore() {
  const backupDir = path.resolve(process.cwd(), 'backups');
  if (!exists(backupDir)) { console.log('\n  No hay directorio de backups.'); return; }
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql')).sort().reverse();
  if (!files.length) { console.log('\n  No hay archivos .sql en backups/'); return; }

  console.log('\n🔄 Restaurar backup\n');
  files.slice(0, 10).forEach((f, i) => {
    const kb = Math.round(fs.statSync(path.join(backupDir, f)).size / 1024);
    console.log(`  ${i+1}) ${f} (${kb} KB)`);
  });

  const sel = parseInt(await ask('\n  Elegí número: '), 10) - 1;
  if (sel < 0 || sel >= files.length) { console.log('  Selección inválida.'); return; }

  const file = path.join(backupDir, files[sel]);
  const db = process.env.DB_NAME || 'personalv5';
  const sure = yn(await ask(`\n  ⚠️  Esto REEMPLAZA "${db}". ¿Confirmar? (s/N): `), false);
  if (!sure) { console.log('  Cancelado.'); return; }

  const mysqlCmd = IS_WIN ? 'mysql.exe' : 'mysql';
  const pw = process.env.DB_PASSWORD || '';
  const args = [
    `-h${process.env.DB_HOST || '127.0.0.1'}`,
    `-P${process.env.DB_PORT || '3306'}`,
    `-u${process.env.DB_USER || 'root'}`,
    pw ? `-p${pw}` : '', db
  ].filter(Boolean);

  const fd = fs.openSync(file, 'r');
  const r = spawnSync(mysqlCmd, args, { stdio: [fd, 'inherit', 'pipe'] });
  fs.closeSync(fd);
  console.log(r.status === 0 ? '\n  ✅ Restauracion exitosa' : `\n  ❌ Error: ${r.stderr?.toString().trim()}`);
}

// ── Opcion 17: Diagnostico ─────────────────────────────────────────────────────
async function diagnostico() {
  console.log('\n🔍 Diagnóstico del sistema\n');
  loadDotEnv();

  const checks = [];
  const check = (name, ok, detail, warn = false) => checks.push({ name, ok, detail, warn });

  // Node version
  const nv = parseInt(process.version.slice(1));
  check('Node.js version', nv >= 18, `${process.version}${nv < 18 ? ' ← requiere >=18' : ''}`, nv < 18);

  // package.json
  check('package.json', exists(path.resolve(process.cwd(), 'package.json')), exists(path.resolve(process.cwd(), 'package.json')) ? 'OK' : 'FALTA');

  // .env
  const envOk = exists(path.resolve(process.cwd(), '.env'));
  check('.env', envOk, envOk ? 'OK' : 'FALTA - copiá .env.example a .env y completá las variables');

  // node_modules
  const nmOk = exists(path.resolve(process.cwd(), 'node_modules'));
  check('node_modules', nmOk, nmOk ? 'OK' : 'FALTA - corré: npm install');

  // dist/ (build)
  const distOk = exists(path.resolve(process.cwd(), 'dist'));
  check('dist/ (build compilado)', distOk, distOk ? 'OK' : 'Sin build - corré: npm run build', true);

  // DOCUMENTS_BASE_DIR
  const docDir = process.env.DOCUMENTS_BASE_DIR;
  const docDirOk = docDir && exists(docDir);
  check('DOCUMENTS_BASE_DIR', !!docDirOk,
    docDir ? (docDirOk ? `${docDir} ✓` : `${docDir} ← NO EXISTE en este servidor`) : 'No configurado en .env',
    !docDirOk);

  // MySQL
  try {
    const mysqlCmd = IS_WIN ? 'mysql.exe' : 'mysql';
    const pw = process.env.DB_PASSWORD || '';
    const args = [
      `-h${process.env.DB_HOST || '127.0.0.1'}`,
      `-P${process.env.DB_PORT || '3306'}`,
      `-u${process.env.DB_USER || 'root'}`,
      pw ? `-p${pw}` : '', '-e', 'SELECT 1;', '--silent', '--batch'
    ].filter(Boolean);
    const r = spawnSync(mysqlCmd, args, { stdio: ['pipe','pipe','pipe'], timeout: 5000 });
    check('MySQL conectividad', r.status === 0,
      r.status === 0 ? `${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '3306'} ✓` :
      `Sin conexión - ${r.stderr?.toString().trim().split('\n')[0] || 'error'}`);
  } catch { check('MySQL conectividad', false, 'mysql CLI no encontrado en PATH'); }

  // Redis (opcional)
  try {
    const r = spawnSync(IS_WIN ? 'redis-cli.exe' : 'redis-cli', ['ping'], { stdio: ['pipe','pipe','pipe'], timeout: 2000 });
    const ok = r.stdout?.toString().trim() === 'PONG';
    check('Redis (opcional)', ok, ok ? 'Conectado' : 'No disponible (solo necesario si RATE_LIMIT_USE_REDIS=true)', true);
  } catch { check('Redis (opcional)', false, 'No instalado (opcional)', true); }

  // API /health
  const port = Number(process.env.PORT || 3000);
  const alive = await new Promise((res) => {
    const r = http.get(`http://localhost:${port}/health`, (resp) => res(resp.statusCode < 500));
    r.on('error', () => res(false));
    r.setTimeout(2000, () => { r.destroy(); res(false); });
  });
  check('API /health', !!alive, alive ? `http://localhost:${port}/health ✓` : 'No responde (normal si no está corriendo)', true);

  // Mostrar resultados
  console.log('');
  for (const c of checks) {
    const icon = c.ok ? '✅' : c.warn ? '⚠️ ' : '❌';
    console.log(`  ${icon}  ${c.name.padEnd(28)} ${c.detail}`);
  }

  const fails = checks.filter(c => !c.ok && !c.warn).length;
  const warns = checks.filter(c => !c.ok && c.warn).length;
  console.log(`\n  ${fails === 0 ? '✅ Todo OK' : `❌ ${fails} problema(s) critico(s)`} | ⚠️  ${warns} advertencia(s)\n`);
}

// ── Opcion 18: Documentos huerfanos ───────────────────────────────────────────
async function orphanDocs() {
  console.log('\n📁 Documentos registrados sin archivo físico en disco\n');
  const baseDir = process.env.DOCUMENTS_BASE_DIR;
  if (!baseDir) {
    console.log('  ⚠️  DOCUMENTS_BASE_DIR no está configurado en .env');
    return;
  }
  if (!exists(baseDir)) {
    console.log(`  ❌ El directorio no existe: ${baseDir}`);
    console.log('     Configurá DOCUMENTS_BASE_DIR en .env con la ruta real donde están los PDFs');
    return;
  }

  // Contar archivos disponibles
  let fileCount = 0;
  const countFiles = (dir, depth = 0) => {
    if (depth > 3) return;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile()) fileCount++;
        else if (e.isDirectory()) countFiles(path.join(dir, e.name), depth + 1);
      }
    } catch {}
  };
  countFiles(baseDir);
  console.log(`  📂 ${baseDir}`);
  console.log(`  📄 Archivos encontrados en disco: ${fileCount}\n`);
  console.log('  Para ver qué registros en la BD no tienen archivo, ejecuta esta query en MySQL:\n');
  console.log(`  SELECT id, dni, nombre, ruta, nombre_archivo_original`);
  console.log(`  FROM tblarchivos`);
  console.log(`  WHERE deleted_at IS NULL`);
  console.log(`  AND (ruta REGEXP '^[0-9]+$' OR ruta = '')`);
  console.log(`  ORDER BY id;\n`);
  console.log('  Los registros con ruta numérica ("3", "127") son documentos históricos sin archivo digital.');
  console.log('  Los registros con ruta tipo "D:\\G\\RESOLUCIONES Y VARIOS\\..." deberian funcionar si el');
  console.log(`  servidor puede acceder a esa ruta y DOCUMENTS_BASE_DIR=D:\\G`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  assertRoot();
  loadDotEnv();

  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
  const domain = process.env.DOMAIN || 'personalv5';
  const nodeEnv = process.env.NODE_ENV || 'development';

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   PersonalV5 API — Wizard de gestión     ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  version: ${(pkg.version || '?').padEnd(8)} dominio: ${domain.padEnd(15)}║`);
  console.log(`║  entorno: ${nodeEnv.padEnd(30)} ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  console.log('  ─── Desarrollo ──────────────────────────');
  console.log('   1) Iniciar en modo DESARROLLO (npm run dev)');
  console.log('   2) Tests unitarios (npm test)');
  console.log('   3) Tests con integracion a BD');
  console.log('   4) Build de produccion (compilar TypeScript)');
  console.log('   5) Deploy: build + iniciar en PRODUCCION');
  console.log('   6) Lint y typecheck');
  console.log('   7) Clean (borrar dist/ y .cache/)');
  console.log('   8) Exportar OpenAPI a YAML');
  console.log('   9) Smoke test (verificar /health y /ready)');
  console.log('  10) Reset cache de schema de BD');
  console.log('  ─── Base de datos ───────────────────────');
  console.log('  11) 🗄️  Instalar base de datos (crear + migraciones)');
  console.log('  12) 👤 Crear usuario administrador');
  console.log('  13) 💾 Backup manual de la BD');
  console.log('  14) 🔄 Restaurar un backup');
  console.log('  ─── Diagnóstico ─────────────────────────');
  console.log('  15) 🔍 Diagnóstico completo del sistema');
  console.log('  16) 📁 Ver documentos sin archivo fisico');

  const action = await ask('\n  Elegí una opción (1-16): ');

  // ── 1: Desarrollo ────────────────────────────────────────────────────────────
  if (action === '1') {
    console.log('\n🚀 Iniciando en modo desarrollo...\n');
    await ensureGenRoutes();
    // Dev usa spawnSync para que la terminal muestre el output en tiempo real
    // y Ctrl+C detiene el servidor correctamente
    run('npm', ['run', 'dev']);
    rl.close();
    return;
  }

  // ── 2: Tests unitarios ───────────────────────────────────────────────────────
  if (action === '2') {
    run('npm', ['test']);
    rl.close();
    return;
  }

  // ── 3: Tests con BD ──────────────────────────────────────────────────────────
  if (action === '3') {
    console.log('\n🧪 Tests con integracion a BD (TEST_INTEGRATION=1)...\n');
    run('npm', ['test'], { env: { ...process.env, TEST_INTEGRATION: '1' } });
    rl.close();
    return;
  }

  // ── 4: Build ─────────────────────────────────────────────────────────────────
  if (action === '4') {
    console.log('\n🔨 Build de produccion...\n');
    await ensureGenRoutes();
    const r = run('npm', ['run', 'build']);
    console.log(r.ok ? '\n✅ Build exitoso (archivos en dist/)' : `\n❌ Build fallo (codigo ${r.code})`);
    rl.close();
    return;
  }

  // ── 5: Deploy / Produccion ────────────────────────────────────────────────────
  if (action === '5') {
    const cleanFirst = yn(await ask('  ¿Hacer clean antes de build? (S/n): '));
    if (cleanFirst) await doClean();
    await ensureGenRoutes();

    console.log('\n🔨 Build...');
    const b = run('npm', ['run', 'build']);
    if (!b.ok) { console.log('❌ Build fallo. No se continua.'); rl.close(); return; }
    console.log('✅ Build OK');

    console.log('\n🚀 Iniciando servidor en modo produccion...');
    const port = Number(process.env.PORT || 3000);
    runBackground('npm', ['run', 'start'], { NODE_ENV: 'production', PORT: String(port) });

    console.log(`  Esperando que el servidor responda en puerto ${port}...`);
    const res = await probe(`http://localhost:${port}`, ['/health', '/ready']);

    if (res.ok) {
      console.log(`\n✅ Servidor corriendo en http://localhost:${port}`);
      console.log(`   /health: ${res.last['/health']}   /ready: ${res.last['/ready']}`);
      console.log('\n   El servidor sigue corriendo en background. Ctrl+C para detener.\n');
    } else {
      console.log('\n❌ El servidor no respondio a tiempo.');
      console.log(`   Resultados: ${JSON.stringify(res.last)}`);
      console.log('   Revisá los logs del servidor para ver el error.');
    }
    rl.close();
    return;
  }

  // ── 6: Lint + typecheck ──────────────────────────────────────────────────────
  if (action === '6') {
    console.log('\n🔍 Lint...');
    run('npm', ['run', 'lint']);
    console.log('\n📝 Typecheck...');
    if (hasScript('typecheck')) run('npm', ['run', 'typecheck']);
    else if (hasScript('lint:types')) run('npm', ['run', 'lint:types']);
    else if (hasScript('lint:types:src')) run('npm', ['run', 'lint:types:src']);
    rl.close();
    return;
  }

  // ── 7: Clean ─────────────────────────────────────────────────────────────────
  if (action === '7') {
    await doClean();
    rl.close();
    return;
  }

  // ── 8: Export OpenAPI ────────────────────────────────────────────────────────
  if (action === '8') {
    if (!exists(path.resolve(process.cwd(), 'dist'))) {
      console.log('  No hay dist/ - haciendo build primero...');
      await ensureGenRoutes();
      run('npm', ['run', 'build']);
    }
    if (hasScript('openapi:export')) run('npm', ['run', 'openapi:export']);
    else console.log('  ⚠️  Script openapi:export no encontrado');
    rl.close();
    return;
  }

  // ── 9: Smoke test ────────────────────────────────────────────────────────────
  if (action === '9') {
    const portStr = await ask(`  Puerto del servidor (Enter = ${process.env.PORT || '3000'}): `);
    const port = Number(portStr || process.env.PORT || 3000);
    console.log(`\n  Probando http://localhost:${port}...`);
    const res = await probe(`http://localhost:${port}`, ['/health', '/ready'], 3, 500);
    console.log(`\n  /health: ${res.last['/health'] || '❌ no responde'}`);
    console.log(`  /ready:  ${res.last['/ready']  || '❌ no responde'}`);
    console.log(res.ok ? '\n  ✅ Servidor OK' : '\n  ❌ Servidor no responde (¿está corriendo?)');
    rl.close();
    return;
  }

  // ── 10: Reset schema cache ────────────────────────────────────────────────────
  if (action === '10') {
    const schemaCache = path.resolve(process.cwd(), '.cache/schema.json');
    if (exists(schemaCache)) {
      fs.unlinkSync(schemaCache);
      console.log('✅ Schema cache eliminado - se regenerara al proxima inicio');
    } else {
      console.log('  No habia schema cache (normal si nunca arranco el servidor)');
    }
    rl.close();
    return;
  }

  // ── 11-14: BD ──────────────────────────────────────────────────────────────
  if (action === '11') { await installDatabase(); rl.close(); return; }
  if (action === '12') { await createAdmin(); rl.close(); return; }
  if (action === '13') { await doBackup(); rl.close(); return; }
  if (action === '14') { await doRestore(); rl.close(); return; }

  // ── 15-16: Diagnostico ────────────────────────────────────────────────────
  if (action === '15') { await diagnostico(); rl.close(); return; }
  if (action === '16') { await orphanDocs(); rl.close(); return; }

  console.log('\n❌ Opción inválida. Elegí un número entre 1 y 16.\n');
  rl.close();
  process.exit(1);
}

main().catch((e) => {
  console.error('\n❌ Error inesperado:', e?.message || e);
  if (e?.stack) console.error(e.stack);
  try { rl.close(); } catch {}
  process.exit(1);
});
