/**
 * Migración 012 — Importar archivos de D:\G\DOCU a tblarchivos
 *
 * Lee cada carpeta numérica (DNI) dentro de DOCS_DIR y registra en
 * tblarchivos los archivos que todavía no están en la BD.
 *
 * Uso:
 *   node 012__importar_archivos_docu.js              → dry-run (solo muestra lo que haría)
 *   node 012__importar_archivos_docu.js --execute    → inserta en la BD
 *   node 012__importar_archivos_docu.js --dni=28305607          → solo ese DNI (dry-run)
 *   node 012__importar_archivos_docu.js --dni=28305607 --execute
 */

const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// ── Configuración ──────────────────────────────────────────────────────────────
const DOCS_DIR   = 'D:\\G\\DOCU';          // carpeta raíz donde están las carpetas por DNI
const DB_CONFIG  = { host: '127.0.0.1', user: 'root', password: 'Cuernos2503', database: 'personalv5' };
const SKIP_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx', '.tif', '.tiff']);

// ── Tipo según carpeta o extensión ─────────────────────────────────────────────
const TIPO_POR_CARPETA = {
  'resoluciones':          'resolucion',
  'beca':                  'beca',
  'becas':                 'beca',
  'cambio de ley':         'cambio_de_ley',
  'guarderia':             'guarderia',
  'autorizacion de manejo':'autorizacion_manejo',
  'art':                   'art',
  'asignacion familiar':   'asignacion_familiar',
  'cambio de especialidad':'cambio_especialidad',
  'cambio de agrupamiento':'cambio_agrupamiento',
  'titulo':                'titulo',
  'titulos':               'titulo',
  'dni':                   'dni',
  'domicilio':             'domicilio',
  'domicilios':            'domicilio',
  'licencia':              'licencia',
  'licencias':             'licencia',
  'jubilacion':            'jubilacion',
  'jubilaciones':          'jubilacion',
  'legajo':                'legajo',
};

function tipoDesde(carpetaRelativa, ext) {
  if (carpetaRelativa) {
    const clave = carpetaRelativa.toLowerCase().trim();
    if (TIPO_POR_CARPETA[clave]) return TIPO_POR_CARPETA[clave];
  }
  if (ext === '.pdf')                    return 'documento';
  if (['.jpg','.jpeg','.png','.tif','.tiff'].includes(ext)) return 'imagen';
  if (['.doc','.docx'].includes(ext))    return 'documento_word';
  if (['.xls','.xlsx'].includes(ext))    return 'planilla';
  return 'otro';
}

function nombreLegible(archivo) {
  return path.basename(archivo, path.extname(archivo))
    .replace(/[_-]+/g, ' ')
    .trim();
}

