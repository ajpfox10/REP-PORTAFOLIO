/**
 * Script de importación de datos geográficos e infraestructura desde fuentes oficiales.
 *
 * Fuentes:
 *  - GeoRef (datos.gob.ar): localidades oficiales del INDEC
 *  - datos.gob.ar REFES: establecimientos de salud del Ministerio de Salud
 *  - datos.gba.gob.ar: cuarteles de bomberos voluntarios de Buenos Aires (actualizado 02/2026)
 *  - data.buenosaires.gob.ar: bomberos CABA (actualizado 03/2026)
 *
 * Uso:
 *   node scripts/import-data.js [--solo-geo] [--solo-infra] [--provincia AR-B]
 *
 * Ejemplos:
 *   node scripts/import-data.js                     ← todo
 *   node scripts/import-data.js --solo-geo           ← solo localidades
 *   node scripts/import-data.js --solo-infra          ← solo infraestructura
 *   node scripts/import-data.js --provincia AR-B      ← solo Buenos Aires
 */

require('../src/config/env');
const { query, testConnection } = require('../src/config/database');

// ─── Utilidades ───────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DefensaCivil-Import/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DefensaCivil-Import/1.0' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    // Manejo básico de campos con comas dentro de comillas
    const values = [];
    let inQuote = false, current = '';
    for (const ch of line + ',') {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { values.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

function normalizeName(s) {
  return (s || '').toLowerCase()
    .replace(/[áàäâ]/g,'a').replace(/[éèëê]/g,'e')
    .replace(/[íìïî]/g,'i').replace(/[óòöô]/g,'o')
    .replace(/[úùüû]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let stats = { localidades: 0, infraestructura: 0, skipped: 0, errors: 0 };

// ─── GEOREF: Localidades ──────────────────────────────────────────────────────

async function importLocalidades(soloProvinciaCode) {
  console.log('\n=== Importando localidades desde GeoRef (INDEC) ===');

  // Mapa de códigos GeoRef → códigos ISO de la app
  const GEOREF_TO_ISO = {
    '02': 'AR-C', // CABA
    '06': 'AR-B', // Buenos Aires
    '10': 'AR-K', // Catamarca
    '14': 'AR-X', // Córdoba
    '18': 'AR-W', // Corrientes
    '22': 'AR-H', // Chaco
    '26': 'AR-U', // Chubut
    '30': 'AR-E', // Entre Ríos
    '34': 'AR-P', // Formosa
    '38': 'AR-Y', // Jujuy
    '42': 'AR-L', // La Pampa
    '46': 'AR-F', // La Rioja
    '50': 'AR-M', // Mendoza
    '54': 'AR-N', // Misiones
    '58': 'AR-Q', // Neuquén
    '62': 'AR-R', // Río Negro
    '66': 'AR-A', // Salta
    '70': 'AR-J', // San Juan
    '74': 'AR-D', // San Luis
    '78': 'AR-Z', // Santa Cruz
    '82': 'AR-S', // Santa Fe
    '86': 'AR-G', // Santiago del Estero
    '90': 'AR-T', // Tucumán
    '94': 'AR-V', // Tierra del Fuego
  };

  // Obtener provincias de la DB
  const dbProvinces = await query('SELECT id, code, name FROM provinces');

  // Obtener provincias de GeoRef
  const geoRefProvs = await fetchJson('https://apis.datos.gob.ar/georef/api/provincias?max=25&campos=id,nombre');
  const georefProvList = geoRefProvs.provincias || [];

  for (const gp of georefProvList) {
    const isoCode = GEOREF_TO_ISO[gp.id];
    if (!isoCode) continue;
    if (soloProvinciaCode && isoCode !== soloProvinciaCode) continue;

    const dbProv = dbProvinces.find(p => p.code === isoCode);
    if (!dbProv) { console.log(`  Provincia ${isoCode} no encontrada en DB, saltando`); continue; }

    console.log(`\n  → ${dbProv.name} (${isoCode})`);

    // Obtener municipios de GeoRef para esta provincia
    let offset = 0, totalMunicipios = 0;
    const municipiosMap = {}; // nombre_norm → partido_id en DB

    // Cargar partidos de DB para esta provincia
    const dbPartidos = await query('SELECT id, name FROM partidos WHERE province_id = ?', [dbProv.id]);
    for (const dp of dbPartidos) {
      municipiosMap[normalizeName(dp.name)] = dp.id;
    }
    console.log(`    ${dbPartidos.length} partidos en DB`);

    // Importar localidades en lotes por municipio (o directamente por provincia)
    let localOffset = 0;
    const BATCH = 1000;
    let importadas = 0;

    while (true) {
      const url = `https://apis.datos.gob.ar/georef/api/localidades?provincia=${gp.id}&max=${BATCH}&inicio=${localOffset}&campos=id,nombre,centroide,municipio,codigoPostal`;
      let data;
      try {
        data = await fetchJson(url);
      } catch (e) {
        console.log(`    Error fetching: ${e.message}`);
        break;
      }

      const localidades = data.localidades || [];
      if (localidades.length === 0) break;

      for (const loc of localidades) {
        const lat = loc.centroide?.lat;
        const lng = loc.centroide?.lon;
        if (!lat || !lng) { stats.skipped++; continue; }

        // Buscar partido por nombre del municipio de GeoRef
        const munNorm = normalizeName(loc.municipio?.nombre || '');
        let partidoId = municipiosMap[munNorm];

        // Si no match exacto, buscar parcial
        if (!partidoId && munNorm) {
          for (const [norm, id] of Object.entries(municipiosMap)) {
            if (norm.includes(munNorm) || munNorm.includes(norm)) {
              partidoId = id;
              break;
            }
          }
        }

        const cp = loc.codigoPostal || null;

        try {
          await query(
            `INSERT INTO localities (partido_id, name, postal_code, latitude, longitude)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE postal_code=VALUES(postal_code), latitude=VALUES(latitude), longitude=VALUES(longitude)`,
            [partidoId || null, loc.nombre, cp, lat, lng]
          );
          importadas++;
          stats.localidades++;
        } catch (e) {
          stats.errors++;
        }
      }

      localOffset += localidades.length;
      if (localidades.length < BATCH) break;
      await sleep(200); // Respetar rate limit de GeoRef
    }

    console.log(`    ${importadas} localidades importadas`);
  }
}

// ─── REFES: Establecimientos de Salud ─────────────────────────────────────────

async function importRefes(soloProvinciaCode) {
  console.log('\n=== Importando hospitales desde REFES (Ministerio de Salud) ===');

  // Obtener URL del CSV desde CKAN API
  let csvUrl;
  try {
    const meta = await fetchJson(
      'https://datos.gob.ar/api/3/action/package_show?id=salud_336cf4d9-447a-44c4-8e34-0ba1fc293d55'
    );
    const resources = meta?.result?.resources || [];
    // Preferir CSV o JSON más reciente
    const csvResource = resources.find(r => r.format === 'CSV') ||
                        resources.find(r => r.format === 'JSON');
    csvUrl = csvResource?.url;
  } catch (e) {
    console.log('  No se pudo obtener metadata de CKAN, usando URL directa');
  }

  if (!csvUrl) {
    csvUrl = 'https://datos.salud.gob.ar/dataset/listado-establecimientos-de-salud-asentados-en-el-registro-federal-refes/archivo/5d5710df-cf3f-4d91-b9c5-aecab1e06018';
  }

  console.log(`  Descargando REFES desde: ${csvUrl}`);
  let csvText;
  try {
    csvText = await fetchText(csvUrl);
  } catch (e) {
    console.log(`  Error descargando REFES: ${e.message}`);
    return;
  }

  const rows = parseCSV(csvText);
  console.log(`  ${rows.length} establecimientos en REFES`);

  const dbProvinces = await query('SELECT id, code, name FROM provinces');

  // Mapa nombre provincia → código ISO
  const PROV_MAP = {
    'BUENOS AIRES': 'AR-B', 'CIUDAD AUTONOMA DE BUENOS AIRES': 'AR-C', 'CABA': 'AR-C',
    'CATAMARCA': 'AR-K', 'CHACO': 'AR-H', 'CHUBUT': 'AR-U', 'CORDOBA': 'AR-X',
    'CORRIENTES': 'AR-W', 'ENTRE RIOS': 'AR-E', 'FORMOSA': 'AR-P', 'JUJUY': 'AR-Y',
    'LA PAMPA': 'AR-L', 'LA RIOJA': 'AR-F', 'MENDOZA': 'AR-M', 'MISIONES': 'AR-N',
    'NEUQUEN': 'AR-Q', 'RIO NEGRO': 'AR-R', 'SALTA': 'AR-A', 'SAN JUAN': 'AR-J',
    'SAN LUIS': 'AR-D', 'SANTA CRUZ': 'AR-Z', 'SANTA FE': 'AR-S',
    'SANTIAGO DEL ESTERO': 'AR-G', 'TIERRA DEL FUEGO': 'AR-V', 'TUCUMAN': 'AR-T',
  };

  // Tipos de establecimiento que importar (hospitales y centros de salud relevantes)
  const TIPOS_INCLUIR = ['HOSPITAL', 'CLINICA', 'CENTRO DE SALUD', 'CAPS', 'DISPENSARIO', 'SALA DE PRIMEROS AUXILIOS', 'UNIDAD DE PRONTA ATENCION', 'SANATORIO'];

  let importados = 0;
  for (const row of rows) {
    // Detectar columnas (el CSV puede variar por año)
    const tipologia = (row.TIPOLOGIA_HOMOLOGADA || row.tipologia_homologada || row.TIPOLOGIA || '').toUpperCase();
    const esTipoRelevante = TIPOS_INCLUIR.some(t => tipologia.includes(t));
    if (!esTipoRelevante) continue;

    const lat = parseFloat(row.LATITUD || row.latitud || row.LAT || '');
    const lng = parseFloat(row.LONGITUD || row.longitud || row.LON || '');
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

    const provName = (row.PROVINCIA || row.provincia || '').toUpperCase().trim();
    const isoCode  = PROV_MAP[provName];
    if (!isoCode) continue;
    if (soloProvinciaCode && isoCode !== soloProvinciaCode) continue;

    const dbProv = dbProvinces.find(p => p.code === isoCode);
    if (!dbProv) continue;

    const nombre    = row.RAZON_SOCIAL || row.razon_social || row.NOMBRE || '';
    const domicilio = row.DOMICILIO || row.domicilio || '';
    const nivel     = row.NIVEL_ATENCION || row.nivel_atencion || '';

    // Determinar tipo
    let tipo = 'SALITA';
    if (tipologia.includes('HOSPITAL') || tipologia.includes('CLINICA') || tipologia.includes('SANATORIO')) tipo = 'HOSPITAL';

    // Buscar partido en DB
    const munNombre = row.MUNICIPIO || row.municipio || row.PARTIDO || '';
    let partidoId = null;
    if (munNombre) {
      const dbPartidos = await query(
        'SELECT id FROM partidos WHERE province_id = ? AND name LIKE ? LIMIT 1',
        [dbProv.id, `%${munNombre.substring(0,20)}%`]
      );
      if (dbPartidos.length) partidoId = dbPartidos[0].id;
    }

    try {
      await query(
        `INSERT INTO infrastructure_points (type, name, address, province_id, partido_id, latitude, longitude, level, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE address=VALUES(address), latitude=VALUES(latitude), longitude=VALUES(longitude), level=VALUES(level)`,
        [tipo, nombre.substring(0, 200), domicilio.substring(0, 255), dbProv.id, partidoId, lat, lng, nivel.substring(0, 30)]
      );
      importados++;
      stats.infraestructura++;
    } catch (e) {
      stats.errors++;
    }
  }
  console.log(`  ${importados} establecimientos de salud importados`);
}

// ─── Bomberos Voluntarios Buenos Aires ────────────────────────────────────────

async function importBomberosPBA() {
  console.log('\n=== Importando Bomberos Voluntarios - Buenos Aires (datos.gba.gob.ar) ===');

  const csvUrl = 'https://catalogo.datos.gba.gob.ar/dataset/f3cf1025-b253-4627-b546-9c83457618f9/resource/9d601310-6bf9-4d82-b809-65fed2f3f63a/download/cuarteles-bomberos-022026.csv';

  let csvText;
  try {
    csvText = await fetchText(csvUrl);
  } catch (e) {
    console.log(`  Error descargando: ${e.message}`);
    return;
  }

  const rows = parseCSV(csvText);
  console.log(`  ${rows.length} cuarteles en CSV`);

  const dbProv = await query("SELECT id FROM provinces WHERE code = 'AR-B' LIMIT 1");
  if (!dbProv.length) return;
  const provId = dbProv[0].id;

  let importados = 0;
  for (const row of rows) {
    // El CSV de PBA tiene columnas: nombre/cuartel, domicilio, localidad, partido, latitud, longitud, telefono
    const lat = parseFloat(row.latitud || row.LATITUD || row.lat || '');
    const lng = parseFloat(row.longitud || row.LONGITUD || row.lon || row.lng || '');
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) { stats.skipped++; continue; }

    const nombre    = row.nombre || row.NOMBRE || row.cuartel || row.CUARTEL || '';
    const domicilio = row.domicilio || row.DOMICILIO || row.direccion || '';
    const telefono  = row.telefono || row.TELEFONO || row.phone || '';
    const partido   = row.partido || row.PARTIDO || row.municipio || '';

    // Buscar partido
    let partidoId = null;
    if (partido) {
      const res = await query(
        'SELECT id FROM partidos WHERE province_id = ? AND name LIKE ? LIMIT 1',
        [provId, `%${partido.substring(0,30)}%`]
      );
      if (res.length) partidoId = res[0].id;
    }

    try {
      await query(
        `INSERT INTO infrastructure_points (type, name, address, phone, province_id, partido_id, latitude, longitude, is_active)
         VALUES ('BOMBEROS', ?, ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE address=VALUES(address), latitude=VALUES(latitude), longitude=VALUES(longitude)`,
        [nombre.substring(0,200), domicilio.substring(0,255), telefono.substring(0,100), provId, partidoId, lat, lng]
      );
      importados++;
      stats.infraestructura++;
    } catch (e) {
      stats.errors++;
    }
  }
  console.log(`  ${importados} cuarteles de bomberos PBA importados`);
}

// ─── Bomberos CABA ────────────────────────────────────────────────────────────

async function importBomberosCaba() {
  console.log('\n=== Importando Bomberos - CABA (data.buenosaires.gob.ar) ===');

  const geoJsonUrl = 'https://data.buenosaires.gob.ar/dataset/cuarteles-destacamentos-bomberos/resource/c8d43609-87b4-41ee-81e9-bbd92acc00c9/download';

  let data;
  try {
    data = await fetchJson(geoJsonUrl);
  } catch (e) {
    console.log(`  Error descargando: ${e.message}`);
    return;
  }

  const features = data.features || [];
  console.log(`  ${features.length} cuarteles en GeoJSON`);

  const dbProv = await query("SELECT id FROM provinces WHERE code = 'AR-C' LIMIT 1");
  if (!dbProv.length) return;
  const provId = dbProv[0].id;

  let importados = 0;
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const lng = coords[0], lat = coords[1];
    if (!lat || !lng) continue;

    const p = f.properties || {};
    const nombre    = p.nombre || p.NOMBRE || p.name || '';
    const domicilio = p.domicilio || p.DOMICILIO || p.direccion || '';
    const telefono  = p.telefono || p.TELEFONO || '';

    try {
      await query(
        `INSERT INTO infrastructure_points (type, name, address, phone, province_id, partido_id, latitude, longitude, is_active)
         VALUES ('BOMBEROS', ?, ?, ?, ?, NULL, ?, ?, 1)
         ON DUPLICATE KEY UPDATE address=VALUES(address), latitude=VALUES(latitude), longitude=VALUES(longitude)`,
        [nombre.substring(0,200), domicilio.substring(0,255), telefono.substring(0,100), provId, lat, lng]
      );
      importados++;
      stats.infraestructura++;
    } catch (e) {
      stats.errors++;
    }
  }
  console.log(`  ${importados} cuarteles de bomberos CABA importados`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const soloGeo   = args.includes('--solo-geo');
  const soloInfra = args.includes('--solo-infra');
  const provIdx   = args.indexOf('--provincia');
  const soloProvinciaCode = provIdx !== -1 ? args[provIdx + 1] : null;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Defensa Civil - Importador de Datos Oficiales       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  if (soloProvinciaCode) console.log(`  Filtrando provincia: ${soloProvinciaCode}`);
  console.log('');

  try {
    await testConnection();
    console.log('✓ Conexión a base de datos OK\n');
  } catch (e) {
    console.error('✗ Error de conexión:', e.message);
    process.exit(1);
  }

  const startTime = Date.now();

  try {
    if (!soloInfra) {
      await importLocalidades(soloProvinciaCode);
    }

    if (!soloGeo) {
      await importRefes(soloProvinciaCode);
      if (!soloProvinciaCode || soloProvinciaCode === 'AR-B') await importBomberosPBA();
      if (!soloProvinciaCode || soloProvinciaCode === 'AR-C') await importBomberosCaba();
    }
  } catch (e) {
    console.error('\n✗ Error fatal:', e.message);
    stats.errors++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  Resultado                                           ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Localidades importadas:    ${String(stats.localidades).padEnd(24)}║`);
  console.log(`║  Infraestructura importada: ${String(stats.infraestructura).padEnd(24)}║`);
  console.log(`║  Omitidos (sin coords):     ${String(stats.skipped).padEnd(24)}║`);
  console.log(`║  Errores:                   ${String(stats.errors).padEnd(24)}║`);
  console.log(`║  Tiempo:                    ${String(elapsed + 's').padEnd(24)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  process.exit(stats.errors > 0 ? 1 : 0);
}

main();
