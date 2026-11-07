// Pasa a la base las O.C. que estan escritas a mano en el Excel de Drive (pestaña "O.C <año>")
// y que no se subieron por PDF, para que aparezcan en la pagina y se sincronicen como las demas.
// - Toma cada O.C. de la col B (N° + proveedor) y sus renglones (col C a K). Lo cargado
//   (entregada, completo, N° de ingreso, observacion) entra igual que en el Excel.
// - No escribe en el Excel: en la proxima sincronizacion cada fila se ubica por N° de O.C. + renglon
//   y se le pone el ID (col M). Por eso solo importa los renglones que la sincronizacion va a encontrar.
// - Las O.C. que ya estan en la base no se tocan.
// Uso (desde backend):  node scripts/importar-oc-excel.js [--anio 2026] [--aplicar]
// Sin --aplicar solo muestra lo que haria.
const crypto = require('crypto');
const { createRequire } = require('module');
const req = createRequire(require('path').join(__dirname, '../src/x.js'));
const config = req('./config');
const { query, transaction } = req('./db');
const { abrirXlsx } = req('./ordenesCompraXlsx');
const { numeroOc, valoresDeFila } = req('./ordenesCompraDrive');

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const anio = args.includes('--anio') ? args[args.indexOf('--anio') + 1] : String(new Date().getFullYear());

