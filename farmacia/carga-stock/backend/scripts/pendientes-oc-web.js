const config = require('../src/config');
const { pool } = require('../src/db');
const { launchBrowser, sleep, login, openFarmaciaMs, selectSector } = require('../src/farmaciaWeb');
const pendientes = require('../src/ocPendientesMs');

// Robot de pendientes de ingreso: Farmacia MS > Reportes > Articulos Pendientes de Ingreso, buscando por O.C.
// Por cada O.C. de la consulta (oc_ms_consultas.ocs) pide el encabezado (jx-find-reporte-compras-oc) y,
// por cada resultado, el detalle por renglon (verReporteConsultaCompras): adjudicada, desafectada, ingresada, faltante.
// Entra con el usuario de respaldo (FARMACIA_WEB_USER_RESPALDO) si esta cargado; si no, con el principal.
const BASE = 'https://sistemas.ms.gba.gov.ar/farmaciams';

function numero(texto) {
  const t = String(texto ?? '').trim();
  if (!t || t === '-') return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function consultarOc(page, ocNumero) {
  const [nro, anio] = ocNumero.split('/');
  const busqueda = await page.request.get(`${BASE}/jx-find-reporte-compras-oc?${new URLSearchParams({ nro, anio })}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
  });
  const encabezados = (await busqueda.json().catch(() => ({}))).data || [];
  if (!encabezados.length) return { cabecera: null, renglones: [] };

  // una O.C. puede tener mas de un resultado (prorrogas): se juntan los renglones
  const renglones = new Map();
  for (const e of encabezados) {
    const ver = await page.request.post(`${BASE}/reportes/verReporteConsultaCompras`, {
      form: { 'pdf-id': e.ID_OC, 'pdf-tipo': '0', 'pdf-nro-interno': e.NRO_INTERNO, 'pdf-nro-prove': e.NRO_PROVE }
    });
    const filas = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return [...doc.querySelectorAll('#datos tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
    }, await ver.text());
    for (const f of filas) {
      const renglon = Number(f[0]);
      if (!Number.isInteger(renglon) || f.length < 7 || renglones.has(renglon)) continue;
      renglones.set(renglon, {
        renglon,
        codigo: f[1] || null,
        descripcion: f[2] || null,
        adjudicada: numero(f[3]),
        desafectada: numero(f[4]),
        ingresada: numero(f[5]),
        faltante: numero(f[6])
      });
    }
  }
  const e = encabezados[0];
  return {
    cabecera: {
      nroSolicitud: encabezados.map((x) => x.NRO_INTERNO).filter(Boolean).join(', '),
      proveedor: String(e.RAZON_SOCIAL || '').trim() || null,
      prorroga: encabezados.some((x) => x.PRORROGA === 'SI') ? 'SI' : 'NO'
    },
    renglones: [...renglones.values()].sort((a, b) => a.renglon - b.renglon)
  };
}

async function main() {
  const consultaId = Number(process.env.OCMS_CONSULTA_ID || 0);
  const consulta = await pendientes.leerConsulta(consultaId);
  if (!consulta) throw new Error(`No existe la consulta #${consultaId}`);
  const credenciales = config.farmacia.respaldo.user && config.farmacia.respaldo.password ? config.farmacia.respaldo : config.farmacia;
  if (!credenciales.user || !credenciales.password) throw new Error('Falta el usuario de Farmacia MS en el .env (FARMACIA_WEB_USER_RESPALDO o FARMACIA_WEB_USER)');

  let browser = null;
  let hechas = 0;
  let encontradas = 0;
  try {
    browser = await launchBrowser({ headless: true });
    const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    await pendientes.actualizarConsulta(consultaId, { mensaje: `Entrando a Farmacia MS (${credenciales.user})` });
    await login(page, credenciales);
    if (/profile\/upgrade/.test(page.url())) {
      throw new Error(`El usuario ${credenciales.user} tiene que validar sus datos en la intranet antes de poder entrar`);
    }
    await selectSector(await openFarmaciaMs(page));

    for (const oc of consulta.ocs) {
      await pendientes.actualizarConsulta(consultaId, { mensaje: `Consultando O.C. ${oc} (${hechas + 1} de ${consulta.ocs.length})` });
      const { cabecera, renglones } = await consultarOc(page, oc);
      await pendientes.guardarResultado(consultaId, oc, cabecera, renglones);
      hechas += 1;
      if (cabecera) encontradas += 1;
      await pendientes.actualizarConsulta(consultaId, { hechas, encontradas });
      console.log(`${oc}: ${cabecera ? `${renglones.length} renglones, ${renglones.filter((r) => r.faltante > 0).length} con faltante` : 'no encontrada en Farmacia MS'}`);
      await sleep(300);
    }

    const noEncontradas = hechas - encontradas;
    await pendientes.actualizarConsulta(consultaId, {
      estado: 'ok',
      mensaje: `Listo: ${encontradas} O.C. consultadas en Farmacia MS${noEncontradas ? `, ${noEncontradas} no encontradas` : ''}.`,
      finished_at: new Date()
    });
  } catch (error) {
    await pendientes.actualizarConsulta(consultaId, { estado: 'error', hechas, encontradas, mensaje: error.message.slice(0, 500), finished_at: new Date() });
    throw error;
  } finally {
    if (browser) await browser.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
