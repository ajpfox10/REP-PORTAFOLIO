// Prueba: recorre TODAS las fuentes, una por una, en el navegador embebido.
// Para cada fuente: carga la pagina, prellena (con reintentos), el operador
// resuelve el captcha ahi adentro, y "Leer y siguiente" lee el resultado y
// avanza a la proxima fuente.

const webview = document.getElementById('org')
const msgEl = document.getElementById('msg')
const progresoEl = document.getElementById('progreso')
const resultadosEl = document.getElementById('resultados')
const btnIniciar = document.getElementById('iniciar')
const btnSiguiente = document.getElementById('siguiente')
const btnRecargar = document.getElementById('recargar')

// --- Lote por Excel (solo usuario habilitado) ---
const XLSX = require('xlsx')
const loteBar = document.getElementById('loteBar')
const archivoLote = document.getElementById('archivoLote')
const colDniSel = document.getElementById('colDni')
const loteInfo = document.getElementById('loteInfo')
const btnIniciarLote = document.getElementById('iniciarLote')
const btnDescargarLote = document.getElementById('descargarLote')
const USUARIO_LOTE = 'samo' // usuario que ve el modulo de lote
let filasExcel = []          // filas de datos (array de arrays), sin encabezado
let encabezadoExcel = []     // encabezados detectados
let cola = []                // [{ dni, cuil }] a procesar
let filaActual = -1          // indice dentro de la cola
let loteActivo = false
const resultadosLote = []    // { dni, cuil, porFuente: {codigo: veredicto} }