function limpiar(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function proveedorDe(texto) {
  const t = limpiar(texto);
  const m = /(\d+)\s*\/\s*(\d{4}|\d{2})(?!\d)/.exec(t);
  return m ? limpiar(t.slice(m.index + m[0].length).replace(/^[\s|\-–]+/, '')) : '';
}

function fechaIso(v) {
  const m = limpiar(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function entero(v) {
  const n = Number(limpiar(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function leerExcel() {
  const [cfg] = await query('SELECT file_id, file_nombre, prefijo_anual FROM oc_drive_config WHERE id = 1');
  if (!cfg?.file_id) throw new Error('No hay archivo de Drive configurado');
  const { auth } = req('@googleapis/sheets');
  const { drive } = req('@googleapis/drive');
  const d = drive({ version: 'v3', auth: new auth.GoogleAuth({ keyFile: config.ordenesCompraDrive.keyFile, scopes: ['https://www.googleapis.com/auth/drive.readonly'] }) });
  const res = await d.files.get({ fileId: cfg.file_id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const libro = await abrirXlsx(Buffer.from(res.data));
  const pestana = `${cfg.prefijo_anual}${anio}`;
  return { cfg, pestana, filas: await libro.leer(`'${pestana.replace(/'/g, "''")}'!A1:M`) };
}

// Mismo recorrido que la sincronizacion (planificarPestana, paso 1): la col B vale hasta la proxima O.C.
// y gana la primera fila de cada N° de O.C. + renglon.
function armarOrdenes(filas, existentes) {
  const ordenes = new Map();
  const vistos = new Set();
  const omitidos = [];
  let actual = null;
  for (let i = 1; i < filas.length; i += 1) {
    const row = filas[i] || [];
    const fila = i + 1;
    if (!vacio(row[1])) {
      const numero = numeroOc(row[1]);
      actual = numero;
      if (numero && !ordenes.has(numero) && !existentes.has(numero)) {
        ordenes.set(numero, { numero, proveedor: proveedorDe(row[1]), vence: fechaIso(row[0]), fila, renglones: [] });
      }
      if (!numero) omitidos.push(`fila ${fila}: no se reconoce el N° de O.C. en "${limpiar(row[1])}"`);
    }
    if (Number(row[12])) continue; // ya tiene ID: esta en la base
    if (vacio(row[2]) && vacio(row[3]) && vacio(row[4])) continue;
    if (!actual) continue;
    const orden = ordenes.get(actual);
    if (!orden) continue; // la O.C. ya esta en la base
    const renglon = Number(row[2]);
    if (!Number.isInteger(renglon) || renglon <= 0) {
      omitidos.push(`fila ${fila} (${actual}): renglón "${limpiar(row[2])}" no es un número`);
      continue;
    }
    const clave = `${actual}#${renglon}`;
    if (vistos.has(clave)) {
      omitidos.push(`fila ${fila} (${actual}): el renglón ${renglon} está repetido`);
      continue;
    }
    vistos.add(clave);
    const hoja = valoresDeFila(row);
    // a veces se escribio una nota en la col M (la del ID): la sincronizacion la va a pisar con el ID,
    // asi que pasa a la observacion y la sincronizacion la escribe en la col K
    const nota = vacio(row[12]) ? null : limpiar(row[12]);
    if (nota) omitidos.push(`fila ${fila} (${actual}): la nota "${nota}" de la col M pasa a OBSERVACIÓN (col K)`);
    orden.renglones.push({
      fila,
      renglon,
      codigo: limpiar(row[3]).toUpperCase().slice(0, 20),
      descripcion: limpiar(row[4]),
      cantidad: entero(row[5]) ?? 0,
      ...hoja,
      observacion: hoja.observacion && nota ? `${hoja.observacion} - ${nota}`.slice(0, 500) : hoja.observacion || nota,
      hoja
    });
  }
  return { ordenes: [...ordenes.values()].filter((o) => o.renglones.length), omitidos };
}

function vacio(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

async function main() {
  const { cfg, pestana, filas } = await leerExcel();
  const existentes = new Set((await query('SELECT numero FROM oc_ordenes')).map((r) => numeroOc(r.numero)));
  const { ordenes, omitidos } = armarOrdenes(filas, existentes);
  const renglones = ordenes.reduce((n, o) => n + o.renglones.length, 0);
  const completas = ordenes.filter((o) => o.renglones.every((r) => r.completo === 'SI')).length;

  console.log(`Archivo: ${cfg.file_nombre} · pestaña "${pestana}" · ${filas.length - 1} filas`);
  for (const o of ordenes) {
    const si = o.renglones.filter((r) => r.completo === 'SI').length;
    console.log(`  fila ${String(o.fila).padStart(3)}  ${o.numero.padEnd(9)} ${o.proveedor.slice(0, 30).padEnd(30)} vence ${o.vence || '-'.padEnd(10)}  renglones ${o.renglones.length}  completos ${si}`);
  }
  console.log(`\n${ordenes.length} O.C. (${completas} completas, ${ordenes.length - completas} incompletas), ${renglones} renglones.`);
  if (omitidos.length) console.log(`\nAvisos:\n  ${omitidos.join('\n  ')}`);
  if (!aplicar) {
    console.log('\nPrueba: no se guardó nada. Para importar: agregar --aplicar');
    return;
  }

  await transaction(async (conn) => {
    for (const o of ordenes) {
      const hash = crypto.createHash('sha256').update(`excel:${cfg.file_id}:${o.numero}`).digest('hex');
      const [ins] = await conn.execute(
        `INSERT INTO oc_ordenes (numero, proveedor, fecha_oc, vence, procedimiento, subtotal, archivo_nombre, archivo_hash, origen)
         VALUES (:numero, :proveedor, NULL, :vence, NULL, 0, :nombre, :hash, 'excel')`,
        { numero: o.numero, proveedor: o.proveedor, vence: o.vence, nombre: `Excel de Drive (${pestana}, fila ${o.fila})`, hash }
      );
      for (const r of o.renglones) {
        // sync_valores = lo que hay en el Excel: la sincronizacion lo toma como ya acordado
        // (si solo cambia la observacion por la nota de la col M, se la escribe en el Excel)
        await conn.execute(
          `INSERT INTO oc_renglones (orden_id, renglon, codigo, descripcion, cantidad, cantidad_entregada, completo, nro_ingreso, observacion, sync_valores)
           VALUES (:ordenId, :renglon, :codigo, :descripcion, :cantidad, :entregada, :completo, :nroIngreso, :observacion, CAST(:v AS JSON))`,
          {
            ordenId: ins.insertId,
            renglon: r.renglon,
            codigo: r.codigo,
            descripcion: r.descripcion,
            cantidad: r.cantidad,
            entregada: r.entregada,
            completo: r.completo,
            nroIngreso: r.nroIngreso,
            observacion: r.observacion,
            v: JSON.stringify(r.hoja)
          }
        );
      }
    }
  });
  console.log(`\nImportadas ${ordenes.length} O.C. y ${renglones} renglones.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
