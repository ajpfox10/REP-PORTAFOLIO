// crear_usuario_publico.cjs — usuario de MySQL de PERMISOS MÍNIMOS para el servidor público
// (el único proceso expuesto a internet: webhook del bot de WhatsApp + página de la Agenda de turnos).
//
// Uso (lo corre una persona, porque pide la clave de root de MySQL):
//   scripts\crear_usuario_publico.cmd            → dev  (base del .env de dev, usuario wa_publico_dev)
//   scripts\crear_usuario_publico.cmd prod       → prod (base personalv5, usuario wa_publico) — después del deploy
//   segundo parámetro opcional: usuario administrador de MySQL (por defecto root)
//
// Qué hace: genera una clave al azar, arma el SQL (CREATE USER + GRANT mínimos) en un archivo temporal,
// lo corre con mysql.exe (que pide la clave de root en la consola), borra el archivo, comprueba que el
// usuario nuevo PUEDE lo que necesita y NO PUEDE leer `personal`, y recién ahí guarda
// PUBLICO_DB_USER / PUBLICO_DB_PASSWORD (dev: .env de dev; prod: secretos-prod.env + .env de prod).
// Se puede volver a correr: cambia la clave y rehace los permisos. No imprime la clave.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const MYSQL = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe';
const SECRETOS_PROD = 'C:\\apps\\personalprod\\secretos-prod.env';   // sync-guard:ignore (es una ruta, no una clave)
const ENV_PROD = 'C:\\apps\\personalprod\\apipersonal-prod\\.env';

const modo = (process.argv[2] || 'dev').toLowerCase();
// 2do parámetro: usuario administrador (pide la clave) o un archivo .env que tenga DB_USER/DB_PASSWORD de un
// administrador (p. ej. el del scanner, que conecta como root): así no se pide ni se muestra la clave.
const adminArg = process.argv[3] || 'root';
const adminEnvRaw = /\.env$/i.test(adminArg) && fs.existsSync(adminArg) ? leerEnv(adminArg) : null;
const adminEnv = adminEnvRaw && {   // acepta DB_* (apipersonal) o MYSQL_* (scanner)
  DB_USER: adminEnvRaw.DB_USER || adminEnvRaw.MYSQL_USER, DB_PASSWORD: adminEnvRaw.DB_PASSWORD ?? adminEnvRaw.MYSQL_PASSWORD,
  DB_HOST: adminEnvRaw.DB_HOST || adminEnvRaw.MYSQL_HOST, DB_PORT: adminEnvRaw.DB_PORT || adminEnvRaw.MYSQL_PORT,
};
const admin = adminEnv ? adminEnv.DB_USER : adminArg;
if (!['dev', 'prod'].includes(modo)) { console.error('Uso: crear_usuario_publico.cmd [dev|prod] [usuario_admin]'); process.exit(1); }

function leerEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}
function escribirClaves(file, valores) {
  let txt = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  for (const [k, v] of Object.entries(valores)) {
    const re = new RegExp(`^${k}=[^\\r\\n]*`, 'm');
    if (re.test(txt)) txt = txt.replace(re, () => `${k}=${v}`);
    else txt = txt.replace(/\s*$/, '') + nl + `${k}=${v}` + nl;
  }
  fs.writeFileSync(file, txt, 'utf8');
}

const envApp = modo === 'prod' ? leerEnv(ENV_PROD) : leerEnv(path.join(RAIZ, '.env'));
const DB = modo === 'prod' ? 'personalv5' : envApp.DB_NAME;
const HOST = envApp.DB_HOST || '127.0.0.1';
const PORT = Number(envApp.DB_PORT || 3306);
const USUARIO = modo === 'prod' ? 'wa_publico' : 'wa_publico_dev';
if (!DB) { console.error('No encontré DB_NAME en el .env'); process.exit(1); }
if (modo === 'dev' && DB === 'personalv5') { console.error('El .env de dev apunta a la base de PROD: abortado.'); process.exit(1); }