// --- Conexion al backend C#/MySQL (via Node http, sin problemas de CORS) ---
const http = require('http')
const https = require('https')
let token = null
let usuario = ''
let backendUrl = 'http://localhost:8510'

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(backendUrl + path) } catch (e) { return reject(new Error('URL de servidor invalida')) }
    const lib = u.protocol === 'https:' ? https : http
    const data = JSON.stringify(body)
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
    if (token) headers.authorization = 'Bearer ' + token
    const req = lib.request(u, { method: 'POST', headers }, (res) => {
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => {
        let j = {}
        try { j = buf ? JSON.parse(buf) : {} } catch (e) { /* no json */ }
        if (res.statusCode < 400) resolve(j)
        else reject(new Error(j.error || ('HTTP ' + res.statusCode)))
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function apiGet(path) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(backendUrl + path) } catch (e) { return reject(new Error('URL de servidor invalida')) }
    const lib = u.protocol === 'https:' ? https : http
    const headers = {}
    if (token) headers.authorization = 'Bearer ' + token
    const req = lib.request(u, { method: 'GET', headers }, (res) => {
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => {
        let j = {}
        try { j = buf ? JSON.parse(buf) : {} } catch (e) { /* no json */ }
        if (res.statusCode < 400) resolve(j)
        else reject(new Error(j.error || ('HTTP ' + res.statusCode)))
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// Credencial institucional de SSS-HPGD (se trae del backend tras el login).
let sssCred = null

// Servidor fijo (no editable ni visible): siempre apunta al backend de produccion.
const SERVIDOR_POR_DEFECTO = 'http://192.168.0.21:8510'
backendUrl = SERVIDOR_POR_DEFECTO
document.getElementById('usr').value = localStorage.getItem('cob_usuario') || ''

document.getElementById('btnLogin').addEventListener('click', async () => {
  const msg = document.getElementById('loginMsg')
  msg.textContent = 'Ingresando...'
  backendUrl = SERVIDOR_POR_DEFECTO
  const username = document.getElementById('usr').value.trim()
  const password = document.getElementById('pwd').value
  try {
    const r = await apiPost('/api/auth/login', { username, password })
    token = r.token
    usuario = r.user ? r.user.username : username
    localStorage.setItem('cob_usuario', username)
    document.getElementById('userLabel').textContent = 'Usuario: ' + usuario
    document.getElementById('login').style.display = 'none'
    // Modulo de lote por Excel: solo para el usuario habilitado.
    if ((usuario || '').trim().toLowerCase() === USUARIO_LOTE) loteBar.classList.add('visible')
    else loteBar.classList.remove('visible')
    // Traer la credencial de SSS-HPGD para el login automatico (si el backend la tiene).
    try {
      const c = await apiGet('/api/sss/credenciales')
      sssCred = (c && c.username) ? c : null
    } catch (e) { sssCred = null; console.log('sss cred no disponible: ' + e.message) }
  } catch (e) {
    if (/HTTP 401/.test(e.message)) msg.textContent = 'Usuario o contrasena incorrectos.'
    else if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|getaddrinfo|socket hang up|URL de servidor/i.test(e.message)) msg.textContent = 'No se pudo conectar al servidor (192.168.0.21:8510). Verifica que este encendido y en red.'
    else if (/HTTP 5\d\d/.test(e.message)) msg.textContent = 'Error del servidor. Intenta de nuevo en un momento.'
    else msg.textContent = 'No se pudo ingresar: ' + e.message
  }
})

async function guardarRecorrido() {
  if (!token) { msgEl.textContent = 'Recorrido completo (no hay sesion: no se guardo en el backend).'; return }
  try {
    const r = await apiPost('/api/desktop/recorrido', {
      dni: datos.dni,
      cuil: datos.cuil,
      apellido: '',
      resultados: resultados.map((x) => ({
        fuente: x.codigo, nombre: x.nombre, veredicto: x.veredicto, texto: (x.texto || '').slice(0, 4000)
      }))
    })
    msgEl.textContent = `Guardado en historial: consulta #${r.consultaId} por ${r.usuario} (${r.fuentes} fuentes).`
    console.log('guardado consulta ' + r.consultaId)
  } catch (e) {
    msgEl.textContent = 'Recorrido completo, pero NO se pudo guardar en el backend: ' + e.message
    console.log('guardar ERROR: ' + e.message)
  }
}

const FUENTES = [
  {
    codigo: 'sss', nombre: 'SSS - Padron (HPGD)',
    // Acceso restringido para Hospitales (HPGD): la app hace el login automatico
    // con la credencial institucional; la sesion queda persistida en el webview.
    url: 'https://seguro.sssalud.gob.ar/login.php?b_publica=Acceso+Restringido+para+Hospitales&opc=bus650&user=HPGD',
    login: {
      user: "input[name='_user_name_']",
      pass: "input[name='_pass_word_']",
      submit: "input[name='submitbtn'], input[type='submit']"
    },
    campos: (p) => [["input[name='cuil_b']", p.cuil], ["input[name='nro_doc']", p.dni]],
    foco: "input[name='code']",
    // HPGD no tiene captcha: apretamos "Consultar" solos tras prellenar.
    enviarConsulta: true,
    enviar: "input[type='submit'][value*='Consultar' i], input[name='B1']",
    enviarTexto: /consultar/i,
    // Marcadores que SOLO aparecen en la pagina de resultado, no en el formulario.
    resultado: /no se reportan datos para el|datos historicos adicionales|no se reportan bajas|os origen|os destino/i
  },
  {
    codigo: 'arca', nombre: 'ARCA - Aportes en Linea',
    url: 'https://serviciossegsoc.afip.gob.ar/MisAportes/app/basica.aspx',
    campos: (p) => [["input[id*='txtCuil'], input[name*='txtCuil']", p.cuilDigits]],
    foco: null,
    resultado: /incluido en declaraci|aportes de obra social|en el curso del ultimo|no se encontraron registros|no registra aportes/i
  },
  {
    codigo: 'anses', nombre: 'ANSES - CODEM',
    url: 'https://servicioswww.anses.gob.ar/ooss2/',
    campos: (p) => [[
      "input[placeholder*='DOCUMENTO'], input[placeholder*='documento'], input[placeholder*='CUIL'], input[type='text']:not([type='hidden'])",
      p.cuilDigits || p.dni
    ]],
    foco: null,
    // Tras cargar el documento, apretar "Continuar" solo.
    enviarConsulta: true,
    enviarTexto: /continuar/i,
    resultado: /la consulta no arroj|comprobante de empadronamiento|codem/i
  },
  {
    codigo: 'servicio_domestico', nombre: 'SSS - Servicio Domestico',
    url: 'https://seguro.sssalud.gob.ar/index.php?cat=consultas&page=mono_pagos_sd',
    campos: (p) => [["input[name='nro_cuil']", p.cuil || p.dni]],
    foco: "input[name='code']",
    resultado: /no hay datos|no se reportan pagos|ultimo periodo|no se registran|importe|sin pagos/i
  },
  {
    // SISA - PUCO: app de una sola pagina (GWT). El operador clickea la tarjeta PUCO
    // del banner; la app carga el DNI (tipeo real) y aprieta Buscar sola.
    codigo: 'puco', nombre: 'SISA - PUCO',
    url: 'https://sisa.msal.gov.ar/sisa/#sisa',
    spa: true,
    resultado: /cobertura social|denominaci|o\.?s\.?p|no se encontr|sin registros/i
  },
  {
    // ANSES - Consulta de Obra Social (ConsultaDoc.aspx, ASP.NET WebForms).
    // Campo documento/CUIL + boton Continuar. Tiene reCAPTCHA invisible: corre solo;
    // si aparece un desafio, lo resuelve el operador.
    codigo: 'anses_doc', nombre: 'ANSES - Obra Social',
    url: 'https://servicioswww.anses.gob.ar/ooss2/ConsultaDoc.aspx',
    campos: (p) => [["input#ContentPlaceHolder1_txtDoc, input[name='ctl00$ContentPlaceHolder1$txtDoc']", p.cuilDigits || p.dni]],
    foco: null,
    enviarConsulta: true,
    enviar: "input#ContentPlaceHolder1_Button1, input[value='Continuar']",
    enviarTexto: /continuar/i,
    resultado: /obra social|la consulta no arroj|comprobante de empadronamiento|codem|no posee|no se encontr/i
  }
]

let idx = -1
let datos = { dni: '', cuil: '', cuilDigits: '' }
let prefillIntentos = 0
let monitoreando = false
let consultaEnviada = false // evita reenviar "Consultar" en la misma fuente
let spaIniciado = false     // fuentes SPA (PUCO): flujo inyectado una sola vez
let spaPoll = null          // intervalo que sondea el resultado de la SPA
let spaClickTimer = null    // intervalo que intenta el click real sobre la tarjeta PUCO
let pucoBuscado = false      // evita re-buscar en PUCO
let pucoTipeado = false      // el DNI se tipea una sola vez
let watchdog = null          // timeout que saltea la fuente si no carga
const resultados = []

function digits(s) { return (s || '').replace(/\D/g, '') }
function toCuil(s) {
  const d = digits(s)
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : ''
}

function buildPrefillJS(fuente, p) {
  const pares = fuente.campos(p).filter(([, val]) => val)
  return `(function(){
    if (window.__cobPrefilled) return 'ya';
    var pares = ${JSON.stringify(pares)};
    var foco = ${JSON.stringify(fuente.foco)};
    if (pares.length === 0) { window.__cobPrefilled = true; return 'sin-campos'; }
    var hecho = false;
    pares.forEach(function(par){
      var el = document.querySelector(par[0]);
      // Solo si el campo existe y esta vacio: no pisamos ni disparamos eventos (evita recargas).
      if (el && !el.value) { el.value = par[1]; hecho = true; }
    });
    if (hecho) {
      window.__cobPrefilled = true;
      if (foco) { var f = document.querySelector(foco); if (f) f.focus(); }
      return 'lleno';
    }
    return 'sin-campos-todavia';
  })();`
}

// Auto-login para fuentes con acceso restringido (ej: SSS-HPGD).
// Rellena usuario/clave y envia el formulario, una sola vez por documento.
function buildLoginJS(fuente, cred) {
  return `(function(){
    var pass = document.querySelector(${JSON.stringify(fuente.login.pass)});
    if (!pass) return 'sin-login';           // no hay login visible => ya estamos adentro
    if (window.__cobLoginDone) return 'ya';
    var user = document.querySelector(${JSON.stringify(fuente.login.user)});
    if (user) user.value = ${JSON.stringify(cred.username)};
    pass.value = ${JSON.stringify(cred.password)};
    window.__cobLoginDone = true;
    var b = document.querySelector(${JSON.stringify(fuente.login.submit)});
    if (b) { b.click(); return 'enviado'; }
    if (pass.form) { pass.form.submit(); return 'enviado-form'; }
    return 'sin-boton';
  })();`
}

// Aprieta el boton de envio del formulario (para fuentes sin captcha).
// Busca por selector CSS (fuente.enviar) y, si no, por texto (fuente.enviarTexto).
function buildSubmitJS(fuente) {
  const sel = fuente.enviar || ''
  const re = fuente.enviarTexto || /consultar/i
  return `(function(){
    var b = ${JSON.stringify(sel)} ? document.querySelector(${JSON.stringify(sel)}) : null;
    if (!b) {
      var re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)});
      b = Array.prototype.slice.call(document.querySelectorAll("input[type=submit],input[type=button],button,a"))
            .filter(function(x){ return re.test((x.value || '') + ' ' + (x.textContent || '')); })[0];
    }
    if (b) { b.click(); return 'consultado'; }
    return 'sin-boton';
  })();`
}

// Lector de resultado para PUCO (SPA): sondea hasta que aparezca "Ultima busqueda"
// o "no se encontro" (o sea, la busqueda ya corrio) y deja el texto en window.__cobSpaResult.
// El click en la tarjeta, el tipeo del DNI y el boton Buscar se hacen app-side (sendInputEvent).
function buildPucoResultJS() {
  return `(function(){
    if (window.__cobSpaRunning) return 'ya';
    window.__cobSpaRunning = true; window.__cobSpaResult = '';
    var t = 0;
    var iv = setInterval(function(){
      t++;
      var body = (document.body.innerText || '').replace(/\\s+/g, ' ');
      // "ltima b" cubre "Ultima"/"Última" (con o sin acento). Denominaci aparece con la fila de resultado.
      if (/ltima b[uú]squeda|no se encontr|sin registros|denominaci/i.test(body)) {
        window.__cobSpaResult = body.slice(0, 4000); clearInterval(iv);
      } else if (t > 120) {
        window.__cobSpaResult = body.slice(0, 4000) || '__timeout__'; clearInterval(iv);
      }
    }, 700);
    return 'iniciado';
  })();`
}

// Consulta el estado de la pantalla PUCO y devuelve coordenadas (para clicks reales).
function buildPucoProbeJS() {
  return `(function(){
    function C(el){ var r=el.getBoundingClientRect(); return (r.width>2 && r.height>2 && r.top>0) ? {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)} : null; }
    var input = document.querySelector("input[placeholder='Ingrese el valor']") || document.querySelector('input.gwt-TextBox');
    if (!input) {
      var card = [].slice.call(document.querySelectorAll('#servicios *, div, td, span')).filter(function(x){
        return /Consulta de Cobertura de Salud \\(PUCO\\)|^\\s*PUCO\\s*$/i.test((x.textContent||'').trim()) && (x.textContent||'').trim().length<70 && x.offsetParent!==null;
      })[0];
      return JSON.stringify({ fase:'entrar', card: card ? C(card) : null });
    }
    // Formulario presente: fijar NroDoc y devolver coords de input y Buscar.
    var byNro = [].slice.call(document.querySelectorAll('select.gwt-ListBox, select')).filter(function(s){
      return [].some.call(s.options||[], function(o){ return /NroDoc/i.test(o.text); });
    })[0];
    if (byNro && !/NroDoc/i.test(byNro.options[byNro.selectedIndex] ? byNro.options[byNro.selectedIndex].text : '')) {
      for (var i=0;i<byNro.options.length;i++){ if(/NroDoc/i.test(byNro.options[i].text)){ byNro.selectedIndex=i; break; } }
      byNro.dispatchEvent(new Event('change',{bubbles:true}));
    }
    var b = [].slice.call(document.querySelectorAll('div.boton, .boton_general, button, a, input, span')).filter(function(x){ return /^\\s*buscar\\s*$/i.test((x.textContent||x.value||'').trim()); })[0];
    return JSON.stringify({ fase:'form', valor: input.value||'', input: C(input), buscar: b ? C(b) : null });
  })();`
}

function cargarActual() {
  const f = FUENTES[idx]
  console.log('cargarActual idx=' + idx + ' fuente=' + f.codigo + ' url=' + f.url)
  prefillIntentos = 0
  monitoreando = false
  consultaEnviada = false
  spaIniciado = false
  clearInterval(spaPoll)
  clearInterval(spaClickTimer)
  clearTimeout(prefillTimer)
  clearTimeout(watchdog)
  webview.__cfg = { fuente: f, datos }
  progresoEl.textContent = `Fuente ${idx + 1}/${FUENTES.length}: ${f.nombre}`
  msgEl.textContent = `${f.nombre}: resolve el captcha en el panel y presiona Consultar. Se registra y avanza solo. (O usa "Leer y siguiente" a mano.)`
  btnSiguiente.disabled = false
  btnSiguiente.textContent = idx === FUENTES.length - 1 ? 'Leer y finalizar' : 'Leer y siguiente'
  webview.loadURL(f.url)
}

const avisoEl = document.getElementById('aviso')
function evaluarCuil() {
  // Muestra un aviso si no hay CUIL valido: las fuentes que dependen del CUIL
  // (ARCA, y con datos parciales SSS/ANSES/Serv.Domestico) no van a funcionar bien.
  if (!datos.cuil) {
    avisoEl.textContent = '⚠ Sin CUIL: las paginas que usan CUIL (SSS, ARCA, ANSES, Servicio Domestico) pueden no funcionar correctamente. Carga el CUIL para resultados completos.'
    avisoEl.classList.add('visible')
  } else {
    avisoEl.textContent = ''
    avisoEl.classList.remove('visible')
  }
}

// Confirmacion dentro de la app (no usa window.confirm, que rompia el teclado del webview).
function confirmarEnPagina(mensaje) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modalConfirm')
    document.getElementById('modalMsg').textContent = mensaje
    const btnSi = document.getElementById('modalSi')
    const btnNo = document.getElementById('modalNo')
    const cerrar = (val) => {
      modal.classList.remove('visible')
      btnSi.removeEventListener('click', onSi)
      btnNo.removeEventListener('click', onNo)
      resolve(val)
    }
    const onSi = () => cerrar(true)
    const onNo = () => cerrar(false)
    btnSi.addEventListener('click', onSi)
    btnNo.addEventListener('click', onNo)
    modal.classList.add('visible')
  })
}

btnIniciar.addEventListener('click', async () => {
  const dni = digits(document.getElementById('dni').value)
  const cuil = toCuil(document.getElementById('cuil').value) || toCuil(dni)
  datos = { dni, cuil, cuilDigits: digits(cuil) }
  if (!datos.dni && !datos.cuil) { msgEl.textContent = 'Carga al menos DNI o CUIL.'; return }
  evaluarCuil()
  // Muestra el historial y, si ya hay una consulta previa, CARGA el ultimo resultado
  // en el panel y DESPUES pregunta si repetir.
  const previas = await cargarHistorialDocumento()
  if (previas && previas.length) {
    const fecha = new Date(previas[0].fecha).toLocaleString('es-AR')
    mostrarResultadosPrevios(previas[0]) // 1) primero mostramos el ultimo resultado
    msgEl.textContent = `Ultima busqueda: ${fecha}. Decidi si repetir...`
    // Confirmacion DENTRO de la app (no window.confirm): el dialogo nativo dejaba
    // al webview sin teclado y despues no se podia escribir el captcha.
    const repetir = await confirmarEnPagina(`Este documento ya tiene una busqueda del ${fecha} (la ves en pantalla).\n\n¿Queres repetir la consulta?`)
    if (!repetir) {
      msgEl.textContent = `Se muestra la ultima busqueda (${fecha}). No se repitio.`
      return
    }
  }
  resultados.length = 0
  resultadosEl.innerHTML = ''
  idx = 0
  cargarActual()
})

// Prellenar con debounce: recien cuando la pagina dejo de navegar/asentarse.
let prefillTimer = null
function programarPrefill() {
  const cfg = webview.__cfg
  if (!cfg) return
  clearTimeout(prefillTimer)
  prefillTimer = setTimeout(async () => {
    try {
      const r = await webview.executeJavaScript(buildPrefillJS(cfg.fuente, cfg.datos))
      console.log('prefill ' + cfg.fuente.codigo + ' -> ' + r + ' (intento ' + prefillIntentos + ')')
      if (r === 'lleno' || r === 'sin-campos' || r === 'ya') {
        monitoreando = true // a partir de aca, cualquier resultado se detecta solo
        // Auto-enviar "Consultar" si la fuente no tiene captcha (ej: SSS-HPGD).
        if (r === 'lleno' && cfg.fuente.enviarConsulta && !consultaEnviada) {
          const s = await webview.executeJavaScript(buildSubmitJS(cfg.fuente))
          console.log('submit ' + cfg.fuente.codigo + ' -> ' + s)
          if (s === 'consultado') { consultaEnviada = true; msgEl.textContent = `${cfg.fuente.nombre}: consultando...` }
        }
      } else if (r === 'sin-campos-todavia' && prefillIntentos++ < 8) {
        prefillTimer = setTimeout(programarPrefill, 700)
      }
    } catch (e) {
      console.log('prefill ERROR: ' + e.message)
    }
  }, 900)
}

// En cada asentamiento de pagina: si ya prellenamos y aparece el resultado, se
// registra y avanza solo. Si no, (re)programamos el prellenado.
webview.addEventListener('did-stop-loading', async () => {
  clearTimeout(watchdog) // la pagina cargo: cancelamos el watchdog de "no carga"
  if (!webview.__cfg) { console.log('did-stop-loading sin cfg (idx=' + idx + ')'); return }
  const f = webview.__cfg.fuente

  // Fuentes SPA (PUCO): la app no recarga pagina, se maneja con clicks/tipeo reales + sondeo.
  if (f.spa) {
    if (spaIniciado) return
    spaIniciado = true
    pucoBuscado = false
    pucoTipeado = false
    msgEl.textContent = `${f.nombre}: clickea la tarjeta PUCO del banner. La app carga el DNI y busca sola.`
    await webview.executeJavaScript(buildPucoResultJS())

    function clickReal(x, y) {
      try { webview.focus() } catch (e) {}
      webview.sendInputEvent({ type: 'mouseMove', x, y })
      webview.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      webview.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    }
    function tipear(texto) {
      for (const ch of String(texto)) {
        webview.sendInputEvent({ type: 'keyDown', keyCode: ch })
        webview.sendInputEvent({ type: 'char', keyCode: ch })
        webview.sendInputEvent({ type: 'keyUp', keyCode: ch })
      }
    }

    clearInterval(spaClickTimer)
    spaClickTimer = setInterval(async () => {
      if (pucoBuscado) { clearInterval(spaClickTimer); return }
      try {
        const st = JSON.parse(await webview.executeJavaScript(buildPucoProbeJS()))
        if (st.fase === 'entrar') {
          // Intento de entrar solo (click real sobre la tarjeta); si no, la clickea el operador.
          console.log('puco ENTRAR card=' + JSON.stringify(st.card))
          if (st.card) clickReal(st.card.x, st.card.y)
          return
        }
        // Formulario presente: tipear el DNI UNA vez y click real en Buscar cuando aparezca.
        if (st.fase === 'form' && !pucoBuscado) {
          console.log('puco FORM valor="' + st.valor + '" tipeado=' + pucoTipeado + ' input=' + JSON.stringify(st.input) + ' buscar=' + JSON.stringify(st.buscar))
          if (!pucoTipeado && st.input) {
            clickReal(st.input.x, st.input.y)
            // limpiar el campo antes de tipear (evita DNIs repetidos)
            await webview.executeJavaScript(`(function(){var i=document.querySelector("input[placeholder='Ingrese el valor']")||document.querySelector('input.gwt-TextBox'); if(i){i.value=''; i.dispatchEvent(new Event('input',{bubbles:true}));} return true;})()`)
            tipear(digits(datos.dni)) // solo digitos
            // Confirmar con Enter (los buscadores GWT suelen disparar la busqueda con Enter).
            webview.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
            webview.sendInputEvent({ type: 'char', keyCode: '\r' })
            webview.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
            pucoTipeado = true
          }
          // Ademas, click real sobre el boton "Buscar" (por si no confirmo con Enter).
          if (pucoTipeado && st.buscar) { clickReal(st.buscar.x, st.buscar.y); pucoBuscado = true; msgEl.textContent = `${f.nombre}: consultando...` }
        }
      } catch (e) { /* reintentar */ }
    }, 500)

    clearInterval(spaPoll)
    spaPoll = setInterval(async () => {
      try {
        const res = await webview.executeJavaScript('window.__cobSpaResult || ""')
        if (res && res.length) {
          clearInterval(spaPoll); clearInterval(spaClickTimer)
          const limpio = /^__\w+__$/.test(res) ? 'Sin resultado detectado (revisar a mano)' : res
          console.log('SPA ' + f.codigo + ' -> resultado (' + res.length + ' chars)')
          registrar(limpio, true)
        }
      } catch (e) { /* seguimos sondeando */ }
    }, 800)
    return
  }

  // Login automatico si la fuente lo requiere y tenemos credencial.
  if (f.login) {
    if (sssCred) {
      try {
        const r = await webview.executeJavaScript(buildLoginJS(f, sssCred))
        console.log('login ' + f.codigo + ' -> ' + r)
        if (r === 'enviado' || r === 'enviado-form') {
          msgEl.textContent = `${f.nombre}: ingresando automaticamente...`
          return // la pagina recarga; en el proximo did-stop-loading seguimos con la consulta
        }
      } catch (e) { console.log('login ERROR: ' + e.message) }
    } else {
      // Sin credencial en el backend: el operador debe loguearse a mano esta vez.
      try {
        const hayLogin = await webview.executeJavaScript(`!!document.querySelector(${JSON.stringify(f.login.pass)})`)
        if (hayLogin) msgEl.textContent = `${f.nombre}: ingresa usuario y clave en la ventana (no hay credencial configurada en el backend).`
      } catch (e) { /* seguimos */ }
    }
  }

  if (monitoreando && f.resultado) {
    try {
      const raw = await webview.executeJavaScript('document.body.innerText')
      const texto = (raw || '').replace(/\s+/g, ' ').trim()
      if (f.resultado.test(texto)) {
        console.log('AUTO resultado detectado en ' + f.codigo)
        registrar(texto, true)
        return
      }
    } catch (e) { /* seguimos */ }
  }
  programarPrefill()
})

function clasificar(texto) {
  if (/no hay datos|no se reportan datos|no registra|sin cobertura|no se encontr|no posee|no existen datos|sin pagos|no se reportan pagos|no arroj/i.test(texto)) {
    return { v: 'SIN cobertura', c: '#f87171' }
  }
  if (/obra social|os origen|os destino|beneficiario|incluido en declaraci|aportes de obra social|puco|periodo|importe|comprobante de empadron/i.test(texto)) {
    return { v: 'CON cobertura / aportes', c: '#4ade80' }
  }
  return { v: 'Sin determinar', c: '#fbbf24' }
}

function registrar(texto, auto) {
  clearTimeout(watchdog)
  const f = FUENTES[idx]
  const cl = clasificar(texto)
  resultados.push({ codigo: f.codigo, nombre: f.nombre, veredicto: cl.v, texto })
  const div = document.createElement('div')
  div.className = 'res'
  // Cabecera clickeable: por defecto solo se ve el veredicto; el texto completo
  // queda oculto y se despliega al hacer click (para no dejarlo todo expuesto).
  const head = document.createElement('div')
  head.className = 'res-head'
  head.style.cursor = 'pointer'
  head.innerHTML = `<b>${f.nombre}</b> ${auto ? '<span style="color:#64748b;font-size:10px">(auto)</span>' : ''}` +
    `<div class="v" style="color:${cl.c}">${cl.v} <span class="ver-mas">(ver detalle)</span></div>`
  const pre = document.createElement('pre')
  pre.textContent = texto.slice(0, 4000)
  pre.style.display = 'none'
  head.addEventListener('click', () => {
    const oculto = pre.style.display === 'none'
    pre.style.display = oculto ? 'block' : 'none'
    const vm = head.querySelector('.ver-mas')
    if (vm) vm.textContent = oculto ? '(ocultar)' : '(ver detalle)'
  })
  div.appendChild(head)
  div.appendChild(pre)
  resultadosEl.appendChild(div)
  monitoreando = false
  idx += 1
  console.log('registrado ' + f.codigo + ' -> ' + cl.v + ' | idx despues=' + idx)
  if (idx < FUENTES.length) {
    cargarActual()
  } else {
    terminarDni()
  }
}

// --- Historial de busquedas de ESTE documento (traido del backend) ---
const historialEl = document.getElementById('historial')

async function cargarHistorialDocumento() {
  if (!token || (!datos.dni && !datos.cuil)) { historialEl.innerHTML = ''; return [] }
  try {
    const q = new URLSearchParams()
    if (datos.dni) q.set('dni', datos.dni)
    if (datos.cuil) q.set('cuil', datos.cuil)
    const data = await apiGet('/api/desktop/historial?' + q.toString())
    const lista = data.data || []
    renderHistorial(lista)
    return lista
  } catch (e) { console.log('historial ERROR: ' + e.message); return [] }
}

function renderHistorial(lista) {
  historialEl.innerHTML = ''
  if (!lista.length) {
    historialEl.innerHTML = '<div class="hist-vacio">Sin busquedas previas de este documento.</div>'
    return
  }
  // SOLO la ultima busqueda (la mas reciente), no toda la lista.
  const c = lista[0]
  const fecha = new Date(c.fecha).toLocaleString('es-AR')
  const fuentes = c.fuentes || []
  const con = fuentes.filter((f) => /con cobertura|aportes/i.test(f.resultado || '')).length
  const resumen = fuentes.length ? `${con}/${fuentes.length} con cobertura` : 'sin datos'
  const div = document.createElement('div')
  div.className = 'hist'
  const head = document.createElement('div')
  head.className = 'hist-head'
  head.innerHTML = `<b>${fecha}</b>` +
    `<span class="hist-hora">por ${c.usuario}</span>` +
    `<div class="hist-res">${resumen} — ver detalle</div>`
  const det = document.createElement('div')
  det.className = 'hist-det'
  det.style.display = 'none'
  det.innerHTML = fuentes.map((f) => `<div><b>${f.fuente}:</b> ${f.resultado || f.estado || '-'}</div>`).join('') || '<div>Sin detalle</div>'
  head.addEventListener('click', () => { det.style.display = det.style.display === 'none' ? 'block' : 'none' })
  div.appendChild(head)
  div.appendChild(det)
  historialEl.appendChild(div)
}

document.getElementById('limpiarHist').addEventListener('click', cargarHistorialDocumento)

function colorVeredicto(v) {
  if (/con cobertura|aportes/i.test(v || '')) return '#4ade80'
  if (/sin cobertura|no posee|no registra|sin pagos|no arroj/i.test(v || '')) return '#f87171'
  return '#fbbf24'
}

// Muestra en el panel "Resultados por fuente" el resultado de UNA busqueda previa
// (la ultima), cuando el operador elige NO repetir.
function mostrarResultadosPrevios(consulta) {
  resultadosEl.innerHTML = ''
  const fecha = new Date(consulta.fecha).toLocaleString('es-AR')
  const cab = document.createElement('div')
  cab.className = 'res-previo'
  cab.textContent = `Ultima busqueda: ${fecha} (por ${consulta.usuario}). No se repitio.`
  resultadosEl.appendChild(cab)
  ;(consulta.fuentes || []).forEach((fu) => {
    const div = document.createElement('div')
    div.className = 'res'
    div.innerHTML = `<b>${fu.fuente}</b>` +
      `<div class="v" style="color:${colorVeredicto(fu.resultado)}">${fu.resultado || fu.estado || '-'}</div>`
    resultadosEl.appendChild(div)
  })
  const panelEl = document.getElementById('panel')
  if (panelEl) panelEl.scrollTop = 0 // que se vea el resultado, no el historial largo
}

// Se llama cuando un DNI termino todas sus fuentes. Guarda en el backend y,
// si estamos en un lote, captura el resultado y avanza al siguiente DNI.
async function terminarDni() {
  btnSiguiente.disabled = true
  webview.loadURL('about:blank')
  await guardarRecorrido()
  await cargarHistorialDocumento()

  if (!loteActivo) {
    progresoEl.textContent = 'Recorrido completo'
    return
  }

  // Capturar el veredicto por fuente de este DNI para el Excel de salida.
  const porFuente = {}
  resultados.forEach((r) => { porFuente[r.codigo] = r.veredicto })
  resultadosLote.push({ dni: datos.dni, cuil: datos.cuil, porFuente })

  if (filaActual < cola.length - 1) {
    filaActual += 1
    const it = cola[filaActual]
    const cuil = it.cuil || toCuil(it.dni)
    datos = { dni: it.dni, cuil, cuilDigits: digits(cuil) }
    resultados.length = 0
    resultadosEl.innerHTML = ''
    idx = 0
    progresoEl.textContent = `Lote: DNI ${filaActual + 1}/${cola.length}`
    cargarActual()
  } else {
    loteActivo = false
    progresoEl.textContent = `Lote completo: ${cola.length}/${cola.length}`
    msgEl.textContent = `Lote terminado: ${resultadosLote.length} DNIs procesados. Podes descargar los resultados.`
    btnDescargarLote.disabled = resultadosLote.length === 0
    btnIniciarLote.disabled = cola.length === 0
  }
}

btnRecargar.addEventListener('click', () => {
  console.log('recargar/limpiar: reset completo para nueva consulta')
  // Frenar cualquier flujo en curso.
  clearTimeout(prefillTimer)
  clearTimeout(watchdog)
  clearInterval(spaPoll)
  clearInterval(spaClickTimer)
  // Resetear todo el estado del recorrido.
  idx = -1
  datos = { dni: '', cuil: '', cuilDigits: '' }
  prefillIntentos = 0
  monitoreando = false
  consultaEnviada = false
  spaIniciado = false
  pucoBuscado = false
  pucoTipeado = false
  resultados.length = 0
  resultadosEl.innerHTML = ''
  // Limpiar campos y textos.
  document.getElementById('dni').value = ''
  document.getElementById('cuil').value = ''
  progresoEl.textContent = ''
  msgEl.textContent = 'Listo para una nueva consulta. Carga DNI/CUIL y presiona "Iniciar recorrido".'
  avisoEl.classList.remove('visible')
  btnSiguiente.disabled = true
  // Vaciar la ventana embebida (borra busqueda/DNI de la pagina).
  webview.__cfg = null
  webview.loadURL('about:blank')
})

btnSiguiente.addEventListener('click', async () => {
  console.log('click Leer y siguiente (manual), idx=' + idx)
  let texto = ''
  try {
    const raw = await webview.executeJavaScript('document.body.innerText')
    texto = (raw || '').replace(/\s+/g, ' ').trim()
  } catch (e) { texto = '' }
  registrar(texto, false)
})

// ===================== LOTE POR EXCEL =====================

// Detecta cual columna es la de DNI: primero por nombre de encabezado, y si no,
// por contenido (la columna con mas valores de 7-8 digitos).
function detectarColumnaDni(header, cuerpo) {
  let col = header.findIndex((h) => /dni|documento|^doc|nro\.?\s*doc|n[uú]m\.?\s*doc/i.test(String(h || '')))
  if (col >= 0) return col
  let best = -1, score = -1
  for (let c = 0; c < header.length; c++) {
    let ok = 0, tot = 0
    for (const r of cuerpo) {
      const val = String(r[c] == null ? '' : r[c]).trim()
      if (val === '') continue
      tot++
      const d = digits(val)
      if (d.length >= 7 && d.length <= 8) ok++
    }
    const s = tot ? ok / tot : 0
    if (s > score) { score = s; best = c }
  }
  return best
}

// Arma la cola de {dni, cuil} desde la columna elegida.
function extraerCola(col) {
  cola = []
  for (const r of filasExcel) {
    const crudo = String(r[col] == null ? '' : r[col]).trim()
    const d = digits(crudo)
    if (d.length === 11) { cola.push({ dni: d.slice(2, 10), cuil: `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` }) }
    else if (d.length >= 7 && d.length <= 8) { cola.push({ dni: d, cuil: '' }) }
  }
  loteInfo.textContent = `${cola.length} DNIs validos en la columna "${encabezadoExcel[col] || ('columna ' + (col + 1))}".`
  btnIniciarLote.disabled = cola.length === 0 || loteActivo
}

archivoLote.addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
      if (!rows.length) { loteInfo.textContent = 'El Excel esta vacio.'; return }
      encabezadoExcel = (rows[0] || []).map((x) => String(x).trim())
      filasExcel = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''))
      // Poblar el selector con todas las columnas.
      colDniSel.innerHTML = ''
      encabezadoExcel.forEach((h, i) => {
        const opt = document.createElement('option')
        opt.value = String(i)
        opt.textContent = h || ('Columna ' + (i + 1))
        colDniSel.appendChild(opt)
      })
      const col = detectarColumnaDni(encabezadoExcel, filasExcel)
      colDniSel.value = String(col < 0 ? 0 : col)
      colDniSel.disabled = false
      extraerCola(Number(colDniSel.value))
      msgEl.textContent = `Archivo "${file.name}" cargado. Revisa la columna DNI y presiona "Iniciar lote".`
    } catch (e) {
      loteInfo.textContent = 'No se pudo leer el Excel: ' + e.message
      console.log('lote leer ERROR: ' + e.message)
    }
  }
  reader.readAsArrayBuffer(file)
})

