<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  Download,
  ExternalLink,
  History,
  LogOut,
  Printer,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
  Users
} from 'lucide-vue-next'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const session = ref(JSON.parse(localStorage.getItem('cobertura_session') || 'null'))
const view = ref('consulta')
const loading = ref(false)
const message = ref('')
const loginForm = ref({ username: 'admin', password: '' })
const consultaForm = ref({ modo: 'red', fuente: 'sss', dni: '', cuil: '', apellido: '' })
const decisionForm = ref({ decisionFinal: '', coberturaRecomendada: '', observaciones: '' })
const consultaActual = ref(null)
const historial = ref([])
const usuarios = ref([])
const nuevoUsuario = ref({ username: '', password: '', role: 'user' })
const reporte = ref([])
const reporteFiltro = ref({ usuario: '', dni: '', cuil: '', desde: '', hasta: '' })
const captchaSesion = ref(null)
const captchaCode = ref('')
const sssResult = ref(null)
const localResult = ref(null)

const fuentesRed = [
  { value: 'sss', label: 'SSS - Padron de beneficiarios' },
  { value: 'servicio_domestico', label: 'SSS - Pagos Servicio Domestico' }
]
const fuentesLocal = [
  { value: 'sss', label: 'SSS - Padron de beneficiarios' },
  { value: 'arca', label: 'ARCA - Aportes en Linea' },
  { value: 'anses_codem', label: 'ANSES - CODEM' },
  { value: 'servicio_domestico', label: 'SSS - Pagos Servicio Domestico' }
]
const fuentesDisponibles = computed(() => consultaForm.value.modo === 'local' ? fuentesLocal : fuentesRed)

const isAdmin = computed(() => session.value?.user?.role === 'admin')

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json'
  if (session.value?.token) headers.authorization = `Bearer ${session.value.token}`
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401 && !path.includes('/auth/login')) {
    logout()
    throw new Error('Sesion vencida. Volve a iniciar sesion.')
  }
  if (!response.ok) throw new Error(data.error || 'Error de API')
  return data
}

async function login() {
  message.value = ''
  loading.value = true
  try {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginForm.value)
    })
    session.value = data
    localStorage.setItem('cobertura_session', JSON.stringify(data))
    await cargarHistorial()
  } catch (error) {
    message.value = error.message || 'No se pudo iniciar sesion'
  } finally {
    loading.value = false
  }
}

function logout() {
  localStorage.removeItem('cobertura_session')
  session.value = null
  consultaActual.value = null
  historial.value = []
}

function seleccionarModo(modo) {
  consultaForm.value.modo = modo
  if (!fuentesDisponibles.value.some((f) => f.value === consultaForm.value.fuente)) {
    consultaForm.value.fuente = 'sss'
  }
  captchaSesion.value = null
  sssResult.value = null
  localResult.value = null
}