// ── Recorre archivos de una carpeta DNI recursivamente (2 niveles) ─────────────
function archivosEnCarpetaDni(dniDir, dniStr) {
  const resultado = [];

  function recorrer(dir, subcarpeta) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_FILES.has(entry.name.toLowerCase())) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Máximo 1 nivel de subcarpeta dentro de la carpeta del DNI
        if (!subcarpeta) recorrer(fullPath, entry.name);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;

      // ruta relativa a DOCS_DIR: "28305607\archivo.pdf" o "28305607\CARPETA\archivo.pdf"
      const rutaRelativa = subcarpeta
        ? `${dniStr}\\${subcarpeta}\\${entry.name}`
        : `${dniStr}\\${entry.name}`;

      const stat = fs.statSync(fullPath);

      resultado.push({
        dni:                   parseInt(dniStr, 10),
        ruta:                  rutaRelativa,
        nombre:                nombreLegible(entry.name),
        nombre_archivo_original: entry.name,
        tipo:                  tipoDesde(subcarpeta, ext),
        tamanio:               String(Math.round(stat.size / 1024)) + ' KB',
        anio:                  new Date(stat.mtime).getFullYear(),
        fecha:                 new Date(stat.mtime).toISOString().slice(0, 10),
        descripcion_archivo:   subcarpeta ? `Carpeta: ${subcarpeta}` : null,
      });
    }
  }

  recorrer(dniDir, null);
  return resultado;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const args    = process.argv.slice(2);
  const execute = args.includes('--execute');
  const soloDni = (args.find(a => a.startsWith('--dni=')) || '').replace('--dni=', '') || null;

  console.log(`\n── Importación de archivos DOCU → tblarchivos ──`);
  console.log(`   Directorio: ${DOCS_DIR}`);
  console.log(`   Modo:       ${execute ? '⚡ EXECUTE (insertará en la BD)' : '🔍 DRY-RUN (solo muestra, no inserta)'}`);
  if (soloDni) console.log(`   Solo DNI:   ${soloDni}`);
  console.log('');

  const conn = await mysql.createConnection(DB_CONFIG);

  // Cargar DNIs válidos de la tabla personal (FK constraint)
  const [personalRows] = await conn.execute('SELECT dni FROM personal');
  const dnisValidos = new Set(personalRows.map(r => String(r.dni)));
  console.log(`   DNIs en tabla personal: ${dnisValidos.size}`);

  // Cargar rutas ya existentes en la BD (para no duplicar)
  const [existentes] = await conn.execute('SELECT ruta FROM tblarchivos WHERE deleted_at IS NULL');
  const rutasExistentes = new Set(existentes.map(r => r.ruta?.toLowerCase()));

  // Carpetas a procesar
  let carpetasDni;
  if (soloDni) {
    carpetasDni = [soloDni];
  } else {
    carpetasDni = fs.readdirSync(DOCS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d{6,9}$/.test(e.name) && dnisValidos.has(e.name))
      .map(e => e.name);
  }

  console.log(`   Carpetas DNI con agente en personal: ${carpetasDni.length}\n`);

  let totalNuevos = 0;
  let totalOmitidos = 0;
  let totalCarpetas = 0;

  const BATCH = 200;
  const pendientes = [];

  for (const dniStr of carpetasDni) {
    const dniDir = path.join(DOCS_DIR, dniStr);
    const archivos = archivosEnCarpetaDni(dniDir, dniStr);

    let nuevosEnEste = 0;
    for (const arch of archivos) {
      if (rutasExistentes.has(arch.ruta.toLowerCase())) {
        totalOmitidos++;
        continue;
      }
      pendientes.push(arch);
      rutasExistentes.add(arch.ruta.toLowerCase()); // evita duplicados dentro del mismo run
      nuevosEnEste++;
      totalNuevos++;
    }

    if (nuevosEnEste > 0) {
      totalCarpetas++;
      console.log(`  DNI ${dniStr}: +${nuevosEnEste} archivo(s) nuevos`);
    }

    // Insertar en batches
    if (execute && pendientes.length >= BATCH) {
      await insertarBatch(conn, pendientes.splice(0, BATCH));
    }
  }

  // Último batch
  if (execute && pendientes.length > 0) {
    await insertarBatch(conn, pendientes);
  }

  await conn.end();

  console.log('\n── Resumen ──────────────────────────────────────────────────────');
  console.log(`   Carpetas con archivos nuevos: ${totalCarpetas}`);
  console.log(`   Archivos ya registrados (omitidos): ${totalOmitidos}`);
  console.log(`   Archivos nuevos ${execute ? 'insertados' : 'a insertar'}: ${totalNuevos}`);
  if (!execute && totalNuevos > 0) {
    console.log('\n   👉 Para insertar, ejecutá con --execute');
  }
  console.log('');
}

async function insertarBatch(conn, rows) {
  if (!rows.length) return;
  const values = rows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
  const params = rows.flatMap(r => [
    r.dni, r.ruta, r.nombre, r.nombre_archivo_original,
    r.tipo, r.tamanio, r.anio, r.fecha,
    r.descripcion_archivo, null, // created_by = null
  ]);
  await conn.execute(
    `INSERT INTO tblarchivos
       (dni, ruta, nombre, nombre_archivo_original, tipo, tamanio, anio, fecha, descripcion_archivo, created_by)
     VALUES ${values}`,
    params
  );
  process.stdout.write(`   ✓ Batch de ${rows.length} insertado\n`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
