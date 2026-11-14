// env-dev-a-base-dev.cjs
// Deja el .env de DEV apuntando a la base de dev (DB_NAME=personalv5_dev).
// Lo llama deploy-prod.cmd SOLO despues de pasar las tareas programadas a los scripts de prod
// (si no, los robots programados cargarian en la copia). Respeta el resto del archivo byte a byte.
// Uso: node scripts/env-dev-a-base-dev.cjs [ruta .env]
const fs = require('fs');
const path = require('path');

const archivo = process.argv[2] || path.resolve(__dirname, '..', '.env');
if (/personalprod/i.test(archivo)) { console.error('   ERROR: esto es solo para el .env de dev'); process.exit(1); }

const txt = fs.readFileSync(archivo, 'utf8');
if (/^DB_NAME=personalv5_dev\s*$/m.test(txt)) { console.log('   .env de dev ya apunta a personalv5_dev'); process.exit(0); }
if (!/^DB_NAME=/m.test(txt)) { console.error('   ERROR: el .env no tiene DB_NAME='); process.exit(1); }

fs.copyFileSync(archivo, archivo + '.bak-db');
fs.writeFileSync(archivo, txt.replace(/^DB_NAME=[^\r\n]*/m, 'DB_NAME=personalv5_dev'), 'utf8');
console.log('   .env de dev -> DB_NAME=personalv5_dev (copia anterior en .env.bak-db)');
