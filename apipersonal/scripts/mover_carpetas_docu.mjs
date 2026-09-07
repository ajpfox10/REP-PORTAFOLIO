// scripts/mover_carpetas_docu.mjs
// Renombra la carpeta de documentos D:\G\DOCU\<dni_viejo> -> <dni_nuevo> para
// cada cambio de DNI ya aplicado en la DB (ver [[project_cambio_dni_automatizacion]]).
//
// Complementa al EVENT `ev_cambios_dni`: el EVENT mueve los datos en MySQL (no
// puede tocar disco), este script mueve la carpeta. Politica "A+1" (segura):
//   - toma filas cambios_dni con procesado=1 y carpeta_estado=0
//   - si la carpeta vieja no existe  -> carpeta_estado=4 (sin_carpeta)
//   - si la destino NO existe         -> rename simple      -> carpeta_estado=1 (movida)
//   - si la destino YA existe          -> NO toca nada       -> carpeta_estado=2 (merge_manual)
//   - cualquier error de FS            -> carpeta_estado=3 (error) con el detalle
//
// Idempotente y re-ejecutable. No borra ni sobrescribe nunca.
// Uso:  node scripts/mover_carpetas_docu.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envRaw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = k => (envRaw.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];

// Base de DOCU: respeta TRAMITES_DOCU_BASE_DIR / DOCUMENTS_SCAN_DIR del .env.
const DOCU_BASE = (env('TRAMITES_DOCU_BASE_DIR') || env('DOCUMENTS_SCAN_DIR') || 'D:\\G\\DOCU').trim();

const conn = await mysql.createConnection({
  host: env('DB_HOST') || '127.0.0.1',
  port: Number(env('DB_PORT') || 3306),
  user: env('DB_USER'),
  password: env('DB_PASS') || env('DB_PASSWORD'),
  database: env('DB_NAME'),
});

const setEstado = (id, estado, msg) =>
  conn.execute(
    'UPDATE cambios_dni SET carpeta_estado=?, carpeta_resultado=?, carpeta_at=NOW() WHERE id=?',
    [estado, msg ? String(msg).slice(0, 500) : null, id],
  );

const [rows] = await conn.query(
  'SELECT id, dni_viejo, dni_nuevo FROM cambios_dni WHERE procesado=1 AND carpeta_estado=0',
);
console.log(`DOCU base: ${DOCU_BASE}`);
console.log(`Pendientes de mover: ${rows.length}`);

let movidas = 0, manual = 0, sin = 0, err = 0;
for (const r of rows) {
  const src = path.join(DOCU_BASE, String(r.dni_viejo));
  const dst = path.join(DOCU_BASE, String(r.dni_nuevo));
  try {
    if (!fs.existsSync(src)) {
      await setEstado(r.id, 4, `sin carpeta origen: ${src}`);
      sin++;
      console.log(`#${r.id} ${r.dni_viejo}->${r.dni_nuevo}: SIN CARPETA`);
      continue;
    }
    if (fs.existsSync(dst)) {
      await setEstado(r.id, 2, `destino ya existe, requiere merge manual: ${dst}`);
      manual++;
      console.log(`#${r.id} ${r.dni_viejo}->${r.dni_nuevo}: MERGE MANUAL (destino existe)`);
      continue;
    }
    fs.renameSync(src, dst);
    await setEstado(r.id, 1, `movida ${src} -> ${dst}`);
    movidas++;
    console.log(`#${r.id} ${r.dni_viejo}->${r.dni_nuevo}: MOVIDA`);
  } catch (e) {
    await setEstado(r.id, 3, e.message || String(e));
    err++;
    console.log(`#${r.id} ${r.dni_viejo}->${r.dni_nuevo}: ERROR ${e.message || e}`);
  }
}

console.log(`Resumen -> movidas:${movidas} merge_manual:${manual} sin_carpeta:${sin} error:${err}`);
await conn.end();
