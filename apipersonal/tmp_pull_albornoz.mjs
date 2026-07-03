import ZKTeco from 'zkteco-js';

const IP = '10.115.31.10';   // salida arriba
const SN = 'CK7Z211060032';
const DNI = '23135031';      // ALBORNOZ

const device = new ZKTeco(IP, 4370, 10000, 4000);

try {
  await device.createSocket();
  console.log(`Conectado a ${IP}:4370 (${SN})`);

  const result = await device.getAttendances();
  const logs = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
  console.log(`Total fichadas leídas del reloj: ${logs.length}`);

  // Rango de fechas que tiene el reloj
  const fechas = logs
    .map(r => new Date(r.record_time ?? r.recordTime ?? '').getTime())
    .filter(t => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (fechas.length) {
    console.log(`Primera fecha en reloj: ${new Date(fechas[0]).toLocaleString('es-AR')}`);
    console.log(`Última fecha en reloj : ${new Date(fechas[fechas.length-1]).toLocaleString('es-AR')}`);
  }

  // Buscar a ALBORNOZ
  const deAlbornoz = logs.filter(r => String(r.user_id ?? '').replace(/\D/g,'').replace(/^0+/,'') === DNI);
  console.log(`\n=== Fichadas de ALBORNOZ (${DNI}) en el reloj ===`);
  console.log(`Total de ALBORNOZ: ${deAlbornoz.length}`);

  // Mostrar las del 20 al 25 de mayo
  console.log(`\n--- ALBORNOZ del 20 al 25 de mayo ---`);
  for (const r of deAlbornoz) {
    const d = new Date(r.record_time ?? r.recordTime ?? '');
    if (d >= new Date('2026-05-20') && d <= new Date('2026-05-26')) {
      console.log(`  SN=${SN}  ${d.toLocaleString('es-AR')}  type=${r.type}  state=${r.state}`);
    }
  }

  // Mostrar TODAS las de ALBORNOZ (las primeras 30) para ver qué hay
  console.log(`\n--- Primeras fichadas de ALBORNOZ (cualquier fecha) ---`);
  deAlbornoz.slice(0, 30).forEach(r => {
    const d = new Date(r.record_time ?? r.recordTime ?? '');
    console.log(`  ${d.toLocaleString('es-AR')}  type=${r.type}`);
  });

  await device.disconnect();
} catch (e) {
  console.error('ERROR:', e.message);
  try { await device.disconnect(); } catch {}
  process.exit(1);
}
