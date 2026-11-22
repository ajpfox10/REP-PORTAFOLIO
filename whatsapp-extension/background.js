// background.js — coordina un envío: trae al frente la pestaña de WhatsApp Web ya abierta
// (cualquiera sea su posición), busca por nombre y, si no lo encuentra, abre el chat por teléfono.
// Al terminar devuelve el foco a la pestaña de la app.
//
// payload: { modo: 'NOMBRE_TELEFONO' | 'NOMBRE' | 'TELEFONO', buscar, palabras: string[], telefono, texto, imagen? (data URL),
//            sinEnviar? (1.8.0: abre el chat y deja el mensaje escrito; el Enviar lo toca la persona) }
// respuesta: { ok, estado: 'ENVIADO'|'ESCRITO'|'NO_ENCONTRADO'|'SIN_WHATSAPP'|'ERROR', modo: 'NOMBRE'|'TELEFONO', destino, detalle }

const WA = 'https://web.whatsapp.com/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Autoactualización ────────────────────────────────────────────────────────
// Chrome no actualiza solas las extensiones "descomprimidas". El actualizador de Windows
// (actualizar.ps1, tarea programada) baja la versión nueva y pisa los archivos de esta carpeta;
// acá se detecta que el manifest.json del disco cambió de versión y la extensión se recarga.
// No se recarga en medio de un envío o lectura (ocupado > 0): se reintenta en la próxima alarma.
let ocupado = 0;
async function revisarVersionEnDisco() {
  if (ocupado > 0) return;
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' });
    const disco = (await r.json()).version;
    if (disco && disco !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch { /* manifest a medio copiar: se reintenta en la próxima */ }
}
chrome.alarms.create('hpw-version', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'hpw-version') void revisarVersionEnDisco(); });
chrome.runtime.onStartup.addListener(() => { void revisarVersionEnDisco(); });

