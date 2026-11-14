// src/publico/turnoPagina.ts
// Página que abre el agente desde el enlace del WhatsApp (la sirve turnosPublicoServer.ts).
// Sin frameworks ni recursos externos: HTML + CSS + JS propios (la CSP solo permite 'self').
// OJO: el JS va dentro de String.raw → no usar backticks ni "${" adentro.

export const PAGINA_HTML = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Pedir turno</title>
<link rel="stylesheet" href="/t.css">
</head>
<body>
<main id="app">
  <header class="cab">
    <div class="marca">Hospital · Oficina de Personal</div>
    <h1 id="titulo">Pedir turno</h1>
    <p id="subtitulo" class="sub"></p>
  </header>
  <section id="contenido"><p class="cargando">Cargando…</p></section>
</main>
<script src="/t.js"></script>
</body>
</html>`;

export const PAGINA_CSS = String.raw`
:root{--bg:#f4f6f9;--card:#fff;--txt:#1b2430;--sub:#5b6778;--borde:#dde3ea;--pri:#0f6cbd;--pri-txt:#fff;--ok:#127a3e;--ok-bg:#e7f6ec;--err:#b42318;--err-bg:#fdecea;--sel:#e3efff}
@media (prefers-color-scheme:dark){:root{--bg:#0f141a;--card:#18202a;--txt:#e7edf3;--sub:#9aa7b6;--borde:#2a3542;--pri:#4ea1f5;--pri-txt:#06121f;--ok:#5fd08d;--ok-bg:#12301f;--err:#ff8a80;--err-bg:#3a1714;--sel:#1d3550}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:16px 16px 48px}
.cab{margin:8px 0 16px}
.marca{font-size:.8rem;color:var(--sub);text-transform:uppercase;letter-spacing:.06em}
h1{font-size:1.45rem;margin:4px 0}
h2{font-size:1.05rem;margin:0 0 10px}
.sub{color:var(--sub);margin:0}
.card{background:var(--card);border:1px solid var(--borde);border-radius:14px;padding:16px;margin-bottom:14px}
.dias{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory}
.dia{flex:0 0 auto;min-width:86px;scroll-snap-align:start;border:1px solid var(--borde);background:var(--card);color:var(--txt);border-radius:12px;padding:10px 8px;text-align:center;cursor:pointer;font:inherit}
.dia .d1{display:block;font-size:.78rem;color:var(--sub);text-transform:capitalize}
.dia .d2{display:block;font-size:1.15rem;font-weight:600}
.dia .d3{display:block;font-size:.72rem;color:var(--sub)}
.dia[aria-pressed=true]{border-color:var(--pri);background:var(--sel)}
.horas{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
.hora{border:1px solid var(--borde);background:var(--card);color:var(--txt);border-radius:10px;padding:12px 0;font:inherit;font-weight:600;cursor:pointer}
.hora[aria-pressed=true]{border-color:var(--pri);background:var(--pri);color:var(--pri-txt)}
label{display:block;font-size:.9rem;color:var(--sub);margin:4px 0 6px}
input{width:100%;font:inherit;padding:12px;border-radius:10px;border:1px solid var(--borde);background:var(--card);color:var(--txt)}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:15px;font:inherit;font-weight:700;background:var(--pri);color:var(--pri-txt);cursor:pointer;margin-top:12px}
.btn[disabled]{opacity:.45;cursor:default}
.btn.sec{background:transparent;color:var(--err);border:1px solid var(--err)}
.btn.ghost{background:transparent;color:var(--pri);border:1px solid var(--borde)}
a.btn{text-align:center;text-decoration:none;font-weight:600}
.msg{border-radius:12px;padding:12px 14px;margin-bottom:14px}
.msg.ok{background:var(--ok-bg);color:var(--ok)}
.msg.err{background:var(--err-bg);color:var(--err)}
.grande{font-size:1.3rem;font-weight:700;margin:2px 0}
.cap{text-transform:capitalize}
.dato{color:var(--sub);margin:2px 0}
.cargando{color:var(--sub);text-align:center;padding:24px 0}
.nota{font-size:.85rem;color:var(--sub);margin-top:10px}
`;

export const PAGINA_JS = String.raw`
(function(){
  var token = (location.pathname.split('/')[2] || '').trim();
  var base = '/api/t/' + encodeURIComponent(token);
  var $c = document.getElementById('contenido');
  var $t = document.getElementById('titulo');
  var $s = document.getElementById('subtitulo');
  var estado = null, dias = [], diaSel = null, horaSel = null, aviso = null;

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; }); }
  function api(path, body){
    var op = body ? { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) } : {};
    return fetch(base + path, op).then(function(r){
      return r.json().catch(function(){ return { ok:false, error:'Error de conexión' }; }).then(function(j){
        if (!j.ok) { var e = new Error(j.error || 'Error'); e.code = j.code; e.status = r.status; throw e; }
        return j.data;
      });
    });
  }
  function fmtCorta(f){ var p = f.split('-'); return p[2] + '/' + p[1]; }
  function diaNombre(d){ return d.dia.split(' ')[0]; }
  function msg(){ return aviso ? '<div class="msg ' + aviso.tipo + '">' + esc(aviso.texto) + '</div>' : ''; }
  function tc(s){ return String(s || '').toLowerCase().replace(/(^|[\s'-])\S/g, function(m){ return m.toUpperCase(); }); }
  function nombre(){ return estado ? tc(estado.agente.nombre + ' ' + estado.agente.apellido) : ''; }
  function linkGoogle(e){
    var gd = function(f, h){ return f.replace(/-/g, '') + 'T' + h.replace(':', '') + '00'; };
    var det = [e.agenda.descripcion, 'Turno pedido desde el enlace de la Oficina de Personal.'].filter(Boolean).join('\n');
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + '&text=' + encodeURIComponent('Turno: ' + e.agenda.nombre)
      + '&dates=' + gd(e.turno.fecha, e.turno.hora) + '/' + gd(e.turno.fecha, e.turno.hora_fin)
      + '&ctz=' + encodeURIComponent('America/Argentina/Buenos_Aires')
      + (e.agenda.lugar ? '&location=' + encodeURIComponent(e.agenda.lugar) : '')
      + '&details=' + encodeURIComponent(det);
  }
  function lugar(){ return estado && estado.agenda.lugar ? '<p class="dato">Lugar: ' + esc(estado.agenda.lugar) + '</p>' : ''; }

  function cargar(){
    return api('').then(function(e){
      estado = e;
      $t.textContent = e.agenda.nombre;
      $s.textContent = 'Turno para ' + nombre();
      if (e.estado === 'HABILITADO') return api('/disponibles').then(function(d){ dias = d; diaSel = null; horaSel = null; pintar(); });
      pintar();
    }).catch(function(err){
      $t.textContent = 'Enlace no válido';
      $c.innerHTML = '<div class="card"><p>' + esc(err.status === 404 ? 'Este enlace no existe. Revisá que esté completo o pedí uno nuevo a la Oficina de Personal.' : err.message) + '</p></div>';
    });
  }

  function pintar(){
    var e = estado, h = '';
    if (e.turno && e.turno.estado === 'RESERVADO') {
      h += msg() + '<div class="card"><h2>Tu turno</h2>'
        + '<p class="grande cap">' + esc(e.turno.dia) + '</p><p class="grande">' + esc(e.turno.hora) + ' h</p>'
        + lugar() + (e.agenda.descripcion ? '<p class="dato">' + esc(e.agenda.descripcion) + '</p>' : '')
        + '<a class="btn ghost" id="gcal" href="' + esc(linkGoogle(e)) + '" target="_blank" rel="noopener">📅 Agregar a Google Calendar</a>'
        + '<a class="btn ghost" href="' + base + '/turno.ics">📲 Agregar al calendario del celular (iPhone / otros)</a>'
        + '<p class="nota">Guardá este enlace: con él podés volver a ver tu turno.</p>';
      if (e.turno.puede_cancelar) h += '<button class="btn sec" id="cancelar">Cancelar el turno</button>';
      else h += '<p class="nota">Para cancelar o cambiar el turno comunicate con la Oficina de Personal.</p>';
      h += '</div>';
    } else if (e.turno && e.turno.estado === 'CANCELADO') {
      h += msg() + '<div class="card"><h2>Turno cancelado</h2><p>El turno del ' + esc(e.turno.dia) + ' a las ' + esc(e.turno.hora) + ' h está cancelado.</p>'
        + '<p class="nota">Si necesitás otro turno, pedí un nuevo enlace a la Oficina de Personal.</p></div>';
    } else if (e.turno) {
      h += '<div class="card"><h2>Turno ' + (e.turno.estado === 'ATENDIDO' ? 'atendido' : 'registrado') + '</h2><p>' + esc(e.turno.dia) + ' · ' + esc(e.turno.hora) + ' h</p>'
        + '<p class="nota">Este enlace ya no sirve para pedir otro turno.</p></div>';
    } else if (e.estado === 'HABILITADO') {
      h += msg();
      if (!dias.length) {
        h += '<div class="card"><p>Por ahora no hay horarios libres. Probá de nuevo en unos días o comunicate con la Oficina de Personal.</p></div>';
      } else {
        h += '<div class="card"><h2>1. Elegí el día</h2><div class="dias">';
        dias.forEach(function(d, i){
          h += '<button class="dia" data-dia="' + i + '" aria-pressed="' + (diaSel === i) + '"><span class="d1">' + esc(diaNombre(d)) + '</span><span class="d2">' + fmtCorta(d.fecha) + '</span><span class="d3">' + d.horarios.length + ' libres</span></button>';
        });
        h += '</div></div>';
        if (diaSel !== null) {
          h += '<div class="card"><h2>2. Elegí el horario</h2><div class="horas">';
          dias[diaSel].horarios.forEach(function(x){ h += '<button class="hora" data-hora="' + esc(x) + '" aria-pressed="' + (horaSel === x) + '">' + esc(x) + '</button>'; });
          h += '</div></div>';
        }
        if (horaSel) {
          h += '<div class="card"><h2>3. Confirmá</h2><p class="grande cap">' + esc(dias[diaSel].dia) + '</p><p class="grande">' + esc(horaSel) + ' h</p>' + lugar()
            + '<label for="tel">Celular de contacto (opcional)</label><input id="tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" placeholder="11 2345 6789">'
            + '<button class="btn" id="confirmar">Confirmar turno</button>'
            + '<p class="nota">El enlace sirve para un solo turno. Vence el ' + esc(e.vence_el.split('-').reverse().join('/')) + '.</p></div>';
        }
      }
    } else {
      var t = { VENCIDO:'Este enlace venció sin que se pidiera el turno.', ANULADO:'Este enlace fue anulado.', USADO:'Con este enlace ya se pidió un turno.' }[e.estado] || 'Este enlace no está habilitado.';
      h += '<div class="card"><p>' + esc(t) + '</p><p class="nota">Si necesitás un turno, pedí un nuevo enlace a la Oficina de Personal.</p></div>';
    }
    $c.innerHTML = h;
    enlazar();
  }

  function enlazar(){
    Array.prototype.forEach.call($c.querySelectorAll('.dia'), function(b){
      b.onclick = function(){ diaSel = Number(b.getAttribute('data-dia')); horaSel = null; aviso = null; pintar(); };
    });
    Array.prototype.forEach.call($c.querySelectorAll('.hora'), function(b){
      b.onclick = function(){ horaSel = b.getAttribute('data-hora'); aviso = null; pintar(); var c = document.getElementById('confirmar'); if (c) c.scrollIntoView({ behavior:'smooth', block:'center' }); };
    });
    var conf = document.getElementById('confirmar');
    if (conf) conf.onclick = function(){
      conf.disabled = true; conf.textContent = 'Reservando…';
      var tel = (document.getElementById('tel') || {}).value || '';
      api('/reservar', { fecha: dias[diaSel].fecha, hora: horaSel, telefono: tel }).then(function(e){
        estado = e; aviso = { tipo:'ok', texto:'¡Listo! Tu turno quedó reservado.' }; pintar(); window.scrollTo(0, 0);
      }).catch(function(err){
        aviso = { tipo:'err', texto: err.message };
        if (err.code === 'OCUPADO' || err.code === 'NO_DISPONIBLE') { cargar().then(function(){ window.scrollTo(0, 0); }); }
        else cargar();
      });
    };
    var can = document.getElementById('cancelar');
    if (can) can.onclick = function(){
      if (!window.confirm('¿Seguro que querés cancelar el turno? Para pedir otro vas a necesitar un enlace nuevo.')) return;
      can.disabled = true;
      api('/cancelar', {}).then(function(e){ estado = e; aviso = { tipo:'ok', texto:'El turno quedó cancelado.' }; pintar(); })
        .catch(function(err){ aviso = { tipo:'err', texto: err.message }; pintar(); });
    };
  }

  cargar();
})();
`;
