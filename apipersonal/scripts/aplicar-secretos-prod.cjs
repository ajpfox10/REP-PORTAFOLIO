// aplicar-secretos-prod.cjs
// Pisa en el .env.production las claves que estan en C:\apps\personalprod\secretos-prod.env
// (JWT propios de prod, DB_NAME=personalv5, ...). Asi dev y prod NO comparten secretos:
// un token sacado en dev no sirve en prod. Lo llama deploy-prod.cmd. No imprime valores.
// Uso: node aplicar-secretos-prod.cjs <.env.production> <secretos-prod.env>
const fs = require('fs');
const [envFile, secFile] = process.argv.slice(2);
if (!envFile || !secFile) { console.error('   ERROR: uso aplicar-secretos-prod.cjs <env> <secretos>'); process.exit(1); }
if (!fs.existsSync(secFile)) { console.error(`   ERROR: falta ${secFile}`); process.exit(1); }

const secretos = {};
for (const raw of fs.readFileSync(secFile, 'utf8').split(/\r?\n/)) {
  const l = raw.trim();
  if (!l || l.startsWith('#') || !l.includes('=')) continue;
  const i = l.indexOf('=');
  secretos[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (!secretos[k] || secretos[k].length < 32) { console.error(`   ERROR: ${k} falta o tiene menos de 32 caracteres en ${secFile}`); process.exit(1); }
}

let txt = fs.readFileSync(envFile, 'utf8');
const nl = txt.includes('\r\n') ? '\r\n' : '\n';
const aplicadas = [];
for (const [k, v] of Object.entries(secretos)) {
  const re = new RegExp(`^${k}=[^\\r\\n]*`, 'm');
  if (re.test(txt)) txt = txt.replace(re, () => `${k}=${v}`);
  else txt = txt.replace(/\s*$/, '') + nl + `${k}=${v}` + nl;
  aplicadas.push(k);
}
fs.writeFileSync(envFile, txt, 'utf8');
console.log(`   secretos de prod aplicados: ${aplicadas.join(', ')}`);