// 1.9.3: los envíos hacen FILA. Dos a la vez en el mismo Chrome (un programado + un "Escribir" a
// mano, o dos pestañas de la app) se pisaban: el /send?phone= de uno recargaba WhatsApp Web en medio
// del otro ("message channel closed before a response was received"). Ahora cada uno espera al anterior.
let colaEnvios = Promise.resolve();
function enFila(fn) {
  const p = colaEnvios.then(fn, fn);
  colaEnvios = p.catch(() => {});
  return p;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'hpw') return;
  port.onMessage.addListener(async ({ type, payload }) => {
    let r;
    ocupado++;
    try {
      r = type === 'ENVIAR' ? await enFila(() => enviar(payload, port.sender?.tab))
        : type === 'CONTACTOS' ? await contactos()
        : type === 'RECIBIDOS' ? await recibidos()
        : type === 'SIN_LEER' ? await sinLeer(payload)
        : type === 'ESTADO_WA' ? await estadoWhatsapp()
        // 1.9.0: la app vio en el servidor una versión más nueva → si el actualizador ya la copió al disco,
        // se recarga ya (sin esperar la alarma de 5 min). Las versiones viejas no conocen esta acción y
        // se recargan igual (ver "Acción desconocida" abajo): por eso la app la manda.
        : type === 'REVISAR_VERSION' ? (ocupado <= 1 ? (setTimeout(() => void revisarVersionEnDisco(), 300), { ok: true, estado: 'OK' }) : { ok: false, estado: 'OCUPADO' })
        : type === 'CUIL_ANSES' ? await cuilAnses(payload)
        : type === 'RDAM' ? await rdam(payload)
        : { ok: false, estado: 'ERROR', detalle: `Acción desconocida: ${type}` };
      // Si la página pide algo que este código no conoce, Chrome quedó con un fondo viejo:
      // se recarga la extensión para tomar los archivos del disco (la próxima vez anda).
      if (r.detalle?.startsWith('Acción desconocida')) setTimeout(() => chrome.runtime.reload(), 500);
    } catch (e) {
      r = { ok: false, estado: 'ERROR', detalle: String(e?.message || e).slice(0, 200) };
    } finally {
      ocupado--;
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
      porNombre = await aTab(tab.id, { type: 'POR_NOMBRE', buscar: p.buscar, palabras: p.palabras, texto: p.texto, imagen: p.imagen || null, sinEnviar: !!p.sinEnviar }, p.imagen ? 75000 : 45000);
      // Cualquier falla por nombre (no agendado, varios, chat que no abre…) pasa al teléfono.
      // Salvo que se haya cortado por tiempo: el script podría seguir y mandarlo igual → no duplicar.
      if (porNombre.ok || porNombre.timeout || p.modo === 'NOMBRE') return { ...porNombre, modo: 'NOMBRE' };
    }
    if (!p.telefono) {
      return { ok: false, estado: 'NO_ENCONTRADO', modo: 'NOMBRE', detalle: [porNombre?.detalle, 'sin celular en la base'].filter(Boolean).join(' · ') };
    }

    // Por teléfono: el link /send abre el chat aunque no esté agendado (recarga WhatsApp Web)
    await chrome.tabs.update(tab.id, { url: `${WA}send?phone=${encodeURIComponent(p.telefono)}` });
    await cargaCompleta(tab.id);
    await asegurarScript(tab.id);
    const r = await aTab(tab.id, { type: 'POR_LINK', texto: p.texto, imagen: p.imagen || null, sinEnviar: !!p.sinEnviar }, 90000);
    return {
      ...r, modo: 'TELEFONO', destino: `+${p.telefono}`,
      detalle: [porNombre?.detalle && `Por nombre: ${porNombre.detalle}`, r.detalle].filter(Boolean).join(' · ') || null,
    };
  } finally {
    // sinEnviar (Agenda de turnos): el mensaje quedó escrito → WhatsApp queda al frente para que la persona toque Enviar
    if (appTab?.id && !p.sinEnviar) {
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
    sleep(ms).then(() => ({ ok: false, estado: 'ERROR', timeout: true, detalle: 'WhatsApp tardó demasiado en responder' })),
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

// Mensajes RECIBIDOS en chats individuales (sin grupos ni difusiones), leídos de la memoria de
// WhatsApp Web (WAWebCollections, mundo MAIN). Solo datos para contar: id, número, hora y nombre
// del remitente; NO el texto. No abre chats ni manda el "visto": los no leídos quedan como estaban.
// Solo trae lo que WhatsApp Web tiene cargado (lo reciente de cada chat).
async function recibidos() {
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
        const arr = (c) => (c && (c.getModelsArray ? c.getModelsArray() : c._models)) || [];
        const IGNORAR = new Set(['e2e_notification', 'notification_template', 'gp2', 'protocol', 'call_log', 'ciphertext', 'revoked', 'notification']);
        const out = [];
        let chats = 0, sinNumero = 0;
        for (const ch of arr(col.Chat)) {
          const id = ch.id || {};
          if (ch.isGroup || ['g.us', 'broadcast', 'newsletter'].includes(id.server)) continue;
          chats++;
          const contacto = (col.Contact && col.Contact.get && col.Contact.get(id)) || ch.contact || {};
          const numero = id.server === 'c.us' ? id.user : (contacto.phoneNumber && contacto.phoneNumber.user) || null;
          const nombre = contacto.name || contacto.pushname || ch.formattedTitle || '';
          for (const m of arr(ch.msgs)) {
            if (!m.id || m.id.fromMe || m.isNotification || IGNORAR.has(m.type)) continue;
            if (!numero) { sinNumero++; continue; }
            out.push({ id: m.id._serialized || `${id._serialized}_${m.id.id}`, numero: String(numero), t: m.t, nombre });
          }
        }
        return { ok: true, chats, sinNumero, mensajes: out };
      } catch (e) {
        return { ok: false, detalle: 'No se pudieron leer los mensajes: ' + String((e && e.message) || e).slice(0, 150) };
      }
    },
  });
  const r = res && res.result;
  if (!r || !r.ok) return { ok: false, estado: 'ERROR', detalle: (r && r.detalle) || 'No se pudieron leer los mensajes' };
  return { ok: true, estado: 'OK', chats: r.chats, sinNumero: r.sinNumero, mensajes: r.mensajes };
}

