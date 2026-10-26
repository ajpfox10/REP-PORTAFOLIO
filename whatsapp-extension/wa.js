// wa.js — corre dentro de WhatsApp Web. Hace lo que haría una persona:
//   POR_NOMBRE: escribe en el buscador, se queda con el ÚNICO contacto cuyo nombre tiene todas
//               las palabras pedidas (apellido + nombre), abre el chat, pega el mensaje y envía.
//               Si no aparece, aparecen varios o algo falla → el background prueba por teléfono.
//   POR_LINK:   la pestaña ya se abrió en /send?phone=…; espera el chat (o el aviso de número
//               inválido), pega el mensaje y envía.
// Los selectores de WhatsApp cambian seguido: si algo deja de andar, se ajusta acá.
(() => {
  if (window.__hpwWa) return;
  window.__hpwWa = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  async function esperar(fn, ms = 20000, paso = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(paso);
    }
    return null;
  }

  const panelChats = () => document.querySelector('#pane-side');
  const pideQr = () => !panelChats() && !!document.querySelector('canvas[aria-label], [data-ref]');

  function buscador() {
    const sels = [
      'input[aria-label*="Buscar"]', 'input[aria-label*="Search"]',
      '[contenteditable="true"][aria-label*="Buscar"]', '[contenteditable="true"][aria-label*="Search"]',
      '#side input[type="text"]', '#side [contenteditable="true"]',
    ];
    for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
    return null;
  }

  const composer = () => document.querySelector('#main footer [contenteditable="true"]');
  const textoDe = (el) => (el ? (el.value ?? el.textContent ?? '') : '');

  function escribirBusqueda(el, texto) {
    el.focus();
    if (el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, texto);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      if (texto) document.execCommand('insertText', false, texto);
    }
  }

  function clic(el) {
    for (const t of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }

  // Resultados del buscador: nombre de cada fila = primer span[title] de la fila.
  function resultados() {
    const filas = panelChats()?.querySelectorAll('[role="listitem"], [role="row"]') || [];
    const out = [];
    for (const fila of filas) {
      const span = fila.querySelector('span[title]');
      const titulo = span?.getAttribute('title');
      if (titulo) out.push({ titulo, fila });
    }
    return out;
  }

  async function pegarYEnviar(texto, msCaja = 15000) {
    const caja = await esperar(composer, msCaja);
    if (!caja) return { ok: false, estado: 'ERROR', detalle: 'No apareció la caja de mensaje' };
    caja.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    // Pegar respeta los saltos de línea (WhatsApp usa un editor que procesa el evento paste)
    const dt = new DataTransfer();
    dt.setData('text/plain', texto);
    caja.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(500);
    if (!norm(textoDe(caja))) {
      document.execCommand('insertText', false, texto);
      await sleep(400);
    }
    if (!norm(textoDe(caja))) return { ok: false, estado: 'ERROR', detalle: 'No se pudo escribir el mensaje' };

    const btn = await esperar(() => {
      const ico = document.querySelector('#main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"], #main [data-icon="send"], #main [data-icon="wds-ic-send-filled"]');
      return ico?.closest('button') || ico
        || document.querySelector('#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"]');
    }, 5000);
    if (btn) clic(btn);
    else caja.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

    const enviado = await esperar(() => !norm(textoDe(composer())), 8000);
    return enviado ? { ok: true, estado: 'ENVIADO' } : { ok: false, estado: 'ERROR', detalle: 'El mensaje quedó escrito sin enviar' };
  }

  async function porNombre({ buscar, palabras, texto }) {
    const caja = await esperar(buscador, 5000);
    if (!caja) return { ok: false, estado: 'ERROR', detalle: 'No encontré el buscador de WhatsApp' };
    const pide = (palabras || []).map(norm).filter(Boolean);
    try {
      escribirBusqueda(caja, buscar);
      // Espera a que la lista se estabilice (WhatsApp filtra a medida que escribe)
      let antes = '';
      for (let i = 0; i < 8; i++) {
        await sleep(500);
        const ahora = resultados().map((r) => r.titulo).join('|');
        if (i >= 2 && ahora === antes) break;
        antes = ahora;
      }
      const coinciden = new Map();
      for (const r of resultados()) {
        const t = norm(r.titulo);
        if (pide.every((w) => t.split(' ').includes(w)) && !coinciden.has(r.titulo)) coinciden.set(r.titulo, r.fila);
      }
      if (coinciden.size === 0) return { ok: false, estado: 'NO_ENCONTRADO', detalle: `"${buscar}" no está agendado` };
      if (coinciden.size > 1) {
        return { ok: false, estado: 'NO_ENCONTRADO', detalle: `Varios contactos: ${[...coinciden.keys()].slice(0, 4).join(' / ')}` };
      }
      const [titulo, fila] = [...coinciden][0];
      clic(fila.querySelector('[tabindex]') || fila);
      const abierto = await esperar(() => {
        const h = document.querySelector('#main header');
        return h && norm(h.textContent).includes(norm(titulo));
      }, 6000);
      if (!abierto) return { ok: false, estado: 'ERROR', detalle: `No se abrió el chat de ${titulo}` };
      const r = await pegarYEnviar(texto, 6000);
      return { ...r, destino: titulo };
    } finally {
      const c = buscador();
      if (c && norm(textoDe(c))) escribirBusqueda(c, '');
    }
  }

  async function porLink({ texto }) {
    const res = await esperar(() => {
      const dlg = document.querySelector('[data-animate-modal-popup="true"], [role="dialog"]');
      const t = norm(dlg?.textContent);
      if (t && /NO ES VALIDO|INVALID|NO ESTA EN WHATSAPP|ISN T ON WHATSAPP|NOT ON WHATSAPP/.test(t)) {
        const ok = dlg.querySelector('button');
        if (ok) clic(ok);
        return { ok: false, estado: 'SIN_WHATSAPP', detalle: 'El número no tiene WhatsApp' };
      }
      if (pideQr()) return { ok: false, estado: 'ERROR', detalle: 'WhatsApp Web no está vinculado (pide QR)' };
      if (composer()) return 'chat';
      return null;
    }, 60000, 400);
    if (!res) return { ok: false, estado: 'ERROR', detalle: 'No se abrió el chat del número' };
    if (res !== 'chat') return res;
    return pegarYEnviar(texto);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'PING') return { ok: true };
        if (msg.type === 'ESTADO') {
          const ok = await esperar(() => panelChats() || (pideQr() && 'qr'), 45000);
          if (ok === 'qr') return { ok: false, detalle: 'WhatsApp Web no está vinculado (pide QR)' };
          return ok ? { ok: true } : { ok: false, detalle: 'WhatsApp Web no terminó de cargar' };
        }
        if (msg.type === 'POR_NOMBRE') return await porNombre(msg);
        if (msg.type === 'POR_LINK') return await porLink(msg);
        return { ok: false, estado: 'ERROR', detalle: 'Acción desconocida' };
      } catch (e) {
        return { ok: false, estado: 'ERROR', detalle: String(e?.message || e).slice(0, 200) };
      }
    })().then(sendResponse);
    return true; // respuesta asíncrona
  });
})();
