// rdam.js — corre en la página del RDAM (rdam.mjus.gba.gob.ar/solicitudCertificado, trámite público:
// no hace falta sesión). La página es Livewire: los campos se completan con eventos input/change como
// lo haría una persona y se toca "Imprimir certificado"; la página redirige al PDF (lo toma el background).
// Con sesión iniciada además aparece la tabla "Certificados solicitados" (LISTAR).
//
// mensajes: { type: 'PING' } → { ok, sinSesion, enFormulario }
//           { type: 'LISTAR', dni } → { ok, filas: [{ fecha, nombre, dni, codigo }] }   (tabla "Certificados solicitados", página abierta con ?search=<dni>)
//           { type: 'SOLICITAR', dni, sexo: '1'|'2', apellido, nombre } → { ok, estado, detalle }
//           { type: 'PDF', codigo } → { ok, pdf (base64) }
(() => {
  if (window.__hpwRdam) return;
  window.__hpwRdam = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const texto = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!el && el.offsetParent !== null;

  const sinSesion = () => /sso-gdeba/i.test(location.hostname) || /^\/login/i.test(location.pathname);
  const campo = (modelo) => document.querySelector(`[wire\\:model="${modelo}"], [wire\\:model\\.defer="${modelo}"], [wire\\:model\\.lazy="${modelo}"]`);

  function poner(el, valor, nombreCampo) {
    if (!el) throw new Error(`No está el campo ${nombreCampo} (¿cambió la página del RDAM?)`);
    el.focus();
    el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  // Cartel de SweetAlert2 (la página avisa así: Livewire.on('alert'|'success')). Lo lee y lo cierra.
  function cartel() {
    const pop = document.querySelector('.swal2-popup');
    if (!visible(pop)) return null;
    const t = texto(pop.querySelector('.swal2-html-container, .swal2-content')) || texto(pop);
    pop.querySelector('.swal2-confirm')?.click();
    return t || '(cartel sin texto)';
  }

  function filas() {
    return [...document.querySelectorAll('table tbody tr')].map((tr) => {
      const td = tr.querySelectorAll('td');
      const boton = tr.querySelector('[wire\\:click^="verPdf"]');
      const m = boton?.getAttribute('wire:click')?.match(/verPdf\('([^']+)'/);
      return { fecha: texto(td[0]), nombre: texto(td[1]), dni: texto(td[2]).replace(/\D/g, ''), codigo: m ? m[1] : null };
    }).filter((f) => f.codigo);
  }

  // La tabla ya viene filtrada desde el servidor: el background abre la página con ?search=<dni>
  // (usar el buscador con Livewire tarda y no avisa cuándo terminó). Igual se descartan filas de otro DNI.
  async function listar(dni) {
    return filas().filter((x) => x.dni === String(dni));
  }

  async function solicitar(p) {
    const tipo = campo('tipoId');
    if (tipo && tipo.value !== '1') { poner(tipo, '1', 'Tipo de documento'); await sleep(1500); }
    poner(campo('nroId'), String(p.dni), 'Número de documento');
    await sleep(1500);
    poner(campo('sexoId'), String(p.sexo), 'Sexo');
    await sleep(2500);

    const boton = document.querySelector('main [wire\\:click="buscar()"]');
    if (!boton) throw new Error('No está el botón "Imprimir certificado"');
    boton.click();

    // Si RENAPER no trae los datos, la página pide apellido y nombre a mano y hay que volver a tocar el botón.
    let completoNombre = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const ape = campo('apellido');
      const nom = campo('nombres');
      if (!completoNombre && visible(ape) && visible(nom) && !ape.value) {
        cartel();
        poner(ape, p.apellido, 'Apellido');
        poner(nom, p.nombre, 'Nombre');
        await sleep(1000);
        completoNombre = true;
        boton.click();
        continue;
      }
      const c = cartel();
      if (c && !/ingresar nombre y apellido/i.test(c)) {
        // Un cartel de éxito o de aviso: la app decide mirando si apareció la fila nueva en la tabla.
        return { ok: true, estado: 'ENVIADO', detalle: c, completoNombre };
      }
      // El formulario vuelve a quedar vacío cuando la solicitud se generó.
      if (i >= 4 && !campo('nroId')?.value) return { ok: true, estado: 'ENVIADO', detalle: null, completoNombre };
    }
    return { ok: true, estado: 'ENVIADO', detalle: 'El RDAM no confirmó en pantalla', completoNombre };
  }

  async function pdf(codigo) {
    const r = await fetch(`/certificado-ver-RDAM/${encodeURIComponent(codigo)}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`El RDAM no entregó el PDF (HTTP ${r.status})`);
    const blob = await r.blob();
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
    if (!atob(b64.slice(0, 8)).startsWith('%PDF')) throw new Error('Lo que devolvió el RDAM no es un PDF (¿se cerró la sesión?)');
    return b64;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
    if (msg?.type === 'PING') {
      responder({ ok: true, sinSesion: sinSesion(), enFormulario: !!campo('nroId') });
      return;
    }
    const tareas = {
      LISTAR: () => listar(msg.dni).then((f) => ({ ok: true, filas: f })),
      SOLICITAR: () => solicitar(msg),
      PDF: () => pdf(msg.codigo).then((b) => ({ ok: true, pdf: b })),
    };
    if (tareas[msg?.type]) {
      tareas[msg.type]()
        .then(responder)
        .catch((e) => responder({ ok: false, estado: 'ERROR', detalle: String(e?.message || e).slice(0, 200) }));
      return true;
    }
  });
})();