// ── ¿Hay WhatsApp Web abierto y listo en este navegador? (1.9.2) ─────────────
// Lo usa la lista "PCs conectadas" de la agenda de turnos para saber cuál puede mandar.
// No toca la pestaña: solo mira si existe y si WhatsApp terminó de cargar (con sesión iniciada).
async function estadoWhatsapp() {
  const tabs = await chrome.tabs.query({ url: `${WA}*` });
  if (!tabs.length) return { ok: true, estado: 'OK', abierto: false, listo: false };
  let listo = false;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world: 'MAIN',
      func: () => {
        try {
          const col = typeof window.require === 'function' && window.require('WAWebCollections');
          const chats = col && col.Chat && (col.Chat.getModelsArray ? col.Chat.getModelsArray() : col.Chat._models);
          return !!(chats && chats.length);
        } catch { return false; }
      },
    });
    listo = !!(res && res.result);
  } catch { /* pestaña descartada o cargando */ }
  return { ok: true, estado: 'OK', abierto: true, listo };
}

// ── Mensajes SIN LEER de un número (1.9.0, agenda de turnos) ─────────────────
// Antes de mandar un enlace la app pregunta si esa persona tiene mensajes sin leer: al mandar,
// WhatsApp marcaría el chat como leído y la oficina perdería lo que había escrito. Se lee de la
// memoria de WhatsApp Web (mundo MAIN), SIN abrir el chat ni mandar el visto.
// payload: { telefono } → { ok, estado: 'OK', encontrado, sinLeer (n; -1 = marcado como no leído a mano), mensajes: [{ t, tipo, texto }] }
async function sinLeer(p) {
  const tabs = await chrome.tabs.query({ url: `${WA}*` });
  if (!tabs.length) return { ok: false, estado: 'ERROR', detalle: 'No hay ninguna pestaña de WhatsApp Web abierta' };
  const tel = String((p && p.telefono) || '').replace(/\D/g, '');
  if (tel.length < 10) return { ok: false, estado: 'ERROR', detalle: 'Número inválido' };
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    world: 'MAIN',
    args: [tel.slice(-10)],
    func: (ult10) => {
      try {
        const req = window.require;
        if (typeof req !== 'function') return { ok: false, detalle: 'WhatsApp Web no terminó de cargar (o cambió su estructura)' };
        const col = req('WAWebCollections');
        const arr = (c) => (c && (c.getModelsArray ? c.getModelsArray() : c._models)) || [];
        const IGNORAR = new Set(['e2e_notification', 'notification_template', 'gp2', 'protocol', 'call_log', 'ciphertext', 'revoked', 'notification']);
        const TIPO = { image: '📷 foto', video: '🎥 video', ptt: '🎤 audio', audio: '🎤 audio', document: '📄 documento', sticker: '🏷 sticker', location: '📍 ubicación', vcard: '👤 contacto' };
        for (const ch of arr(col.Chat)) {
          const id = ch.id || {};
          if (ch.isGroup || ['g.us', 'broadcast', 'newsletter'].includes(id.server)) continue;
          const contacto = (col.Contact && col.Contact.get && col.Contact.get(id)) || ch.contact || {};
          const numero = id.server === 'c.us' ? id.user : (contacto.phoneNumber && contacto.phoneNumber.user) || '';
          if (!numero || String(numero).slice(-10) !== ult10) continue;
          const n = Number(ch.unreadCount || 0);
          if (n === 0) return { ok: true, encontrado: true, sinLeer: 0, mensajes: [] };
          const recibidos = arr(ch.msgs)
            .filter((m) => m.id && !m.id.fromMe && !m.isNotification && !IGNORAR.has(m.type))
            .sort((a, b) => (a.t || 0) - (b.t || 0));
          const cuantos = n > 0 ? Math.min(n, 15) : 1;
          const mensajes = recibidos.slice(-cuantos).map((m) => {
            const cuerpo = m.type === 'chat' ? (m.body || '') : (m.caption || '');
            const tipo = m.type === 'chat' ? 'texto' : (TIPO[m.type] || m.type || 'otro');
            return { t: m.t || null, tipo, texto: String(m.type === 'chat' ? cuerpo : [tipo, cuerpo].filter(Boolean).join(' · ')).slice(0, 1000) };
          });
          return { ok: true, encontrado: true, sinLeer: n, mensajes };
        }
        return { ok: true, encontrado: false, sinLeer: 0, mensajes: [] };
      } catch (e) {
        return { ok: false, detalle: 'No se pudo leer el chat: ' + String((e && e.message) || e).slice(0, 150) };
      }
    },
  });
  const r = res && res.result;
  if (!r || !r.ok) return { ok: false, estado: 'ERROR', detalle: (r && r.detalle) || 'No se pudo leer el chat' };
  return { ok: true, estado: 'OK', encontrado: r.encontrado, sinLeer: r.sinLeer, mensajes: r.mensajes };
}