async function verificar() {
  message.value = ''
  consultaActual.value = null
  sssResult.value = null
  localResult.value = null
  captchaSesion.value = null
  const payload = {
    fuente: consultaForm.value.fuente,
    dni: consultaForm.value.dni,
    cuil: consultaForm.value.cuil,
    apellido: consultaForm.value.apellido
  }
  loading.value = true
  try {
    if (consultaForm.value.modo === 'local') {
      localResult.value = await request('/consulta-local', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      await cargarHistorial()
    } else {
      captchaSesion.value = await request('/sss/iniciar', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      captchaCode.value = ''
    }
  } catch (error) {
    message.value = error.message || 'No se pudo abrir la consulta'
  } finally {
    loading.value = false
  }
}

async function cargarHistorial() {
  if (!session.value) return
  const data = await request('/consultas')
  historial.value = data.data || []
}

async function abrirConsulta(id) {
  message.value = ''
  captchaSesion.value = null
  sssResult.value = null
  localResult.value = null
  const data = await request(`/consultas/${id}`)
  consultaActual.value = data
  decisionForm.value = {
    decisionFinal: data.decisionFinal || '',
    coberturaRecomendada: data.coberturaRecomendada || '',
    observaciones: data.observaciones || ''
  }
  view.value = 'consulta'
}

async function guardarDecision() {
  if (!consultaActual.value) return
  loading.value = true
  message.value = ''
  try {
    const data = await request(`/consultas/${consultaActual.value.id}/decision`, {
      method: 'PATCH',
      body: JSON.stringify(decisionForm.value)
    })
    consultaActual.value = data
    message.value = 'Decision guardada'
    await cargarHistorial()
  } catch (error) {
    message.value = error.message || 'No se pudo guardar'
  } finally {
    loading.value = false
  }
}

async function resolverCaptcha() {
  if (!captchaSesion.value || !captchaCode.value) return
  loading.value = true
  message.value = ''
  try {
    const data = await request('/sss/resolver', {
      method: 'POST',
      body: JSON.stringify({ sessionId: captchaSesion.value.sessionId, code: captchaCode.value })
    })
    sssResult.value = data
    if (data.estado === 'captcha_incorrecto' || data.estado === 'sesion_expirada') {
      message.value = data.mensaje
      await verificar()
    } else {
      captchaSesion.value = null
      await cargarHistorial()
    }
  } catch (error) {
    message.value = error.message || 'No se pudo consultar'
  } finally {
    loading.value = false
  }
}

async function cargarUsuarios() {
  if (!isAdmin.value) return
  const data = await request('/usuarios')
  usuarios.value = data.data || []
}

async function cargarReporte() {
  if (!isAdmin.value) return
  const q = new URLSearchParams()
  if (reporteFiltro.value.usuario) q.set('usuario', reporteFiltro.value.usuario)
  if (reporteFiltro.value.dni) q.set('dni', reporteFiltro.value.dni)
  if (reporteFiltro.value.cuil) q.set('cuil', reporteFiltro.value.cuil)
  if (reporteFiltro.value.desde) q.set('desde', reporteFiltro.value.desde)
  if (reporteFiltro.value.hasta) q.set('hasta', reporteFiltro.value.hasta)
  const qs = q.toString()
  const data = await request('/reporte' + (qs ? '?' + qs : ''))
  reporte.value = data.data || []
}

// Columnas del informe (mismo orden para pantalla, impresion y Excel).
const columnasReporte = [
  { key: 'consultaId', label: 'N° consulta', valor: (r) => r.consultaId },
  { key: 'fecha', label: 'Fecha', valor: (r) => fecha(r.fecha) },
  { key: 'usuario', label: 'Usuario', valor: (r) => r.usuario },
  { key: 'entrada', label: 'Tipo', valor: (r) => r.entrada || '' },
  { key: 'dni', label: 'DNI', valor: (r) => r.dni || '' },
  { key: 'cuil', label: 'CUIL', valor: (r) => r.cuil || '' },
  { key: 'apellido', label: 'Apellido', valor: (r) => r.apellido || '' },
  { key: 'fuente', label: 'Fuente', valor: (r) => r.fuente },
  { key: 'resultado', label: 'Resultado', valor: (r) => r.resultado || '' },
  { key: 'estado', label: 'Estado', valor: (r) => estadoLabel(r.estado) },
  { key: 'resumen', label: 'Resumen', valor: (r) => r.resumen || '' }
]

function imprimirReporte() {
  window.print()
}

function descargarExcel() {
  if (reporte.value.length === 0) { message.value = 'No hay datos para exportar.'; return }
  const sep = ';'
  const esc = (v) => {
    const s = String(v ?? '').replace(/\r?\n/g, ' ').trim()
    // Entre comillas si contiene el separador, comillas o punto y coma.
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const encabezado = columnasReporte.map((c) => esc(c.label)).join(sep)
  const filas = reporte.value.map((r) => columnasReporte.map((c) => esc(c.valor(r))).join(sep))
  // BOM UTF-8 para que Excel muestre acentos correctamente.
  const contenido = '﻿' + [encabezado, ...filas].join('\r\n')
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const hoy = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `informe-cobertura-${hoy}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function crearUsuario() {
  loading.value = true
  message.value = ''
  try {
    await request('/usuarios', {
      method: 'POST',
      body: JSON.stringify(nuevoUsuario.value)
    })
    nuevoUsuario.value = { username: '', password: '', role: 'user' }
    await cargarUsuarios()
    message.value = 'Usuario creado'
  } catch (error) {
    message.value = error.message || 'No se pudo crear usuario'
  } finally {
    loading.value = false
  }
}

async function actualizarUsuario(user) {
  loading.value = true
  message.value = ''
  try {
    await request(`/usuarios/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: user.role, activo: user.activo, password: user.newPassword || '' })
    })
    user.newPassword = ''
    await cargarUsuarios()
    message.value = 'Usuario actualizado'
  } catch (error) {
    message.value = error.message || 'No se pudo actualizar usuario'
  } finally {
    loading.value = false
  }
}

