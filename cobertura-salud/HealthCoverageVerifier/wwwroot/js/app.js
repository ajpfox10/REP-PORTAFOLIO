// ═════════════════════════════════════════════════════════════════════════════
//  HealthCoverageVerifier - Frontend SPA
// ═════════════════════════════════════════════════════════════════════════════

const API = '';
let state = { token: null, user: null, consultas: [], usuarios: [], sssSession: null, currentConsulta: null };

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('hcv_auth');
  if (saved) { try { const a = JSON.parse(saved); if (a.token) loginSuccess(a); } catch {} }
  initRouter();
  initDropzone();
  document.getElementById('login-form').addEventListener('submit', onLogin);
  document.getElementById('filter-consultas').addEventListener('input', renderConsultas);
});

// ─── Router ─────────────────────────────────────────────────────────────────
function initRouter() {
  window.addEventListener('hashchange', route);
  route();
}
function route() {
  if (!state.token) return;
  const hash = location.hash.replace('#','') || 'dashboard';
  const viewId = hash.split('/')[0];
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view === viewId));
  const titles = { dashboard:'Dashboard', consultas:'Consultas', sss:'SSS Asistido', captcha:'OCR Captcha', usuarios:'Usuarios', detalle:'Detalle Consulta' };
  document.getElementById('page-title').textContent = titles[viewId] || 'App';

  if (viewId === 'dashboard') loadDashboard();
  if (viewId === 'consultas') loadConsultas();
  if (viewId === 'usuarios' && state.user?.role === 'admin') loadUsuarios();
  if (viewId === 'detalle') {
    const id = hash.split('/')[1];
    if (id) loadDetalle(id);
  }
}
function navigate(view) { location.hash = view; }