// ── Constancia de CUIL (ANSES) ───────────────────────────────────────────────
// Una consulta por mensaje: la app hace el bucle y las pausas entre agentes. Se usa una sola
// pestaña de ANSES (en segundo plano, la app sigue al frente) que se recarga en cada consulta.
// Si ANSES responde con su protección anti-robots, se devuelve BLOQUEADO y la app frena todo.
const ANSES = 'https://servicioswww.anses.gob.ar/C2-ConstaCUIL';
let ansesTabId = null;

async function cuilAnses(p) {
  let tab = null;
  if (ansesTabId != null) { try { tab = await chrome.tabs.get(ansesTabId); } catch { tab = null; } }
  if (tab) await chrome.tabs.update(tab.id, { url: ANSES });
  else { tab = await chrome.tabs.create({ url: ANSES, active: false }); ansesTabId = tab.id; }
  await cargaCompleta(tab.id);

  let ping = null;
  for (let i = 0; i < 20 && !ping?.ok; i++) {
    try { ping = await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); } catch { /* cargando */ }
    if (!ping?.ok && i === 2) {
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['anses.js'] }); } catch { /* cargando */ }
    }
    if (!ping?.ok) await sleep(500);
  }
  if (!ping?.ok) return { ok: false, estado: 'ERROR', detalle: 'No se pudo conectar con la página de ANSES' };
  if (ping.bloqueado) return { ok: false, estado: 'BLOQUEADO', detalle: 'ANSES respondió con su página de protección (bloqueo o verificación)' };

  return Promise.race([
    chrome.tabs.sendMessage(tab.id, { type: 'CONSULTAR', ...p }),
    sleep(60000).then(() => ({ ok: false, estado: 'ERROR', detalle: 'ANSES tardó demasiado en responder' })),
  ]);
}

// ── Certificado RDAM (Registro de Deudores Alimentarios Morosos) ─────────────
// El formulario /solicitudCertificado es un trámite PÚBLICO: no pide login ni captcha. Al tocar
// "Imprimir certificado", Livewire redirige la pestaña a /certificado-libre-deuda-RDAM/<código>,
// que es el PDF (se baja sin cookies). Si la persona además está logueada, la página muestra la
// tabla "Certificados solicitados": ahí se reusa el certificado de HOY de ese DNI (no se piden dos)
// y sirve de respaldo para encontrar el código si no hubo redirect.
// payload: { dni, sexo: '1'|'2', apellido, nombre, forzar }
// respuesta: { ok, estado: 'OK'|'NO_GENERADO'|'ERROR', reusado, codigo, pdf (base64), detalle }
const RDAM_BASE = 'https://rdam.mjus.gba.gob.ar';
const RDAM_URL = `${RDAM_BASE}/solicitudCertificado?sort=created_at&search=`;
const RDAM_COD = /\/certificado-(?:libre-deuda|ver)-RDAM\/([^/?#]+)/;
let rdamTabId = null;

// Abre el formulario (con la tabla, si hay sesión, ya filtrada por ese DNI).
async function rdamAbrir(dni) {
  const url = RDAM_URL + encodeURIComponent(String(dni));
  let tab = null;
  if (rdamTabId != null) { try { tab = await chrome.tabs.get(rdamTabId); } catch { tab = null; } }
  // Entrar directo a la URL a veces rebota al tablero: se reintenta.
  for (let intento = 0; intento < 3; intento++) {
    if (tab) await chrome.tabs.update(tab.id, { url });
    else { tab = await chrome.tabs.create({ url, active: false }); rdamTabId = tab.id; }
    await cargaCompleta(tab.id);
    let ping = null;
    for (let i = 0; i < 20 && !ping?.ok; i++) {
      try { ping = await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); } catch { /* cargando */ }
      if (!ping?.ok && i === 2) {
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['rdam.js'] }); } catch { /* cargando */ }
      }
      if (!ping?.ok) await sleep(500);
    }
    if (ping?.enFormulario) return { tab };
  }
  return { tab, error: 'No se pudo abrir el formulario del RDAM' };
}