function estadoLabel(estado) {
  return {
    consultado: 'Consultado',
    requiere_operador: 'Requiere operador',
    error: 'Error',
    pendiente: 'Pendiente',
    en_revision: 'En revision',
    completa: 'Completa'
  }[estado] || estado
}

function fecha(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('es-AR')
}

onMounted(async () => {
  if (session.value) {
    await cargarHistorial().catch(() => {})
  }
})
</script>

<template>
  <main v-if="!session" class="login-shell">
    <form class="login-panel" @submit.prevent="login">
      <div class="brand"><ShieldCheck :size="30" /></div>
      <h1>Verificacion de cobertura</h1>
      <p>Ingreso seguro para consultas de obra social.</p>
      <label>
        Usuario
        <input v-model="loginForm.username" autocomplete="username">
      </label>
      <label>
        Contrasena
        <input v-model="loginForm.password" type="password" autocomplete="current-password">
      </label>
      <p v-if="message" class="alert">{{ message }}</p>
      <button class="primary" :disabled="loading">{{ loading ? 'Ingresando...' : 'Ingresar' }}</button>
    </form>
  </main>

  <main v-else class="app-shell">
    <header class="topbar">
      <div>
        <h1>Verificacion de cobertura</h1>
        <p>{{ session.user.username }} - {{ session.user.role }}</p>
      </div>
      <nav>
        <button :class="{ active: view === 'consulta' }" @click="view = 'consulta'"><Search :size="17" /> Consulta</button>
        <button :class="{ active: view === 'historial' }" @click="view = 'historial'; cargarHistorial()"><History :size="17" /> Historial</button>
        <button v-if="isAdmin" :class="{ active: view === 'informe' }" @click="view = 'informe'; cargarReporte()"><History :size="17" /> Informe</button>
        <button v-if="isAdmin" :class="{ active: view === 'usuarios' }" @click="view = 'usuarios'; cargarUsuarios()"><Users :size="17" /> Usuarios</button>
        <button @click="logout"><LogOut :size="17" /> Salir</button>
      </nav>
    </header>

    <p v-if="message" class="notice">{{ message }}</p>

    <section v-if="view === 'consulta'" class="work-grid">
      <form class="panel query-panel" @submit.prevent="verificar">
        <h2>Nueva consulta</h2>
        <div class="modo-tabs">
          <button type="button" :class="{ active: consultaForm.modo === 'red' }" @click="seleccionarModo('red')">Por red (captcha en la app)</button>
          <button type="button" :class="{ active: consultaForm.modo === 'local' }" @click="seleccionarModo('local')">En esta PC (Chrome del proyecto)</button>
        </div>
        <label>
          Fuente
          <select v-model="consultaForm.fuente" :disabled="!!captchaSesion">
            <option v-for="f in fuentesDisponibles" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </label>
        <div class="form-row">
          <label>
            DNI
            <input v-model="consultaForm.dni" placeholder="documento sin puntos" autofocus>
          </label>
          <label>
            CUIL
            <input v-model="consultaForm.cuil" placeholder="XX-XXXXXXXX-X">
          </label>
        </div>
        <label>
          Apellido
          <input v-model="consultaForm.apellido" placeholder="Opcional">
        </label>
        <p class="hint">Cargá al menos uno. ARCA necesita CUIL; SSS acepta DNI o CUIL.</p>
        <p v-if="consultaForm.modo === 'local'" class="hint">Modo local: el proyecto abre Chrome en esta PC. Resolvé ahí el captcha/reCAPTCHA y la app lee el resultado (espera hasta 3 min).</p>
        <button class="primary" :disabled="loading || (!consultaForm.dni && !consultaForm.cuil)">
          <RefreshCw v-if="loading" :size="17" />
          <Search v-else :size="17" />
          {{ loading ? (consultaForm.modo === 'local' ? 'Abriendo Chrome...' : 'Abriendo...') : 'Verificar cobertura' }}
        </button>
      </form>

      <section class="panel result-panel">
        <div class="panel-title">
          <h2>Resultado</h2>
          <span
            v-if="sssResult"
            :class="['status', sssResult.afiliado === true ? 'consultado' : sssResult.afiliado === false ? 'error' : 'requiere_operador']"
          >{{ sssResult.afiliado === true ? 'Afiliado' : sssResult.afiliado === false ? 'Sin cobertura' : 'Revisar' }}</span>
          <span v-else-if="localResult" :class="['status', localResult.estado]">{{ estadoLabel(localResult.estado) }}</span>
          <span v-else-if="consultaActual" :class="['status', consultaActual.estado]">{{ estadoLabel(consultaActual.estado) }}</span>
        </div>

        <!-- Paso 1: captcha inline -->
        <div v-if="captchaSesion" class="captcha-box">
          <p>Escribi el codigo que ves en la imagen y presiona Consultar.</p>
          <img :src="captchaSesion.captchaImage" alt="captcha" class="captcha-img">
          <div class="form-row">
            <input v-model="captchaCode" placeholder="Codigo del captcha" autocomplete="off" @keyup.enter="resolverCaptcha">
            <button class="primary" type="button" :disabled="loading || !captchaCode" @click="resolverCaptcha">Consultar</button>
          </div>
          <button class="ghost compact" type="button" :disabled="loading" @click="verificar">Otro captcha</button>
        </div>

        <!-- Paso 2: resultado de la consulta con captcha -->
        <template v-else-if="sssResult">
          <p class="decision">{{ sssResult.mensaje }}</p>
          <div class="summary">
            <div><b>Afiliado:</b> {{ sssResult.afiliado === true ? 'Si' : sssResult.afiliado === false ? 'No' : 'Sin determinar' }}</div>
            <div><b>Cobertura / dato:</b> {{ sssResult.obraSocial || '-' }}</div>
            <div><b>Fuente:</b> {{ sssResult.nombre }}</div>
            <div><b>Diagnostico:</b> {{ sssResult.estado }}</div>
          </div>
          <details v-if="sssResult.textoDetectado">
            <summary>Texto detectado</summary>
            <pre>{{ sssResult.textoDetectado }}</pre>
          </details>
        </template>

        <!-- Resultado modo local (Chrome del proyecto) -->
        <template v-else-if="localResult">
          <p class="decision">{{ localResult.resumen }}</p>
          <div class="summary">
            <div><b>Fuente:</b> {{ localResult.nombre }}</div>
            <div><b>Diagnostico:</b> {{ localResult.resultado }}</div>
            <div><b>HTTP:</b> {{ localResult.httpStatus || '-' }}</div>
            <div><b>Titulo:</b> {{ localResult.titulo || '-' }}</div>
          </div>
          <div class="step-meta">
            <a :href="localResult.url" target="_blank" rel="noreferrer"><ExternalLink :size="15" /> Abrir pagina</a>
          </div>
          <details v-if="localResult.textoDetectado">
            <summary>Texto detectado</summary>
            <pre>{{ localResult.textoDetectado }}</pre>
          </details>
        </template>

        <div v-else-if="!consultaActual" class="empty">
          Carga un DNI/CUIL y presiona Verificar cobertura. Si la fuente pide captcha, aparece aca mismo para que lo completes.
        </div>

        <template v-else>
          <div class="summary">
            <div><b>Entrada:</b> {{ consultaActual.entrada }}</div>
            <div><b>DNI:</b> {{ consultaActual.dni || '-' }}</div>
            <div><b>CUIL:</b> {{ consultaActual.cuil || '-' }}</div>
            <div><b>Realizada:</b> {{ fecha(consultaActual.createdAt) }}</div>
            <div><b>Usuario:</b> {{ consultaActual.creadoPorNombre }}</div>
          </div>
          <p class="decision">{{ consultaActual.resumen }}</p>

          <div class="steps">
            <article v-for="paso in consultaActual.pasos" :key="paso.id" class="step">
              <div class="step-head">
                <div>
                  <span class="order">{{ paso.orden }}</span>
                  <b>{{ paso.nombre }}</b>
                </div>
                <span :class="['status', paso.estado]">{{ estadoLabel(paso.estado) }}</span>
              </div>
              <p>{{ paso.resumen }}</p>
              <div class="step-meta">
                <span class="diagnostic">{{ paso.resultado || 'sin_diagnostico' }}</span>
                <span>{{ paso.titulo || 'Sin titulo' }}</span>
                <a :href="paso.url" target="_blank" rel="noreferrer"><ExternalLink :size="15" /> Abrir pagina</a>
              </div>
              <details v-if="paso.textoDetectado">
                <summary>Texto detectado</summary>
                <pre>{{ paso.textoDetectado }}</pre>
              </details>
            </article>
          </div>

          <form class="decision-form" @submit.prevent="guardarDecision">
            <h3>Decision final</h3>
            <div class="form-row">
              <label>
                Resultado
                <select v-model="decisionForm.decisionFinal">
                  <option value="">Pendiente</option>
                  <option value="vigente">Vigente</option>
                  <option value="sin_cobertura">Sin cobertura</option>
                  <option value="baja">Baja</option>
                  <option value="discrepancia">Discrepancia</option>
                  <option value="requiere_revision">Requiere revision</option>
                </select>
              </label>
              <label>
                Cobertura recomendada
                <input v-model="decisionForm.coberturaRecomendada" placeholder="Ej: IOMA, PAMI, OSECAC">
              </label>
            </div>
            <label>
              Observaciones
              <textarea v-model="decisionForm.observaciones" rows="3"></textarea>
            </label>
            <button class="primary" :disabled="loading"><Save :size="17" /> Guardar decision</button>
          </form>
        </template>
      </section>
    </section>

    <section v-if="view === 'historial'" class="panel">
      <div class="panel-title">
        <h2>Historial</h2>
        <button class="ghost" @click="cargarHistorial"><RefreshCw :size="17" /> Actualizar</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Entrada</th>
            <th>DNI</th>
            <th>CUIL</th>
            <th>Estado</th>
            <th>Decision</th>
            <th>Usuario</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in historial" :key="item.id">
            <td>{{ fecha(item.createdAt) }}</td>
            <td>{{ item.entrada }}</td>
            <td>{{ item.dni || '-' }}</td>
            <td>{{ item.cuil || '-' }}</td>
            <td><span :class="['status', item.estado]">{{ estadoLabel(item.estado) }}</span></td>
            <td>{{ item.decisionFinal || '-' }}</td>
            <td>{{ item.creadoPorNombre }}</td>
            <td><button class="ghost compact" @click="abrirConsulta(item.id)">Ver</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="view === 'informe' && isAdmin" class="panel" id="informe-panel">
      <div class="panel-title">
        <h2>Informe general de consultas</h2>
        <div class="informe-acciones no-print">
          <button class="ghost" @click="cargarReporte"><RefreshCw :size="17" /> Actualizar</button>
          <button class="ghost" @click="imprimirReporte"><Printer :size="17" /> Imprimir</button>
          <button class="ghost" @click="descargarExcel"><Download :size="17" /> Descargar Excel</button>
        </div>
      </div>
      <form class="user-create no-print" @submit.prevent="cargarReporte">
        <input v-model="reporteFiltro.usuario" placeholder="Filtrar por usuario">
        <input v-model="reporteFiltro.dni" placeholder="Filtrar por DNI">
        <input v-model="reporteFiltro.cuil" placeholder="Filtrar por CUIL">
        <input v-model="reporteFiltro.desde" type="date" title="Desde">
        <input v-model="reporteFiltro.hasta" type="date" title="Hasta">
        <button class="primary"><Search :size="17" /> Buscar</button>
      </form>
      <p class="print-only informe-meta">Total: {{ reporte.length }} registros. Generado: {{ fecha(new Date()) }}.</p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th v-for="c in columnasReporte" :key="c.key">{{ c.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in reporte" :key="i">
              <td v-for="c in columnasReporte" :key="c.key">
                <span v-if="c.key === 'estado'" :class="['status', r.estado]">{{ c.valor(r) }}</span>
                <template v-else>{{ c.valor(r) || '-' }}</template>
              </td>
            </tr>
            <tr v-if="reporte.length === 0"><td :colspan="columnasReporte.length" class="empty">Sin datos para el filtro.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="view === 'usuarios' && isAdmin" class="panel">
      <div class="panel-title">
        <h2>Usuarios y roles</h2>
        <span>Admin administra; user consulta.</span>
      </div>

      <form class="user-create" @submit.prevent="crearUsuario">
        <input v-model="nuevoUsuario.username" placeholder="Usuario">
        <input v-model="nuevoUsuario.password" type="password" placeholder="Contrasena">
        <select v-model="nuevoUsuario.role">
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button class="primary"><UserPlus :size="17" /> Crear</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Rol</th>
            <th>Activo</th>
            <th>Nueva contrasena</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in usuarios" :key="user.id">
            <td>{{ user.username }}</td>
            <td>
              <select v-model="user.role">
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </td>
            <td><input v-model="user.activo" type="checkbox"></td>
            <td><input v-model="user.newPassword" type="password" placeholder="Sin cambio"></td>
            <td><button class="ghost compact" @click="actualizarUsuario(user)">Guardar</button></td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