colDniSel.addEventListener('change', () => extraerCola(Number(colDniSel.value)))

btnIniciarLote.addEventListener('click', () => {
  if (cola.length === 0) { msgEl.textContent = 'No hay DNIs para procesar.'; return }
  resultadosLote.length = 0
  btnDescargarLote.disabled = true
  btnIniciarLote.disabled = true
  loteActivo = true
  filaActual = 0
  const it = cola[0]
  const cuil = it.cuil || toCuil(it.dni)
  datos = { dni: it.dni, cuil, cuilDigits: digits(cuil) }
  evaluarCuil()
  resultados.length = 0
  resultadosEl.innerHTML = ''
  idx = 0
  progresoEl.textContent = `Lote: DNI 1/${cola.length}`
  cargarActual()
})

btnDescargarLote.addEventListener('click', () => {
  if (resultadosLote.length === 0) { msgEl.textContent = 'No hay resultados para exportar.'; return }
  const codigos = FUENTES.map((f) => f.codigo)
  const nombres = FUENTES.map((f) => f.nombre)
  const sep = ';'
  const esc = (v) => {
    const s = String(v == null ? '' : v).replace(/\r?\n/g, ' ').trim()
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const header = ['DNI', 'CUIL', ...nombres].map(esc).join(sep)
  const filas = resultadosLote.map((r) =>
    [r.dni, r.cuil, ...codigos.map((c) => r.porFuente[c] || '')].map(esc).join(sep))
  const contenido = '﻿' + [header, ...filas].join('\r\n')
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const hoy = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `resultados-lote-${hoy}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
})