// Permisos: lo justo para el webhook (anotar) y la página de la Agenda de turnos.
const GRANTS = [
  `GRANT SELECT ON \`${DB}\`.\`v_publico_wa_claves\``,
  `GRANT INSERT (cuerpo) ON \`${DB}\`.\`whatsapp_bot_entrada\``,
  `GRANT SELECT ON \`${DB}\`.\`v_publico_agenda_agente\``,
  `GRANT SELECT ON \`${DB}\`.\`agendas\``,
  `GRANT SELECT ON \`${DB}\`.\`agenda_franjas\``,
  `GRANT SELECT ON \`${DB}\`.\`agenda_bloqueos\``,
  `GRANT SELECT ON \`${DB}\`.\`feriados\``,
  `GRANT SELECT, UPDATE ON \`${DB}\`.\`agenda_habilitaciones\``,
  `GRANT SELECT, INSERT, UPDATE ON \`${DB}\`.\`agenda_turnos\``,
  `GRANT SELECT (agenda_id, origen, estado, inicio, fin, titulo) ON \`${DB}\`.\`gcal_eventos\``,
  `GRANT SELECT (id, fecha_cita, hora_cita, estado, deleted_at),
         INSERT (dni, apellido, nombre, ley_nombre, ocupacion_nombre, fecha_cita, hora_cita, motivo, estado, observaciones, creado_por, creado_por_nombre),
         UPDATE (estado) ON \`${DB}\`.\`jubilacion_citas\``,
  // Legajo por enlace (mig 138): solo la tabla de espera, sin el DNI; lo carga al legajo la oficina
  `GRANT SELECT (id, token, estado, vence_el, nombre_mostrar, respuestas, devolucion_motivo, enviado_at),
         UPDATE (respuestas, guardado_at, estado, enviado_at, telefono) ON \`${DB}\`.\`legajo_autocarga\``,
];

