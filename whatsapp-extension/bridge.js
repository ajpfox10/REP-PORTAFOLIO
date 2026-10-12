// bridge.js — corre en la página de la app de Personal.
// La página no puede hablar con la extensión directo: le manda window.postMessage({ hpw: 'app', id, type, payload })
// y este puente lo reenvía al background por un puerto (que mantiene vivo al service worker mientras envía).
// Respuesta a la página: window.postMessage({ hpw: 'ext', id, ...resultado }).
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  document.documentElement.dataset.hpwWhatsapp = VERSION;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.hpw !== 'app') return;
    const { id, type, payload } = ev.data;
    const responder = (r) => window.postMessage({ hpw: 'ext', id, ...r }, window.location.origin);

    if (type === 'PING') return responder({ ok: true, version: VERSION });

    let port;
    try {
      port = chrome.runtime.connect({ name: 'hpw' });
    } catch (e) {
      // La extensión se recargó: este puente quedó huérfano hasta recargar la página
      return responder({ ok: false, estado: 'ERROR', detalle: 'Recargá la página (la extensión se actualizó)' });
    }
    let listo = false;
    port.onMessage.addListener((r) => { listo = true; responder(r); port.disconnect(); });
    port.onDisconnect.addListener(() => {
      if (!listo) responder({ ok: false, estado: 'ERROR', detalle: 'Se cortó la comunicación con la extensión' });
    });
    port.postMessage({ type, payload });
  });
})();
