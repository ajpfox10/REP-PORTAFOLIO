// background.js — coordina un envío: trae al frente la pestaña de WhatsApp Web ya abierta
// (cualquiera sea su posición), busca por nombre y, si no lo encuentra, abre el chat por teléfono.
// Al terminar devuelve el foco a la pestaña de la app.
//
// payload: { modo: 'NOMBRE_TELEFONO' | 'NOMBRE' | 'TELEFONO', buscar, palabras: string[], telefono, texto }
// respuesta: { ok, estado: 'ENVIADO'|'NO_ENCONTRADO'|'SIN_WHATSAPP'|'ERROR', modo: 'NOMBRE'|'TELEFONO', destino, detalle }

const WA = 'https://web.whatsapp.com/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'hpw') return;
  port.onMessage.addListener(async ({ type, payload }) => {
    let r;
    try {
      r = type === 'ENVIAR' ? await enviar(payload, port.sender?.tab)
        : type === 'CONTACTOS' ? await contactos()
        : { ok: false, estado: 'ERROR', detalle: `Acción desconocida: ${type}` };
    } catch (e) {
      r = { ok: false, estado: 'ERROR', detalle: String(e?.message || e).slice(0, 200) };
    }
    try { port.postMessage(r); } catch { /* la página se cerró */ }
  });
});

async function enviar(p, appTab) {
  const tab = await pestaniaWhatsapp();
  try {
    await alFrente(tab);
    await asegurarScript(tab.id);

    const listo = await aTab(tab.id, { type: 'ESTADO' }, 60000);
    if (!listo?.ok) return { ok: false, estado: 'ERROR', detalle: listo?.detalle || 'WhatsApp Web no está listo' };

    let porNombre = null;
    if (p.modo !== 'TELEFONO' && p.buscar) {
      porNombre = await aTab(tab.id, { type: 'POR_NOMBRE', buscar: p.buscar, palabras: p.palabras, texto: p.texto }, 60000);
      if (porNombre.estado !== 'NO_ENCONTRADO' || p.modo === 'NOMBRE') return { ...porNombre, modo: 'NOMBRE' };
    }
    if (!p.telefono) {
      return { ok: false, estado: 'NO_ENCONTRADO', modo: 'NOMBRE', detalle: [porNombre?.detalle, 'sin celular en la base'].filter(Boolean).join(' · ') };
    }

    // Por teléfono: el link /send abre el chat aunque no esté agendado (recarga WhatsApp Web)
    await chrome.tabs.update(tab.id, { url: `${WA}send?phone=${encodeURIComponent(p.telefono)}` });
    await cargaCompleta(tab.id);
    await asegurarScript(tab.id);
    const r = await aTab(tab.id, { type: 'POR_LINK', texto: p.texto }, 90000);
    return {
      ...r, modo: 'TELEFONO', destino: `+${p.telefono}`,
      detalle: [porNombre?.detalle && `Por nombre: ${porNombre.detalle}`, r.detalle].filter(Boolean).join(' · ') || null,
    };
  } finally {
    if (appTab?.id) {
      try {
        await chrome.tabs.update(appTab.id, { active: true });
        await chrome.windows.update(appTab.windowId, { focused: true });
      } catch { /* la app se cerró */ }
    }
  }
}

async function pestaniaWhatsapp() {
  const tabs = await chrome.tabs.query({ url: `${WA}*` });
  if (tabs.length) return tabs[0];
  const tab = await chrome.tabs.create({ url: WA, active: true });
  await cargaCompleta(tab.id);
  return tab;
}

// WhatsApp no dibuja la lista de resultados si la pestaña está oculta → se la trae al frente.
async function alFrente(tab) {
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  await sleep(400);
}

function cargaCompleta(tabId, ms = 45000) {
  return new Promise((resolve) => {
    const fin = setTimeout(() => { chrome.tabs.onUpdated.removeListener(oir); resolve(); }, ms);
    function oir(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(fin); chrome.tabs.onUpdated.removeListener(oir); resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(oir);
  });
}

// La pestaña de WhatsApp abierta antes de instalar la extensión no tiene el script: se inyecta.
async function asegurarScript(tabId) {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (r?.ok) return;
    } catch { /* todavía no está */ }
    if (i === 2) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['wa.js'] }); } catch { /* cargando */ }
    }
    await sleep(500);
  }
  throw new Error('No se pudo conectar con la pestaña de WhatsApp Web');
}

function aTab(tabId, msg, ms) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    sleep(ms).then(() => ({ ok: false, estado: 'ERROR', detalle: 'WhatsApp tardó demasiado en responder' })),
  ]);
}

// Agenda de WhatsApp Web: nombre agendado + número. Los números no están en pantalla: se leen de
// los datos internos de WhatsApp (módulo WAWebCollections, mundo MAIN de la página). Si WhatsApp
// cambia ese módulo, esto deja de andar y hay que ajustarlo.
async function contactos() {
  const tabs = await chrome.tabs.query({ url: `${WA}*` });
  if (!tabs.length) return { ok: false, estado: 'ERROR', detalle: 'No hay ninguna pestaña de WhatsApp Web abierta' };
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    world: 'MAIN',
    func: () => {
      try {
        const req = window.require;
        if (typeof req !== 'function') return { ok: false, detalle: 'WhatsApp Web no terminó de cargar (o cambió su estructura)' };
        const col = req('WAWebCollections');
        const C = col && col.Contact;
        const lista = (C && (C.getModelsArray ? C.getModelsArray() : C._models)) || [];
        const out = [];
        for (const c of lista) {
          const id = c.id || {};
          if (id.server === 'g.us' || id.server === 'broadcast' || id.server === 'newsletter' || c.isGroup) continue;
          const tel = id.server === 'c.us' ? id.user : (c.phoneNumber && c.phoneNumber.user) || null;
          if (!tel) continue;
          out.push({ numero: String(tel), nombre: c.name || '', pushname: c.pushname || '', agendado: !!(c.isMyContact || c.name) });
        }
        return { ok: true, contactos: out };
      } catch (e) {
        return { ok: false, detalle: 'No se pudo leer la agenda: ' + String((e && e.message) || e).slice(0, 150) };
      }
    },
  });
  const r = res && res.result;
  if (!r || !r.ok) return { ok: false, estado: 'ERROR', detalle: (r && r.detalle) || 'No se pudo leer la agenda' };
  return { ok: true, estado: 'OK', contactos: r.contactos };
}
