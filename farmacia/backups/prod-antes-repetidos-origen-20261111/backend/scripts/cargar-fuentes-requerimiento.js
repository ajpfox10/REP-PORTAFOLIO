// Carga en requerimiento_fuentes los formularios/expedientes transcriptos de los escaneos.
// Uso: node scripts/cargar-fuentes-requerimiento.js [anio] [archivo.json]   (NODE_ENV=production para prod)
const path = require('path');
const fs = require('fs');
const requerimientos = require('../src/requerimientosDb');

(async () => {
  const anio = Number(process.argv[2] || 2026);
  const archivo = process.argv[3] || path.join(__dirname, `requerimiento-fuentes-${anio}.json`);
  const { grupos } = JSON.parse(fs.readFileSync(archivo, 'utf-8'));
  await requerimientos.ensureRequerimientoTables();
  const n = await requerimientos.cargarFuentes(anio, grupos.map((g) => ({ ...g, codigos: String(g.codigos).split(/\s+/).filter(Boolean) })));
  console.log(`Cargados ${n} codigos en ${grupos.length} formularios para ${anio}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
