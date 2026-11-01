// anses.js — corre en la página de Constancia de CUIL de ANSES (servicioswww.anses.gob.ar/C2-ConstaCUIL).
// Completa el formulario con los datos que manda la app, toca CONSULTAR como lo haría una persona,
// y si ANSES muestra la constancia baja el PDF (el mismo pedido que hace el botón "Descargar constancia").
//
// mensajes: { type: 'PING' } → { ok, bloqueado }
//           { type: 'CONSULTAR', dni, nombre, apellido, sexo: 'M'|'F', fechaNacimiento: 'aaaa-mm-dd' }
//           → { ok, estado: 'OK'|'NO_ENCONTRADO'|'BLOQUEADO'|'ERROR', cuil, nombreAnses, pdf (base64), detalle }
(() => {
  if (window.__hpwAnses) return;
  window.__hpwAnses = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const texto = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();

  // La protección anti-robots de ANSES (Incapsula) responde con una página propia en vez del formulario.
  function bloqueado() {
    const html = document.documentElement.outerHTML.slice(0, 5000);
    return !document.querySelector('#NumeroDoc') && !document.querySelector('#cuil')
      && (/Incapsula|_Incapsula_Resource|Request unsuccessful|Access denied/i.test(html) || !document.querySelector('main'));
  }

  function poner(sel, valor) {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`No está el campo ${sel} (¿cambió la página de ANSES?)`);
    el.focus();
    el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function consultar(p) {
    if (bloqueado()) return { ok: false, estado: 'BLOQUEADO', detalle: 'ANSES respondió con su página de protección (bloqueo o verificación)' };
    const tipo = document.querySelector('#TipoDocumento');
    if (tipo && tipo.value !== 'DU') { tipo.value = 'DU'; tipo.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300); }
    poner('#NumeroDoc', String(p.dni));
    poner('#Nombre', p.nombre);
    poner('#Apellido', p.apellido);
    poner('#FechaNacimiento', p.fechaNacimiento);
    const radio = document.querySelector(p.sexo === 'F' ? '#SexoF' : '#SexoM');
    if (!radio) throw new Error('No está el campo Sexo');
    radio.click();
    await sleep(300);

    const antes = texto(document.querySelector('main'));
    const boton = document.querySelector('#submit');
    if (!boton) throw new Error('No está el botón CONSULTAR');
    boton.click();

    // Espera la constancia (#cuil) o cualquier otra respuesta de ANSES.
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const cuilEl = document.querySelector('#cuil');
      if (cuilEl) {
        const cuil = texto(cuilEl).replace(/\D/g, '');
        const nombreAnses = texto(document.querySelector('main h1, main h2, main h3, main .h3, main .h4'));
        const pdf = await bajarPdf(texto(cuilEl));
        return { ok: true, estado: 'OK', cuil, nombreAnses, pdf };
      }
      if (document.querySelector('form.was-validated')) {
        return { ok: false, estado: 'NO_ENCONTRADO', detalle: 'ANSES rechazó los datos del formulario (revisar nombre/fecha en la base)' };
      }
      if (bloqueado()) return { ok: false, estado: 'BLOQUEADO', detalle: 'ANSES pidió verificación o bloqueó la consulta' };
      const ahora = texto(document.querySelector('main'));
      if (i > 2 && ahora && ahora !== antes && !document.querySelector('#NumeroDoc') && !document.querySelector('#icono-loading:not([style*="none"])')) {
        return { ok: false, estado: 'NO_ENCONTRADO', detalle: ahora.slice(0, 250) };
      }
    }
    return { ok: false, estado: 'ERROR', detalle: 'ANSES no respondió a tiempo' };
  }

  async function bajarPdf(cuilTexto) {
    const r = await fetch(`${window.location.pathname.replace(/\/$/, '')}/Descargar-Constancia-ANSES`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ cuil: cuilTexto }),
      credentials: 'include',
    });
    if (!r.ok) throw new Error(`ANSES no entregó el PDF (HTTP ${r.status})`);
    const blob = await r.blob();
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
    if (!atob(b64.slice(0, 8)).startsWith('%PDF')) throw new Error('Lo que devolvió ANSES no es un PDF');
    return b64;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
    if (msg?.type === 'PING') { responder({ ok: true, bloqueado: bloqueado() }); return; }
    if (msg?.type === 'CONSULTAR') {
      consultar(msg)
        .then(responder)
        .catch((e) => responder({ ok: false, estado: 'ERROR', detalle: String(e?.message || e).slice(0, 200) }));
      return true;
    }
  });
})();
