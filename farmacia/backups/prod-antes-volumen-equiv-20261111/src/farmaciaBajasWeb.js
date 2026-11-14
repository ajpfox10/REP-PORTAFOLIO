const { sleep } = require('./farmaciaWeb');

// Lee de Farmacia MS (sector activo de la sesion) los egresos que no son consumo: Descarte,
// Por Vencimiento y Devoluciones al Deposito (Vencidos). Recorre el Listado de Egresos con filtro
// por tipo y fechas y abre el detalle de cada egreso. SOLO LECTURA: en el detalle hay botones
// de Borrar/Finalizar/Agregar que nunca se tocan.
const LISTADO_URL = 'https://sistemas.ms.gba.gov.ar/farmaciams/egresos/';
const TIPOS_BAJA = [
  { valor: '21', nombre: 'Descarte' },
  { valor: '8', nombre: 'Por Vencimiento' },
  { valor: '10', nombre: 'Devoluciones al Depósito (Vencidos)' }
];

function fechaIso(texto) {
  const m = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(String(texto || ''));
  if (!m) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${anio}-${m[2]}-${m[1]}`;
}

function numero(texto) {
  const t = String(texto || '').trim();
  if (!t) return 0;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

async function listarEgresosTipo(page, tipo, desdeAr, hastaAr) {
  await page.goto(LISTADO_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('[id$=_filtros_tipoegreso]').waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(({ t, desde, hasta }) => {
    document.querySelector('[id$=_filtros_fechaDesde]').value = desde;
    document.querySelector('[id$=_filtros_fechaHasta]').value = hasta;
    const s = document.querySelector('[id$=_filtros_tipoegreso]');
    s.value = t;
    if (window.jQuery) window.jQuery(s).trigger('change');
    const c = document.querySelector('[id$=_cantResultsPage]');
    c.value = '50';
    if (window.jQuery) window.jQuery(c).trigger('change');
  }, { t: tipo.valor, desde: desdeAr, hasta: hastaAr });
  await page.click('button[id^="buscar-form"]');
  await sleep(2500);

  const egresos = new Map();
  for (let pagina = 1; pagina <= 40; pagina += 1) {
    const filas = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map((tr) => {
      const celdas = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim());
      const ver = [...tr.querySelectorAll('a')].map((a) => a.getAttribute('href')).find((h) => h && /\/egresos\/\d+\//.test(h));
      return { celdas, ver };
    }));
    let nuevos = 0;
    for (const f of filas) {
      if (!f.ver || !/^\d+$/.test(f.celdas[0] || '')) continue;
      if (!egresos.has(f.celdas[0])) { egresos.set(f.celdas[0], { egresoId: f.celdas[0], fechaLista: f.celdas[1], ver: f.ver }); nuevos += 1; }
    }
    const total = await page.evaluate(() => Number((document.body.innerText.match(/Total de registros:\s*(\d+)/i) || [])[1] || 0));
    if (!nuevos || egresos.size >= total) break;
    const siguiente = page.locator('button[id^="nextPage-form"]');
    if (!(await siguiente.count()) || await siguiente.isDisabled().catch(() => true)) break;
    await siguiente.click();
    await sleep(2000);
  }
  return Array.from(egresos.values());
}

async function leerDetalleEgreso(page, egreso, tipo) {
  await page.goto(new URL(egreso.ver, 'https://sistemas.ms.gba.gov.ar').toString(), { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const datos = await page.evaluate(() => {
    const texto = document.body.innerText;
    const fecha = (texto.match(/Fecha de Egreso:\s*([0-9/]+)/i) || [])[1] || null;
    const motivo = ((texto.match(/Motivo:\s*([^\n]+)/i) || [])[1] || '').trim() || null;
    // Tabla de detalle: la que tiene columnas de Codigo y Cantidad
    const tabla = [...document.querySelectorAll('table')].find((t) => /C[oó]digo/i.test(t.innerText) && /Cantidad/i.test(t.innerText));
    if (!tabla) return { fecha, motivo, filas: [], headers: [] };
    const headers = [...tabla.querySelectorAll('thead th, tr:first-child th')].map((th) => th.innerText.trim());
    const filas = [...tabla.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()));
    return { fecha, motivo, headers, filas };
  });
  const col = (re) => datos.headers.findIndex((h) => re.test(h));
  const iCod = col(/C[oó]digo/i);
  const iMed = col(/Medicamento|Art[ií]culo|Descripci/i);
  const iLote = col(/Lote/i);
  const iVto = col(/Vto|Venc/i);
  const iCant = col(/Cantidad/i);
  const items = datos.filas
    // Codigos de 1 a 3 letras + digitos (M2022228, LA199073...)
    .filter((f) => iCod >= 0 && /^[A-Z]{1,3}\d{4,}/.test(String(f[iCod] || '').toUpperCase()))
    .map((f) => ({
      codigo: String(f[iCod]).toUpperCase(),
      medicamento: iMed >= 0 ? f[iMed] || null : null,
      lote: iLote >= 0 ? f[iLote] || null : null,
      vencimiento: iVto >= 0 ? fechaIso(f[iVto]) : null,
      cantidad: iCant >= 0 ? numero(f[iCant]) : 0
    }));
  return {
    egresoId: egreso.egresoId,
    fecha: fechaIso(datos.fecha || egreso.fechaLista),
    tipo: tipo.nombre,
    motivo: datos.motivo,
    items
  };
}

// Devuelve todos los egresos de baja del sector activo entre desde y hasta (dd/mm/aaaa)
async function leerBajasSector(page, desdeAr, hastaAr, avisar = () => {}) {
  const resultado = [];
  for (const tipo of TIPOS_BAJA) {
    const lista = await listarEgresosTipo(page, tipo, desdeAr, hastaAr);
    for (const [i, e] of lista.entries()) {
      avisar(`${tipo.nombre}: egreso ${i + 1} de ${lista.length}`);
      resultado.push(await leerDetalleEgreso(page, e, tipo));
    }
  }
  return resultado;
}

module.exports = { leerBajasSector, fechaIso };
