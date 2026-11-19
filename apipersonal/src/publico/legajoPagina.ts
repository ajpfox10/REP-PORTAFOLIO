// src/publico/legajoPagina.ts
// Página del Legajo por enlace (/l/:token), la sirve turnosPublicoServer.ts. Usa /t.css (el de la Agenda) + /l.css.
// Sin frameworks ni recursos externos (la CSP solo permite 'self'). El formulario se arma con la definición
// que manda la API (PASOS de services/legajoAutocarga.ts): las preguntas se cambian allá, no acá.
// OJO: el JS va dentro de String.raw → no usar backticks ni "${" adentro. Los valores del agente se
// ponen siempre con textContent / .value (nunca innerHTML).

export const LEGAJO_HTML = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Legajo Personal</title>
<link rel="stylesheet" href="/t.css">
<link rel="stylesheet" href="/l.css">
</head>
<body>
<main id="app">
  <header class="cab">
    <div class="marca">Hospital · Oficina de Personal</div>
    <h1 id="titulo">Legajo Personal</h1>
    <p id="subtitulo" class="sub"></p>
  </header>
  <div id="aviso"></div>
  <section id="contenido"><p class="cargando">Cargando…</p></section>
</main>
<script src="/l.js"></script>
</body>
</html>`;

export const LEGAJO_CSS = String.raw`
.pasos{display:flex;gap:4px;margin:0 0 14px}
.pasos span{flex:1;height:5px;border-radius:3px;background:var(--borde)}
.pasos span.hecho{background:var(--pri)}
.paso-n{font-size:.8rem;color:var(--sub);margin:0 0 4px}
.campo{margin-bottom:14px}
.campo>.lbl{display:block;font-weight:600;font-size:.95rem;margin:0 0 4px;color:var(--txt)}
.campo>.lbl .req{color:var(--err);margin-left:2px}
.ayuda{font-size:.82rem;color:var(--sub);margin:0 0 6px}
.ops{display:flex;flex-wrap:wrap;gap:8px}
.op{border:1px solid var(--borde);background:var(--card);color:var(--txt);border-radius:10px;padding:10px 14px;font:inherit;cursor:pointer}
.op[aria-pressed=true]{border-color:var(--pri);background:var(--sel);font-weight:600}
textarea{width:100%;font:inherit;padding:12px;border-radius:10px;border:1px solid var(--borde);background:var(--card);color:var(--txt);min-height:110px;resize:vertical}
.chk{display:flex;gap:10px;align-items:flex-start;font-weight:600;cursor:pointer}
.chk input{width:22px;height:22px;margin:2px 0 0;flex:0 0 auto}
.fila-btn{display:flex;gap:10px}
.fila-btn .btn{margin-top:4px}
.fam{border:1px dashed var(--borde);border-radius:12px;padding:12px;margin-bottom:12px}
.fam h3{font-size:1rem;margin:0 0 10px;display:flex;justify-content:space-between;align-items:center}
.fam h3 button{border:0;background:transparent;color:var(--err);font:inherit;cursor:pointer;font-size:.85rem}
.err-campo input,.err-campo select,.err-campo textarea,.err-campo .ops{outline:2px solid var(--err);outline-offset:2px;border-radius:10px}
.guardado{font-size:.78rem;color:var(--sub);text-align:center;margin-top:10px;min-height:1em}
ul.faltan{margin:6px 0 0;padding-left:20px}
`;

export const LEGAJO_JS = String.raw`(function(){
'use strict';
var token = location.pathname.split('/').pop();
var API = '/api/l/' + encodeURIComponent(token);
var $c = document.getElementById('contenido');
var $aviso = document.getElementById('aviso');
var D = null, R = {}, paso = 0, sucio = false, guardando = false, nFam = 0;

function el(tag, attrs, kids){
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'cls') e.className = attrs[k];
    else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach(function(x){ if (x) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
  return e;
}
function msg(tipo, texto, lista){
  $aviso.textContent = '';
  if (!texto) return;
  var m = el('div', { cls: 'msg ' + tipo, role: tipo === 'err' ? 'alert' : 'status', text: texto });
  if (lista && lista.length) { var ul = el('ul', { cls: 'faltan' }); lista.forEach(function(t){ ul.appendChild(el('li', { text: t })); }); m.appendChild(ul); }
  $aviso.appendChild(m);
  window.scrollTo(0, 0);
}
function api(metodo, ruta, cuerpo){
  return fetch(API + ruta, { method: metodo, headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined })
    .then(function(r){ return r.json().catch(function(){ return { ok: false, error: 'Error de conexión' }; }); });
}
function visible(c, pref){ if (!c.si) return true; return c.si[1].indexOf(R[(pref || '') + c.si[0]] || '') >= 0; }

// ── Campos ───────────────────────────────────────────────
function campo(c, pref){
  var clave = (pref || '') + c.t;
  if (!visible(c, pref)) return null;
  var lbl = el('span', { cls: 'lbl', text: c.t });
  if (c.req) lbl.appendChild(el('span', { cls: 'req', text: '*', 'aria-hidden': 'true' }));
  var box = el('div', { cls: 'campo', 'data-clave': clave });
  var val = R[clave] || '';
  var id = 'f' + Math.random().toString(36).slice(2, 9);
  var ctrl;
  var poner = function(v, redibujar){ if (v) R[clave] = v; else delete R[clave]; sucio = true; box.classList.remove('err-campo'); if (redibujar) dibujar(); };
  if (c.tipo === 'opcion') {
    ctrl = el('div', { cls: 'ops', role: 'group' });
    c.op.forEach(function(o){
      ctrl.appendChild(el('button', { type: 'button', cls: 'op', 'aria-pressed': String(val === o), text: o,
        onclick: function(){ poner(o, true); } }));
    });
    box.appendChild(lbl);
  } else if (c.tipo === 'check') {
    var inp = el('input', { type: 'checkbox', id: id });
    inp.checked = val === c.op[0];
    inp.addEventListener('change', function(){ poner(inp.checked ? c.op[0] : ''); });
    ctrl = el('label', { cls: 'chk', 'for': id }, [inp, c.op[0]]);
  } else {
    box.appendChild(el('label', { 'for': id, cls: 'lbl', text: c.t }, c.req ? [el('span', { cls: 'req', text: '*', 'aria-hidden': 'true' })] : []));
    if (c.tipo === 'lista') {
      ctrl = el('select', { id: id });
      ctrl.appendChild(el('option', { value: '', text: 'Elegí…' }));
      c.op.forEach(function(o){ ctrl.appendChild(el('option', { value: o, text: o })); });
    } else if (c.tipo === 'parrafo') {
      ctrl = el('textarea', { id: id, maxlength: '2000' });
    } else {
      ctrl = el('input', { id: id, type: c.tipo === 'fecha' ? 'date' : c.tipo === 'tel' ? 'tel' : 'text', maxlength: '200',
        autocomplete: 'off' });
      if (c.tipo === 'monto' || c.tipo === 'tel') ctrl.setAttribute('inputmode', 'numeric');
      if (c.tipo === 'fecha') { ctrl.setAttribute('max', '2100-12-31'); ctrl.setAttribute('min', '1900-01-01'); }
    }
    ctrl.value = val;
    ctrl.addEventListener('input', function(){ poner(ctrl.value.trim()); });
    ctrl.addEventListener('change', function(){ poner(ctrl.value.trim()); });
  }
  if (c.ayuda) box.appendChild(el('p', { cls: 'ayuda', text: c.ayuda }));
  box.appendChild(ctrl);
  return box;
}

// Familiares: se guardan como "Familiar N — <pregunta>" (igual que el Formulario de Google)
function famUsado(n){ var p = 'Familiar ' + n + ' — '; return D.familiar.some(function(c){ return !!R[p + c.t]; }); }
function compactarFamilia(){
  var lista = [];
  for (var n = 1; n <= D.max_familiares; n++) {
    if (n > nFam && !famUsado(n)) continue;
    var f = {}; D.familiar.forEach(function(c){ var k = 'Familiar ' + n + ' — ' + c.t; if (R[k]) f[c.t] = R[k]; delete R[k]; });
    lista.push(f);
  }
  lista.forEach(function(f, i){ for (var t in f) R['Familiar ' + (i + 1) + ' — ' + t] = f[t]; });
  nFam = lista.length;
}
function familia(cont){
  if (R['¿Tenés familiares para declarar?'] !== 'Sí') return;
  if (nFam === 0) nFam = 1;
  for (var n = 1; n <= nFam; n++) (function(n){
    var pref = 'Familiar ' + n + ' — ';
    var caja = el('div', { cls: 'fam' }, [el('h3', null, ['Familiar ' + n,
      nFam > 1 ? el('button', { type: 'button', text: 'Quitar', onclick: function(){
        D.familiar.forEach(function(c){ delete R[pref + c.t]; }); nFam = Math.max(0, nFam - 1); compactarFamilia(); if (!nFam) nFam = 1; sucio = true; dibujar();
      } }) : null])]);
    D.familiar.forEach(function(c){ var x = campo(c, pref); if (x) caja.appendChild(x); });
    cont.appendChild(caja);
  })(n);
  if (nFam < D.max_familiares) cont.appendChild(el('button', { type: 'button', cls: 'btn ghost', text: '+ Agregar otro familiar',
    onclick: function(){ nFam++; dibujar(); } }));
}

// ── Pasos ────────────────────────────────────────────────
function faltanPaso(i){
  var p = D.pasos[i], out = [];
  p.campos.forEach(function(c){ if (c.req && visible(c) && !R[c.t]) out.push(c.t); });
  if (p.familia && R['¿Tenés familiares para declarar?'] === 'Sí') {
    for (var n = 1; n <= nFam; n++) {
      var pref = 'Familiar ' + n + ' — ';
      D.familiar.forEach(function(c){ if (c.req && visible(c, pref) && !R[pref + c.t]) out.push(pref + c.t); });
    }
  }
  return out;
}
// misma regla que estudiosIncoherentes() del servidor
function estudiosMal(){
  var out = [], tiene = function(k){ return !!R[k] && R[k] !== 'No tengo'; };
  if (R['Primario'] && R['Primario'] !== 'Completo' && tiene('Secundario')) out.push(['Secundario', 'Si no terminaste el primario, en Secundario marcá "No tengo".']);
  if (R['Secundario'] && R['Secundario'] !== 'Completo') {
    if (tiene('Terciario')) out.push(['Terciario', 'Si no terminaste el secundario, en Terciario marcá "No tengo".']);
    if (tiene('Universitario')) out.push(['Universitario', 'Si no terminaste el secundario, en Universitario marcá "No tengo".']);
  }
  return D.pasos[paso].id === 'estudios' ? out : [];
}
function marcarFaltan(claves){
  Array.prototype.forEach.call(document.querySelectorAll('.campo'), function(b){
    b.classList.toggle('err-campo', claves.indexOf(b.getAttribute('data-clave')) >= 0);
  });
}
function dibujar(){
  var p = D.pasos[paso];
  $c.textContent = '';
  var barra = el('div', { cls: 'pasos', 'aria-hidden': 'true' });
  D.pasos.forEach(function(_, i){ barra.appendChild(el('span', { cls: i <= paso ? 'hecho' : '' })); });
  $c.appendChild(barra);
  var card = el('div', { cls: 'card' }, [
    el('p', { cls: 'paso-n', text: 'Paso ' + (paso + 1) + ' de ' + D.pasos.length }),
    el('h2', { text: p.titulo }),
    p.ayuda ? el('p', { cls: 'ayuda', text: p.ayuda }) : null,
  ]);
  p.campos.forEach(function(c){ var x = campo(c); if (x) card.appendChild(x); });
  if (p.familia) familia(card);
  $c.appendChild(card);
  var ult = paso === D.pasos.length - 1;
  $c.appendChild(el('div', { cls: 'fila-btn' }, [
    paso > 0 ? el('button', { type: 'button', cls: 'btn ghost', text: '← Anterior', onclick: function(){ ir(paso - 1, false); } }) : null,
    el('button', { type: 'button', cls: 'btn', id: 'sig', text: ult ? 'Enviar a Personal' : 'Siguiente →', onclick: function(){ ult ? enviar() : ir(paso + 1, true); } }),
  ]));
  $c.appendChild(el('p', { cls: 'guardado', id: 'guardado', text: '' }));
}
function ir(i, validar){
  if (validar) {
    var f = faltanPaso(paso);
    if (f.length) { marcarFaltan(f.map(function(t){ return t; })); msg('err', 'Completá lo que está marcado en rojo.'); return; }
    var e = estudiosMal();
    if (e.length) { marcarFaltan(e.map(function(x){ return x[0]; })); msg('err', 'Revisá lo marcado en rojo.', e.map(function(x){ return x[1]; })); return; }
  }
  msg('', '');
  paso = Math.max(0, Math.min(D.pasos.length - 1, i));
  guardar();
  dibujar();
  window.scrollTo(0, 0);
}

// ── Guardar / enviar ─────────────────────────────────────
function guardar(){
  if (!sucio || guardando) return;
  guardando = true; sucio = false;
  api('PUT', '/borrador', { respuestas: R }).then(function(r){
    guardando = false;
    var g = document.getElementById('guardado');
    if (!r.ok) { sucio = true; if (g) g.textContent = 'No se pudo guardar: ' + (r.error || ''); return; }
    if (g) { var d = new Date(); g.textContent = 'Guardado ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  }).catch(function(){ guardando = false; sucio = true; });
}
setInterval(guardar, 20000);
window.addEventListener('pagehide', function(){
  if (sucio && navigator.sendBeacon) navigator.sendBeacon(API + '/borrador', new Blob([JSON.stringify({ respuestas: R })], { type: 'application/json' }));
});
function enviar(){
  var f = faltanPaso(paso);
  if (f.length) { marcarFaltan(f); msg('err', 'Completá lo que está marcado en rojo.'); return; }
  var b = document.getElementById('sig'); b.disabled = true; b.textContent = 'Enviando…';
  api('POST', '/enviar', { respuestas: R }).then(function(r){
    if (!r.ok) { b.disabled = false; b.textContent = 'Enviar a Personal'; msg('err', r.error || 'No se pudo enviar', r.faltan); return; }
    sucio = false;
    final('ok', '¡Listo! Tus datos fueron enviados a la Oficina de Personal.', 'Los van a revisar y cargar en tu legajo. Si falta algo te avisan por WhatsApp. Ya podés cerrar esta página.');
  }).catch(function(){ b.disabled = false; b.textContent = 'Enviar a Personal'; msg('err', 'Sin conexión. Probá de nuevo.'); });
}
function final(tipo, titulo, texto){
  msg('', '');
  $c.textContent = '';
  $c.appendChild(el('div', { cls: 'msg ' + tipo }, [el('p', { cls: 'grande', text: titulo }), texto ? el('p', { text: texto }) : null]));
}

// ── Arranque ─────────────────────────────────────────────
api('GET', '').then(function(r){
  if (!r.ok) { final('err', 'Enlace inválido', 'Pedile a la Oficina de Personal que te mande uno nuevo.'); return; }
  D = r.data;
  document.getElementById('subtitulo').textContent = D.nombre ? 'Hola, ' + D.nombre : '';
  if (D.estado === 'ENVIADO') return final('ok', 'Ya enviaste tus datos', 'La Oficina de Personal los está revisando. Si falta algo te avisan.');
  if (D.estado === 'APROBADO') return final('ok', 'Tus datos ya están cargados en el legajo', '¡Gracias!');
  if (D.estado === 'VENCIDO') return final('err', 'El enlace venció', 'Pedile a la Oficina de Personal que te lo habilite de nuevo.');
  if (!D.editable) return final('err', 'Este enlace ya no está activo', 'Pedile a la Oficina de Personal que te mande uno nuevo.');
  R = D.respuestas || {};
  for (var n = D.max_familiares; n >= 1; n--) if (famUsado(n)) { nFam = n; break; }
  dibujar();
  if (D.devolucion_motivo) msg('err', 'La Oficina de Personal te pide corregir: ' + D.devolucion_motivo);
  else if (Object.keys(R).length) msg('ok', 'Seguís desde donde lo dejaste. Vence el ' + D.vence_el.split('-').reverse().join('/') + '.');
}).catch(function(){ final('err', 'Sin conexión', 'Probá de nuevo en un rato.'); });
})();`;
