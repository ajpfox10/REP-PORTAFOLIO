// scripts/loadHistorial.mjs
// Carga los exports SIAPE de D:\G\estadisticaasistencia\HISTORIAL en la tabla
// `historial` (migración 032). Re-ejecutable:
//   - los archivos ya cargados (archivo_origen) se saltean,
//   - las filas se deduplican por dni+novedad+fechas contra lo ya insertado
//     (los archivos se solapan entre sí en los bordes de cada rango).
// Los DNI que no existen en personal+agentes (FK) se saltean y se reportan.
//
// Uso: node scripts/loadHistorial.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HISTORIAL_DIR = 'D:/G/estadisticaasistencia/HISTORIAL';
const BATCH = 2000;

const envRaw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = k => (envRaw.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];

const normDni = v => Number(String(v ?? '').replace(/[^0-9]/g, ''));
const txt = (v, max) => {
  const s = String(v ?? '').trim();
  if (!s || s === '-') return null;
  return s.slice(0, max);
};
// Serial Excel → 'YYYY-MM-DD' en UTC (mismo criterio que parseDate del backend)
const serialToDateStr = v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const d = new Date((v - 25569) * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
// Dependencia por E5/E6 (mismo criterio que resolveDepedencia del backend)
const norm = s => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function resolveDependencia(e5raw, e6raw) {
  const e6 = norm(e6raw), e5 = norm(e5raw);
  const m6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (m6) return `UPA ${m6[1]}`;
  const m5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (m5) return `UPA ${m5[1]}`;
  return 'HOSPITAL';
}

const conn = await mysql.createConnection({
  host: env('DB_HOST') || '127.0.0.1',
  port: Number(env('DB_PORT') || 3306),
  user: env('DB_USER'),
  password: env('DB_PASS') || env('DB_PASSWORD'),
  database: env('DB_NAME'),
});

// DNIs válidos para la FK (deben existir en personal Y en agentes)
const [dniRows] = await conn.query(
  'SELECT DISTINCT p.dni FROM personal p JOIN agentes a ON a.dni = p.dni',
);
const validDnis = new Set(dniRows.map(r => Number(r.dni)));
console.log('DNIs válidos para FK (personal ∩ agentes):', validDnis.size);

// Archivos ya cargados + claves existentes (para re-ejecución)
const [loadedFiles] = await conn.query('SELECT DISTINCT archivo_origen FROM historial');
const yaCargados = new Set(loadedFiles.map(r => r.archivo_origen));
const vistas = new Set();
const [oldKeys] = await conn.query(
  "SELECT CONCAT(dni,'|',novedad,'|',IFNULL(fecha_desde,''),'|',IFNULL(fecha_hasta,'')) AS k FROM historial",
);
for (const r of oldKeys) vistas.add(r.k);
console.log('Filas ya en la tabla:', vistas.size, '· archivos ya cargados:', yaCargados.size);

const files = fs.readdirSync(HISTORIAL_DIR)
  .filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
  .sort();

let totLeidas = 0, totInsertadas = 0, totDup = 0, totSinFecha = 0;
const rechazadasPorDni = new Map(); // dni -> { nombre, filas }

for (const f of files) {
  const fp = path.join(HISTORIAL_DIR, f);
  if (yaCargados.has(f)) { console.log(`${f} → ya cargado, salteado`); continue; }
  if (fs.statSync(fp).size < 1024) { console.log(`${f} → corrupto/vacío (${fs.statSync(fp).size} bytes), salteado`); continue; }

  let rows;
  try {
    const wb = XLSX.readFile(fp, { cellDates: false });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  } catch (e) {
    console.log(`${f} → ERROR de lectura: ${e.message}, salteado`);
    continue;
  }
  if (!rows.length) { console.log(`${f} → vacío, salteado`); continue; }

  const hdr = {};
  rows[0].forEach((h, i) => { hdr[String(h).toUpperCase().trim()] = i; });
  const col = n => hdr[n] ?? -1;
  const iDni = col('NRO_DOCUMENTO');
  if (iDni < 0) { console.log(`${f} → sin NRO_DOCUMENTO, salteado. Headers: ${rows[0].join(',').slice(0, 120)}`); continue; }

  let ins = 0, dup = 0, rech = 0, sinFecha = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    // INSERT IGNORE: el UNIQUE uq_historial__novedad (migración 033) garantiza
    // que cada novedad sea única aunque el dedupe en memoria se saltee algo.
    await conn.query(
      `INSERT IGNORE INTO historial
         (dni, legajo, apellido, nombre, sexo, regimen_estatutario, planta, agrupamiento,
          categoria_salarial, novedad, fecha_desde, fecha_hasta, justificado,
          estructura_servicio, dependencia, archivo_origen)
       VALUES ?`,
      [batch],
    );
    batch = [];
  };

  for (const r of rows.slice(1)) {
    totLeidas++;
    const dni = normDni(r[iDni]);
    const novedad = txt(r[col('NOVEDAD')], 160);
    if (!dni || !novedad) continue;

    if (!validDnis.has(dni)) {
      rech++;
      const cur = rechazadasPorDni.get(dni) || {
        nombre: `${txt(r[col('APELLIDO')], 120) || ''}, ${txt(r[col('NOMBRE')], 120) || ''}`,
        filas: 0,
      };
      cur.filas++;
      rechazadasPorDni.set(dni, cur);
      continue;
    }

    const fdesde = serialToDateStr(r[col('FECHA_DESDE')]);
    const fhasta = serialToDateStr(r[col('FECHA_HASTA')]) ?? fdesde;
    if (!fdesde) { sinFecha++; totSinFecha++; }

    const key = `${dni}|${novedad}|${fdesde ?? ''}|${fhasta ?? ''}`;
    if (vistas.has(key)) { dup++; totDup++; continue; }
    vistas.add(key);

    batch.push([
      dni,
      txt(r[col('LEGAJO')], 30),
      txt(r[col('APELLIDO')], 120),
      txt(r[col('NOMBRE')], 120),
      txt(r[col('SEXO')], 5),
      txt(r[col('REGIMEN_ESTATUTARIO')], 120),
      txt(r[col('PLANTA')], 60),
      txt(r[col('AGRUPAMIENTO')], 80),
      txt(r[col('CATEGORIA_SALARIAL')], 30),
      novedad,
      fdesde,
      fhasta,
      txt(r[col('JUSTIFICADO')], 5),
      txt(r[col('ESTRUCTURA_SERVICIO')], 255),
      resolveDependencia(r[col('E5')], r[col('E6')]),
      f,
    ]);
    ins++;
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  totInsertadas += ins;
  console.log(`${f} → insertadas ${ins} · duplicadas ${dup} · sin FK ${rech} · sin fecha ${sinFecha}`);
}

console.log(`\nTOTAL: leídas ${totLeidas} · insertadas ${totInsertadas} · duplicadas ${totDup} · sin fecha ${totSinFecha}`);

if (rechazadasPorDni.size) {
  console.log(`\nDNIs rechazados por FK (no existen en personal+agentes): ${rechazadasPorDni.size}`);
  for (const [dni, info] of [...rechazadasPorDni.entries()].sort((a, b) => b[1].filas - a[1].filas)) {
    console.log(`  ${dni}  ${info.nombre}  (${info.filas} filas)`);
  }
}

const [porAnio] = await conn.query(
  'SELECT YEAR(fecha_desde) AS anio, COUNT(*) AS filas FROM historial GROUP BY YEAR(fecha_desde) ORDER BY anio',
);
console.log('\nFilas en la tabla por año:');
for (const r of porAnio) console.log(`  ${r.anio ?? 'sin fecha'}: ${r.filas}`);

await conn.end();