function rdamA(tabId, msg, ms = 60000) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    sleep(ms).then(() => ({ ok: false, estado: 'ERROR', detalle: 'El RDAM tardó demasiado en responder' })),
  ]);
}

// Espera que la pestaña navegue al PDF del certificado y devuelve el código (o null).
function rdamEsperarCodigo(tabId, ms) {
  return new Promise((resolve) => {
    const fin = setTimeout(() => { chrome.tabs.onUpdated.removeListener(oir); resolve(null); }, ms);
    function oir(id, info, t) {
      const m = id === tabId && RDAM_COD.exec(info.url || t?.url || '');
      if (m) { clearTimeout(fin); chrome.tabs.onUpdated.removeListener(oir); resolve(m[1]); }
    }
    chrome.tabs.onUpdated.addListener(oir);
  });
}

// Desde nov/2026 el RDAM entrega el PDF como descarga (Content-Disposition: attachment): la pestaña
// ya no navega al PDF y rdamEsperarCodigo no se entera. Este gancho corre en el mundo de la página
// (Livewire v2), toma el código de effects.redirect de la respuesta y anula la redirección (así
// tampoco se baja un PDF suelto a Descargas). Lo deja en <html data-hpw-rdam-codigo> para rdam.js.
async function rdamGancho(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      if (window.__hpwRdamGancho || !window.Livewire?.hook) return;
      window.__hpwRdamGancho = true;
      window.Livewire.hook('message.received', (message) => {
        const fx = message?.response?.effects;
        const m = fx && /\/certificado-(?:libre-deuda|ver)-RDAM\/([^/?#]+)/.exec(fx.redirect || '');
        if (m) { document.documentElement.dataset.hpwRdamCodigo = m[1]; fx.redirect = null; }
      });
    },
  });
}

async function rdamPdf(codigo) {
  const r = await fetch(`${RDAM_BASE}/certificado-libre-deuda-RDAM/${encodeURIComponent(codigo)}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`El RDAM no entregó el PDF (HTTP ${r.status})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') throw new Error('Lo que devolvió el RDAM no es un PDF');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function rdam(p) {
  let a = await rdamAbrir(p.dni);
  if (a.error) return { ok: false, estado: 'ERROR', detalle: a.error };

  const antes = await rdamA(a.tab.id, { type: 'LISTAR', dni: p.dni });
  if (!antes.ok) return antes;
  const deHoy = antes.filas.find((f) => f.fecha.startsWith(hoyLocal()));
  let codigo = !p.forzar && deHoy ? deHoy.codigo : null;
  const reusado = !!codigo;
  let aviso = null;

  if (!codigo) {
    try { await rdamGancho(a.tab.id); } catch { /* sin gancho queda el respaldo del redirect */ }
    const redirect = rdamEsperarCodigo(a.tab.id, 90000);
    // Si la página navega al PDF, el script de la pestaña muere y el mensaje se corta: es lo esperado.
    const env = await rdamA(a.tab.id, { type: 'SOLICITAR', dni: p.dni, sexo: p.sexo, apellido: p.apellido, nombre: p.nombre }, 90000)
      .catch(() => ({ ok: true, estado: 'ENVIADO', detalle: null }));
    aviso = env.detalle || null;
    codigo = env.codigo || await Promise.race([redirect, sleep(env.ok ? 15000 : 1000).then(() => null)]);
    if (!codigo && !env.ok) return env;
    // Respaldo con sesión: la tabla no se refresca sola, se recarga y se busca la fila nueva.
    const viejos = new Set(antes.filas.map((f) => f.codigo));
    for (let i = 0; i < 3 && !codigo; i++) {
      a = await rdamAbrir(p.dni);
      if (a.error) break;
      const despues = await rdamA(a.tab.id, { type: 'LISTAR', dni: p.dni });
      if (!despues.ok) break;
      codigo = despues.filas.find((f) => !viejos.has(f.codigo))?.codigo || null;
      if (!codigo) await sleep(2000);
    }
    if (!codigo) return { ok: false, estado: 'NO_GENERADO', detalle: aviso || 'El RDAM no generó el certificado' };
  }

  return { ok: true, estado: 'OK', reusado, codigo, pdf: await rdamPdf(codigo), detalle: aviso };
}
