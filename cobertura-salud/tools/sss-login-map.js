/*
 * sss-login-map.js
 * Inicia sesion en la Ventanilla Electronica de la SSS (Acceso Restringido HPGD)
 * usando las credenciales de backend/.env.development (SSS_USERNAME / SSS_PASSWORD),
 * y mapea el proceso: guarda el HTML de cada paso y lista los formularios/campos
 * de la pantalla post-login (consulta de padron opc=bus650).
 *
 * Uso (desde la carpeta del proyecto):
 *   node tools/sss-login-map.js
 *
 * No hardcodea la clave: la lee del .env. Los HTML quedan en tools/sss-map/.
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

const ENV_FILE = path.join(__dirname, '..', 'backend', '.env.development')
const OUT_DIR = path.join(__dirname, 'sss-map')
const HOST = 'seguro.sssalud.gob.ar'
const LOGIN_PATH = '/login.php?b_publica=Acceso+Restringido+para+Hospitales&opc=bus650&user=HPGD'

// --- Leer credenciales del .env ---
function leerEnv(file) {
  const env = {}
  for (const linea of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

// --- Cookie jar minimo ---
const cookies = {}
function guardarCookies(res) {
  const set = res.headers['set-cookie'] || []
  for (const c of set) {
    const [kv] = c.split(';')
    const i = kv.indexOf('=')
    if (i > 0) cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
  }
}
function headerCookie() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
}

function pedir(method, ruta, body) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) sss-login-map',
      'Accept': 'text/html,application/xhtml+xml',
    }
    if (headerCookie()) headers['Cookie'] = headerCookie()
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      headers['Content-Length'] = Buffer.byteLength(body)
    }
    const req = https.request({ host: HOST, path: ruta, method, headers }, (res) => {
      guardarCookies(res)
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// --- Extraer formularios/campos del HTML (regex simple, sin dependencias) ---
function mapearFormularios(html) {
  const forms = []
  const formRe = /<form[^>]*>([\s\S]*?)<\/form>/gi
  let fm
  while ((fm = formRe.exec(html))) {
    const abre = fm[0].slice(0, fm[0].indexOf('>') + 1)
    const action = (abre.match(/action\s*=\s*["']([^"']*)["']/i) || [])[1] || ''
    const metodo = ((abre.match(/method\s*=\s*["']([^"']*)["']/i) || [])[1] || 'GET').toUpperCase()
    const campos = []
    const inRe = /<(input|select|textarea)\b[^>]*>/gi
    let im
    while ((im = inRe.exec(fm[1]))) {
      const t = im[0]
      campos.push({
        tag: im[1].toLowerCase(),
        type: (t.match(/type\s*=\s*["']([^"']*)["']/i) || [])[1] || '',
        name: (t.match(/name\s*=\s*["']([^"']*)["']/i) || [])[1] || '',
        id: (t.match(/id\s*=\s*["']([^"']*)["']/i) || [])[1] || '',
      })
    }
    forms.push({ action, metodo, campos })
  }
  return forms
}

function textoPlano(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

;(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const env = leerEnv(ENV_FILE)
  const user = env.SSS_USERNAME
  const pass = env.SSS_PASSWORD
  if (!user || !pass) { console.error('Faltan SSS_USERNAME / SSS_PASSWORD en', ENV_FILE); process.exit(1) }

  // 1) GET del login (para tomar la cookie de sesion PHP).
  console.log('1) GET login ...')
  const g = await pedir('GET', LOGIN_PATH)
  fs.writeFileSync(path.join(OUT_DIR, '1-login.html'), g.body)
  console.log('   status', g.status, '| cookies:', Object.keys(cookies).join(', ') || '(ninguna)')

  // 2) POST de credenciales.
  console.log('2) POST credenciales (usuario ' + user + ') ...')
  const form = new URLSearchParams({ _user_name_: user, _pass_word_: pass, submitbtn: 'Ingresar' }).toString()
  let p = await pedir('POST', LOGIN_PATH, form)
  fs.writeFileSync(path.join(OUT_DIR, '2-post-login.html'), p.body)
  console.log('   status', p.status, p.headers.location ? '| redirige a: ' + p.headers.location : '')

  // 3) Seguir redireccion si la hubo.
  if (p.headers.location) {
    const loc = p.headers.location.replace(/^https?:\/\/[^/]+/, '')
    console.log('3) GET destino post-login ...')
    p = await pedir('GET', loc)
    fs.writeFileSync(path.join(OUT_DIR, '3-destino.html'), p.body)
    console.log('   status', p.status)
  }

  // 4) Mapear la pantalla final.
  const txt = textoPlano(p.body)
  const logueado = !/_pass_word_|Clave:|previamente registrado/i.test(p.body)
  console.log('\n===== MAPA POST-LOGIN =====')
  console.log('Login exitoso (heuristica):', logueado ? 'SI' : 'NO (parece seguir en el login)')
  console.log('Texto (300):', txt.slice(0, 300))
  console.log('\nFormularios detectados:')
  console.log(JSON.stringify(mapearFormularios(p.body), null, 1))
  console.log('\nHTML guardado en:', OUT_DIR)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