(async () => {
  let mysql2;
  try { mysql2 = require(path.join(RAIZ, 'node_modules', 'mysql2', 'promise')); }
  catch { console.error('Falta mysql2 en node_modules de apipersonal'); process.exit(1); }

  // 1) Las tablas y vistas las crea la API al arrancar: tienen que existir antes de dar permisos
  const app = await mysql2.createConnection({ host: HOST, port: PORT, user: envApp.DB_USER, password: envApp.DB_PASSWORD, database: DB });
  const [ex] = await app.query(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('v_publico_wa_claves','whatsapp_bot_entrada','v_publico_agenda_agente','legajo_autocarga')`, [DB]);
  await app.end();
  if (ex.length < 4) {
    console.error(`En ${DB} faltan la bandeja o las vistas públicas (${ex.map(r => r.t).join(', ') || 'ninguna'}). ` +
      (modo === 'prod' ? 'Primero hacé el deploy y esperá que arranque la API de prod.' : 'Reiniciá la API de dev y volvé a correr esto.'));
    process.exit(1);
  }

  // 2) SQL con la clave nueva → archivo temporal → mysql.exe (pide la clave del administrador) → se borra
  const clave = crypto.randomBytes(24).toString('base64url');
  const u = `'${USUARIO}'@'127.0.0.1'`;
  const sql = [
    `CREATE USER IF NOT EXISTS ${u} IDENTIFIED BY '${clave}'`,
    `ALTER USER ${u} IDENTIFIED BY '${clave}' WITH MAX_USER_CONNECTIONS 10`,
    `REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${u}`,
    ...GRANTS.map(g => `${g} TO ${u}`),
    'FLUSH PRIVILEGES',
  ].join(';\n') + ';\n';
  console.log(`\nVa a crear/actualizar el usuario ${USUARIO} en la base ${DB} con permisos mínimos (administrador: ${admin}).`);
  if (adminEnv) {
    const adm = await mysql2.createConnection({
      host: adminEnv.DB_HOST || HOST, port: Number(adminEnv.DB_PORT || PORT), user: adminEnv.DB_USER, password: adminEnv.DB_PASSWORD, multipleStatements: true,
    });
    try { await adm.query(sql); }
    catch (e) { console.error(`\nNo se pudo aplicar: ${e.message}. No se cambió ningún archivo.`); process.exit(1); }
    finally { await adm.end(); }
  } else {
    const tmp = path.join(os.tmpdir(), `pub_${crypto.randomBytes(6).toString('hex')}.sql`);
    fs.writeFileSync(tmp, sql, { encoding: 'utf8', mode: 0o600 });
    console.log(`MySQL te va a pedir la clave del usuario administrador (${admin}):\n`);
    let r;
    try {
      r = spawnSync(MYSQL, ['-u', admin, '-p', '-h', '127.0.0.1', '-P', String(PORT), '-e', `source ${tmp.replace(/\\/g, '/')}`], { stdio: 'inherit' });
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* */ }
    }
    if (r.status !== 0) { console.error('\nNo se pudo aplicar (clave de administrador incorrecta o error de MySQL). No se cambió ningún archivo.'); process.exit(1); }
  }

  // 3) Comprobar: puede lo que necesita, no puede leer personal
  const pub = await mysql2.createConnection({ host: HOST, port: PORT, user: USUARIO, password: clave, database: DB });
  const pruebas = [];
  for (const q of ['SELECT COUNT(*) FROM v_publico_wa_claves', 'SELECT COUNT(*) FROM v_publico_agenda_agente', 'SELECT COUNT(*) FROM agenda_habilitaciones', 'SELECT COUNT(id) FROM legajo_autocarga']) {
    try { await pub.query(q); pruebas.push(`OK   ${q}`); } catch (e) { pruebas.push(`FALLA ${q}: ${e.message}`); }
  }
  for (const q of ['SELECT dni FROM personal LIMIT 1', 'SELECT * FROM whatsapp_bot_entrada LIMIT 1', 'SELECT * FROM whatsapp_bot_pedidos LIMIT 1', 'SELECT * FROM whatsapp_bot_config LIMIT 1', 'SELECT dni FROM legajo_autocarga LIMIT 1', 'SELECT * FROM legajo_datos_personales LIMIT 1']) {
    try { await pub.query(q); pruebas.push(`MAL  ${q} (no debería poder)`); } catch { pruebas.push(`OK   bloqueado: ${q}`); }
  }
  await pub.end();
  console.log('\n' + pruebas.join('\n'));
  if (pruebas.some(p => !p.startsWith('OK'))) { console.error('\nLos permisos no quedaron como se esperaba: no se guardó la clave.'); process.exit(1); }

  // 4) Guardar las credenciales
  const valores = { PUBLICO_DB_USER: USUARIO, PUBLICO_DB_PASSWORD: clave };
  if (modo === 'prod') {
    escribirClaves(SECRETOS_PROD, valores);   // sobrevive a los deploys
    if (fs.existsSync(ENV_PROD)) escribirClaves(ENV_PROD, valores);
    console.log(`\nListo. Guardado en secretos-prod.env y en el .env de prod. Reiniciá turnos-publico-prod.`);
  } else {
    escribirClaves(path.join(RAIZ, '.env'), valores);
    // el deploy copia el .env de dev a prod: que prod NO herede el usuario de dev (secretos-prod lo pisa)
    const sec = leerEnv(SECRETOS_PROD);
    if (fs.existsSync(SECRETOS_PROD) && !('PUBLICO_DB_USER' in sec)) escribirClaves(SECRETOS_PROD, { PUBLICO_DB_USER: '', PUBLICO_DB_PASSWORD: '' });
    console.log(`\nListo. Guardado en el .env de dev. Reiniciá turnos-publico-dev.`);
  }
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