// ─── Auth ───────────────────────────────────────────────────────────────────
async function onLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Ingresando...';
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    const res = await fetch(API + '/api/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: document.getElementById('login-user').value, password: document.getElementById('login-pass').value })
    });
    if (!res.ok) throw new Error('Credenciales inválidas');
    const data = await res.json();
    loginSuccess(data);
  } catch (ex) {
    err.textContent = ex.message; err.classList.remove('hidden');
  } finally { btn.disabled = false; btn.textContent = 'Ingresar'; }
}
function loginSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('hcv_auth', JSON.stringify({ token: data.token, user: data.user }));
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');
  document.getElementById('user-name').textContent = data.user.username;
  document.getElementById('user-role').textContent = data.user.role;
  if (data.user.role === 'admin') {
    document.getElementById('nav-usuarios').classList.remove('hidden');
  }
  fetch('/api/health').then(r=>r.json()).then(h=>{
    document.getElementById('env-badge').textContent = h.env;
  }).catch(()=>{});
  route();
}
function logout() {
  state = { token:null, user:null, consultas:[], usuarios:[], sssSession:null, currentConsulta:null };
  localStorage.removeItem('hcv_auth');
  document.getElementById('app-layout').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  location.hash = '';
}
async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (state.token) opts.headers['Authorization'] = 'Bearer ' + state.token;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(API + path, opts);
  if (res.status === 401) { logout(); throw new Error('Sesión expirada'); }
  if (!res.ok) {
    let msg = 'Error ' + res.status;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type');
  return ct && ct.includes('application/json') ? res.json() : res.text();
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const data = await api('/api/consultas');
    const rows = data.data || [];
    state.consultas = rows;
    const st = { total: rows.length, completa:0, en_revision:0, error:0 };
    rows.forEach(r => { if (st[r.estado] !== undefined) st[r.estado]++; });
    document.getElementById('dash-total').textContent = st.total;
    document.getElementById('dash-completas').textContent = st.completa;
    document.getElementById('dash-revision').textContent = st.en_revision;
    document.getElementById('dash-error').textContent = st.error;
    const tbody = document.getElementById('dash-consultas');
    tbody.innerHTML = rows.slice(0,6).map(r => `<tr>
      <td>#${r.id}</td><td>${esc(r.entrada)}</td>
      <td>${badge(r.estado)}</td>
      <td>${fmtDate(r.createdAt)}</td>
    </tr>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// ─── Consultas ──────────────────────────────────────────────────────────────
async function loadConsultas() {
  try {
    const data = await api('/api/consultas');
    state.consultas = data.data || [];
    renderConsultas();
  } catch (e) { toast(e.message, 'error'); }
}
function renderConsultas() {
  const q = document.getElementById('filter-consultas').value.toLowerCase();
  const rows = state.consultas.filter(r =>
    (r.entrada||'').toLowerCase().includes(q) ||
    (r.dni||'').toLowerCase().includes(q) ||
    (r.cuil||'').toLowerCase().includes(q) ||
    (r.apellido||'').toLowerCase().includes(q)
  );
  const tbody = document.getElementById('lista-consultas');
  tbody.innerHTML = rows.map(r => `<tr>
    <td>#${r.id}</td>
    <td>${esc(r.entrada)}</td>
    <td>${esc(r.dni||'—')}</td>
    <td>${esc(r.cuil||'—')}</td>
    <td>${esc(r.apellido||'—')}</td>
    <td>${badge(r.estado)}</td>
    <td>${esc(r.decisionFinal||'—')}</td>
    <td>${fmtDate(r.createdAt)}</td>
    <td><button class="btn btn-sm btn-primary" onclick="navigate('detalle/${r.id}')">Ver</button></td>
  </tr>`).join('');
}
async function crearConsulta(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    entrada: fd.get('entrada'),
    apellido: fd.get('apellido') || null,
    fechaPrestacion: fd.get('fechaPrestacion') || null
  };
  hideModal('modal-nueva-consulta');
  try {
    const res = await api('/api/consultas', { method:'POST', body });
    toast('Consulta creada', 'success');
    navigate('detalle/' + res.id);
  } catch (ex) { toast(ex.message, 'error'); }
}

// ─── Detalle ────────────────────────────────────────────────────────────────
async function loadDetalle(id) {
  try {
    const c = await api('/api/consultas/' + id);
    state.currentConsulta = c;
    const p = c.pasos || [];
    document.getElementById('detalle-paciente').innerHTML = `
      <div class="info-row"><span class="info-label">Entrada</span><span class="info-value">${esc(c.entrada)}</span></div>
      <div class="info-row"><span class="info-label">DNI</span><span class="info-value">${esc(c.dni||'—')}</span></div>
      <div class="info-row"><span class="info-label">CUIL</span><span class="info-value">${esc(c.cuil||'—')}</span></div>
      <div class="info-row"><span class="info-label">Apellido</span><span class="info-value">${esc(c.apellido||'—')}</span></div>
      <div class="info-row"><span class="info-label">Fecha Prestación</span><span class="info-value">${c.fechaPrestacion || '—'}</span></div>
      <div class="info-row"><span class="info-label">Estado</span><span class="info-value">${badge(c.estado)}</span></div>
    `;
    document.getElementById('detalle-resumen').textContent = c.resumen || 'Sin resumen';
    document.getElementById('detalle-decision-box').classList.toggle('hidden', c.estado === 'completa');

    document.getElementById('detalle-pasos').innerHTML = p.map(paso => {
      let cls = 'info';
      if (paso.estado === 'consultado') cls = 'ok';
      if (paso.estado === 'requiere_operador') cls = 'warn';
      if (paso.estado === 'error') cls = 'err';
      const icon = paso.estado==='consultado'?'✅':paso.estado==='error'?'❌':paso.estado==='requiere_operador'?'⚠️':'🔄';
      return `<div class="timeline-item ${cls}">
        <div class="timeline-badge">${icon}</div>
        <div class="timeline-body">
          <div class="timeline-title">${paso.orden}. ${esc(paso.nombre)} <span style="color:#888;font-size:.75rem">(${esc(paso.codigo)})</span></div>
          <div class="timeline-meta">HTTP ${paso.httpStatus||'-'} · ${esc(paso.estado)} · ${esc(paso.resultado||'-')}</div>
          ${paso.resumen ? `<div class="timeline-text">${esc(paso.resumen)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}
async function cerrarDecision(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    decisionFinal: fd.get('decisionFinal') || null,
    coberturaRecomendada: fd.get('coberturaRecomendada') || null,
    observaciones: fd.get('observaciones') || null
  };
  hideModal('modal-decision');
  try {
    await api(`/api/consultas/${state.currentConsulta.id}/decision`, { method:'PATCH', body });
    toast('Decisión guardada', 'success');
    loadDetalle(state.currentConsulta.id);
  } catch (ex) { toast(ex.message, 'error'); }
}

// ─── SSS Asistido ───────────────────────────────────────────────────────────
async function sssIniciar() {
  const entrada = document.getElementById('sss-entrada').value.trim();
  if (!entrada) return toast('Ingresá DNI o CUIL', 'warning');
  const btn = document.querySelector('#sss-step1 button');
  btn.disabled = true; btn.textContent = 'Abriendo...';
  try {
    const res = await api('/api/sss/iniciar', { method:'POST', body: { entrada, apellido: document.getElementById('sss-apellido').value.trim() || null } });
    state.sssSession = res;
    document.getElementById('sss-captcha-img').src = res.captchaImage;
    document.getElementById('sss-step1').classList.add('hidden');
    document.getElementById('sss-step2').classList.remove('hidden');
    document.getElementById('sss-result').classList.add('hidden');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Abrir Sesión SSS'; }
}
async function sssResolver() {
  const code = document.getElementById('sss-code').value.trim();
  if (!code) return toast('Ingresá el código del captcha', 'warning');
  const btn = document.querySelector('#sss-step2 button.btn-primary');
  btn.disabled = true; btn.textContent = 'Consultando...';
  try {
    const res = await api('/api/sss/resolver', { method:'POST', body: { sessionId: state.sssSession.sessionId, code } });
    const box = document.getElementById('sss-result');
    box.classList.remove('hidden');
    const color = res.estado==='afiliado'?'success':res.estado==='sin_cobertura'?'danger':'warning';
    box.innerHTML = `<div class="alert alert-${color}">
      <strong>${esc(res.estado.toUpperCase())}</strong><br>${esc(res.mensaje)}
      ${res.obraSocial ? `<br><strong>Obra Social:</strong> ${esc(res.obraSocial)}` : ''}
    </div>`;
    if (res.estado !== 'captcha_incorrecto') {
      document.getElementById('sss-step2').classList.add('hidden');
    }
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Resolver y Consultar'; }
}
function sssReset() {
  state.sssSession = null;
  document.getElementById('sss-step1').classList.remove('hidden');
  document.getElementById('sss-step2').classList.add('hidden');
  document.getElementById('sss-result').classList.add('hidden');
  document.getElementById('sss-code').value = '';
}

// ─── OCR Captcha ────────────────────────────────────────────────────────────
function initDropzone() {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('captcha-file');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleCaptchaFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => { if (e.target.files.length) handleCaptchaFile(e.target.files[0]); });
}
function handleCaptchaFile(file) {
  state.captchaFile = file;
  const preview = document.getElementById('captcha-preview');
  preview.src = URL.createObjectURL(file);
  document.getElementById('captcha-preview-box').classList.remove('hidden');
  document.getElementById('btn-solve-captcha').disabled = false;
}
async function solveCaptcha() {
  if (!state.captchaFile) return;
  const btn = document.getElementById('btn-solve-captcha');
  btn.disabled = true; btn.textContent = 'Procesando...';
  try {
    const fd = new FormData();
    fd.append('image', state.captchaFile);
    const res = await api('/api/captcha/solve', { method:'POST', body: fd });
    const box = document.getElementById('captcha-result');
    box.classList.remove('hidden');
    const color = res.success ? 'success' : 'warning';
    box.innerHTML = `<div class="alert alert-${color}">
      <strong>${res.success ? '✅ Resuelto' : '❌ No resuelto'}</strong><br>
      Texto: <code>${esc(res.text || '—')}</code><br>
      Confianza: ${(res.confidence*100).toFixed(1)}% · Método: ${esc(res.method)}<br>
      Tiempo: ${res.processingTimeMs}ms
      ${res.suggestion ? `<br><em>${esc(res.suggestion)}</em>` : ''}
    </div>`;
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Procesar OCR'; }
}

// ─── Usuarios ───────────────────────────────────────────────────────────────
async function loadUsuarios() {
  try {
    const data = await api('/api/usuarios');
    state.usuarios = data.data || [];
    const tbody = document.getElementById('lista-usuarios');
    tbody.innerHTML = state.usuarios.map(u => `<tr>
      <td>${u.id}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td>
      <td>${u.activo ? '✅' : '❌'}</td><td>${fmtDate(u.createdAt)}</td>
      <td><button class="btn btn-sm btn-danger" onclick="toggleUsuario(${u.id}, ${!u.activo})">${u.activo ? 'Desactivar' : 'Activar'}</button></td>
    </tr>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}
async function crearUsuario(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  hideModal('modal-nuevo-usuario');
  try {
    await api('/api/usuarios', { method:'POST', body: {
      username: fd.get('username'),
      password: fd.get('password'),
      role: fd.get('role')
    }});
    toast('Usuario creado', 'success');
    loadUsuarios();
  } catch (ex) { toast(ex.message, 'error'); }
}
async function toggleUsuario(id, activo) {
  try {
    await api(`/api/usuarios/${id}`, { method:'PATCH', body: { activo } });
    toast('Usuario actualizado', 'success');
    loadUsuarios();
  } catch (e) { toast(e.message, 'error'); }
}

// ─── UI Helpers ─────────────────────────────────────────────────────────────
function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function esc(s) { return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function badge(status) {
  const map = { completa:'status-completa', en_revision:'status-en_revision', pendiente:'status-pendiente', error:'status-error' };
  return `<span class="status-badge ${map[status]||'status-pendiente'}">${esc(status)}</span>`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
}
function toast(msg, type='info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(), 300); }, 4000);
}
