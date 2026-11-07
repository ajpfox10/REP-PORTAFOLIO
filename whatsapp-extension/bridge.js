// bridge.js — corre en la página de la app de Personal.
// La página no puede hablar con la extensión directo: le manda window.postMessage({ hpw: 'app', id, type, payload })
// y este puente lo reenvía al background por un puerto (que mantiene vivo al service worker mientras envía).
// Respuesta a la página: window.postMessage({ hpw: 'ext', id, ...resultado }).
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  // Si en el mismo Chrome quedaron cargadas dos copias de la extensión, contesta solo la más nueva
  // (las dos ven la página; la vieja no conoce las acciones nuevas). El PING lo contestan todas
  // (con `todas: true` la app cuenta cuántas hay para avisar que se quite la vieja).
  const cmp = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); }
    return 0;
  };
  const prev = document.documentElement.dataset.hpwWhatsapp;
  if (!prev || cmp(VERSION, prev) > 0) document.documentElement.dataset.hpwWhatsapp = VERSION;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.hpw !== 'app') return;
    const { id, type, payload } = ev.data;
    const responder = (r) => window.postMessage({ hpw: 'ext', id, ...r }, window.location.origin);

    if (type === 'PING') return responder({ ok: true, version: VERSION });
    if (document.documentElement.dataset.hpwWhatsapp !== VERSION) return; // hay una copia más nueva

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
