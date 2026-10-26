// Importa los historialsiape*.xlsx de EXCEL_ASISTENCIA_DIR en la tabla `historial`
// en modo reemplazar con el periodo pedido al SIAPE (pisa todos sus meses, nunca
// los de afuera). Lo llama el robot de Novedades Por Periodo despues de bajar.
// Usa el build (dist): en prod no hay src.
//
// Uso: node importar_historial_siape.mjs 2026-09-01 2027-02-28
// Ultima linea de la salida: JSON con el resultado.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(raiz); // el .env se lee desde la raiz de la api

const [desde, hasta] = process.argv.slice(2);
const fecha = /^\d{4}-\d{2}-\d{2}$/;
if (!fecha.test(desde || '') || !fecha.test(hasta || '') || desde > hasta) {
  console.error('Uso: node importar_historial_siape.mjs AAAA-MM-DD AAAA-MM-DD');
  process.exit(2);
}

const { createSequelize } = require(path.join(raiz, 'dist', 'db', 'sequelize.js'));
const { importarHistorialSiape } = require(path.join(raiz, 'dist', 'services', 'historialSiapeImport.js'));

const s = createSequelize();
try {
  const r = await importarHistorialSiape(s, 'reemplazar', { desde, hasta });
  console.log(JSON.stringify({
    borradas: r.borradas, totales: r.totales,
    meses: r.rangosCubiertos.map(x => x.desde.slice(0, 7)), advertencias: r.advertencias,
  }));
} catch (e) {
  console.error(e?.message || e);
  process.exitCode = 1;
} finally {
  await s.close();
}
