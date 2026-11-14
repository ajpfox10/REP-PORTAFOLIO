// aplicar-jwt-prod.cjs
// El scanner1 valida el token de sesion de personalv5 con PERSONAL_JWT_SECRET, que tiene que
// ser IGUAL al JWT_ACCESS_SECRET de la API personal de prod. Desde el 08/11/2026 los secretos
// de prod viven en C:\apps\personalprod\secretos-prod.env (no en dev), asi que al deployar hay
// que tomarlo de ahi; si no, el escaner rechaza a todos con "Token invalido o expirado".
// Uso: node aplicar-jwt-prod.cjs <.env destino> <secretos-prod.env>
const fs = require('fs');
const [envFile, secFile] = process.argv.slice(2);
if (!envFile || !secFile) { console.error('   ERROR: uso aplicar-jwt-prod.cjs <env> <secretos>'); process.exit(1); }
const m = fs.readFileSync(secFile, 'utf8').match(/^JWT_ACCESS_SECRET=(.*)$/m);
const sec = m && m[1].trim();
if (!sec || sec.length < 32) { console.error(`   ERROR: JWT_ACCESS_SECRET falta o es corto en ${secFile}`); process.exit(1); }
let t = fs.readFileSync(envFile, 'utf8');
if (/^PERSONAL_JWT_SECRET=.*$/m.test(t)) t = t.replace(/^PERSONAL_JWT_SECRET=.*$/m, 'PERSONAL_JWT_SECRET=' + sec);
else t = t.replace(/\s*$/, '\n') + 'PERSONAL_JWT_SECRET=' + sec + '\n';
fs.writeFileSync(envFile, t);
console.log('   PERSONAL_JWT_SECRET de prod aplicado');
