import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
// xlsx-js-style: misma API que xlsx pero guarda estilos (texto ajustado, bordes)
import * as XLSX from 'xlsx-js-style';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarX,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Download,
  ExternalLink,
  FileSearch,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  LayoutDashboard,
  Link2,
  Lock,
  PackageSearch,
  LogOut,
  Play,
  Printer,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Sigma,
  Tag,
  Upload,
  Users,
  Warehouse
} from 'lucide-react';
import { AyudaPagina } from './ayudas.jsx';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4310/api';
const ROLES = ['admin', 'operador', 'lector'];

function apiClient(token) {
  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !path.includes('/auth/login')) {
      // Sesion vencida o invalida: limpiar y volver al login en vez de dejar todo vacio
      localStorage.removeItem('stock_session');
      window.location.reload();
      throw new Error('Sesion vencida. Volve a iniciar sesion.');
    }
    if (!response.ok) throw Object.assign(new Error(data.error || 'Error de API'), { status: response.status, data });
    return data;
  }
  return {
    // PDF de la O.C. con el renglon marcado: { blob, pagina }
    ocPdf: async (ordenId, renglon, codigo) => {
      const qs = renglon != null ? `?${new URLSearchParams({ renglon, codigo: codigo || '' })}` : '';
      const response = await fetch(`${API_BASE}/ordenes-compra/${ordenId}/pdf${qs}`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo abrir el PDF');
      return { blob: await response.blob(), pagina: Number(response.headers.get('X-Pagina')) || null };
    },
    login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    usuarios: () => request('/usuarios'),
    crearUsuario: (payload) => request('/usuarios', { method: 'POST', body: JSON.stringify(payload) }),
    actualizarUsuario: (id, payload) => request(`/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    criticoSource: () => request('/critico-source'),
    importarCriticoFuente: (fileName) => request('/importaciones/desde-critico', {
      method: 'POST',
      body: JSON.stringify({ fileName })
    }),
    stockSource: () => request('/stock-source'),
    etiquetasFarmacos: () => request('/etiquetas/farmacos'),
    guardarRotulo: (payload) => request('/rotulos/impresion', { method: 'POST', body: JSON.stringify(payload) }),
    rotulosImpresiones: () => request('/rotulos/impresiones'),
    vencidos: (descargaId) => request(`/vencidos${descargaId ? `?descargaId=${descargaId}` : ''}`),
    descargarVencidos: (meses) => request('/vencidos/descargar', { method: 'POST', body: JSON.stringify({ meses }) }),
    ocPendientesMs: () => request('/ordenes-compra/ms-pendientes'),
    consultarPendientesMs: (payload) => request('/ordenes-compra/ms-pendientes', { method: 'POST', body: JSON.stringify(payload) }),
    cambiarCarpetaVencidos: (ruta) => request('/vencidos/carpeta', { method: 'PUT', body: JSON.stringify({ ruta }) }),
    bajasMs: () => request('/bajas-ms'),
    vincularConsumo: (codigo, destino) => request('/consumo-vinculos', { method: 'PUT', body: JSON.stringify({ codigo, destino }) }),
    consumoMs: () => request('/consumo-ms'),
    descargarConsumoMs: (anios) => request('/consumo-ms/descargar', { method: 'POST', body: JSON.stringify({ anios }) }),
    cambiarCarpetaConsumoMs: (ruta) => request('/consumo-ms/carpeta', { method: 'PUT', body: JSON.stringify({ ruta }) }),
    stockActual: (descargaId) => request(`/stock-actual${descargaId ? `?descargaId=${descargaId}` : ''}`),
    descargarStockActual: () => request('/stock-actual/descargar', { method: 'POST', body: '{}' }),
    stockRepetidos: () => request('/stock-actual/repetidos'),
    cambiarCarpetaStockActual: (ruta) => request('/stock-actual/carpeta', { method: 'PUT', body: JSON.stringify({ ruta }) }),
    requerimientosSource: () => request('/requerimientos/source'),
    sincronizarRequerimientos: () => request('/requerimientos/sincronizar', { method: 'POST', body: '{}' }),
    cambiarCarpetaRequerimientos: (ruta) => request('/requerimientos/carpeta', { method: 'PUT', body: JSON.stringify({ ruta }) }),
    requerimientosAnalisis: () => request('/requerimientos/analisis'),
    eliminarRequerimiento: (id) => request(`/requerimientos/${id}`, { method: 'DELETE' }),
    reqManualCatalogo: () => request('/requerimientos/manual/catalogo'),
    reqManual: (anio) => request(`/requerimientos/manual?anio=${anio}`),
    reqManualGuardar: (payload) => request('/requerimientos/manual', { method: 'POST', body: JSON.stringify(payload) }),
    reqManualEliminar: (id) => request(`/requerimientos/manual/${id}`, { method: 'DELETE' }),
    reqManualControlado: (id, controlado) => request(`/requerimientos/manual/${id}/controlado`, { method: 'PUT', body: JSON.stringify({ controlado }) }),
    reqManualCopiar: (payload) => request('/requerimientos/manual/copiar', { method: 'POST', body: JSON.stringify(payload) }),
    reqColumnas: (codigos) => request('/requerimientos/columnas', { method: 'POST', body: JSON.stringify({ codigos }) }),
    reqAjustes: (ciclo) => request(`/requerimientos/ajustes?ciclo=${encodeURIComponent(ciclo || '')}`),
    reqAjustesHistorial: (ciclo) => request(`/requerimientos/ajustes/historial?ciclo=${encodeURIComponent(ciclo || '')}`),
    reqAjusteGuardar: (body) => request('/requerimientos/ajustes', { method: 'POST', body: JSON.stringify(body) }),
    reqAjusteVolver: (body) => request('/requerimientos/ajustes/volver', { method: 'POST', body: JSON.stringify(body) }),
    reqManualColumnas: (anio, semestre) => request(`/requerimientos/manual/columnas?anio=${anio}&semestre=${semestre}`),
    reqManualComparacion: (anio, semestre) => request(`/requerimientos/manual/comparacion?anio=${anio}&semestre=${semestre}`),
    equivSugerencias: (anio, semestre) => request(`/codigos-equiv/sugerencias?anio=${anio}&semestre=${semestre}`),
    equivHuellas: (codigos) => request('/codigos-equiv/huellas', { method: 'POST', body: JSON.stringify({ codigos }) }),
    equivHistorial: () => request('/codigos-equiv'),
    equivUnificar: (payload) => request('/codigos-equiv/unificar', { method: 'POST', body: JSON.stringify(payload) }),
    equivDescartar: (payload) => request('/codigos-equiv/descartar', { method: 'POST', body: JSON.stringify(payload) }),
    equivDeshacer: (id) => request(`/codigos-equiv/${id}`, { method: 'DELETE' }),
    equivComparar: (codigo, con) => request('/codigos-equiv/comparar', { method: 'POST', body: JSON.stringify({ codigo, con }) }),
    equivAuditoria: () => request('/codigos-equiv/auditoria'),
    trimestreSource: () => request('/trimestre/source'),
    trimestreDesdeConsumo: () => request('/trimestre/desde-consumo', { method: 'POST', body: '{}' }),
    importarTrimestre: (fileName) => request('/trimestre/importar', { method: 'POST', body: JSON.stringify({ fileName }) }),
    trimestreImportaciones: () => request('/trimestre/importaciones'),
    trimestreItems: (params) => request(`/trimestre/items?${new URLSearchParams(params).toString()}`),
    editarTrimestreItem: (id, payload) => request(`/trimestre/items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    editarTrimestreCodigo: (codigo, payload) => request('/trimestre/items-codigo', { method: 'PATCH', body: JSON.stringify({ codigo, ...payload }) }),
    generarSugeridos: () => request('/sugeridos/generar', { method: 'POST', body: '{}' }),
    sugeridos: (params) => request(`/sugeridos?${new URLSearchParams(params).toString()}`),
    editarSugerido: (id, payload) => request(`/sugeridos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    aplicarSugeridos: () => request('/sugeridos/aplicar', { method: 'POST', body: '{}' }),
    stockCriticoActual: () => request('/stock-critico/actual'),
    trimestreComparacion: () => request('/trimestre/comparacion'),
    aplicarTrimestreStock: (trimestreImportacionId, stockImportacionId) => request('/trimestre/aplicar-stock', {
      method: 'POST',
      body: JSON.stringify({ trimestreImportacionId, stockImportacionId })
    }),
    consumoAnios: () => request('/consumos/anios'),
    consumoComparacion: (anios) => request(`/consumos/comparacion${anios && anios.length ? `?anios=${anios.join(',')}` : ''}`),
    consumos: () => request('/consumos'),
    consumoItems: (id, params) => request(`/consumos/${id}/items?${new URLSearchParams(params).toString()}`),
    consumoCruce: (id, params) => request(`/consumos/${id}/cruce?${new URLSearchParams(params).toString()}`),
    aplicarConsumo: (id, importacionId) => request(`/consumos/${id}/aplicar`, {
      method: 'POST',
      body: JSON.stringify({ importacionId })
    }),
    importarConsumoFuente: (payload) => request('/consumos/desde-stock', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    importarConsumo: (file, periodo = 'auto') => {
      const body = new FormData();
      body.append('archivo', file);
      body.append('periodo', periodo);
      return request('/consumos', { method: 'POST', body });
    },
    importaciones: () => request('/importaciones'),
    resumen: (id) => request(`/importaciones/${id}/resumen`),
    items: (params) => request(`/items?${new URLSearchParams(params).toString()}`),
    scriptRuns: (params) => request(`/script/runs?${new URLSearchParams(params).toString()}`),
    ejecutarScript: (importacionId) => request('/script/ejecutar', {
      method: 'POST',
      body: JSON.stringify({ importacionId })
    }),
    importar: (file) => {
      const body = new FormData();
      body.append('archivo', file);
      return request('/importaciones', { method: 'POST', body });
    },
    guardarValores: (id, payload) => request(`/items/${id}/valores`, { method: 'PUT', body: JSON.stringify(payload) }),
    ocConfig: () => request('/ordenes-compra/config'),
    ocCarpetas: (ruta) => request(`/ordenes-compra/carpetas?${new URLSearchParams({ ruta: ruta || '' }).toString()}`),
    ocOrdenes: () => request('/ordenes-compra'),
    ocCruceStock: () => request('/ordenes-compra/cruce-stock'),
    ocHistorial: () => request('/oc-historial'),
    ministerioComunicaciones: () => request('/ministerio/comunicaciones'),
    ministerioItems: (id) => request(`/ministerio/comunicaciones/${id}/items`),
    eliminarComunicacionMinisterio: (id) => request(`/ministerio/comunicaciones/${id}`, { method: 'DELETE' }),
    subirComunicacionMinisterio: (file) => {
      const body = new FormData();
      body.append('archivo', file);
      return request('/ministerio/comunicaciones', { method: 'POST', body });
    },
    importarOcHistorial: () => request('/oc-historial/importar', { method: 'POST', body: '{}' }),
    vincularOcHistorial: (codigo, descripcion, destino) => request('/oc-historial/vinculo', { method: 'PUT', body: JSON.stringify({ codigo, descripcion, destino }) }),
    ocDrive: () => request('/ordenes-compra/drive'),
    ocDriveSincronizar: () => request('/ordenes-compra/drive/sincronizar', { method: 'POST', body: '{}' }),
    ocDriveArchivos: () => request('/ordenes-compra/drive/archivos'),
    ocDriveInspeccionar: (archivo) => request('/ordenes-compra/drive/inspeccionar', { method: 'POST', body: JSON.stringify({ archivo }) }),
    ocDriveProbar: (destino) => request('/ordenes-compra/drive/probar', { method: 'POST', body: JSON.stringify(destino) }),
    ocDriveGuardar: (destino) => request('/ordenes-compra/drive/destino', { method: 'PUT', body: JSON.stringify(destino) }),
    ocDrivePausa: (activo) => request('/ordenes-compra/drive/pausa', { method: 'POST', body: JSON.stringify({ activo }) }),
    ocDriveRestaurar: () => request('/ordenes-compra/drive/restaurar', { method: 'POST', body: '{}' }),
    ocSubir: (files) => {
      const body = new FormData();
      for (const file of files) body.append('archivos', file);
      return request('/ordenes-compra/subir', { method: 'POST', body });
    },
    ocImportarCarpeta: (carpetaPdf) => request('/ordenes-compra/importar-carpeta', { method: 'POST', body: JSON.stringify({ carpetaPdf }) }),
    ocEditarRenglon: (id, payload) => request(`/ordenes-compra/renglones/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    ocAgregarEntrega: (renglonId, payload) => request(`/ordenes-compra/renglones/${renglonId}/entregas`, { method: 'POST', body: JSON.stringify(payload) }),
    ocEliminarEntrega: (entregaId) => request(`/ordenes-compra/entregas/${entregaId}`, { method: 'DELETE' }),
    ocEliminar: (id) => request(`/ordenes-compra/${id}`, { method: 'DELETE' }),
    ocExcelServidor: (payload) => request('/ordenes-compra/excel', { method: 'POST', body: JSON.stringify({ ...payload, destino: 'servidor' }) }),
    ocExcelPc: async (nombre) => {
      const response = await fetch(`${API_BASE}/ordenes-compra/excel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ destino: 'pc', nombre })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar el Excel');
      }
      return response.blob();
    }
  };
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiClient().login(username, password);
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark"><Lock size={26} /></div>
        <h1>Sistema de Farmacia</h1>
        <p>Acceso seguro para Farmacia</p>
        <label>
          Usuario
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Contrasena
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error ? <div className="alert">{error}</div> : null}
        <button className="primary" disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button>
      </form>
    </main>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    const raw = localStorage.getItem('stock_session');
    return raw ? JSON.parse(raw) : null;
  });
  const [view, setView] = useState('dashboard');

  function onLogin(data) {
    localStorage.setItem('stock_session', JSON.stringify(data));
    setSession(data);
    setView('dashboard');
  }

  function logout() {
    localStorage.removeItem('stock_session');
    setSession(null);
    setView('dashboard');
  }

  if (!session) return <Login onLogin={onLogin} />;

  const isAdmin = session.user.role === 'admin';
  const canRotulos = isAdmin || session.user.role === 'operador';
  const allowedView = view === 'dashboard'
    || (view === 'stock' && isAdmin)
    || (view === 'consumo' && isAdmin)
    || (view === 'comparar' && isAdmin)
    || (view === 'trimestral' && isAdmin)
    || (view === 'requerimiento' && isAdmin)
    || (view === 'carga2025' && isAdmin)
    || (view === 'ministerio' && isAdmin)
    || (view === 'pendientesms' && isAdmin)
    || (view === 'stockactual' && isAdmin)
    || (view === 'consumoms' && isAdmin)
    || (view === 'vencidos' && isAdmin)
    || (view === 'sugeridos' && isAdmin)
    || (view === 'rotulos' && canRotulos)
    || (view === 'ordenes' && isAdmin)
    || (view === 'usuarios' && isAdmin);
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Portal Farmacia</h1>
          <p>{session.user.username} - {session.user.role}</p>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => setView('dashboard')}><LayoutDashboard size={18} /> Inicio</button>
          <button className="ghost" onClick={logout}><LogOut size={18} /> Salir</button>
        </div>
      </header>

      {view === 'dashboard' ? <Dashboard user={session.user} token={session.token} onOpen={setView} /> : null}
      {view === 'stock' && isAdmin ? <StockPage token={session.token} /> : null}
      {view === 'consumo' && isAdmin ? <ConsumoPage token={session.token} /> : null}
      {view === 'comparar' && isAdmin ? <ComparacionPage token={session.token} /> : null}
      {view === 'trimestral' && isAdmin ? <TrimestralPage token={session.token} /> : null}
      {view === 'requerimiento' && isAdmin ? <RequerimientoAnualPage token={session.token} /> : null}
      {view === 'carga2025' && isAdmin ? <CargaRequerimientoManualPage token={session.token} anio={2026} /> : null}
      {view === 'ministerio' && isAdmin ? <RequerimientoAnualPage token={session.token} soloMinisterio /> : null}
      {view === 'stockactual' && isAdmin ? <StockActualPage token={session.token} /> : null}
      {view === 'consumoms' && isAdmin ? <ConsumoMsPage token={session.token} /> : null}
      {view === 'vencidos' && isAdmin ? <VencidosPage token={session.token} /> : null}
      {view === 'pendientesms' && isAdmin ? <PendientesMsPage token={session.token} /> : null}
      {view === 'sugeridos' && isAdmin ? <SugeridosPage token={session.token} /> : null}
      {view === 'rotulos' && canRotulos ? <RotulosPage token={session.token} /> : null}
      {view === 'ordenes' && isAdmin ? <OrdenesCompraPage token={session.token} /> : null}
      {view === 'usuarios' && isAdmin ? <UsersPage token={session.token} currentUserId={session.user.id} /> : null}
      {!allowedView ? <AccessDenied /> : null}
    </main>
  );
}

// Card de farmacos repetidos del ultimo Stock Actual, en el inicio (solo admin)
function DashboardRepetidos({ token, onOpen }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [data, setData] = useState(null);
  useEffect(() => {
    client.stockRepetidos().then(setData).catch((err) => setData({ error: err.message }));
  }, [client]);
  if (!data) return null;
  if (data.error) return <div className="alert" style={{ marginTop: 12 }}>No se pudieron leer los fármacos repetidos: {data.error}</div>;
  return (
    <RepetidosCard
      repetidos={data.repetidos}
      fechaStock={data.fechaStock}
      inicialAbierta={false}
      onBuscar={() => onOpen('stockactual')}
    />
  );
}

function Dashboard({ user, token, onOpen }) {
  const modules = [
    {
      id: 'stock',
      title: 'Carga Stock Critico',
      body: 'Importar reportes, completar valores y ejecutar el script.',
      roles: ['admin'],
      icon: FileSpreadsheet
    },
    {
      id: 'trimestral',
      title: 'Análisis Trimestral',
      body: 'Consumos por trimestre (carga automática desde la carpeta): mínimo bimestral / máximo semestral y comparación.',
      roles: ['admin'],
      icon: CalendarRange
    },
    {
      id: 'ministerio',
      title: 'Habilitación Ministerio',
      body: 'Subir el PDF de comunicación de compra del Ministerio y ver qué se pidió y el Ministerio dijo NO, qué es por 3 meses y qué está habilitado.',
      roles: ['admin'],
      icon: ShieldCheck
    },
    {
      id: 'stockactual',
      title: 'Stock Actual (Farmacia MS)',
      body: 'Robot que entra a Farmacia MS y baja la Consulta de Stock en Excel por sector, y la guarda en tabla.',
      roles: ['admin'],
      icon: Warehouse
    },
    {
      id: 'consumoms',
      title: 'Consumo Mensual (Farmacia MS)',
      body: 'Robot que entra a Farmacia MS y baja el Consumo Comparativo mensual en Excel por sector y año, y lo guarda en tabla para comparar años.',
      roles: ['admin'],
      icon: CalendarDays
    },
    {
      id: 'vencidos',
      title: 'Vencimientos (Farmacia MS)',
      body: 'Robot que entra a Farmacia MS y baja los artículos vencidos y próximos a vencer (Excel por sector), con semáforo por lote.',
      roles: ['admin'],
      icon: CalendarX
    },
    {
      id: 'pendientesms',
      title: 'Pendientes de Ingreso (Farmacia MS)',
      body: 'Robot que entra a Farmacia MS y, por N° de O.C., trae los artículos pendientes de ingresar (adjudicado, ingresado y faltante por renglón). Se ve también en Órdenes de Compra.',
      roles: ['admin'],
      icon: PackageSearch
    },
    {
      id: 'requerimiento',
      title: 'Análisis de Requerimiento Anual',
      body: 'Lee los PDF de requerimiento (D:\\FARMACIA\\REQUERIMIENTO) y los agrupa por droga y código: cantidades, repetidos y justiprecios.',
      roles: ['admin'],
      icon: FileSearch
    },
    {
      id: 'carga2025',
      title: 'Carga Requerimiento 2026',
      body: 'Carga a mano del requerimiento 2026 por semestre (no hay PDF): elegís semestre, droga y cantidad.',
      roles: ['admin'],
      icon: ClipboardList
    },
    {
      id: 'sugeridos',
      title: 'Stock Sugeridos',
      body: 'Borrador editable de mín/máx por código (del último trimestre). Revisás, ajustás y aplicás a stock crítico.',
      roles: ['admin'],
      icon: Sigma
    },
    {
      id: 'rotulos',
      title: 'Rotulos',
      body: 'Cargar lote, vencimiento, farmaco y laboratorio, e imprimir la hoja completa de rotulos.',
      roles: ['admin', 'operador'],
      icon: Tag
    },
    {
      id: 'ordenes',
      title: 'Órdenes de Compra',
      body: 'Leer los PDF de O.C. de una carpeta (sin duplicados) y armar el Excel de control de entregas.',
      roles: ['admin'],
      icon: ClipboardList
    },
    {
      id: 'usuarios',
      title: 'Usuarios y permisos',
      body: 'Alta de usuarios y asignacion de roles.',
      roles: ['admin'],
      icon: Users
    }
  ];
  const visible = modules.filter((mod) => mod.roles.includes(user.role));

  return (
    <section className="dashboard">
      <div className="dashboard-head">
        <Shield size={22} />
        <div>
          <h2>Dashboard</h2>
          <p>Modulos habilitados para nivel {user.role}</p>
        </div>
      </div>
      <AyudaPagina id="dashboard" />
      {user.role === 'admin' && token ? <DashboardRepetidos token={token} onOpen={onOpen} /> : null}
      <div className="module-grid">
        {visible.map((mod) => {
          const Icon = mod.icon;
          return (
            <button className="module-card" key={mod.id} onClick={() => onOpen(mod.id)}>
              <Icon size={28} />
              <strong>{mod.title}</strong>
              <span>{mod.body}</span>
            </button>
          );
        })}
        {!visible.length ? (
          <div className="access-panel">
            <Lock size={24} />
            <strong>Sin modulos habilitados</strong>
            <span>Solicitar permiso admin para acceder a Carga Stock Critico.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function cellValue(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  // Numero con formato argentino (1.000 / 1.234,5 / 0,25) -> numero real
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(value) || /^-?\d+,\d+$/.test(value)) {
    const number = Number(value.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(number)) return number;
  }
  // Numero puro con decimal opcional -> numero real (salvo codigos con cero inicial)
  if (/^-?\d+(\.\d+)?$/.test(value) && !/^-?0\d/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// La libreria no escribe la configuracion de impresion: se agrega en el XML del .xlsx.
// Hoja Legal apaisada, todas las columnas en 1 pagina de ancho (alto libre),
// fila de encabezado repetida en cada hoja impresa y "Página X de Y" al pie.
function configurarImpresion(data, nombresHojas) {
  const cfb = XLSX.CFB.read(new Uint8Array(data), { type: 'array' });
  const buscar = (p) => cfb.FileIndex[cfb.FullPaths.findIndex((x) => x.endsWith(`/${p}`))];
  const leer = (e) => new TextDecoder().decode(new Uint8Array(e.content));
  const escribir = (e, txt) => { e.content = new TextEncoder().encode(txt); e.size = e.content.length; };
  nombresHojas.forEach((_n, i) => {
    const e = buscar(`xl/worksheets/sheet${i + 1}.xml`);
    if (!e) return;
    let x = leer(e);
    const fit = '<pageSetUpPr fitToPage="1"/>';
    if (/<sheetPr\b[^>]*\/>/.test(x)) x = x.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1>${fit}</sheetPr>`);
    else if (/<sheetPr\b[^>]*>/.test(x)) x = x.replace(/<sheetPr\b[^>]*>/, (m) => `${m}${fit}`);
    else x = x.replace(/<worksheet\b[^>]*>/, (m) => `${m}<sheetPr>${fit}</sheetPr>`);
    const setup = '<pageSetup paperSize="5" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
      + '<headerFooter><oddFooter>&amp;CPágina &amp;P de &amp;N</oddFooter></headerFooter>';
    x = /<pageMargins\b[^>]*\/>/.test(x)
      ? x.replace(/<pageMargins\b[^>]*\/>/, (m) => `${m}${setup}`)
      : x.replace(/(<ignoredErrors|<\/worksheet>)/, `${setup}$1`);
    escribir(e, x);
  });
  const w = buscar('xl/workbook.xml');
  if (w) {
    const titulos = nombresHojas.map((n, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${escXml(`'${n.replace(/'/g, "''")}'!$1:$1`)}</definedName>`).join('');
    let x = leer(w);
    x = x.includes('<definedNames>') ? x.replace('<definedNames>', `<definedNames>${titulos}`) : x.replace('</sheets>', `</sheets><definedNames>${titulos}</definedNames>`);
    escribir(w, x);
  }
  return XLSX.CFB.write(cfb, { fileType: 'zip', type: 'array' });
}

function descargarLibro(wb, filename) {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre];
    // Las hojas que no pasaron por formatearHoja se ajustan aca (anchos, texto partido, bordes)
    if (!ws['!rows']) formatearHoja(ws, XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }));
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 };
  }
  let data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  try {
    data = configurarImpresion(data, wb.SheetNames);
  } catch (err) {
    console.warn('No se pudo agregar la configuracion de impresion', err);
  }
  const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${fecha}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Anchos de columna ajustados al contenido, texto ajustado (varias lineas), bordes y alto de fila
// segun las lineas que ocupa cada celda: queda legible al abrir sin tener que acomodar nada.
function formatearHoja(ws, aoa) {
  if (!aoa.length) return;
  const nCols = Math.max(...aoa.map((r) => r.length));
  const largo = (v) => String(v ?? '').length;
  const anchos = [];
  for (let c = 0; c < nCols; c += 1) {
    const datos = aoa.slice(1).map((r) => r[c]);
    const maxDato = Math.max(0, ...datos.map(largo));
    const palabras = String(aoa[0][c] ?? '').split(' ');
    const maxPalabra = Math.max(0, ...palabras.map((p) => p.length));
    const esTexto = datos.some((v) => typeof v === 'string' && v.length > 12);
    // Texto largo (nombre del medicamento): ancho fijo y se parte en lineas; numeros: lo justo
    const ancho = esTexto ? Math.min(Math.max(maxDato, maxPalabra), 45) : Math.max(maxDato, maxPalabra, 4);
    anchos.push(ancho + 1);
  }
  ws['!cols'] = anchos.map((wch) => ({ wch }));
  const lineas = (v, ancho) => {
    let n = 1;
    let actual = 0;
    for (const p of String(v ?? '').split(' ')) {
      if (actual && actual + 1 + p.length > ancho - 1) { n += 1; actual = p.length; } else actual += (actual ? 1 : 0) + p.length;
    }
    return n;
  };
  const borde = { style: 'thin', color: { rgb: '000000' } };
  const bordes = { top: borde, bottom: borde, left: borde, right: borde };
  ws['!rows'] = aoa.map((fila, r) => {
    const maxLineas = Math.max(1, ...fila.map((v, c) => lineas(v, anchos[c])));
    fila.forEach((v, c) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) return;
      ws[ref].s = {
        alignment: { wrapText: true, vertical: r === 0 ? 'center' : 'top', horizontal: r === 0 || typeof v === 'string' ? 'left' : 'right' },
        border: bordes,
        ...(r === 0 ? { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'E7ECF0' } } } : {})
      };
    });
    return { hpt: Math.max(15, maxLineas * 15) };
  });
}

function exportTableToXlsx(table, filename) {
  if (!table) return;
  const aoa = [];
  // Primera fila de encabezados (la de los buscadores por columna no se exporta)
  const encabezado = table.querySelector(':scope > thead > tr:not(.filtro-columnas)');
  aoa.push(Array.from(encabezado ? encabezado.children : [])
    .map((th) => String(th.textContent || '').replace(/\s+/g, ' ').trim()
      // "Consumo 1er sem. 2023" -> "1er sem. 2023" (en el Excel sobra la palabra)
      .replace(/^Consumo\s+(?=(1er|2do|\d))/i, '')));
  for (const tr of table.querySelectorAll(':scope > tbody > tr')) {
    if (tr.classList.contains('detail-row') || tr.querySelector('td.empty')) continue;
    // filtrada por los buscadores de columna (las ocultas solo por la paginacion si se exportan)
    if (tr.dataset.filtrada === '1') continue;
    // data-excel: valor a exportar cuando la celda muestra algo mas (ej. el requerido corregido con el del PDF abajo)
    aoa.push(Array.from(tr.children).map((td) => cellValue(td.dataset.excel ?? td.textContent)));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  formatearHoja(ws, aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  descargarLibro(wb, filename);
}

// Buscadores por columna: agrega debajo de los titulos una fila de casilleros que filtran la tabla
// mientras se escribe (sin distinguir mayusculas ni tildes; se pueden combinar varias columnas).
// Trabaja sobre el DOM de la tabla y se vuelve a aplicar cada vez que React cambia las filas.
function normalizarFiltro(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Paginacion: tambien sobre el DOM, despues de los buscadores. Pagina las filas principales
// (la fila de detalle abierta va con la suya). 0 = todas las filas.
const OPCIONES_POR_PAGINA = [25, 50, 100, 200, 0];

function leerPorPagina() {
  try {
    const guardado = localStorage.getItem('filasPorPagina');
    if (guardado !== null && OPCIONES_POR_PAGINA.includes(Number(guardado))) return Number(guardado);
  } catch { /* sin localStorage */ }
  return 50;
}

function useFiltrosColumnas(targetId) {
  const [info, setInfo] = useState({ pagina: 1, paginas: 1, filas: 0, desde: 0, hasta: 0, porPagina: leerPorPagina() });
  const [abajo, setAbajo] = useState(null); // contenedor del paginador debajo de la tabla
  const controles = useRef({ irA: () => {}, cambiarPorPagina: () => {} });

  useEffect(() => {
    const valores = new Map(); // indice de columna -> texto buscado
    let observer = null;
    let tabla = null;
    let pagina = 1;
    let porPagina = leerPorPagina();
    let contenedor = null;

    function aplicar() {
      if (!tabla) return;
      const activos = Array.from(valores.entries()).filter(([, v]) => v);
      const grupos = []; // fila principal + sus filas de detalle
      for (const tr of tabla.querySelectorAll(':scope > tbody > tr')) {
        if (tr.classList.contains('detail-row')) {
          if (grupos.length) grupos[grupos.length - 1].detalles.push(tr);
          else tr.style.display = '';
          continue;
        }
        if (tr.querySelector('td.empty')) { tr.style.display = ''; delete tr.dataset.filtrada; continue; }
        const celdas = tr.children;
        const visible = activos.every(([i, v]) => celdas[i] && normalizarFiltro(celdas[i].textContent).includes(v));
        grupos.push({ tr, visible, detalles: [] });
      }
      const filas = grupos.filter((g) => g.visible).length;
      const paginas = porPagina ? Math.max(1, Math.ceil(filas / porPagina)) : 1;
      pagina = Math.min(Math.max(1, pagina), paginas);
      const desde = porPagina ? (pagina - 1) * porPagina : 0;
      const hasta = porPagina ? Math.min(desde + porPagina, filas) : filas;
      let n = 0;
      for (const g of grupos) {
        let mostrar = false;
        if (g.visible) { mostrar = n >= desde && n < hasta; n += 1; }
        for (const tr of [g.tr, ...g.detalles]) {
          tr.style.display = mostrar ? '' : 'none';
          if (g.visible) delete tr.dataset.filtrada;
          else tr.dataset.filtrada = '1';
        }
      }
      setInfo((prev) => (prev.pagina === pagina && prev.paginas === paginas && prev.filas === filas && prev.desde === desde
        && prev.hasta === hasta && prev.porPagina === porPagina ? prev : { pagina, paginas, filas, desde, hasta, porPagina }));
    }

    controles.current = {
      irA(p, subir) {
        pagina = p;
        aplicar();
        if (subir && tabla) (tabla.closest('.table-wrap') || tabla).scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
      cambiarPorPagina(n) {
        porPagina = n;
        pagina = 1;
        try { localStorage.setItem('filasPorPagina', String(n)); } catch { /* sin localStorage */ }
        aplicar();
      }
    };

    function armar() {
      tabla = document.getElementById(targetId);
      if (!tabla) return;
      const thead = tabla.querySelector(':scope > thead');
      const titulos = thead && thead.querySelector(':scope > tr:not(.filtro-columnas)');
      if (!titulos) return;
      let fila = thead.querySelector(':scope > tr.filtro-columnas');
      // Si cambio la cantidad de columnas (ej. columnas de periodos ocultas) se rearma la fila
      if (fila && fila.children.length !== titulos.children.length) { fila.remove(); fila = null; valores.clear(); }
      if (!fila) {
        fila = document.createElement('tr');
        fila.className = 'filtro-columnas';
        Array.from(titulos.children).forEach((th, i) => {
          const celda = document.createElement('th');
          if (th.classList.contains('solo-excel')) celda.className = 'solo-excel';
          celda.style.cssText = 'position:static;padding:3px 4px;background:#f8fafb';
          const input = document.createElement('input');
          input.type = 'search';
          input.placeholder = 'Buscar…';
          input.title = `Filtrar por «${String(th.textContent || '').trim() || 'columna'}»`;
          input.style.cssText = 'width:100%;min-width:60px;box-sizing:border-box;padding:3px 6px;font-size:12px;border:1px solid #cdd9e3;border-radius:4px;font-weight:400';
          input.addEventListener('input', () => { valores.set(i, normalizarFiltro(input.value)); pagina = 1; aplicar(); });
          celda.appendChild(input);
          fila.appendChild(celda);
        });
        thead.appendChild(fila);
      }
      if (!contenedor) {
        // paginador de abajo: un div propio despues del recuadro de la tabla
        const recuadro = tabla.closest('.table-wrap') || tabla;
        contenedor = document.createElement('div');
        contenedor.className = 'paginador-abajo';
        recuadro.after(contenedor);
        setAbajo(contenedor);
      }
      aplicar();
    }

    armar();
    // React vuelve a dibujar filas (filtros de arriba, cambio de ciclo, recarga): se reaplica
    const tablaObs = document.getElementById(targetId);
    if (tablaObs) {
      observer = new MutationObserver((mutaciones) => {
        if (mutaciones.some((m) => m.type === 'childList' || m.type === 'characterData')) armar();
      });
      observer.observe(tablaObs, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      if (observer) observer.disconnect();
      if (contenedor) contenedor.remove();
      setAbajo(null);
    };
  }, [targetId]);

  return { info, controles: controles.current, abajo };
}

function Paginador({ info, controles, abajo = false }) {
  const { pagina, paginas, filas, desde, hasta, porPagina } = info;
  const ir = (p) => controles.irA(p, abajo);
  return (
    <div className="paginador">
      <span>{filas ? `${desde + 1}–${hasta} de ${filas}` : '0 filas'}</span>
      {paginas > 1 ? (
        <>
          <button type="button" className="ghost small" onClick={() => ir(1)} disabled={pagina <= 1} title="Primera página">«</button>
          <button type="button" className="ghost small" onClick={() => ir(pagina - 1)} disabled={pagina <= 1} title="Página anterior">‹</button>
          <span>Página {pagina} de {paginas}</span>
          <button type="button" className="ghost small" onClick={() => ir(pagina + 1)} disabled={pagina >= paginas} title="Página siguiente">›</button>
          <button type="button" className="ghost small" onClick={() => ir(paginas)} disabled={pagina >= paginas} title="Última página">»</button>
        </>
      ) : null}
      {!abajo ? (
        <select value={porPagina} onChange={(event) => controles.cambiarPorPagina(Number(event.target.value))} title="Filas por página">
          {OPCIONES_POR_PAGINA.map((n) => <option key={n} value={n}>{n ? `${n} por página` : 'Todas'}</option>)}
        </select>
      ) : null}
    </div>
  );
}

function ExportButton({ targetId, name }) {
  const { info, controles, abajo } = useFiltrosColumnas(targetId);
  return (
    <div className="table-actions">
      <Paginador info={info} controles={controles} />
      {abajo && info.paginas > 1 ? createPortal(<Paginador info={info} controles={controles} abajo />, abajo) : null}
      <button type="button" className="ghost small" onClick={() => exportTableToXlsx(document.getElementById(targetId), name)}>
        <Download size={16} /> Exportar Excel
      </button>
    </div>
  );
}

function StockPage({ token }) {
  const [importaciones, setImportaciones] = useState([]);
  const [criticoFiles, setCriticoFiles] = useState([]);
  const [watch, setWatch] = useState(null);
  const [importacionId, setImportacionId] = useState('');
  const [resumen, setResumen] = useState(null);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [busy, setBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptRuns, setScriptRuns] = useState([]);
  const [message, setMessage] = useState('');
  const client = useMemo(() => apiClient(token), [token]);

  async function refresh(selectedId = importacionId, silent = false) {
    if (!silent) setBusy(true);
    try {
      const [imps, source] = await Promise.all([
        client.importaciones(),
        client.criticoSource()
      ]);
      setImportaciones(imps.data);
      setCriticoFiles(source.data || []);
      setWatch(source.watch || null);
      const id = selectedId || imps.data[0]?.id || '';
      setImportacionId(id);
      if (id) {
        const [res, its, runs] = await Promise.all([
          client.resumen(id),
          client.items({ importacionId: id, soloPendientes, search }),
          client.scriptRuns({ importacionId: id })
        ]);
        setResumen(res);
        setScriptRuns(runs.data);
        setItems(its.data.map((item) => ({ ...item, editMin: item.stock_minimo_nuevo ?? '', editMax: item.stock_maximo_nuevo ?? '' })));
      } else {
        setResumen(null);
        setScriptRuns([]);
        setItems([]);
      }
    } finally {
      if (!silent) setBusy(false);
    }
  }

  // Auto-refresco cada 60s (silencioso) para reflejar lo que el sondeo va importando.
  const refreshRef = useRef();
  refreshRef.current = refresh;
  useEffect(() => {
    refresh();
    const timer = setInterval(() => { refreshRef.current(undefined, true); }, 60000);
    return () => clearInterval(timer);
  }, []);

  async function guardar(item) {
    setMessage('');
    const data = await client.guardarValores(item.id, {
      stockMinimoNuevo: item.editMin,
      stockMaximoNuevo: item.editMax
    });
    setItems((current) => current.map((row) => (
      row.id === item.id ? { ...row, estado: 'listo', tipo_operacion: data.tipoOperacion } : row
    )));
  }

  async function ejecutarScript() {
    setMessage('');
    if (!importacionId) {
      setMessage('Seleccionar una importacion antes de ejecutar el script.');
      return;
    }
    setScriptBusy(true);
    try {
      const data = await client.ejecutarScript(importacionId);
      setMessage(`Script iniciado #${data.runId} para importacion #${data.importacionId}. Productos listos: ${data.pendientes}.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setScriptBusy(false);
    }
  }

  const itemsMostrados = estadoFiltro ? items.filter((it) => estadoCategoria(it) === estadoFiltro) : items;

  return (
    <>
      <section className="page-title">
        <h2>Carga de Stock Critico</h2>
      </section>
      <AyudaPagina id="stock" />

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <span style={{ fontWeight: 700 }}>Carpeta vigilada: D:\\FARMACIA\\CRITICO</span>
        <span className={`status ${watch?.enabled === false ? 'error' : 'cargado'}`} style={{ fontSize: 11 }}>
          {watch?.enabled === false
            ? 'sondeo apagado'
            : `sondeo automático cada ${watch ? Math.round(watch.intervalMs / 1000) : 60}s`}
        </span>
        <span style={{ color: '#5b6b76' }}>
          Último control: {watch?.ultimoSondeo ? new Date(watch.ultimoSondeo).toLocaleString() : '—'}
          {watch ? ` · ${watch.archivosUltimo} archivo(s), ${watch.importadosUltimo} nuevo(s)` : ''}
        </span>
      </section>

      {criticoFiles.length ? (
        <section className="table-wrap" style={{ marginTop: 8 }}>
          <table className="compact" style={{ minWidth: 0 }}>
            <thead>
              <tr><th>Archivo detectado</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {criticoFiles.map((f) => (
                <tr key={f.fullPath}>
                  <td>{f.name}</td>
                  <td>
                    {f.leido
                      ? <span className="status cargado">en tabla · importación #{f.importacionId}</span>
                      : <span className="status listo">detectado · se importa en el próximo control</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="toolbar" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Importación a trabajar:</span>
        <select value={importacionId} onChange={(event) => refresh(event.target.value)}>
          <option value="">Sin importacion</option>
          {importaciones.map((imp) => (
            <option key={imp.id} value={imp.id}>#{imp.id} {imp.archivo_nombre}</option>
          ))}
        </select>
        <button className="ghost" onClick={() => refresh()} disabled={busy}><RefreshCw size={18} /> Actualizar</button>
        <button className="script-button" onClick={ejecutarScript} disabled={busy || scriptBusy || !importacionId}>
          <Play size={18} />
          {scriptBusy ? 'Iniciando script...' : 'Cargar por script'}
        </button>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="summary-grid">
        <Metric label="Total productos" value={resumen?.resumen?.total ?? 0} />
        <Metric label="Con guiones" value={resumen?.resumen?.pendientes_originales ?? 0} />
        <Metric label="Listos para script" value={resumen?.resumen?.listos ?? 0} />
        <Metric label="Listos actualizar" value={resumen?.resumen?.listos_actualizacion ?? 0} />
        <Metric label="Cargados" value={resumen?.resumen?.cargados ?? 0} />
      </section>

      <section className="script-runs">
        <div className="section-head">
          <h2>Ejecuciones de script</h2>
          <button className="ghost compact" onClick={() => refresh()} disabled={busy}><RefreshCw size={16} /></button>
        </div>
        <div className="run-list">
          {scriptRuns.slice(0, 5).map((run) => (
            <div className="run-row" key={run.id}>
              <span className={`status ${run.estado}`}>{run.estado}</span>
              <strong>#{run.id}</strong>
              <span>Importacion: #{run.importacion_id || '-'}</span>
              <span>Procesados: {run.procesados}</span>
              <span>Cargados: {run.cargados}</span>
              <span>Errores: {run.errores}</span>
              <span className="run-message">{run.mensaje || '-'}</span>
            </div>
          ))}
          {!scriptRuns.length ? <div className="empty compact-empty">Sin ejecuciones registradas</div> : null}
        </div>
      </section>

      <section className="filters">
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar codigo o descripcion" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <label className="checkline">
          <input type="checkbox" checked={soloPendientes} onChange={(event) => setSoloPendientes(event.target.checked)} />
          Solo productos con guiones
        </label>
        <select value={estadoFiltro} onChange={(event) => setEstadoFiltro(event.target.value)} title="Filtrar por estado">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="listo">Listo (en cola script)</option>
          <option value="cargado">Cargado</option>
          <option value="actualizado">Actualizado</option>
          <option value="error">Error</option>
        </select>
        <button className="primary small" onClick={() => refresh()}><Search size={16} /> Filtrar</button>
      </section>

      <ExportButton targetId="tabla-stock" name="stock-critico" />
      <section className="table-wrap">
        <table id="tabla-stock">
          <thead>
            <tr>
              <th>#</th>
              <th>Codigo</th>
              <th>Descripcion</th>
              <th>Min actual</th>
              <th>Max actual</th>
              <th>Stock</th>
              <th>Min nuevo</th>
              <th>Max nuevo</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {itemsMostrados.map((item) => (
              <tr key={item.id}>
                <td>{item.fila_reporte}</td>
                <td className="code">{item.codigo_articulo}</td>
                <td>{item.descripcion}</td>
                <td className={item.minimo_con_guion ? 'dash' : ''}>{item.stock_minimo_actual ?? '-'}</td>
                <td className={item.maximo_con_guion ? 'dash' : ''}>{item.stock_maximo_actual ?? '-'}</td>
                <td>{item.stock_actual ?? '-'}</td>
                <td><input className="number" value={item.editMin} onChange={(event) => setItems(updateItem(items, item.id, { editMin: event.target.value }))} /></td>
                <td><input className="number" value={item.editMax} onChange={(event) => setItems(updateItem(items, item.id, { editMax: event.target.value }))} /></td>
                <td><StatusBadge item={item} /></td>
                <td><button className="icon-btn" title="Guardar valores" onClick={() => guardar(item)}><Save size={17} /></button></td>
              </tr>
            ))}
            {!itemsMostrados.length ? (
              <tr><td colSpan="10" className="empty"><FileSpreadsheet size={20} /> No hay productos para mostrar</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {busy ? <div className="busy"><Check size={18} /> Procesando...</div> : null}
    </>
  );
}

function ConsumoPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [consumos, setConsumos] = useState([]);
  const [stockImportaciones, setStockImportaciones] = useState([]);
  const [sourceFiles, setSourceFiles] = useState([]);
  const [consumoId, setConsumoId] = useState('');
  const [importacionId, setImportacionId] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [periodo, setPeriodo] = useState('semestre_2');
  const [items, setItems] = useState([]);
  const [cruce, setCruce] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh(selectedConsumo = consumoId, selectedStock = importacionId) {
    setBusy(true);
    try {
      const [consumosData, stocksData, sourceData] = await Promise.all([
        client.consumos(),
        client.importaciones(),
        client.stockSource()
      ]);
      setConsumos(consumosData.data);
      setStockImportaciones(stocksData.data);
      setSourceFiles(sourceData.data);
      setSourceFileName((current) => current || sourceData.data[0]?.name || '');
      const cid = selectedConsumo || consumosData.data[0]?.id || '';
      const sid = selectedStock || stocksData.data[0]?.id || '';
      setConsumoId(cid);
      setImportacionId(sid);
      if (cid) {
        const data = await client.consumoItems(cid, { search });
        setItems(data.data);
      } else {
        setItems([]);
      }
      if (cid && sid) {
        const data = await client.consumoCruce(cid, { importacionId: sid });
        setCruce(data.data);
        setResumen(data.resumen);
      } else {
        setCruce([]);
        setResumen(null);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function importar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const data = await client.importarConsumo(file, periodo);
      setMessage(`Consumo importado: ${data.totalItems} productos. Meses usados: ${data.mesesUsados.map((m) => m.label).join(', ')}.`);
      await refresh(data.id, importacionId);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  async function importarDesdeFuente() {
    setMessage('');
    if (!sourceFileName) {
      setMessage('Seleccionar Excel desde D:\\FARMACIA\\STOCK.');
      return;
    }
    setBusy(true);
    try {
      const data = await client.importarConsumoFuente({ fileName: sourceFileName, periodo });
      setMessage(`Importado desde ${data.sourcePath}: ${data.totalItems} productos. Meses usados: ${data.mesesUsados.map((m) => m.label).join(', ')}.`);
      await refresh(data.id, importacionId);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function aplicar() {
    setMessage('');
    if (!consumoId || !importacionId) {
      setMessage('Seleccionar consumo y stock critico antes de aplicar.');
      return;
    }
    setBusy(true);
    try {
      const data = await client.aplicarConsumo(consumoId, importacionId);
      setMessage(`Valores sugeridos aplicados: ${data.aplicados}. Quedaron listos para script en stock critico.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedConsumo = consumos.find((entry) => String(entry.id) === String(consumoId));
  const mesesUsados = parseJson(selectedConsumo?.meses_usados, []);

  return (
    <>
      <section className="page-title">
        <h2>Consumo mensual</h2>
      </section>
      <AyudaPagina id="consumo" />

      <section className="toolbar">
        <label className="upload-button">
          <Upload size={18} />
          Importar consumo
          <input type="file" accept=".xls,.xlsx,.html" onChange={importar} />
        </label>
        <select value={sourceFileName} onChange={(event) => setSourceFileName(event.target.value)}>
          <option value="">Excel fuente</option>
          {sourceFiles.map((file) => (
            <option key={file.fullPath} value={file.name}>{file.name}</option>
          ))}
        </select>
        <select value={periodo} onChange={(event) => setPeriodo(event.target.value)}>
          <option value="semestre_1">1er semestre</option>
          <option value="semestre_2">2do semestre</option>
          <option value="anio_completo">Todo el año</option>
          <option value="auto">Ultimos 6 con datos</option>
        </select>
        <button className="ghost" onClick={importarDesdeFuente} disabled={busy || !sourceFileName}>
          <Sigma size={18} />
          Importar desde D:\FARMACIA\STOCK
        </button>
        <select value={consumoId} onChange={(event) => refresh(event.target.value, importacionId)}>
          <option value="">Sin consumo</option>
          {consumos.map((consumo) => (
            <option key={consumo.id} value={consumo.id}>#{consumo.id} {consumo.archivo_nombre}</option>
          ))}
        </select>
        <select value={importacionId} onChange={(event) => refresh(consumoId, event.target.value)}>
          <option value="">Sin stock critico</option>
          {stockImportaciones.map((imp) => (
            <option key={imp.id} value={imp.id}>Stock #{imp.id} {imp.archivo_nombre}</option>
          ))}
        </select>
        <button className="ghost" onClick={() => refresh()} disabled={busy}><RefreshCw size={18} /> Actualizar</button>
        <button className="script-button" onClick={aplicar} disabled={busy || !consumoId || !importacionId}>
          <Check size={18} />
          Aplicar sugeridos
        </button>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="summary-grid">
        <Metric label="Productos consumo" value={resumen?.consumoItems ?? items.length} />
        <Metric label="Cruzados con stock" value={resumen?.cruzados ?? 0} />
        <Metric label="Con guion" value={resumen?.conGuion ?? 0} />
        <Metric label="Aplicables" value={resumen?.listosAplicables ?? 0} />
      </section>

      <section className="formula-panel">
        <strong>Formula aplicada</strong>
        <span>{formulaSummary(mesesUsados.length || 6)}</span>
        <span>Meses usados: {mesesUsados.map((m) => m.label).join(', ') || '-'}</span>
      </section>

      <section className="filters">
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar codigo o nombre" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <button className="primary small" onClick={() => refresh()}><Search size={16} /> Filtrar</button>
      </section>

      <ExportButton targetId="tabla-consumo" name="consumo-mensual" />
      <section className="table-wrap">
        <table id="tabla-consumo">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Producto</th>
              <th>Suma</th>
              <th>Promedio</th>
              <th>Min sugerido</th>
              <th>Max sugerido</th>
              <th>Mes menor</th>
              <th>Mes mayor</th>
              <th>Cruce</th>
              <th>Guion</th>
            </tr>
          </thead>
          <tbody>
            {(cruce.length ? cruce : items).map((item) => (
              <tr key={`${item.codigo_articulo}-${item.consumo_item_id || item.id}`}>
                <td className="code">{item.codigo_articulo}</td>
                <td>{item.nombre_generico || item.stock_descripcion || '-'}</td>
                <td>{formatNumber(item.suma_6)}</td>
                <td>{formatNumber(item.promedio_6)}</td>
                <td className="code">
                  <span className="calc-value" data-tooltip={formulaTooltip(item, 'minimo', mesesUsados.length || 6)}>{item.minimo_sugerido}</span>
                </td>
                <td className="code">
                  <span className="calc-value" data-tooltip={formulaTooltip(item, 'maximo', mesesUsados.length || 6)}>{item.maximo_sugerido}</span>
                </td>
                <td>{parseJson(item.meses_minimos, []).join(', ')}</td>
                <td>{parseJson(item.meses_maximos, []).join(', ')}</td>
                <td><span className={`status ${item.stock_item_id ? 'cargado' : 'error'}`}>{item.stock_item_id ? 'cruzado' : 'sin stock'}</span></td>
                <td><span className={`status ${item.requiere_carga ? 'listo' : 'pendiente'}`}>{item.requiere_carga ? 'con guion' : '-'}</span></td>
              </tr>
            ))}
            {!items.length && !cruce.length ? (
              <tr><td colSpan="10" className="empty"><Sigma size={20} /> Sin consumos para mostrar</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {busy ? <div className="busy"><Check size={18} /> Procesando...</div> : null}
    </>
  );
}

const PAPELES = {
  a4: { label: 'A4 (21 x 29,7 cm)', w: 21, h: 29.7 },
  oficio: { label: 'Oficio / Legal (21,6 x 33 cm)', w: 21.6, h: 33 },
  carta: { label: 'Carta (21,6 x 27,9 cm)', w: 21.6, h: 27.9 }
};
const CM_TO_PX = 37.7952755906;

function fmtPeriodoCorto(desde, hasta) {
  const p = (d) => (d ? `${String(d).slice(5, 7)}/${String(d).slice(2, 4)}` : '?');
  return `${p(desde)}–${p(hasta)}`;
}

// Forma canónica: SOLUCION INYECTABLE (y variantes) => INYECTABLE; singular simple para plurales.
function formaCanonica(forma) {
  let s = String(forma || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  if (!s) return '';
  if (s.includes('INYECTABLE')) return 'INYECTABLE';
  if (/^[A-Z]+S$/.test(s) && s.length > 4) s = s.slice(0, -1); // COMPRIMIDOS->COMPRIMIDO, AMPOLLAS->AMPOLLA
  return s;
}

// Redondeo hacia arriba:
//  - unidades (1-9) -> 10
//  - decenas (10-99): <=50 -> 50 ; >50 -> 100
//  - 100 en adelante -> 2 cifras significativas (147->150, 2200->2200, 16216->17000)
function redondearStock(n) {
  if (n == null) return null;
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (x < 10) return 10;
  if (x < 100) return x <= 50 ? 50 : 100;
  const step = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / step) * step;
}

// Forma abreviada a partir de la canónica: primera letra de cada palabra (AMPOLLA->A, INYECTABLE->I).
function abrevForma(forma) {
  const s = formaCanonica(forma);
  if (!s) return '—';
  return s.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
}

// Celda que muestra el texto completo (envuelve en el renglón) y se vuelve input al hacer click.
// `display` opcional: lo que se muestra sin editar (p.ej. abreviatura); se edita el `value` real.
function EditableCell({ value, display, title, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  useEffect(() => { if (!editing) setVal(value ?? ''); }, [value, editing]);
  if (editing) {
    return (
      <input
        className="edit-inline"
        autoFocus
        value={val}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); } }}
        onBlur={() => { setEditing(false); const v = val.trim(); if ((value ?? '') !== v) onSave(v); }}
      />
    );
  }
  return (
    <span className="editable-text" title={title || 'Click para editar'} onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
      {display !== undefined ? display : (value || '—')}
    </span>
  );
}

function SugeridosPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [rows, setRows] = useState([]);
  const [stockActual, setStockActual] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [calcAbierto, setCalcAbierto] = useState(() => new Set());

  function toggleCalc(id) {
    setCalcAbierto((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function refresh(selSearch = search, silent = false) {
    if (!silent) setBusy(true);
    try {
      const [sug, sa] = await Promise.all([
        client.sugeridos({ search: selSearch || '' }),
        client.stockCriticoActual()
      ]);
      setRows(sug.data || []);
      setStockActual(sa.importacion || null);
    } finally {
      if (!silent) setBusy(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function generar() {
    setBusy(true); setMessage('');
    try {
      const r = await client.generarSugeridos();
      setMessage(`Sugeridos recalculados: ${r.total} productos con guión del stock crítico actual (respetando lo editado a mano).`);
      await refresh(search, true);
    } catch (err) { setMessage('Error: ' + err.message); } finally { setBusy(false); }
  }

  async function guardarSug(id, campo, valor) {
    try {
      await client.editarSugerido(id, { [campo]: valor });
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, [campo]: valor, editado_manual: 1 } : r)));
      setMessage('Cambio guardado.');
    } catch (err) { setMessage('No se pudo guardar: ' + err.message); }
  }

  async function aplicar() {
    setBusy(true); setMessage('');
    try {
      const r = await client.aplicarSugeridos();
      setMessage(`Aplicados ${r.aplicados} a stock crítico (importación #${r.importacion?.id} ${r.importacion?.archivo_nombre || ''}), marcados "listo" para el script.`);
    } catch (err) { setMessage('Error: ' + err.message); } finally { setBusy(false); }
  }

  const inputNum = (r, campo) => (
    <input
      className="number" type="number" defaultValue={r[campo] ?? ''} style={{ width: 72 }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      onBlur={(e) => { const v = e.target.value.trim(); const cur = r[campo] == null ? '' : String(r[campo]); if (cur !== v) guardarSug(r.id, campo, v === '' ? null : Math.trunc(Number(v))); }}
    />
  );

  return (
    <>
      <section className="page-title">
        <h2>Stock Sugeridos (borrador)</h2>
      </section>
      <AyudaPagina id="sugeridos" />

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="script-button" onClick={generar} disabled={busy}><Sigma size={18} /> Generar / recalcular desde trimestre</button>
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar codigo o nombre" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') refresh(search); }} />
        </div>
        <button className="primary small" onClick={() => refresh(search)} disabled={busy}><Search size={16} /> Filtrar</button>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'grid', gap: 2, margin: 0, fontSize: 12, textAlign: 'right' }}>
          <span style={{ fontWeight: 700 }}>Destino: Stock Crítico (automático)</span>
          {stockActual
            ? <span style={{ color: '#5b6b76' }}>#{stockActual.id} {stockActual.archivo_nombre} · {stockActual.items_con_guion} con guión</span>
            : <span className="status error">no hay stock crítico importado</span>}
        </div>
        <button className="script-button" onClick={aplicar} disabled={busy || !stockActual}><Check size={18} /> Aplicar a Stock Crítico</button>
      </section>

      <div style={{ color: '#5b6b76', fontSize: 12, margin: '4px 2px' }}>
        Solo aparecen los productos <b>con guión</b> del stock crítico actual. Los mín/máx salen del <b>último trimestre con movimiento</b> (máx = consumo×2, mín = consumo×2÷3); los que no tienen consumo quedan en blanco para completar a mano. Editá lo que quieras; al <b>Aplicar</b> se mandan al <b>stock crítico actual</b> (última importación, automático). «Generar» no pisa lo que edites a mano.
      </div>

      {message ? <div className="notice">{message}</div> : null}

      <ExportButton targetId="tabla-sugeridos" name="stock-sugeridos" />
      <section className="table-wrap">
        <table id="tabla-sugeridos" className="compact">
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Producto</th>
              <th>Forma</th>
              <th>Concentración</th>
              <th>Present.</th>
              <th>Semestre</th>
              <th style={{ textAlign: 'center' }}>Consumo sem.</th>
              <th style={{ textAlign: 'center' }}>Stock Mín.</th>
              <th style={{ textAlign: 'center' }}>Stock Máx.</th>
              <th style={{ textAlign: 'center' }}>Editado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const det = Array.isArray(r.detalle_calculo) ? r.detalle_calculo : [];
              const open = calcAbierto.has(r.id);
              return (
              <React.Fragment key={r.id}>
              <tr>
                <td className="code">{r.codigo_articulo}</td>
                <td>{r.nombre_generico || '-'}</td>
                <td style={{ color: '#5b6b76' }} title={r.forma || ''}>{abrevForma(r.forma)}</td>
                <td style={{ color: '#5b6b76' }}>{r.concentracion || '-'}</td>
                <td style={{ color: '#5b6b76' }}>{r.presentacion || '-'}</td>
                <td style={{ color: '#5b6b76' }}>{r.ultimo_periodo || '-'}</td>
                <td style={{ textAlign: 'center' }}>{formatNumber(r.consumo_ultimo)}</td>
                <td style={{ textAlign: 'center', color: '#176338', fontWeight: 700 }}>{inputNum(r, 'stock_minimo')}</td>
                <td style={{ textAlign: 'center', color: '#174e8d', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {inputNum(r, 'stock_maximo')}
                  {det.length ? <button className="ghost small" style={{ marginLeft: 4, padding: '0 5px' }} title="Ver cálculo" onClick={() => toggleCalc(r.id)}>{open ? '▾' : 'ⓘ'}</button> : null}
                </td>
                <td style={{ textAlign: 'center' }}>{r.editado_manual ? <span className="status listo-actualizar">manual</span> : ''}</td>
              </tr>
              {open ? (
                <tr style={{ background: '#f0f6ff' }}>
                  <td colSpan="10" style={{ fontSize: 12 }}>
                    {det.length ? det.map((s) => (
                      <span key={s.label} style={{ display: 'inline-block', marginRight: 18, fontWeight: s.elegido ? 700 : 400, color: s.elegido ? '#174e8d' : '#5b6b76' }}>
                        {s.label}: Máx {formatNumber(redondearStock(s.total))} · Mín {formatNumber(redondearStock(s.total / 3))}{s.proyectado ? ' (proy)' : ''}{s.elegido ? ' ✓' : ''}
                      </span>
                    )) : <span style={{ color: '#5b6b76' }}>sin consumo.</span>}
                  </td>
                </tr>
              ) : null}
              </React.Fragment>
              );
            })}
            {!rows.length ? (
              <tr><td colSpan="10" className="empty"><Sigma size={20} /> Sin sugeridos. Tocá «Generar / recalcular desde trimestre».</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {busy ? <div className="busy"><Check size={18} /> Procesando...</div> : null}
    </>
  );
}

function TrimestralPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [sourceFiles, setSourceFiles] = useState([]);
  const [sourceDir, setSourceDir] = useState('');
  const [watch, setWatch] = useState(null);
  const [importaciones, setImportaciones] = useState([]);
  const [items, setItems] = useState([]);
  const [comparacion, setComparacion] = useState({ importaciones: [], data: [] });
  const [importacionId, setImportacionId] = useState('');
  const [periodoFiltro, setPeriodoFiltro] = useState('');
  const [search, setSearch] = useState('');
  const [vista, setVista] = useState('items');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [stockImportaciones, setStockImportaciones] = useState([]);
  const [aplicarTrimestreId, setAplicarTrimestreId] = useState('');
  const [aplicarStockId, setAplicarStockId] = useState('');
  const [restantes, setRestantes] = useState(null);
  const [gruposAbiertos, setGruposAbiertos] = useState(() => new Set());
  const [calcAbierto, setCalcAbierto] = useState(() => new Set());

  function toggleGrupo(key) {
    setGruposAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleCalc(key) {
    setCalcAbierto((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Fila de detalle del cálculo semestral (se muestra al desplegar).
  const detalleCalculoRow = (key, calc, colSpanTotal) => (
    <tr key={`${key}-calc`} style={{ background: '#f0f6ff' }}>
      <td colSpan={colSpanTotal} style={{ fontSize: 12 }}>
        {calc.detalle.length
          ? calc.detalle.map((s) => (
              <span key={s.label} style={{ display: 'inline-block', marginRight: 18, fontWeight: s.elegido ? 700 : 400, color: s.elegido ? '#174e8d' : '#5b6b76' }}>
                {s.label}: Máx {formatNumber(redondearStock(s.total))} · Mín {formatNumber(redondearStock(s.total / 3))}{s.proyectado ? ' (proy)' : ''}{s.elegido ? ' ✓' : ''}
              </span>
            ))
          : <span style={{ color: '#5b6b76' }}>sin datos de consumo.</span>}
      </td>
    </tr>
  );

  // Guarda un campo POR CÓDIGO: corrige todas las filas de ese código (todos los períodos),
  // y sincroniza en pantalla tanto "Importados" como "Comparación".
  async function guardarCampoCodigo(codigo, backendCol, valor) {
    try {
      await client.editarTrimestreCodigo(codigo, { [backendCol]: valor });
      setItems((cur) => cur.map((x) => (x.codigo_articulo === codigo ? { ...x, [backendCol]: valor } : x)));
      const dataKey = backendCol === 'nombre_generico' ? 'nombre' : backendCol;
      setComparacion((cur) => ({ ...cur, data: (cur.data || []).map((p) => (p.codigo_articulo === codigo ? { ...p, [dataKey]: valor } : p)) }));
      setMessage(`Cambio guardado (código ${codigo}, todos los períodos). Recalculando…`);
      // Dispara el recalculo trayendo el dato canonico de la DB (silencioso).
      await refresh(importacionId, search, true);
      setMessage(`Cambio guardado (código ${codigo}, todos los períodos).`);
    } catch (err) {
      setMessage('No se pudo guardar: ' + err.message);
    }
  }

  // Celda editable para "Importados" (los items usan el nombre de columna de la DB).
  const celdaEditable = (it, backendCol) => (
    <EditableCell value={it[backendCol]} onSave={(v) => guardarCampoCodigo(it.codigo_articulo, backendCol, v)} />
  );

  // Celda editable para "Comparación" (los datos usan 'nombre' en lugar de 'nombre_generico').
  const celdaEditableComp = (prod, dataKey, backendCol) => (
    <EditableCell value={prod[dataKey]} onSave={(v) => guardarCampoCodigo(prod.codigo_articulo, backendCol, v)} />
  );

  // Celda de forma abreviada (muestra A/C/I…, edita la forma completa) para ambas tablas.
  const celdaFormaComp = (prod) => (
    <EditableCell value={prod.forma} display={abrevForma(prod.forma)} title={prod.forma || 'Click para editar'} onSave={(v) => guardarCampoCodigo(prod.codigo_articulo, 'forma', v)} />
  );
  const celdaFormaItem = (it) => (
    <EditableCell value={it.forma} display={abrevForma(it.forma)} title={it.forma || 'Click para editar'} onSave={(v) => guardarCampoCodigo(it.codigo_articulo, 'forma', v)} />
  );

  async function refresh(selImp = importacionId, selSearch = search, silent = false) {
    if (!silent) setBusy(true);
    try {
      const [src, imps, comp, stockImps] = await Promise.all([
        client.trimestreSource(),
        client.trimestreImportaciones(),
        client.trimestreComparacion(),
        client.importaciones()
      ]);
      setSourceFiles(src.data || []);
      setSourceDir(src.dir || '');
      setWatch(src.watch || null);
      setImportaciones(imps.data || []);
      setComparacion(comp || { importaciones: [], data: [] });
      setStockImportaciones(stockImps.data || []);
      setAplicarStockId((current) => current || (stockImps.data || [])[0]?.id || '');
      const itemsRes = await client.trimestreItems({ importacionId: selImp || '', search: selSearch || '' });
      setItems(itemsRes.data || []);
    } finally {
      if (!silent) setBusy(false);
    }
  }

  // Arma los trimestres terminados con el consumo mensual que bajo el robot de Farmacia MS
  async function desdeConsumo() {
    setBusy(true);
    try {
      const { data } = await client.trimestreDesdeConsumo();
      const nuevos = data.filter((t) => t.cambio).map((t) => `T${t.trimestre} ${t.anio}`);
      setMessage(data.length
        ? `Trimestres desde Farmacia MS: ${data.map((t) => `T${t.trimestre} ${t.anio}`).join(', ')}. ${nuevos.length ? `Actualizados: ${nuevos.join(', ')}.` : 'Ya estaban al día.'}`
        : 'No hay consumo descargado con trimestres terminados. Bajalo desde «Consumo Mensual (Farmacia MS)».');
      await refresh(importacionId, search, true);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Auto-refresco: repite el ultimo refresh (con los filtros vigentes) cada 60s,
  // en modo silencioso para no molestar la vista mientras el sondeo trae datos nuevos.
  const refreshRef = useRef();
  refreshRef.current = refresh;
  useEffect(() => {
    refresh();
    const timer = setInterval(() => { refreshRef.current(undefined, undefined, true); }, 60000);
    return () => clearInterval(timer);
  }, []);

  async function aplicarAStock() {
    if (!aplicarTrimestreId || !aplicarStockId) {
      setMessage('Elegí el período trimestral y la importación de stock crítico.');
      return;
    }
    setBusy(true);
    setMessage('');
    setRestantes(null);
    try {
      const res = await client.aplicarTrimestreStock(Number(aplicarTrimestreId), Number(aplicarStockId));
      setRestantes(res.restantes || []);
      setMessage(`Aplicados ${res.aplicados} a stock crítico (marcados "listo" para el script). Siguen con guión sin actualizar: ${res.restantesCount}.`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Semestre de un trimestre: "2026-S1" (T1+T2) / "2026-S2" (T3+T4)
  const semestreKey = (x) => `${x.anio}-S${Number(x.trimestre) <= 2 ? 1 : 2}`;
  const semestreLabel = (key) => { const [anio, sem] = String(key).split('-S'); return `S${sem} ${anio}`; };
  const periodos = Array.from(new Set(importaciones.filter((imp) => imp.anio && imp.trimestre).map(semestreKey)))
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ key, label: `${semestreLabel(key)} (${key.endsWith('S1') ? 'ene–jun' : 'jul–dic'})` }));
  const itemsFiltrados = periodoFiltro
    ? items.filter((it) => semestreKey(it) === periodoFiltro)
    : items;

  // La identidad de un producto es nombre + forma + concentracion + presentacion.
  // Solo se suman codigos DISTINTOS que sean el MISMO producto (misma identidad, cambio de codigo).
  // Distinta concentracion / forma / presentacion = producto distinto = fila separada.
  const norm = (s) => String(s || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  const gruposComparacion = useMemo(() => {
    const map = new Map();
    for (const prod of comparacion.data) {
      const nombre = String(prod.nombre || prod.codigo_articulo || '').trim();
      const forma = String(prod.forma || '').trim();
      const conc = String(prod.concentracion || '').trim();
      const pres = String(prod.presentacion || '').trim();
      const key = `${norm(nombre) || prod.codigo_articulo}||${formaCanonica(forma)}||${norm(conc)}||${norm(pres)}`;
      let g = map.get(key);
      if (!g) { g = { key, nombre, forma, concentracion: prod.concentracion || null, presentacion: prod.presentacion || null, codigos: [], totales: {} }; map.set(key, g); }
      g.codigos.push(prod);
      for (const imp of comparacion.importaciones) {
        const info = prod.porImp[imp.id];
        if (info) g.totales[imp.id] = (g.totales[imp.id] || 0) + Number(info.total || 0);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')
        || String(a.forma).localeCompare(String(b.forma), 'es')
        || String(a.concentracion || '').localeCompare(String(b.concentracion || ''), 'es'));
  }, [comparacion]);

  // Pestaña "Importados": una fila por producto (nombre + forma + concentracion + presentacion),
  // sector y SEMESTRE. Suma los trimestres del semestre (T1+T2 o T3+T4) y muestra el desglose.
  const gruposItems = useMemo(() => {
    const map = new Map();
    for (const it of itemsFiltrados) {
      const nombre = String(it.nombre_generico || it.codigo_articulo || '').trim();
      const forma = String(it.forma || '').trim();
      const conc = String(it.concentracion || '').trim();
      const pres = String(it.presentacion || '').trim();
      const sk = semestreKey(it);
      const key = `IT::${norm(nombre) || it.codigo_articulo}||${formaCanonica(forma)}||${norm(conc)}||${norm(pres)}||${it.sector || ''}||${sk}`;
      let g = map.get(key);
      if (!g) {
        g = { key, nombre, forma, concentracion: it.concentracion || null, presentacion: it.presentacion || null, sector: it.sector, semestre: sk, total: 0, trimestres: {}, items: [] };
        map.set(key, g);
      }
      g.items.push(it);
      g.total += Number(it.total_periodo || 0);
      g.trimestres[`T${it.trimestre}`] = (g.trimestres[`T${it.trimestre}`] || 0) + Number(it.total_periodo || 0);
    }
    return Array.from(map.values()).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')
      || formaCanonica(a.forma).localeCompare(formaCanonica(b.forma), 'es')
      || norm(a.concentracion).localeCompare(norm(b.concentracion), 'es')
      || String(a.sector || '').localeCompare(String(b.sector || ''), 'es')
      || String(b.semestre).localeCompare(String(a.semestre)));
  }, [itemsFiltrados]);
  // "T1: 650 · T2: 100" (el trimestre que falta se indica para ver si el semestre esta completo)
  const calculoSemestre = (g) => {
    const presentes = Object.values(g.trimestres);
    const total = presentes.length ? Math.round((presentes.reduce((a, v) => a + v, 0) / presentes.length) * 2) : 0;
    return { total, proyectado: presentes.length === 1, maximo: redondearStock(total), minimo: redondearStock(total / 3) };
  };
  const desgloseTrimestres = (g) => {
    const tris = g.semestre.endsWith('S1') ? ['T1', 'T2'] : ['T3', 'T4'];
    return tris.map((t) => `${t}: ${t in g.trimestres ? formatNumber(g.trimestres[t]) : 'sin dato'}`).join(' · ');
  };

  // Stock por semestre. Muestra TODOS los semestres del sistema (0 si el producto no tiene dato).
  // Semestre incompleto (falta un trimestre) se PROYECTA: promedio de lo que hay × 2.
  // Solo compiten por el máximo los semestres con total > 0.
  const calcularStockSem = (getVal) => {
    const semMap = new Map();
    for (const imp of comparacion.importaciones) {
      const s = Number(imp.trimestre) <= 2 ? 1 : 2;
      const key = `${imp.anio}-S${s}`;
      let o = semMap.get(key);
      if (!o) { o = { anio: Number(imp.anio), semestre: s, label: `S${s} ${imp.anio}`, trimestres: {}, presentes: [] }; semMap.set(key, o); }
      const v = getVal(imp.id);
      // Un mismo trimestre puede venir de varios sectores (Unificada + Psicofarmacos): se suman
      if (v != null) o.trimestres[`T${imp.trimestre}`] = (o.trimestres[`T${imp.trimestre}`] || 0) + Number(v);
    }
    const detalle = [...semMap.values()].sort((a, b) => (b.anio - a.anio) || (b.semestre - a.semestre));
    for (const o of detalle) {
      o.presentes = Object.values(o.trimestres);
      const suma = o.presentes.reduce((a, v) => a + v, 0);
      o.total = o.presentes.length ? Math.round((suma / o.presentes.length) * 2) : 0;
      o.proyectado = o.presentes.length === 1;
      delete o.presentes;
    }
    let elegido = null;
    for (const o of detalle) if (o.total > 0 && (!elegido || o.total > elegido.total)) elegido = o;
    if (elegido) for (const o of detalle) o.elegido = (o === elegido);
    const rawMax = elegido ? elegido.total : null;
    return {
      maximo: redondearStock(rawMax),
      minimo: rawMax != null ? redondearStock(rawMax / 3) : null,
      rawMax, elegido, detalle
    };
  };

  // Datos de todos los períodos por código (de la comparación) para calcular el semestral
  // sin importar el filtro de la pestaña Importados.
  const compByCodigo = useMemo(() => {
    const m = new Map();
    for (const p of comparacion.data) m.set(p.codigo_articulo, p);
    return m;
  }, [comparacion]);
  const calcStockCodigos = (codigos) => calcularStockSem((impId) => {
    let sum = null;
    for (const c of codigos) {
      const info = compByCodigo.get(c)?.porImp?.[impId];
      if (info) sum = (sum || 0) + Number(info.total || 0);
    }
    return sum;
  });

  return (
    <>
      <section className="page-title">
        <h2>Análisis Trimestral</h2>
      </section>
      <AyudaPagina id="trimestral" sub={vista} />

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <span style={{ fontWeight: 700 }}>Carpeta vigilada: {sourceDir || 'D:\\FARMACIA\\TRIMESTRE'}</span>
        <span className={`status ${watch?.enabled === false ? 'error' : 'cargado'}`} style={{ fontSize: 11 }}>
          {watch?.enabled === false
            ? 'sondeo apagado'
            : `sondeo automático cada ${watch ? Math.round(watch.intervalMs / 1000) : 60}s`}
        </span>
        <span style={{ color: '#5b6b76' }}>
          Último control: {watch?.ultimoSondeo ? new Date(watch.ultimoSondeo).toLocaleString() : '—'}
          {watch ? ` · ${watch.archivosUltimo} archivo(s), ${watch.importadosUltimo} nuevo(s)` : ''}
        </span>
        <button className="ghost small" onClick={() => refresh()} disabled={busy}><RefreshCw size={15} /> Actualizar</button>
        <button className="ghost small" onClick={desdeConsumo} disabled={busy} title="Arma los trimestres terminados con el consumo mensual bajado por el robot (card Consumo Mensual)">
          <CalendarDays size={15} /> Actualizar desde Farmacia MS
        </button>
      </section>
      <div style={{ color: '#5b6b76', fontSize: 12, margin: '4px 2px' }}>
        Los trimestres de Farmacia Unificada y Psicofármacos se arman solos con el consumo que baja el robot de «Consumo Mensual (Farmacia MS)» (solo trimestres terminados).
        Los Excel de la carpeta siguen sirviendo para períodos que el robot no trae.
      </div>

      <section className="table-wrap" style={{ marginTop: 8 }}>
        <table className="compact" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>Archivo detectado</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {sourceFiles.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>
                  {f.leido
                    ? <span className="status cargado">en tabla · importación #{f.importacionId}</span>
                    : f.reemplazadoPor
                      ? <span className="status iniciado">reemplazado · {f.reemplazadoPor} se arma con el consumo de Farmacia MS</span>
                      : <span className="status listo">detectado · se importa en el próximo control</span>}
                </td>
              </tr>
            ))}
            {!sourceFiles.length ? (
              <tr><td colSpan="2" className="empty"><CalendarRange size={20} /> No hay archivos en la carpeta</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="toolbar" style={{ marginTop: 18 }}>
        <button className={`ghost ${vista === 'items' ? 'active' : ''}`} onClick={() => setVista('items')}>Importados</button>
        <button className={`ghost ${vista === 'comparacion' ? 'active' : ''}`} onClick={() => setVista('comparacion')}>Comparación por período</button>
      </section>

      {vista === 'items' ? (
        <>
          <section className="filters">
            <select value={periodoFiltro} onChange={(event) => setPeriodoFiltro(event.target.value)}>
              <option value="">Todos los semestres</option>
              {periodos.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            <select value={importacionId} onChange={(event) => { setImportacionId(event.target.value); refresh(event.target.value, search); }}>
              <option value="">Todas las importaciones</option>
              {importaciones.map((imp) => (
                <option key={imp.id} value={imp.id}>
                  #{imp.id} · {imp.anio} {fmtPeriodoCorto(imp.periodo_desde, imp.periodo_hasta)} · {imp.sector}
                </option>
              ))}
            </select>
            <div className="searchbox">
              <Search size={18} />
              <input placeholder="Buscar codigo o nombre" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <button className="primary small" onClick={() => refresh(importacionId, search)}><Search size={16} /> Filtrar</button>
          </section>

          <ExportButton targetId="tabla-trimestre-items" name="analisis-trimestral" />
          <div style={{ color: '#5b6b76', fontSize: 12, margin: '4px 2px' }}>
            Podés <b>corregir Producto / Forma / Concentración / Presentación</b> directamente en la tabla: editás la celda y al salir (o Enter) se guarda en la base para <b>todos los períodos de ese código</b> y se recalcula solo. (También editable en «Comparación por período».)
          </div>
          <section className="table-wrap">
            <table id="tabla-trimestre-items" className="compact">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Codigo</th>
                  <th>Producto</th>
                  <th style={{ width: 50 }}>Forma</th>
                  <th>Concentracion</th>
                  <th>Present.</th>
                  <th style={{ width: 80, whiteSpace: 'nowrap' }}>Semestre</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Total semestre</th>
                  <th style={{ whiteSpace: 'nowrap' }} title="Consumo de cada trimestre del semestre">Trimestres</th>
                  <th style={{ textAlign: 'center', width: 80 }} title="Total del semestre ÷ 3 (2 meses)">Stock Mín.</th>
                  <th style={{ textAlign: 'center', width: 130 }} title="Total del semestre (6 meses). «✓ mayor» = semestre más alto, el que se usa para el sugerido. ⓘ para ver el cálculo">Stock Máx.</th>
                  <th>Sector</th>
                </tr>
              </thead>
              <tbody>
                {gruposItems.map((g) => {
                  const cantCodigos = new Set(g.items.map((i) => i.codigo_articulo)).size;
                  const multi = cantCodigos > 1;
                  const abierto = gruposAbiertos.has(g.key);
                  const stockG = calcStockCodigos([...new Set(g.items.map((i) => i.codigo_articulo))]);
                  const calcOpen = calcAbierto.has(g.key);
                  const semCalc = calculoSemestre(g);
                  const esMayor = stockG.elegido && stockG.elegido.label === semestreLabel(g.semestre);
                  return (
                    <React.Fragment key={g.key}>
                      <tr
                        onClick={multi ? () => toggleGrupo(g.key) : undefined}
                        style={multi ? { cursor: 'pointer', background: abierto ? '#eef4fb' : undefined } : undefined}
                        title={multi ? `${cantCodigos} códigos con este nombre y forma — sumados. Click para ${abierto ? 'ocultar' : 'desglosar'}.` : undefined}
                      >
                        <td className="code">
                          {multi
                            ? <span style={{ fontWeight: 700, color: '#174e8d' }}>{abierto ? '▾' : '▸'} {cantCodigos} cód.</span>
                            : g.items[0].codigo_articulo}
                        </td>
                        <td style={multi ? { fontWeight: 700 } : undefined}>{multi ? (g.nombre || '-') : celdaEditable(g.items[0], 'nombre_generico')}</td>
                        <td style={{ color: '#5b6b76' }} title={g.forma || ''}>{multi ? abrevForma(g.forma) : celdaFormaItem(g.items[0])}</td>
                        <td style={{ color: '#5b6b76' }}>{multi ? (g.concentracion || '-') : celdaEditable(g.items[0], 'concentracion')}</td>
                        <td style={{ color: '#5b6b76' }}>{multi ? (g.presentacion || '-') : celdaEditable(g.items[0], 'presentacion')}</td>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{semestreLabel(g.semestre)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }} title={semCalc.proyectado ? 'Falta un trimestre: se proyecta con el que hay × 2' : 'Suma de los dos trimestres'}>
                          {formatNumber(semCalc.total)}{semCalc.proyectado ? <span style={{ color: '#7b5600', fontWeight: 400 }}> (proy.)</span> : null}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', color: '#5b6b76' }}>{desgloseTrimestres(g)}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#176338' }}>{formatNumber(semCalc.minimo)}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#174e8d', whiteSpace: 'nowrap' }}>
                          {formatNumber(semCalc.maximo)}
                          {esMayor ? <span className="status listo" style={{ marginLeft: 4 }} title="Semestre más alto: es el que se usa para el stock sugerido">✓ mayor</span> : null}
                          {stockG.detalle.length
                            ? <button className="ghost small" style={{ marginLeft: 4, padding: '0 5px' }} title="Ver cálculo"
                                onClick={(e) => { e.stopPropagation(); toggleCalc(g.key); }}>{calcOpen ? '▾' : 'ⓘ'}</button>
                            : null}
                        </td>
                        <td>{g.sector || '-'}</td>
                      </tr>
                      {calcOpen ? detalleCalculoRow(g.key, stockG, 11) : null}
                      {multi && abierto ? g.items.map((it) => {
                        const stockIt = calcStockCodigos([it.codigo_articulo]);
                        return (
                        <tr key={it.id} style={{ background: '#f7fafd', color: '#5b6b76' }}>
                          <td className="code" style={{ paddingLeft: 26 }}>{it.codigo_articulo}</td>
                          <td>{celdaEditable(it, 'nombre_generico')}</td>
                          <td title={it.forma || ''}>{celdaFormaItem(it)}</td>
                          <td>{celdaEditable(it, 'concentracion')}</td>
                          <td>{celdaEditable(it, 'presentacion')}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>T{it.trimestre} {it.anio}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(it.total_periodo)}</td>
                          <td />
                          <td style={{ textAlign: 'center' }}>{stockIt.minimo != null ? formatNumber(stockIt.minimo) : '-'}</td>
                          <td style={{ textAlign: 'center' }}>{stockIt.maximo != null ? formatNumber(stockIt.maximo) : '-'}</td>
                          <td>{it.sector || '-'}</td>
                        </tr>
                        );
                      }) : null}
                    </React.Fragment>
                  );
                })}
                {!gruposItems.length ? (
                  <tr><td colSpan="11" className="empty"><CalendarRange size={20} /> Sin productos importados</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'comparacion' ? (
        <>
          <ExportButton targetId="tabla-trimestre-comparacion" name="comparacion-trimestral" />
          <div style={{ color: '#5b6b76', fontSize: 13, margin: '4px 2px' }}>
            Las drogas con el mismo nombre y distinto código se muestran <b>sumadas</b>. Las filas con <b>“N cód.”</b> se pueden <b>desglosar haciendo click</b> para ver cada código.
          </div>
          <section className="table-wrap">
            <table id="tabla-trimestre-comparacion" className="compact">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Producto</th>
                  <th>Forma</th>
                  <th>Concentración</th>
                  <th>Present.</th>
                  {comparacion.importaciones.map((imp) => (
                    <th key={imp.id} style={{ textAlign: 'right' }} title={imp.sector || ''}>
                      {imp.anio} {fmtPeriodoCorto(imp.periodo_desde, imp.periodo_hasta)}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', borderLeft: '2px solid #cdd9e3' }} title="Mayor semestre (suma 6 meses) ÷ 3">Stock Mín.</th>
                  <th style={{ textAlign: 'center' }} title="Mayor total semestral (suma de 6 meses). ⓘ para ver el cálculo">Stock Máx.</th>
                </tr>
              </thead>
              <tbody>
                {gruposComparacion.map((g) => {
                  const multi = g.codigos.length > 1;
                  const abierto = gruposAbiertos.has(g.key);
                  const stockG = calcularStockSem((id) => g.totales[id]);
                  const calcOpen = calcAbierto.has(g.key);
                  return (
                    <React.Fragment key={g.key}>
                      <tr
                        onClick={multi ? () => toggleGrupo(g.key) : undefined}
                        style={multi ? { cursor: 'pointer', background: abierto ? '#eef4fb' : undefined } : undefined}
                        title={multi ? `${g.codigos.length} códigos con este nombre — sumados. Click para ${abierto ? 'ocultar' : 'desglosar'} cada código.` : undefined}
                      >
                        <td className="code">
                          {multi
                            ? <span style={{ fontWeight: 700, color: '#174e8d' }}>{abierto ? '▾' : '▸'} {g.codigos.length} cód.</span>
                            : g.codigos[0].codigo_articulo}
                        </td>
                        <td style={multi ? { fontWeight: 700 } : undefined}>{multi ? (g.nombre || '-') : celdaEditableComp(g.codigos[0], 'nombre', 'nombre_generico')}</td>
                        <td style={{ color: '#5b6b76' }} title={g.forma || ''}>{multi ? abrevForma(g.forma) : celdaFormaComp(g.codigos[0])}</td>
                        <td style={{ color: '#5b6b76' }}>
                          {multi ? (g.concentracion || '-') : celdaEditableComp(g.codigos[0], 'concentracion', 'concentracion')}
                        </td>
                        <td style={{ color: '#5b6b76' }}>
                          {multi ? (g.presentacion || '-') : celdaEditableComp(g.codigos[0], 'presentacion', 'presentacion')}
                        </td>
                        {comparacion.importaciones.map((imp) => (
                          <td key={imp.id} style={{ textAlign: 'right', fontWeight: multi ? 700 : undefined }}>
                            {g.totales[imp.id] != null ? formatNumber(g.totales[imp.id]) : '-'}
                          </td>
                        ))}
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#176338', borderLeft: '2px solid #cdd9e3' }}>
                          {stockG.minimo != null ? formatNumber(stockG.minimo) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#174e8d', whiteSpace: 'nowrap' }}>
                          {stockG.maximo != null ? formatNumber(stockG.maximo) : '-'}
                          {stockG.detalle.length
                            ? <button className="ghost small" style={{ marginLeft: 4, padding: '0 5px' }} title="Ver cálculo"
                                onClick={(e) => { e.stopPropagation(); toggleCalc(g.key); }}>{calcOpen ? '▾' : 'ⓘ'}</button>
                            : null}
                        </td>
                      </tr>
                      {calcOpen ? detalleCalculoRow(g.key, stockG, 7 + comparacion.importaciones.length) : null}
                      {multi && abierto ? g.codigos.map((prod) => {
                        const stockP = calcularStockSem((id) => prod.porImp[id]?.total);
                        return (
                        <tr key={prod.codigo_articulo} style={{ background: '#f7fafd' }}>
                          <td className="code" style={{ paddingLeft: 26, color: '#5b6b76' }}>{prod.codigo_articulo}</td>
                          <td>{celdaEditableComp(prod, 'nombre', 'nombre_generico')}</td>
                          <td title={prod.forma || ''}>{celdaFormaComp(prod)}</td>
                          <td>{celdaEditableComp(prod, 'concentracion', 'concentracion')}</td>
                          <td>{celdaEditableComp(prod, 'presentacion', 'presentacion')}</td>
                          {comparacion.importaciones.map((imp) => {
                            const info = prod.porImp[imp.id];
                            return (
                              <td key={imp.id} style={{ textAlign: 'right', color: '#5b6b76' }}>
                                {info ? formatNumber(info.total) : '-'}
                              </td>
                            );
                          })}
                          <td style={{ textAlign: 'center', color: '#176338', borderLeft: '2px solid #cdd9e3' }}>{stockP.minimo != null ? formatNumber(stockP.minimo) : '-'}</td>
                          <td style={{ textAlign: 'center', color: '#174e8d' }}>{stockP.maximo != null ? formatNumber(stockP.maximo) : '-'}</td>
                        </tr>
                        );
                      }) : null}
                    </React.Fragment>
                  );
                })}
                {!gruposComparacion.length ? (
                  <tr><td colSpan={7 + comparacion.importaciones.length} className="empty"><BarChart3 size={20} /> Sin datos para comparar</td></tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {busy ? <div className="busy"><Check size={18} /> Procesando...</div> : null}
    </>
  );
}

function ComparacionPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [aniosDisp, setAniosDisp] = useState([]);
  const [seleccion, setSeleccion] = useState([]);
  const [aniosUsados, setAniosUsados] = useState([]);
  const [meses, setMeses] = useState([]);
  const [data, setData] = useState([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [expandido, setExpandido] = useState(null);
  const [message, setMessage] = useState('');

  async function comparar(anios) {
    setBusy(true);
    setMessage('');
    try {
      const res = await client.consumoComparacion(anios);
      setAniosUsados(res.anios || []);
      setMeses(res.meses || []);
      setData(res.data || []);
      if (!(res.data || []).length) setMessage('Sin datos de consumo para los años elegidos.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    client.consumoAnios()
      .then((res) => {
        if (cancelled) return;
        const list = res.data || [];
        setAniosDisp(list);
        const sel = list.map((a) => a.anio);
        setSeleccion(sel);
        if (sel.length) comparar(sel);
      })
      .catch(() => { if (!cancelled) setAniosDisp([]); });
    return () => { cancelled = true; };
  }, [client]);

  function toggleAnio(anio) {
    setSeleccion((prev) => prev.includes(anio) ? prev.filter((a) => a !== anio) : [...prev, anio].sort((a, b) => a - b));
  }

  const filtro = search.trim().toLowerCase();
  const filas = filtro
    ? data.filter((p) => `${p.codigo_articulo} ${p.nombre || ''}`.toLowerCase().includes(filtro))
    : data;

  function variacion(prod, anio, idx) {
    if (idx === 0) return null;
    const prevAnio = aniosUsados[idx - 1];
    const actual = prod.porAnio[anio]?.total;
    const previo = prod.porAnio[prevAnio]?.total;
    if (actual == null || previo == null || previo === 0) return null;
    return ((actual - previo) / previo) * 100;
  }

  function exportarComparacion() {
    if (!filas.length) return;
    const header = ['Codigo', 'Producto', 'Año', ...meses.map((m) => m.label), 'Total anual'];
    const aoa = [header];
    for (const prod of filas) {
      for (const anio of aniosUsados) {
        const info = prod.porAnio[anio];
        if (!info) continue;
        aoa.push([
          prod.codigo_articulo,
          prod.nombre || '',
          anio,
          ...meses.map((m) => Number(info.meses[m.key] || 0)),
          Number(info.total || 0)
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparacion');
    descargarLibro(wb, 'comparacion-anios');
  }

  return (
    <>
      <section className="page-title">
        <h2>Comparar años</h2>
      </section>
      <AyudaPagina id="comparar" />

      <section className="toolbar">
        <span style={{ fontWeight: 700 }}>Años:</span>
        {aniosDisp.map((a) => (
          <label key={a.anio} className="checkline" style={{ marginTop: 0 }}>
            <input type="checkbox" checked={seleccion.includes(a.anio)} onChange={() => toggleAnio(a.anio)} />
            {a.anio}
          </label>
        ))}
        <button className="script-button" onClick={() => comparar(seleccion)} disabled={busy || !seleccion.length}>
          <BarChart3 size={18} /> Comparar
        </button>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="filters">
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar codigo o nombre" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <span style={{ alignSelf: 'center', color: '#5b6b76' }}>{filas.length} productos</span>
        <button type="button" className="ghost small" onClick={exportarComparacion} disabled={!filas.length}>
          <Download size={16} /> Exportar Excel
        </button>
      </section>

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Codigo</th>
              <th>Producto</th>
              {aniosUsados.map((anio) => (
                <th key={anio} style={{ textAlign: 'right' }}>{anio}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((prod) => {
              const abierto = expandido === prod.codigo_articulo;
              return (
                <React.Fragment key={prod.codigo_articulo}>
                  <tr className="clickable" onClick={() => setExpandido(abierto ? null : prod.codigo_articulo)}>
                    <td>{abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td className="code">{prod.codigo_articulo}</td>
                    <td>{prod.nombre || '-'}</td>
                    {aniosUsados.map((anio, idx) => {
                      const total = prod.porAnio[anio]?.total;
                      const vari = variacion(prod, anio, idx);
                      return (
                        <td key={anio} style={{ textAlign: 'right' }}>
                          {total == null ? '-' : formatNumber(total)}
                          {vari != null ? (
                            <span style={{ marginLeft: 6, fontSize: '0.8em', color: vari >= 0 ? '#1f8a4c' : '#c0392b' }}>
                              {vari >= 0 ? '▲' : '▼'} {Math.abs(vari).toFixed(0)}%
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                  {abierto ? (
                    <tr className="detail-row">
                      <td colSpan={3 + aniosUsados.length}>
                        <div className="table-wrap" style={{ margin: 0 }}>
                          <table className="mini">
                            <thead>
                              <tr>
                                <th>Año</th>
                                {meses.map((m) => <th key={m.key} style={{ textAlign: 'right' }}>{m.label.slice(0, 3)}</th>)}
                                <th style={{ textAlign: 'right' }}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {aniosUsados.map((anio) => {
                                const info = prod.porAnio[anio];
                                return (
                                  <tr key={anio}>
                                    <td className="code">{anio}</td>
                                    {meses.map((m) => (
                                      <td key={m.key} style={{ textAlign: 'right' }}>
                                        {info ? formatNumber(info.meses[m.key] || 0) : '-'}
                                      </td>
                                    ))}
                                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{info ? formatNumber(info.total) : '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
            {!filas.length ? (
              <tr><td colSpan={3 + aniosUsados.length} className="empty"><BarChart3 size={20} /> Sin productos para comparar</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {busy ? <div className="busy"><Check size={18} /> Procesando...</div> : null}
    </>
  );
}

function RotuloCelda({ farmaco, laboratorio, lote, vencimiento, fontSize, fontFamily }) {
  return (
    <div className="rotulo-celda" style={{ fontSize: `${fontSize}pt`, fontFamily }}>
      <strong>{farmaco || 'Nombre del farmaco'}</strong>
      <span>Lab: {laboratorio || '-'}</span>
      <span>Lote: {lote || '-'}</span>
      <span>Vence: {vencimiento || '-'}</span>
    </div>
  );
}

function RotuloGrid({ columnas, filas, anchoCm, altoCm, lineasCorte, farmaco, laboratorio, lote, vencimiento, fontSize, fontFamily, className }) {
  const celdas = Array.from({ length: Math.max(0, columnas * filas) });
  return (
    <div
      className={`rotulos-grid ${lineasCorte ? 'con-lineas' : ''} ${className || ''}`}
      style={{
        width: `${anchoCm}cm`,
        height: `${altoCm}cm`,
        gridTemplateColumns: `repeat(${columnas}, 1fr)`,
        gridTemplateRows: `repeat(${filas}, 1fr)`
      }}
    >
      {celdas.map((_, index) => (
        <RotuloCelda key={index} farmaco={farmaco} laboratorio={laboratorio} lote={lote} vencimiento={vencimiento} fontSize={fontSize} fontFamily={fontFamily} />
      ))}
    </div>
  );
}

const FUENTES = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet MS' }
];

function RotulosPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [lote, setLote] = useState('');
  const [vencimiento, setVencimiento] = useState('');
  const [farmaco, setFarmaco] = useState('');
  const [laboratorio, setLaboratorio] = useState('');
  const [anchoCm, setAnchoCm] = useState(3.5);
  const [altoCm, setAltoCm] = useState(2);
  const [papel, setPapel] = useState('a4');
  const [margenCm, setMargenCm] = useState(0.3);
  const [lineasCorte, setLineasCorte] = useState(true);
  const [fontSize, setFontSize] = useState(8);
  const [fontFamily, setFontFamily] = useState(FUENTES[0].value);
  const [farmacosList, setFarmacosList] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [historial, setHistorial] = useState([]);
  const [guardando, setGuardando] = useState(false);

  function cargarHistorial() {
    client.rotulosImpresiones()
      .then((data) => setHistorial(data.data || []))
      .catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;
    client.etiquetasFarmacos()
      .then((data) => {
        if (!cancelled) setFarmacosList(data.data || []);
      })
      .catch(() => {
        if (!cancelled) setFarmacosList([]);
      });
    cargarHistorial();
    return () => { cancelled = true; };
  }, [client]);

  const hoja = PAPELES[papel];
  const ancho = Math.max(0.5, Number(anchoCm) || 0.5);
  const alto = Math.max(0.5, Number(altoCm) || 0.5);
  const margen = Math.max(0, Number(margenCm) || 0);
  const usableW = Math.max(ancho, hoja.w - margen * 2);
  const usableH = Math.max(alto, hoja.h - margen * 2);
  const columnas = Math.max(1, Math.floor(usableW / ancho));
  const filas = Math.max(1, Math.floor(usableH / alto));
  const total = columnas * filas;

  useEffect(() => {
    let style = document.getElementById('rotulos-print-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'rotulos-print-style';
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${hoja.w}cm ${hoja.h}cm; margin: ${margen}cm; }`;
  }, [papel, margen, hoja.w, hoja.h]);

  const vencimientoFmt = vencimiento
    ? new Date(`${vencimiento}T00:00:00`).toLocaleDateString('es-AR')
    : '';

  const previewMaxWidthPx = 300;
  const previewScale = (previewMaxWidthPx / (hoja.w * CM_TO_PX)) * zoom;

  async function imprimirYGuardar() {
    setGuardando(true);
    try {
      await client.guardarRotulo({
        farmaco,
        laboratorio,
        lote,
        vencimiento: vencimientoFmt,
        cantidad: total,
        columnas,
        filas,
        papel,
        anchoCm: ancho,
        altoCm: alto
      });
      cargarHistorial();
    } catch (err) {
      // No bloqueamos la impresion si falla el guardado
    } finally {
      setGuardando(false);
      window.print();
    }
  }

  return (
    <>
      <section className="page-title">
        <h2>Rotulos</h2>
      </section>
      <AyudaPagina id="rotulos" />

      <section className="rotulos-form">
        <label>
          Lote
          <input value={lote} onChange={(event) => setLote(event.target.value)} placeholder="Lote" />
        </label>
        <label>
          Vencimiento
          <input type="date" value={vencimiento} onChange={(event) => setVencimiento(event.target.value)} />
        </label>
        <label>
          Nombre del farmaco
          <input
            list="rotulos-farmacos"
            value={farmaco}
            onChange={(event) => setFarmaco(event.target.value)}
            placeholder="Nombre del farmaco"
          />
          <datalist id="rotulos-farmacos">
            {farmacosList.map((nombre) => (
              <option key={nombre} value={nombre} />
            ))}
          </datalist>
        </label>
        <label>
          Laboratorio
          <input value={laboratorio} onChange={(event) => setLaboratorio(event.target.value)} placeholder="Laboratorio" />
        </label>
      </section>

      <section className="rotulos-config">
        <label>
          Ancho rotulo (cm)
          <input type="number" step="0.1" min="0.5" value={anchoCm} onChange={(event) => setAnchoCm(event.target.value)} />
        </label>
        <label>
          Alto rotulo (cm)
          <input type="number" step="0.1" min="0.5" value={altoCm} onChange={(event) => setAltoCm(event.target.value)} />
        </label>
        <label>
          Tamano de hoja
          <select value={papel} onChange={(event) => setPapel(event.target.value)}>
            {Object.entries(PAPELES).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </label>
        <label>
          Margen de hoja (cm)
          <input type="number" step="0.1" min="0" value={margenCm} onChange={(event) => setMargenCm(event.target.value)} />
        </label>
        <label className="checkline">
          <input type="checkbox" checked={lineasCorte} onChange={(event) => setLineasCorte(event.target.checked)} />
          Mostrar lineas de corte
        </label>
        <label>
          Tamano de letra (pt)
          <input type="number" step="0.5" min="4" max="24" value={fontSize} onChange={(event) => setFontSize(event.target.value)} />
        </label>
        <label>
          Tipo de letra
          <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
            {FUENTES.map((fuente) => (
              <option key={fuente.value} value={fuente.value}>{fuente.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="rotulos-summary">
        <span>{columnas} columnas x {filas} filas = {total} rotulos por hoja ({hoja.label})</span>
        <button className="script-button" onClick={imprimirYGuardar} disabled={guardando}><Printer size={18} /> Imprimir</button>
      </section>

      <section className="rotulos-preview">
        <div className="rotulos-zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
          <button type="button" onClick={() => setZoom(1)}>Ajustar</button>
        </div>
        <div className="rotulos-preview-scroll">
          <div
            className="rotulos-preview-frame"
            style={{ width: `${hoja.w * CM_TO_PX * previewScale}px`, height: `${hoja.h * CM_TO_PX * previewScale}px` }}
          >
            <div
              className="rotulos-preview-scaler"
              style={{
                width: `${hoja.w}cm`,
                height: `${hoja.h}cm`,
                padding: `${margen}cm`,
                transform: `scale(${previewScale})`
              }}
            >
              <RotuloGrid
                columnas={columnas}
                filas={filas}
                anchoCm={usableW}
                altoCm={usableH}
                lineasCorte={lineasCorte}
                farmaco={farmaco}
                laboratorio={laboratorio}
                lote={lote}
                vencimiento={vencimientoFmt}
                fontSize={fontSize}
                fontFamily={fontFamily}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="page-title" style={{ marginTop: 18 }}>
        <h3 style={{ margin: 0 }}>Historial de impresiones</h3>
      </section>
      <ExportButton targetId="tabla-rotulos-historial" name="rotulos-historial" />
      <section className="table-wrap">
        <table id="tabla-rotulos-historial">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Farmaco</th>
              <th>Laboratorio</th>
              <th>Lote</th>
              <th>Vence</th>
              <th>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((row) => (
              <tr key={row.id}>
                <td>{row.created_at ? new Date(row.created_at).toLocaleString('es-AR') : '-'}</td>
                <td>{row.usuario_nombre || '-'}</td>
                <td>{row.farmaco || '-'}</td>
                <td>{row.laboratorio || '-'}</td>
                <td className="code">{row.lote || '-'}</td>
                <td>{row.vencimiento || '-'}</td>
                <td>{row.cantidad}</td>
              </tr>
            ))}
            {!historial.length ? (
              <tr><td colSpan="7" className="empty"><Printer size={20} /> Sin impresiones registradas</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {createPortal(
        <RotuloGrid
          className="rotulos-print-sheet"
          columnas={columnas}
          filas={filas}
          anchoCm={usableW}
          altoCm={usableH}
          lineasCorte={lineasCorte}
          farmaco={farmaco}
          laboratorio={laboratorio}
          lote={lote}
          vencimiento={vencimientoFmt}
          fontSize={fontSize}
          fontFamily={fontFamily}
        />,
        document.body
      )}
    </>
  );
}

const OC_PREFS_KEY = 'oc_excel_prefs';

function leerPrefsOc() {
  try {
    return JSON.parse(localStorage.getItem(OC_PREFS_KEY) || 'null');
  } catch {
    return null;
  }
}

function formatPesos(value) {
  return Number(value || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
}

// Navegador de carpetas del servidor
function FolderPicker({ client, inicial, titulo, onElegir, onCerrar, contarPdfs = true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  function abrir(ruta) {
    setError('');
    client.ocCarpetas(ruta)
      .then(setData)
      .catch((err) => {
        setError(err.message);
        if (!data) client.ocCarpetas('').then(setData).catch(() => {});
      });
  }

  useEffect(() => { abrir(inicial); }, []);

  return createPortal(
    <div className="folder-overlay" onClick={onCerrar}>
      <div className="folder-picker" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <h2>{titulo}</h2>
          <button type="button" className="ghost small" onClick={onCerrar}>Cancelar</button>
        </div>
        <div className="folder-path">{data?.ruta || 'Unidades del servidor'}</div>
        {error ? <div className="alert">{error}</div> : null}
        <div className="folder-list">
          {data && data.ruta ? (
            <button type="button" className="folder-item" onClick={() => abrir(data.padre)}>
              <Folder size={16} /> ..
            </button>
          ) : null}
          {(data?.carpetas || []).map((c) => (
            <button type="button" key={c.ruta} className="folder-item" onClick={() => abrir(c.ruta)}>
              <Folder size={16} /> {c.nombre}
            </button>
          ))}
          {data && !data.carpetas.length ? <div className="empty">Sin subcarpetas</div> : null}
        </div>
        <div className="folder-actions">
          <span>{data?.ruta && contarPdfs ? `${data.pdfs} PDF en esta carpeta` : ''}</span>
          <button type="button" className="script-button" disabled={!data?.ruta} onClick={() => onElegir(data.ruta)}>
            <Check size={18} /> Usar esta carpeta
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Igual que estadoOrden del backend y la formula de la col L del Excel: con algun NO o A REVISAR es INCOMPLETA;
// COMPLETA cuando todos los renglones dicen SI, CAMBIO o DESAFECTADO
const OC_COMPLETO_OK = ['SI', 'CAMBIO', 'DESAFECTADO'];
function estadoOc(renglones) {
  return renglones.length && renglones.every((r) => OC_COMPLETO_OK.includes(r.completo)) ? 'COMPLETA' : 'INCOMPLETA';
}

// O.C. incompletas que vencen pronto: hasta 30 dias y de 31 a 60 dias (las ya vencidas aparte)
function diasParaVencer(vence) {
  const m = String(vence || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) - hoy) / 86400000);
}

function ocPorVencer(ordenes) {
  const grupos = { unMes: [], dosMeses: [], vencidas: [] };
  for (const o of ordenes) {
    if (o.estado === 'COMPLETA') continue;
    const dias = diasParaVencer(o.vence);
    if (dias === null) continue;
    const item = { ...o, dias, pendientes: o.renglones.filter((r) => !OC_COMPLETO_OK.includes(r.completo)).length };
    if (dias < 0) grupos.vencidas.push(item);
    else if (dias <= 30) grupos.unMes.push(item);
    else if (dias <= 60) grupos.dosMeses.push(item);
  }
  for (const k of Object.keys(grupos)) grupos[k].sort((a, b) => a.dias - b.dias);
  return grupos;
}

function AlertaVencimientos({ grupos, onVer, onCerrar }) {
  const lista = (titulo, items, clase) => (items.length ? (
    <>
      <h3 className={`oc-vto-titulo ${clase}`}>{titulo} ({items.length})</h3>
      <table className="oc-vto-tabla">
        <thead>
          <tr><th>N° O.C.</th><th>Proveedor</th><th>Vence</th><th style={{ textAlign: 'right' }}>Días</th><th style={{ textAlign: 'right' }}>Renglones sin completar</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td className="code">{o.oc}</td>
              <td>{o.proveedor}</td>
              <td>{o.vence}</td>
              <td style={{ textAlign: 'right' }}>{o.dias}</td>
              <td style={{ textAlign: 'right' }}>{o.pendientes}/{o.renglones.length}</td>
              <td><button type="button" className="ghost small" onClick={() => onVer(o)}>Ver</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  ) : null);
  return createPortal(
    <div className="folder-overlay" onClick={onCerrar}>
      <div className="folder-picker oc-vto" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <h2><AlertTriangle size={20} /> O.C. incompletas por vencer</h2>
          <button type="button" className="ghost small" onClick={onCerrar}>Entendido</button>
        </div>
        {lista('Vencen en menos de un mes (hasta 30 días)', grupos.unMes, 'urgente')}
        {lista('Vencen en uno a dos meses (31 a 60 días)', grupos.dosMeses, 'aviso')}
        {grupos.vencidas.length ? <p className="oc-vto-nota">Además hay {grupos.vencidas.length} O.C. incompletas ya vencidas.</p> : null}
      </div>
    </div>,
    document.body
  );
}

const OC_ESTADOS_ARCHIVO = {
  nuevo: { label: 'Nueva', className: 'listo' },
  ya_cargado: { label: 'Ya estaba', className: 'cargado' },
  duplicado: { label: 'Duplicado', className: 'iniciado' },
  error: { label: 'Error', className: 'error' }
};

function descargarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resumenDrive(r) {
  if (!r) return '';
  const partes = [`${r.agregadas || 0} renglones agregados`];
  if (r.vinculadas) partes.push(`${r.vinculadas} filas que ya estaban quedaron vinculadas`);
  if (r.haciaPlanilla) partes.push(`${r.haciaPlanilla} cambios enviados al archivo`);
  if (r.haciaBase) partes.push(`${r.haciaBase} cambios traídos del archivo`);
  if (r.postergada) partes.push('lo que va hacia el archivo espera a que dejen de editarlo');
  return partes.join(', ');
}

function AyudaDrive({ robot }) {
  return (
    <div className="oc-ayuda">
      <h4>Antes de empezar</h4>
      <p>
        El sistema escribe en Drive con un "robot" de Google: <span className="code">{robot || '(sin clave configurada)'}</span>.
        El robot no es tu cuenta: solo ve los archivos que le compartas. En Drive, abrí el archivo → <strong>Compartir</strong> →
        pegá ese mail → <strong>Editor</strong> → destildá "Notificar" → <strong>Compartir</strong>. Se hace una sola vez por archivo.
      </p>

      <h4>Elegir el archivo (primera vez)</h4>
      <ol>
        <li>Tocá <strong>Compartidos</strong> y elegí el archivo de la lista (o pegá su link y tocá <strong>Ver</strong>).</li>
        <li>
          Elegí cómo van las pestañas: <strong>Una pestaña por año</strong> (cada O.C. va a "O.C 2026", "O.C 2027"… y si no existe se crea sola)
          o <strong>Siempre en la misma pestaña</strong> (una que ya exista o una nueva).
        </li>
        <li><strong>Probar destino</strong>: muestra qué haría (cuántos renglones agrega y cuántos ya estaban) sin tocar el archivo.</li>
        <li><strong>Guardar destino</strong>: en un minuto se hace la primera actualización.</li>
      </ol>

      <h4>Cambiar a otro archivo</h4>
      <ol>
        <li>Tocá <strong>Cambiar destino</strong>.</li>
        <li>Tocá <strong>Compartidos</strong> y elegí el otro archivo. Si no aparece, primero compartilo con el robot como Editor.</li>
        <li>Elegí las pestañas (por año o fija; si es fija podés elegir una existente o crear una nueva).</li>
        <li><strong>Probar destino</strong> para ver qué haría y después <strong>Guardar destino</strong> (pide confirmación).</li>
      </ol>
      <ul>
        <li>El archivo anterior <strong>queda como está</strong>: no se borra nada, pero deja de recibir actualizaciones.</li>
        <li>En el archivo nuevo se buscan las O.C. que ya estén escritas y <strong>se vinculan sin duplicarse</strong>; las que falten se agregan al final, con lo cargado.</li>
        <li>El backup arranca de cero con el archivo nuevo. El último del anterior queda en <span className="code">D:\FARMACIA\ORDENES COMPRA\backup</span>.</li>
        <li>Podés volver al anterior cuando quieras con el mismo procedimiento (se vuelve a vincular sin duplicar).</li>
        <li>Se trabaja con <strong>un solo archivo a la vez</strong>.</li>
      </ul>

      <h4>Cómo se mantiene actualizado</h4>
      <ul>
        <li>Cada O.C. nueva que se sube acá se agrega sola al final de su pestaña. Las filas que ya existen nunca se borran ni se les cambia el formato.</li>
        <li>Entregada, Completo, N° de ingreso y Observación se pueden cargar acá o en el archivo: se sincroniza cada minuto. Si se cambia lo mismo en los dos lados, queda lo del archivo.</li>
        <li>La columna <strong>M "ID"</strong> (oculta) la usa el sistema para reconocer cada fila: no la borres.</li>
        <li><strong>Pausar</strong> frena la sincronización automática; <strong>Sincronizar ahora</strong> la fuerza en el momento.</li>
      </ul>

      <h4>Backup</h4>
      <ul>
        <li>Antes de cada cambio se guarda cómo estaba el archivo y se borra el backup anterior: siempre queda uno, el previo al último cambio.</li>
        <li>Está en Drive (clic derecho sobre el archivo → <strong>Administrar versiones</strong>, versión marcada "Conservar para siempre") y en el servidor (<span className="code">D:\FARMACIA\ORDENES COMPRA\backup</span>).</li>
        <li><strong>Restaurar backup</strong> vuelve el archivo a ese estado. Lo que tenía queda como backup nuevo (se puede deshacer) y la sincronización queda en pausa para que revises; después tocá <strong>Reanudar</strong>.</li>
      </ul>
    </div>
  );
}

// Sección "Archivo en Google Drive": destino (archivo + pestaña por año o fija), prueba, backup e historial
function DrivePanel({ client, onSincronizado }) {
  const [drive, setDrive] = useState(null);
  const [editando, setEditando] = useState(false);
  const [link, setLink] = useState('');
  const [archivos, setArchivos] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [modo, setModo] = useState('anual');
  const [prefijo, setPrefijo] = useState('O.C ');
  const [pestanaFija, setPestanaFija] = useState('');
  const [pestanaNueva, setPestanaNueva] = useState('');
  const [prueba, setPrueba] = useState(null);
  const [ayuda, setAyuda] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function cargar() {
    return client.ocDrive().then((data) => { setDrive(data); return data; });
  }

  useEffect(() => {
    cargar()
      .then((data) => { if (!data.destino.fileId) setEditando(true); })
      .catch((err) => setError(err.message));
    const timer = setInterval(() => { cargar().catch(() => {}); }, 60000);
    return () => clearInterval(timer);
  }, [client]);

  async function ejecutar(tipo, fn) {
    setBusy(tipo);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function empezarEdicion() {
    const d = drive?.destino || {};
    setModo(d.modo || 'anual');
    setPrefijo(d.prefijo ?? 'O.C ');
    setPestanaFija(d.pestanaFija || '');
    setPestanaNueva('');
    setPrueba(null);
    setArchivo(null);
    setLink(d.url || '');
    setEditando(true);
    if (d.fileId) ejecutar('ver', async () => setArchivo(await client.ocDriveInspeccionar(d.fileId)));
  }

  function verArchivo(valor) {
    ejecutar('ver', async () => {
      const data = await client.ocDriveInspeccionar(valor);
      setArchivo(data);
      setLink(data.url);
      setPrueba(null);
      if (modo === 'fija' && !data.pestanas.includes(pestanaFija)) setPestanaFija(data.pestanas[0] || '');
    });
  }

  function buscarArchivos() {
    ejecutar('archivos', async () => setArchivos((await client.ocDriveArchivos()).data));
  }

  const pestanaElegida = pestanaFija === '__nueva__' ? pestanaNueva.trim() : pestanaFija;
  const destinoForm = { fileId: archivo?.id, modo, prefijo, pestanaFija: modo === 'fija' ? pestanaElegida : null };
  const anioActual = new Date().getFullYear();

  function probar() {
    ejecutar('probar', async () => setPrueba(await client.ocDriveProbar(destinoForm)));
  }

  function guardar() {
    const cambiaArchivo = drive?.destino?.fileId && drive.destino.fileId !== archivo?.id;
    if (cambiaArchivo && !window.confirm(`¿Cambiar el destino a "${archivo.nombre}"? Las O.C. se van a vincular o agregar en ese archivo; el archivo anterior no se toca.`)) return;
    ejecutar('guardar', async () => {
      setDrive(await client.ocDriveGuardar(destinoForm));
      setEditando(false);
      setPrueba(null);
      setMessage('Destino guardado. La primera sincronización arranca en unos segundos.');
      setTimeout(() => { cargar().then(onSincronizado).catch(() => {}); }, 8000);
    });
  }

  function sincronizarAhora() {
    ejecutar('sync', async () => {
      const data = await client.ocDriveSincronizar();
      setDrive(data);
      await onSincronizado();
      setMessage(`Sincronizado: ${resumenDrive(data.resumen)}.`);
    });
  }

  function pausa(activo) {
    ejecutar('pausa', async () => setDrive(await client.ocDrivePausa(activo)));
  }

  function restaurar() {
    const b = drive?.destino?.backup;
    if (!window.confirm(`¿Volver el archivo a como estaba el ${new Date(b.fecha).toLocaleString('es-AR')}?\n\nLo que tiene ahora queda guardado como backup (se puede deshacer) y la sincronización queda en pausa para que revises.`)) return;
    ejecutar('restaurar', async () => {
      setDrive(await client.ocDriveRestaurar());
      await onSincronizado();
      setMessage('Archivo restaurado. La sincronización quedó en pausa: revisalo y tocá "Reanudar".');
    });
  }

  if (!drive) {
    return <section className="oc-form"><h3>3. Archivo en Google Drive</h3><p className="oc-help" style={{ marginTop: 0 }}>{error || 'Consultando...'}</p></section>;
  }
  const d = drive.destino;

  return (
    <section className="oc-form">
      <div className="oc-titulo">
        <h3>3. Archivo en Google Drive</h3>
        <button type="button" className="ghost small" onClick={() => setAyuda(!ayuda)}>
          <CircleHelp size={16} /> {ayuda ? 'Ocultar ayuda' : 'Ayuda'}
        </button>
      </div>
      {ayuda ? <AyudaDrive robot={drive.robot} /> : null}
      {!drive.claveConfigurada ? (
        <p className="oc-help" style={{ marginTop: 0 }}>Falta la clave de Google en el servidor (OC_GOOGLE_KEY_FILE en el .env del backend; ver README).</p>
      ) : (
        <>
          {d.fileId && !editando ? (
            <>
              <div className="oc-drive-estado">
                <span className={`status ${!d.activo ? 'iniciado' : drive.ultimoError ? 'error' : drive.ultimaSync ? 'listo' : 'iniciado'}`}>
                  {!d.activo ? 'En pausa' : drive.ultimoError ? 'Con error' : drive.enCurso ? 'Sincronizando...' : drive.ultimaSync ? 'Sincronizado' : 'Pendiente'}
                </span>
                <span><strong>{d.fileNombre}</strong> ({d.fileTipo === 'planilla' ? 'Planilla de Google' : 'Excel'}) · {d.modo === 'anual' ? `una pestaña por año: "${d.prefijo}${anioActual}"…` : `pestaña "${d.pestanaFija}"`}</span>
                {drive.ultimaSync ? <span>· última: {new Date(drive.ultimaSync).toLocaleString('es-AR')}</span> : null}
              </div>
              {drive.ultimoError ? <div className="alert">{drive.ultimoError}</div> : null}
              {!drive.ultimoError && drive.resumen?.postergada ? (
                <div className="oc-ayuda">
                  {drive.resumen.postergada.quien} está editando el archivo: sus cambios ya se traen a la base, pero el sistema no
                  escribe el Excel hasta las {new Date(drive.resumen.postergada.hasta).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} para
                  no bloquearle los cambios.
                </div>
              ) : null}
              <div className="oc-buttons">
                <a className="ghost oc-link" href={d.url} target="_blank" rel="noreferrer"><ExternalLink size={18} /> Abrir archivo</a>
                <button type="button" className="ghost" onClick={sincronizarAhora} disabled={!!busy}>
                  <RefreshCw size={18} /> {busy === 'sync' ? 'Sincronizando...' : 'Sincronizar ahora'}
                </button>
                <button type="button" className="ghost" onClick={() => pausa(!d.activo)} disabled={!!busy}>
                  {d.activo ? 'Pausar' : 'Reanudar'}
                </button>
                <button type="button" className="ghost" onClick={empezarEdicion} disabled={!!busy}>
                  <FolderOpen size={18} /> Cambiar destino
                </button>
              </div>
              <div className="oc-backup">
                <strong>Backup:</strong>{' '}
                {d.backup ? (
                  <>
                    estado del archivo antes del último cambio ({new Date(d.backup.fecha).toLocaleString('es-AR')}).
                    {d.fileTipo === 'excel' ? ' Versión fijada en Drive (Administrar versiones)' : ' Historial de versiones de la planilla'} + copia en el servidor: <span className="code">{d.backup.local}</span>
                    {d.fileTipo === 'excel' ? (
                      <button type="button" className="ghost small" onClick={restaurar} disabled={!!busy} style={{ marginLeft: 8 }}>
                        {busy === 'restaurar' ? 'Restaurando...' : 'Restaurar backup'}
                      </button>
                    ) : null}
                  </>
                ) : 'todavía no hubo cambios en el archivo.'}
              </div>
            </>
          ) : (
            <div className="oc-destino-form">
              <label>
                Archivo de Drive (pegá el link)
                <div className="oc-path">
                  <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
                  <button type="button" className="ghost" onClick={() => verArchivo(link)} disabled={!!busy || !link.trim()}>
                    <Search size={18} /> {busy === 'ver' ? 'Abriendo...' : 'Ver'}
                  </button>
                  <button type="button" className="ghost" onClick={buscarArchivos} disabled={!!busy}>
                    <FolderOpen size={18} /> {busy === 'archivos' ? 'Buscando...' : 'Compartidos'}
                  </button>
                </div>
              </label>
              <p className="oc-help">
                El archivo tiene que estar compartido como <strong>Editor</strong> con <span className="code">{drive.robot}</span>.
              </p>
              {archivos ? (
                <div className="oc-archivos">
                  {archivos.map((f) => (
                    <button type="button" key={f.id} className={`folder-item${archivo?.id === f.id ? ' active' : ''}`} onClick={() => verArchivo(f.id)}>
                      <FileSpreadsheet size={16} /> {f.nombre} <span className="oc-ext">({f.tipo === 'planilla' ? 'Planilla' : 'Excel'} · {f.duenio})</span>
                    </button>
                  ))}
                  {!archivos.length ? <div className="empty">No hay archivos compartidos con el robot</div> : null}
                </div>
              ) : null}

              {archivo ? (
                <>
                  <div className="notice">
                    <strong>{archivo.nombre}</strong> · {archivo.tipo === 'planilla' ? 'Planilla de Google' : 'Excel (.xlsx)'} ·
                    {archivo.puedeEditar ? ' el robot puede editarlo' : ' ⚠ el robot NO tiene permiso de Editor'} · pestañas: {archivo.pestanas.join(', ')}
                  </div>
                  <div className="oc-destino" style={{ marginTop: 12 }}>
                    <label className="checkline">
                      <input type="radio" name="oc-modo" checked={modo === 'anual'} onChange={() => { setModo('anual'); setPrueba(null); }} />
                      Una pestaña por año (automático)
                    </label>
                    <label className="checkline">
                      <input type="radio" name="oc-modo" checked={modo === 'fija'} onChange={() => { setModo('fija'); setPrueba(null); if (!pestanaFija) setPestanaFija(archivo.pestanas[0] || ''); }} />
                      Siempre en la misma pestaña
                    </label>
                  </div>
                  {modo === 'anual' ? (
                    <label>
                      Nombre de las pestañas (antes del año)
                      <div className="oc-path">
                        <input value={prefijo} onChange={(event) => { setPrefijo(event.target.value); setPrueba(null); }} style={{ maxWidth: 200 }} />
                        <span className="oc-ext">→ "{prefijo}{anioActual}", "{prefijo}{anioActual + 1}"… (si no existe, se crea)</span>
                      </div>
                    </label>
                  ) : (
                    <label>
                      Pestaña
                      <div className="oc-path">
                        <select value={pestanaFija} onChange={(event) => { setPestanaFija(event.target.value); setPrueba(null); }}>
                          {archivo.pestanas.map((p) => <option key={p} value={p}>{p}</option>)}
                          <option value="__nueva__">+ Crear pestaña nueva…</option>
                        </select>
                        {pestanaFija === '__nueva__' ? (
                          <input value={pestanaNueva} onChange={(event) => { setPestanaNueva(event.target.value); setPrueba(null); }} placeholder="Nombre de la pestaña nueva" />
                        ) : null}
                      </div>
                    </label>
                  )}
                  <div className="oc-buttons">
                    <button type="button" className="ghost" onClick={probar} disabled={!!busy || (modo === 'fija' && !pestanaElegida)}>
                      <Search size={18} /> {busy === 'probar' ? 'Probando...' : 'Probar destino'}
                    </button>
                    <button type="button" className="script-button" onClick={guardar} disabled={!!busy || !archivo.puedeEditar || (modo === 'fija' && !pestanaElegida)}>
                      <Save size={18} /> {busy === 'guardar' ? 'Guardando...' : 'Guardar destino'}
                    </button>
                    {d.fileId ? <button type="button" className="ghost" onClick={() => setEditando(false)} disabled={!!busy}>Cancelar</button> : null}
                  </div>
                  {prueba ? (
                    <div className="table-wrap" style={{ marginTop: 12 }}>
                      <table className="mini">
                        <thead>
                          <tr><th>Pestaña</th><th style={{ textAlign: 'right' }}>Se agregan</th><th style={{ textAlign: 'right' }}>Ya estaban (se vinculan)</th><th style={{ textAlign: 'right' }}>Cambios al archivo</th><th style={{ textAlign: 'right' }}>Cambios del archivo</th></tr>
                        </thead>
                        <tbody>
                          {prueba.pestanas.map((p) => (
                            <tr key={p.pestana}>
                              <td>{p.pestana}{p.crear ? ' (se crea)' : ''}</td>
                              <td style={{ textAlign: 'right' }}>{p.agregadas}</td>
                              <td style={{ textAlign: 'right' }}>{p.vinculadas}</td>
                              <td style={{ textAlign: 'right' }}>{p.haciaPlanilla}</td>
                              <td style={{ textAlign: 'right' }}>{p.haciaBase}</td>
                            </tr>
                          ))}
                          {!prueba.pestanas.length ? <tr><td colSpan={5} className="empty">No hay O.C. cargadas</td></tr> : null}
                        </tbody>
                      </table>
                      <p className="oc-help" style={{ padding: '0 10px 10px' }}>Es solo una prueba: todavía no se escribió nada en el archivo.</p>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}

          {error ? <div className="alert">{error}</div> : null}
          {message ? <div className="notice">{message}</div> : null}

          {drive.historial.length && !editando ? (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="mini">
                <thead>
                  <tr><th>Fecha</th><th>Acción</th><th>Archivo</th><th>Detalle</th><th>Por</th></tr>
                </thead>
                <tbody>
                  {drive.historial.map((h) => (
                    <tr key={h.id}>
                      <td>{new Date(h.fecha).toLocaleString('es-AR')}</td>
                      <td>{h.accion === 'restaurar' ? 'Restauró backup' : 'Actualizó'}</td>
                      <td>{h.archivo}</td>
                      <td>{h.accion === 'restaurar' ? '-' : resumenDrive(h.resumen)}</td>
                      <td>{h.usuario}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="oc-help">
            Las O.C. nuevas se agregan solas al archivo y lo cargado (entregada, completo, N° de ingreso, observación) se sincroniza cada minuto,
            acá o en el archivo (si se cambia lo mismo en los dos lados, queda lo del archivo). Antes de cada cambio se guarda un backup y se borra el anterior.
          </p>
        </>
      )}
    </section>
  );
}

const CRUCE_ESTADOS = {
  sin_stock_sin_oc: { label: 'Sin stock y sin O.C.', clase: 'error' },
  bajo_minimo_sin_oc: { label: 'Bajo el mínimo y sin O.C.', clase: 'error' },
  oc_sin_stock: { label: 'En O.C., no figura en el stock', clase: 'iniciado' },
  con_oc: { label: 'Con O.C.', clase: 'listo' },
  ok_sin_oc: { label: 'Stock OK sin O.C.', clase: 'cargado' }
};

// Pestaña de Ordenes de Compra: cruce por codigo de los renglones de O.C. con el ultimo
// stock descargado de Farmacia MS (card Stock Actual).
function CruceOcStock({ client }) {
  const [data, setData] = useState({ descarga: null, totalOrdenes: 0, data: [] });
  const [estado, setEstado] = useState('falta');
  const [search, setSearch] = useState('');
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [error, setError] = useState('');

  async function cargar() {
    try {
      setError('');
      setData(await client.ocCruceStock());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { cargar(); }, []);

  function toggle(codigo) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo); else next.add(codigo);
      return next;
    });
  }

  // Con O.C. pero lo pendiente de entrega no alcanza para llegar al minimo
  const noAlcanza = (f) => f.estado === 'con_oc' && f.stockMinimo != null && f.stockProyectado < f.stockMinimo;
  const cuenta = (pred) => data.data.filter(pred).length;
  const filtros = {
    falta: (f) => f.estado === 'sin_stock_sin_oc' || f.estado === 'bajo_minimo_sin_oc',
    sin_stock_sin_oc: (f) => f.estado === 'sin_stock_sin_oc',
    bajo_minimo_sin_oc: (f) => f.estado === 'bajo_minimo_sin_oc',
    con_oc: (f) => f.estado === 'con_oc',
    no_alcanza: noAlcanza,
    oc_sin_stock: (f) => f.estado === 'oc_sin_stock',
    ok_sin_oc: (f) => f.estado === 'ok_sin_oc',
    todos: () => true
  };
  const q = textoBusqueda(search.trim());
  const filas = data.data.filter((f) => (filtros[estado] || filtros.todos)(f)
    && (!q || textoBusqueda(`${f.codigo} ${f.nombre} ${f.concentracion} ${f.descripcionOc} ${f.ordenes.map((o) => `${o.oc} ${o.proveedor}`).join(' ')}`).includes(q)));

  if (!data.descarga && !error) {
    return (
      <div className="notice" style={{ marginTop: 12 }}>
        Todavía no hay stock descargado. Bajalo desde la card «Stock Actual (Farmacia MS)» y volvé a esta pestaña.
      </div>
    );
  }

  return (
    <div className="req-page">
      {error ? <div className="alert">{error}</div> : null}
      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Stock al {fmtFechaAr(data.descarga?.fecha_stock)} (descarga #{data.descarga?.id})</span>
        <span style={{ color: '#5b6b76' }}>{data.descarga?.sectores} · {data.totalOrdenes} O.C. cargadas</span>
        <button className="ghost small" onClick={cargar}><RefreshCw size={15} /> Actualizar</button>
      </section>

      <section className="summary-grid">
        <Metric label="Sin stock y sin O.C." value={cuenta(filtros.sin_stock_sin_oc)} />
        <Metric label="Bajo mínimo sin O.C." value={cuenta(filtros.bajo_minimo_sin_oc)} />
        <Metric label="Con O.C." value={cuenta(filtros.con_oc)} />
        <Metric label="Con O.C. que no alcanza" value={cuenta(noAlcanza)} />
        <Metric label="O.C. que no figuran en stock" value={cuenta(filtros.oc_sin_stock)} />
      </section>

      <section className="filters">
        <select value={estado} onChange={(event) => setEstado(event.target.value)}>
          <option value="falta">Falta pedir (sin stock o bajo mínimo, sin O.C.) ({cuenta(filtros.falta)})</option>
          <option value="sin_stock_sin_oc">Sin stock y sin O.C. ({cuenta(filtros.sin_stock_sin_oc)})</option>
          <option value="bajo_minimo_sin_oc">Bajo el mínimo y sin O.C. ({cuenta(filtros.bajo_minimo_sin_oc)})</option>
          <option value="con_oc">Con O.C. ({cuenta(filtros.con_oc)})</option>
          <option value="no_alcanza">Con O.C. pero no llega al mínimo ({cuenta(noAlcanza)})</option>
          <option value="oc_sin_stock">En O.C. y no figura en el stock ({cuenta(filtros.oc_sin_stock)})</option>
          <option value="ok_sin_oc">Stock OK sin O.C. ({cuenta(filtros.ok_sin_oc)})</option>
          <option value="todos">Todos ({data.data.length})</option>
        </select>
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar código, nombre, O.C. o proveedor" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </section>

      <ExportButton targetId="tabla-cruce-oc-stock" name="cruce-oc-stock" />
      <section className="table-wrap">
        <table id="tabla-cruce-oc-stock" className="compact">
          <thead>
            <tr>
              <th />
              <th>Código</th>
              <th>Producto (stock)</th>
              <th>Descripción en O.C.</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
              <th style={{ textAlign: 'right' }}>Mínimo</th>
              <th style={{ textAlign: 'right' }}>Máximo</th>
              <th>O.C.</th>
              <th style={{ textAlign: 'right' }}>Pedido</th>
              <th style={{ textAlign: 'right' }}>Pendiente</th>
              <th style={{ textAlign: 'right' }} title="Stock actual + pendiente de entrega">Stock + pendiente</th>
              <th>Situación</th>
            </tr>
          </thead>
          <tbody>
            {filas.flatMap((f) => {
              const est = CRUCE_ESTADOS[f.estado];
              const detalle = f.ordenes.length > 0 || f.similares.length > 0;
              const out = [(
                <tr key={f.codigo}>
                  <td>
                    {detalle ? (
                      <button type="button" className="ghost compact" onClick={() => toggle(f.codigo)} title="Ver detalle">
                        {abiertos.has(f.codigo) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    ) : null}
                  </td>
                  <td className="code">{f.codigo}</td>
                  <td>
                    {f.enStock ? <><b>{f.nombre}</b> {f.concentracion} <span style={{ color: '#5b6b76' }}>{f.forma}</span></> : <span style={{ color: '#9d1c1c' }}>no figura en el stock</span>}
                  </td>
                  <td>{f.descripcionOc || <span style={{ color: '#5b6b76' }}>—</span>}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{f.stock == null ? '-' : fmtCantidad(f.stock)}</td>
                  <td style={{ textAlign: 'right' }}>{f.stockMinimo == null ? '-' : fmtCantidad(f.stockMinimo)}</td>
                  <td style={{ textAlign: 'right' }}>{f.stockMaximo == null ? '-' : fmtCantidad(f.stockMaximo)}</td>
                  <td className="code" style={{ whiteSpace: 'normal' }}>{f.ordenes.map((o) => o.oc).join(', ') || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{f.ordenes.length ? fmtCantidad(f.pedido) : '-'}</td>
                  <td style={{ textAlign: 'right' }}>{f.ordenes.length ? fmtCantidad(f.pendiente) : '-'}</td>
                  <td style={{ textAlign: 'right' }}>{f.stockProyectado == null || !f.ordenes.length ? '-' : fmtCantidad(f.stockProyectado)}</td>
                  <td>
                    <span className={`status ${est.clase}`}>{est.label}</span>
                    {noAlcanza(f) ? <span className="status error" style={{ marginLeft: 4 }}>no llega al mínimo</span> : null}
                    {f.similares.length ? <span className="status iniciado" style={{ marginLeft: 4 }}>{f.similares.length} parecido(s) por nombre</span> : null}
                  </td>
                </tr>
              )];
              if (abiertos.has(f.codigo)) {
                out.push(
                  <tr key={`${f.codigo}-det`} className="detail-row">
                    <td colSpan={12}>
                      {f.ordenes.length ? (
                        <table className="compact" style={{ minWidth: 0 }}>
                          <thead>
                            <tr><th>O.C.</th><th>Proveedor</th><th>Renglón</th><th>Vence</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Entregada</th><th style={{ textAlign: 'right' }}>Pendiente</th><th>Completo</th></tr>
                          </thead>
                          <tbody>
                            {f.ordenes.map((o) => (
                              <tr key={`${o.oc}-${o.renglon}`}>
                                <td className="code">{o.oc}</td>
                                <td>{o.proveedor}</td>
                                <td>{o.renglon}</td>
                                <td>{fmtFechaAr(o.vence)}</td>
                                <td style={{ textAlign: 'right' }}>{fmtCantidad(o.cantidad)}</td>
                                <td style={{ textAlign: 'right' }}>{o.entregada == null ? '—' : fmtCantidad(o.entregada)}</td>
                                <td style={{ textAlign: 'right' }}>{fmtCantidad(o.pendiente)}</td>
                                <td>{o.completo || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                      {f.similares.length ? (
                        <div style={{ marginTop: 8 }}>
                          <b>En el stock hay productos parecidos por nombre (posible mismo producto con otro código):</b>
                          <ul style={{ margin: '4px 0 0 18px' }}>
                            {f.similares.map((s) => (
                              <li key={s.codigo}><span className="code">{s.codigo}</span> {s.nombre} · stock {fmtCantidad(s.stock)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              }
              return out;
            })}
            {!filas.length ? <tr><td colSpan={12} className="empty">Sin productos en esta categoría</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// Control con Farmacia MS: compara cada renglon de la pagina (y el Excel) contra lo que trajo el robot de
// pendientes de ingreso. Solo marca diferencias: no cambia nada.
const OC_DIF_TIPOS = {
  A: { clase: 'dif-rojo', titulo: 'Marcado entregado o completo, pero en Farmacia MS falta ingresar' },
  F: { clase: 'dif-rojo', titulo: 'Renglón que está en un lado y no en el otro' },
  B: { clase: 'dif-naranja', titulo: 'En Farmacia MS está todo ingresado, pero en la página no está marcado' },
  C: { clase: 'dif-amarillo', titulo: 'La cantidad entregada no coincide con la ingresada en Farmacia MS' },
  D: { clase: 'dif-amarillo', titulo: 'Marcado CAMBIO o DESAFECTADO, pero en Farmacia MS no está desafectado y figura faltante' },
  E: { clase: 'dif-amarillo', titulo: 'La cantidad no coincide con la adjudicada en Farmacia MS' },
  G: { clase: 'dif-gris', titulo: 'Sin dato de Farmacia MS o consulta vieja' }
};
const OC_DIAS_CONSULTA_VIEJA = 7;

// Abre el PDF de la O.C. en otra pestaña, en la pagina del renglon marcado en rojo.
// La pestaña se abre antes de pedir el PDF para que el navegador no la bloquee.
async function abrirPdfOc(client, ordenId, renglon, codigo) {
  const ventana = window.open('', '_blank');
  if (ventana) ventana.document.write('<p style="font-family:sans-serif;padding:24px">Abriendo el PDF de la O.C.…</p>');
  try {
    const { blob, pagina } = await client.ocPdf(ordenId, renglon, codigo);
    const url = URL.createObjectURL(blob);
    if (ventana) ventana.location.href = `${url}${pagina ? `#page=${pagina}` : ''}`;
    else window.open(url, '_blank');
    return pagina || renglon == null ? '' : `No se encontró el renglón ${renglon} dentro del PDF: se abrió sin marcar.`;
  } catch (err) {
    if (ventana) ventana.close();
    throw err;
  }
}

function diferenciasOc(o) {
  const difs = [];
  const agregar = (tipo, r, detalle) => difs.push({
    tipo, oc: o.oc, ordenId: o.id, proveedor: o.proveedor,
    renglon: r?.renglon ?? null, codigo: r?.codigo || '', descripcion: r?.descripcion || '', detalle
  });
  if (!o.ms) {
    agregar('G', null, 'Todavía no se consultó en Farmacia MS');
    return difs;
  }
  const fecha = new Date(o.ms.consultadoAt).toLocaleDateString('es-AR');
  if (!o.ms.encontrada) {
    agregar('G', null, `No se encontró en Farmacia MS (consultado el ${fecha})`);
    return difs;
  }
  const dias = Math.floor((Date.now() - new Date(o.ms.consultadoAt).getTime()) / 86400000);
  if (dias > OC_DIAS_CONSULTA_VIEJA) agregar('G', null, `La consulta a Farmacia MS es de hace ${dias} días (${fecha})`);

  for (const r of o.renglones) {
    const ms = r.ms;
    if (!ms) {
      agregar('F', r, 'Está en la página y no en Farmacia MS');
      continue;
    }
    const falta = ms.faltante ?? 0;
    const marca = r.completo || 'vacío';
    if (falta > 0 && (r.completo === 'SI' || (o.estado === 'COMPLETA' && !['CAMBIO', 'DESAFECTADO'].includes(r.completo)))) {
      agregar('A', r, `Página: ${marca}${o.estado === 'COMPLETA' ? ' (O.C. COMPLETA)' : ''} · Farmacia MS: faltan ${formatNumber(falta)} de ${formatNumber(ms.adjudicada)}`);
    }
    if (falta > 0 && ['CAMBIO', 'DESAFECTADO'].includes(r.completo) && !(ms.desafectada > 0)) {
      agregar('D', r, `Página: ${r.completo} · Farmacia MS: desafectada 0, faltan ${formatNumber(falta)}`);
    }
    if (falta === 0 && !OC_COMPLETO_OK.includes(r.completo)) {
      const msTexto = ms.desafectada > 0 && !ms.ingresada ? `desafectado ${formatNumber(ms.desafectada)}` : `ingresado ${formatNumber(ms.ingresada)} de ${formatNumber(ms.adjudicada)}`;
      agregar('B', r, `Farmacia MS: ${msTexto}, no falta nada · Página: ${marca}`);
    }
    if (ms.ingresada != null && Number(r.entregada ?? 0) !== ms.ingresada) {
      agregar('C', r, `Entregada en la página: ${r.entregada == null ? 'vacía' : formatNumber(r.entregada)} · Ingresada en Farmacia MS: ${formatNumber(ms.ingresada)}`);
    }
    if (ms.adjudicada != null && Number(r.cantidad) !== ms.adjudicada) {
      agregar('E', r, `Cantidad en la página: ${formatNumber(r.cantidad)} · Adjudicada en Farmacia MS: ${formatNumber(ms.adjudicada)}`);
    }
  }
  for (const r of o.ms.soloEnMs || []) {
    agregar('F', r, `Está en Farmacia MS (adjudicada ${formatNumber(r.adjudicada)}, faltan ${formatNumber(r.faltante)}) y falta en la página`);
  }
  return difs;
}

// la diferencia mas grave de una lista (para pintar la fila)
function difMasGrave(difs) {
  const orden = ['A', 'F', 'B', 'C', 'D', 'E', 'G'];
  return difs.slice().sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo))[0] || null;
}

function ControlMsTab({ client, ordenes, onVer, onRecargar }) {
  const [robot, setRobot] = useState({ enCurso: null, consultas: [] });
  const [tipo, setTipo] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const enCursoAntes = useRef(false);

  async function refrescarRobot() {
    try {
      const r = await client.ocPendientesMs();
      setRobot(r);
      // termino una consulta: se recargan las ordenes para ver lo nuevo
      if (enCursoAntes.current && !r.enCurso) onRecargar();
      enCursoAntes.current = Boolean(r.enCurso);
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => { refrescarRobot(); }, []);
  useEffect(() => {
    if (!robot.enCurso) return undefined;
    const timer = setInterval(refrescarRobot, 5000);
    return () => clearInterval(timer);
  }, [robot.enCurso]);

  async function verPdf(d) {
    setMessage('');
    try {
      const aviso = await abrirPdfOc(client, d.ordenId, d.renglon, d.codigo);
      if (aviso) window.alert(aviso);
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function actualizar() {
    setBusy(true);
    setMessage('');
    try {
      const r = await client.consultarPendientesMs({ todas: true });
      setMessage(`Robot iniciado: ${r.ocs.length} O.C. Tarda unos ${Math.max(1, Math.round(r.ocs.length * 3.5 / 60))} minutos; la tabla se actualiza sola al terminar.`);
      await refrescarRobot();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const todas = ordenes.flatMap(diferenciasOc);
  const conteo = Object.fromEntries(Object.keys(OC_DIF_TIPOS).map((t) => [t, todas.filter((d) => d.tipo === t)]));
  const texto = search.trim().toLowerCase();
  const visibles = todas
    .filter((d) => (tipo ? d.tipo === tipo : d.tipo !== 'G'))
    .filter((d) => !texto || d.oc.includes(texto) || d.proveedor.toLowerCase().includes(texto)
      || d.codigo.toLowerCase().includes(texto) || d.descripcion.toLowerCase().includes(texto));
  const ultima = robot.consultas[0];
  const ocsConDif = new Set(todas.filter((d) => d.tipo !== 'G').map((d) => d.oc));

  return (
    <>
      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <button className="script-button" onClick={actualizar} disabled={busy || Boolean(robot.enCurso)}>
          <RefreshCw size={18} /> {robot.enCurso ? 'Consultando Farmacia MS…' : `Actualizar desde Farmacia MS (${ordenes.length} O.C.)`}
        </button>
        {ultima ? (
          <span className={ultima.estado === 'error' ? 'dif-texto-error' : ''}>
            Última consulta: {new Date(ultima.started_at).toLocaleString('es-AR', { hour12: false })}
            {' · '}{ultima.estado === 'en_proceso' ? <strong>{ultima.hechas} de {ultima.total}</strong> : ultima.mensaje}
          </span>
        ) : <span>Todavía no se consultó Farmacia MS.</span>}
      </section>
      {message ? <div className="notice">{message}</div> : null}

      <section className="summary-grid">
        <Metric label="O.C. con diferencias" value={ocsConDif.size} />
        {Object.entries(OC_DIF_TIPOS).map(([t, info]) => (
          <button
            key={t}
            type="button"
            className={`metric dif-metric ${info.clase} ${tipo === t ? 'activo' : ''}`}
            title={info.titulo}
            onClick={() => setTipo(tipo === t ? '' : t)}
          >
            <span>{t}. {info.titulo}</span>
            <strong>{conteo[t].length}</strong>
          </button>
        ))}
      </section>

      <section className="filters">
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar O.C., proveedor, código o medicamento" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select value={tipo} onChange={(event) => setTipo(event.target.value)}>
          <option value="">Todas las diferencias (sin G)</option>
          {Object.entries(OC_DIF_TIPOS).map(([t, info]) => <option key={t} value={t}>{t}. {info.titulo}</option>)}
        </select>
        <span style={{ alignSelf: 'center', color: '#5b6b76' }}>{visibles.length} diferencias</span>
      </section>

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo</th><th>N° O.C.</th><th>Proveedor</th><th>Renglón</th><th>Código</th><th>Descripción</th><th>Diferencia</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((d, i) => (
              <tr key={`${d.oc}-${d.renglon}-${d.tipo}-${i}`} className={OC_DIF_TIPOS[d.tipo].clase}>
                <td title={OC_DIF_TIPOS[d.tipo].titulo}><strong>{d.tipo}</strong></td>
                <td className="code">{d.oc}</td>
                <td>{d.proveedor}</td>
                <td>{d.renglon ?? '—'}</td>
                <td className="code">{d.codigo}</td>
                <td>{d.descripcion}</td>
                <td>{d.detalle}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="ghost small" title="Abre el PDF de la O.C. con el renglón marcado en rojo" onClick={() => verPdf(d)}>Ver O.C.</button>{' '}
                  <button type="button" className="ghost small" title="Abre la O.C. en la lista" onClick={() => onVer(d)}>En la lista</button>
                </td>
              </tr>
            ))}
            {!visibles.length ? (
              <tr><td colSpan={8} className="empty">{todas.length ? 'No hay diferencias con este filtro' : 'Sin datos'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

function OrdenesCompraPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [ordenes, setOrdenes] = useState([]);
  const [carpetaPdf, setCarpetaPdf] = useState('');
  const [carpetaExcel, setCarpetaExcel] = useState('');
  const [nombre, setNombre] = useState('CONTROL_ORDENES_DE_COMPRA');
  const [destino, setDestino] = useState('pc');
  const [picker, setPicker] = useState(null);
  const [importacion, setImportacion] = useState(null);
  const [expandido, setExpandido] = useState(null);
  const [search, setSearch] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [pestana, setPestana] = useState('ordenes');
  const [error, setError] = useState('');
  // alerta de vencimientos: se abre sola al entrar (cuando llegan las ordenes) y se puede volver a abrir
  const [alertaVto, setAlertaVto] = useState('pendiente');

  function cargarOrdenes() {
    return client.ocOrdenes().then((data) => setOrdenes(data.data || []));
  }

  useEffect(() => {
    const prefs = leerPrefsOc();
    if (prefs?.destino) setDestino(prefs.destino);
    client.ocConfig()
      .then((cfg) => {
        setCarpetaPdf(prefs?.carpetaPdf || cfg.carpetaPdf);
        setCarpetaExcel(prefs?.carpetaExcel || cfg.carpetaExcel);
        setNombre(prefs?.nombre || cfg.nombre);
      })
      .catch((err) => setError(err.message));
    cargarOrdenes().catch((err) => setError(err.message));
    // lo que se carga en la planilla de Drive entra a la base en el sondeo: refrescar cada 60s
    const timer = setInterval(() => {
      if (!document.querySelector('.edit-inline')) cargarOrdenes().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [client]);

  function guardarPrefs(patch = {}) {
    try {
      localStorage.setItem(OC_PREFS_KEY, JSON.stringify({ carpetaPdf, carpetaExcel, nombre, destino, ...patch }));
    } catch {
      // sin almacenamiento local: solo no se recuerdan las carpetas
    }
  }

  async function ejecutar(tipo, fn) {
    setBusy(tipo);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function mensajeImportacion(data) {
    const partes = [`${data.nuevos} órdenes nuevas`];
    if (data.yaCargados) partes.push(`${data.yaCargados} ya estaban cargadas`);
    if (data.duplicados) partes.push(`${data.duplicados} duplicadas descartadas`);
    if (data.errores) partes.push(`${data.errores} con error`);
    return `Listo: ${partes.join(', ')}.`;
  }

  function subirPdf(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    ejecutar('subir', async () => {
      const data = await client.ocSubir(files);
      setImportacion(data);
      await cargarOrdenes();
      setMessage(mensajeImportacion(data));
    });
  }

  function importarCarpeta() {
    ejecutar('carpeta', async () => {
      const data = await client.ocImportarCarpeta(carpetaPdf);
      setImportacion(data);
      guardarPrefs();
      await cargarOrdenes();
      setMessage(mensajeImportacion(data));
    });
  }

  function generarExcel() {
    ejecutar('excel', async () => {
      guardarPrefs();
      if (destino === 'pc') {
        const blob = await client.ocExcelPc(nombre);
        descargarBlob(blob, `${nombre.replace(/\.xlsx$/i, '') || 'CONTROL_ORDENES_DE_COMPRA'}.xlsx`);
        setMessage('Excel descargado: quedó en la carpeta Descargas de esta PC.');
      } else {
        const data = await client.ocExcelServidor({ carpetaExcel, nombre });
        if (data.importadosDelExcel) await cargarOrdenes();
        const extra = data.importadosDelExcel ? ` Se pasaron a la base ${data.importadosDelExcel} renglones que estaban cargados a mano en ese Excel.` : '';
        setMessage(`Excel guardado en ${data.archivo} (${data.ordenes} órdenes, ${data.renglones} renglones).${extra}`);
      }
    });
  }

  function reemplazarRenglon(ordenId, renglonId, data) {
    setOrdenes((prev) => prev.map((o) => {
      if (o.id !== ordenId) return o;
      // lo de Farmacia MS no viene al guardar: se conserva el que tenia el renglon
      const renglones = o.renglones.map((r) => (r.id === renglonId ? { ...r, ...data, ms: r.ms } : r));
      return { ...o, renglones, estado: estadoOc(renglones) };
    }));
  }

  async function guardarRenglon(ordenId, renglonId, patch) {
    setError('');
    try {
      const { data } = await client.ocEditarRenglon(renglonId, patch);
      reemplazarRenglon(ordenId, renglonId, data);
    } catch (err) {
      setError(err.message);
    }
  }

  // Entregas parciales ("salieron 1000"): solo renglones de O.C. INCOMPLETAS
  const [entregaForm, setEntregaForm] = useState(null); // { ordenId, renglonId, cantidad, nroIngreso, observacion, fecha }
  const [verEntregas, setVerEntregas] = useState(null); // id del renglon con el historial abierto

  async function guardarEntrega(confirmarExceso = false) {
    const f = entregaForm;
    if (!f) return;
    setError('');
    try {
      const { data } = await client.ocAgregarEntrega(f.renglonId, {
        cantidad: f.cantidad, nroIngreso: f.nroIngreso, observacion: f.observacion, fecha: f.fecha, confirmarExceso
      });
      reemplazarRenglon(f.ordenId, f.renglonId, data);
      setEntregaForm(null);
      setVerEntregas(f.renglonId);
      setMessage(`Entrega de ${formatNumber(Number(String(f.cantidad).replace(/\./g, '')))} cargada en el renglón ${data.renglon}. Falta: ${formatNumber(Math.max(0, data.cantidad - (data.entregada || 0)))}${data.completo === 'SI' ? ' · renglón COMPLETO' : ''}.`);
    } catch (err) {
      if (err.data?.exceso && !confirmarExceso) {
        if (window.confirm(err.message)) return guardarEntrega(true);
        return;
      }
      setError(err.message);
    }
  }

  async function borrarEntrega(ordenId, renglonId, entrega) {
    if (!window.confirm(`¿Borrar la entrega de ${formatNumber(entrega.cantidad)} del ${entrega.fecha}? Se vuelve a sumar a lo que falta.`)) return;
    setError('');
    try {
      const { data } = await client.ocEliminarEntrega(entrega.id);
      reemplazarRenglon(ordenId, renglonId, data);
    } catch (err) {
      setError(err.message);
    }
  }

  function eliminarOrden(orden) {
    if (!window.confirm(`¿Eliminar la O.C. ${orden.oc} de ${orden.proveedor}? Se borra también lo cargado en sus renglones.`)) return;
    ejecutar('eliminar', async () => {
      await client.ocEliminar(orden.id);
      await cargarOrdenes();
      setMessage(`O.C. ${orden.oc} eliminada. Se puede volver a subir su PDF.`);
    });
  }

  // diferencias con Farmacia MS por O.C. (sin las de tipo G: sin dato o dato viejo)
  const difsPorOc = new Map(ordenes.map((o) => [o.id, diferenciasOc(o)]));
  const difsReales = (o) => difsPorOc.get(o.id).filter((d) => d.tipo !== 'G');
  const ocsConDif = ordenes.filter((o) => difsReales(o).length);
  const texto = search.trim().toLowerCase();
  const visibles = ordenes.filter((o) => {
    if (filtroEstado === 'DIFERENCIAS') {
      if (!difsReales(o).length) return false;
    } else if (filtroEstado && o.estado !== filtroEstado) return false;
    if (!texto) return true;
    return o.oc.toLowerCase().includes(texto)
      || o.proveedor.toLowerCase().includes(texto)
      || o.renglones.some((r) => r.codigo.toLowerCase().includes(texto) || r.descripcion.toLowerCase().includes(texto));
  });
  const totalRenglones = ordenes.reduce((acc, o) => acc + o.renglones.length, 0);
  // renglones resueltos: SI, CAMBIO o DESAFECTADO
  const renglonesCompletos = ordenes.reduce((acc, o) => acc + o.renglones.filter((r) => OC_COMPLETO_OK.includes(r.completo)).length, 0);
  const completas = ordenes.filter((o) => o.estado === 'COMPLETA').length;
  const resultados = importacion?.resultados || [];
  const porVencer = ocPorVencer(ordenes);
  const cantPorVencer = porVencer.unMes.length + porVencer.dosMeses.length;
  const mostrarAlertaVto = cantPorVencer > 0 && (alertaVto === 'abierta' || (alertaVto === 'pendiente' && ordenes.length > 0));

  function verOrdenControl(d) {
    setPestana('ordenes');
    setFiltroEstado('');
    setSearch(d.oc);
    setExpandido(d.ordenId);
  }

  function verOrdenVto(o) {
    setAlertaVto('cerrada');
    setPestana('ordenes');
    setFiltroEstado('');
    setSearch(o.oc);
    setExpandido(o.id);
  }

  return (
    <>
      <section className="page-title">
        <h2>Órdenes de Compra</h2>
      </section>
      <AyudaPagina id="ordenes" sub={pestana} />

      <section className="toolbar">
        <button className={`ghost ${pestana === 'ordenes' ? 'active' : ''}`} onClick={() => setPestana('ordenes')}>Órdenes de compra</button>
        <button className={`ghost ${pestana === 'cruce' ? 'active' : ''}`} onClick={() => setPestana('cruce')}>Cruce con stock</button>
        <button className={`ghost ${pestana === 'control' ? 'active' : ''}`} onClick={() => setPestana('control')}>
          Control con Farmacia MS{ocsConDif.length ? ` (${ocsConDif.length})` : ''}
        </button>
      </section>

      {pestana === 'cruce' ? <CruceOcStock client={client} /> : null}
      {pestana === 'control' ? <ControlMsTab client={client} ordenes={ordenes} onVer={verOrdenControl} onRecargar={() => cargarOrdenes().catch(() => {})} /> : null}

      {pestana === 'ordenes' ? (<>
      <section className="oc-form">
        <h3>1. Cargar PDF de O.C.</h3>
        <div className="oc-buttons" style={{ marginTop: 0 }}>
          <label className={`upload-button script-button${busy ? ' disabled' : ''}`}>
            <Upload size={18} /> {busy === 'subir' ? 'Subiendo...' : 'Subir PDF desde mi PC'}
            <input type="file" accept=".pdf,application/pdf" multiple onChange={subirPdf} disabled={!!busy} />
          </label>
        </div>
        <label>
          O tomar los PDF de una carpeta del servidor
          <div className="oc-path">
            <input value={carpetaPdf} onChange={(event) => setCarpetaPdf(event.target.value)} placeholder="D:\FARMACIA\ORDENES COMPRA" />
            <button type="button" className="ghost" onClick={() => setPicker('pdf')}><FolderOpen size={18} /> Elegir</button>
            <button type="button" className="ghost" onClick={importarCarpeta} disabled={!!busy || !carpetaPdf}>
              <RefreshCw size={18} /> {busy === 'carpeta' ? 'Leyendo...' : 'Importar carpeta'}
            </button>
          </div>
        </label>
        <p className="oc-help">
          Podés elegir varios PDF a la vez. Los que ya están cargados o vinieron bajados dos veces se detectan solos y no se repiten.
        </p>
      </section>

      {error ? <div className="alert">{error}</div> : null}
      {message ? <div className="notice">{message}</div> : null}

      {resultados.length ? (
        <section className="table-wrap">
          <table>
            <thead>
              <tr><th>PDF</th><th>Resultado</th><th>O.C.</th><th>Detalle</th></tr>
            </thead>
            <tbody>
              {resultados.map((r) => {
                const est = OC_ESTADOS_ARCHIVO[r.estado] || { label: r.estado, className: '' };
                return (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td><span className={`status ${est.className}`}>{est.label}</span></td>
                    <td className="code">{r.oc || '-'}</td>
                    <td>{r.estado === 'nuevo' ? `${r.proveedor} · ${r.renglones} renglones · ${formatPesos(r.total)}` : r.detalle}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {mostrarAlertaVto ? <AlertaVencimientos grupos={porVencer} onVer={verOrdenVto} onCerrar={() => setAlertaVto('cerrada')} /> : null}
      {cantPorVencer ? (
        <div className="alert oc-vto-banner">
          <AlertTriangle size={18} />
          <span>
            O.C. incompletas por vencer: <strong>{porVencer.unMes.length}</strong> en menos de un mes y <strong>{porVencer.dosMeses.length}</strong> en uno a dos meses.
          </span>
          <button type="button" className="ghost small" onClick={() => setAlertaVto('abierta')}>Ver detalle</button>
        </div>
      ) : null}

      {ocsConDif.length ? (
        <div className="alert oc-vto-banner dif-banner">
          <AlertTriangle size={18} />
          <span>
            Diferencias con Farmacia MS: <strong>{ocsConDif.length}</strong> O.C. y{' '}
            <strong>{ocsConDif.reduce((a, o) => a + new Set(difsReales(o).map((d) => d.renglon)).size, 0)}</strong> renglones no cuadran.
          </span>
          <button type="button" className="ghost small" onClick={() => setPestana('control')}>Ver diferencias</button>
          <button type="button" className="ghost small" onClick={() => { setFiltroEstado('DIFERENCIAS'); setSearch(''); }}>Filtrar la lista</button>
        </div>
      ) : null}

      <section className="summary-grid">
        <Metric label="Órdenes cargadas" value={ordenes.length} />
        <Metric label="Renglones" value={totalRenglones} />
        <Metric label="Órdenes completas" value={completas} />
        <Metric label="Órdenes incompletas" value={ordenes.length - completas} />
        <Metric label="Renglones completos" value={renglonesCompletos} />
        <Metric label="Renglones incompletos" value={totalRenglones - renglonesCompletos} />
      </section>

      <section className="oc-form">
        <h3>2. Excel de control</h3>
        <div className="oc-destino">
          <label className="checkline">
            <input type="radio" name="oc-destino" checked={destino === 'pc'} onChange={() => setDestino('pc')} />
            Descargar a mi PC (carpeta Descargas)
          </label>
          <label className="checkline">
            <input type="radio" name="oc-destino" checked={destino === 'servidor'} onChange={() => setDestino('servidor')} />
            Guardar en una carpeta del servidor
          </label>
        </div>
        {destino === 'servidor' ? (
          <label>
            Carpeta del servidor donde guardar el Excel
            <div className="oc-path">
              <input value={carpetaExcel} onChange={(event) => setCarpetaExcel(event.target.value)} placeholder="D:\FARMACIA\ORDENES COMPRA" />
              <button type="button" className="ghost" onClick={() => setPicker('excel')}><FolderOpen size={18} /> Elegir</button>
            </div>
          </label>
        ) : null}
        <label>
          Nombre del Excel
          <div className="oc-path">
            <input value={nombre} onChange={(event) => setNombre(event.target.value)} />
            <span className="oc-ext">.xlsx</span>
          </div>
        </label>
        <div className="oc-buttons">
          <button type="button" className="script-button" onClick={generarExcel} disabled={!!busy || !ordenes.length || (destino === 'servidor' && !carpetaExcel)}>
            {destino === 'pc' ? <Download size={18} /> : <FileSpreadsheet size={18} />}
            {busy === 'excel' ? ' Generando...' : destino === 'pc' ? ' Descargar Excel' : ' Guardar Excel en el servidor'}
          </button>
        </div>
        <p className="oc-help">
          El Excel sale de lo cargado en esta página. Si guardás en el servidor sobre un Excel que ya existe y alguien completó datos a mano ahí,
          esos datos se pasan primero a la base (solo en renglones que acá estaban vacíos).
        </p>
      </section>

      <DrivePanel client={client} onSincronizado={cargarOrdenes} />

      <section className="filters">
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar O.C., proveedor, código o medicamento" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select value={filtroEstado} onChange={(event) => setFiltroEstado(event.target.value)}>
          <option value="">Todas</option>
          <option value="INCOMPLETA">Incompletas</option>
          <option value="COMPLETA">Completas</option>
          <option value="DIFERENCIAS">Con diferencias con Farmacia MS</option>
        </select>
        <span style={{ alignSelf: 'center', color: '#5b6b76' }}>{visibles.length} órdenes</span>
      </section>

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>N° O.C.</th>
              <th>Proveedor</th>
              <th>Fecha</th>
              <th>Vence</th>
              <th style={{ textAlign: 'right' }}>Renglones</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Estado</th>
              <th title="Comparación con Farmacia MS (pendientes de ingreso)">Control MS</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((o) => {
              const abierto = expandido === o.id;
              const difsOc = difsPorOc.get(o.id);
              const reales = difsOc.filter((d) => d.tipo !== 'G');
              const grave = difMasGrave(reales);
              const difsRenglon = new Map();
              for (const d of difsOc) if (d.renglon != null) difsRenglon.set(d.renglon, [...(difsRenglon.get(d.renglon) || []), d]);
              const listos = o.renglones.filter((r) => OC_COMPLETO_OK.includes(r.completo)).length;
              return (
                <React.Fragment key={o.id}>
                  <tr className="clickable" onClick={() => setExpandido(abierto ? null : o.id)}>
                    <td>{abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td className="code">{o.oc}</td>
                    <td>{o.proveedor}</td>
                    <td>{o.fecha}</td>
                    <td>{o.vence}</td>
                    <td style={{ textAlign: 'right' }}>{listos}/{o.renglones.length}</td>
                    <td style={{ textAlign: 'right' }}>{formatPesos(o.subtotal)}</td>
                    <td><span className={`status ${o.estado === 'COMPLETA' ? 'listo' : 'error'}`}>{o.estado}</span></td>
                    <td>
                      {!o.ms || !o.ms.encontrada
                        ? <span className="dif-chip dif-gris" title={difsOc[0]?.detalle}>{o.ms ? 'No encontrada' : 'Sin consultar'}</span>
                        : reales.length
                          ? <span className={`dif-chip ${OC_DIF_TIPOS[grave.tipo].clase}`} title={reales.map((d) => `${d.tipo} · renglón ${d.renglon ?? '-'}: ${d.detalle}`).join('\n')}>⚠ {reales.length} {reales.length === 1 ? 'diferencia' : 'diferencias'}</span>
                          : <span className="dif-chip dif-ok" title="Coincide con Farmacia MS">✓ Coincide</span>}
                    </td>
                    <td>
                      <button type="button" className="ghost small" title="Eliminar O.C." onClick={(event) => { event.stopPropagation(); eliminarOrden(o); }} disabled={!!busy}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                  {abierto ? (
                    <tr className="detail-row">
                      <td colSpan={10}>
                        <div className="oc-ms-nota">
                          <button
                            type="button"
                            className="ghost small"
                            style={{ marginRight: 10 }}
                            onClick={() => abrirPdfOc(client, o.id).catch((err) => window.alert(err.message))}
                          >
                            Ver PDF de la O.C.
                          </button>
                          {o.ms
                            ? (o.ms.encontrada
                              ? `Farmacia MS (pendientes de ingreso): consultado el ${new Date(o.ms.consultadoAt).toLocaleString('es-AR', { hour12: false })}${o.ms.nroSolicitud ? ` · solicitud ${o.ms.nroSolicitud}` : ''}`
                              : `Farmacia MS: esta O.C. no se encontró (consultado el ${new Date(o.ms.consultadoAt).toLocaleString('es-AR', { hour12: false })})`)
                            : 'Farmacia MS: todavía no se consultó esta O.C. (card «Pendientes de Ingreso»)'}
                        </div>
                        <table className="oc-renglones">
                          <thead>
                            <tr>
                              <th>Renglón</th>
                              <th>Código</th>
                              <th>Descripción</th>
                              <th style={{ textAlign: 'right' }}>Cantidad</th>
                              <th style={{ textAlign: 'right' }}>Entregada</th>
                              <th style={{ textAlign: 'right' }}>Falta</th>
                              <th style={{ textAlign: 'right' }} title="Cantidad ingresada según Farmacia MS">Ingresado MS</th>
                              <th style={{ textAlign: 'right' }} title="Faltante de ingresar según Farmacia MS">Falta MS</th>
                              <th>Completo</th>
                              <th>N° de ingreso</th>
                              <th>Observación</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.renglones.map((r) => {
                              const falta = r.entregada == null ? r.cantidad : r.cantidad - r.entregada;
                              const difsR = difsRenglon.get(r.renglon) || [];
                              const graveR = difMasGrave(difsR);
                              const clase = graveR ? OC_DIF_TIPOS[graveR.tipo].clase : OC_COMPLETO_OK.includes(r.completo) ? 'oc-ok' : r.entregada != null && falta > 0 ? 'oc-parcial' : '';
                              return (
                                <React.Fragment key={r.id}>
                                <tr className={clase} title={difsR.map((d) => `${d.tipo}. ${OC_DIF_TIPOS[d.tipo].titulo}: ${d.detalle}`).join('\n') || undefined}>
                                  <td>{r.renglon}</td>
                                  <td className="code">{r.codigo}</td>
                                  <td>{r.descripcion}</td>
                                  <td style={{ textAlign: 'right' }}>{formatNumber(r.cantidad)}</td>
                                  <td style={{ textAlign: 'right', minWidth: 90 }}>
                                    {r.admiteEntregas || r.entregas?.length ? (
                                      <div className="oc-entregada">
                                        <span>{r.entregada == null ? '—' : formatNumber(r.entregada)}</span>
                                        {r.admiteEntregas ? (
                                          <button
                                            type="button"
                                            className="small"
                                            title="Cargar lo que salió: se descuenta de lo que falta"
                                            onClick={() => setEntregaForm({ ordenId: o.id, renglonId: r.id, cantidad: '', nroIngreso: '', observacion: '', fecha: '' })}
                                          >
                                            + Entrega
                                          </button>
                                        ) : null}
                                        {r.entregas?.length ? (
                                          <button type="button" className="link-btn" onClick={() => setVerEntregas(verEntregas === r.id ? null : r.id)}>
                                            {r.entregas.length} {r.entregas.length === 1 ? 'entrega' : 'entregas'}
                                          </button>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <EditableCell
                                        value={r.entregada == null ? '' : String(r.entregada)}
                                        display={r.entregada == null ? '—' : formatNumber(r.entregada)}
                                        onSave={(v) => guardarRenglon(o.id, r.id, { entregada: v })}
                                      />
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>{formatNumber(falta)}</td>
                                  <td style={{ textAlign: 'right' }}>{r.ms ? formatNumber(r.ms.ingresada) : '—'}</td>
                                  <td style={{ textAlign: 'right', fontWeight: r.ms?.faltante > 0 ? 700 : 400, color: r.ms?.faltante > 0 ? '#b42318' : undefined }}>
                                    {r.ms ? formatNumber(r.ms.faltante) : '—'}
                                  </td>
                                  <td>
                                    <select
                                      value={r.completo || ''}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={(event) => guardarRenglon(o.id, r.id, { completo: event.target.value })}
                                    >
                                      <option value="">-</option>
                                      <option value="SI">SI</option>
                                      <option value="NO">NO</option>
                                      <option value="CAMBIO">CAMBIO</option>
                                      <option value="DESAFECTADO">DESAFECTADO</option>
                                      <option value="A REVISAR">A REVISAR</option>
                                    </select>
                                  </td>
                                  <td style={{ minWidth: 110 }}>
                                    <EditableCell value={r.nroIngreso || ''} onSave={(v) => guardarRenglon(o.id, r.id, { nroIngreso: v })} />
                                  </td>
                                  <td style={{ minWidth: 160 }}>
                                    <EditableCell value={r.observacion || ''} onSave={(v) => guardarRenglon(o.id, r.id, { observacion: v })} />
                                  </td>
                                </tr>
                                {entregaForm?.renglonId === r.id ? (
                                  <tr className="oc-entrega-form">
                                    <td colSpan={11}>
                                      <form
                                        className="edit-inline"
                                        onSubmit={(event) => { event.preventDefault(); guardarEntrega(); }}
                                      >
                                        <strong>Renglón {r.renglon} · falta {formatNumber(falta)}</strong>
                                        <label>Salieron
                                          <input autoFocus inputMode="numeric" value={entregaForm.cantidad} onChange={(e) => setEntregaForm({ ...entregaForm, cantidad: e.target.value })} placeholder="1000" />
                                        </label>
                                        <label>N° de ingreso
                                          <input value={entregaForm.nroIngreso} onChange={(e) => setEntregaForm({ ...entregaForm, nroIngreso: e.target.value })} />
                                        </label>
                                        <label>Fecha
                                          <input type="date" value={entregaForm.fecha} onChange={(e) => setEntregaForm({ ...entregaForm, fecha: e.target.value })} />
                                        </label>
                                        <label>Observación
                                          <input value={entregaForm.observacion} onChange={(e) => setEntregaForm({ ...entregaForm, observacion: e.target.value })} />
                                        </label>
                                        <button type="submit" disabled={!String(entregaForm.cantidad).trim()}>Guardar entrega</button>
                                        <button type="button" className="ghost" onClick={() => setEntregaForm(null)}>Cancelar</button>
                                      </form>
                                    </td>
                                  </tr>
                                ) : null}
                                {verEntregas === r.id && r.entregas?.length ? (
                                  <tr className="oc-entregas-historial">
                                    <td colSpan={11}>
                                      <table>
                                        <thead>
                                          <tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Salieron</th><th>N° de ingreso</th><th>Observación</th><th>Cargó</th><th></th></tr>
                                        </thead>
                                        <tbody>
                                          {r.entregas.map((e) => (
                                            <tr key={e.id}>
                                              <td>{e.fecha}</td>
                                              <td style={{ textAlign: 'right' }}>{formatNumber(e.cantidad)}</td>
                                              <td>{e.nroIngreso || '—'}</td>
                                              <td>{e.observacion || ''}</td>
                                              <td>{e.origen === 'anterior' ? 'ya estaba' : e.origen === 'planilla' ? 'planilla de Drive' : (e.usuario || '')}</td>
                                              <td>
                                                {e.origen !== 'anterior' ? (
                                                  <button type="button" className="ghost small" onClick={() => borrarEntrega(o.id, r.id, e)}>Borrar</button>
                                                ) : null}
                                              </td>
                                            </tr>
                                          ))}
                                          <tr className="total">
                                            <td>Total</td>
                                            <td style={{ textAlign: 'right' }}>{formatNumber(r.entregada || 0)}</td>
                                            <td colSpan={4}>Falta {formatNumber(Math.max(0, falta))} de {formatNumber(r.cantidad)}</td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                ) : null}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
            {!visibles.length ? (
              <tr><td colSpan={10} className="empty">{ordenes.length ? 'Ninguna orden coincide con el filtro' : 'Todavía no hay órdenes cargadas. Subí los PDF arriba.'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
      </>) : null}

      {picker ? (
        <FolderPicker
          client={client}
          inicial={picker === 'pdf' ? carpetaPdf : carpetaExcel}
          titulo={picker === 'pdf' ? 'Carpeta de los PDF' : 'Carpeta donde guardar el Excel'}
          onCerrar={() => setPicker(null)}
          onElegir={(ruta) => {
            if (picker === 'pdf') setCarpetaPdf(ruta);
            else setCarpetaExcel(ruta);
            setPicker(null);
          }}
        />
      ) : null}
    </>
  );
}

function fmtFechaAr(value) {
  if (!value) return '-';
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split('-');
  return d ? `${d}/${m}/${y}` : s;
}

function fmtFechaHoraAr(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtCantidad(value) {
  return Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function fmtMillones(value) {
  return `$ ${(Number(value || 0) / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M`;
}

function textoBusqueda(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

// Forma farmaceutica a partir de la descripcion del catalogo, para no mezclar
// en el analisis por droga un comprimido con una suspension o una ampolla.
// El orden importa: "SUSPENSION INYECTABLE" es inyectable, "SUSPENSION PARA INHALACION" inhalatoria.
const FORMAS_FARMACEUTICAS = [
  ['Oftálmico', /OFTALM/],
  ['Inhalatorio', /INHALA|NEBULIZ|AEROCAMARA|AEROSOL/],
  ['Inyectable', /INYECTABLE|AMPOLLA|INTRAVENOSO|I\.V\./],
  ['Comprimido / cápsula', /COMPRIMIDO|CAPSULA/],
  ['Óvulo', /OVULO/],
  ['Tópico', /CREMA|UNGUENTO|LOCION|CUTANEA|TOPICO|SPRAY|GEL\b/],
  ['Bucal', /COLUTORIO/],
  ['Oral líquido / polvo', /SUSPENSI|JARABE|SOLUCION ORAL|GOTAS|POLVO/]
];

function formaFarmaceutica(descripcion) {
  const texto = textoBusqueda(descripcion);
  const forma = FORMAS_FARMACEUTICAS.find(([, regex]) => regex.test(texto));
  return forma ? forma[0] : 'Otra';
}

// Concentracion(es) que figuran en la descripcion: "250MG/5ML", "0.5MG", "100MCG/DOSIS".
// Se normaliza (sin espacios, GR -> G, U.I. -> UI, coma decimal -> punto) para comparar.
const CONCENTRACION_REGEX = /\d+(?:[.,]\d+)*\s*(?:MCG|MG|GR|G|U\.?I\.?|ML|CC|%)(?![A-Z])(?:\s*\/\s*\d*(?:[.,]\d+)?\s*(?:ML|GR|G|DOSIS|L)(?![A-Z]))?/g;

function concentracionDe(descripcion) {
  const texto = textoBusqueda(descripcion);
  const vistas = [];
  for (const m of texto.match(CONCENTRACION_REGEX) || []) {
    const valor = m.replace(/\s+/g, '').replace(/U\.?I\.?/, 'UI').replace(/GR/g, 'G').replace(/(\d),(\d)/g, '$1.$2');
    if (!vistas.includes(valor)) vistas.push(valor);
  }
  return vistas.join(' + ');
}

// "VARIOS 2 802892.pdf · req. 802892/2027 (hoja 2, ítem 14)": archivo primero, despues requerimiento, hoja e item.
function ubicacionItem(it) {
  const donde = [it.hoja ? `hoja ${it.hoja}` : null, `ítem ${it.item_nro}`].filter(Boolean).join(', ');
  const req = `req. ${it.numero}/${it.anio_numero} (${donde})`;
  return it.archivo_nombre ? `${it.archivo_nombre} · ${req}` : req;
}

// Agrupa los items de requerimiento por una clave (codigo o droga).
function agruparRequerimiento(items, claveDe) {
  const grupos = new Map();
  for (const it of items) {
    const clave = claveDe(it);
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, codigo: it.codigo, sigaf: it.codigo_sigaf, droga: it.droga, forma: it.forma, concentracion: it.concentracion, descripcion: it.descripcion, items: [], ubicaciones: [], codigos: new Set(), reqs: new Set(), precios: new Set(), cantidad: 0, total: 0 };
      grupos.set(clave, g);
    }
    g.items.push(it);
    g.codigos.add(it.codigo);
    g.reqs.add(`${it.numero}/${it.anio_numero}`);
    const ubicacion = ubicacionItem(it);
    if (!g.ubicaciones.includes(ubicacion)) g.ubicaciones.push(ubicacion);
    if (it.justiprecio != null) g.precios.add(Number(it.justiprecio));
    g.cantidad += Number(it.cantidad || 0);
    g.total += Number(it.total || 0);
  }
  return Array.from(grupos.values()).map((g) => {
    const precios = Array.from(g.precios).sort((a, b) => a - b);
    return {
      ...g,
      veces: g.items.length,
      precioMin: precios[0] ?? null,
      precioMax: precios[precios.length - 1] ?? null,
      precioDistinto: precios.length > 1,
      // Mismo codigo dos veces dentro de un mismo requerimiento
      repetidoMismoReq: g.items.length > g.reqs.size
    };
  });
}

const SITUACION_STOCK = {
  no_figura: { label: 'no figura en el stock', clase: 'iniciado' },
  sin_stock: { label: 'sin stock', clase: 'error' },
  con_stock: { label: 'con stock', clase: 'listo' }
};
const FILTROS_STOCK = {
  todos: { label: 'Todos los códigos requeridos', pred: () => true },
  sin_stock: { label: 'Requeridos sin stock', pred: (f) => f.situacion === 'sin_stock' },
  con_stock: { label: 'Requeridos con stock', pred: (f) => f.situacion === 'con_stock' },
  no_figura: { label: 'Requeridos que no figuran en el stock', pred: (f) => f.situacion === 'no_figura' },
  no_requerido: { label: 'Sin stock y NO requeridos', pred: () => false }
};
// Cruce del requerimiento con el historial de O.C. de Drive, por semestre (segun vencimiento de la O.C.)
const SITUACION_OC = {
  sin_oc: { label: 'sin compras en el historial', clase: 'error' },
  mayor: { label: 'pide más que el mismo semestre del año anterior', clase: 'iniciado' },
  menor_igual: { label: 'pide igual o menos que el mismo semestre del año anterior', clase: 'listo' },
  otro_periodo: { label: 'comprado en otros años, no en el mismo semestre del año anterior', clase: 'cargado' }
};
const FILTROS_OC = {
  todos: { label: 'Todos los códigos requeridos', pred: () => true },
  con_oc: { label: 'Requeridos con compras en el historial', pred: (f) => f.situacion !== 'sin_oc' },
  sin_oc: { label: 'Requeridos sin compras en el historial', pred: (f) => f.situacion === 'sin_oc' },
  mayor: { label: 'Pide más que el mismo semestre del año anterior', pred: (f) => f.situacion === 'mayor' },
  menor_igual: { label: 'Pide igual o menos que el mismo semestre del año anterior', pred: (f) => f.situacion === 'menor_igual' },
  otro_periodo: { label: 'Comprados en otros años (no el anterior)', pred: (f) => f.situacion === 'otro_periodo' },
  no_requerido: { label: 'Comprados en el mismo semestre del año anterior y NO pedidos en este ciclo', pred: () => false }
};

// Cruce del requerimiento con la comunicacion de compra del Ministerio (HABILITADO COMPRA)
const SITUACION_MIN = {
  no: { label: 'el Ministerio dijo NO', clase: 'error' },
  parcial: { label: 'comprar por 3 meses', clase: 'iniciado' },
  comprar: { label: 'habilitado para comprar', clase: 'listo' },
  otro: { label: 'revisar habilitación', clase: 'iniciado' },
  nombre: { label: 'posible mismo producto con otro código', clase: 'error' },
  no_en_lista: { label: 'no está en la lista del Ministerio', clase: 'cargado' }
};
// Cruce por nombre con el Ministerio, solo si coinciden droga + forma + concentracion (y hay concentracion)
const PALABRAS_SAL = new Set(['CLORHIDRATO', 'DE', 'SODICO', 'SODICA', 'ACETATO', 'SULFATO', 'BROMURO', 'FOSFATO', 'CITRATO', 'ACIDO', 'DEL', 'LA']);
function claveProducto(nombre, descripcionCompleta) {
  const palabras = textoBusqueda(nombre).replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const droga = palabras.find((w) => w.length > 2 && !PALABRAS_SAL.has(w)) || '';
  const conc = concentracionDe(descripcionCompleta);
  if (!droga || !conc) return null;
  return `${droga}|${formaFarmaceutica(descripcionCompleta)}|${conc}`;
}

// Diferencias: lo comprado en O.C. y no requerido, segun lo que dijo el Ministerio del ciclo
const FILTROS_DIF_MIN = {
  todos: { label: 'Todos', pred: () => true },
  no: { label: 'El Ministerio dijo NO (por código)', pred: (f) => f.min && !f.min.porNombre && f.min.decision === 'no' },
  posible: { label: 'Posible por nombre (revisar)', pred: (f) => f.min?.porNombre },
  comprar: { label: 'Habilitados (COMPRAR)', pred: (f) => f.min && !f.min.porNombre && f.min.decision === 'comprar' },
  parcial: { label: 'Comprar por 3 meses / parcial', pred: (f) => f.min && !f.min.porNombre && (f.min.decision === 'parcial' || f.min.decision === 'otro') },
  fuera: { label: 'No están en la lista del Ministerio', pred: (f) => !f.min }
};

// Droga = primera palabra significativa del nombre (sin sales ni "acido"), para los posibles por nombre
function drogaDe(nombre) {
  const palabras = textoBusqueda(nombre).replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  return palabras.find((w) => w.length > 2 && !PALABRAS_SAL.has(w)) || '';
}

// Lista completa de la comunicacion del Ministerio (se haya pedido o no)
const FILTROS_LISTA_MIN = {
  no: { label: 'El Ministerio dijo NO', pred: (m) => m.decision === 'no' },
  comprar: { label: 'Habilitados (COMPRAR)', pred: (m) => m.decision === 'comprar' },
  parcial: { label: 'Comprar por 3 meses / parcial', pred: (m) => m.decision === 'parcial' || m.decision === 'otro' },
  todos: { label: 'Toda la lista', pred: () => true }
};

const FILTROS_MIN = {
  todos: { label: 'Todos los códigos pedidos', pred: () => true },
  no: { label: 'Pedidos y el Ministerio dijo NO', pred: (f) => f.situacion === 'no' },
  parcial: { label: 'Pedidos para comprar por 3 meses', pred: (f) => f.situacion === 'parcial' || f.situacion === 'otro' },
  comprar: { label: 'Pedidos y habilitados para comprar', pred: (f) => f.situacion === 'comprar' },
  nombre: { label: 'Posible mismo producto con otro código (por nombre)', pred: (f) => f.situacion === 'nombre' },
  no_en_lista: { label: 'Pedidos que no están en la lista del Ministerio', pred: (f) => f.situacion === 'no_en_lista' },
  habilitado_no_pedido: { label: 'Habilitados por el Ministerio y NO pedidos', pred: () => false }
};

// "2026-1" = 1er semestre 2026; "2026-0" = O.C. sin fecha de vencimiento (solo se sabe el año)
function clavePeriodo(h) {
  return `${h.anio}-${h.semestre || 0}`;
}

function etiquetaPeriodo(clave) {
  const [anio, sem] = String(clave || '').split('-');
  if (!anio) return '-';
  return sem === '0' ? `${anio} sin fecha` : `${sem === '1' ? '1er' : '2do'} sem ${anio}`;
}

// Selector de producto con buscador, para atar un renglon de O.C. a un codigo pedido.
// productos: [{ codigo, texto }]; sugeridos: codigos a mostrar primero (misma droga que el renglon).
const ESTADOS_OC = [{ codigo: 'NINGUNO', texto: 'No corresponde a ningún pedido' }];

function SelectorProducto({ valor, textoVacio, productos, sugeridos = [], onElegir, estados = ESTADOS_OC }) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const cerrar = (event) => { if (ref.current && !ref.current.contains(event.target)) setAbierto(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  const q = textoBusqueda(busqueda.trim());
  const ordenados = [
    ...productos.filter((p) => sugeridos.includes(p.codigo)),
    ...productos.filter((p) => !sugeridos.includes(p.codigo))
  ];
  const visibles = ordenados.filter((p) => !q || textoBusqueda(`${p.codigo} ${p.texto}`).includes(q)).slice(0, 60);
  const estadoActual = estados.find((e) => e.codigo === valor);
  const actual = estadoActual ? estadoActual.texto : valor ? `${valor} · ${(productos.find((p) => p.codigo === valor) || {}).texto || ''}` : textoVacio;

  function elegir(codigo) {
    setAbierto(false);
    setBusqueda('');
    onElegir(codigo);
  }

  const opcion = (key, texto, codigo, destacado) => (
    <button
      key={key}
      type="button"
      onClick={() => elegir(codigo)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 0, borderBottom: '1px solid #eef2f5',
        background: valor === codigo ? '#e7f1fb' : destacado ? '#fffbea' : '#fff', cursor: 'pointer', fontSize: 13,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}
      title={texto}
    >
      {texto}
    </button>
  );

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="ghost small"
        onClick={() => setAbierto((v) => !v)}
        style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
        title={actual}
      >
        {actual} ▾
      </button>
      {abierto ? (
        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, width: 420, maxWidth: '80vw', background: '#fff', border: '1px solid #cdd9e3', borderRadius: 6, boxShadow: '0 6px 20px rgba(0,0,0,.15)', zIndex: 50 }}>
          <div style={{ padding: 8, borderBottom: '1px solid #e2e8ed' }}>
            <input
              autoFocus
              type="search"
              placeholder="Buscar código o producto…"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 13, border: '1px solid #cdd9e3', borderRadius: 4 }}
            />
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {opcion('auto', textoVacio, '', false)}
            {estados.map((e) => opcion(`estado-${e.codigo}`, e.texto, e.codigo, false))}
            {visibles.length ? <div style={{ padding: '4px 10px', fontSize: 12, color: '#5b6b76', background: '#f6f8fa' }}>Atar a otro código:</div> : null}
            {visibles.map((p) => opcion(p.codigo, `${p.codigo} · ${p.texto}`, p.codigo, sugeridos.includes(p.codigo)))}
            {!visibles.length ? <div style={{ padding: 10, color: '#5b6b76', fontSize: 13 }}>Sin coincidencias</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Casillas para mostrar u ocultar las columnas de cada semestre / año
function ColumnasPeriodo({ periodos, ocultos, onCambiar }) {
  if (!periodos.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', margin: '8px 2px', fontSize: 14 }}>
      <span style={{ fontWeight: 700 }}>Columnas de períodos:</span>
      {periodos.map((k) => (
        <label key={k} className="checkline" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={!ocultos.includes(k)} onChange={() => onCambiar(ocultos.includes(k) ? ocultos.filter((x) => x !== k) : [...ocultos, k])} />
          {etiquetaPeriodo(k)}
        </label>
      ))}
      {ocultos.length ? <button type="button" className="ghost small" onClick={() => onCambiar([])}>Mostrar todas</button> : null}
    </div>
  );
}

// Filtro por situacion con todas las opciones a la vista (en vez de un desplegable)
function FiltroSituacion({ opciones, valor, onCambiar, titulo = 'Filtrar por situación:' }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', width: '100%' }}>
      <span style={{ fontWeight: 700 }}>{titulo}</span>
      {opciones.map((o) => (
        <button
          key={o.clave}
          type="button"
          className={`ghost small ${valor === o.clave ? 'active' : ''}`}
          style={valor === o.clave ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined}
          onClick={() => onCambiar(valor === o.clave && o.clave !== 'todos' ? 'todos' : o.clave)}
        >
          {o.label} ({o.cantidad})
        </button>
      ))}
    </div>
  );
}

// Marcas manuales para pedidos sin consumo (se guardan en consumo_vinculos en lugar de un codigo).
// NINGUNO es la marca vieja ("no figura"). Si el codigo despues aparece en el consumo, la marca deja de valer.
const ESTADOS_CONSUMO = [
  { codigo: 'NUEVO', texto: 'Fármaco nuevo (sin consumo previo)', corto: 'nuevo', situacion: 'nuevo', color: '#1d5fa8', fondo: '#e7f1fb' },
  { codigo: 'OTRO_SECTOR', texto: 'Se consume en otro sector', corto: 'otro sector', situacion: 'otro_sector', color: '#6b3fa0', fondo: '#f3ecfb' },
  { codigo: 'DISCONTINUADO', texto: 'Discontinuado / reemplazado', corto: 'discontinuado', situacion: 'discontinuado', color: '#5b6b76', fondo: '#eef1f4' },
  { codigo: 'NO_MEDICAMENTO', texto: 'No es medicamento (reactivo / insumo)', corto: 'no es medicamento', situacion: 'no_medicamento', color: '#5b6b76', fondo: '#eef1f4' },
  { codigo: 'NINGUNO', texto: 'No figura en el consumo', corto: 'no figura', situacion: 'no_figura', color: '#5b6b76', fondo: '#eef1f4' }
];
const ESTADO_CONSUMO = Object.fromEntries(ESTADOS_CONSUMO.map((e) => [e.codigo, e]));

// Celda de consumo vacia: muestra la marca (nuevo, otro sector...) en vez de "-"
function MarcaConsumo({ enlace }) {
  const e = enlace?.via === 'estado' ? ESTADO_CONSUMO[enlace.estado] : null;
  if (!e) return '-';
  return <span style={{ fontSize: 12, fontWeight: 700, color: e.color, background: e.fondo, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{e.corto}</span>;
}

// Pronostico mensual de consumo de un producto (indice de mes = anio*12 + mes-1):
// 1) Valores atipicos: los meses por encima de Q3 + 1,5*IQR se recortan a ese tope (picos puntuales).
// 2) Nivel: suavizado exponencial simple (alfa 0,3) sobre la serie recortada; pesa mas lo reciente.
// 3) Estacionalidad: indice del mismo mes de anios anteriores (valor / promedio de ese anio movil).
//    Con pocos anios de historia el indice se achica hacia 1 (factor n/(n+1)) y se limita a 0,5-2.
// 4) Variabilidad: desvio estandar de los residuos (real - nivel*indice) para un rango aprox. del 80 %.
const ALFA_SUAVIZADO = 0.3;
function cuantil(ordenados, q) {
  if (!ordenados.length) return 0;
  const pos = (ordenados.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  return ordenados[base] + (ordenados[base + 1] !== undefined ? resto * (ordenados[base + 1] - ordenados[base]) : 0);
}
function pronosticoConsumo(meses, cerrados, objetivos) {
  const vacio = { porMes: new Map(objetivos.map((idx) => [idx, 0])), nivel: 0, sd: 0, indices: new Map(objetivos.map((idx) => [idx, 1])), recortados: 0, n: 0 };
  if (!meses || !cerrados.length) return vacio;
  const crudos = cerrados.map((idx) => Number(meses[idx] || 0));
  const ord = [...crudos].sort((a, b) => a - b);
  const q1 = cuantil(ord, 0.25);
  const q3 = cuantil(ord, 0.75);
  const tope = q3 + 1.5 * (q3 - q1);
  let recortados = 0;
  const serie = new Map(cerrados.map((idx, i) => {
    if (tope > 0 && crudos[i] > tope) { recortados += 1; return [idx, tope]; }
    return [idx, crudos[i]];
  }));
  const valores = cerrados.map((idx) => serie.get(idx));
  const media = valores.reduce((a, v) => a + v, 0) / valores.length;
  if (!media) return { ...vacio, n: valores.length };
  // Promedio movil de 12 meses centrado en cada mes (o lo que haya), para el indice estacional
  const mediaAnual = (idx) => {
    const ventana = cerrados.filter((x) => Math.abs(x - idx) <= 6);
    return ventana.length ? ventana.reduce((a, x) => a + serie.get(x), 0) / ventana.length : media;
  };
  // Demanda intermitente (mas de 30 % de meses en cero): los picos no son estacionalidad, se usa la tasa media
  const intermitente = valores.filter((v) => v === 0).length / valores.length > 0.3;
  // Cuanto mas variable es la serie (coef. de variacion), mas se achica el indice hacia 1
  const cv = Math.sqrt(valores.reduce((a, v) => a + (v - media) ** 2, 0) / Math.max(1, valores.length - 1)) / media;
  const indiceMes = (idx) => {
    if (intermitente) return 1;
    const previos = cerrados.filter((x) => x < idx && (idx - x) % 12 === 0);
    if (!previos.length) return 1;
    const crudo = previos.reduce((a, x) => a + (mediaAnual(x) ? serie.get(x) / mediaAnual(x) : 1), 0) / previos.length;
    const peso = previos.length / (previos.length + 1 + cv);
    return Math.min(1.6, Math.max(0.6, 1 + peso * (crudo - 1)));
  };
  // Nivel desestacionalizado con suavizado exponencial (intermitente: tasa media del periodo)
  let nivel = intermitente ? media : valores[0] / indiceMes(cerrados[0]);
  const residuos = [];
  cerrados.forEach((idx, i) => {
    const ind = indiceMes(idx);
    if (i > 0) residuos.push(valores[i] - nivel * ind);
    if (!intermitente) nivel = ALFA_SUAVIZADO * (valores[i] / ind) + (1 - ALFA_SUAVIZADO) * nivel;
  });
  const sd = residuos.length > 1 ? Math.sqrt(residuos.reduce((a, r) => a + r * r, 0) / (residuos.length - 1)) : 0;
  const indices = new Map(objetivos.map((idx) => [idx, indiceMes(idx)]));
  return { porMes: new Map(objetivos.map((idx) => [idx, Math.max(0, nivel * indices.get(idx))])), nivel, sd, indices, recortados, intermitente, cv, n: valores.length };
}

// Pedido del ciclo contra el consumo real (Farmacia MS): ratio = pedido / consumo semestral esperado
const SITUACION_CONSUMO = {
  de_mas: { label: 'pide de más (sobre el rango estimado)', clase: 'error' },
  de_menos: { label: 'pide de menos (bajo el rango estimado)', clase: 'iniciado' },
  acorde: { label: 'dentro del rango estimado', clase: 'listo' },
  sin_consumo: { label: 'sin consumo en el último año', clase: 'error' },
  no_figura: { label: 'no figura en el consumo', clase: 'cargado' },
  nuevo: { label: 'fármaco nuevo (sin consumo previo)', clase: 'listo' },
  otro_sector: { label: 'se consume en otro sector', clase: 'cargado' },
  discontinuado: { label: 'discontinuado / reemplazado', clase: 'cargado' },
  no_medicamento: { label: 'no es medicamento', clase: 'cargado' }
};
const FILTROS_CONSUMO = {
  todos: { label: 'Todos los códigos pedidos', pred: () => true },
  de_mas: { label: 'Pide de más (sobre el rango)', pred: (f) => f.situacion === 'de_mas' },
  de_menos: { label: 'Pide de menos (bajo el rango)', pred: (f) => f.situacion === 'de_menos' },
  acorde: { label: 'Dentro del rango estimado', pred: (f) => f.situacion === 'acorde' },
  sin_consumo: { label: 'Sin consumo en el último año', pred: (f) => f.situacion === 'sin_consumo' },
  no_figura: { label: 'No figuran en el consumo', pred: (f) => f.situacion === 'no_figura' },
  nuevo: { label: 'Fármacos nuevos', pred: (f) => f.situacion === 'nuevo' },
  otro_sector: { label: 'Se consumen en otro sector', pred: (f) => f.situacion === 'otro_sector' },
  discontinuado: { label: 'Discontinuados', pred: (f) => f.situacion === 'discontinuado' },
  no_medicamento: { label: 'No son medicamentos', pred: (f) => f.situacion === 'no_medicamento' }
};

function codigoProductoValido(codigo) {
  return /^[A-Z]\d{6,7}$/.test(String(codigo || '').trim().toUpperCase());
}

// Misma normalizacion que el backend para la clave de los vinculos (codigo + descripcion)
function claveDescripcionOc(descripcion) {
  return String(descripcion || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 255);
}

function sigafValido(sigaf) {
  const v = String(sigaf || '').trim().toUpperCase();
  return /^\d{5}-\d{4}$/.test(v) ? v : null;
}

// Rangos de vencimiento del stock actual; "resto" = stock que vence despues del horizonte descargado
const RANGOS_VTO = [
  { key: 'vencido', label: 'Ya vencido', titulo: 'Lotes con fecha de vencimiento pasada', fondo: '#fdf0f0', color: '#9d1c1c' },
  { key: 'd30', label: 'Vence ≤ 30 días', titulo: 'Vence en 30 días o menos', fondo: '#fff3e6', color: '#b45309' },
  { key: 'd90', label: 'Vence 31–90 días', titulo: 'Vence entre 31 y 90 días', fondo: '#fffbea', color: '#7b5600' },
  { key: 'd180', label: 'Vence 91–180 días', titulo: 'Vence entre 91 y 180 días', fondo: '#f7fbf2', color: '#3f6212' },
  { key: 'resto', label: 'Resto (vence después)', titulo: 'Stock actual menos los lotes listados en el reporte de vencimientos', fondo: '#f4fbf6', color: '#176338' }
];

function rangoVto(dias) {
  if (dias == null) return 'resto';
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'd30';
  if (dias <= 90) return 'd90';
  if (dias <= 180) return 'd180';
  return 'resto';
}

// Ciclo de compra = semestre del periodo de consumo del requerimiento ("desde el 01-01-2027" -> "2027-1")
function cicloDe(periodoDesde) {
  const d = String(periodoDesde || '');
  const anio = Number(d.slice(0, 4));
  if (!anio) return 'sin-periodo';
  return `${anio}-${Number(d.slice(5, 7)) <= 6 ? 1 : 2}`;
}

// Numero de semestre del ciclo (1 o 2); null si no se sabe
function semestreDeCiclo(ciclo) {
  const sem = Number(String(ciclo || '').split('-')[1]);
  return sem === 1 || sem === 2 ? sem : null;
}

function etiquetaCiclo(ciclo) {
  if (!ciclo || ciclo === 'sin-periodo') return 'Sin período';
  const [anio, sem] = ciclo.split('-');
  return `${sem === '1' ? '1er' : '2do'} semestre ${anio}`;
}

// Nombre corto de un formulario de requerimiento en papel (formulario / expediente)
function etiquetaFuente(g) {
  if (!g) return '';
  if (g.etiqueta) return g.etiqueta;
  const exp = g.expediente || '';
  return g.formulario ? `Form. ${g.formulario} · ${exp}` : exp;
}

// Motivos de la comparacion entre la carga manual de un anio y el PDF del mismo semestre del anio siguiente.
// tono: ok (esta bien / no es diferencia real), revisar, alerta
function motivosComparacion(anio, semCorto) {
  const sig = anio + 1;
  return {
    soloEste: [
      { k: 'cambioCodigo', tono: 'ok', label: 'Mismo producto, cambió el código', corto: 'No es una diferencia real',
        texto: `El mismo producto está en el PDF ${sig} con otro código (misma droga y misma concentración, o misma cantidad pedida). Unilos en «Códigos equivalentes» y desaparece de la comparación.` },
      { k: 'minNo', tono: 'ok', label: 'Ministerio dijo NO comprar', corto: 'Está bien que no esté',
        texto: `La comunicación del Ministerio para el ${semCorto} semestre ${sig} dice que este código NO se compra (lo provee o adjudica el Ministerio).` },
      { k: 'minNoNuevo', tono: 'ok', label: 'Ministerio dijo NO (código nuevo)', corto: 'Está bien que no esté',
        texto: `El Ministerio dice NO comprar el mismo producto con su código nuevo. Está bien que no esté; conviene unir el código viejo con el nuevo en «Códigos equivalentes».` },
      { k: 'otraConc', tono: 'revisar', label: 'Otra concentración o presentación', corto: 'Revisar',
        texto: `En el PDF ${sig} está la misma droga, pero en otra concentración o presentación. Revisá si la reemplaza o si faltó pedirla.` },
      { k: 'sinNada', tono: 'alerta', label: `No hay nada en ${sig}`, corto: 'Revisar',
        texto: `Esta droga no está en ningún PDF ${sig} ni en la comunicación del Ministerio. Puede faltar un PDF (por ejemplo el de psicofármacos y estupefacientes) o quedó afuera del pedido.` }
    ],
    soloSig: [
      { k: 'reemplaza', tono: 'ok', label: `Código nuevo de algo pedido en ${anio}`, corto: 'No es una diferencia real',
        texto: `En ${anio} el mismo producto se pidió con el código viejo. Unilos en «Códigos equivalentes» y desaparece de la comparación.` },
      { k: 'otraConcSig', tono: 'revisar', label: `En ${anio} se pidió otra concentración`, corto: 'Revisar',
        texto: `En ${anio} se pidió la misma droga pero en otra concentración o presentación. Revisá si en ${anio} también hacía falta esta.` },
      { k: 'minNoPedido', tono: 'alerta', label: 'Pedido aunque el Ministerio dijo NO', corto: 'Revisar',
        texto: `Está en el PDF ${sig} aunque la comunicación del Ministerio dice NO comprar ese código.` },
      { k: 'nuevo', tono: 'revisar', label: `Nuevo en ${sig}`, corto: 'Revisar',
        texto: `No se pedía en ${anio} (ni con otro código). Si en ${anio} también hacía falta, cargá la cantidad; si no, dejalo en 0.` }
    ]
  };
}
const TONO_MOTIVO = {
  ok: { bg: '#e7f6ec', borde: '#9fd3b0', color: '#1f7a3a' },
  revisar: { bg: '#fff6d6', borde: '#e8cf7a', color: '#8a5a00' },
  alerta: { bg: '#fde2e1', borde: '#f0a9a4', color: '#b42318' }
};

// Columnas opcionales de la carga manual. get(d, fila, meta) -> numero | texto | null
function columnasCargaManual(anio, semestre) {
  const sem = semestre === 1 ? '1er sem.' : '2do sem.';
  const meses = semestre === 1 ? 'enero a junio' : 'julio a diciembre';
  const num = (v) => (v == null || Number.isNaN(v) ? null : v);
  return [
    { key: 'consumoSem', grupo: 'Consumo', label: `Consumo ${sem} ${anio}`, get: (d) => num(d.consumoSem ?? 0),
      title: `Unidades que se gastaron (salieron de farmacia) de ${meses} de ${anio}, todos los sectores. Sale del Análisis Trimestral. ${EQUIV_TXT}` },
    { key: 'promMensual', grupo: 'Consumo', label: `Consumo promedio por mes ${sem} ${anio}`, get: (d, f, m) => (m.mesesSem ? Math.round((d.consumoSem || 0) / m.mesesSem) : null),
      title: `Consumo del ${sem} ${anio} dividido por los meses que ya están cargados en el Análisis Trimestral.` },
    { key: 'consumoSemAnt', grupo: 'Consumo', label: `Consumo ${sem} ${anio - 1}`, get: (d) => num(d.consumoSemAnt),
      title: `Unidades que se gastaron de ${meses} de ${anio - 1}, todos los sectores (Análisis Trimestral). ${EQUIV_TXT}` },
    { key: 'consumoAnioSig', grupo: 'Consumo', label: `Consumo ${anio + 1}`, get: (d) => num(d.consumoAnioSig),
      title: `Unidades gastadas en ${anio + 1} hasta el último trimestre cargado (Análisis Trimestral). ${EQUIV_TXT}` },
    { key: 'pedidoOtroSem', grupo: 'Requerido', label: `Cargado a mano ${semestre === 1 ? '2do' : '1er'} sem. ${anio}`, get: (d) => num(d.pedidoOtroSem),
      title: `Lo cargado en esta misma pantalla para el ${semestre === 1 ? '2do' : '1er'} semestre de ${anio}.` },
    { key: 'totalAnio', grupo: 'Requerido', label: `Cargado a mano total ${anio}`, get: (d) => num(d.totalAnio),
      title: `Suma de lo cargado en esta pantalla para los dos semestres de ${anio}.` },
    { key: 'reqSigSem1', grupo: 'Requerido', label: `Requerido PDF 1er sem. ${anio + 1}`, get: (d) => num(d.reqSigSem1),
      title: `Suma de lo pedido en los PDF de requerimiento del Ministerio para enero a junio de ${anio + 1}. ${EQUIV_TXT}` },
    { key: 'reqSigSem2', grupo: 'Requerido', label: `Requerido PDF 2do sem. ${anio + 1}`, get: (d) => num(d.reqSigSem2),
      title: `Suma de lo pedido en los PDF de requerimiento del Ministerio para julio a diciembre de ${anio + 1}. ${EQUIV_TXT}` },
    { key: 'reqAnioSig', grupo: 'Requerido', label: `Requerido PDF ${anio + 1} (año entero)`, get: (d) => num(d.reqAnioSig),
      title: `Suma de los dos semestres de ${anio + 1} en los PDF de requerimiento del Ministerio. ${EQUIV_TXT}` },
    { key: 'reqAnioSig2', grupo: 'Requerido', label: `Requerido PDF ${anio + 2} (año entero)`, get: (d) => num(d.reqAnioSig2),
      title: `Suma de lo pedido en los PDF de requerimiento del Ministerio para ${anio + 2}. ${EQUIV_TXT}` },
    { key: 'stockActual', grupo: 'Stock', label: 'Stock actual', get: (d) => num(d.stockActual),
      title: `Unidades en stock en la última descarga de Farmacia MS (fecha arriba, «Stock al…»), sumando todos los sectores. ${EQUIV_TXT}` },
    { key: 'minMs', grupo: 'Stock', label: 'Stock mínimo (Farmacia MS)', get: (d) => num(d.minMs), title: 'Stock mínimo cargado en Farmacia MS, sumando los sectores.' },
    { key: 'maxMs', grupo: 'Stock', label: 'Stock máximo (Farmacia MS)', get: (d) => num(d.maxMs), title: 'Stock máximo cargado en Farmacia MS, sumando los sectores.' },
    { key: 'minSug', grupo: 'Stock', label: 'Stock mínimo sugerido', get: (d) => num(d.minSug), title: 'Stock mínimo sugerido por el sistema a partir del consumo (pantalla Análisis Trimestral).' },
    { key: 'maxSug', grupo: 'Stock', label: 'Stock máximo sugerido', get: (d) => num(d.maxSug), title: 'Stock máximo sugerido por el sistema a partir del consumo (pantalla Análisis Trimestral).' },
    { key: 'proxVto', grupo: 'Vencimientos', label: 'Próximo vencimiento', tipo: 'fecha', get: (d) => d.proxVto || null,
      title: 'Fecha de vencimiento más cercana (desde hoy) de lo que hay en stock, según la última descarga de Vencimientos de Farmacia MS.' },
    { key: 'proxVtoCant', grupo: 'Vencimientos', label: 'Unidades que vencen en esa fecha', get: (d) => num(d.proxVtoCant),
      title: 'Cuántas unidades en stock vencen en la fecha de «Próximo vencimiento».' },
    { key: 'ocPedida', grupo: 'Compras', label: `Comprado (O.C.) ${sem} ${anio}`, get: (d) => num(d.ocPedida),
      title: `Unidades pedidas en las órdenes de compra del ${sem} ${anio}, según la planilla de O.C. de Drive. ${EQUIV_TXT}` },
    { key: 'ocEntregada', grupo: 'Compras', label: `Entregado (O.C.) ${sem} ${anio}`, get: (d) => num(d.ocEntregada),
      title: `Unidades ya entregadas por el proveedor de esas órdenes de compra del ${sem} ${anio}.` },
    { key: 'justiprecio', grupo: 'Compras', label: 'Justiprecio', tipo: 'pesos', get: (d) => num(d.justiprecio),
      title: 'Precio unitario de referencia del PDF de requerimiento más reciente que lo trae.' },
    { key: 'bajasSem', grupo: 'Bajas', label: `Bajas ${sem} ${anio}`, get: (d) => num(d.bajasSem),
      title: `Unidades dadas de baja por descarte o vencimiento de ${meses} de ${anio} (Farmacia MS; hay datos desde octubre de 2025). ${EQUIV_TXT}` },
    { key: 'difConsumo', grupo: 'Calculadas', label: `Cantidad − consumo ${sem} ${anio}`, get: (d, f) => Number(f.cantidad) - (d.consumoSem || 0),
      title: `Cálculo: la cantidad cargada en este renglón menos el consumo del ${sem} ${anio}. Negativo (rojo) = se pide menos de lo que se gastó; positivo (verde) = se pide más.` },
    { key: 'difPct', grupo: 'Calculadas', label: `Cantidad vs consumo ${sem} ${anio} (%)`, tipo: 'pct', get: (d, f) => (d.consumoSem ? Math.round((Number(f.cantidad) / d.consumoSem) * 100) : null),
      title: `Cálculo: cantidad cargada ÷ consumo del ${sem} ${anio} × 100. 100 % = se pide lo mismo que se gastó.` },
    { key: 'monto', grupo: 'Calculadas', label: 'Monto estimado ($)', tipo: 'pesos', get: (d, f) => (d.justiprecio != null ? Number(f.cantidad) * d.justiprecio : null),
      title: 'Cálculo: cantidad cargada × justiprecio.' }
  ];
}
const COLUMNAS_MANUAL_DEFAULT = ['consumoSem', 'stockActual', 'difConsumo'];
// Columnas fijas que se pueden ocultar desde el boton Columnas
function basicasReqCodigo(ciclo) {
  return [
    { key: 'codigo', label: 'Código', fija: true, title: 'Código del Ministerio que figura en el PDF de requerimiento.' },
    { key: 'sigaf', label: 'Cód. Sigaf', title: 'Código SIGAF del PDF de requerimiento.' },
    { key: 'droga', label: 'Droga', title: 'Nombre de la droga en el PDF.' },
    { key: 'descripcion', label: 'Descripción', title: 'Descripción del producto en el PDF.' },
    { key: 'cantidad', label: `Requerido ${cortoCiclo(ciclo)}`, title: `Suma de lo pedido para este código en todos los PDF de requerimiento del ${cortoCiclo(ciclo)} (${rangoCiclo(ciclo)}). Se puede corregir con un clic: el valor del PDF se guarda y en amarillo se ven los corregidos. Total $ y las columnas calculadas usan el valor corregido.` },
    { key: 'veces', label: 'Veces', title: 'En cuántos renglones de los PDF aparece el código (naranja: en varios requerimientos; rojo: repetido dentro del mismo).' },
    { key: 'requerimientos', label: 'Requerimientos', title: 'En qué PDF, hoja e ítem aparece.' },
    { key: 'justiprecio', label: 'Justiprecio', title: 'Precio unitario de referencia que trae el PDF.' },
    { key: 'total', label: 'Total $', title: 'Cálculo: requerido × justiprecio.' }
  ];
}
const BASICAS_CARGA_MANUAL = [
  { key: 'controlado', label: 'Controlado', fija: true, title: 'Al tildar, el renglón pasa a la pestaña Controlados.' },
  { key: 'codigo', label: 'Código', fija: true, title: 'Código del Ministerio. Abajo, con ⇔, los códigos equivalentes (viejos) que se suman.' },
  { key: 'droga', label: 'Droga', title: 'Nombre de la droga.' },
  { key: 'descripcion', label: 'Descripción', title: 'Descripción del producto.' },
  { key: 'fuentes', label: 'Formulario / Exp.', title: 'Formularios de requerimiento o expedientes en papel donde figura.' },
  { key: 'cantidad', label: 'Cantidad', title: 'Cantidad que se carga a mano para este semestre.' },
  { key: 'pedidoSig', label: 'Pedido año siguiente', title: 'Lo pedido para el mismo semestre del año siguiente en los PDF de requerimiento del Ministerio.' },
  { key: 'acciones', label: 'Editar / Quitar', title: 'Botones para editar o quitar el renglón.' }
];

function formatoColumna(col, v) {
  if (v == null) return '—';
  if (col.tipo === 'fecha') return fmtFechaAr(v);
  if (col.tipo === 'pesos') return formatPesos(v);
  if (col.tipo === 'pct') return `${v} %`;
  if (col.tipo === 'texto') return String(v);
  return Number(v).toLocaleString('es-AR');
}

// Columnas elegibles del Analisis de Requerimiento (pestaña Por codigo). get(d, g) con d = datos del codigo y g = grupo de la fila
// Nombre corto y rango de meses de un ciclo 'AAAA-S'
function cortoCiclo(c) { const [a, x] = String(c || '').split('-'); return `${x === '1' ? '1er' : '2do'} sem. ${a}`; }
function rangoCiclo(c) { const [a, x] = String(c || '').split('-'); return x === '1' ? `enero a junio de ${a}` : `julio a diciembre de ${a}`; }
const EQUIV_TXT = 'Suma los códigos viejos y nuevos de la misma droga (Códigos equivalentes).';

function columnasAnalisisReq(meta, ciclo) {
  const m = meta || {};
  const num = (v) => (v == null || Number.isNaN(v) ? null : v);
  const corto = cortoCiclo;
  const semActual = semestreDeCiclo(ciclo);
  const cols = [];
  const ciclosCons = m.ciclosConsumo || [];
  for (const c of ciclosCons) {
    const meses = m.mesesConsumo?.[c] || 0;
    const parcial = meses && meses < 6 ? ` (${meses} meses)` : '';
    cols.push({ key: `cons:${c}`, grupo: 'Consumo', label: `Consumo ${corto(c)}${parcial}`,
      title: `Unidades que se gastaron (salieron de farmacia) de ${rangoCiclo(c)}, todos los sectores. Sale del Análisis Trimestral${parcial ? `; por ahora hay ${meses} meses cargados` : ''}. ${EQUIV_TXT}`,
      get: (d) => num(d.consumo?.[c] ?? 0) });
  }
  for (const c of ciclosCons) {
    const meses = m.mesesConsumo?.[c] || 0;
    cols.push({ key: `prom:${c}`, grupo: 'Promedio mensual', label: `Consumo promedio por mes ${corto(c)}`,
      title: `Consumo del ${corto(c)} dividido por los meses con datos (${meses}).`,
      get: (d) => (meses ? Math.round((d.consumo?.[c] || 0) / meses) : null) });
  }
  const ciclosMan = Array.from(new Set(m.ciclosManual || [])).sort();
  for (const c of ciclosMan) cols.push({ key: `man:${c}`, grupo: 'Requerido', label: `Cargado a mano ${corto(c)}`,
    title: `Cantidad cargada a mano en la pantalla Carga Requerimiento para el ${corto(c)}. ${EQUIV_TXT}`, get: (d) => num(d.manual?.[c]) });
  for (const c of (m.ciclosReq || [])) cols.push({ key: `req:${c}`, grupo: 'Requerido', label: `Requerido PDF ${corto(c)}${c === ciclo ? ' (este)' : ''}`,
    title: `Suma de lo pedido en los PDF de requerimiento del Ministerio para el período de ${rangoCiclo(c)}.${c === ciclo ? ' Es el mismo número que la columna «Requerido» de la tabla.' : ''} ${EQUIV_TXT}`,
    get: (d) => num(d.req?.[c]) });
  const fechaStock = m.stockFecha ? ` del ${fmtFechaAr(m.stockFecha)}` : '';
  cols.push(
    { key: 'stockActual', grupo: 'Stock', label: 'Stock actual', title: `Unidades en stock en la última descarga de Farmacia MS${fechaStock}, sumando todos los sectores. ${EQUIV_TXT}`, get: (d) => num(d.stockActual) },
    { key: 'minMs', grupo: 'Stock', label: 'Stock mínimo (Farmacia MS)', title: 'Stock mínimo cargado en Farmacia MS, sumando los sectores.', get: (d) => num(d.minMs) },
    { key: 'maxMs', grupo: 'Stock', label: 'Stock máximo (Farmacia MS)', title: 'Stock máximo cargado en Farmacia MS, sumando los sectores.', get: (d) => num(d.maxMs) },
    { key: 'minSug', grupo: 'Stock', label: 'Stock mínimo sugerido', title: 'Stock mínimo sugerido por el sistema a partir del consumo (pantalla Análisis Trimestral).', get: (d) => num(d.minSug) },
    { key: 'maxSug', grupo: 'Stock', label: 'Stock máximo sugerido', title: 'Stock máximo sugerido por el sistema a partir del consumo (pantalla Análisis Trimestral).', get: (d) => num(d.maxSug) },
    { key: 'proxVto', grupo: 'Vencimientos', label: 'Próximo vencimiento', tipo: 'fecha', title: 'Fecha de vencimiento más cercana (desde hoy) de lo que hay en stock, según la última descarga de Vencimientos de Farmacia MS.', get: (d) => d.proxVto || null },
    { key: 'proxVtoCant', grupo: 'Vencimientos', label: 'Unidades que vencen en esa fecha', title: 'Cuántas unidades en stock vencen en la fecha de «Próximo vencimiento».', get: (d) => num(d.proxVtoCant) }
  );
  for (const c of m.ciclosOc || []) {
    cols.push({ key: `ocp:${c}`, grupo: 'Compras (O.C.)', label: `Comprado (O.C.) ${corto(c)}`, title: `Unidades pedidas en las órdenes de compra del ${corto(c)}, según la planilla de O.C. de Drive. ${EQUIV_TXT}`, get: (d) => num(d.ocPedida?.[c]) });
    cols.push({ key: `oce:${c}`, grupo: 'Compras (O.C.)', label: `Entregado (O.C.) ${corto(c)}`, title: `Unidades ya entregadas por el proveedor de esas órdenes de compra del ${corto(c)}.`, get: (d) => num(d.ocEntregada?.[c]) });
  }
  for (const c of m.ciclosBajas || []) cols.push({ key: `baj:${c}`, grupo: 'Bajas', label: `Bajas ${corto(c)}`, title: `Unidades dadas de baja por descarte o vencimiento de ${rangoCiclo(c)} (Farmacia MS; hay datos desde octubre de 2025). ${EQUIV_TXT}`, get: (d) => num(d.bajas?.[c]) });

  // Calculadas: contra el mismo semestre del anio anterior con consumo completo (o el ultimo con datos)
  const mismos = ciclosCons.filter((c) => c < ciclo && Number(c.split('-')[1]) === semActual);
  const ref = mismos[mismos.length - 1] || ciclosCons.filter((c) => c < ciclo).pop() || null;
  const mesesRef = ref ? (m.mesesConsumo?.[ref] || 0) : 0;
  const anioCiclo = Number(String(ciclo || '').split('-')[0]);
  const manRef = semActual && anioCiclo ? `${anioCiclo - 1}-${semActual}` : null;
  const req = `requerido ${corto(ciclo)}`;
  if (ref) {
    cols.push(
      { key: 'calc:dif', grupo: 'Calculadas', label: `Requerido ${corto(ciclo)} − consumo ${corto(ref)}`,
        title: `Cálculo: ${req} (PDF) menos el consumo del ${corto(ref)}. Negativo (rojo) = se pide menos de lo que se gastó.`,
        get: (d, g) => Number(g.cantidad || 0) - (d.consumo?.[ref] || 0) },
      { key: 'calc:pct', grupo: 'Calculadas', label: `Requerido vs consumo ${corto(ref)} (%)`, tipo: 'pct',
        title: `Cálculo: ${req} ÷ consumo del ${corto(ref)} × 100. 100 % = se pide lo mismo que se gastó; menos de 100 % = se pide menos.`,
        get: (d, g) => (d.consumo?.[ref] ? Math.round((Number(g.cantidad || 0) / d.consumo[ref]) * 100) : null) },
      { key: 'calc:cobertura', grupo: 'Calculadas', label: 'Meses que alcanza (stock + requerido)',
        title: `Cálculo: (stock actual + ${req}) ÷ consumo promedio por mes del ${corto(ref)}. Cuántos meses alcanzaría con lo que hay más lo que se pide.`,
        get: (d, g) => {
          const mensual = mesesRef ? (d.consumo?.[ref] || 0) / mesesRef : 0;
          return mensual ? Math.round(((Number(d.stockActual || 0) + Number(g.cantidad || 0)) / mensual) * 10) / 10 : null;
        } }
    );
  }
  if (manRef) {
    cols.push(
      { key: 'calc:vsManual', grupo: 'Calculadas', label: `Requerido ${corto(ciclo)} − cargado a mano ${corto(manRef)}`,
        title: `Cálculo: ${req} (PDF) menos lo cargado a mano para el ${corto(manRef)} en Carga Requerimiento.`,
        get: (d, g) => (d.manual?.[manRef] == null ? null : Number(g.cantidad || 0) - d.manual[manRef]) }
    );
  }
  return { cols, ref };
}

// Panel de casillas para elegir columnas (agrupadas)
// Columnas fijas de una tabla que se pueden ocultar (las de "fija: true" no). Se recuerdan en el navegador.
function useColumnasOcultas(clave) {
  const [ocultas, setOcultasState] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(clave) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  const setOcultas = (lista) => {
    setOcultasState(lista);
    try { localStorage.setItem(clave, JSON.stringify(lista)); } catch { /* sin almacenamiento */ }
  };
  return [ocultas, setOcultas];
}

function PanelColumnas({ columnas, visibles, onCambiar, porDefecto, onCerrar, basicas, ocultas = [], onOcultas }) {
  const grupos = Array.from(new Set(columnas.map((c) => c.grupo)));
  const alternar = (key) => onCambiar(visibles.includes(key) ? visibles.filter((k) => k !== key) : [...visibles, key]);
  const alternarBasica = (key) => onOcultas(ocultas.includes(key) ? ocultas.filter((k) => k !== key) : [...ocultas, key]);
  const sacables = (basicas || []).filter((b) => !b.fija).map((b) => b.key);
  return (
    <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #c9d3da', borderRadius: 8, padding: 14, boxShadow: '0 8px 22px rgba(0,0,0,.14)', display: 'flex', flexWrap: 'wrap', gap: 22, maxWidth: 'min(1100px, 94vw)', maxHeight: '70vh', overflowY: 'auto' }}>
      {basicas?.length ? (
        <div style={{ minWidth: 180 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Básicas</div>
          {basicas.map((b) => (
            <label key={b.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, margin: '3px 0', cursor: b.fija ? 'default' : 'pointer', color: b.fija ? '#7a8790' : undefined }} title={`${b.title || ''}${b.fija ? ' (siempre visible)' : ''}`}>
              <input type="checkbox" checked={b.fija || !ocultas.includes(b.key)} disabled={b.fija} onChange={() => alternarBasica(b.key)} />
              {b.label}
            </label>
          ))}
        </div>
      ) : null}
      {grupos.map((g) => (
        <div key={g} style={{ minWidth: 180 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{g}</div>
          {columnas.filter((c) => c.grupo === g).map((c) => (
            <label key={c.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, margin: '3px 0', cursor: 'pointer' }} title={c.title || ''}>
              <input type="checkbox" checked={visibles.includes(c.key)} onChange={() => alternar(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      ))}
      <div style={{ width: '100%', display: 'flex', gap: 8 }}>
        <button type="button" className="ghost small" onClick={() => { onCambiar(columnas.map((c) => c.key)); if (onOcultas) onOcultas([]); }}>Todas</button>
        <button type="button" className="ghost small" onClick={() => { onCambiar([]); if (onOcultas) onOcultas(sacables); }}>Ninguna</button>
        <button type="button" className="ghost small" onClick={() => { onCambiar(porDefecto); if (onOcultas) onOcultas([]); }}>Por defecto</button>
        <button type="button" className="small" onClick={onCerrar} style={{ marginLeft: 'auto' }}>Listo</button>
      </div>
    </div>
  );
}

// Donde aparece un codigo (stock, consumo, O.C., requerimiento de PDF): ayuda a ver cual es el viejo y cual el nuevo
function textoHuella(h) {
  if (!h) return '';
  const p = [];
  p.push(h.stock != null ? `stock ${Number(h.stock).toLocaleString('es-AR')}` : 'sin stock actual');
  if (h.consumo) p.push(`consumo ${h.consumo.desde === h.consumo.hasta ? h.consumo.desde : `${h.consumo.desde}–${h.consumo.hasta}`} (${Number(h.consumo.cantidad).toLocaleString('es-AR')})`);
  else if (h.consumoMs) p.push(`consumo MS ${h.consumoMs.anio} (${Number(h.consumoMs.total).toLocaleString('es-AR')})`);
  else p.push('sin consumo');
  if (h.oc) p.push(`O.C. ${h.oc.desde === h.oc.hasta ? h.oc.desde : `${h.oc.desde}–${h.oc.hasta}`} (${h.oc.n})`);
  if (h.reqPdf) p.push(`req. PDF ${h.reqPdf.anio}`);
  return p.join(' · ');
}

// Detalle chiquito de un codigo: consumo de cada año y cada O.C. con numero, proveedor y cantidad
function DetalleHuella({ h }) {
  if (!h) return null;
  const n = (v) => Number(v || 0).toLocaleString('es-AR');
  const consumo = (h.consumoAnios || []).map((c) => `${c.anio}: ${n(c.cantidad)}${c.ms ? ' (MS)' : ''}`);
  const ocs = (h.ocs || []).map((o) => `${o.numero || 's/n'}${o.proveedor ? ` ${o.proveedor}` : ''}${o.cantidad != null ? ` (${n(o.cantidad)})` : ''}`);
  const MAX = 4;
  if (!consumo.length && !ocs.length) return null;
  return (
    <div style={{ fontSize: 11.5, color: '#6b7a85', lineHeight: 1.35 }}>
      {consumo.length ? <div>Consumo · {consumo.join(' · ')}</div> : null}
      {ocs.length ? (
        <div title={ocs.join('\n')}>O.C. · {ocs.slice(0, MAX).join(' · ')}{ocs.length > MAX ? ` · y ${ocs.length - MAX} más` : ''}</div>
      ) : null}
    </div>
  );
}

const NIVEL_EQUIV = {
  alta: { label: 'Coincide todo', bg: '#e3f4e8', color: '#1f7a3a' },
  media: { label: 'Falta un dato', bg: '#fff4d6', color: '#8a5a00' },
  baja: { label: 'Faltan datos', bg: '#f1f3f5', color: '#5b6b76' },
  no: { label: 'No coincide', bg: '#fdecec', color: '#b42318' },
  manual: { label: 'Elegido a mano', bg: '#e6eefb', color: '#174e8d' }
};

// Droga / concentracion / presentacion: ✓ coincide, ≈ parecida, ? falta el dato en un codigo, ✗ no coincide
function ChequeosEquiv({ cmp }) {
  if (!cmp) return null;
  const est = {
    si: ['✓', '#1f7a3a', '#e3f4e8'],
    parecida: ['≈', '#8a5a00', '#fff4d6'],
    falta: ['?', '#5b6b76', '#f1f3f5'],
    no: ['✗', '#b42318', '#fdecec']
  };
  const titulos = { si: 'coincide', parecida: 'parecida', falta: 'falta el dato en uno de los códigos', no: 'NO coincide' };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
      {[['droga', 'Droga'], ['concentracion', 'Concentración'], ['presentacion', 'Presentación']].map(([k, label]) => {
        const [ic, color, bg] = est[cmp[k]] || est.falta;
        const det = cmp.detalle?.[k];
        return (
          <span key={k} title={`${label}: ${titulos[cmp[k]] || ''}${det ? ` · ${det}` : ''}`} style={{ background: bg, color, borderRadius: 4, padding: '1px 6px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {ic} {label}{cmp[k] !== 'si' && det ? `: ${det}` : ''}
          </span>
        );
      })}
    </div>
  );
}

// Historial de cambios de codigo: sugiere, para cada renglon por controlar con cantidad 0, el codigo
// (viejo) con el que el mismo producto ya figura, y permite unificarlos o marcar que no son el mismo.
function UnificarCodigosPanel({ client, anio, semestre, catalogo, onCambio, onCerrar }) {
  const [vista, setVista] = useState('sugerencias');
  const [datos, setDatos] = useState(null);
  const [hist, setHist] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [quedaNuevo, setQuedaNuevo] = useState(true);
  const [soloConSug, setSoloConSug] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [busqueda, setBusqueda] = useState({});
  const [extras, setExtras] = useState({});
  const [auditoria, setAuditoria] = useState({});
  const [soloNoCoinciden, setSoloNoCoinciden] = useState(false);

  async function cargarSugerencias() {
    setError('');
    try { setDatos(await client.equivSugerencias(anio, semestre)); } catch (e) { setError(e.message); }
  }
  async function cargarHistorial() {
    setError('');
    try {
      const [h, a] = await Promise.all([client.equivHistorial(), client.equivAuditoria()]);
      setHist(h.data || []);
      setAuditoria(Object.fromEntries((a.data || []).map((x) => [x.id, x.comparacion])));
    } catch (e) { setError(e.message); }
  }
  const noCoinciden = (hist || []).filter((h) => h.estado === 'igual' && auditoria[h.id] && !auditoria[h.id].ok).length;
  useEffect(() => { cargarSugerencias(); cargarHistorial(); }, [anio, semestre]);

  const huellas = datos?.huellas || {};
  const pendientes = useMemo(() => {
    const palabras = filtro.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (datos?.pendientes || []).filter((p) => {
      if (soloConSug && !p.candidatos.length && !(extras[p.codigo] || []).length) return false;
      const txt = `${p.codigo} ${p.droga} ${p.descripcion} ${p.candidatos.map((c) => `${c.codigo} ${c.descripcion}`).join(' ')}`.toLowerCase();
      return palabras.every((w) => txt.includes(w));
    });
  }, [datos, soloConSug, filtro, extras]);
  const conSugerencia = (datos?.pendientes || []).filter((p) => p.candidatos.length).length;

  function quitarPendiente(codigos) {
    setDatos((d) => d && ({ ...d, pendientes: d.pendientes.filter((p) => !codigos.includes(p.codigo)) }));
  }

  async function unificar(p, c, forzar = false) {
    const queda = quedaNuevo ? p.codigo : c.codigo;
    setTrabajando(`${p.codigo}|${c.codigo}`);
    setError('');
    try {
      try {
        await client.equivUnificar({ anio, semestre, codigo: p.codigo, con: c.codigo, queda, forzar });
      } catch (e) {
        if (e.status !== 422) throw e;
        setTrabajando('');
        const resp = window.prompt(`${p.codigo} y ${c.codigo} NO son el mismo producto según la descripción.\n${e.message}\n\nSolo unificalos si estás seguro de que la descripción está mal. Para unificarlos igual escribí UNIFICAR:`);
        if (String(resp || '').trim().toUpperCase() !== 'UNIFICAR') return;
        setTrabajando(`${p.codigo}|${c.codigo}`);
        await client.equivUnificar({ anio, semestre, codigo: p.codigo, con: c.codigo, queda, forzar: true });
      }
      setAviso(`Unificados ${p.codigo} y ${c.codigo}${c.manual ? ` · queda un solo renglón con el código ${queda}` : ''}.`);
      quitarPendiente([p.codigo, ...(c.manual && !c.manual.controlado && !c.manual.cantidad ? [c.codigo] : [])]);
      onCambio();
      cargarHistorial();
    } catch (e) {
      setError(`${p.codigo} + ${c.codigo}: ${e.message}`);
    } finally {
      setTrabajando('');
    }
  }

  async function descartar(p, c) {
    setTrabajando(`${p.codigo}|${c.codigo}`);
    try {
      await client.equivDescartar({ codigo: p.codigo, con: c.codigo });
      setDatos((d) => d && ({ ...d, pendientes: d.pendientes.map((x) => (x.codigo === p.codigo ? { ...x, candidatos: x.candidatos.filter((y) => y.codigo !== c.codigo) } : x)) }));
      setExtras((e) => ({ ...e, [p.codigo]: (e[p.codigo] || []).filter((y) => y.codigo !== c.codigo) }));
      cargarHistorial();
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando('');
    }
  }

  async function deshacer(h) {
    const txt = h.estado === 'igual'
      ? `¿Deshacer la unificación de ${h.codigo_a} y ${h.codigo_b}? Si al unificar se sacó un renglón de la carga, vuelve a aparecer como estaba.`
      : `¿Volver a sugerir ${h.codigo_a} y ${h.codigo_b} como posible mismo producto?`;
    if (!window.confirm(txt)) return;
    setTrabajando(`h${h.id}`);
    try {
      await client.equivDeshacer(h.id);
      await Promise.all([cargarHistorial(), cargarSugerencias()]);
      onCambio();
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando('');
    }
  }

  async function elegirOtro(p, item) {
    setBusqueda((b) => ({ ...b, [p.codigo]: '' }));
    let h = huellas[item.codigo];
    if (!h) {
      try {
        const r = await client.equivHuellas([item.codigo]);
        h = r[item.codigo];
        setDatos((d) => d && ({ ...d, huellas: { ...d.huellas, ...r } }));
      } catch { /* sin huella */ }
    }
    let cmp = null;
    try { cmp = (await client.equivComparar(p.codigo, item.codigo)).comparacion; } catch { /* sin comparacion */ }
    setExtras((e) => ({ ...e, [p.codigo]: [...(e[p.codigo] || []).filter((x) => x.codigo !== item.codigo), { codigo: item.codigo, droga: item.droga, descripcion: item.descripcion, nivel: cmp && !cmp.ok ? 'no' : 'manual', comparacion: cmp, motivos: [], manual: null }] }));
  }

  const filaCodigo = (codigo, descripcion, extra) => (
    <div style={{ minWidth: 0 }}>
      <div><strong>{codigo}</strong> · {descripcion}{extra}</div>
      <div style={{ fontSize: 12, color: '#5b6b76' }}>{textoHuella(huellas[codigo])}</div>
      <DetalleHuella h={huellas[codigo]} />
    </div>
  );

  return createPortal(
    <div className="folder-overlay" onClick={onCerrar}>
      <div className="folder-picker" style={{ width: 'min(1100px, 100%)', maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="section-head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Códigos equivalentes · {semestre === 1 ? '1er' : '2do'} semestre {anio}</h2>
          <button type="button" className="ghost small" onClick={onCerrar}>Cerrar</button>
        </div>
        <p style={{ color: '#5b6b76', fontSize: 13, margin: '6px 0 10px' }}>
          El Ministerio fue cambiando los códigos: el mismo producto figura con el código viejo en el consumo y las O.C., y con el nuevo en el stock y el requerimiento.
          Solo se sugieren códigos con la <strong>misma droga, concentración y presentación</strong>; si alguna no coincide, no se sugiere y para unificarlos hay que confirmarlo.
          Al unificar, los datos de los dos códigos se suman y, si los dos estaban en la carga, queda un solo renglón con la cantidad y el tilde que ya tenía.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {[['sugerencias', `Por revisar (${datos ? datos.pendientes.length : '…'})`], ['historial', `Historial (${hist ? hist.length : '…'})${noCoinciden ? ` · ⚠ ${noCoinciden} no coinciden` : ''}`]].map(([k, label]) => (
            <button key={k} type="button" className={`ghost small ${vista === k ? 'active' : ''}`} style={vista === k ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined} onClick={() => setVista(k)}>{label}</button>
          ))}
        </div>
        {error ? <div className="alert">{error}</div> : null}
        {aviso ? <div className="notice">{aviso}</div> : null}

        {vista === 'sugerencias' ? (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, fontSize: 14 }}>
              <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar: código o droga" style={{ width: 220, flex: '0 1 auto' }} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={soloConSug} onChange={(e) => setSoloConSug(e.target.checked)} /> Solo los que tienen sugerencia ({conSugerencia})
              </label>
              <span style={{ marginLeft: 'auto' }}>Al unificar queda el código:</span>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={quedaNuevo} onChange={() => setQuedaNuevo(true)} /> del renglón por controlar (nuevo)
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={!quedaNuevo} onChange={() => setQuedaNuevo(false)} /> el sugerido (viejo)
              </label>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {!datos && !error ? <div className="empty">Buscando códigos equivalentes…</div> : null}
              {datos && !pendientes.length ? <div className="empty">No hay renglones por revisar con este filtro.</div> : null}
              {pendientes.map((p) => {
                const cands = [...p.candidatos, ...(extras[p.codigo] || []).filter((x) => !p.candidatos.some((c) => c.codigo === x.codigo))];
                const q = (busqueda[p.codigo] || '').trim().toLowerCase();
                const resultados = q.length >= 2
                  ? catalogo.filter((c) => c.codigo !== p.codigo && q.split(/\s+/).every((w) => `${c.codigo} ${c.droga || ''} ${c.descripcion || ''}`.toLowerCase().includes(w))).slice(0, 12)
                  : [];
                return (
                  <div key={p.codigo} style={{ border: '1px solid #dfe5ea', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                    {filaCodigo(p.codigo, p.descripcion, <span className="status" style={{ marginLeft: 8, fontSize: 12 }}>por controlar · cantidad 0</span>)}
                    {cands.map((c) => {
                      const nivel = NIVEL_EQUIV[c.nivel] || NIVEL_EQUIV.baja;
                      const ocupado = trabajando === `${p.codigo}|${c.codigo}`;
                      return (
                        <div key={c.codigo} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e3e8ec', flexWrap: 'wrap' }}>
                          <span style={{ background: nivel.bg, color: nivel.color, borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }} title={c.motivos?.join(', ')}>{nivel.label}</span>
                          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                            {filaCodigo(c.codigo, c.descripcion, c.manual ? (
                              <span className="status cargado" style={{ marginLeft: 8, fontSize: 12 }}>
                                en la carga: {Number(c.manual.cantidad).toLocaleString('es-AR')}{c.manual.controlado ? ' · controlado' : ''}
                              </span>
                            ) : null)}
                            <ChequeosEquiv cmp={c.comparacion} />
                            {c.motivos?.length ? <div style={{ fontSize: 12, color: '#7a8790' }}>{c.motivos.join(' · ')}</div> : null}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="small" disabled={!!trabajando} onClick={() => unificar(p, c)}>
                              {ocupado ? 'Guardando…' : 'Es el mismo · unificar'}
                            </button>
                            <button type="button" className="ghost small" disabled={!!trabajando} onClick={() => descartar(p, c)} title="No se vuelve a sugerir este par">No es</button>
                          </div>
                        </div>
                      );
                    })}
                    {!cands.length ? <div style={{ fontSize: 13, color: '#7a8790', marginTop: 6 }}>Ningún código coincide en droga, concentración y presentación. Si existe, buscalo a mano.</div> : null}
                    <div style={{ position: 'relative', marginTop: 8, maxWidth: 520 }}>
                      <input
                        value={busqueda[p.codigo] || ''}
                        onChange={(e) => setBusqueda((b) => ({ ...b, [p.codigo]: e.target.value }))}
                        placeholder="Buscar otro código (código, droga o descripción)"
                        style={{ width: '100%', fontSize: 13 }}
                      />
                      {resultados.length ? (
                        <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', background: '#fff', border: '1px solid #c9d3da', borderRadius: 6, maxHeight: 240, overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,.12)' }}>
                          {resultados.map((r) => (
                            <button key={r.codigo} type="button" onClick={() => elegirOtro(p, r)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 0, borderBottom: '1px solid #eef1f3', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>
                              <strong>{r.codigo}</strong> · {r.descripcion || r.droga}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {hist && !hist.length ? <div className="empty">Todavía no hay códigos unificados ni descartados.</div> : null}
            {noCoinciden ? (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14, margin: '4px 0 8px', color: '#b42318' }}>
                <input type="checkbox" checked={soloNoCoinciden} onChange={(e) => setSoloNoCoinciden(e.target.checked)} />
                Ver solo las {noCoinciden} unificaciones donde la droga, la concentración o la presentación no coinciden
              </label>
            ) : null}
            {hist && hist.length ? (
              <table>
                <thead>
                  <tr><th>Fecha</th><th>Usuario</th><th>Códigos</th><th>Resultado</th><th /></tr>
                </thead>
                <tbody>
                  {hist.filter((h) => !soloNoCoinciden || (h.estado === 'igual' && auditoria[h.id] && !auditoria[h.id].ok)).map((h) => (
                    <tr key={h.id} style={h.estado === 'igual' && auditoria[h.id] && !auditoria[h.id].ok ? { background: '#fdf3f2' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{h.usuario || '—'}</td>
                      <td style={{ fontSize: 13 }}>
                        <div><strong>{h.codigo_a}</strong> · {h.desc_a || ''}</div>
                        <div><strong>{h.codigo_b}</strong> · {h.desc_b || ''}</div>
                        {h.detalle?.queda ? <div style={{ color: '#5b6b76' }}>Quedó en la carga con {h.detalle.queda}{h.detalle.sacado ? ` (se sacó el renglón ${h.detalle.sacado.codigo})` : ''}</div> : null}
                        {h.estado === 'igual' ? <ChequeosEquiv cmp={auditoria[h.id]} /> : null}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{h.estado === 'igual' ? <span className="status cargado">Mismo producto</span> : <span className="status">No es el mismo</span>}</td>
                      <td><button type="button" className="ghost compact" disabled={!!trabajando} onClick={() => deshacer(h)}>Deshacer</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// Carga a mano de un requerimiento sin PDF (ej. 2025): droga + cantidad, una fila por codigo
function CargaRequerimientoManualPage({ token, anio }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [catalogo, setCatalogo] = useState([]);
  const [filasTodas, setFilas] = useState([]);
  const [semestre, setSemestre] = useState(1);
  const [busca, setBusca] = useState('');
  const [elegido, setElegido] = useState(null);
  const [cantidad, setCantidad] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const cantidadRef = useRef(null);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(50);
  const [filtroTabla, setFiltroTabla] = useState('');
  const [filtroCant, setFiltroCant] = useState(() => {
    try { return localStorage.getItem('reqManualFiltroCant') || 'todos'; } catch { return 'todos'; }
  });
  function setFiltroCantRec(v) {
    setFiltroCant(v);
    try { localStorage.setItem('reqManualFiltroCant', v); } catch { /* sin almacenamiento */ }
  }
  const [pestana, setPestana] = useState('pendientes');
  // Comparacion con el año siguiente: '' | 'soloSig' (pedido el año siguiente y no este) | 'soloEste' (pedido este y no el siguiente)
  const [filtroComp, setFiltroCompState] = useState('');
  const [filtroMotivo, setFiltroMotivo] = useState('');
  const setFiltroComp = (k) => { setFiltroCompState(k); setFiltroMotivo(''); };
  const [comp, setComp] = useState({ porCodigo: {}, ministerio: null, listo: false });
  const [compCargando, setCompCargando] = useState(false);
  const [letra, setLetra] = useState('');
  const [grupos, setGrupos] = useState([]);
  const [filtroFuente, setFiltroFuente] = useState('');
  const [edits, setEdits] = useState({});
  const [guardando, setGuardando] = useState({});
  const [colData, setColData] = useState({ datos: {}, meta: {} });
  const [panelCols, setPanelCols] = useState(false);
  const [panelEquiv, setPanelEquiv] = useState(false);
  const [colsVisibles, setColsVisiblesState] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('reqManualColumnas') || 'null');
      return Array.isArray(v) ? v : COLUMNAS_MANUAL_DEFAULT;
    } catch { return COLUMNAS_MANUAL_DEFAULT; }
  });
  function setColsVisibles(lista) {
    setColsVisiblesState(lista);
    try { localStorage.setItem('reqManualColumnas', JSON.stringify(lista)); } catch { /* sin almacenamiento */ }
  }
  const todasCols = useMemo(() => columnasCargaManual(anio, semestre), [anio, semestre]);
  const cols = todasCols.filter((c) => colsVisibles.includes(c.key));
  const gruposCols = useMemo(() => Array.from(new Set(todasCols.map((c) => c.grupo))), [todasCols]);
  const [ocultasMan, setOcultasMan] = useColumnasOcultas('reqManualOcultas');
  const verMan = (k) => !ocultasMan.includes(k);

  async function cargarFilas() {
    const r = await client.reqManual(anio);
    setFilas(r.data || []);
    setGrupos(r.grupos || []);
  }

  useEffect(() => {
    client.reqManualCatalogo().then((r) => setCatalogo(r.data || [])).catch((e) => setMessage(e.message));
    cargarFilas().catch((e) => setMessage(e.message));
  }, [client, anio]);

  const filas = useMemo(() => filasTodas.filter((f) => Number(f.semestre) === semestre), [filasTodas, semestre]);

  // Datos de las columnas: se recargan al cambiar lo cargado o el semestre
  const codigosKey = useMemo(() => filasTodas.map((f) => `${f.semestre}:${f.codigo}`).sort().join('|'), [filasTodas]);
  useEffect(() => {
    if (!codigosKey) { setColData({ datos: {}, meta: {} }); return; }
    client.reqManualColumnas(anio, semestre).then(setColData).catch((e) => setMessage(e.message));
  }, [client, anio, semestre, codigosKey]);
  // Total del anio y pedido del otro semestre, con las cantidades que se van editando
  const pedidosFront = useMemo(() => {
    const m = new Map();
    for (const f of filasTodas) {
      const x = m.get(f.codigo) || { totalAnio: 0, pedidoOtroSem: null };
      x.totalAnio += Number(f.cantidad || 0);
      if (Number(f.semestre) !== semestre) x.pedidoOtroSem = (x.pedidoOtroSem || 0) + Number(f.cantidad || 0);
      m.set(f.codigo, x);
    }
    return m;
  }, [filasTodas, semestre]);
  const datosDe = (f) => ({ ...(colData.datos[f.codigo] || {}), ...(pedidosFront.get(f.codigo) || {}) });
  // Lo pedido en los PDF para el mismo semestre del año siguiente
  const pedidoSigDe = (f) => {
    const d = colData.datos[f.codigo] || {};
    const v = semestre === 1 ? d.reqSigSem1 : d.reqSigSem2;
    return v == null ? null : Number(v);
  };
  const cantidadDe = (f) => Number(edits[f.id] ?? f.cantidad) || 0;
  const pasaComp = (f, k) => {
    if (!k) return true;
    const sig = pedidoSigDe(f) || 0;
    const este = Number(f.cantidad) || 0;
    return k === 'soloSig' ? sig > 0 && este === 0 : este > 0 && sig === 0;
  };
  const semCorto = semestre === 1 ? '1er' : '2do';
  const motivos = useMemo(() => motivosComparacion(anio, semCorto), [anio, semCorto]);
  const motivoPorClave = useMemo(() => new Map([...motivos.soloEste, ...motivos.soloSig].map((m) => [m.k, m])), [motivos]);
  const motivoDe = (f) => comp.porCodigo[f.codigo] || null;
  // Motivos: se calculan en el backend solo con una comparacion activa (tarda unos segundos); se recalcula si cambian las cantidades
  const cantidadesKey = useMemo(() => filasTodas.filter((f) => Number(f.semestre) === semestre).map((f) => `${f.codigo}:${Number(f.cantidad) > 0 ? 1 : 0}`).sort().join('|'), [filasTodas, semestre]);
  useEffect(() => {
    if (!filtroComp) return undefined;
    let vivo = true;
    setCompCargando(true);
    client.reqManualComparacion(anio, semestre)
      .then((r) => { if (vivo) setComp({ ...r, listo: true }); })
      .catch((e) => { if (vivo) setMessage(e.message); })
      .finally(() => { if (vivo) setCompCargando(false); });
    return () => { vivo = false; };
  }, [client, anio, semestre, cantidadesKey, !!filtroComp]);

  const grupoPorClave = useMemo(() => new Map(grupos.map((g) => [g.clave, g])), [grupos]);
  // Cantidad de renglones del semestre por formulario (para el desplegable)
  const cuentaFuente = useMemo(() => {
    const m = new Map();
    for (const f of filas) {
      const fs = f.fuentes ? String(f.fuentes).split('|') : ['__sin'];
      for (const k of fs) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [filas]);
  // Filtro + paginado de la tabla
  const filasSinLetra = useMemo(() => {
    const palabras = filtroTabla.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return filas.filter((f) => {
      // Con una comparacion entre años activa se buscan en las dos pestañas (controlados y por controlar)
      if (!filtroComp && (pestana === 'controlados') !== !!Number(f.controlado)) return false;
      if (filtroFuente) {
        const fs = f.fuentes ? String(f.fuentes).split('|') : [];
        if (filtroFuente === '__sin' ? fs.length : !fs.includes(filtroFuente)) return false;
      }
      if (filtroCant === 'sin' && Number(f.cantidad) !== 0) return false;
      if (filtroCant === 'con' && Number(f.cantidad) === 0) return false;
      if (!pasaComp(f, filtroComp)) return false;
      if (filtroComp && filtroMotivo && motivoDe(f)?.motivo !== filtroMotivo) return false;
      if (!palabras.length) return true;
      const txt = `${f.codigo} ${(f.equivalentes || []).join(' ')} ${f.droga || ''} ${f.descripcion || ''} ${(f.fuentes ? String(f.fuentes).split('|') : []).map((k) => etiquetaFuente(grupoPorClave.get(k))).join(' ')}`.toLowerCase();
      return palabras.every((p) => txt.includes(p));
    });
  }, [filas, filtroTabla, filtroCant, pestana, filtroFuente, grupoPorClave, filtroComp, filtroMotivo, comp, colData, semestre]);
  // Filtro por letra inicial de la droga (sin acentos; "#" = empieza con numero u otro signo)
  const letraDe = (f) => {
    const c = String(f.droga || f.descripcion || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
    return c >= 'A' && c <= 'Z' ? c : '#';
  };
  const letrasConDatos = useMemo(() => new Set(filasSinLetra.map(letraDe)), [filasSinLetra]);
  const filasVista = useMemo(() => (letra ? filasSinLetra.filter((f) => letraDe(f) === letra) : filasSinLetra), [filasSinLetra, letra]);
  const totalPaginas = Math.max(1, Math.ceil(filasVista.length / porPagina));
  const paginaOk = Math.min(pagina, totalPaginas);
  const filasPagina = filasVista.slice((paginaOk - 1) * porPagina, paginaOk * porPagina);
  useEffect(() => { setPagina(1); }, [semestre, filtroTabla, filtroCant, porPagina, pestana, filtroFuente, letra, filtroComp, filtroMotivo]);
  // Cuantos renglones de la comparacion activa hay por motivo
  const cuentaMotivo = useMemo(() => {
    const m = new Map();
    if (!filtroComp) return m;
    for (const f of filas) {
      if (!pasaComp(f, filtroComp)) continue;
      const k = comp.porCodigo[f.codigo]?.motivo || '__sin';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [filas, filtroComp, comp, colData, semestre]);
  // Cuantos renglones (de las dos pestañas) caen en cada filtro de comparacion
  const cuentaComp = useMemo(() => {
    return { soloSig: filas.filter((f) => pasaComp(f, 'soloSig')).length, soloEste: filas.filter((f) => pasaComp(f, 'soloEste')).length };
  }, [filas, pestana, colData, semestre]);

  // Guarda la cantidad escrita en la tabla (si cambio)
  async function guardarCantidadFila(f) {
    const txt = edits[f.id];
    if (txt == null) return;
    const quitarEdit = () => setEdits((e) => { const n = { ...e }; delete n[f.id]; return n; });
    const cant = Number(String(txt).replace(',', '.'));
    if (String(txt).trim() === '' || !Number.isFinite(cant) || cant < 0) {
      setMessage(`Cantidad inválida para ${f.codigo}.`);
      quitarEdit();
      return;
    }
    if (cant === Number(f.cantidad)) { quitarEdit(); return; }
    setGuardando((g) => ({ ...g, [f.id]: true }));
    try {
      await client.reqManualGuardar({ anio, semestre: Number(f.semestre), codigo: f.codigo, droga: f.droga, descripcion: f.descripcion, cantidad: cant });
      setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, cantidad: cant } : x)));
      quitarEdit();
    } catch (err) {
      setMessage(`${f.codigo}: ${err.message}`);
    } finally {
      setGuardando((g) => { const n = { ...g }; delete n[f.id]; return n; });
    }
  }
  // Tilde "controlado": el renglon pasa a la pestaña Controlados (o vuelve si se destilda)
  async function alternarControlado(f) {
    const nuevo = !Number(f.controlado);
    setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, controlado: nuevo ? 1 : 0 } : x)));
    try {
      await client.reqManualControlado(f.id, nuevo);
    } catch (err) {
      setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, controlado: nuevo ? 0 : 1 } : x)));
      setMessage(`${f.codigo}: ${err.message}`);
    }
  }
  const cuentaControlados = filas.filter((f) => Number(f.controlado)).length;

  function teclaCantidad(e, idx) {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const sig = idx + (e.key === 'ArrowUp' ? -1 : 1);
    const el = document.querySelector(`[data-cant-idx="${sig}"]`);
    if (el) el.focus(); else e.currentTarget.blur();
  }

  async function copiarRequerimientoNuevo() {
    if (!window.confirm(`Se agregan al ${semestre === 1 ? '1er' : '2do'} semestre ${anio} los fármacos del requerimiento nuevo con cantidad 0. Lo que ya está cargado no se toca. ¿Seguir?`)) return;
    setBusy(true);
    try {
      const r = await client.reqManualCopiar({ anio, semestre });
      setMessage(`Copiados ${r.insertados} fármacos del requerimiento ${r.origen} con cantidad 0.`);
      await cargarFilas();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function exportarExcel() {
    // Mismas columnas que se ven en pantalla (las basicas ocultas no salen)
    const base = [
      ['controlado', 'Controlado', (f) => (Number(f.controlado) ? 'Sí' : '')],
      ['codigo', 'Código', (f) => f.codigo],
      ['codigo', 'Códigos equivalentes', (f) => (f.equivalentes || []).join(', ')],
      ['droga', 'Droga', (f) => f.droga],
      ['descripcion', 'Descripción', (f) => f.descripcion],
      ['fuentes', 'Formulario / Exp.', (f) => (f.fuentes ? String(f.fuentes).split('|') : []).map((k) => etiquetaFuente(grupoPorClave.get(k)) || k).join(' / ')],
      ['cantidad', 'Cantidad', (f) => Number(f.cantidad)],
      ['pedidoSig', `Pedido ${semCorto} sem. ${anio + 1}`, (f) => pedidoSigDe(f) ?? '']
    ].filter(([k]) => verMan(k));
    if (comp.listo) {
      base.push(['motivo', `Motivo ${anio} vs ${anio + 1}`, (f) => motivoPorClave.get(motivoDe(f)?.motivo)?.label || '']);
      base.push(['motivo', 'Relación encontrada', (f) => motivoDe(f)?.rel || '']);
    }
    const encabezado = [...base.map((b) => b[1]), ...cols.map((c) => c.label)];
    // Sale lo mismo que muestra la tabla: pestaña, comparacion, motivo, cantidad 0, formulario, texto y letra (todas las paginas)
    const aoa = [encabezado, ...filasVista.map((f) => {
      const d = datosDe(f);
      return [...base.map((b) => b[2](f)), ...cols.map((c) => c.get(d, f, colData.meta) ?? '')];
    })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `${semestre === 1 ? '1er' : '2do'} sem ${anio}`);
    const sufijo = filtroComp
      ? `-${filtroComp === 'soloEste' ? `pedido${anio}-no${anio + 1}` : `pedido${anio + 1}-no${anio}`}${filtroMotivo ? `-${filtroMotivo}` : ''}`
      : `-${pestana === 'controlados' ? 'controlados' : 'por-controlar'}`;
    descargarLibro(wb, `requerimiento-${anio}-sem${semestre}${sufijo}`);
  }
  const cuentaSem = (s) => filasTodas.filter((f) => Number(f.semestre) === s).length;
  const cargados = useMemo(() => new Map(filas.map((f) => [f.codigo, f])), [filas]);

  const sugerencias = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2 || elegido) return [];
    const palabras = q.split(/\s+/);
    return catalogo
      .filter((c) => {
        const txt = `${c.codigo} ${c.droga || ''} ${c.descripcion || ''}`.toLowerCase();
        return palabras.every((p) => txt.includes(p));
      })
      .slice(0, 30);
  }, [busca, catalogo, elegido]);

  function elegir(c) {
    setElegido(c);
    setBusca(`${c.codigo} · ${c.descripcion || c.droga}`);
    const ya = cargados.get(c.codigo);
    setCantidad(ya ? String(Number(ya.cantidad)) : '');
    setTimeout(() => cantidadRef.current?.focus(), 0);
  }

  function limpiar() {
    setElegido(null);
    setBusca('');
    setCantidad('');
  }

  async function guardar(e) {
    e.preventDefault();
    if (!elegido) { setMessage('Elegí una droga de la lista.'); return; }
    const cant = Number(String(cantidad).replace(',', '.'));
    if (String(cantidad).trim() === '' || !(cant >= 0)) { setMessage('Poné una cantidad (0 o más).'); return; }
    setBusy(true);
    try {
      await client.reqManualGuardar({ anio, semestre, codigo: elegido.codigo, droga: elegido.droga || elegido.descripcion, descripcion: elegido.descripcion, cantidad: cant });
      setMessage(`${cargados.has(elegido.codigo) ? 'Actualizado' : 'Agregado'} en ${semestre === 1 ? '1er' : '2do'} semestre: ${elegido.codigo} · ${cant}`);
      limpiar();
      await cargarFilas();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function eliminar(f) {
    if (!window.confirm(`¿Sacar ${f.codigo} · ${f.droga} del ${Number(f.semestre) === 1 ? '1er' : '2do'} semestre ${anio}?`)) return;
    setBusy(true);
    try {
      await client.reqManualEliminar(f.id);
      await cargarFilas();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totalUnidades = filas.reduce((s, f) => s + Number(f.cantidad || 0), 0);

  // Barra de paginas + filtro por letra (se muestra arriba y abajo de la tabla)
  const barraPaginas = (donde) => (
    <section className="toolbar" style={{ marginTop: 8, flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <div style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
        <span style={{ fontWeight: 700, marginRight: 4 }}>Letra:</span>
        <button
          type="button"
          className={`ghost compact ${!letra ? 'active' : ''}`}
          style={!letra ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined}
          onClick={() => setLetra('')}
        >
          Todas
        </button>
        {[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'].map((l) => (
          <button
            key={l}
            type="button"
            className={`ghost compact ${letra === l ? 'active' : ''}`}
            style={{ minWidth: 30, padding: '4px 6px', ...(letra === l ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : {}) }}
            onClick={() => setLetra(letra === l ? '' : l)}
            disabled={!letrasConDatos.has(l) && letra !== l}
            title={l === '#' ? 'Empiezan con número u otro signo' : `Drogas que empiezan con ${l}`}
          >
            {l}
          </button>
        ))}
      </div>
      <button type="button" className="ghost small" onClick={() => setPagina(1)} disabled={paginaOk <= 1}>« Primera</button>
      <button type="button" className="ghost small" onClick={() => setPagina(paginaOk - 1)} disabled={paginaOk <= 1}>‹ Anterior</button>
      <span>Página {paginaOk} de {totalPaginas} · {filasVista.length} renglones{letra ? ` con «${letra}»` : ''}</span>
      <button type="button" className="ghost small" onClick={() => setPagina(paginaOk + 1)} disabled={paginaOk >= totalPaginas}>Siguiente ›</button>
      <button type="button" className="ghost small" onClick={() => setPagina(totalPaginas)} disabled={paginaOk >= totalPaginas}>Última »</button>
      <select value={porPagina} onChange={(e) => setPorPagina(Number(e.target.value))} style={{ width: 'auto', flex: '0 0 auto' }}>
        {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} por página</option>)}
      </select>
      {donde === 'arriba' ? <span style={{ color: '#5b6b76', fontSize: 13 }}>Escribí la cantidad en la tabla: se guarda al salir de la celda. Enter o ↓ pasa a la siguiente.</span> : null}
    </section>
  );

  return (
    <div className="req-page">
      <section className="page-title">
        <h2>Carga Requerimiento {anio}</h2>
      </section>
      <AyudaPagina id="carga2025" />

      {message ? <div className="notice">{message}</div> : null}

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>Semestre:</span>
        {[1, 2].map((s) => (
          <button
            key={s}
            type="button"
            className={`ghost small ${semestre === s ? 'active' : ''}`}
            style={semestre === s ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined}
            onClick={() => { setSemestre(s); limpiar(); }}
          >
            {s === 1 ? '1er' : '2do'} semestre {anio} ({cuentaSem(s)})
          </button>
        ))}
        <span style={{ color: '#5b6b76', fontSize: 13 }}>Lo que cargues queda en el semestre elegido.</span>
        <button type="button" className="ghost small" onClick={copiarRequerimientoNuevo} disabled={busy} style={{ marginLeft: 'auto' }} title="Agrega los fármacos del requerimiento de PDF más nuevo con cantidad 0 (no pisa lo cargado)">
          <ClipboardList size={15} /> Copiar fármacos del requerimiento nuevo (cantidad 0)
        </button>
        <button type="button" className="ghost small" onClick={() => setPanelEquiv(true)} disabled={!filas.length} title="El mismo producto con código viejo y código nuevo: sugerencias para unificarlos e historial">
          <Link2 size={15} /> Códigos equivalentes
        </button>
      </section>
      {panelEquiv ? (
        <UnificarCodigosPanel
          client={client}
          anio={anio}
          semestre={semestre}
          catalogo={catalogo}
          onCambio={() => cargarFilas().catch((e) => setMessage(e.message))}
          onCerrar={() => setPanelEquiv(false)}
        />
      ) : null}

      <form className="toolbar" onSubmit={guardar} style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ position: 'relative', flex: '1 1 420px', minWidth: 260 }}>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 4 }}>Droga</label>
          <input
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setElegido(null); }}
            placeholder="Buscar por código, droga o descripción"
            style={{ width: '100%' }}
            autoFocus
          />
          {sugerencias.length ? (
            <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', background: '#fff', border: '1px solid #c9d3da', borderRadius: 6, maxHeight: 340, overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,.12)' }}>
              {sugerencias.map((c) => (
                <button
                  type="button"
                  key={c.codigo}
                  onClick={() => elegir(c)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 0, borderBottom: '1px solid #eef1f3', background: 'transparent', cursor: 'pointer' }}
                >
                  <strong>{c.codigo}</strong> · {c.descripcion || c.droga}
                  {cargados.has(c.codigo) ? <span className="status cargado" style={{ marginLeft: 8, fontSize: 12 }}>ya cargado: {Number(cargados.get(c.codigo).cantidad)}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {busca.trim().length >= 2 && !elegido && !sugerencias.length ? (
            <div style={{ color: '#5b6b76', fontSize: 13, marginTop: 4 }}>No hay fármacos que coincidan.</div>
          ) : null}
        </div>
        <div>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 4 }}>Cantidad</label>
          <input ref={cantidadRef} type="number" min="0" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} style={{ width: 140 }} />
        </div>
        <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
          <button type="submit" disabled={busy || !elegido}><Save size={16} /> {elegido && cargados.has(elegido.codigo) ? 'Actualizar' : 'Agregar'}</button>
          <button type="button" className="ghost" onClick={limpiar} disabled={busy}>Limpiar</button>
        </div>
      </form>

      <section className="summary-grid">
        <Metric label="Renglones cargados" value={filas.length} />
        <Metric label="Unidades" value={totalUnidades.toLocaleString('es-AR')} />
        <Metric label="Sin cantidad (0)" value={filas.filter((f) => Number(f.cantidad) === 0).length} />
      </section>

      <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
        {[['pendientes', 'Por controlar', filas.length - cuentaControlados], ['controlados', 'Controlados', cuentaControlados]].map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            className={`ghost small ${pestana === k ? 'active' : ''}`}
            style={pestana === k && !filtroComp ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined}
            onClick={() => { setPestana(k); setFiltroComp(''); }}
          >
            {label} ({n})
          </button>
        ))}
      </div>

      <section className="toolbar" style={{ marginTop: 8, position: 'relative', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <button type="button" className={`ghost small ${panelCols ? 'active' : ''}`} onClick={() => setPanelCols(!panelCols)}>
          <Sigma size={15} /> Columnas ({cols.length}){ocultasMan.length ? ` · ${ocultasMan.length} ocultas` : ''}
        </button>
        <button type="button" className="ghost small" onClick={exportarExcel} disabled={!filasVista.length} title="Exporta los renglones que muestra la tabla con los filtros aplicados (todas las páginas)"><Download size={15} /> Exportar a Excel ({filasVista.length})</button>
        <input value={filtroTabla} onChange={(e) => setFiltroTabla(e.target.value)} placeholder="Filtrar tabla: código, droga o expediente" style={{ minWidth: 220 }} />
        <select value={filtroFuente} onChange={(e) => setFiltroFuente(e.target.value)} style={{ width: 'auto', flex: '0 1 auto', maxWidth: 420 }} title="Formulario de requerimiento / expediente en papel donde figura el código">
          <option value="">Todos los formularios / expedientes</option>
          {grupos.map((g) => <option key={g.clave} value={g.clave}>{etiquetaFuente(g)} ({cuentaFuente.get(g.clave) || 0})</option>)}
          <option value="__sin">Sin formulario en papel ({cuentaFuente.get('__sin') || 0})</option>
        </select>
        <span style={{ fontWeight: 700, marginLeft: 6 }}>Cantidad 0:</span>
        {[['con', 'Ocultar los de 0'], ['todos', 'Mostrar todos'], ['sin', 'Solo los de 0']].map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`ghost small ${filtroCant === k ? 'active' : ''}`}
            style={filtroCant === k ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined}
            onClick={() => setFiltroCantRec(k)}
          >
            {label}
          </button>
        ))}
        {[
          ['', 'Sin comparar', null, 'Muestra todos los renglones, sin filtrar por la comparación entre años', 'Comparar:'],
          ['soloEste', `Pedido en ${anio} y no en ${anio + 1}`, cuentaComp.soloEste, `Renglones con cantidad cargada en ${anio} que no figuran (o están en 0) en los PDF del ${semCorto} sem. ${anio + 1}`, `${anio} vs ${anio + 1}:`],
          ['soloSig', `Pedido en ${anio + 1} y no en ${anio}`, cuentaComp.soloSig, `Renglones con cantidad 0 en ${anio} que sí figuran en los PDF del ${semCorto} sem. ${anio + 1}`, `${anio + 1} vs ${anio}:`]
        ].map(([k, label, n, title, rotulo]) => (
          <React.Fragment key={k || 'todos'}>
          <span style={{ fontWeight: 700, marginLeft: 6 }}>{rotulo}</span>
          <button
            type="button"
            className={`ghost small ${filtroComp === k ? 'active' : ''}`}
            style={filtroComp === k ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined}
            onClick={() => setFiltroComp(k)}
            title={title}
          >
            {label}{n != null ? ` (${n})` : ''}
          </button>
          </React.Fragment>
        ))}
        {colData.meta?.stockFecha ? <span style={{ color: '#5b6b76', fontSize: 13 }}>Stock al {fmtFechaAr(colData.meta.stockFecha)}</span> : null}
        {panelCols ? (
          <PanelColumnas columnas={todasCols} visibles={colsVisibles} onCambiar={setColsVisibles} porDefecto={COLUMNAS_MANUAL_DEFAULT} onCerrar={() => setPanelCols(false)}
            basicas={BASICAS_CARGA_MANUAL} ocultas={ocultasMan} onOcultas={setOcultasMan} />
        ) : null}
      </section>

      {filtroComp ? (
        <section className="motivos-panel">
          <div className="motivos-titulo">
            <strong>
              {filtroComp === 'soloEste' ? `¿Por qué se pidió en ${anio} y no en ${anio + 1}?` : `¿Por qué se pide en ${anio + 1} y no se pidió en ${anio}?`}
            </strong>
            <span>
              {compCargando ? 'Calculando motivos…' : 'Tocá un cuadro para ver solo esos renglones. El motivo es una sugerencia automática: revisalo.'}
            </span>
          </div>
          <div className="motivos-grid">
            <button type="button" className={`motivo-card ${!filtroMotivo ? 'activo' : ''}`} onClick={() => setFiltroMotivo('')}>
              <span className="motivo-n">{filtroComp === 'soloEste' ? cuentaComp.soloEste : cuentaComp.soloSig}</span>
              <span className="motivo-label">Todos</span>
              <span className="motivo-corto">Todos los motivos</span>
            </button>
            {motivos[filtroComp].map((m) => {
              const t = TONO_MOTIVO[m.tono];
              const n = cuentaMotivo.get(m.k) || 0;
              return (
                <button
                  key={m.k}
                  type="button"
                  className={`motivo-card ${filtroMotivo === m.k ? 'activo' : ''}`}
                  style={{ background: t.bg, borderColor: filtroMotivo === m.k ? t.color : t.borde }}
                  onClick={() => setFiltroMotivo(filtroMotivo === m.k ? '' : m.k)}
                  title={m.texto}
                  disabled={!comp.listo}
                >
                  <span className="motivo-n" style={{ color: t.color }}>{comp.listo ? n : '…'}</span>
                  <span className="motivo-label">{m.label}</span>
                  <span className="motivo-corto" style={{ color: t.color }}>{m.corto}</span>
                </button>
              );
            })}
          </div>
          {filtroMotivo ? <div className="motivos-explica">{motivoPorClave.get(filtroMotivo)?.texto}</div> : null}
          {comp.listo && !comp.ministerio ? (
            <div className="motivos-explica" style={{ color: '#b42318' }}>
              No hay comunicación del Ministerio cargada para el {semCorto} semestre {anio + 1} (pantalla «Ministerio (habilitación)»): los motivos «Ministerio dijo NO» no se pueden calcular.
            </div>
          ) : comp.ministerio ? (
            <div className="motivos-fuente">Ministerio: «{comp.ministerio.archivo}» ({comp.ministerio.items} ítems).</div>
          ) : null}
        </section>
      ) : null}

      {filtroComp ? (
        <div className="notice" style={{ marginTop: 8, lineHeight: 1.5 }}>
          {filtroComp === 'soloSig' ? (
            <>
              <strong>Pedido en {anio + 1} y no en {anio}:</strong> fármacos que el Ministerio tiene en los PDF de requerimiento del {semCorto} semestre {anio + 1}, pero que acá tienen <strong>cantidad 0</strong> para {anio}.
              {' '}Muchos entraron con el botón «Copiar fármacos del requerimiento nuevo (cantidad 0)»: no estaban en ningún formulario en papel de {anio} y se agregaron para que no se pierdan.
              {' '}Qué hacer: si en {anio} también hacía falta, escribí la cantidad; si no, dejalo en 0 y tildalo como controlado (o usá «Quitar»).
            </>
          ) : (
            <>
              <strong>Pedido en {anio} y no en {anio + 1}:</strong> fármacos que tienen cantidad cargada para {anio} pero <strong>no aparecen</strong> (o están en 0) en los PDF de requerimiento del {semCorto} semestre {anio + 1}.
              {' '}Sirve para revisar si se dejaron de pedir a propósito o si quedaron afuera del requerimiento nuevo por error.
            </>
          )}
          {' '}Se muestran los renglones de las <strong>dos pestañas</strong> (Por controlar y Controlados): mirá la casilla «Contr.» para saber en cuál está cada uno. Tocá «Sin comparar» para volver a la pestaña.
        </div>
      ) : null}

      <details className="ayuda-carga">
        <summary>¿Cómo leer esta tabla? (explicación de columnas, colores y filtros)</summary>
        <ul>
          <li><strong>Cantidad {anio}:</strong> lo que se pide para el {semCorto} semestre {anio}. Se escribe directo en la tabla y se guarda al salir de la celda.</li>
          <li><strong>Pedido {semCorto} sem. {anio + 1}:</strong> lo que el Ministerio tiene en los PDF de requerimiento para el mismo semestre de {anio + 1} (sumando códigos equivalentes). «—» = no figura en ningún PDF de {anio + 1}.</li>
          <li><span style={{ color: '#b54708', fontWeight: 700 }}>Número en naranja</span>: se pide en {anio + 1} pero acá está en 0 para {anio}.</li>
          <li><span style={{ color: '#b42318', fontWeight: 700 }}>Número en rojo</span>: hay cantidad para {anio} pero no se pide en {anio + 1}.</li>
          <li><strong>Fila amarilla:</strong> renglón con cantidad 0.</li>
          <li><strong>Formulario / Exp. con «—»:</strong> el código no está en ningún formulario ni expediente en papel de {anio}. Suele pasar con los que se agregaron desde el PDF nuevo (etiqueta <span className="tag-pdf">solo PDF {anio + 1}</span> abajo del código).</li>
          <li><strong>Comparar «{anio} vs {anio + 1}»:</strong> «Pedido en {anio} y no en {anio + 1}» muestra los rojos (se pedían en {anio} y en {anio + 1} ya no).</li>
          <li><strong>Cuadros de motivos:</strong> al elegir una comparación aparecen cuadros con el porqué de cada diferencia (cambio de código, Ministerio dijo NO, otra concentración, no hay nada…). Tocá uno para ver solo esos renglones; la columna «Motivo» dice con qué código o con qué renglón del Ministerio se relacionó.
            {' '}<span style={{ color: '#1f7a3a', fontWeight: 700 }}>Verde</span> = está bien o no es una diferencia real; <span style={{ color: '#8a5a00', fontWeight: 700 }}>amarillo</span> = revisar; <span style={{ color: '#b42318', fontWeight: 700 }}>rojo</span> = revisar con prioridad.</li>
          <li><strong>Comparar «{anio + 1} vs {anio}»:</strong> «Pedido en {anio + 1} y no en {anio}» muestra los naranjas (son nuevos en {anio + 1}). «Sin comparar» vuelve a mostrar todo. Las comparaciones buscan en las dos pestañas (Por controlar y Controlados); el número entre paréntesis es el total.</li>
          <li><strong>Por controlar / Controlados:</strong> al tildar la casilla «Contr.», el renglón pasa a Controlados; al destildarlo, vuelve.</li>
        </ul>
      </details>

      {barraPaginas('arriba')}

      <section className="table-wrap" style={{ marginTop: 8 }}>
        <table className="carga-manual">
          <thead>
            <tr>
              <th style={{ textAlign: 'center', width: 56 }} title="Controlado. Al tildar, el renglón pasa a la pestaña Controlados">Contr.</th>
              <th title={BASICAS_CARGA_MANUAL[1].title}>Código</th>
              {verMan('droga') ? <th title={BASICAS_CARGA_MANUAL[2].title}>Droga</th> : null}
              {verMan('descripcion') ? <th title={BASICAS_CARGA_MANUAL[3].title}>Descripción</th> : null}
              {verMan('fuentes') ? <th title="Formularios de requerimiento / expedientes en papel donde figura">Formulario / Exp.</th> : null}
              {verMan('cantidad') ? <th style={{ textAlign: 'right' }} title={BASICAS_CARGA_MANUAL[5].title}>Cantidad {anio}</th> : null}
              {verMan('pedidoSig') ? <th style={{ textAlign: 'right' }} title={`Lo pedido en los PDF de requerimiento del Ministerio para el ${semCorto} semestre ${anio + 1}. Naranja: pedido en ${anio + 1} y en 0 en ${anio}. Rojo: pedido en ${anio} y no en ${anio + 1}. ${EQUIV_TXT}`}>Pedido {semCorto} sem. {anio + 1}</th> : null}
              {filtroComp ? <th style={{ minWidth: 220 }} title="Motivo probable de la diferencia entre los dos años y con qué se relacionó">Motivo</th> : null}
              {cols.map((c) => <th key={c.key} style={{ textAlign: 'right' }} title={c.title || ''}>{c.label}</th>)}
              {verMan('acciones') ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {filasPagina.map((f, idx) => (
              <tr key={f.id} style={Number(f.cantidad) === 0 && edits[f.id] == null ? { background: '#fffbea' } : undefined}>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!Number(f.controlado)} onChange={() => alternarControlado(f)} style={{ width: 18, height: 18, cursor: 'pointer' }} title={Number(f.controlado) ? 'Destildar: vuelve a Por controlar' : 'Tildar: pasa a Controlados'} />
                </td>
                <td>
                  {f.codigo}
                  {f.equivalentes?.length ? (
                    <div style={{ fontSize: 11, color: '#5b6b76', whiteSpace: 'nowrap' }} title="Códigos equivalentes: sus datos (stock, consumo, O.C., formularios) se suman en este renglón">
                      <Link2 size={11} /> {f.equivalentes.join(', ')}
                    </div>
                  ) : null}
                  {!f.fuentes && Number(f.cantidad) === 0 && (pedidoSigDe(f) || 0) > 0 ? (
                    <div><span className="tag-pdf" title={`No está en ningún formulario en papel de ${anio}: viene de los PDF de requerimiento de ${anio + 1} y quedó con cantidad 0 en ${anio}.`}>solo PDF {anio + 1}</span></div>
                  ) : null}
                </td>
                {verMan('droga') ? <td>{f.droga}</td> : null}
                {verMan('descripcion') ? <td>{f.descripcion}</td> : null}
                {verMan('fuentes') ? (
                <td style={{ fontSize: 11, color: '#3b4a55' }}>
                  {f.fuentes ? String(f.fuentes).split('|').map((k) => (
                    <div key={k} style={{ whiteSpace: 'nowrap' }}>{etiquetaFuente(grupoPorClave.get(k)) || k}</div>
                  )) : <span style={{ color: '#9aa7b0' }} title={`No figura en ningún formulario ni expediente en papel de ${anio}`}>—</span>}
                </td>
                ) : null}
                {verMan('cantidad') ? (
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    data-cant-idx={idx}
                    value={edits[f.id] ?? String(Number(f.cantidad))}
                    onChange={(e) => { const v = e.target.value; setEdits((x) => ({ ...x, [f.id]: v })); }}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => guardarCantidadFila(f)}
                    onKeyDown={(e) => teclaCantidad(e, idx)}
                    disabled={!!guardando[f.id]}
                    style={{ width: 84, textAlign: 'right', padding: '4px 6px' }}
                  />
                </td>
                ) : null}
                {verMan('pedidoSig') ? (() => {
                  const sig = pedidoSigDe(f);
                  const este = cantidadDe(f);
                  const color = (sig || 0) > 0 && este === 0 ? '#b54708' : este > 0 && !(sig > 0) ? '#b42318' : undefined;
                  return <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color, fontWeight: color ? 700 : undefined }}>{sig == null ? '—' : sig.toLocaleString('es-AR')}</td>;
                })() : null}
                {filtroComp ? (() => {
                  const mo = motivoDe(f);
                  const def = mo && motivoPorClave.get(mo.motivo);
                  if (!def) return <td style={{ color: '#9aa7b0', fontSize: 12 }}>{compCargando ? 'Calculando…' : '—'}</td>;
                  const t = TONO_MOTIVO[def.tono];
                  return (
                    <td style={{ fontSize: 12 }}>
                      <span className="motivo-tag" style={{ background: t.bg, color: t.color, borderColor: t.borde }} title={def.texto}>{def.label}</span>
                      {mo.rel ? <div style={{ color: '#3b4a55', marginTop: 3 }}>{mo.rel}</div> : null}
                    </td>
                  );
                })() : null}
                {cols.map((c) => {
                  const v = c.get(datosDe(f), { ...f, cantidad: edits[f.id] ?? f.cantidad }, colData.meta);
                  const color = c.key === 'difConsumo' && v != null ? (v < 0 ? '#b42318' : v > 0 ? '#1f7a3a' : undefined) : undefined;
                  return <td key={c.key} style={{ textAlign: 'right', whiteSpace: 'nowrap', color }}>{formatoColumna(c, v)}</td>;
                })}
                {verMan('acciones') ? (
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="ghost compact" onClick={() => elegir({ codigo: f.codigo, droga: f.droga, descripcion: f.descripcion })} disabled={busy}>Editar</button>
                  <button type="button" className="ghost compact" onClick={() => eliminar(f)} disabled={busy}>Quitar</button>
                </td>
                ) : null}
              </tr>
            ))}
            {filas.length && !filasVista.length ? (
              <tr><td colSpan={BASICAS_CARGA_MANUAL.length - ocultasMan.length + cols.length + (filtroComp ? 1 : 0)} style={{ color: '#5b6b76', textAlign: 'center' }}>{pestana === 'controlados' && !cuentaControlados ? 'Todavía no hay renglones controlados.' : pestana === 'pendientes' && cuentaControlados === filas.length ? 'Ya están todos controlados.' : 'Ningún renglón coincide con el filtro.'}</td></tr>
            ) : null}
            {!filas.length ? (
              <tr><td colSpan={BASICAS_CARGA_MANUAL.length - ocultasMan.length + cols.length + (filtroComp ? 1 : 0)} style={{ color: '#5b6b76', textAlign: 'center' }}>Todavía no hay nada cargado para el {semestre === 1 ? '1er' : '2do'} semestre {anio}.</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {barraPaginas('abajo')}
    </div>
  );
}

function RequerimientoAnualPage({ token, soloMinisterio = false }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [source, setSource] = useState({ dir: '', watch: null, data: [] });
  const [importacionesTodas, setImportaciones] = useState([]);
  const [itemsTodos, setItems] = useState([]);
  const [cicloSel, setCicloSel] = useState('');
  const [vista, setVista] = useState(soloMinisterio ? 'ministerio' : 'codigo');
  const [search, setSearch] = useState('');
  const [reqFiltro, setReqFiltro] = useState('');
  const [soloRepetidos, setSoloRepetidos] = useState(false);
  const [verVencimientos, setVerVencimientos] = useState(() => {
    try { return localStorage.getItem('verVencimientosConsumo') !== '0'; } catch { return true; }
  });
  const cambiarVerVencimientos = (v) => {
    setVerVencimientos(v);
    try { localStorage.setItem('verVencimientosConsumo', v ? '1' : '0'); } catch { /* sin localStorage */ }
  };
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [vtoAbiertos, setVtoAbiertos] = useState(() => new Set()); // filas con el detalle de vencimientos abierto
  const alternarVto = (clave) => setVtoAbiertos((prev) => {
    const s = new Set(prev);
    if (s.has(clave)) s.delete(clave); else s.add(clave);
    return s;
  });
  const [picker, setPicker] = useState(false);
  const [cruce, setCruce] = useState({ descarga: null, totalOrdenes: 0, data: [] });
  const [filtroStock, setFiltroStock] = useState('todos');
  const [filtroOc, setFiltroOc] = useState('todos');
  const [historial, setHistorial] = useState({ importacion: null, filas: [], vinculos: [] });
  const [difPeriodo, setDifPeriodo] = useState('todos');
  const [verPorNombre, setVerPorNombre] = useState(false);
  const [difLado, setDifLado] = useState('oc_no_req');
  const [filtroDifMin, setFiltroDifMin] = useState('todos');
  const [filtroDifReq, setFiltroDifReq] = useState('todos');
  const [filtroStockMin, setFiltroStockMin] = useState('todos');
  const [periodosOcultos, setPeriodosOcultosState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('req_periodos_ocultos') || '[]');
    } catch {
      return [];
    }
  });
  function setPeriodosOcultos(lista) {
    setPeriodosOcultosState(lista);
    try { localStorage.setItem('req_periodos_ocultos', JSON.stringify(lista)); } catch { /* sin almacenamiento */ }
  }
  const [comunicaciones, setComunicaciones] = useState([]);
  const [comSel, setComSel] = useState('');
  const [minItems, setMinItems] = useState([]);
  const [filtroMin, setFiltroMin] = useState('no');
  const [minVista, setMinVista] = useState('cruce');
  const [filtroLista, setFiltroLista] = useState('no');
  const [consumo, setConsumo] = useState({ items: [] });
  // Consumo por trimestre del Analisis Trimestral (para semestres que Farmacia MS no tiene, ej. 1er sem 2025)
  const [trimestral, setTrimestral] = useState({ importaciones: [], items: [] });
  const [farmacoVto, setFarmacoVto] = useState('');
  const [verReqNoEmp, setVerReqNoEmp] = useState(false);
  const [aniosOcultosVto, setAniosOcultosVto] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aniosOcultosConsumoVto') || '[]'); } catch { return []; }
  });
  const [bajasData, setBajasData] = useState({ data: [], vinculos: [], historico: [] });
  const [filtroNoEmp, setFiltroNoEmp] = useState('sin');
  // Farmacos repetidos del Stock Actual con su estado en Codigos equivalentes (para el filtro "Sin unir")
  const [repStock, setRepStock] = useState(null);
  const [equivRows, setEquivRows] = useState([]); // Codigos equivalentes (igual / distinto) para sumar familias
  const [vtoData, setVtoData] = useState({ items: [], hasta: null });
  const [filtroConsumo, setFiltroConsumo] = useState('todos');
  // Columnas elegibles de la pestaña Por codigo
  const [colsReq, setColsReq] = useState({ datos: {}, meta: {} });
  const [panelColsReq, setPanelColsReq] = useState(false);
  const [colsReqVisibles, setColsReqVisiblesState] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('reqAnalisisColumnas') || 'null'); return Array.isArray(v) ? v : null; } catch { return null; }
  });
  const setColsReqVisibles = (lista) => {
    setColsReqVisiblesState(lista);
    try { localStorage.setItem('reqAnalisisColumnas', JSON.stringify(lista)); } catch { /* sin almacenamiento */ }
  };
  const [ocultasReq, setOcultasReq] = useColumnasOcultas('reqAnalisisOcultas');
  // Correcciones del requerimiento (valor corregido a mano; el original del PDF se conserva)
  const [ajustes, setAjustes] = useState([]);
  const [histAjustes, setHistAjustes] = useState([]);
  const [editReq, setEditReq] = useState(null); // { codigo, cantidad, motivo }
  const [guardandoReq, setGuardandoReq] = useState(false);
  const [soloCorregidos, setSoloCorregidos] = useState(false);
  const verReq = (k) => !ocultasReq.includes(k);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Cada semestre es un ciclo de compra aparte: los requerimientos de distintos ciclos no se suman.
  const ciclos = useMemo(() => {
    const m = new Map();
    for (const imp of importacionesTodas) {
      const c = cicloDe(imp.periodo_desde);
      const x = m.get(c) || { ciclo: c, requerimientos: 0, monto: 0 };
      x.requerimientos += 1;
      x.monto += Number(imp.total_calculado || 0);
      m.set(c, x);
    }
    return Array.from(m.values()).sort((a, b) => b.ciclo.localeCompare(a.ciclo));
  }, [importacionesTodas]);
  // Por defecto, el ciclo mas reciente
  const ciclo = ciclos.some((c) => c.ciclo === cicloSel) ? cicloSel : (ciclos[0]?.ciclo || '');
  const importaciones = useMemo(() => importacionesTodas.filter((imp) => cicloDe(imp.periodo_desde) === ciclo), [importacionesTodas, ciclo]);
  const items = useMemo(() => {
    const ids = new Set(importaciones.map((imp) => imp.id));
    return itemsTodos.filter((it) => ids.has(it.importacion_id));
  }, [itemsTodos, importaciones]);

  async function refresh(silencioso = false) {
    if (!silencioso) setBusy(true);
    try {
      // Stock actual y O.C. por codigo (mismo cruce que usa Ordenes de Compra)
      client.ocCruceStock().then(setCruce).catch(() => {});
      client.ocHistorial().then(setHistorial).catch(() => {});
      client.consumoMs().then(setConsumo).catch(() => {});
      client.trimestreImportaciones().then(async (r) => {
        const imps = r.data || [];
        const lotes = await Promise.all(imps.map((imp) => client.trimestreItems({ importacionId: imp.id }).then((x) => x.data || [])));
        setTrimestral({ importaciones: imps, items: lotes.flat() });
      }).catch(() => {});
      client.bajasMs().then(setBajasData).catch(() => {});
      client.vencidos().then((r) => setVtoData({ items: r.items || [], hasta: (r.descargas || []).find((d) => d.id === r.descargaId)?.hasta || null })).catch(() => {});
      cargarComunicaciones();
      const [src, analisis] = await Promise.all([client.requerimientosSource(), client.requerimientosAnalisis()]);
      setSource(src);
      setImportaciones(analisis.importaciones);
      setItems(analisis.items.map((it) => ({ ...it, forma: formaFarmaceutica(it.descripcion), concentracion: concentracionDe(it.descripcion) })));
    } catch (err) {
      setMessage(err.message);
    } finally {
      if (!silencioso) setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(true), 60000);
    return () => clearInterval(timer);
  }, []);

  async function cargarRepStock() {
    try {
      setRepStock(await client.stockRepetidos());
    } catch (err) {
      setRepStock({ error: err.message });
    }
    try {
      const r = await client.equivHistorial();
      setEquivRows(Array.isArray(r) ? r : r.data || []);
    } catch { /* sin equivalencias: cada codigo va solo */ }
  }
  useEffect(() => { cargarRepStock(); }, []);

  async function leerCarpeta() {
    setBusy(true);
    try {
      const r = await client.sincronizarRequerimientos();
      setMessage(r.nuevos ? `Se importaron ${r.nuevos} PDF nuevo(s).` : 'No hay PDF nuevos en la carpeta.');
      if (r.errores?.length) setMessage(`Errores: ${r.errores.map((e) => `${e.archivo}: ${e.error}`).join(' · ')}`);
      await refresh(true);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function elegirCarpeta(ruta) {
    setPicker(false);
    setBusy(true);
    try {
      const r = await client.cambiarCarpetaRequerimientos(ruta);
      setMessage(`Carpeta cambiada a ${r.dir}. ${r.nuevos ? `Se importaron ${r.nuevos} PDF nuevo(s).` : 'No hay PDF nuevos para importar.'}`);
      await refresh(true);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cargarItemsMinisterio(id) {
    setComSel(id ? String(id) : '');
    setMinItems(id ? (await client.ministerioItems(id)).data : []);
  }

  // Al cambiar de ciclo (o al cargar comunicaciones) se elige la comunicacion del Ministerio de ese semestre
  useEffect(() => {
    if (!ciclo || !comunicaciones.length) return;
    const delCiclo = comunicaciones.find((c) => `${c.anio}-${c.semestre}` === ciclo);
    if (delCiclo && String(delCiclo.id) !== comSel) cargarItemsMinisterio(delCiclo.id);
    if (!delCiclo && comSel) cargarItemsMinisterio('');
  }, [ciclo, comunicaciones]);

  // Lista de comunicaciones; si no hay una elegida (o ya no existe) se usa la mas reciente
  async function cargarComunicaciones(preferida) {
    try {
      const { data } = await client.ministerioComunicaciones();
      setComunicaciones(data);
      const elegida = data.find((c) => String(c.id) === String(preferida || comSel)) || data[0];
      await cargarItemsMinisterio(elegida ? elegida.id : '');
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function subirComunicacion(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const r = await client.subirComunicacionMinisterio(file);
      setMessage(r.duplicado
        ? 'Ese PDF ya estaba cargado.'
        : `Comunicación del Ministerio cargada (${r.periodo || 'sin período en el nombre'}): ${r.items} códigos.`);
      await cargarComunicaciones(r.id);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function eliminarComunicacion() {
    const c = comunicaciones.find((x) => String(x.id) === comSel);
    if (!c || !window.confirm(`¿Quitar la comunicación «${c.archivo_nombre}»?`)) return;
    try {
      await client.eliminarComunicacionMinisterio(c.id);
      setMessage('Comunicación quitada.');
      await cargarComunicaciones('');
    } catch (err) {
      setMessage(err.message);
    }
  }

  // Ata un renglon de O.C. con codigo no valido a un producto ('' = automatico por nombre)
  async function atarRenglon(h, destino) {
    try {
      await client.vincularOcHistorial(h.codigoOriginal, h.descripcion, destino);
      setHistorial(await client.ocHistorial());
      setMessage(destino ? `Renglón de la O.C. ${h.oc_numero || ''} atado a ${destino === 'NINGUNO' ? 'ningún pedido' : destino}.` : 'Renglón vuelto a automático (por nombre).');
    } catch (err) {
      setMessage(err.message);
    }
  }

  // Ata un codigo pedido al codigo con el que figura en el consumo ('' = automatico, 'NINGUNO' = no figura)
  async function atarConsumo(codigo, destino) {
    try {
      await client.vincularConsumo(codigo, destino);
      setBajasData(await client.bajasMs());
      setMessage(destino ? (ESTADO_CONSUMO[destino] ? `${codigo} marcado como «${ESTADO_CONSUMO[destino].texto}».` : `${codigo} atado a ${destino}.`) : `${codigo} vuelto a automático.`);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function actualizarHistorial() {
    setBusy(true);
    try {
      const r = await client.importarOcHistorial();
      setMessage(`Historial de O.C. leído de «${r.archivo}»: ${r.renglones} renglones (${r.pestanas.join(', ')}).`);
      setHistorial(await client.ocHistorial());
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function elegirCiclo(c) {
    setCicloSel(c);
    setReqFiltro('');
  }

  async function eliminar(imp) {
    if (!window.confirm(`¿Quitar de la tabla el requerimiento ${imp.numero}/${imp.anio_numero}? Se vuelve a importar si el PDF sigue en la carpeta.`)) return;
    try {
      await client.eliminarRequerimiento(imp.id);
      setMessage(`Requerimiento ${imp.numero}/${imp.anio_numero} quitado.`);
      await refresh(true);
    } catch (err) {
      setMessage(err.message);
    }
  }

  function toggle(key) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const alertasReq = useMemo(() => {
    const m = new Map();
    for (const imp of importacionesTodas) {
      const propios = itemsTodos.filter((it) => it.importacion_id === imp.id);
      const alertas = [];
      if (propios.length > 1 && propios.every((it) => Number(it.cantidad) === 1)) alertas.push('todas las cantidades en 1');
      if (Math.abs(Number(imp.total_declarado || 0) - Number(imp.total_calculado || 0)) > 0.05) alertas.push('total no coincide');
      m.set(imp.id, alertas);
    }
    return m;
  }, [importacionesTodas, itemsTodos]);

  const itemsFiltrados = useMemo(() => {
    const q = textoBusqueda(search.trim());
    return items.filter((it) => {
      if (reqFiltro && String(it.importacion_id) !== reqFiltro) return false;
      if (!q) return true;
      return textoBusqueda(`${it.codigo} ${it.codigo_sigaf} ${it.descripcion} ${it.droga}`).includes(q);
    });
  }, [items, search, reqFiltro]);

  // Los grupos se arman sobre todos los items (para no perder repeticiones) y despues se filtran.
  // "Por droga" agrupa droga + forma farmaceutica + concentracion: un comprimido no se suma
  // con una suspension, ni el de 0,5 mg con el de 2 mg.
  const claveDrogaForma = (it) => `${it.droga_clave}|${it.forma}|${it.concentracion}`;
  const porCodigo = useMemo(() => agruparRequerimiento(items, (it) => it.codigo), [items]);
  const codigosReqKey = useMemo(() => Array.from(new Set(porCodigo.map((g) => g.codigo).filter(Boolean))).sort().join('|'), [porCodigo]);
  useEffect(() => {
    if (!codigosReqKey) { setColsReq({ datos: {}, meta: {} }); return; }
    client.reqColumnas(codigosReqKey.split('|')).then(setColsReq).catch((e) => setMessage(e.message));
  }, [client, codigosReqKey]);
  const { cols: todasColsReq, ref: cicloRefReq } = useMemo(() => columnasAnalisisReq(colsReq.meta, ciclo), [colsReq.meta, ciclo]);
  const colsReqDefault = useMemo(() => (cicloRefReq ? [`cons:${cicloRefReq}`, 'stockActual', 'calc:dif'] : ['stockActual']), [cicloRefReq]);
  const colsReqElegidas = colsReqVisibles || colsReqDefault;
  const todasColsReqAj = useMemo(() => [
    ...todasColsReq,
    { key: 'aj:original', grupo: 'Corrección', label: `Requerido original (PDF) ${cortoCiclo(ciclo)}`,
      title: 'Lo que dice el PDF del Ministerio, sin la corrección. Si no se corrigió es igual a «Requerido».',
      get: (d, g) => (g.ajuste ? g.cantidadPdf : g.cantidad) },
    { key: 'aj:dif', grupo: 'Corrección', label: 'Diferencia (corregido − PDF)',
      title: 'Cálculo: valor corregido menos el valor original del PDF. Vacío si no se corrigió.',
      get: (d, g) => (g.ajuste ? g.cantidad - g.cantidadPdf : null) },
    { key: 'aj:motivo', grupo: 'Corrección', label: 'Motivo de la corrección', tipo: 'texto',
      title: 'Lo que se escribió al corregir (opcional).', get: (d, g) => g.ajuste?.motivo || null },
    { key: 'aj:quien', grupo: 'Corrección', label: 'Corregido por', tipo: 'texto',
      title: 'Usuario y fecha de la última corrección.', get: (d, g) => (g.ajuste ? `${g.ajuste.usuario_nombre || '—'} · ${fmtFechaHoraAr(g.ajuste.updated_at)}` : null) }
  ], [todasColsReq, ciclo]);
  const colsReq2 = todasColsReqAj.filter((c) => colsReqElegidas.includes(c.key));

  async function cargarAjustes() {
    if (!ciclo) { setAjustes([]); setHistAjustes([]); return; }
    try {
      const [a, h] = await Promise.all([client.reqAjustes(ciclo), client.reqAjustesHistorial(ciclo)]);
      setAjustes(a.data || []);
      setHistAjustes(h.data || []);
    } catch (e) { setMessage(e.message); }
  }
  useEffect(() => { cargarAjustes(); setEditReq(null); }, [client, ciclo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardarAjuste(volverOriginal = false) {
    if (!editReq) return;
    setGuardandoReq(true);
    try {
      if (volverOriginal) await client.reqAjusteVolver({ codigo: editReq.codigo, ciclo, motivo: editReq.motivo });
      else {
        const cant = Number(String(editReq.cantidad).replace(',', '.'));
        if (!Number.isFinite(cant) || cant < 0) throw new Error('Escribí un número mayor o igual a 0');
        await client.reqAjusteGuardar({ codigo: editReq.codigo, ciclo, cantidad: cant, motivo: editReq.motivo });
      }
      setEditReq(null);
      await cargarAjustes();
    } catch (e) { setMessage(e.message); } finally { setGuardandoReq(false); }
  }

  // Celda "Requerido": clic para corregir; si esta corregida muestra el valor del PDF abajo
  const celdaRequerido = (g) => {
    const aj = g.ajuste;
    if (editReq?.codigo === g.codigo) {
      const tecla = (e) => { if (e.key === 'Enter') guardarAjuste(); if (e.key === 'Escape') setEditReq(null); };
      return (
        <td style={{ textAlign: 'right', background: '#eef4fb', minWidth: 190 }}>
          <input type="number" min="0" step="any" autoFocus value={editReq.cantidad} disabled={guardandoReq}
            onChange={(e) => setEditReq({ ...editReq, cantidad: e.target.value })} onFocus={(e) => e.target.select()} onKeyDown={tecla}
            style={{ width: 110, textAlign: 'right' }} title="Valor corregido. Enter guarda, Esc cancela." />
          <input value={editReq.motivo} placeholder="Motivo (opcional)" maxLength={255} disabled={guardandoReq}
            onChange={(e) => setEditReq({ ...editReq, motivo: e.target.value })} onKeyDown={tecla}
            style={{ width: 170, marginTop: 4, fontSize: 12 }} />
          <div style={{ fontSize: 11, color: '#5b6b76', marginTop: 2 }}>PDF: {fmtCantidad(aj ? g.cantidadPdf : g.cantidad)}</div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
            <button type="button" className="small compact" onClick={() => guardarAjuste()} disabled={guardandoReq}>Guardar</button>
            {aj ? <button type="button" className="ghost compact" onClick={() => guardarAjuste(true)} disabled={guardandoReq} title="Borra la corrección y deja el valor del PDF">Volver al original</button> : null}
            <button type="button" className="ghost compact" onClick={() => setEditReq(null)} disabled={guardandoReq}>Cancelar</button>
          </div>
        </td>
      );
    }
    const abrir = () => setEditReq({ codigo: g.codigo, cantidad: String(g.cantidad), motivo: aj?.motivo || '' });
    if (!aj) {
      return (
        <td style={{ textAlign: 'right', cursor: 'pointer' }} onClick={abrir} title="Valor del PDF. Hacé clic para corregirlo.">
          {fmtCantidad(g.cantidad)}
        </td>
      );
    }
    const pdfCambio = Number(aj.cantidad_original) !== Number(g.cantidadPdf);
    return (
      <td style={{ textAlign: 'right', cursor: 'pointer', background: '#fff4d6' }} onClick={abrir} data-excel={String(g.cantidad)}
        title={`Corregido por ${aj.usuario_nombre || '—'} el ${fmtFechaHoraAr(aj.updated_at)}.\nValor del PDF: ${fmtCantidad(g.cantidadPdf)}.${aj.motivo ? `\nMotivo: ${aj.motivo}` : ''}${pdfCambio ? `\n⚠ Cuando se corrigió el PDF decía ${fmtCantidad(aj.cantidad_original)}; ahora dice ${fmtCantidad(g.cantidadPdf)}.` : ''}\nHacé clic para cambiarlo.`}>
        <strong>{fmtCantidad(g.cantidad)}</strong>
        <div style={{ fontSize: 11, color: '#8a5a00', whiteSpace: 'nowrap' }}>✎ PDF: {fmtCantidad(g.cantidadPdf)}</div>
        {pdfCambio ? <div style={{ fontSize: 11, color: '#b42318', whiteSpace: 'nowrap' }}>⚠ el PDF cambió</div> : null}
      </td>
    );
  };
  const porDroga = useMemo(() => agruparRequerimiento(items, claveDrogaForma), [items]);
  const totalDrogas = useMemo(() => new Set(items.map((it) => it.droga_clave)).size, [items]);
  const clavesVisibles = useMemo(() => ({
    codigo: new Set(itemsFiltrados.map((it) => it.codigo)),
    droga: new Set(itemsFiltrados.map(claveDrogaForma))
  }), [itemsFiltrados]);

  const ajusteMap = useMemo(() => new Map(ajustes.map((a) => [a.codigo, a])), [ajustes]);
  // Grupo con el valor corregido: la cantidad y el total pasan a ser los corregidos; el del PDF queda en cantidadPdf
  const conAjuste = (g) => {
    const aj = ajusteMap.get(g.codigo);
    if (!aj) return g;
    const precio = Number(g.cantidad) ? Number(g.total || 0) / Number(g.cantidad) : Number(g.precioMin || 0);
    return { ...g, cantidadPdf: g.cantidad, cantidad: aj.cantidad, total: aj.cantidad * precio, ajuste: aj };
  };
  // Con un archivo/requerimiento elegido se respeta el orden del PDF (hoja e item);
  // sin filtro, alfabetico por droga.
  const posicionEnReq = (g) => {
    let min = Infinity;
    for (const it of g.items) {
      if (String(it.importacion_id) !== reqFiltro) continue;
      const pos = Number(it.hoja || 0) * 100000 + Number(it.item_nro || 0);
      if (pos < min) min = pos;
    }
    return min;
  };
  const ordenGrupos = (a, b) => (reqFiltro ? posicionEnReq(a) - posicionEnReq(b) : 0)
    || a.droga.localeCompare(b.droga) || a.codigo.localeCompare(b.codigo);
  const gruposCodigo = porCodigo
    .filter((g) => clavesVisibles.codigo.has(g.clave) && (!soloRepetidos || g.veces > 1) && (!soloCorregidos || ajusteMap.has(g.codigo)))
    .map(conAjuste)
    .sort(ordenGrupos);
  const gruposDroga = porDroga
    .filter((g) => clavesVisibles.droga.has(g.clave) && (!soloRepetidos || g.veces > 1))
    .sort((a, b) => a.droga.localeCompare(b.droga) || a.forma.localeCompare(b.forma) || a.concentracion.localeCompare(b.concentracion));
  const repetidos = porCodigo
    .filter((g) => g.veces > 1 && clavesVisibles.codigo.has(g.clave))
    .sort((a, b) => b.veces - a.veces || a.droga.localeCompare(b.droga));
  const gastoRepetidos = porCodigo.filter((g) => g.veces > 1).reduce((a, g) => a + Number(g.total || 0), 0);

  // Cruces del requerimiento (por codigo) con el stock actual y con las O.C.
  const cruceMap = useMemo(() => new Map(cruce.data.map((f) => [f.codigo, f])), [cruce]);
  const codigosRequeridos = useMemo(() => new Set(items.map((it) => it.codigo)), [items]);
  const gruposVisibles = porCodigo
    .filter((g) => clavesVisibles.codigo.has(g.clave))
    .sort(ordenGrupos);
  const filasStock = gruposVisibles.map((g) => {
    const s = cruceMap.get(g.codigo);
    let situacion = 'con_stock';
    if (!s?.enStock) situacion = 'no_figura';
    else if (Number(s.stock) === 0) situacion = 'sin_stock';
    return { g, s, situacion };
  });
  // Historial de O.C. por codigo; en la planilla algunos renglones usan el codigo Sigaf
  const periodosOc = useMemo(() => {
    const sem = semestreDeCiclo(ciclo);
    return Array.from(new Set(historial.filas.map(clavePeriodo))).filter((k) => !sem || k.endsWith(`-${sem}`)).sort();
  }, [historial, ciclo]);
  const periodosVisibles = periodosOc.filter((k) => !periodosOcultos.includes(k));
  const historialEfectivo = useMemo(() => {
    const vinculos = new Map((historial.vinculos || []).map((v) => [`${v.codigo_origen}|${v.descripcion_clave}`, v.codigo_destino]));
    const porNombre = new Map();
    for (const g of porCodigo) {
      const k = `${drogaDe(g.droga)}|${formaFarmaceutica(g.descripcion)}`;
      if (!porNombre.has(k)) porNombre.set(k, []);
      porNombre.get(k).push(g.codigo);
    }
    // Sigaf reales de lo pedido: un renglon con ese Sigaf se cruza directo
    const sigafPedidos = new Set(porCodigo.map((g) => sigafValido(g.sigaf)).filter(Boolean));
    return historial.filas.map((h) => {
      const original = String(h.codigo || '').toUpperCase();
      if (codigoProductoValido(original) || sigafPedidos.has(original)) return { ...h, codigoOriginal: original, via: null };
      const vinculo = vinculos.get(`${original}|${claveDescripcionOc(h.descripcion)}`) || null;
      if (vinculo) return { ...h, codigoOriginal: original, codigo: vinculo, via: vinculo === 'NINGUNO' ? 'ninguno' : 'vinculo', vinculo };
      const candidatos = porNombre.get(`${drogaDe(h.descripcion)}|${formaFarmaceutica(h.descripcion)}`) || [];
      if (candidatos.length) return { ...h, codigoOriginal: original, codigo: candidatos[0], via: 'nombre', candidatos };
      return { ...h, codigoOriginal: original, via: 'sin', candidatos: [] };
    });
  }, [historial, porCodigo]);
  const productosParaAtar = porCodigo
    .map((g) => ({ codigo: g.codigo, texto: [g.droga, g.concentracion, g.forma].filter(Boolean).join(' · ') || g.descripcion }))
    .sort((a, b) => a.texto.localeCompare(b.texto));
  // Renglones con codigo no valido, para avisar los que quedan sin atar
  const renglonesRaros = historialEfectivo.filter((h) => h.via).map((h) => ({
    h,
    vinculo: h.vinculo || '',
    destino: h.vinculo,
    candidatos: h.candidatos || [],
    estado: h.via === 'vinculo' ? 'vinculado' : h.via === 'ninguno' ? 'ninguno' : h.via === 'nombre' ? 'nombre' : 'sin'
  }));
  const historialPorCodigo = useMemo(() => {
    const m = new Map();
    for (const h of historialEfectivo) {
      if (h.via === 'ninguno' || h.via === 'sin') continue;
      const k = String(h.codigo || '').toUpperCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(h);
    }
    return m;
  }, [historialEfectivo]);
  const filasOc = gruposVisibles.map((g) => {
    const vistos = new Set();
    const rows = [];
    for (const c of [g.codigo, sigafValido(g.sigaf)]) {
      for (const h of historialPorCodigo.get(String(c || '').toUpperCase()) || []) {
        if (!vistos.has(h.id) && periodosOc.includes(clavePeriodo(h))) { vistos.add(h.id); rows.push(h); }
      }
    }
    const porPeriodo = {};
    for (const h of rows) {
      const k = clavePeriodo(h);
      porPeriodo[k] = porPeriodo[k] || { cantidad: 0, entregada: 0 };
      porPeriodo[k].cantidad += Number(h.cantidad || 0);
      porPeriodo[k].entregada += Number(h.entregada || 0);
    }
    // Mismo semestre del año anterior al periodo del requerimiento (ej. 1er sem 2027 -> 1er sem 2026)
    const desde = String(g.items[0]?.periodo_desde || '');
    const anioReq = Number(desde.slice(0, 4));
    const kAnterior = anioReq ? `${anioReq - 1}-${Number(desde.slice(5, 7)) <= 6 ? 1 : 2}` : null;
    const anterior = kAnterior && porPeriodo[kAnterior] ? porPeriodo[kAnterior].cantidad : 0;
    const semReq = Number(desde.slice(5, 7)) <= 6 ? 1 : 2;
    const kSemAnterior = anioReq ? (semReq === 1 ? `${anioReq - 1}-2` : `${anioReq}-1`) : null;
    const semAnterior = kSemAnterior && porPeriodo[kSemAnterior] ? porPeriodo[kSemAnterior].cantidad : 0;
    let situacion = 'otro_periodo';
    if (!rows.length) situacion = 'sin_oc';
    else if (anterior) situacion = g.cantidad > anterior ? 'mayor' : 'menor_igual';
    return { g, rows, porPeriodo, kAnterior, anterior, kSemAnterior, semAnterior, situacion };
  });
  // Semestre de comparacion mas comun (para el 1er sem 2027 es el 1er sem 2026)
  const periodoReferencia = (() => {
    const cuenta = new Map();
    for (const f of filasOc) if (f.kAnterior) cuenta.set(f.kAnterior, (cuenta.get(f.kAnterior) || 0) + 1);
    return Array.from(cuenta.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  })();
  const qCruce = textoBusqueda(search.trim());
  const coincide = (f) => !qCruce || textoBusqueda(`${f.codigo} ${f.nombre} ${f.descripcionOc}`).includes(qCruce);
  const stockNoRequerido = cruce.data
    .filter((f) => f.enStock && !codigosRequeridos.has(f.codigo) && coincide(f) && Number(f.stock) === 0);
  const sigafRequeridos = new Set(items.map((it) => sigafValido(it.codigo_sigaf)).filter(Boolean));

  // Diferencias: lo comprado (en el periodo elegido) que no esta en ningun requerimiento, y al reves.
  // Respeta el buscador; el filtro de requerimiento solo aplica a la lista de requeridos.
  const enPeriodo = (h) => (difPeriodo === 'todos' ? periodosOc.includes(clavePeriodo(h)) : clavePeriodo(h) === difPeriodo);
  const difOcNoReq = Array.from(historialEfectivo
    .filter((h) => enPeriodo(h) && !codigosRequeridos.has(h.codigo) && !sigafRequeridos.has(h.codigo)
      && (!qCruce || textoBusqueda(`${h.codigo} ${h.descripcion} ${h.oc_numero} ${h.proveedor}`).includes(qCruce)))
    .reduce((m, h) => {
      const f = m.get(h.codigo) || { codigo: h.codigo, descripcion: h.descripcion, rows: [], porPeriodo: {}, total: 0, ultima: h };
      f.rows.push(h);
      const k = clavePeriodo(h);
      f.porPeriodo[k] = (f.porPeriodo[k] || 0) + Number(h.cantidad || 0);
      f.total += Number(h.cantidad || 0);
      if (String(h.vencimiento || '') >= String(f.ultima.vencimiento || '')) { f.ultima = h; f.descripcion = h.descripcion; }
      m.set(h.codigo, f);
      return m;
    }, new Map()).values())
    .sort((a, b) => b.rows.length - a.rows.length || String(a.descripcion).localeCompare(String(b.descripcion)));
  const difReqNoOc = filasOc.filter((f) => !f.rows.some(enPeriodo));

  // Consumo real de Farmacia MS por codigo (sectores sumados), mes a mes
  const consumoAnalisis = useMemo(() => {
    const hoy = new Date();
    const mesEnCurso = hoy.getFullYear() * 12 + hoy.getMonth();
    const porCodigo = new Map();
    const conDatos = new Set();
    for (const it of consumo.items) {
      const meses = porCodigo.get(it.codigo) || {};
      MESES_KEYS.forEach((k, i) => {
        const idx = Number(it.anio) * 12 + i;
        const v = Number(it[k] || 0);
        if (v > 0) conDatos.add(idx);
        meses[idx] = (meses[idx] || 0) + v;
      });
      porCodigo.set(it.codigo, meses);
    }
    // Meses cerrados con datos en Farmacia MS (el mes en curso no se cuenta)
    const cerrados = Array.from(conDatos).filter((idx) => idx < mesEnCurso).sort((a, b) => a - b);
    const base = cerrados.slice(-6);
    const etiqueta = (idx) => `${MESES_CORTOS[idx % 12]} ${Math.floor(idx / 12)}`;
    // Semestres con datos: total proyectado a 6 meses si faltan meses
    const semestres = new Map();
    for (const idx of cerrados) {
      const anio = Math.floor(idx / 12);
      const sem = idx % 12 < 6 ? 1 : 2;
      const key = `${anio}-${sem}`;
      const x = semestres.get(key) || { key, label: `${sem === 1 ? '1er' : '2do'} sem ${anio}`, meses: 0, idxs: [] };
      x.meses += 1;
      x.idxs.push(idx);
      semestres.set(key, x);
    }
    const sectores = Array.from(new Set(consumo.items.map((it) => (/PSICO/i.test(it.sector) ? 'Psicofármacos' : /UNIFICADA/i.test(it.sector) ? 'Unificada' : it.sector))));
    const semCiclo = semestreDeCiclo(ciclo);
    const todos = Array.from(semestres.values()).sort((a, b) => a.key.localeCompare(b.key));
    const iguales = semCiclo ? todos.filter((x) => x.key.endsWith(`-${semCiclo}`)) : todos;
    // Base del esperado: el ultimo semestre igual completo; si no hay, el ultimo igual con datos
    const ref = semCiclo ? ([...iguales].reverse().find((x) => x.meses === 6) || iguales[iguales.length - 1]) : null;
    const baseFinal = semCiclo ? (ref ? ref.idxs : []) : base;
    return {
      porCodigo,
      base: baseFinal,
      cerrados,
      referencia: ref,
      mesesBase: baseFinal.map((idx) => ({ idx, label: etiqueta(idx) })),
      semestres: iguales,
      sectores: sectores.join(' + ')
    };
  }, [consumo, ciclo]);
  const { mesesBase } = consumoAnalisis;
  const rangoMeses = (sem) => {
    const nombre = (idx) => MESES_CORTOS[idx % 12].toLowerCase();
    return sem.idxs.length ? `${nombre(sem.idxs[0])}–${nombre(sem.idxs[sem.idxs.length - 1])}` : '';
  };
  const semestresConsumo = consumoAnalisis.semestres;
  // Consumo del mismo semestre del ciclo en cada año con datos: Farmacia MS si cubre el semestre,
  // si no el Analisis Trimestral (T1+T2 o T3+T4; por sector + año + trimestre vale la ultima carga)
  const semestresAnios = useMemo(() => {
    const semCiclo = semestreDeCiclo(ciclo);
    const vigentes = new Map();
    for (const imp of trimestral.importaciones) {
      const sem = Number(imp.trimestre) <= 2 ? 1 : 2;
      if (semCiclo && sem !== semCiclo) continue;
      const k = `${imp.sector}|${imp.anio}|${imp.trimestre}`;
      if (!vigentes.has(k) || vigentes.get(k).id < imp.id) vigentes.set(k, imp);
    }
    const porImp = new Map(Array.from(vigentes.values()).map((imp) => [imp.id, imp]));
    const trim = new Map();
    for (const it of trimestral.items) {
      const imp = porImp.get(it.trimestre_importacion_id);
      if (!imp) continue;
      const sem = Number(imp.trimestre) <= 2 ? 1 : 2;
      const key = `${imp.anio}-${sem}`;
      const x = trim.get(key) || { key, trimestres: new Set(), porCodigo: new Map() };
      x.trimestres.add(Number(imp.trimestre));
      x.porCodigo.set(it.codigo_articulo, (x.porCodigo.get(it.codigo_articulo) || 0) + Number(it.total_periodo || 0));
      trim.set(key, x);
    }
    const claves = new Set([...consumoAnalisis.semestres.map((x) => x.key), ...trim.keys()]);
    return Array.from(claves).sort().map((key) => {
      const [anio, sem] = key.split('-').map(Number);
      const label = `${sem === 1 ? '1er' : '2do'} sem ${anio}`;
      const ms = consumoAnalisis.semestres.find((x) => x.key === key);
      const t = trim.get(key);
      if (ms && (!t || ms.meses >= t.trimestres.size * 3)) {
        return { key, anio, label, meses: ms.meses, detalle: ms.meses < 6 ? `${rangoMeses(ms)} (${ms.meses} meses)` : 'completo', fuente: 'ms', ms };
      }
      const ts = Array.from(t.trimestres).sort();
      return { key, anio, label, meses: ts.length * 3, detalle: `trimestral ${ts.map((n) => `T${n}`).join('+')}`, fuente: 'trim', trim: t };
    });
  }, [consumoAnalisis, trimestral, ciclo]);
  const semestresVto = semestresAnios.filter((s) => !aniosOcultosVto.includes(s.anio));
  // Analisis Trimestral por año + trimestre (sin filtrar semestre): codigo -> cantidad
  const trimPorTrimestre = useMemo(() => {
    const vigentes = new Map();
    for (const imp of trimestral.importaciones) {
      const k = `${imp.sector}|${imp.anio}|${imp.trimestre}`;
      if (!vigentes.has(k) || vigentes.get(k).id < imp.id) vigentes.set(k, imp);
    }
    const claveImp = new Map(Array.from(vigentes.values()).map((imp) => [imp.id, `${imp.anio}-${imp.trimestre}`]));
    const res = new Map();
    for (const it of trimestral.items) {
      const k = claveImp.get(it.trimestre_importacion_id);
      if (!k) continue;
      const m = res.get(k) || new Map();
      m.set(it.codigo_articulo, (m.get(it.codigo_articulo) || 0) + Number(it.total_periodo || 0));
      res.set(k, m);
    }
    return res;
  }, [trimestral]);
  const cambiarAniosOcultosVto = (lista) => {
    setAniosOcultosVto(lista);
    try { localStorage.setItem('aniosOcultosConsumoVto', JSON.stringify(lista)); } catch { /* sin localStorage */ }
  };
  const consumoSectores = consumoAnalisis.sectores;
  const productosConsumo = useMemo(() => {
    const m = new Map();
    for (const it of consumo.items) {
      if (!m.has(it.codigo)) m.set(it.codigo, it);
    }
    return Array.from(m.values());
  }, [consumo]);
  const consumoPorNombre = useMemo(() => {
    const m = new Map();
    for (const p of productosConsumo) {
      const k = claveProducto(p.nombre_generico, [p.nombre_generico, p.concentracion, p.presentacion, p.forma].filter(Boolean).join(' '));
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p.codigo);
    }
    return m;
  }, [productosConsumo]);
  const vinculosConsumo = new Map((bajasData.vinculos || []).map((v) => [v.codigo_pedido, v.codigo_consumo]));
  // Codigos equivalentes ('igual'): consumo, stock y vencimientos de toda la familia se suman en el renglon
  const familiaEquiv = useMemo(() => {
    const padre = new Map();
    const raiz = (c) => { if (!padre.has(c)) padre.set(c, c); while (padre.get(c) !== c) c = padre.get(c); return c; };
    for (const r of equivRows) if (r.estado === 'igual') { const a = raiz(r.codigo_a); const b = raiz(r.codigo_b); if (a !== b) padre.set(a, b); }
    const grupos = new Map();
    for (const c of padre.keys()) { const k = raiz(c); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
    const out = new Map();
    for (const g of grupos.values()) for (const c of g) out.set(c, g);
    return out;
  }, [equivRows]);
  const famDe = (c) => familiaEquiv.get(c) || [c];
  const mesesFam = (c) => {
    if (!c) return null;
    let out = null;
    for (const x of famDe(c)) {
      const m = consumoAnalisis.porCodigo.get(x);
      if (!m) continue;
      out = out || {};
      for (const [k, v] of Object.entries(m)) out[k] = (out[k] || 0) + v;
    }
    return out;
  };
  const tieneConsumoFam = (c) => famDe(c).some((x) => consumoAnalisis.porCodigo.has(x));
  const stockFam = (c) => {
    let total = 0;
    let hay = false;
    for (const x of famDe(c)) {
      const st = cruceMap.get(x);
      if (st?.enStock) { hay = true; total += Number(st.stock || 0); }
    }
    return hay ? total : null;
  };
  const trimFam = (mapa, c) => {
    if (!c) return undefined;
    let total;
    for (const x of famDe(c)) { const v = mapa.get(x); if (v != null) total = (total || 0) + Number(v); }
    return total;
  };
  const enlaceConsumo = (g) => {
    const v = vinculosConsumo.get(g.codigo);
    if (tieneConsumoFam(g.codigo) && (!v || ESTADO_CONSUMO[v])) return { codigo: g.codigo, via: 'codigo' };
    if (v) return ESTADO_CONSUMO[v] ? { codigo: null, via: 'estado', estado: v } : { codigo: v, via: 'vinculo' };
    const k = claveProducto(g.droga, g.descripcion);
    const candidatos = k ? consumoPorNombre.get(k) || [] : [];
    if (candidatos.length) return { codigo: candidatos[0], via: 'nombre' };
    return { codigo: null, via: 'sin' };
  };
  // Bajas (descartes y vencidos) por codigo, con el indice de mes para ubicarlas en cada semestre
  const bajasPorCodigo = useMemo(() => {
    const m = new Map();
    for (const b of bajasData.data || []) {
      const f = String(b.fecha || '');
      const idx = Number(f.slice(0, 4)) * 12 + Number(f.slice(5, 7)) - 1;
      if (!m.has(b.codigo)) m.set(b.codigo, []);
      m.get(b.codigo).push({ ...b, idx });
    }
    return m;
  }, [bajasData]);
  const stockDeFila = (f) => {
    const propio = stockFam(f.g.codigo);
    if (propio != null) return propio;
    return f.enlace?.codigo ? stockFam(f.enlace.codigo) : null;
  };
  const fechasVto = (lotes) => {
    const m = new Map();
    for (const l of lotes) {
      const k = l.vencimiento || '';
      const o = m.get(k) || { fecha: l.vencimiento || null, dias: l.dias, cantidad: 0, lotes: 0, detalle: [] };
      o.cantidad += Number(l.stock || 0);
      o.lotes += 1;
      o.detalle.push(l);
      m.set(k, o);
    }
    return Array.from(m.values()).sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)));
  };
  const vtoPorCodigo = useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const m = new Map();
    for (const l of vtoData.items) {
      const dias = l.vencimiento ? Math.round((new Date(`${l.vencimiento}T00:00:00`) - hoy) / 86400000) : null;
      if (!m.has(l.codigo)) m.set(l.codigo, []);
      m.get(l.codigo).push({ ...l, dias, rango: rangoVto(dias) });
    }
    return m;
  }, [vtoData]);
  const lotesFam = (c) => {
    const lotes = famDe(c).flatMap((x) => vtoPorCodigo.get(x) || []);
    return lotes.length ? lotes : null;
  };
  const productosConsumoAtar = useMemo(() => {
    const lista = productosConsumo
      .map((p) => ({ codigo: p.codigo, texto: [p.nombre_generico, p.concentracion, [p.presentacion, p.forma].filter(Boolean).join(' ')].filter(Boolean).join(' · ') }));
    const ya = new Set(lista.map((p) => p.codigo));
    for (const f of cruce.data) {
      if (!f.enStock || ya.has(f.codigo)) continue;
      ya.add(f.codigo);
      lista.push({ codigo: f.codigo, texto: `${[f.nombre, f.concentracion, f.forma].filter(Boolean).join(' · ')} (en stock, sin consumo)` });
    }
    return lista.sort((a, b) => a.texto.localeCompare(b.texto));
  }, [productosConsumo, cruce]);
  // Pista para decidir: stock, O.C. y consumo historico (trimestral) del codigo pedido
  const historicoTrimestre = useMemo(() => new Map((bajasData.historico || []).map((h) => [h.codigo, Number(h.ultimo)])), [bajasData]);
  const ocPorCodigo = useMemo(() => {
    const m = new Map();
    for (const h of historial.filas) {
      if (!h.codigo) continue;
      if (!m.has(h.codigo)) m.set(h.codigo, []);
      if (h.oc_numero && !m.get(h.codigo).includes(h.oc_numero)) m.get(h.codigo).push(h.oc_numero);
    }
    return m;
  }, [historial]);
  const pistaConsumo = (g) => {
    const pistas = [];
    const st = cruceMap.get(g.codigo);
    if (st?.enStock) pistas.push({ texto: `en stock: ${fmtCantidad(st.stock)}`, tipo: 'stock' });
    const ocs = ocPorCodigo.get(g.codigo);
    if (ocs?.length) pistas.push({ texto: `comprado en O.C. ${ocs.slice(0, 2).join(', ')}${ocs.length > 2 ? '…' : ''}`, tipo: 'oc' });
    const tr = historicoTrimestre.get(g.codigo);
    if (tr) pistas.push({ texto: `consumido hasta T${tr % 10} ${Math.floor(tr / 10)}`, tipo: 'historico' });
    if (!pistas.length) pistas.push({ texto: 'sin historial: probablemente nuevo', tipo: 'nuevo' });
    return pistas;
  };
  // Meses del ciclo elegido (indice anio*12 + mes-1); sin ciclo, los proximos 6 meses
  const mesesDelCiclo = (() => {
    const [anioC, semC] = String(ciclo).split('-').map(Number);
    const hoyC = new Date();
    const ini = anioC && (semC === 1 || semC === 2) ? anioC * 12 + (semC === 1 ? 0 : 6) : hoyC.getFullYear() * 12 + hoyC.getMonth() + 1;
    return [0, 1, 2, 3, 4, 5].map((i) => ini + i);
  })();
  // Lo que se hizo con cada renglon: codigos unidos que se suman, y gemelos del stock que faltan unir
  const totalConsumo = (c) => Object.values(consumoAnalisis.porCodigo.get(c) || {}).reduce((a, v) => a + v, 0);
  const infoUnion = (codigo) => {
    const fam = famDe(codigo);
    if (fam.length < 2) return null;
    const pares = equivRows.filter((r) => r.estado === 'igual' && fam.includes(r.codigo_a) && fam.includes(r.codigo_b));
    // Nombre y presentacion del codigo sumado: Stock Actual, consumo de Farmacia MS o lo guardado al unirlo
    const descDe = (c) => {
      const st = cruceMap.get(c);
      if (st?.nombre) return [st.nombre, st.concentracion, st.presentacion, st.forma].filter(Boolean).join(' · ');
      const co = consumo.items.find((it) => it.codigo === c);
      if (co) return [co.nombre_generico, co.concentracion, co.presentacion, co.forma].filter(Boolean).join(' · ');
      const r = pares.find((x) => x.codigo_a === c || x.codigo_b === c);
      return (r ? (r.codigo_a === c ? r.desc_a : r.desc_b) : '') || '';
    };
    const otros = fam.filter((c) => c !== codigo).map((c) => ({ codigo: c, desc: descDe(c), consumo: totalConsumo(c), stock: cruceMap.get(c)?.enStock ? Number(cruceMap.get(c).stock) : null }));
    const ultima = pares.map((r) => r.created_at).filter(Boolean).sort().pop();
    return { otros, cuando: ultima ? fmtFechaAr(String(ultima).slice(0, 10)) : '', notas: pares.map((r) => r.nota).filter(Boolean) };
  };
  const gruposSinUnir = repStock?.repetidos
    ? [...repStock.repetidos.identicos, ...repStock.repetidos.probables].filter((x) => x.equivalencia === 'pendiente')
    : [];
  const gemelosSinUnir = (codigo) => {
    const fam = new Set(famDe(codigo));
    const out = [];
    for (const grupo of gruposSinUnir) {
      if (!grupo.items.some((it) => fam.has(it.codigo))) continue;
      for (const it of grupo.items) if (!fam.has(it.codigo) && !out.some((o) => o.codigo === it.codigo)) out.push(it);
    }
    return out;
  };
  // Pares sin unir del stock que no tocan ningun renglon del requerimiento (igual se muestran en "Sin emparejar")
  const codigosPedidos = new Set(porCodigo.flatMap((g) => famDe(g.codigo)));
  const sinUnirNoPedidos = gruposSinUnir.filter((grupo) => !grupo.items.some((it) => codigosPedidos.has(it.codigo)));
  const filasConsumo = gruposVisibles.map((g) => {
    const enlace = enlaceConsumo(g);
    const meses = enlace.codigo ? mesesFam(enlace.codigo) : null;
    const enConsumo = Boolean(meses);
    const porSemestre = {};
    if (meses) {
      for (const sem of semestresConsumo) {
        const suma = sem.idxs.reduce((a, idx) => a + (meses[idx] || 0), 0);
        porSemestre[sem.key] = sem.meses ? (suma / sem.meses) * 6 : 0;
      }
    }
    const prono = pronosticoConsumo(meses, consumoAnalisis.cerrados, mesesDelCiclo);
    const esperado = meses ? mesesDelCiclo.reduce((a, idx) => a + prono.porMes.get(idx), 0) : 0;
    const promedio = esperado / 6;
    // Rango aproximado del 80 % para el total de 6 meses
    const margen = 1.28 * prono.sd * Math.sqrt(6);
    const rangoInf = Math.max(0, esperado - margen);
    const rangoSup = esperado + margen;
    const ratio = esperado > 0 ? g.cantidad / esperado : null;
    let situacion = 'acorde';
    if (!enConsumo) situacion = enlace.via === 'estado' ? ESTADO_CONSUMO[enlace.estado].situacion : 'no_figura';
    else if (!esperado) situacion = 'sin_consumo';
    else if (margen ? g.cantidad > rangoSup : ratio > 1.5) situacion = 'de_mas';
    else if (margen ? g.cantidad < rangoInf : ratio < 0.7) situacion = 'de_menos';
    return { g, enlace, enConsumo, porSemestre, promedio, esperado, rangoInf, rangoSup, prono, ratio, situacion, union: infoUnion(g.codigo), sinUnir: gemelosSinUnir(g.codigo) };
  });
  // Vista consumo/vencimientos: filtro por farmaco (el de requerimiento es el reqFiltro de arriba)
  const farmacosVto = Array.from(new Set(filasConsumo.map((f) => f.g.droga).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const filasVto = filasConsumo.filter((f) => !farmacoVto || f.g.droga === farmacoVto);
  // Pedidos que no coinciden con el consumo por codigo ni nombre, los marcados (nuevo, otro sector...) y los atados a mano
  const noEmparejadosConsumo = filasConsumo.filter((f) => ['sin', 'vinculo', 'estado'].includes(f.enlace.via) || f.sinUnir.length);
  const FILTROS_NO_EMP = [
    { clave: 'sin', label: 'Sin emparejar', pred: (f) => f.enlace.via === 'sin' || f.sinUnir.length > 0 },
    ...ESTADOS_CONSUMO.map((e) => ({ clave: e.codigo, label: e.texto, pred: (f) => f.enlace.via === 'estado' && f.enlace.estado === e.codigo })),
    { clave: 'vinculo', label: 'Atados a otro código', pred: (f) => f.enlace.via === 'vinculo' }, // sync-guard:ignore
    { clave: 'todos', label: 'Todos', pred: () => true }
  ];
  const filtroNoEmpActual = FILTROS_NO_EMP.find((x) => x.clave === filtroNoEmp) || FILTROS_NO_EMP[0];
  const opcionesNoEmp = FILTROS_NO_EMP
    .map((x) => ({ clave: x.clave, label: x.label, cantidad: noEmparejadosConsumo.filter(x.pred).length + (['sin', 'todos'].includes(x.clave) ? sinUnirNoPedidos.length : 0) }))
    .filter((x) => x.cantidad || x.clave === 'sin' || x.clave === 'todos');
  const COLOR_PISTA = { stock: '#176338', oc: '#1d5fa8', historico: '#7b5600', nuevo: '#6b3fa0' };
  const sinEmparejar = noEmparejadosConsumo.filter((f) => f.enlace.via === 'sin' || f.sinUnir.length).length + sinUnirNoPedidos.length;
  const verNoPedidos = ['sin', 'todos'].includes(filtroNoEmpActual.clave);
  const panelNoEmparejados = consumo.items.length && (noEmparejadosConsumo.length || sinUnirNoPedidos.length) ? (
    <section className="table-wrap" style={{ marginTop: 8, overflow: 'visible', border: sinEmparejar ? '2px solid #e0a800' : undefined }}>
      <div style={{ padding: '8px 12px', fontSize: 14 }}>
        <b>Pedidos que no coinciden con el consumo por código ni por nombre ({sinEmparejar} sin emparejar)</b>
        <span style={{ color: '#5b6b76' }}> · Atalos al código con el que figuran en el consumo, o marcá si es un fármaco nuevo, se consume en otro sector, etc. La pista te dice qué se sabe del código.</span>
        <div style={{ color: '#5b6b76', fontSize: 13, marginTop: 4 }}>
          <b>Cómo se arma:</b> cada código de los PDF de requerimiento se busca en el consumo mensual de <b>Farmacia MS</b> (que tiene datos desde oct 2025): por el mismo código, por lo atado a mano o por el mismo producto (droga + forma + concentración) con otro código. Los que no aparecen quedan acá.
          {' '}<b>Pista:</b> «en stock» sale del Stock Actual de Farmacia MS; «comprado en O.C.» del historial de O.C. de Drive; «consumido hasta T… » del Análisis Trimestral (último trimestre con consumo); «sin historial» = no figura en ninguna de esas fuentes.
          {' '}Ojo: un código con consumo en el Análisis Trimestral (2024–2025) puede figurar acá porque Farmacia MS no lo tiene: puede que no se use más o que figure con otro código.
        </div>
        <label className="checkline" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={verReqNoEmp} onChange={(event) => setVerReqNoEmp(event.target.checked)} /> Ver en qué requerimiento se pidió
        </label>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <FiltroSituacion
          titulo="Ver:"
          opciones={opcionesNoEmp}
          valor={filtroNoEmpActual.clave}
          onCambiar={(k) => setFiltroNoEmp((cur) => (cur === k && k !== 'todos' ? 'todos' : k))}
        />
      </div>
      <table className="compact" style={{ minWidth: 0 }}>
        <thead>
          <tr><th>Código pedido</th><th>Droga</th><th>Descripción</th><th style={{ textAlign: 'right' }}>Pedido</th>{verReqNoEmp ? <th>Requerimiento</th> : null}<th>Pista</th><th>Estado</th><th>Atar a / marcar como</th></tr>
        </thead>
        <tbody>
          {verNoPedidos ? sinUnirNoPedidos.map((grupo) => (
            <tr key={`nopedido-${grupo.items.map((i) => i.codigo).join('-')}`} style={{ background: '#fff1dc', boxShadow: 'inset 4px 0 0 #e08a00' }}>
              <td className="code">
                {grupo.items.map((it) => <div key={it.codigo}>{it.codigo}</div>)}
              </td>
              <td style={{ fontWeight: 700 }}>{grupo.items[0].nombre}</td>
              <td style={{ fontSize: 13 }}>
                {grupo.items.map((it) => (
                  <div key={it.codigo} style={{ marginBottom: 3 }}>
                    <b>{it.codigo}</b> — {[it.nombre, it.concentracion, it.presentacion, it.forma].filter(Boolean).join(' · ')}
                    <div style={{ color: '#8a4300', fontSize: 12 }}>stock {fmtCantidad(it.stock)} · {it.sector}{it.origen?.resumen ? ` · ${it.origen.resumen}` : ''}</div>
                  </div>
                ))}
              </td>
              <td style={{ textAlign: 'right', color: '#66717c', fontSize: 13 }}>no pedido</td>
              {verReqNoEmp ? <td>-</td> : null}
              <td style={{ fontSize: 12, color: '#8a4300' }}>mismo fármaco con {grupo.items.length} códigos en el Stock Actual</td>
              <td><span className="status en_proceso" title="Todavía no están unidos en Códigos equivalentes">sin unir: {grupo.items.map((i) => i.codigo).join(' + ')}</span></td>
              <td style={{ fontSize: 12, color: '#5b6b76' }}>Unir en «Códigos equivalentes» (Carga Requerimiento 2026)</td>
            </tr>
          )) : null}
          {noEmparejadosConsumo.filter(filtroNoEmpActual.pred).map((f) => {
            const marca = f.enlace.via === 'estado' ? ESTADO_CONSUMO[f.enlace.estado] : null;
            return (
              <tr key={f.g.clave} style={estiloUnion(f) || (f.enlace.via === 'sin' ? { background: '#fff8e1' } : undefined)}>
                <td className="code">{f.g.codigo}<MarcaUnion f={f} /></td>
                <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                <td>{f.g.descripcion}</td>
                <td style={{ textAlign: 'right' }}>{fmtCantidad(f.g.cantidad)}</td>
                {verReqNoEmp ? <td style={{ fontSize: 13 }}>{f.g.items.map((it) => <div key={it.id}>{it.archivo_nombre ? <b>{it.archivo_nombre}</b> : null}{it.archivo_nombre ? ' · ' : ''}req. {it.numero}/{it.anio_numero} · {fmtCantidad(it.cantidad)}{it.hoja ? ` (hoja ${it.hoja}, ítem ${it.item_nro})` : ''}</div>)}</td> : null}
                <td style={{ fontSize: 12 }}>
                  {pistaConsumo(f.g).map((p) => <div key={p.texto} style={{ color: COLOR_PISTA[p.tipo], fontWeight: p.tipo === 'nuevo' ? 700 : 400, whiteSpace: 'nowrap' }}>{p.texto}</div>)}
                </td>
                <td>
                  {f.enlace.via === 'sin' ? <span className="status error">sin emparejar</span> : null}
                  {f.sinUnir.length ? <span className="status en_proceso" title="Mismo fármaco con otro código en el Stock Actual, sin unir en Códigos equivalentes">sin unir con {f.sinUnir.map((x) => x.codigo).join(', ')}</span> : null}
                  {f.enlace.via === 'vinculo' ? <span className="status listo">atado a {f.enlace.codigo}</span> : null}
                  {marca ? <span style={{ fontSize: 13, fontWeight: 700, color: marca.color, background: marca.fondo, borderRadius: 4, padding: '2px 8px' }}>{marca.corto}</span> : null}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <SelectorProducto
                    valor={vinculosConsumo.get(f.g.codigo) || ''}
                    textoVacio="Elegir código o marcar…"
                    productos={productosConsumoAtar}
                    estados={ESTADOS_CONSUMO}
                    sugeridos={productosConsumoAtar.filter((p) => drogaDe(p.texto.split(' · ')[0]) === drogaDe(f.g.droga)).map((p) => p.codigo)}
                    onElegir={(codigo) => atarConsumo(f.g.codigo, codigo)}
                  />
                </td>
              </tr>
            );
          })}
          {!noEmparejadosConsumo.filter(filtroNoEmpActual.pred).length && !(verNoPedidos && sinUnirNoPedidos.length) ? <tr><td colSpan={verReqNoEmp ? 8 : 7} className="empty">Nada en este filtro</td></tr> : null}
        </tbody>
      </table>
    </section>
  ) : null;

  // Ministerio: decision de la comunicacion elegida para cada codigo pedido
  const minPorCodigo = new Map(minItems.map((m) => [m.codigo, m]));
  const minPorClave = new Map();
  for (const m of minItems) {
    const k = claveProducto(m.medicamento, m.medicamento);
    if (!k) continue;
    if (!minPorClave.has(k)) minPorClave.set(k, []);
    minPorClave.get(k).push(m);
  }
  const filasMin = gruposVisibles.map((g) => {
    const m = minPorCodigo.get(g.codigo) || (sigafValido(g.sigaf) ? minPorCodigo.get(sigafValido(g.sigaf)) : null);
    if (m) return { g, m, situacion: m.decision };
    // Sin coincidencia por codigo: misma droga + forma + concentracion en la lista (no habilitada para comprar)
    const k = claveProducto(g.droga, g.descripcion);
    const mNombre = k ? (minPorClave.get(k) || []).find((x) => x.decision !== 'comprar') : null;
    return { g, m: null, mNombre: mNombre || null, situacion: mNombre ? 'nombre' : 'no_en_lista' };
  });
  const sugeridoMin = (f) => (f.m?.decision === 'parcial' ? Math.ceil(f.g.cantidad / 2) : null);
  const montoSugeridoMin = (f) => (sugeridoMin(f) == null || !f.g.cantidad ? null : sugeridoMin(f) * (f.g.total / f.g.cantidad));
  // Lista del Ministerio: solo la lista del PDF (con el buscador)
  const listaMin = minItems
    .filter((m) => !qCruce || textoBusqueda(`${m.codigo} ${m.medicamento}`).includes(qCruce))
    .map((m) => ({ m }));
  const minPorDroga = new Map();
  for (const m of minItems) {
    const d = drogaDe(m.medicamento);
    if (!d) continue;
    if (!minPorDroga.has(d)) minPorDroga.set(d, []);
    minPorDroga.get(d).push(m);
  }
  const decisionMinisterio = (codigo, descripcion) => {
    const m = minPorCodigo.get(String(codigo || '').toUpperCase());
    if (m) return { ...m, porNombre: false };
    const candidatos = minPorDroga.get(drogaDe(descripcion)) || [];
    const mNombre = candidatos.find((x) => x.decision === 'no') || candidatos[0];
    return mNombre ? { ...mNombre, porNombre: true, otros: candidatos.length } : null;
  };
  const difOcNoReqMin = difOcNoReq.map((f) => ({ ...f, min: decisionMinisterio(f.codigo, f.descripcion) }));
  const difOcNoReqVisibles = difOcNoReqMin.filter(FILTROS_DIF_MIN[filtroDifMin].pred);
  const difReqNoOcMin = difReqNoOc.map((f) => {
    const porSigaf = sigafValido(f.g.sigaf) ? minPorCodigo.get(sigafValido(f.g.sigaf)) : null;
    return { ...f, min: porSigaf ? { ...porSigaf, porNombre: false } : decisionMinisterio(f.g.codigo, f.g.droga) };
  });
  const difReqNoOcVisibles = difReqNoOcMin.filter(FILTROS_DIF_MIN[filtroDifReq].pred);
  const filasStockMin = filasStock.map((f) => {
    const porSigaf = sigafValido(f.g.sigaf) ? minPorCodigo.get(sigafValido(f.g.sigaf)) : null;
    return { ...f, min: porSigaf ? { ...porSigaf, porNombre: false } : decisionMinisterio(f.g.codigo, f.g.droga) };
  });
  const stockNoRequeridoMin = stockNoRequerido.map((x) => ({ ...x, min: decisionMinisterio(x.codigo, x.nombre) }));
  const predStockMin = FILTROS_DIF_MIN[filtroStockMin].pred;
  const minNoPedidos = minItems.filter((m) => m.decision !== 'no' && !codigosRequeridos.has(m.codigo)
    && (!qCruce || textoBusqueda(`${m.codigo} ${m.medicamento}`).includes(qCruce)));
  const ocNoRequerido = Array.from(historialEfectivo
    .filter((h) => clavePeriodo(h) === periodoReferencia && !codigosRequeridos.has(h.codigo) && !sigafRequeridos.has(h.codigo)
      && (!qCruce || textoBusqueda(`${h.codigo} ${h.descripcion} ${h.oc_numero} ${h.proveedor}`).includes(qCruce)))
    .reduce((m, h) => {
      const f = m.get(h.codigo) || { codigo: h.codigo, descripcion: h.descripcion, cantidad: 0, ocs: [] };
      f.cantidad += Number(h.cantidad || 0);
      if (h.oc_numero && !f.ocs.includes(h.oc_numero)) f.ocs.push(h.oc_numero);
      m.set(h.codigo, f);
      return m;
    }, new Map()).values());

  const montoTotal = importaciones.reduce((acc, imp) => acc + Number(imp.total_calculado || 0), 0);
  const duplicados = source.data.filter((f) => f.duplicadoDe);
  const watch = source.watch;

  const detalleOcurrencias = (key, lista, colSpan) => (
    <tr key={`${key}-det`} className="detail-row">
      <td colSpan={colSpan}>
        <table className="compact" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>Requerimiento</th>
              <th>Archivo</th>
              <th>Hoja</th>
              <th>Ítem</th>
              <th>Código</th>
              <th>Descripción</th>
              <th style={{ textAlign: 'right' }}>Cantidad</th>
              <th style={{ textAlign: 'right' }}>Justiprecio</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((it) => (
              <tr key={it.id}>
                <td className="code">{it.numero}/{it.anio_numero}</td>
                <td>{it.archivo_nombre}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{it.hoja ? `${it.hoja} de ${it.total_hojas}` : '-'}</td>
                <td>{it.item_nro}</td>
                <td className="code">{it.codigo}</td>
                <td>{it.descripcion}{it.descripcion_especifica ? <div style={{ color: '#5b6b76', fontSize: 14 }}>{it.descripcion_especifica}</div> : null}</td>
                <td style={{ textAlign: 'right' }}>{fmtCantidad(it.cantidad)}</td>
                <td style={{ textAlign: 'right' }}>{formatPesos(it.justiprecio)}</td>
                <td style={{ textAlign: 'right' }}>{formatPesos(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );

  const celdaPrecio = (g) => (
    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
      {g.precioDistinto
        ? <span className="status error" title="El mismo producto tiene justiprecios distintos">{formatPesos(g.precioMin)} – {formatPesos(g.precioMax)}</span>
        : formatPesos(g.precioMin)}
      {g.precioDistinto ? (
        // De donde sale cada precio: archivo, requerimiento, hoja e item
        <div style={{ marginTop: 4, fontSize: 12, color: '#5b6b76', whiteSpace: 'normal', textAlign: 'left', minWidth: 190 }}>
          {Array.from(new Set(g.items.filter((it) => it.justiprecio != null).map((it) => Number(it.justiprecio))))
            .sort((a, b) => a - b)
            .map((precio) => (
              <div key={precio} style={{ marginTop: 2 }}>
                <b style={{ color: '#1f2d36' }}>{formatPesos(precio)}</b>
                {g.items.filter((it) => Number(it.justiprecio) === precio).map((it) => <div key={it.id}>{ubicacionItem(it)}</div>)}
              </div>
            ))}
        </div>
      ) : null}
    </td>
  );

  const celdaVeces = (g) => (
    <td style={{ textAlign: 'center' }}>
      {g.veces > 1 ? <span className={`status ${g.repetidoMismoReq ? 'error' : 'iniciado'}`}>{g.veces}</span> : g.veces}
    </td>
  );

  const botonAbrir = (key) => (
    <button type="button" className="ghost compact" onClick={() => toggle(key)} title="Ver cada requerimiento">
      {abiertos.has(key) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
    </button>
  );

  return (
    <div className="req-page">
      <section className="page-title">
        <h2>{soloMinisterio ? 'Habilitación Ministerio' : 'Análisis de Requerimiento Anual'}</h2>
      </section>
      <AyudaPagina id={soloMinisterio ? 'ministerio' : 'requerimiento'} sub={soloMinisterio ? minVista : vista} />

      {!soloMinisterio ? (
      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Carpeta vigilada: {source.dir || 'D:\\FARMACIA\\REQUERIMIENTO'}</span>
        <span className={`status ${watch?.enabled === false ? 'error' : 'cargado'}`} style={{ fontSize: 13 }}>
          {watch?.enabled === false ? 'sondeo apagado' : `sondeo automático cada ${watch ? Math.round(watch.intervalMs / 1000) : 60}s`}
        </span>
        <span style={{ color: '#5b6b76' }}>
          Último control: {watch?.ultimoSondeo ? new Date(watch.ultimoSondeo).toLocaleString() : '—'}
        </span>
        <button className="ghost small" onClick={() => setPicker(true)} disabled={busy}><Folder size={15} /> Elegir carpeta</button>
        <button className="ghost small" onClick={leerCarpeta} disabled={busy}><FolderOpen size={15} /> Leer carpeta ahora</button>
        <button className="ghost small" onClick={() => refresh()} disabled={busy}><RefreshCw size={15} /> Actualizar</button>
      </section>
      ) : null}

      {message ? <div className="notice">{message}</div> : null}

      {picker ? (
        <FolderPicker
          client={client}
          inicial={source.dir}
          titulo="Carpeta de los PDF de requerimiento"
          onElegir={elegirCarpeta}
          onCerrar={() => setPicker(false)}
        />
      ) : null}

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>Ciclo de compra:</span>
        {ciclos.map((c) => (
          <button
            key={c.ciclo}
            type="button"
            className={`ghost small ${ciclo === c.ciclo ? 'active' : ''}`}
            style={ciclo === c.ciclo ? { boxShadow: 'inset 0 0 0 2px #174e8d' } : undefined}
            onClick={() => elegirCiclo(c.ciclo)}
          >
            {etiquetaCiclo(c.ciclo)} ({c.requerimientos} req. · {fmtMillones(c.monto)})
          </button>
        ))}
        {!ciclos.length ? <span style={{ color: '#5b6b76' }}>Todavía no hay requerimientos cargados</span> : null}
        <span style={{ color: '#5b6b76', fontSize: 13 }}>Cada semestre se analiza aparte; el ciclo sale del período de consumo de cada PDF.</span>
      </section>

      {!soloMinisterio ? (<>
      <section className="summary-grid">
        <Metric label="Requerimientos" value={importaciones.length} />
        <Metric label="Ítems" value={items.length} />
        <Metric label="Códigos únicos" value={porCodigo.length} />
        <Metric label="Drogas" value={totalDrogas} />
        <Metric label="Códigos repetidos" value={porCodigo.filter((g) => g.veces > 1).length} />
        <Metric label="Gasto en repetidos" value={fmtMillones(gastoRepetidos)} />
        <Metric label="Monto total" value={fmtMillones(montoTotal)} />
      </section>

      <section className="toolbar" style={{ marginTop: 18, flexWrap: 'wrap' }}>
        <button className={`ghost ${vista === 'codigo' ? 'active' : ''}`} onClick={() => setVista('codigo')}>Por código</button>
        <button className={`ghost ${vista === 'droga' ? 'active' : ''}`} onClick={() => setVista('droga')}>Por droga</button>
        <button className={`ghost ${vista === 'repetidos' ? 'active' : ''}`} onClick={() => setVista('repetidos')}>Repetidos ({porCodigo.filter((g) => g.veces > 1).length})</button>
        <button className={`ghost ${vista === 'items' ? 'active' : ''}`} onClick={() => setVista('items')}>Todos los ítems</button>
        <button className={`ghost ${vista === 'stock' ? 'active' : ''}`} onClick={() => setVista('stock')}>Cruce con stock</button>
        <button className={`ghost ${vista === 'oc' ? 'active' : ''}`} onClick={() => setVista('oc')}>Cruce con O.C.</button>
        <button className={`ghost ${vista === 'consumo' ? 'active' : ''}`} onClick={() => setVista('consumo')}>Pedido vs consumo</button>
        <button className={`ghost ${vista === 'consumoSem' ? 'active' : ''}`} onClick={() => setVista('consumoSem')}>Consumo semestral</button>
        <button className={`ghost ${vista === 'consumoNeto' ? 'active' : ''}`} onClick={() => setVista('consumoNeto')}>Consumo y bajas</button>
        <button className={`ghost ${vista === 'consumoVto' ? 'active' : ''}`} onClick={() => setVista('consumoVto')}>Consumo, pedido y vencimientos</button>
        <button className={`ghost ${vista === 'diferencias' ? 'active' : ''}`} onClick={() => setVista('diferencias')}>Diferencias</button>
        <button className={`ghost ${vista === 'ministerio' ? 'active' : ''}`} onClick={() => setVista('ministerio')}>Ministerio (habilitación)</button>
        <button className={`ghost ${vista === 'requerimientos' ? 'active' : ''}`} onClick={() => setVista('requerimientos')}>Requerimientos y archivos</button>
        <button className={`ghost ${vista === 'correcciones' ? 'active' : ''}`} onClick={() => setVista('correcciones')} title="Valores del requerimiento corregidos a mano, con el original del PDF y el historial">Correcciones ({ajustes.length})</button>
      </section>
      </>) : null}

      {vista !== 'requerimientos' ? (
        <section className="filters">
          <select value={reqFiltro} onChange={(event) => setReqFiltro(event.target.value)}>
            <option value="">Todos los requerimientos</option>
            {importaciones.map((imp) => (
              <option key={imp.id} value={imp.id}>{imp.numero}/{imp.anio_numero} · {imp.archivo_nombre}</option>
            ))}
          </select>
          <div className="searchbox">
            <Search size={18} />
            <input placeholder="Buscar código, droga o descripción" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          {vista === 'codigo' || vista === 'droga' ? (
            <label className="checkline">
              <input type="checkbox" checked={soloRepetidos} onChange={(event) => setSoloRepetidos(event.target.checked)} /> Solo repetidos
            </label>
          ) : null}
          {vista === 'codigo' ? (
            <label className="checkline" title="Solo los códigos cuyo requerido se corrigió a mano">
              <input type="checkbox" checked={soloCorregidos} onChange={(event) => setSoloCorregidos(event.target.checked)} /> Solo corregidos ({ajustes.length})
            </label>
          ) : null}
        </section>
      ) : null}

      {vista === 'codigo' ? (
        <>
          <section className="toolbar" style={{ position: 'relative', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <button type="button" className={panelColsReq ? 'small' : 'ghost small'} onClick={() => setPanelColsReq(!panelColsReq)} title="Elegir qué datos agregar a la tabla">
              <Sigma size={15} /> Columnas ({colsReq2.length}){ocultasReq.length ? ` · ${ocultasReq.length} ocultas` : ''}
            </button>
            <span style={{ color: '#5b6b76', fontSize: 13 }}>
              Agregá consumo por semestre, carga manual, otros requerimientos, stock, vencimientos, O.C. y bajas.
              {colsReq.meta?.stockFecha ? ` Stock al ${fmtFechaAr(colsReq.meta.stockFecha)}.` : ''}
            </span>
            {panelColsReq ? (
              <PanelColumnas columnas={todasColsReqAj} visibles={colsReqElegidas} onCambiar={setColsReqVisibles} porDefecto={colsReqDefault} onCerrar={() => setPanelColsReq(false)}
                basicas={basicasReqCodigo(ciclo)} ocultas={ocultasReq} onOcultas={setOcultasReq} />
            ) : null}
          </section>
          <ExportButton targetId="tabla-req-codigo" name="requerimiento-por-codigo" />
          <section className="table-wrap">
            <table id="tabla-req-codigo" className="compact">
              <thead>
                <tr>
                  <th />
                  <th title={basicasReqCodigo(ciclo)[0].title}>Código</th>
                  {verReq('sigaf') ? <th title={basicasReqCodigo(ciclo)[1].title}>Cód. Sigaf</th> : null}
                  {verReq('droga') ? <th title={basicasReqCodigo(ciclo)[2].title}>Droga</th> : null}
                  {verReq('descripcion') ? <th title={basicasReqCodigo(ciclo)[3].title}>Descripción</th> : null}
                  {verReq('cantidad') ? <th style={{ textAlign: 'right' }} title={basicasReqCodigo(ciclo)[4].title}>{basicasReqCodigo(ciclo)[4].label}</th> : null}
                  {verReq('veces') ? <th style={{ textAlign: 'center' }} title="Veces que aparece el código (naranja: en varios requerimientos; rojo: repetido dentro del mismo)">Veces</th> : null}
                  {verReq('requerimientos') ? <th title={basicasReqCodigo(ciclo)[6].title}>Requerimientos</th> : null}
                  {verReq('justiprecio') ? <th style={{ textAlign: 'right' }} title={basicasReqCodigo(ciclo)[7].title}>Justiprecio</th> : null}
                  {verReq('total') ? <th style={{ textAlign: 'right' }} title={basicasReqCodigo(ciclo)[8].title}>Total $</th> : null}
                  {colsReq2.map((c) => <th key={c.key} style={{ textAlign: 'right', background: '#eef6f8' }} title={c.title || ''}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {gruposCodigo.flatMap((g) => {
                  const dCols = colsReq.datos[g.codigo] || {};
                  const filas = [(
                    <tr key={g.clave}>
                      <td>{botonAbrir(`c-${g.clave}`)}</td>
                      <td className="code">{g.codigo}</td>
                      {verReq('sigaf') ? <td>{g.sigaf}</td> : null}
                      {verReq('droga') ? <td style={{ fontWeight: 700 }}>{g.droga}</td> : null}
                      {verReq('descripcion') ? <td>{g.descripcion}</td> : null}
                      {verReq('cantidad') ? celdaRequerido(g) : null}
                      {verReq('veces') ? celdaVeces(g) : null}
                      {verReq('requerimientos') ? <td>{g.ubicaciones.join(', ')}</td> : null}
                      {verReq('justiprecio') ? celdaPrecio(g) : null}
                      {verReq('total') ? <td style={{ textAlign: 'right' }}>{formatPesos(g.total)}</td> : null}
                      {colsReq2.map((c) => {
                        const v = c.get(dCols, g);
                        const neg = typeof v === 'number' && v < 0;
                        return <td key={c.key} style={{ textAlign: c.tipo === 'texto' ? 'left' : 'right', color: neg ? '#b42318' : undefined }}>{formatoColumna(c, v)}</td>;
                      })}
                    </tr>
                  )];
                  if (abiertos.has(`c-${g.clave}`)) filas.push(detalleOcurrencias(`c-${g.clave}`, g.items, 10 - ocultasReq.length + colsReq2.length));
                  return filas;
                })}
                {!gruposCodigo.length ? <tr><td colSpan={10 - ocultasReq.length + colsReq2.length} className="empty">Sin datos</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'droga' ? (
        <>
          <ExportButton targetId="tabla-req-droga" name="requerimiento-por-droga" />
          <section className="table-wrap">
            <table id="tabla-req-droga" className="compact">
              <thead>
                <tr>
                  <th />
                  <th>Droga</th>
                  <th>Forma</th>
                  <th>Concentración</th>
                  <th style={{ textAlign: 'center' }} title="Más de 1: el mismo producto (droga, forma y concentración) pedido con códigos distintos">Códigos</th>
                  <th>Códigos</th>
                  <th style={{ textAlign: 'right' }}>Cantidad total</th>
                  <th style={{ textAlign: 'center' }}>Veces</th>
                  <th>Requerimientos</th>
                  <th style={{ textAlign: 'right' }}>Total $</th>
                </tr>
              </thead>
              <tbody>
                {gruposDroga.flatMap((g) => {
                  const filas = [(
                    <tr key={g.clave}>
                      <td>{botonAbrir(`d-${g.clave}`)}</td>
                      <td style={{ fontWeight: 700 }}>{g.droga}</td>
                      <td>{g.forma}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{g.concentracion || '-'}</td>
                      <td style={{ textAlign: 'center' }}>{g.codigos.size > 1 ? <span className="status error">{g.codigos.size}</span> : g.codigos.size}</td>
                      <td className="code" style={{ whiteSpace: 'normal' }}>{Array.from(g.codigos).join(', ')}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCantidad(g.cantidad)}</td>
                      <td style={{ textAlign: 'center' }}>{g.veces > 1 ? <span className="status iniciado">{g.veces}</span> : g.veces}</td>
                      <td>{g.ubicaciones.join(', ')}</td>
                      <td style={{ textAlign: 'right' }}>{formatPesos(g.total)}</td>
                    </tr>
                  )];
                  if (abiertos.has(`d-${g.clave}`)) filas.push(detalleOcurrencias(`d-${g.clave}`, g.items, 10));
                  return filas;
                })}
                {!gruposDroga.length ? <tr><td colSpan="10" className="empty">Sin datos</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'repetidos' ? (
        <>
          <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
            Códigos que aparecen más de una vez. <span className="status iniciado">naranja</span>: en varios requerimientos ·{' '}
            <span className="status error">rojo</span>: repetido dentro del mismo requerimiento o con justiprecios distintos.
            {' '}Gasto total de los repetidos: <b>{formatPesos(repetidos.reduce((a, g) => a + Number(g.total || 0), 0))}</b>.
          </div>
          <ExportButton targetId="tabla-req-repetidos" name="requerimiento-repetidos" />
          <section className="table-wrap">
            <table id="tabla-req-repetidos" className="compact">
              <thead>
                <tr>
                  <th />
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'center' }}>Veces</th>
                  <th>Requerimientos</th>
                  <th>Cantidades</th>
                  <th style={{ textAlign: 'right' }}>Cantidad total</th>
                  <th style={{ textAlign: 'right' }}>Justiprecio</th>
                  <th style={{ textAlign: 'right' }}>Total $</th>
                  <th>Observación</th>
                </tr>
              </thead>
              <tbody>
                {repetidos.flatMap((g) => {
                  const obs = [];
                  if (g.repetidoMismoReq) obs.push('repetido en el mismo requerimiento');
                  if (g.reqs.size > 1) obs.push(`en ${g.reqs.size} requerimientos`);
                  if (g.precioDistinto) obs.push('justiprecio distinto');
                  const filas = [(
                    <tr key={g.clave}>
                      <td>{botonAbrir(`r-${g.clave}`)}</td>
                      <td className="code">{g.codigo}</td>
                      <td style={{ fontWeight: 700 }}>{g.droga}</td>
                      <td>{g.descripcion}</td>
                      {celdaVeces(g)}
                      <td>{g.ubicaciones.join(', ')}</td>
                      <td>{g.items.map((it) => fmtCantidad(it.cantidad)).join(' + ')}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCantidad(g.cantidad)}</td>
                      {celdaPrecio(g)}
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatPesos(g.total)}</td>
                      <td>{obs.join(' · ')}</td>
                    </tr>
                  )];
                  if (abiertos.has(`r-${g.clave}`)) filas.push(detalleOcurrencias(`r-${g.clave}`, g.items, 11));
                  return filas;
                })}
                {!repetidos.length ? <tr><td colSpan="11" className="empty">No hay códigos repetidos</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'items' ? (
        <>
          <ExportButton targetId="tabla-req-items" name="requerimiento-items" />
          <section className="table-wrap">
            <table id="tabla-req-items" className="compact">
              <thead>
                <tr>
                  <th>Requerimiento</th>
                  <th>Hoja</th>
                  <th>Ítem</th>
                  <th>Código</th>
                  <th>Cód. Sigaf</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Justiprecio</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Imp.</th>
                </tr>
              </thead>
              <tbody>
                {itemsFiltrados.map((it) => (
                  <tr key={it.id}>
                    <td className="code">{it.numero}/{it.anio_numero}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{it.hoja ? `${it.hoja} de ${it.total_hojas}` : '-'}</td>
                    <td>{it.item_nro}</td>
                    <td className="code">{it.codigo}</td>
                    <td>{it.codigo_sigaf}</td>
                    <td style={{ fontWeight: 700 }}>{it.droga}</td>
                    <td>{it.descripcion}{it.descripcion_especifica ? <div style={{ color: '#5b6b76', fontSize: 14 }}>{it.descripcion_especifica}</div> : null}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCantidad(it.cantidad)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPesos(it.justiprecio)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPesos(it.total)}</td>
                    <td>{it.imputacion}</td>
                  </tr>
                ))}
                {!itemsFiltrados.length ? <tr><td colSpan="11" className="empty">Sin datos</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'stock' ? (
        <>
          {!cruce.descarga ? (
            <div className="notice">Todavía no hay stock descargado. Bajalo desde la card «Stock Actual (Farmacia MS)».</div>
          ) : (
            <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
              Stock al {fmtFechaAr(cruce.descarga.fecha_stock)} (descarga #{cruce.descarga.id}, {cruce.descarga.sectores}). Cruce por código.
            </div>
          )}
          <section className="filters">
            <FiltroSituacion
              valor={filtroStock}
              onCambiar={setFiltroStock}
              opciones={Object.entries(FILTROS_STOCK).map(([k, f]) => ({
                clave: k,
                label: f.label,
                cantidad: k === 'no_requerido' ? stockNoRequeridoMin.filter(predStockMin).length : filasStockMin.filter((x) => f.pred(x) && predStockMin(x)).length
              }))}
            />
          </section>
          <section className="filters">
            {comSel ? (
              <FiltroSituacion
                titulo="Ministerio:"
                valor={filtroStockMin}
                onCambiar={setFiltroStockMin}
                opciones={Object.entries(FILTROS_DIF_MIN).map(([k, f]) => ({
                  clave: k,
                  label: f.label,
                  cantidad: filtroStock === 'no_requerido'
                    ? stockNoRequeridoMin.filter(f.pred).length
                    : filasStockMin.filter((x) => FILTROS_STOCK[filtroStock].pred(x) && f.pred(x)).length
                }))}
              />
            ) : (
              <span style={{ color: '#5b6b76' }}>No hay comunicación del Ministerio para el {etiquetaCiclo(ciclo)}: no se puede marcar lo que dijo NO.</span>
            )}
          </section>
          <ExportButton targetId="tabla-req-stock" name="requerimiento-vs-stock" />
          <section className="table-wrap">
            <table id="tabla-req-stock" className="compact">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  <th title="Lo que dijo el Ministerio para el ciclo (por código o Sigaf; si no coincide, posible por la misma droga)">Ministerio</th>
                  <th>Requerimientos</th>
                  <th style={{ textAlign: 'right' }}>Pedido del ciclo</th>
                  <th style={{ textAlign: 'right' }}>Stock actual</th>
                  <th style={{ textAlign: 'right' }} title="Stock actual sobre lo pedido en el ciclo">Stock / pedido</th>
                  <th>Situación</th>
                </tr>
              </thead>
              <tbody>
                {filtroStock === 'no_requerido'
                  ? stockNoRequeridoMin.filter(predStockMin).map((s) => (
                    <tr key={s.codigo} style={s.min?.porNombre ? { background: '#fff8e1' } : s.min?.decision === 'no' ? { background: '#ffe3e3' } : undefined}>
                      <td className="code">{s.codigo}</td>
                      <td style={{ fontWeight: 700 }}>{s.nombre}</td>
                      <td>{[s.concentracion, s.forma].filter(Boolean).join(' ')}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {s.min
                          ? s.min.porNombre
                            ? <span className="status iniciado" title={`Misma droga, otro código: ${s.min.codigo} ${s.min.medicamento}`}>
                                posible · {s.min.codigo} {String(s.min.habilitado || '').toLowerCase() === 'no' ? 'dijo NO' : s.min.habilitado}
                              </span>
                            : <span className={`status ${s.min.decision === 'no' ? 'error' : s.min.decision === 'comprar' ? 'listo' : 'iniciado'}`} title={`${s.min.codigo} ${s.min.medicamento}`}>
                                {s.min.habilitado}
                              </span>
                          : <span style={{ color: '#5b6b76' }}>{comSel ? 'no está en la lista' : '-'}</span>}
                      </td>
                      <td>-</td>
                      <td style={{ textAlign: 'right' }}>-</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(s.stock)}</td>
                      <td style={{ textAlign: 'right' }}>-</td>
                      <td><span className="status error">sin stock · no está en el requerimiento</span></td>
                    </tr>
                  ))
                  : filasStockMin.filter((x) => FILTROS_STOCK[filtroStock].pred(x) && predStockMin(x)).map((f) => (
                    <tr key={f.g.clave} style={f.min?.porNombre ? { background: '#fff8e1' } : f.min?.decision === 'no' ? { background: '#ffe3e3' } : undefined}>
                      <td className="code">{f.g.codigo}</td>
                      <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                      <td>{f.g.descripcion}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {f.min
                          ? f.min.porNombre
                            ? <span className="status iniciado" title={`Misma droga, otro código: ${f.min.codigo} ${f.min.medicamento}`}>
                                posible · {f.min.codigo} {String(f.min.habilitado || '').toLowerCase() === 'no' ? 'dijo NO' : f.min.habilitado}
                              </span>
                            : <span className={`status ${f.min.decision === 'no' ? 'error' : f.min.decision === 'comprar' ? 'listo' : 'iniciado'}`} title={`${f.min.codigo} ${f.min.medicamento}`}>
                                {f.min.habilitado}
                              </span>
                          : <span style={{ color: '#5b6b76' }}>{comSel ? 'no está en la lista' : '-'}</span>}
                      </td>
                      <td>{f.g.ubicaciones.join(', ')}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCantidad(f.g.cantidad)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{f.s?.enStock ? fmtCantidad(f.s.stock) : '-'}</td>
                      <td style={{ textAlign: 'right' }}>{f.s?.enStock && f.g.cantidad ? `${Math.round((Number(f.s.stock) / f.g.cantidad) * 100)}%` : '-'}</td>
                      <td><span className={`status ${SITUACION_STOCK[f.situacion].clase}`} style={{ cursor: 'pointer' }} title="Tocá para filtrar por esta situación (otra vez para ver todos)" onClick={() => setFiltroStock((cur) => (cur === f.situacion ? 'todos' : f.situacion))}>{SITUACION_STOCK[f.situacion].label}</span></td>
                    </tr>
                  ))}
                {(filtroStock === 'no_requerido' ? !stockNoRequeridoMin.filter(predStockMin).length : !filasStockMin.filter((x) => FILTROS_STOCK[filtroStock].pred(x) && predStockMin(x)).length)
                  ? <tr><td colSpan="9" className="empty">Sin productos en esta categoría</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'oc' ? (
        <>
          <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
            <span>
              Historial de O.C. de Drive:{' '}
              <b>{historial.importacion ? `«${historial.importacion.file_nombre}» (${historial.importacion.pestanas})` : 'todavía no se leyó'}</b>
              {historial.importacion ? ` · leído el ${new Date(historial.importacion.created_at).toLocaleString('es-AR', { hour12: false })}` : ''}
            </span>
            <span style={{ color: '#5b6b76' }}>Semestre según la fecha de vencimiento de la O.C. Cruce por código y código Sigaf.</span>
            <button className="ghost small" onClick={actualizarHistorial} disabled={busy}><RefreshCw size={15} /> Actualizar desde Drive</button>
          </section>
          <section className="filters">
            <FiltroSituacion
              valor={filtroOc}
              onCambiar={setFiltroOc}
              opciones={Object.entries(FILTROS_OC).map(([k, f]) => ({
                clave: k,
                label: k === 'no_requerido' ? `Comprados en ${etiquetaPeriodo(periodoReferencia)} y NO pedidos en este ciclo` : f.label,
                cantidad: k === 'no_requerido' ? ocNoRequerido.length : filasOc.filter(f.pred).length
              }))}
            />
          </section>
          {renglonesRaros.some((r) => r.estado !== 'nombre') || renglonesRaros.length ? (
            <section className="table-wrap" style={{ marginTop: 8, overflow: 'visible', border: renglonesRaros.some((r) => r.estado === 'sin') ? '2px solid #e0a800' : undefined }}>
              <div style={{ padding: '8px 12px', fontSize: 14 }}>
                <b>Renglones de O.C. que no coinciden por código, Sigaf ni nombre ({renglonesRaros.filter((r) => r.estado === 'sin').length})</b>
                <span style={{ color: '#5b6b76' }}> · Atalos al producto pedido que corresponda, o marcá que no corresponde a ninguno.</span>
                {renglonesRaros.some((r) => r.estado === 'nombre') ? (
                  <>
                    {' · '}
                    <button type="button" className="ghost small" onClick={() => setVerPorNombre((v) => !v)}>
                      {verPorNombre ? 'Ocultar' : 'Ver'} los {renglonesRaros.filter((r) => r.estado === 'nombre').length} cruzados por nombre
                    </button>
                  </>
                ) : null}
              </div>
              <table className="compact" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>O.C.</th>
                    <th>Período</th>
                    <th>Código en la planilla</th>
                    <th>Descripción en la O.C.</th>
                    <th style={{ textAlign: 'right' }}>Cantidad</th>
                    <th>Estado</th>
                    <th>Atar a</th>
                  </tr>
                </thead>
                <tbody>
                  {renglonesRaros.filter((r) => r.estado !== 'nombre' || verPorNombre).map((r) => (
                    <tr key={r.h.id} style={r.estado === 'sin' ? { background: '#fff8e1' } : undefined}>
                      <td className="code">{r.h.oc_numero || '-'}</td>
                      <td>{etiquetaPeriodo(clavePeriodo(r.h))}</td>
                      <td className="code">{r.h.codigoOriginal}</td>
                      <td>{r.h.descripcion}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCantidad(r.h.cantidad)}</td>
                      <td>
                        {r.estado === 'vinculado' ? <span className="status listo">atado a {r.destino}</span> : null}
                        {r.estado === 'ninguno' ? <span className="status cargado">no corresponde a ningún pedido</span> : null}
                        {r.estado === 'nombre' ? <span className="status iniciado">por nombre → {r.candidatos.join(', ')}</span> : null}
                        {r.estado === 'sin' ? <span className="status error">sin vincular</span> : null}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <SelectorProducto
                          valor={r.vinculo || ''}
                          textoVacio={r.candidatos.length ? 'Automático (por nombre)' : 'Elegir producto…'}
                          productos={productosParaAtar}
                          sugeridos={porCodigo.filter((g) => drogaDe(g.droga) === drogaDe(r.h.descripcion)).map((g) => g.codigo)}
                          onElegir={(codigo) => atarRenglon(r.h, codigo)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          <ColumnasPeriodo periodos={periodosOc} ocultos={periodosOcultos} onCambiar={setPeriodosOcultos} />
          <ExportButton targetId="tabla-req-oc" name="requerimiento-vs-oc-por-semestre" />
          <section className="table-wrap">
            <table id="tabla-req-oc" className="compact">
              <thead>
                <tr>
                  <th />
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  <th>Requerimientos</th>
                  <th style={{ textAlign: 'right' }}>Pedido del ciclo</th>
                  {periodosVisibles.map((k) => (
                    <th key={k} style={{ textAlign: 'right' }} title="Cantidad en O.C. (entregada)">Comprado {etiquetaPeriodo(k)}</th>
                  ))}
                  <th style={{ textAlign: 'right' }} title="Pedido del ciclo sobre lo comprado en el mismo semestre del año anterior (columna celeste)">Pedido vs mismo sem. año anterior</th>
                  <th>Situación</th>
                </tr>
              </thead>
              <tbody>
                {filtroOc === 'no_requerido'
                  ? ocNoRequerido.map((f) => (
                    <tr key={f.codigo}>
                      <td />
                      <td className="code">{f.codigo}</td>
                      <td style={{ fontWeight: 700 }}>-</td>
                      <td>{f.descripcion}</td>
                      <td>-</td>
                      <td style={{ textAlign: 'right' }}>-</td>
                      {periodosVisibles.map((k) => (
                        <td key={k} style={{ textAlign: 'right' }}>{k === periodoReferencia ? fmtCantidad(f.cantidad) : ''}</td>
                      ))}
                      <td style={{ textAlign: 'right' }}>-</td>
                      <td><span className="status cargado">{f.ocs.join(', ')} · no está en el requerimiento</span></td>
                    </tr>
                  ))
                  : filasOc.filter(FILTROS_OC[filtroOc].pred).flatMap((f) => {
                    const clave = `oc-${f.g.clave}`;
                    const out = [(
                      <tr key={f.g.clave}>
                        <td>
                          {f.rows.length ? (
                            <button type="button" className="ghost compact" onClick={() => toggle(clave)} title="Ver cada O.C.">
                              {abiertos.has(clave) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          ) : null}
                        </td>
                        <td className="code">{f.g.codigo}</td>
                        <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                        <td>{f.g.descripcion}</td>
                        <td>{f.g.ubicaciones.join(', ')}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(f.g.cantidad)}</td>
                        {periodosVisibles.map((k) => (
                          <td key={k} style={{ textAlign: 'right', background: k === f.kAnterior ? '#f0f6ff' : undefined }}>
                            {f.porPeriodo[k] ? (
                              <>
                                {fmtCantidad(f.porPeriodo[k].cantidad)}
                                <div style={{ color: '#5b6b76', fontSize: 12 }}>entr. {fmtCantidad(f.porPeriodo[k].entregada)}</div>
                              </>
                            ) : '-'}
                          </td>
                        ))}
                        <td style={{ textAlign: 'right' }}>{f.anterior ? `${Math.round((f.g.cantidad / f.anterior) * 100)}%` : '-'}</td>
                        <td><span className={`status ${SITUACION_OC[f.situacion].clase}`} style={{ cursor: 'pointer' }} title="Tocá para filtrar por esta situación (otra vez para ver todos)" onClick={() => setFiltroOc((cur) => (cur === f.situacion ? 'todos' : f.situacion))}>{SITUACION_OC[f.situacion].label}</span></td>
                      </tr>
                    )];
                    if (abiertos.has(clave)) {
                      out.push(
                        <tr key={`${clave}-det`} className="detail-row">
                          <td colSpan={8 + periodosVisibles.length}>
                            <table className="compact" style={{ minWidth: 0 }}>
                              <thead>
                                <tr><th>Período</th><th>O.C.</th><th>Proveedor</th><th>Vence</th><th>Renglón</th><th>Código</th><th>Descripción en la O.C.</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Entregada</th><th>Completo</th></tr>
                              </thead>
                              <tbody>
                                {f.rows.map((h) => (
                                  <tr key={h.id}>
                                    <td>{etiquetaPeriodo(clavePeriodo(h))}</td>
                                    <td className="code">{h.oc_numero || '-'}</td>
                                    <td>{h.proveedor || '-'}</td>
                                    <td>{fmtFechaAr(h.vencimiento)}</td>
                                    <td>{h.renglon || '-'}</td>
                                    <td className="code">
                                      {h.codigoOriginal || h.codigo}
                                      {h.via === 'nombre' ? <span className="status iniciado" style={{ marginLeft: 4 }}>por nombre</span> : null}
                                      {h.via === 'vinculo' ? <span className="status listo" style={{ marginLeft: 4 }}>atado a mano</span> : null}
                                    </td>
                                    <td>{h.descripcion}</td>
                                    <td style={{ textAlign: 'right' }}>{h.cantidad == null ? '-' : fmtCantidad(h.cantidad)}</td>
                                    <td style={{ textAlign: 'right' }}>{h.entregada == null ? '-' : fmtCantidad(h.entregada)}</td>
                                    <td>{h.completo || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      );
                    }
                    return out;
                  })}
                {(filtroOc === 'no_requerido' ? !ocNoRequerido.length : !filasOc.filter(FILTROS_OC[filtroOc].pred).length)
                  ? <tr><td colSpan={8 + periodosVisibles.length} className="empty">Sin productos en esta categoría</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'consumo' ? (
        <>
          {!consumo.items.length ? (
            <div className="notice">Todavía no hay consumo descargado. Bajalo desde la card «Consumo Mensual (Farmacia MS)».</div>
          ) : (
            <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
              Consumo de Farmacia MS ({consumoSectores}). Las columnas de consumo muestran solo el <b>mismo semestre</b> de otros años. <b>Consumo estimado del ciclo</b> = pronóstico estadístico mes a mes de {etiquetaCiclo(ciclo)} con los {consumoAnalisis.cerrados.length} meses cerrados: picos atípicos recortados (Q3 + 1,5×IQR), nivel con suavizado exponencial, estacionalidad del mismo mes del año anterior (atenuada según variabilidad e historia) y tasa media si el consumo es intermitente.
              El <b>rango</b> es un intervalo aproximado del 80 %: si el pedido queda por encima es «de más», por debajo «de menos», adentro «dentro del rango». Pasá el mouse sobre el número para ver el cálculo. El mes en curso no se cuenta. «(proy.)» = semestre con meses faltantes, proyectado.
            </div>
          )}
          <section className="filters">
            <FiltroSituacion
              valor={filtroConsumo}
              onCambiar={setFiltroConsumo}
              opciones={Object.entries(FILTROS_CONSUMO).map(([k, f]) => ({ clave: k, label: f.label, cantidad: filasConsumo.filter(f.pred).length }))}
            />
          </section>
          <ExportButton targetId="tabla-req-consumo" name="requerimiento-pedido-vs-consumo" />
          <section className="table-wrap">
            <table id="tabla-req-consumo" className="compact">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  <th>Requerimientos</th>
                  <th style={{ textAlign: 'right' }}>Pedido del ciclo</th>
                  {semestresConsumo.map((s) => (
                    <th key={s.key} style={{ textAlign: 'right' }} title={`Consumo ${s.label}${s.meses < 6 ? ` (${s.meses} meses con datos, proyectado a 6)` : ''}`}>
                      Consumo {s.label}{s.meses < 6 ? ' (proy.)' : ''}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right' }} title="Consumo estimado del ciclo ÷ 6">Prom. mensual estimado</th>
                  <th style={{ textAlign: 'right' }} title="Suma del pronóstico mensual de los 6 meses del ciclo, con rango aproximado del 80 %">Consumo estimado {etiquetaCiclo(ciclo)}</th>
                  <th style={{ textAlign: 'right' }} title="Pedido del ciclo sobre el consumo estimado del ciclo">Pedido / consumo estimado</th>
                  <th>Situación</th>
                </tr>
              </thead>
              <tbody>
                {filasConsumo.filter(FILTROS_CONSUMO[filtroConsumo].pred).map((f) => (
                  <tr key={f.g.clave}>
                    <td className="code">{f.g.codigo}</td>
                    <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                    <td>{f.g.descripcion}</td>
                    <td>{f.g.ubicaciones.join(', ')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(f.g.cantidad)}</td>
                    {semestresConsumo.map((s) => (
                      <td key={s.key} style={{ textAlign: 'right' }}>{f.enConsumo ? fmtCantidad(Math.round(f.porSemestre[s.key] || 0)) : <MarcaConsumo enlace={f.enlace} />}</td>
                    ))}
                    <td style={{ textAlign: 'right' }}>{f.enConsumo ? fmtCantidad(Math.round(f.promedio)) : '-'}</td>
                    <td
                      style={{ textAlign: 'right', fontWeight: 700, cursor: f.enConsumo ? 'help' : undefined }}
                      title={f.enConsumo ? [
                        f.prono.intermitente
                          ? `Consumo intermitente: tasa media de ${f.prono.n} meses, ${fmtCantidad(Math.round(f.prono.nivel))} por mes, sin estacionalidad`
                          : `Nivel mensual (suavizado exponencial, ${f.prono.n} meses): ${fmtCantidad(Math.round(f.prono.nivel))}`,
                        `Coeficiente de variación: ${Math.round((f.prono.cv || 0) * 100)} %`,
                        ...mesesDelCiclo.map((idx) => `${MESES_CORTOS[idx % 12].toLowerCase()} ${Math.floor(idx / 12)}: ${fmtCantidad(Math.round(f.prono.porMes.get(idx)))} (índice ${f.prono.indices.get(idx).toFixed(2)})`),
                        f.prono.recortados ? `${f.prono.recortados} mes(es) con pico atípico recortado` : 'Sin meses atípicos'
                      ].join('\n') : undefined}
                    >
                      {f.enConsumo ? (
                        <>
                          {fmtCantidad(Math.round(f.esperado))}
                          {f.rangoSup > f.esperado ? <div style={{ fontSize: 12, fontWeight: 400, color: '#5b6b76', whiteSpace: 'nowrap' }}>rango {fmtCantidad(Math.round(f.rangoInf))}–{fmtCantidad(Math.round(f.rangoSup))}</div> : null}
                        </>
                      ) : '-'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{f.ratio == null ? '-' : `${Math.round(f.ratio * 100)}%`}</td>
                    <td>
                      <span
                        className={`status ${SITUACION_CONSUMO[f.situacion].clase}`}
                        style={{ cursor: 'pointer' }}
                        title="Tocá para filtrar por esta situación (otra vez para ver todos)"
                        onClick={() => setFiltroConsumo((cur) => (cur === f.situacion ? 'todos' : f.situacion))}
                      >
                        {SITUACION_CONSUMO[f.situacion].label}
                      </span>
                    </td>
                  </tr>
                ))}
                {!filasConsumo.filter(FILTROS_CONSUMO[filtroConsumo].pred).length
                  ? <tr><td colSpan={9 + semestresConsumo.length} className="empty">Sin productos en esta categoría</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'consumoSem' ? (
        <>
          {!consumo.items.length ? (
            <div className="notice">Todavía no hay consumo descargado. Bajalo desde la card «Consumo Mensual (Farmacia MS)».</div>
          ) : (
            <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
              Consumo real por semestre según Farmacia MS ({consumoSectores}), solo meses cerrados. Si un semestre está incompleto se indica qué meses tiene y, debajo, el proyectado a 6 meses.
              A la derecha, el stock actual y lo pedido en los requerimientos del {etiquetaCiclo(ciclo)}.
            </div>
          )}
          {panelNoEmparejados}
          <ExportButton targetId="tabla-req-consumo-sem" name="consumo-semestral-vs-pedido" />
          <section className="table-wrap">
            <table id="tabla-req-consumo-sem" className="compact">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  {semestresConsumo.map((s) => (
                    <th key={s.key} style={{ textAlign: 'right' }}>
                      Consumo {s.label}
                      <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>{s.meses < 6 ? `${rangoMeses(s)} (${s.meses} meses)` : 'completo'}</div>
                    </th>
                  ))}
                  <th style={{ textAlign: 'right', background: '#eefaf2' }} title="Stock de la última descarga de Farmacia MS (Unificada + Psicofármacos)">
                    Stock actual
                    <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>{cruce.descarga ? `al ${fmtFechaAr(cruce.descarga.fecha_stock)}` : 'sin descargar'}</div>
                  </th>
                  <th style={{ textAlign: 'right', background: '#eef4fb' }}>Pedido {etiquetaCiclo(ciclo)}</th>
                  <th>Requerimientos</th>
                </tr>
              </thead>
              <tbody>
                {filasConsumo.map((f) => {
                  const meses = f.enlace.codigo ? mesesFam(f.enlace.codigo) : null;
                  return (
                    <tr key={f.g.clave} style={estiloUnion(f)}>
                      <td className="code">{f.g.codigo}<MarcaUnion f={f} /></td>
                      <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                      <td>{f.g.descripcion}</td>
                      {semestresConsumo.map((s) => {
                        const real = meses ? s.idxs.reduce((a, idx) => a + (meses[idx] || 0), 0) : null;
                        return (
                          <td key={s.key} style={{ textAlign: 'right' }}>
                            {real == null ? <MarcaConsumo enlace={f.enlace} /> : fmtCantidad(Math.round(real))}
                            {real != null && s.meses < 6 ? (
                              <div style={{ color: '#5b6b76', fontSize: 12 }}>proy. {fmtCantidad(Math.round((real / s.meses) * 6))}</div>
                            ) : null}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'right', fontWeight: 700, background: '#f4fbf6' }}>
                        {stockDeFila(f) != null ? fmtCantidad(stockDeFila(f)) : <span style={{ color: '#5b6b76', fontWeight: 400 }}>no figura</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, background: '#f5f9fd' }}>{fmtCantidad(f.g.cantidad)}</td>
                      <td>{f.g.ubicaciones.join(', ')}</td>
                    </tr>
                  );
                })}
                {!filasConsumo.length ? <tr><td colSpan={6 + semestresConsumo.length} className="empty">Sin productos</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'consumoNeto' ? (
        <>
          {!consumo.items.length ? (
            <div className="notice">Todavía no hay consumo descargado. Bajalo desde la card «Consumo Mensual (Farmacia MS)».</div>
          ) : (
            <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
              Por semestre: el <b>consumo</b> de Farmacia MS ({consumoSectores}) y, al lado, las <b>bajas</b> (descartes y vencidos del Listado de Egresos), que no son consumo y no están incluidas en él.
              {' '}Tocá un número de bajas para ver el detalle. {bajasData.data.length ? `${bajasData.data.length} renglones de bajas cargados.` : 'Todavía no hay bajas leídas: se leen al correr el robot de Consumo Mensual.'}
            </div>
          )}
          {panelNoEmparejados}
          <ExportButton targetId="tabla-req-consumo-neto" name="consumo-y-bajas-por-semestre" />
          <section className="table-wrap">
            <table id="tabla-req-consumo-neto" className="compact">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  {semestresConsumo.flatMap((s) => [
                    <th key={`${s.key}-c`} style={{ textAlign: 'right' }}>
                      Consumo {s.label}
                      <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>{s.meses < 6 ? `${rangoMeses(s)} (${s.meses} meses)` : 'completo'}</div>
                    </th>,
                    <th key={`${s.key}-b`} style={{ textAlign: 'right', background: '#fdf0f0' }} title="Descartes y vencidos dados de baja en el semestre (tocá para ver el detalle)">
                      Bajas {s.label}
                    </th>
                  ])}
                  <th style={{ textAlign: 'right', background: '#eefaf2' }} title="Stock de la última descarga de Farmacia MS (Unificada + Psicofármacos)">
                    Stock actual
                    <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>{cruce.descarga ? `al ${fmtFechaAr(cruce.descarga.fecha_stock)}` : 'sin descargar'}</div>
                  </th>
                  <th style={{ textAlign: 'right', background: '#eef4fb' }}>Pedido {etiquetaCiclo(ciclo)}</th>
                  <th>Requerimientos</th>
                </tr>
              </thead>
              <tbody>
                {filasConsumo.flatMap((f) => {
                  const meses = f.enlace.codigo ? mesesFam(f.enlace.codigo) : null;
                  const bajasCodigo = f.enlace.codigo ? bajasPorCodigo.get(f.enlace.codigo) || [] : [];
                  const abiertoSem = semestresConsumo.find((s) => abiertos.has(`neto|${f.g.clave}|${s.key}`));
                  const out = [(
                    <tr key={f.g.clave} style={estiloUnion(f)}>
                      <td className="code">
                        {f.g.codigo}
                        <MarcaUnion f={f} />
                        {f.enlace.via === 'nombre' || f.enlace.via === 'vinculo'
                          ? <div style={{ fontSize: 11, color: '#7b5600', fontWeight: 400 }}>consumo: {f.enlace.codigo} ({f.enlace.via === 'nombre' ? 'por nombre' : 'atado'})</div>
                          : null}
                      </td>
                      <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                      <td>{f.g.descripcion}</td>
                      {semestresConsumo.flatMap((s) => {
                        const real = meses ? s.idxs.reduce((a, idx) => a + (meses[idx] || 0), 0) : null;
                        const bajasSem = bajasCodigo.filter((b) => s.idxs.includes(b.idx)).reduce((a, b) => a + Number(b.cantidad || 0), 0);
                        const clave = `neto|${f.g.clave}|${s.key}`;
                        return [
                          <td key={`${s.key}-c`} style={{ textAlign: 'right' }}>
                            {real == null ? <MarcaConsumo enlace={f.enlace} /> : fmtCantidad(Math.round(real))}
                            {real != null && s.meses < 6 ? <div style={{ color: '#5b6b76', fontSize: 12 }}>proy. {fmtCantidad(Math.round((real / s.meses) * 6))}</div> : null}
                          </td>,
                          <td key={`${s.key}-b`} style={{ textAlign: 'right', background: abiertos.has(clave) ? '#ffe3e3' : '#fdf7f7' }}>
                            {bajasSem > 0 ? (
                              <button
                                type="button"
                                className="ghost small"
                                style={{ padding: '0 6px', color: '#9d1c1c', fontWeight: 700 }}
                                title="Ver qué se dio de baja"
                                onClick={() => {
                                  for (const otro of semestresConsumo) if (otro.key !== s.key && abiertos.has(`neto|${f.g.clave}|${otro.key}`)) toggle(`neto|${f.g.clave}|${otro.key}`);
                                  toggle(clave);
                                }}
                              >
                                {fmtCantidad(bajasSem)} {abiertos.has(clave) ? '▾' : '▸'}
                              </button>
                            ) : <span style={{ color: '#9aa5ad' }}>-</span>}
                          </td>
                        ];
                      })}
                      <td style={{ textAlign: 'right', fontWeight: 700, background: '#f4fbf6' }}>
                        {stockDeFila(f) != null ? fmtCantidad(stockDeFila(f)) : <span style={{ color: '#5b6b76', fontWeight: 400 }}>no figura</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, background: '#f5f9fd' }}>{fmtCantidad(f.g.cantidad)}</td>
                      <td>{f.g.ubicaciones.join(', ')}</td>
                    </tr>
                  )];
                  if (abiertoSem) {
                    const detalle = bajasCodigo.filter((b) => abiertoSem.idxs.includes(b.idx));
                    out.push(
                      <tr key={`${f.g.clave}-bajas`} className="detail-row">
                        <td colSpan={6 + semestresConsumo.length * 2}>
                          <b>Bajas de {f.g.droga} en el {abiertoSem.label}</b>
                          <table className="compact" style={{ minWidth: 0, marginTop: 4 }}>
                            <thead>
                              <tr><th>Fecha</th><th>Tipo</th><th>Egreso</th><th>Motivo</th><th>Sector</th><th>Código</th><th>Medicamento</th><th>Lote</th><th>Vto.</th><th style={{ textAlign: 'right' }}>Cantidad</th></tr>
                            </thead>
                            <tbody>
                              {detalle.map((b) => (
                                <tr key={b.id}>
                                  <td>{fmtFechaAr(b.fecha)}</td>
                                  <td><span className={`status ${/descarte/i.test(b.tipo) ? 'error' : 'iniciado'}`}>{b.tipo}</span></td>
                                  <td className="code">{b.egreso_id}</td>
                                  <td>{b.motivo || '-'}</td>
                                  <td>{/PSICO/i.test(b.sector) ? 'Psicofármacos' : /UNIFICADA/i.test(b.sector) ? 'Unificada' : b.sector}</td>
                                  <td className="code">{b.codigo}</td>
                                  <td>{b.medicamento}</td>
                                  <td className="code">{b.lote || '-'}</td>
                                  <td>{fmtFechaAr(b.vencimiento)}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(b.cantidad)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    );
                  }
                  return out;
                })}
                {!filasConsumo.length ? <tr><td colSpan={6 + semestresConsumo.length * 2} className="empty">Sin productos</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'consumoVto' ? (() => {
        // Meses: desde el actual hasta el fin del ciclo del requerimiento; antes = vencido, despues = sigue vigente
        const hoyVto = new Date();
        const idxHoy = hoyVto.getFullYear() * 12 + hoyVto.getMonth();
        const [anioCiclo, semCiclo] = String(ciclo).split('-').map(Number);
        const idxIniCiclo = anioCiclo && semCiclo ? anioCiclo * 12 + (semCiclo === 1 ? 0 : 6) : idxHoy + 1;
        const idxFinCiclo = idxIniCiclo + 5;
        const mesesVto = [];
        for (let idx = idxHoy; idx <= Math.max(idxFinCiclo, idxHoy); idx += 1) mesesVto.push(idx);
        const etiquetaMes = (idx) => `${MESES_CORTOS[idx % 12].toLowerCase()} ${Math.floor(idx / 12)}`;
        const enCiclo = (idx) => idx >= idxIniCiclo && idx <= idxFinCiclo;
        const nombreCiclo = etiquetaCiclo(ciclo);
        // Semestre en curso: meses cerrados con dato real en Farmacia MS + pronostico del resto (incluye el mes actual)
        const nombreSem = (idx) => `${idx % 12 < 6 ? '1er' : '2do'} sem ${Math.floor(idx / 12)}`;
        const rango = (idxs) => (idxs.length ? `${MESES_CORTOS[idxs[0] % 12].toLowerCase()}–${MESES_CORTOS[idxs[idxs.length - 1] % 12].toLowerCase()}` : '');
        const cerradosSet = new Set(consumoAnalisis.cerrados);
        const idxIniCurso = Math.floor(idxHoy / 12) * 12 + (idxHoy % 12 < 6 ? 0 : 6);
        const mesesCurso = [0, 1, 2, 3, 4, 5].map((i) => idxIniCurso + i);
        const cursoReales = mesesCurso.filter((idx) => idx < idxHoy && cerradosSet.has(idx));
        const cursoEstimados = mesesCurso.filter((idx) => !cursoReales.includes(idx));
        // Mismo semestre del año anterior, por trimestre: Farmacia MS si tiene los 3 meses, si no el Analisis Trimestral
        const idxIniAnt = idxIniCurso - 12;
        const partesAnt = [idxIniAnt, idxIniAnt + 3].map((q) => {
          const idxs = [q, q + 1, q + 2];
          const trimKey = `${Math.floor(q / 12)}-${Math.floor((q % 12) / 3) + 1}`;
          const conMs = idxs.filter((idx) => cerradosSet.has(idx));
          if (conMs.length === 3 || (conMs.length && !trimPorTrimestre.has(trimKey))) return { tipo: 'ms', idxs: conMs, texto: `${rango(conMs)} MS` };
          if (trimPorTrimestre.has(trimKey)) return { tipo: 'trim', mapa: trimPorTrimestre.get(trimKey), texto: `T${trimKey.split('-')[1]} trimestral` };
          return null;
        }).filter(Boolean);
        return (
          <>
            <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
              Consumo por semestre, stock actual y <b>cuánto vence cada mes</b> (de los lotes de la card Vencimientos{vtoData.hasta ? `, hasta el ${fmtFechaAr(vtoData.hasta)}` : ''}).
              {' '}Los meses en <span style={{ background: '#e7f1fb', padding: '0 4px' }}>azul</span> son los del {nombreCiclo} ({etiquetaMes(idxIniCiclo)} a {etiquetaMes(idxFinCiclo)}).
              {' '}<b>Consumo estimado</b> = pronóstico mes a mes con estadística sobre todo el consumo mensual de Farmacia MS: se recortan los picos atípicos (Q3 + 1,5×IQR), el nivel se calcula con suavizado exponencial (pesa más lo reciente) y se ajusta por la estacionalidad del mismo mes del año anterior (atenuada según la variabilidad y los años de historia); si el consumo es intermitente (más del 30 % de meses en cero) se usa la tasa media sin estacionalidad; el rango es un intervalo aproximado del 80 %. Pasá el mouse sobre el número para ver el cálculo. <b>Stock estimado al inicio</b> = stock actual menos ese consumo (usando primero los lotes más próximos a vencer) y menos lo que vence sin llegar a usarse. <b>Vence sin usarse en el ciclo</b> = lo que vence dentro del ciclo antes de poder consumirse. <b>Se pisa con el pedido</b> = la parte del pedido que ya estaría cubierta por el stock que se puede usar (estimado al inicio menos lo que vence sin usarse).
              {!vtoData.hasta ? <b> Todavía no hay vencimientos descargados: bajalos desde la card «Vencimientos (Farmacia MS)».</b> : null}
            </div>
            {panelNoEmparejados}
            <label className="checkline" style={{ margin: '8px 2px' }}>
              <input type="checkbox" checked={verVencimientos} onChange={(event) => cambiarVerVencimientos(event.target.checked)} /> Mostrar la columna de vencimientos (al final de la tabla; tocá el botón de cada fila para ver cuánto vence cada mes)
            </label>
            {verVencimientos ? (
              <div style={{ display: 'flex', gap: 8, margin: '4px 2px 8px' }}>
                <button type="button" className="ghost small" onClick={() => setVtoAbiertos(new Set(filasVto.map((f) => f.g.clave)))}>Abrir todos los vencimientos</button>
                {vtoAbiertos.size ? <button type="button" className="ghost small" onClick={() => setVtoAbiertos(new Set())}>Cerrar todos</button> : null}
              </div>
            ) : null}
            {semestresAnios.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', margin: '8px 2px', fontSize: 14 }}>
                <span style={{ fontWeight: 700 }}>Consumo del {semestreDeCiclo(ciclo) === 2 ? '2do' : '1er'} semestre de los años:</span>
                {semestresAnios.map((s) => (
                  <label key={s.key} className="checkline" style={{ cursor: 'pointer' }} title={s.fuente === 'ms' ? 'Consumo mensual de Farmacia MS' : 'Análisis Trimestral (Farmacia MS no tiene ese semestre completo)'}>
                    <input type="checkbox" checked={!aniosOcultosVto.includes(s.anio)} onChange={() => cambiarAniosOcultosVto(aniosOcultosVto.includes(s.anio) ? aniosOcultosVto.filter((x) => x !== s.anio) : [...aniosOcultosVto, s.anio])} />
                    {s.anio} <span style={{ color: '#5b6b76', fontSize: 12 }}>({s.detalle})</span>
                  </label>
                ))}
                <div style={{ width: '100%', color: '#5b6b76', fontSize: 13 }}>
                  <b>De dónde sale el consumo:</b> desde oct 2025, del consumo mensual de <b>Farmacia MS</b> («completo» o los meses que tenga). Antes, del <b>Análisis Trimestral</b> («trimestral T1+T2»: 2025 sale de CODIGOSTODOS.xlsx; el T3 2025 solo de «Dispensación anterior 2025», por eso el 2do sem 2025 puede quedar bajo).
                  {' '}<b>En curso</b> = lo real de los meses cerrados en Farmacia MS + el pronóstico de los que faltan. La columna <b>Requerimientos</b> dice en qué requerimiento se pidió cada código.
                </div>
              </div>
            ) : null}
            <section className="filters">
              <select value={farmacoVto} onChange={(event) => setFarmacoVto(event.target.value)} title="Filtrar por fármaco">
                <option value="">Todos los fármacos ({farmacosVto.length})</option>
                {farmacosVto.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={reqFiltro} onChange={(event) => setReqFiltro(event.target.value)} title="Filtrar por requerimiento">
                <option value="">Todos los requerimientos</option>
                {importaciones.map((imp) => (
                  <option key={imp.id} value={imp.id}>{imp.numero}/{imp.anio_numero} · {imp.archivo_nombre}</option>
                ))}
              </select>
              {farmacoVto || reqFiltro ? <button type="button" className="ghost small" onClick={() => { setFarmacoVto(''); setReqFiltro(''); }}>Limpiar filtros</button> : null}
            </section>
            <ExportButton targetId="tabla-req-consumo-vto" name="consumo-pedido-vencimientos" />
            <section className="table-wrap">
              <table id="tabla-req-consumo-vto" className="compact">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Producto</th>
                    {semestresVto.map((s) => (
                      <th key={s.key} style={{ textAlign: 'right' }}>
                        Consumo {s.label}
                        <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>{s.detalle}</div>
                      </th>
                    ))}
                    <th style={{ textAlign: 'right', background: '#f6f2fb' }} title="Mismo semestre del año anterior al que está en curso">
                      Consumo {nombreSem(idxIniAnt)}
                      <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>año anterior{partesAnt.length ? ` · ${partesAnt.map((x) => x.texto).join(' + ')}` : ' · sin datos'}</div>
                    </th>
                    <th style={{ textAlign: 'right', background: '#f6f2fb' }} title="Semestre en curso: lo real de los meses cerrados (Farmacia MS) más el pronóstico de los meses que faltan">
                      Consumo {nombreSem(idxIniCurso)} en curso
                      <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>estimado: real {rango(cursoReales) || '-'} + est. {rango(cursoEstimados) || '-'}</div>
                    </th>
                    <th style={{ textAlign: 'right', background: '#eefaf2' }}>
                      Stock actual
                      <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>{cruce.descarga ? `al ${fmtFechaAr(cruce.descarga.fecha_stock)}` : 'sin descargar'}</div>
                    </th>
                    <th style={{ textAlign: 'right', background: '#fffbea' }} title="Pronóstico mes a mes: nivel suavizado × índice estacional del mismo mes del año anterior. Pasá el mouse sobre cada número para ver el cálculo">
                      Consumo estimado hasta el inicio
                      <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>{Math.max(0, idxIniCiclo - idxHoy - 1)} meses</div>
                    </th>
                    <th style={{ textAlign: 'right', background: '#eefaf2' }} title="Stock actual menos lo que vence y lo que se consume antes de que arranque el ciclo">Stock estimado al inicio del ciclo</th>
                    <th style={{ textAlign: 'right', background: '#fdf0f0' }} title="Stock que vence durante el ciclo antes de poder consumirse (al ritmo del promedio mensual)">Vence sin usarse en el ciclo</th>
                    <th style={{ textAlign: 'right', background: '#eef4fb' }} title="Suma del pronóstico mensual de los 6 meses del ciclo, con estacionalidad">Consumo estimado del ciclo</th>
                    <th style={{ textAlign: 'right', background: '#eef4fb' }}>Pedido {nombreCiclo}</th>
                    <th style={{ textAlign: 'right', background: '#eef4fb' }}>Se pisa con el pedido</th>
                    <th>Requerimientos</th>
                    {verVencimientos ? (
                      <>
                        <th style={{ textAlign: 'center', background: '#fff3e6' }} title="Tocá el botón para ver cuánto vence cada mes">
                          Vencimientos
                          <div style={{ fontWeight: 400, fontSize: 12, color: '#5b6b76' }}>vence hasta {etiquetaMes(idxFinCiclo)}</div>
                        </th>
                        <th style={{ textAlign: 'right', background: '#fff3e6' }}>Total que vence antes del ciclo</th>
                        {/* Columnas ocultas en pantalla: solo salen en el Excel */}
                        <th className="solo-excel">Ya vencido</th>
                        {mesesVto.map((idx) => <th key={idx} className="solo-excel">Vence {etiquetaMes(idx)}</th>)}
                        <th className="solo-excel">Vence después de {etiquetaMes(idxFinCiclo)}</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {filasVto.map((f) => {
                    const meses = f.enlace.codigo ? mesesFam(f.enlace.codigo) : null;
                    const stock = stockDeFila(f);
                    const lotes = lotesFam(f.g.codigo) || (f.enlace.codigo ? lotesFam(f.enlace.codigo) : null) || [];
                    const porMes = new Map();
                    let vencido = 0;
                    let despues = 0;
                    for (const l of lotes) {
                      const cant = Number(l.stock || 0);
                      const idx = l.vencimiento ? Number(l.vencimiento.slice(0, 4)) * 12 + Number(l.vencimiento.slice(5, 7)) - 1 : null;
                      if (idx == null || idx > mesesVto[mesesVto.length - 1]) despues += cant;
                      else if (l.dias < 0) vencido += cant;
                      else porMes.set(idx, (porMes.get(idx) || 0) + cant);
                    }
                    // Stock sin lote en la descarga: se toma como que vence despues
                    const listado = lotes.reduce((a, l) => a + Number(l.stock || 0), 0);
                    if (stock != null && stock > listado) despues += stock - listado;
                    const antesCiclo = vencido + mesesVto.filter((idx) => idx < idxIniCiclo).reduce((a, idx) => a + (porMes.get(idx) || 0), 0);
                    // Stock al inicio del ciclo: mes a mes se consume el promedio mensual usando primero los lotes
                    // que vencen antes, y lo que vence sin consumirse se pierde
                    // Pronostico estadistico mes a mes (antes y durante el ciclo)
                    const mesesAntes = [];
                    for (let m = idxHoy + 1; m < idxIniCiclo; m += 1) mesesAntes.push(m);
                    const mesesCiclo = [];
                    for (let m = idxIniCiclo; m <= idxFinCiclo; m += 1) mesesCiclo.push(m);
                    const prono = pronosticoConsumo(meses, consumoAnalisis.cerrados, [...mesesAntes, ...mesesCiclo]);
                    const consumoHasta = Math.round(mesesAntes.reduce((a, m) => a + prono.porMes.get(m), 0));
                    const consumoCiclo = Math.round(mesesCiclo.reduce((a, m) => a + prono.porMes.get(m), 0));
                    const margen = (k) => Math.round(1.28 * prono.sd * Math.sqrt(k));
                    const detalleProno = [
                      prono.intermitente
                        ? `Consumo intermitente (más del 30 % de los meses en cero): se usa la tasa media de ${prono.n} meses, ${fmtCantidad(Math.round(prono.nivel))} por mes, sin estacionalidad`
                        : `Nivel mensual (suavizado exponencial, ${prono.n} meses): ${fmtCantidad(Math.round(prono.nivel))}`,
                      `Coeficiente de variación: ${Math.round((prono.cv || 0) * 100)} %`,
                      ...[...mesesAntes, ...mesesCiclo].map((m) => `${etiquetaMes(m)}: ${fmtCantidad(Math.round(prono.porMes.get(m)))} (índice estacional ${prono.indices.get(m).toFixed(2)})`),
                      `Desvío mensual de los residuos: ${fmtCantidad(Math.round(prono.sd))}`,
                      prono.recortados ? `${prono.recortados} mes(es) con pico atípico recortado (Q3 + 1,5×IQR)` : 'Sin meses atípicos'
                    ].join('\n');
                    let vigente = null;
                    let perdidoCiclo = 0;
                    if (stock != null) {
                      const pilas = Array.from(porMes.entries()).sort((x, y) => x[0] - y[0]).map(([idx, cant]) => ({ idx, cant }));
                      pilas.push({ idx: Infinity, cant: despues });
                      for (const pl of pilas) if (pl.idx <= idxHoy) pl.cant = 0;
                      for (let m = idxHoy + 1; m < idxIniCiclo; m += 1) {
                        let resta = prono.porMes.get(m);
                        for (const pl of pilas) {
                          if (resta <= 0) break;
                          const usa = Math.min(pl.cant, resta);
                          pl.cant -= usa;
                          resta -= usa;
                        }
                        for (const pl of pilas) if (pl.idx <= m) pl.cant = 0;
                      }
                      vigente = Math.round(pilas.reduce((a, pl) => a + pl.cant, 0));
                      // Dentro del ciclo: lo que vence antes de poder consumirse se pierde y no cubre el pedido
                      for (let m = idxIniCiclo; m <= idxFinCiclo; m += 1) {
                        let resta = prono.porMes.get(m);
                        for (const pl of pilas) {
                          if (resta <= 0) break;
                          const usa = Math.min(pl.cant, resta);
                          pl.cant -= usa;
                          resta -= usa;
                        }
                        for (const pl of pilas) if (pl.idx <= m) { perdidoCiclo += pl.cant; pl.cant = 0; }
                      }
                      perdidoCiclo = Math.round(perdidoCiclo);
                    }
                    const pisa = vigente == null ? null : Math.min(Math.max(0, vigente - perdidoCiclo), Number(f.g.cantidad));
                    const celda = (v, color) => (v ? <span style={{ fontWeight: 700, color }}>{fmtCantidad(v)}</span> : <span style={{ color: '#c3ccd3' }}>-</span>);
                    const totalHastaFin = vencido + mesesVto.reduce((a, idx) => a + (porMes.get(idx) || 0), 0);
                    const mesesConVto = mesesVto.filter((idx) => porMes.get(idx));
                    const vtoAbierto = vtoAbiertos.has(f.g.clave);
                    return (
                      <React.Fragment key={f.g.clave}>
                      <tr style={estiloUnion(f)}>
                        <td className="code">
                          {f.g.codigo}
                          <MarcaUnion f={f} />
                          {f.enlace.via === 'vinculo' ? <div className="status listo" style={{ fontSize: 11, marginTop: 2 }} title="Emparejado a mano: consumo, stock y pronóstico salen de este código">atado a {f.enlace.codigo}</div> : null}
                          {f.enlace.via === 'nombre' ? <div style={{ fontSize: 11, color: '#5b6b76' }} title="Mismo producto con otro código en Farmacia MS">consumo de {f.enlace.codigo}</div> : null}
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{f.g.droga}</div>
                          <div style={{ fontSize: 13, color: '#5b6b76' }}>{f.g.descripcion}</div>
                        </td>
                        {semestresVto.map((s) => {
                          if (s.fuente === 'trim') {
                            const cant = trimFam(s.trim.porCodigo, f.g.codigo) ?? (f.enlace.codigo ? trimFam(s.trim.porCodigo, f.enlace.codigo) : undefined);
                            return (
                              <td key={s.key} style={{ textAlign: 'right' }}>
                                {cant == null ? <span style={{ color: '#c3ccd3' }} title="No figura en el Análisis Trimestral">-</span> : fmtCantidad(Math.round(cant))}
                                {cant != null && s.meses < 6 ? <div style={{ color: '#5b6b76', fontSize: 12 }}>proy. {fmtCantidad(Math.round((cant / s.meses) * 6))}</div> : null}
                              </td>
                            );
                          }
                          const real = meses ? s.ms.idxs.reduce((a, idx) => a + (meses[idx] || 0), 0) : null;
                          return (
                            <td key={s.key} style={{ textAlign: 'right' }}>
                              {real == null ? <MarcaConsumo enlace={f.enlace} /> : fmtCantidad(Math.round(real))}
                              {real != null && s.meses < 6 ? <div style={{ color: '#5b6b76', fontSize: 12 }}>proy. {fmtCantidad(Math.round((real / s.meses) * 6))}</div> : null}
                            </td>
                          );
                        })}
                        {(() => {
                          let total = 0;
                          let hay = false;
                          for (const parte of partesAnt) {
                            if (parte.tipo === 'ms') {
                              if (meses) { hay = true; total += parte.idxs.reduce((a, idx) => a + (meses[idx] || 0), 0); }
                            } else {
                              const cant = parte.mapa.get(f.g.codigo) ?? (f.enlace.codigo ? parte.mapa.get(f.enlace.codigo) : undefined);
                              if (cant != null) { hay = true; total += cant; }
                            }
                          }
                          return (
                            <td style={{ textAlign: 'right', background: '#fbf9fd' }}>
                              {hay ? fmtCantidad(Math.round(total)) : <span style={{ color: '#c3ccd3' }}>-</span>}
                            </td>
                          );
                        })()}
                        {(() => {
                          if (!meses) return <td style={{ textAlign: 'right', background: '#fbf9fd' }}><MarcaConsumo enlace={f.enlace} /></td>;
                          const real = cursoReales.reduce((a, idx) => a + (meses[idx] || 0), 0);
                          const pronoCurso = pronosticoConsumo(meses, consumoAnalisis.cerrados, cursoEstimados);
                          const est = cursoEstimados.reduce((a, idx) => a + pronoCurso.porMes.get(idx), 0);
                          return (
                            <td style={{ textAlign: 'right', background: '#fbf9fd' }} title={`Real ${rango(cursoReales)}: ${fmtCantidad(Math.round(real))}\nEstimado ${rango(cursoEstimados)}: ${fmtCantidad(Math.round(est))}`}>
                              <b>{fmtCantidad(Math.round(real + est))}</b>
                              <div style={{ fontSize: 12, color: '#5b6b76', whiteSpace: 'nowrap' }}>real {fmtCantidad(Math.round(real))} + est. {fmtCantidad(Math.round(est))}</div>
                            </td>
                          );
                        })()}
                        <td style={{ textAlign: 'right', fontWeight: 700, background: '#f4fbf6' }}>
                          {stock == null ? <span style={{ color: '#5b6b76', fontWeight: 400 }}>no figura</span> : fmtCantidad(stock)}
                        </td>
                        <td style={{ textAlign: 'right', background: '#fffbea', cursor: f.enConsumo ? 'help' : undefined }} title={f.enConsumo ? detalleProno : undefined}>
                          {f.enConsumo ? (
                            <>
                              <b>{fmtCantidad(consumoHasta)}</b>
                              <div style={{ fontSize: 12, color: '#5b6b76', whiteSpace: 'nowrap' }}>{mesesAntes.map((m) => `${MESES_CORTOS[m % 12].toLowerCase()} ${fmtCantidad(Math.round(prono.porMes.get(m)))}`).join(' · ')}</div>
                              {prono.sd ? <div style={{ fontSize: 12, color: '#5b6b76', whiteSpace: 'nowrap' }}>rango {fmtCantidad(Math.max(0, consumoHasta - margen(mesesAntes.length)))}–{fmtCantidad(consumoHasta + margen(mesesAntes.length))}</div> : null}
                            </>
                          ) : <MarcaConsumo enlace={f.enlace} />}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, background: '#f4fbf6' }}>{vigente == null ? '-' : fmtCantidad(vigente)}</td>
                        <td style={{ textAlign: 'right', background: '#fdf0f0' }}>{celda(perdidoCiclo, '#9d1c1c')}</td>
                        <td style={{ textAlign: 'right', background: '#f5f9fd', cursor: f.enConsumo ? 'help' : undefined }} title={f.enConsumo ? detalleProno : undefined}>
                          {f.enConsumo ? (
                            <>
                              <b>{fmtCantidad(consumoCiclo)}</b>
                              {prono.sd ? <div style={{ fontSize: 12, color: '#5b6b76', whiteSpace: 'nowrap' }}>rango {fmtCantidad(Math.max(0, consumoCiclo - margen(6)))}–{fmtCantidad(consumoCiclo + margen(6))}</div> : null}
                            </>
                          ) : <MarcaConsumo enlace={f.enlace} />}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, background: '#f5f9fd' }}>{fmtCantidad(f.g.cantidad)}</td>
                        <td style={{ textAlign: 'right', background: '#f5f9fd' }}>
                          {pisa ? (
                            <>
                              <b style={{ color: pisa >= Number(f.g.cantidad) ? '#9d1c1c' : '#7b5600' }}>{fmtCantidad(pisa)}</b>
                              <div style={{ fontSize: 12, color: '#5b6b76' }}>{Number(f.g.cantidad) ? `${Math.round((pisa / Number(f.g.cantidad)) * 100)}% del pedido` : ''}</div>
                            </>
                          ) : <span style={{ color: '#c3ccd3' }}>-</span>}
                        </td>
                        <td>{f.g.ubicaciones.join(', ')}</td>
                        {verVencimientos ? (
                          <>
                            <td style={{ textAlign: 'center', background: '#fffaf3' }}>
                              {lotes.length || despues ? (
                                <button type="button" className={vtoAbierto ? 'small' : 'ghost small'} onClick={() => alternarVto(f.g.clave)} title={vtoAbierto ? 'Ocultar el detalle por mes' : 'Ver cuánto vence cada mes'} style={{ whiteSpace: 'nowrap' }}>
                                  {vtoAbierto ? '▾' : '▸'} {totalHastaFin ? `${fmtCantidad(totalHastaFin)} vence` : 'Sin vto. cercano'}
                                </button>
                              ) : <span style={{ color: '#c3ccd3' }}>-</span>}
                              {totalHastaFin ? <div style={{ fontSize: 12, color: '#5b6b76', marginTop: 2 }}>{vencido ? `${fmtCantidad(vencido)} ya vencido · ` : ''}{mesesConVto.length} mes{mesesConVto.length === 1 ? '' : 'es'}</div> : null}
                            </td>
                            <td style={{ textAlign: 'right', background: '#fff3e6' }}>{celda(antesCiclo, '#b45309')}</td>
                            <td className="solo-excel">{vencido || ''}</td>
                            {mesesVto.map((idx) => <td key={idx} className="solo-excel">{porMes.get(idx) || ''}</td>)}
                            <td className="solo-excel">{despues || ''}</td>
                          </>
                        ) : null}
                      </tr>
                      {verVencimientos && vtoAbierto ? (
                        <tr className="detail-row">
                          <td colSpan={14 + semestresVto.length}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>Vencimientos de {f.g.codigo} · {f.g.droga}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {[
                                { key: 'vencido', label: 'Ya vencido', v: vencido, fondo: '#fdf0f0', color: '#9d1c1c' },
                                ...mesesVto.map((idx) => ({ key: idx, label: `${etiquetaMes(idx)}${enCiclo(idx) ? ' (ciclo)' : ''}`, v: porMes.get(idx) || 0, fondo: enCiclo(idx) ? '#e7f1fb' : '#fffbea', color: enCiclo(idx) ? '#1d5fa8' : '#b45309' })),
                                { key: 'despues', label: `Después de ${etiquetaMes(idxFinCiclo)}`, v: despues, fondo: '#eefaf2', color: '#176338' }
                              ].map((c) => (
                                <div key={c.key} style={{ background: c.fondo, borderRadius: 6, padding: '6px 10px', minWidth: 90, textAlign: 'center', opacity: c.v ? 1 : 0.55 }}>
                                  <div style={{ fontSize: 12, color: '#5b6b76' }}>{c.label}</div>
                                  <div style={{ fontWeight: 700, fontSize: 16, color: c.v ? c.color : '#9aa7b1' }}>{c.v ? fmtCantidad(c.v) : '-'}</div>
                                </div>
                              ))}
                            </div>
                            {lotes.length ? (
                              <div style={{ fontSize: 12, color: '#5b6b76', marginTop: 6 }}>
                                Lotes: {lotes.slice().sort((x, y) => String(x.vencimiento || '9999').localeCompare(String(y.vencimiento || '9999'))).map((l) => `${l.lote || 's/lote'} vto ${l.vencimiento ? fmtFechaAr(l.vencimiento) : 's/f'}: ${fmtCantidad(Number(l.stock || 0))}`).join(' · ')}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                      </React.Fragment>
                    );
                  })}
                  {!filasVto.length ? <tr><td colSpan={12 + semestresVto.length + (verVencimientos ? 2 : 0)} className="empty">Sin productos</td></tr> : null}
                </tbody>
              </table>
            </section>
          </>
        );
      })() : null}

      {vista === 'diferencias' ? (
        <>
          <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
            Diferencias entre el requerimiento y el historial de O.C. de Drive{historial.importacion ? ` («${historial.importacion.file_nombre}»)` : ''}. Cruce por código y código Sigaf; el semestre sale del vencimiento de la O.C.
          </div>
          <section className="filters">
            <select value={difPeriodo} onChange={(event) => setDifPeriodo(event.target.value)}>
              <option value="todos">O.C. de todos los {semestreDeCiclo(ciclo) === 2 ? '2dos' : '1ros'} semestres</option>
              {periodosOc.map((k) => <option key={k} value={k}>O.C. del {etiquetaPeriodo(k)}</option>)}
            </select>
            <button className={`ghost ${difLado === 'oc_no_req' ? 'active' : ''}`} onClick={() => setDifLado('oc_no_req')}>
              Comprado en {semestreDeCiclo(ciclo) === 2 ? "2dos" : "1ros"} semestres anteriores y NO pedido ({difOcNoReq.length})
            </button>
            <button className={`ghost ${difLado === 'req_no_oc' ? 'active' : ''}`} onClick={() => setDifLado('req_no_oc')}>
              Pedido y no comprado en {semestreDeCiclo(ciclo) === 2 ? "2dos" : "1ros"} semestres anteriores ({difReqNoOc.length})
            </button>
          </section>

          {difLado === 'oc_no_req' ? (
            <>
              <div style={{ color: '#5b6b76', fontSize: 14, margin: '4px 2px' }}>
                Productos comprados en O.C. {difPeriodo === 'todos' ? 'de semestres anteriores' : `del ${etiquetaPeriodo(difPeriodo)}`} que no están pedidos en el {etiquetaCiclo(ciclo)}: ¿faltó pedirlos?
              </div>
              <section className="filters">
                {comSel ? (
                  <FiltroSituacion
                    valor={filtroDifMin}
                    onCambiar={setFiltroDifMin}
                    opciones={Object.entries(FILTROS_DIF_MIN).map(([k, f]) => ({ clave: k, label: f.label, cantidad: difOcNoReqMin.filter(f.pred).length }))}
                  />
                ) : (
                  <span style={{ color: '#5b6b76' }}>No hay comunicación del Ministerio para el {etiquetaCiclo(ciclo)}: no se puede marcar lo que dijo NO.</span>
                )}
              </section>
              <ColumnasPeriodo periodos={periodosOc} ocultos={periodosOcultos} onCambiar={setPeriodosOcultos} />
              <ExportButton targetId="tabla-dif-oc" name="diferencias-en-oc-no-requeridos" />
              <section className="table-wrap">
                <table id="tabla-dif-oc" className="compact">
                  <thead>
                    <tr>
                      <th />
                      <th>Código</th>
                      <th>Descripción en la O.C.</th>
                      <th title="Lo que dijo el Ministerio para el ciclo (por código o, si no coincide, por nombre)">Ministerio</th>
                      {periodosVisibles.map((k) => <th key={k} style={{ textAlign: 'right' }}>Comprado {etiquetaPeriodo(k)}</th>)}
                      <th style={{ textAlign: 'right' }}>Total comprado</th>
                      <th style={{ textAlign: 'right' }}>Veces comprado</th>
                      <th>Última O.C.</th>
                      <th>Último proveedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {difOcNoReqVisibles.flatMap((f) => {
                      const clave = `dif-${f.codigo}`;
                      const out = [(
                        <tr key={f.codigo} style={f.min?.porNombre ? { background: '#fff8e1' } : f.min?.decision === 'no' ? { background: '#ffe3e3' } : undefined}>
                          <td>
                            <button type="button" className="ghost compact" onClick={() => toggle(clave)} title="Ver cada O.C.">
                              {abiertos.has(clave) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                          <td className="code">{f.codigo}</td>
                          <td style={{ fontWeight: 700 }}>{f.descripcion}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {f.min
                              ? f.min.porNombre
                                ? <span className="status iniciado" title={`Misma droga, otro código: ${f.min.codigo} ${f.min.medicamento}`}>
                                    posible · {f.min.codigo} {String(f.min.habilitado || '').toLowerCase() === 'no' ? 'dijo NO' : f.min.habilitado}
                                  </span>
                                : <span className={`status ${f.min.decision === 'no' ? 'error' : f.min.decision === 'comprar' ? 'listo' : 'iniciado'}`} title={`${f.min.codigo} ${f.min.medicamento}`}>
                                    {f.min.habilitado}
                                  </span>
                              : <span style={{ color: '#5b6b76' }}>{comSel ? 'no está en la lista' : '-'}</span>}
                          </td>
                          {periodosVisibles.map((k) => (
                            <td key={k} style={{ textAlign: 'right' }}>{f.porPeriodo[k] ? fmtCantidad(f.porPeriodo[k]) : '-'}</td>
                          ))}
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(f.total)}</td>
                          <td style={{ textAlign: 'right' }}>{f.rows.length}</td>
                          <td className="code">{f.ultima.oc_numero || '-'} <span style={{ color: '#5b6b76', fontWeight: 400 }}>({etiquetaPeriodo(clavePeriodo(f.ultima))})</span></td>
                          <td>{f.ultima.proveedor || '-'}</td>
                        </tr>
                      )];
                      if (abiertos.has(clave)) {
                        out.push(
                          <tr key={`${clave}-det`} className="detail-row">
                            <td colSpan={8 + periodosVisibles.length}>
                              <table className="compact" style={{ minWidth: 0 }}>
                                <thead>
                                  <tr><th>Período</th><th>O.C.</th><th>Proveedor</th><th>Vence</th><th>Renglón</th><th>Descripción en la O.C.</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Entregada</th><th>Completo</th></tr>
                                </thead>
                                <tbody>
                                  {f.rows.map((h) => (
                                    <tr key={h.id}>
                                      <td>{etiquetaPeriodo(clavePeriodo(h))}</td>
                                      <td className="code">{h.oc_numero || '-'}</td>
                                      <td>{h.proveedor || '-'}</td>
                                      <td>{fmtFechaAr(h.vencimiento)}</td>
                                      <td>{h.renglon || '-'}</td>
                                      <td>{h.descripcion}</td>
                                      <td style={{ textAlign: 'right' }}>{h.cantidad == null ? '-' : fmtCantidad(h.cantidad)}</td>
                                      <td style={{ textAlign: 'right' }}>{h.entregada == null ? '-' : fmtCantidad(h.entregada)}</td>
                                      <td>{h.completo || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        );
                      }
                      return out;
                    })}
                    {!difOcNoReqVisibles.length ? <tr><td colSpan={8 + periodosVisibles.length} className="empty">No hay productos en esta categoría</td></tr> : null}
                  </tbody>
                </table>
              </section>
            </>
          ) : (
            <>
              <div style={{ color: '#5b6b76', fontSize: 14, margin: '4px 2px' }}>
                Productos pedidos en el {etiquetaCiclo(ciclo)} que no se compraron {difPeriodo === 'todos' ? 'en ninguna O.C. del historial' : `en las O.C. del ${etiquetaPeriodo(difPeriodo)}`}: nuevos o nunca comprados, para revisar si van.
              </div>
              <section className="filters">
                {comSel ? (
                  <FiltroSituacion
                    valor={filtroDifReq}
                    onCambiar={setFiltroDifReq}
                    opciones={Object.entries(FILTROS_DIF_MIN).map(([k, f]) => ({ clave: k, label: f.label, cantidad: difReqNoOcMin.filter(f.pred).length }))}
                  />
                ) : (
                  <span style={{ color: '#5b6b76' }}>No hay comunicación del Ministerio para el {etiquetaCiclo(ciclo)}: no se puede marcar lo que dijo NO.</span>
                )}
              </section>
              <ExportButton targetId="tabla-dif-req" name="diferencias-requeridos-sin-oc" />
              <section className="table-wrap">
                <table id="tabla-dif-req" className="compact">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Cód. Sigaf</th>
                      <th>Droga</th>
                      <th>Descripción</th>
                      <th title="Lo que dijo el Ministerio para el ciclo (por código o Sigaf; si no coincide, posible por la misma droga)">Ministerio</th>
                      <th>Requerimientos</th>
                      <th style={{ textAlign: 'right' }}>Pedido del ciclo</th>
                      <th style={{ textAlign: 'right' }}>Justiprecio</th>
                      <th>Comprado en otros períodos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {difReqNoOcVisibles.map((f) => (
                      <tr key={f.g.clave} style={f.min?.porNombre ? { background: '#fff8e1' } : f.min?.decision === 'no' ? { background: '#ffe3e3' } : undefined}>
                        <td className="code">{f.g.codigo}</td>
                        <td>{f.g.sigaf}</td>
                        <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                        <td>{f.g.descripcion}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {f.min
                            ? f.min.porNombre
                              ? <span className="status iniciado" title={`Misma droga, otro código: ${f.min.codigo} ${f.min.medicamento}`}>
                                  posible · {f.min.codigo} {String(f.min.habilitado || '').toLowerCase() === 'no' ? 'dijo NO' : f.min.habilitado}
                                </span>
                              : <span className={`status ${f.min.decision === 'no' ? 'error' : f.min.decision === 'comprar' ? 'listo' : 'iniciado'}`} title={`${f.min.codigo} ${f.min.medicamento}`}>
                                  {f.min.habilitado}
                                </span>
                            : <span style={{ color: '#5b6b76' }}>{comSel ? 'no está en la lista' : '-'}</span>}
                        </td>
                        <td>{f.g.ubicaciones.join(', ')}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(f.g.cantidad)}</td>
                        {celdaPrecio(f.g)}
                        <td>
                          {Object.keys(f.porPeriodo).length
                            ? Object.entries(f.porPeriodo).sort().map(([k, v]) => `${etiquetaPeriodo(k)}: ${fmtCantidad(v.cantidad)}`).join(' · ')
                            : <span className="status error">nunca comprado</span>}
                        </td>
                      </tr>
                    ))}
                    {!difReqNoOcVisibles.length ? <tr><td colSpan="9" className="empty">No hay productos en esta categoría</td></tr> : null}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </>
      ) : null}

      {vista === 'ministerio' ? (
        <>
          <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
            <label className={`upload-button script-button${busy ? ' disabled' : ''}`}>
              <Upload size={18} /> Subir PDF del Ministerio
              <input type="file" accept=".pdf,application/pdf" onChange={subirComunicacion} disabled={busy} />
            </label>
            <select value={comSel} onChange={(event) => cargarItemsMinisterio(event.target.value)}>
              {!comunicaciones.length ? <option value="">Todavía no hay comunicaciones cargadas</option> : null}
              {comunicaciones.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.periodo_texto || 'sin período'} · {c.archivo_nombre} · {c.total_items} códigos ({c.comprar} comprar, {c.parcial} parcial, {c.no_comprar} NO)
                </option>
              ))}
            </select>
            {comSel ? <button className="ghost small" onClick={eliminarComunicacion}>Quitar esta comunicación</button> : null}
          </section>

          {comSel ? (
            <>
              <section className="toolbar" style={{ flexWrap: 'wrap', marginTop: 12 }}>
                <button className={`ghost ${minVista === 'cruce' ? 'active' : ''}`} onClick={() => setMinVista('cruce')}>Cruce con lo pedido</button>
                <button className={`ghost ${minVista === 'lista' ? 'active' : ''}`} onClick={() => setMinVista('lista')}>
                  Lista del Ministerio ({minItems.filter((m) => m.decision === 'no').length} dijo NO)
                </button>
              </section>

              {minVista === 'lista' ? (
                <>
                  <div style={{ color: '#5b6b76', fontSize: 14, margin: '8px 2px' }}>
                    Lista completa de la comunicación del Ministerio, tal como viene en el PDF.
                  </div>
                  <section className="filters">
                    <FiltroSituacion
                      valor={filtroLista}
                      onCambiar={setFiltroLista}
                      opciones={Object.entries(FILTROS_LISTA_MIN).map(([k, f]) => ({ clave: k, label: f.label, cantidad: listaMin.filter((x) => f.pred(x.m)).length }))}
                    />
                  </section>
                  <ExportButton targetId="tabla-lista-ministerio" name="lista-ministerio" />
                  <section className="table-wrap">
                    <table id="tabla-lista-ministerio" className="compact">
                      <thead>
                        <tr>
                          <th>Código</th>
                          <th>Medicamento (Ministerio)</th>
                          <th>Habilitado compra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listaMin.filter((x) => FILTROS_LISTA_MIN[filtroLista].pred(x.m)).map(({ m }) => (
                          <tr key={m.id}>
                            <td className="code">{m.codigo}</td>
                            <td style={{ fontWeight: 700 }}>{m.medicamento}</td>
                            <td>
                              <span className={`status ${m.decision === 'no' ? 'error' : m.decision === 'comprar' ? 'listo' : 'iniciado'}`}>{m.habilitado || '-'}</span>
                            </td>
                          </tr>
                        ))}
                        {!listaMin.filter((x) => FILTROS_LISTA_MIN[filtroLista].pred(x.m)).length
                          ? <tr><td colSpan="3" className="empty">Sin códigos en esta categoría</td></tr> : null}
                      </tbody>
                    </table>
                  </section>
                </>
              ) : null}

              {minVista === 'cruce' ? (<>
              <section className="summary-grid">
                <Metric label="Pedidos y el Ministerio dijo NO" value={filasMin.filter(FILTROS_MIN.no.pred).length} />
                <Metric label="$ pedido que dijo NO" value={fmtMillones(filasMin.filter(FILTROS_MIN.no.pred).reduce((a, f) => a + f.g.total, 0))} />
                <Metric label="Pedidos: comprar por 3 meses" value={filasMin.filter(FILTROS_MIN.parcial.pred).length} />
                <Metric label="$ sugerido por 3 meses" value={formatPesos(filasMin.filter(FILTROS_MIN.parcial.pred).reduce((a, f) => a + (montoSugeridoMin(f) || 0), 0))} />
                <Metric label="Pedidos habilitados" value={filasMin.filter(FILTROS_MIN.comprar.pred).length} />
                <Metric label="Posible mismo producto (por nombre)" value={filasMin.filter(FILTROS_MIN.nombre.pred).length} />
                <Metric label="Pedidos fuera de la lista" value={filasMin.filter(FILTROS_MIN.no_en_lista.pred).length} />
              </section>
              <section className="filters">
                <FiltroSituacion
                  valor={filtroMin}
                  onCambiar={setFiltroMin}
                  opciones={Object.entries(FILTROS_MIN).map(([k, f]) => ({
                    clave: k,
                    label: f.label,
                    cantidad: k === 'habilitado_no_pedido' ? minNoPedidos.length : filasMin.filter(f.pred).length
                  }))}
                />
              </section>
              <ExportButton targetId="tabla-req-ministerio" name="requerimiento-vs-ministerio" />
              <section className="table-wrap">
                <table id="tabla-req-ministerio" className="compact">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Droga</th>
                      <th>Descripción (requerimiento)</th>
                      <th>Requerimientos</th>
                      <th style={{ textAlign: 'right' }}>Pedido</th>
                      <th style={{ textAlign: 'right' }}>Total $</th>
                      <th>Medicamento (Ministerio)</th>
                      <th>Habilitado compra</th>
                      <th style={{ textAlign: 'right' }} title="Para «comprar por 3 meses»: la mitad de lo pedido para el semestre">Sugerido</th>
                      <th style={{ textAlign: 'right' }} title="Sugerido por el justiprecio del requerimiento">Monto sugerido</th>
                      <th>Situación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtroMin === 'habilitado_no_pedido'
                      ? minNoPedidos.map((m) => (
                        <tr key={m.id}>
                          <td className="code">{m.codigo}</td>
                          <td>-</td>
                          <td>-</td>
                          <td>-</td>
                          <td style={{ textAlign: 'right' }}>-</td>
                          <td style={{ textAlign: 'right' }}>-</td>
                          <td style={{ fontWeight: 700 }}>{m.medicamento}</td>
                          <td>{m.habilitado}</td>
                          <td style={{ textAlign: 'right' }}>-</td>
                          <td style={{ textAlign: 'right' }}>-</td>
                          <td><span className="status iniciado">habilitado y no pedido</span></td>
                        </tr>
                      ))
                      : filasMin.filter(FILTROS_MIN[filtroMin].pred).map((f) => (
                        <tr key={f.g.clave}>
                          <td className="code">{f.g.codigo}</td>
                          <td style={{ fontWeight: 700 }}>{f.g.droga}</td>
                          <td>{f.g.descripcion}</td>
                          <td>{f.g.ubicaciones.join(', ')}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(f.g.cantidad)}</td>
                          <td style={{ textAlign: 'right' }}>{formatPesos(f.g.total)}</td>
                          <td>
                            {f.m?.medicamento
                              || (f.mNombre
                                ? <><span className="code">{f.mNombre.codigo}</span> {f.mNombre.medicamento} <span style={{ color: '#9d1c1c', fontSize: 12 }}>(otro código, por nombre)</span></>
                                : <span style={{ color: '#5b6b76' }}>no está en la lista</span>)}
                          </td>
                          <td>{f.m?.habilitado || f.mNombre?.habilitado || '-'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{sugeridoMin(f) == null ? '-' : fmtCantidad(sugeridoMin(f))}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{montoSugeridoMin(f) == null ? '-' : formatPesos(montoSugeridoMin(f))}</td>
                          <td>
                            <span className={`status ${SITUACION_MIN[f.situacion].clase}`} style={{ cursor: 'pointer' }} title="Tocá para filtrar por esta situación (otra vez para ver todos)" onClick={() => {
                              const k = f.situacion === 'otro' ? 'parcial' : f.situacion;
                              setFiltroMin((cur) => (cur === k ? 'todos' : k));
                            }}>
                              {f.situacion === 'parcial' && f.m?.habilitado
                                ? f.m.habilitado.toLowerCase()
                                : f.situacion === 'nombre' ? `${SITUACION_MIN.nombre.label} · ${String(f.mNombre.habilitado || '').toLowerCase() === 'no' ? 'dijo NO' : String(f.mNombre.habilitado || '').toLowerCase()}` : SITUACION_MIN[f.situacion].label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    {(filtroMin === 'habilitado_no_pedido' ? !minNoPedidos.length : !filasMin.filter(FILTROS_MIN[filtroMin].pred).length)
                      ? <tr><td colSpan="11" className="empty">Sin productos en esta categoría</td></tr> : null}
                  </tbody>
                </table>
              </section>
              </>) : null}
            </>
          ) : (
            <div className="notice">No hay comunicación del Ministerio para el {etiquetaCiclo(ciclo)}. Subí el PDF (tabla CÓDIGO / MEDICAMENTO / HABILITADO COMPRA) o elegí otra comunicación en la lista.</div>
          )}
        </>
      ) : null}

      {vista === 'correcciones' ? (
        <>
          <div className="notice" style={{ marginBottom: 8 }}>
            Requerido del {cortoCiclo(ciclo)} corregido a mano. El PDF del Ministerio no se modifica: acá está el valor original y el corregido.
            Para corregir, en «Por código» hacé clic en el número de la columna «Requerido».
          </div>
          <h3 style={{ margin: '10px 0 6px' }}>Correcciones vigentes ({ajustes.length})</h3>
          <ExportButton targetId="tabla-req-correcciones" name={`correcciones-requerimiento-${ciclo}`} />
          <section className="table-wrap">
            <table id="tabla-req-correcciones" className="compact">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'right' }} title="Lo que dice el PDF hoy">Original (PDF)</th>
                  <th style={{ textAlign: 'right' }} title="El valor que rige">Corregido</th>
                  <th style={{ textAlign: 'right' }} title="Corregido menos original">Diferencia</th>
                  <th>Motivo</th>
                  <th>Corregido por</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {ajustes.map((a) => {
                  const g = porCodigo.find((x) => x.codigo === a.codigo);
                  const pdfHoy = g ? g.cantidad : null;
                  const dif = pdfHoy == null ? null : a.cantidad - pdfHoy;
                  return (
                    <tr key={a.id}>
                      <td className="code">{a.codigo}</td>
                      <td style={{ fontWeight: 700 }}>{g?.droga || '—'}</td>
                      <td>{g?.descripcion || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {pdfHoy == null ? '—' : fmtCantidad(pdfHoy)}
                        {pdfHoy != null && Number(a.cantidad_original) !== Number(pdfHoy) ? <div style={{ fontSize: 11, color: '#b42318' }}>⚠ al corregir decía {fmtCantidad(a.cantidad_original)}</div> : null}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(a.cantidad)}</td>
                      <td style={{ textAlign: 'right', color: dif < 0 ? '#b42318' : dif > 0 ? '#1f7a3a' : undefined }}>{dif == null ? '—' : `${dif > 0 ? '+' : ''}${fmtCantidad(dif)}`}</td>
                      <td>{a.motivo || ''}</td>
                      <td>{a.usuario_nombre || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtFechaHoraAr(a.updated_at)}</td>
                    </tr>
                  );
                })}
                {!ajustes.length ? <tr><td colSpan={9} className="empty">Todavía no hay correcciones para el {cortoCiclo(ciclo)}.</td></tr> : null}
              </tbody>
            </table>
          </section>
          <h3 style={{ margin: '16px 0 6px' }}>Historial de cambios ({histAjustes.length})</h3>
          <ExportButton targetId="tabla-req-correcciones-hist" name={`historial-correcciones-${ciclo}`} />
          <section className="table-wrap">
            <table id="tabla-req-correcciones-hist" className="compact">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Código</th>
                  <th>Droga</th>
                  <th>Qué se hizo</th>
                  <th style={{ textAlign: 'right' }} title="Lo que decía el PDF en ese momento">Original (PDF)</th>
                  <th style={{ textAlign: 'right' }}>Valor anterior</th>
                  <th style={{ textAlign: 'right' }}>Valor nuevo</th>
                  <th>Motivo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {histAjustes.map((h) => (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtFechaHoraAr(h.created_at)}</td>
                    <td className="code">{h.codigo}</td>
                    <td>{porCodigo.find((x) => x.codigo === h.codigo)?.droga || '—'}</td>
                    <td>{h.accion === 'volver' ? 'Volvió al valor del PDF' : 'Corrigió'}</td>
                    <td style={{ textAlign: 'right' }}>{h.cantidad_original == null ? '—' : fmtCantidad(h.cantidad_original)}</td>
                    <td style={{ textAlign: 'right' }}>{h.valor_anterior == null ? '—' : fmtCantidad(h.valor_anterior)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{h.valor_nuevo == null ? '—' : fmtCantidad(h.valor_nuevo)}</td>
                    <td>{h.motivo || ''}</td>
                    <td>{h.usuario_nombre || '—'}</td>
                  </tr>
                ))}
                {!histAjustes.length ? <tr><td colSpan={9} className="empty">Sin cambios todavía.</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {vista === 'requerimientos' ? (
        <>
          <ExportButton targetId="tabla-req-cabeceras" name="requerimientos" />
          <section className="table-wrap">
            <table id="tabla-req-cabeceras" className="compact">
              <thead>
                <tr>
                  <th>Ciclo</th>
                  <th>Nro.</th>
                  <th>Archivo</th>
                  <th>Fecha</th>
                  <th>Período</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Ítems</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Alertas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...importacionesTodas].sort((a, b) => cicloDe(b.periodo_desde).localeCompare(cicloDe(a.periodo_desde))).map((imp) => (
                  <tr key={imp.id} style={cicloDe(imp.periodo_desde) === ciclo ? undefined : { color: '#8a96a0' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`status ${cicloDe(imp.periodo_desde) === ciclo ? 'cargado' : ''}`} style={{ cursor: 'pointer' }} title="Ver este ciclo" onClick={() => elegirCiclo(cicloDe(imp.periodo_desde))}>
                        {etiquetaCiclo(cicloDe(imp.periodo_desde))}
                      </span>
                    </td>
                    <td className="code">{imp.numero}/{imp.anio_numero}</td>
                    <td>{imp.archivo_nombre}</td>
                    <td>{fmtFechaAr(imp.fecha)}</td>
                    <td>{fmtFechaAr(imp.periodo_desde)} al {fmtFechaAr(imp.periodo_hasta)}</td>
                    <td>{imp.tipo_contratacion}</td>
                    <td>{imp.estado}</td>
                    <td style={{ textAlign: 'right' }}>{imp.total_items}</td>
                    <td style={{ textAlign: 'right' }}>{formatPesos(imp.total_calculado)}</td>
                    <td>{(alertasReq.get(imp.id) || []).map((a) => <span key={a} className="status error" style={{ marginRight: 4 }}>{a}</span>)}</td>
                    <td><button type="button" className="ghost small" onClick={() => eliminar(imp)}>Quitar</button></td>
                  </tr>
                ))}
                {!importacionesTodas.length ? <tr><td colSpan="11" className="empty">Todavía no hay requerimientos importados</td></tr> : null}
              </tbody>
            </table>
          </section>

          <section className="table-wrap">
            <table className="compact" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>PDF en la carpeta</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {source.data.map((f) => (
                  <tr key={f.name}>
                    <td>{f.name}</td>
                    <td>
                      {f.duplicadoDe
                        ? <span className="status error">duplicado · mismo contenido que «{f.duplicadoDe}»</span>
                        : f.importacionId
                          ? <span className="status cargado">en tabla · requerimiento {f.numero}</span>
                          : f.omitido
                            ? <span className="status error">no cargado · {f.omitido}</span>
                            : <span className="status listo">detectado · se importa en el próximo control</span>}
                    </td>
                  </tr>
                ))}
                {!source.data.length ? <tr><td colSpan="2" className="empty">No hay PDF en la carpeta</td></tr> : null}
              </tbody>
            </table>
          </section>
          {duplicados.length ? (
            <div style={{ color: '#5b6b76', fontSize: 14, margin: '6px 2px' }}>Los PDF duplicados no se cargan dos veces.</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const ESTADOS_DESCARGA = {
  en_proceso: { clase: 'iniciado', texto: 'en proceso' },
  ok: { clase: 'finalizado', texto: 'completa' },
  error: { clase: 'error', texto: 'error' }
};

function StockActualPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [data, setData] = useState({ dir: '', sectores: [], enCurso: null, descargas: [], descargaId: null, items: [] });
  const [descargaSel, setDescargaSel] = useState('');
  const [sector, setSector] = useState('');
  const [search, setSearch] = useState('');
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh(id = descargaSel) {
    try {
      setData(await client.stockActual(id));
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  // Mientras el robot trabaja se consulta el estado cada 5 segundos
  useEffect(() => {
    if (!data.enCurso) return undefined;
    const timer = setInterval(() => refresh(''), 5000);
    return () => clearInterval(timer);
  }, [data.enCurso]);

  async function elegirCarpeta(ruta) {
    setPicker(false);
    try {
      const r = await client.cambiarCarpetaStockActual(ruta);
      setMessage(`Carpeta cambiada: los próximos Excel se guardan en ${r.dir}.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function descargar() {
    setBusy(true);
    try {
      const r = await client.descargarStockActual();
      setMessage(`Robot iniciado (descarga #${r.descargaId}). Tarda unos minutos: entra a Farmacia MS y baja un Excel por sector.`);
      setDescargaSel('');
      await refresh('');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const ultima = data.descargas[0];
  const sectoresItems = useMemo(() => Array.from(new Set(data.items.map((it) => it.sector))), [data.items]);
  const itemsFiltrados = useMemo(() => {
    const q = textoBusqueda(search.trim());
    return data.items.filter((it) => {
      if (sector && it.sector !== sector) return false;
      if (soloBajoMinimo && !(it.stock_minimo != null && Number(it.stock) < Number(it.stock_minimo))) return false;
      if (!q) return true;
      return textoBusqueda(`${it.codigo} ${it.nombre_generico} ${it.concentracion} ${it.forma}`).includes(q);
    });
  }, [data.items, sector, search, soloBajoMinimo]);
  const bajoMinimo = data.items.filter((it) => it.stock_minimo != null && Number(it.stock) < Number(it.stock_minimo)).length;
  const sinStock = data.items.filter((it) => Number(it.stock) === 0).length;
  const descargaVista = data.descargas.find((d) => d.id === data.descargaId);

  return (
    <div className="req-page">
      <section className="page-title">
        <h2>Stock Actual (Farmacia MS)</h2>
      </section>
      <AyudaPagina id="stockactual" />

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Carpeta de los Excel: {data.dir || 'D:\\FARMACIA\\STOCK ACTUAL'}</span>
        <span style={{ color: '#5b6b76' }}>Sectores: {data.sectores.join(', ')}</span>
        <button className="ghost small" onClick={() => setPicker(true)} disabled={busy || Boolean(data.enCurso)}><Folder size={15} /> Elegir carpeta</button>
        <button className="script-button" onClick={descargar} disabled={busy || Boolean(data.enCurso)}>
          <Download size={18} /> {data.enCurso ? 'Descargando…' : 'Descargar stock ahora'}
        </button>
        <button className="ghost small" onClick={() => refresh()} disabled={busy}><RefreshCw size={15} /> Actualizar</button>
      </section>

      {message ? <div className="notice">{message}</div> : null}
      {picker ? (
        <FolderPicker
          client={client}
          inicial={data.dir}
          titulo="Carpeta donde guardar los Excel de stock"
          contarPdfs={false}
          onElegir={elegirCarpeta}
          onCerrar={() => setPicker(false)}
        />
      ) : null}
      {ultima ? (
        <div className={ultima.estado === 'error' ? 'alert' : 'notice'} style={{ marginTop: 8 }}>
          Última descarga #{ultima.id} ({new Date(ultima.started_at).toLocaleString('es-AR', { hour12: false })}):{' '}
          <span className={`status ${ESTADOS_DESCARGA[ultima.estado]?.clase}`}>{ESTADOS_DESCARGA[ultima.estado]?.texto}</span>{' '}
          {ultima.mensaje}
        </div>
      ) : null}

      <section className="summary-grid">
        <Metric label="Stock al día" value={descargaVista?.fecha_stock ? fmtFechaAr(descargaVista.fecha_stock) : '-'} />
        <Metric label="Productos" value={data.items.length} />
        <Metric label="Sectores" value={sectoresItems.length} />
        <Metric label="Bajo el mínimo" value={bajoMinimo} />
        <Metric label="Sin stock" value={sinStock} />
      </section>

      <RepetidosCard repetidos={data.repetidos} onBuscar={(codigo) => { setSector(''); setSearch(codigo); }} />

      <section className="filters">
        <select value={descargaSel} onChange={(event) => { setDescargaSel(event.target.value); refresh(event.target.value); }}>
          <option value="">Última descarga completa</option>
          {data.descargas.filter((d) => d.estado === 'ok').map((d) => (
            <option key={d.id} value={d.id}>#{d.id} · stock al {fmtFechaAr(d.fecha_stock)} · {d.total_items} productos</option>
          ))}
        </select>
        <select value={sector} onChange={(event) => setSector(event.target.value)}>
          <option value="">Todos los sectores</option>
          {sectoresItems.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar código o producto" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <label className="checkline">
          <input type="checkbox" checked={soloBajoMinimo} onChange={(event) => setSoloBajoMinimo(event.target.checked)} /> Solo bajo el mínimo
        </label>
      </section>

      <ExportButton targetId="tabla-stock-actual" name="stock-actual" />
      <section className="table-wrap">
        <table id="tabla-stock-actual" className="compact">
          <thead>
            <tr>
              <th>Sector</th>
              <th>Código</th>
              <th>Producto</th>
              <th>Concentración</th>
              <th>Presentación</th>
              <th>Forma</th>
              <th style={{ textAlign: 'right' }}>Mínimo</th>
              <th style={{ textAlign: 'right' }}>Máximo</th>
              <th style={{ textAlign: 'right' }}>Ingresos</th>
              <th style={{ textAlign: 'right' }}>Egresos</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.map((it) => {
              const bajo = it.stock_minimo != null && Number(it.stock) < Number(it.stock_minimo);
              return (
                <tr key={it.id}>
                  <td>{it.sector}</td>
                  <td className="code">{it.codigo}</td>
                  <td style={{ fontWeight: 700 }}>{it.nombre_generico}</td>
                  <td>{it.concentracion}</td>
                  <td>{it.presentacion}</td>
                  <td>{it.forma}</td>
                  <td style={{ textAlign: 'right' }}>{it.stock_minimo == null ? '-' : fmtCantidad(it.stock_minimo)}</td>
                  <td style={{ textAlign: 'right' }}>{it.stock_maximo == null ? '-' : fmtCantidad(it.stock_maximo)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCantidad(it.cant_ingreso)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCantidad(it.cant_egreso)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {bajo ? <span className="status error" title="Por debajo del stock mínimo">{fmtCantidad(it.stock)}</span> : fmtCantidad(it.stock)}
                  </td>
                </tr>
              );
            })}
            {!itemsFiltrados.length ? (
              <tr><td colSpan="11" className="empty">{data.items.length ? 'Sin resultados' : 'Todavía no hay stock descargado. Tocá «Descargar stock ahora».'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// Card con los farmacos repetidos de la descarga de stock vista y de donde salio cada codigo
// (lo calcula el backend: stockRepetidos.js + stockRepetidosOrigen.js)
const ORIGEN_CLASES = {
  oc: { texto: 'O.C.', clase: 'origen-oc' },
  hospital: { texto: 'Otro hospital', clase: 'origen-hospital' },
  sector: { texto: 'Otro sector', clase: 'origen-sector' },
  donacion: { texto: 'Donación', clase: 'origen-manual' },
  manual: { texto: 'Carga manual', clase: 'origen-manual' },
  'sin-dato': { texto: 'Sin datos', clase: 'origen-sin' }
};

function OrigenCodigo({ origen }) {
  const [verDetalle, setVerDetalle] = useState(false);
  if (!origen) return <span className="origen-sin-texto">—</span>;
  return (
    <div className="origen-codigo">
      {(origen.fuentes?.length ? origen.fuentes : [{ clase: origen.clase, texto: origen.resumen }]).map((f) => (
        <span key={f.texto} className={`origen-chip ${ORIGEN_CLASES[f.clase]?.clase || ''}`}>{f.texto}</span>
      ))}
      {origen.detalle?.length ? (
        <button type="button" className="link-detalle" onClick={() => setVerDetalle(!verDetalle)}>{verDetalle ? 'ocultar ingresos' : 'ver ingresos'}</button>
      ) : null}
      {verDetalle ? <ul className="origen-detalle">{origen.detalle.map((l) => <li key={l}>{l}</li>)}</ul> : null}
    </div>
  );
}

// Renglon del requerimiento: verde = suma codigos unidos; naranja = tiene un gemelo en el stock sin unir
function estiloUnion(f) {
  if (f.sinUnir?.length) return { background: '#fff1dc', boxShadow: 'inset 4px 0 0 #e08a00' };
  if (f.union) return { background: '#eaf7ee', boxShadow: 'inset 4px 0 0 #2e9e5b' };
  return undefined;
}

function MarcaUnion({ f }) {
  if (!f.union && !f.sinUnir?.length) return null;
  return (
    <div style={{ fontFamily: 'inherit', fontWeight: 400, fontSize: 11, marginTop: 3, lineHeight: 1.35, whiteSpace: 'normal', minWidth: 230, maxWidth: 320 }}>
      {f.union ? (
        <div style={{ color: '#176338' }} title={f.union.notas.join(' · ') || 'Unido en Códigos equivalentes'}>
          {f.union.otros.map((o) => (
            <div key={o.codigo} style={{ marginBottom: 2 }}>
              🔗 <b>Suma {o.codigo}</b>{o.desc ? <span style={{ fontFamily: 'inherit' }}> — {o.desc}</span> : null}
              <div style={{ color: '#3d6b50' }}>
                {[o.consumo ? `consumo ${fmtCantidad(o.consumo)}` : 'sin consumo', o.stock != null ? `stock ${fmtCantidad(o.stock)}` : 'sin stock'].join(' · ')}
              </div>
            </div>
          ))}
          <div style={{ color: '#5b6b76' }}>
            {f.union.cuando ? `Unido el ${f.union.cuando}` : 'Unido'} en Códigos equivalentes{f.union.notas.length ? `: ${f.union.notas.join(' · ')}` : ''}
          </div>
        </div>
      ) : null}
      {f.sinUnir?.length ? (
        <div style={{ color: '#8a4300' }} title="Mismo fármaco con otro código en el Stock Actual. Mientras no se una en Códigos equivalentes, su stock y su consumo NO se suman en este renglón.">
          ⚠ <b>Sin unir</b>: {f.sinUnir.map((x) => `${x.codigo} (stock ${fmtCantidad(x.stock)}${x.origen?.fuentes?.[0] ? ` · ${x.origen.fuentes[0].texto}` : ''})`).join(', ')} — no se suma
        </div>
      ) : null}
    </div>
  );
}

function RepetidosCard({ repetidos, onBuscar, inicialAbierta = true, fechaStock = null }) {
  const [abierta, setAbierta] = useState(inicialAbierta);
  const [filtro, setFiltro] = useState('todos'); // todos | sinUnir | lotes
  if (!repetidos) return null;
  const todos = [
    { key: 'identicos', titulo: 'Mismo producto con dos códigos distintos (descripción idéntica)', lista: repetidos.identicos || [] },
    { key: 'probables', titulo: 'Casi seguro el mismo producto, pero escrito distinto', lista: repetidos.probables || [] },
    { key: 'entreSectores', titulo: 'Mismo código en más de un sector', lista: repetidos.entreSectores || [] }
  ];
  const total = todos.reduce((acc, g) => acc + g.lista.length, 0);
  const alertas = todos.reduce((acc, g) => acc + g.lista.filter((x) => x.alertas?.length).length, 0);
  const pasa = (x) => (filtro === 'lotes' ? x.alertas?.length > 0 : filtro === 'sinUnir' ? x.equivalencia === 'pendiente' : true);
  const grupos = todos.map((g) => ({ ...g, lista: g.lista.filter(pasa) }));
  const elegir = (f) => { setFiltro((cur) => (cur === f ? 'todos' : f)); setAbierta(true); };
  const chip = (f, clase, texto, title) => (
    <button
      type="button"
      className={`status ${clase} repetidos-filtro${filtro === f ? ' activo' : ''}`}
      title={`${title}${filtro === f ? ' — click para ver todos' : ' — click para filtrar'}`}
      onClick={() => elegir(f)}
    >{texto}</button>
  );
  const etiquetaFiltro = filtro === 'lotes' ? 'solo los que tienen lotes para revisar' : filtro === 'sinUnir' ? 'solo los que están sin unir' : '';
  return (
    <section className="repetidos-card">
      <header>
        <h3>
          Fármacos repetidos {total ? chip('todos', 'error', total, 'Total de casos de fármacos repetidos') : <span className="status listo">0</span>}
          {repetidos.sinUnir ? chip('sinUnir', 'en_proceso', `${repetidos.sinUnir} sin unir`, 'Mismo fármaco con dos códigos, todavía sin unir en Códigos equivalentes') : null}
          {alertas ? chip('lotes', 'en_proceso', `⚠ ${alertas} lote(s) para revisar`, 'El mismo lote figura con stock en los dos códigos o sectores: puede estar contado dos veces') : null}
          {fechaStock ? <small style={{ fontWeight: 400, color: '#5b6b76' }}>stock al {fmtFechaAr(String(fechaStock).slice(0, 10))}</small> : null}
        </h3>
        <button type="button" className="ghost small" onClick={() => setAbierta(!abierta)}>{abierta ? 'Ocultar' : 'Ver detalle'}</button>
      </header>
      {!total ? <p className="repetidos-vacio">No hay fármacos repetidos en esta descarga.</p> : null}
      {total && abierta ? (
        <div className="repetidos-explica">
          <p>
            <b>¿Qué es esto?</b> En el Stock Actual de Farmacia MS hay fármacos que aparecen <b>más de una vez</b>: el mismo producto
            cargado con dos códigos, o el mismo código en dos sectores. Mientras no se unan, el stock y el consumo quedan
            <b> partidos en dos renglones</b> y el requerimiento puede mostrar faltantes que no existen o pedir de más.
          </p>
          <ul>
            <li><b>{total} repetidos</b>: todos los casos detectados, separados en los 3 grupos de abajo.</li>
            <li><b>Sin unir</b>: mismo fármaco con dos códigos que todavía no se unió (ni se marcó como distinto) en <i>Códigos equivalentes</i>. Hasta que se una, sus datos no se suman.</li>
            <li><b>⚠ Lotes para revisar</b>: el <b>mismo número de lote</b> tiene stock en los dos códigos o sectores. Un lote entra una sola vez, así que probablemente el mismo ingreso se cargó dos veces y el stock está <b>contado doble</b>. Hay que revisarlo y corregirlo en Farmacia MS.</li>
            <li><b>De dónde salió</b>: cruza los Ingresos Detallados de Farmacia MS (tipo de ingreso y origen) con las O.C. cargadas en el sistema, para ver por dónde entró cada código.</li>
          </ul>
          <p className="repetidos-tip">Tocá los chips de arriba (<b>sin unir</b> / <b>lotes para revisar</b>) para filtrar la lista; tocándolos de nuevo se ve todo.</p>
          {repetidos.conIngresos === false ? <p>Todavía no hay Ingresos Detallados bajados: se cargan con la próxima descarga de stock.</p> : null}
          {repetidos.errorOrigen ? <p>No se pudo rastrear el origen: {repetidos.errorOrigen}</p> : null}
        </div>
      ) : null}
      {abierta && total && filtro !== 'todos' ? (
        <p className="repetidos-filtrando">
          Mostrando {etiquetaFiltro} ({grupos.reduce((a, g) => a + g.lista.length, 0)} de {total}).{' '}
          <button type="button" className="link-codigo" style={{ fontFamily: 'inherit' }} onClick={() => setFiltro('todos')}>Ver todos</button>
        </p>
      ) : null}
      {abierta && total ? grupos.map((g, idx) => (g.lista.length ? (
        <div key={g.key} className="repetidos-grupo">
          <h4>{idx + 1}. {g.titulo} <small>({g.lista.length})</small></h4>
          <table className="compact">
            <thead>
              <tr><th>Fármaco</th><th>Sector</th><th>Código</th><th style={{ textAlign: 'right' }}>Stock</th><th>De dónde salió</th></tr>
            </thead>
            <tbody>
              {g.lista.map((grupo) => {
                const claveGrupo = `${g.key}-${grupo.items.map((i) => `${i.sector}-${i.codigo}`).join('-')}`;
                const filas = grupo.items.length + (grupo.alertas?.length ? 1 : 0);
                return (
                  <React.Fragment key={claveGrupo}>
                    {grupo.items.map((it, i) => (
                      <tr key={`${it.sector}-${it.codigo}`} className={i === 0 ? 'grupo-inicio' : ''}>
                        {i === 0 ? (
                          <td rowSpan={filas} className="repetidos-farmaco">
                            {grupo.items.map((x) => (
                              <div key={`${x.sector}-${x.codigo}`}><strong>{x.nombre}</strong> {[x.concentracion, x.presentacion, x.forma].filter(Boolean).join(' · ')}</div>
                            ))}
                            {grupo.equivalencia === 'unido' ? <span className="status listo" title="Ya están unidos en Códigos equivalentes: sus datos se suman">✓ unidos</span> : null}
                            {grupo.equivalencia === 'pendiente' ? <span className="status en_proceso" title="Todavía no están unidos en Códigos equivalentes">sin unir</span> : null}
                            {grupo.equivalencia === 'distinto' ? <span className="status" title="Marcados como productos distintos">marcados distintos</span> : null}
                          </td>
                        ) : null}
                        <td>{it.sector}</td>
                        <td><button type="button" className="link-codigo" title="Ver en la tabla" onClick={() => onBuscar(it.codigo)}>{it.codigo}</button></td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(it.stock)}</td>
                        <td><OrigenCodigo origen={it.origen} /></td>
                      </tr>
                    ))}
                    {grupo.alertas?.length ? (
                      <tr>
                        <td colSpan="4" className="repetidos-alerta">{grupo.alertas.map((a) => <div key={a}>⚠ {a}</div>)}</td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null)) : null}
    </section>
  );
}

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_KEYS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function ConsumoMsPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const anioActual = new Date().getFullYear();
  const [data, setData] = useState({ dir: '', sectores: [], enCurso: null, descargas: [], lotes: [], items: [] });
  const [aniosBajar, setAniosBajar] = useState([anioActual - 1, anioActual]);
  const [anio, setAnio] = useState('');
  const [comparar, setComparar] = useState('');
  const [sector, setSector] = useState('');
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    try {
      const r = await client.consumoMs();
      setData(r);
      const anios = Array.from(new Set(r.lotes.map((l) => l.anio))).sort();
      setAnio((cur) => (cur && anios.includes(Number(cur)) ? cur : String(anios[anios.length - 1] || '')));
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  // Mientras el robot trabaja se consulta el estado cada 5 segundos
  useEffect(() => {
    if (!data.enCurso) return undefined;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [data.enCurso]);

  async function descargar() {
    setBusy(true);
    try {
      const r = await client.descargarConsumoMs(aniosBajar);
      setMessage(`Robot iniciado (descarga #${r.descargaId}, años ${r.anios.join(', ')}). Entra a Farmacia MS y baja un Excel por sector y año.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function elegirCarpeta(ruta) {
    setPicker(false);
    try {
      const r = await client.cambiarCarpetaConsumoMs(ruta);
      setMessage(`Carpeta cambiada: los próximos Excel se guardan en ${r.dir}.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    }
  }

  function toggleAnio(a) {
    setAniosBajar((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a].sort()));
  }

  const ultima = data.descargas[0];
  const aniosDisponibles = Array.from(new Set(data.lotes.map((l) => l.anio))).sort();
  const sectoresItems = Array.from(new Set(data.items.map((it) => it.sector)));

  // Meses con algun consumo en el año elegido (para el promedio mensual)
  const mesesConDatos = (a) => MESES_KEYS.filter((k) => data.items.some((it) => String(it.anio) === String(a) && Number(it[k]) > 0)).length;
  const mesesAnio = mesesConDatos(anio);
  const mesesComparar = comparar ? mesesConDatos(comparar) : 0;

  const q = textoBusqueda(search.trim());
  const filas = useMemo(() => {
    const comp = new Map();
    for (const it of data.items) {
      if (comparar && String(it.anio) === String(comparar)) comp.set(`${it.sector}|${it.codigo}`, it);
    }
    return data.items
      .filter((it) => String(it.anio) === String(anio))
      .filter((it) => !sector || it.sector === sector)
      .filter((it) => !q || textoBusqueda(`${it.codigo} ${it.nombre_generico} ${it.concentracion} ${it.forma}`).includes(q))
      .map((it) => ({ it, c: comp.get(`${it.sector}|${it.codigo}`) || null }))
      .sort((a, b) => String(a.it.nombre_generico).localeCompare(String(b.it.nombre_generico)));
  }, [data.items, anio, comparar, sector, q]);

  return (
    <div className="req-page">
      <section className="page-title">
        <h2>Consumo Mensual (Farmacia MS)</h2>
      </section>
      <AyudaPagina id="consumoms" />

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Carpeta de los Excel: {data.dir || 'D:\\FARMACIA\\CONSUMO MENSUAL'}</span>
        <span style={{ color: '#5b6b76' }}>Sectores: {data.sectores.join(', ')}</span>
        <button className="ghost small" onClick={() => setPicker(true)} disabled={busy || Boolean(data.enCurso)}><Folder size={15} /> Elegir carpeta</button>
      </section>

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Años a bajar:</span>
        {[anioActual - 3, anioActual - 2, anioActual - 1, anioActual].map((a) => (
          <label key={a} className="checkline" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={aniosBajar.includes(a)} onChange={() => toggleAnio(a)} /> {a}
          </label>
        ))}
        <button className="script-button" onClick={descargar} disabled={busy || Boolean(data.enCurso) || !aniosBajar.length}>
          <Download size={18} /> {data.enCurso ? 'Descargando…' : 'Descargar consumo ahora'}
        </button>
        <button className="ghost small" onClick={refresh} disabled={busy}><RefreshCw size={15} /> Actualizar</button>
      </section>

      {message ? <div className="notice">{message}</div> : null}
      {ultima ? (
        <div className={ultima.estado === 'error' ? 'alert' : 'notice'} style={{ marginTop: 8 }}>
          Última descarga #{ultima.id} ({new Date(ultima.started_at).toLocaleString('es-AR', { hour12: false })}, años {ultima.anios}):{' '}
          <span className={`status ${ESTADOS_DESCARGA[ultima.estado]?.clase}`}>{ESTADOS_DESCARGA[ultima.estado]?.texto}</span>{' '}
          {ultima.mensaje}
        </div>
      ) : null}

      {picker ? (
        <FolderPicker
          client={client}
          inicial={data.dir}
          titulo="Carpeta donde guardar los Excel de consumo"
          contarPdfs={false}
          onElegir={elegirCarpeta}
          onCerrar={() => setPicker(false)}
        />
      ) : null}

      <section className="summary-grid">
        <Metric label="Años bajados" value={aniosDisponibles.join(', ') || '-'} />
        <Metric label={`Productos ${anio || ''}`} value={filas.length} />
        <Metric label="Meses con datos" value={anio ? mesesAnio : '-'} />
      </section>

      <section className="filters">
        <select value={anio} onChange={(event) => setAnio(event.target.value)}>
          {!aniosDisponibles.length ? <option value="">Sin datos: bajá el consumo</option> : null}
          {aniosDisponibles.map((a) => <option key={a} value={a}>Año {a}</option>)}
        </select>
        <select value={comparar} onChange={(event) => setComparar(event.target.value)}>
          <option value="">Sin comparar</option>
          {aniosDisponibles.filter((a) => String(a) !== String(anio)).map((a) => <option key={a} value={a}>Comparar con {a}</option>)}
        </select>
        <select value={sector} onChange={(event) => setSector(event.target.value)}>
          <option value="">Todos los sectores</option>
          {sectoresItems.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar código o producto" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </section>

      <ExportButton targetId="tabla-consumo-ms" name={`consumo-mensual-${anio}${comparar ? `-vs-${comparar}` : ''}`} />
      <section className="table-wrap">
        <table id="tabla-consumo-ms" className="compact">
          <thead>
            <tr>
              <th>Sector</th>
              <th>Código</th>
              <th>Producto</th>
              <th>Concentración</th>
              <th>Forma</th>
              {MESES_CORTOS.map((m) => <th key={m} style={{ textAlign: 'right' }}>{m}</th>)}
              <th style={{ textAlign: 'right' }}>Total {anio}</th>
              <th style={{ textAlign: 'right' }} title="Total dividido los meses con datos del año">Promedio mensual</th>
              {comparar ? <th style={{ textAlign: 'right' }}>Total {comparar}</th> : null}
              {comparar ? <th style={{ textAlign: 'right' }} title={`Promedio mensual ${anio} contra ${comparar}`}>Variación prom.</th> : null}
            </tr>
          </thead>
          <tbody>
            {filas.map(({ it, c }) => {
              const prom = mesesAnio ? Number(it.total) / mesesAnio : 0;
              const promComp = c && mesesComparar ? Number(c.total) / mesesComparar : null;
              const variacion = promComp ? Math.round(((prom - promComp) / promComp) * 100) : null;
              return (
                <tr key={it.id}>
                  <td>{/PSICO/i.test(it.sector) ? 'Psicofármacos' : /UNIFICADA/i.test(it.sector) ? 'Unificada' : it.sector}</td>
                  <td className="code">{it.codigo}</td>
                  <td style={{ fontWeight: 700 }}>{it.nombre_generico}</td>
                  <td>{it.concentracion}</td>
                  <td>{[it.presentacion, it.forma].filter(Boolean).join(' ')}</td>
                  {MESES_KEYS.map((k) => <td key={k} style={{ textAlign: 'right' }}>{Number(it[k]) ? fmtCantidad(it[k]) : '-'}</td>)}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(it.total)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCantidad(Math.round(prom))}</td>
                  {comparar ? <td style={{ textAlign: 'right' }}>{c ? fmtCantidad(c.total) : '-'}</td> : null}
                  {comparar ? (
                    <td style={{ textAlign: 'right' }}>
                      {variacion == null ? '-' : <span className={`status ${variacion > 0 ? 'iniciado' : variacion < 0 ? 'cargado' : 'listo'}`}>{variacion > 0 ? '+' : ''}{variacion}%</span>}
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {!filas.length ? (
              <tr><td colSpan={19 + (comparar ? 2 : 0)} className="empty">{data.items.length ? 'Sin resultados' : 'Todavía no hay consumo descargado. Elegí los años y tocá «Descargar consumo ahora».'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// Semaforo de vencimiento por lote: dias que faltan desde hoy
const ESTADOS_VTO = {
  vencido: { label: 'vencido', clase: 'error', fondo: '#ffe3e3' },
  d30: { label: 'vence en 30 días o menos', clase: 'error', fondo: '#fff0e0' },
  d90: { label: 'vence en 31 a 90 días', clase: 'iniciado', fondo: '#fff8e1' },
  mas: { label: 'vence en más de 90 días', clase: 'listo', fondo: undefined }
};

function estadoVencimiento(dias) {
  if (dias == null) return 'mas';
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'd30';
  if (dias <= 90) return 'd90';
  return 'mas';
}

// Robot de pendientes de ingreso por O.C. (Farmacia MS > Articulos Pendientes de Ingreso)
function PendientesMsPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [data, setData] = useState({ enCurso: null, consultas: [], resultados: [], ordenes: [] });
  const [ocs, setOcs] = useState('');
  const [soloFaltantes, setSoloFaltantes] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    try {
      setData(await client.ocPendientesMs());
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  // mientras el robot trabaja se consulta el estado cada 5 segundos
  useEffect(() => {
    if (!data.enCurso) return undefined;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [data.enCurso]);

  async function consultar(payload) {
    setBusy(true);
    setMessage('');
    try {
      const r = await client.consultarPendientesMs(payload);
      setMessage(`Robot iniciado (consulta #${r.consultaId}): ${r.ocs.length} O.C. Tarda unos 3 segundos por O.C. (${Math.max(1, Math.round(r.ocs.length * 3.5 / 60))} min aprox.).`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const ultima = data.consultas[0];
  const texto = search.trim().toLowerCase();
  const resultados = data.resultados
    .map((x) => ({ ...x, faltan: x.renglones.filter((r) => r.faltante > 0) }))
    .filter((x) => !texto || x.oc.includes(texto) || String(x.proveedor || '').toLowerCase().includes(texto)
      || x.renglones.some((r) => String(r.codigo || '').toLowerCase().includes(texto) || String(r.descripcion || '').toLowerCase().includes(texto)))
    .filter((x) => !soloFaltantes || x.faltan.length || !x.encontrada)
    .sort((a, b) => {
      const [na, aa] = a.oc.split('/').map(Number);
      const [nb, ab] = b.oc.split('/').map(Number);
      return aa - ab || na - nb;
    });
  // los contadores se cuentan sobre las O.C. cargadas en la pagina de Ordenes de Compra
  const estadoPagina = new Map(data.ordenes.map((o) => [o.oc, o.estado]));
  const porOc = new Map(data.resultados.map((x) => [x.oc, x]));
  const consultadas = data.ordenes.filter((o) => porOc.has(o.oc)).map((o) => porOc.get(o.oc));
  const conFaltante = consultadas.filter((x) => x.encontrada && x.renglones.some((r) => r.faltante > 0));
  const completasConFaltante = conFaltante.filter((x) => estadoPagina.get(x.oc) === 'COMPLETA');

  return (
    <div className="req-page">
      <section className="page-title">
        <h2>Pendientes de Ingreso (Farmacia MS)</h2>
      </section>
      <AyudaPagina id="pendientesms" />

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>N° de O.C.:</span>
        <input
          style={{ minWidth: 280 }}
          placeholder="Ej: 683/2026, 452/26"
          value={ocs}
          onChange={(event) => setOcs(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && ocs.trim() && !data.enCurso) consultar({ ocs }); }}
        />
        <button className="script-button" onClick={() => consultar({ ocs })} disabled={busy || Boolean(data.enCurso) || !ocs.trim()}>
          <Search size={18} /> {data.enCurso ? 'Consultando…' : 'Consultar'}
        </button>
        <button className="ghost" onClick={() => consultar({ todas: true })} disabled={busy || Boolean(data.enCurso)} title="Todas las O.C. de la página de Órdenes de Compra, completas o no">
          Consultar todas las O.C. cargadas ({data.ordenes.length})
        </button>
        <button className="ghost small" onClick={refresh} disabled={busy}><RefreshCw size={15} /> Actualizar</button>
      </section>

      {message ? <div className="notice">{message}</div> : null}
      {ultima ? (
        <div className={ultima.estado === 'error' ? 'alert' : 'notice'} style={{ marginTop: 8 }}>
          Última consulta #{ultima.id} ({new Date(ultima.started_at).toLocaleString('es-AR', { hour12: false })}):{' '}
          <span className={`status ${ESTADOS_DESCARGA[ultima.estado]?.clase}`}>{ESTADOS_DESCARGA[ultima.estado]?.texto}</span>{' '}
          {ultima.estado === 'en_proceso' ? <strong>{ultima.hechas} de {ultima.total} · </strong> : ''}{ultima.mensaje}
          {ultima.estado === 'en_proceso' ? ' Los números de abajo se van actualizando a medida que avanza.' : ''}
        </div>
      ) : null}

      <section className="summary-grid">
        <Metric label="O.C. cargadas en la página" value={data.ordenes.length} />
        <Metric label="Consultadas en Farmacia MS" value={consultadas.length} />
        <Metric label="Sin consultar" value={data.ordenes.length - consultadas.length} />
        <Metric label="Con artículos pendientes" value={conFaltante.length} />
        <Metric label="Renglones pendientes" value={conFaltante.reduce((a, x) => a + x.renglones.filter((r) => r.faltante > 0).length, 0)} />
        <Metric label="Completas en la página pero con pendientes" value={completasConFaltante.length} />
        <Metric label="No encontradas en Farmacia MS" value={consultadas.filter((x) => !x.encontrada).length} />
      </section>

      <section className="filters">
        <div className="searchbox">
          <Search size={18} />
          <input placeholder="Buscar O.C., proveedor, código o medicamento" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <label className="checkline">
          <input type="checkbox" checked={soloFaltantes} onChange={(event) => setSoloFaltantes(event.target.checked)} />
          Solo O.C. con pendientes (y solo los renglones que faltan)
        </label>
        <span>{resultados.length} O.C.</span>
      </section>

      {resultados.map((x) => {
        const filas = soloFaltantes ? x.faltan : x.renglones;
        return (
          <section className="table-wrap" key={x.oc} style={{ marginTop: 12 }}>
            <div style={{ padding: '10px 12px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong className="code">O.C. {x.oc}</strong>
              <span>{x.proveedor || ''}</span>
              {estadoPagina.has(x.oc)
                ? <span className={`status ${estadoPagina.get(x.oc) === 'COMPLETA' ? 'listo' : 'iniciado'}`} title="Estado en la página de Órdenes de Compra">En la página: {estadoPagina.get(x.oc)}</span>
                : <span className="status" title="Esta O.C. no está cargada en la página de Órdenes de Compra">No cargada en la página</span>}
              {x.encontrada
                ? <span className={`status ${x.faltan.length ? 'error' : 'listo'}`}>{x.faltan.length ? `${x.faltan.length} renglón(es) pendiente(s)` : 'Todo ingresado'}</span>
                : <span className="status error">No encontrada en Farmacia MS</span>}
              <span style={{ color: '#5b6b76', fontSize: 13 }}>
                {x.nroSolicitud ? `Solicitud ${x.nroSolicitud} · ` : ''}consultado el {new Date(x.consultadoAt).toLocaleString('es-AR', { hour12: false })}
              </span>
            </div>
            {x.encontrada && filas.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Renglón</th><th>Código</th><th>Descripción</th>
                    <th style={{ textAlign: 'right' }}>Adjudicada</th><th style={{ textAlign: 'right' }}>Desafectada</th>
                    <th style={{ textAlign: 'right' }}>Ingresada</th><th style={{ textAlign: 'right' }}>Faltante</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r) => (
                    <tr key={r.renglon} className={r.faltante > 0 ? '' : 'oc-ok'}>
                      <td>{r.renglon}</td>
                      <td className="code">{r.codigo}</td>
                      <td>{r.descripcion}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(r.adjudicada)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(r.desafectada)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(r.ingresada)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatNumber(r.faltante)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function VencidosPage({ token }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [data, setData] = useState({ dir: '', sectores: [], enCurso: null, descargas: [], descargaId: null, items: [] });
  const [meses, setMeses] = useState(6);
  const [filtro, setFiltro] = useState('todos');
  const [sector, setSector] = useState('');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    try {
      setData(await client.vencidos());
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!data.enCurso) return undefined;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [data.enCurso]);

  async function descargar() {
    setBusy(true);
    try {
      const r = await client.descargarVencidos(meses);
      setMessage(`Robot iniciado (descarga #${r.descargaId}): lotes que vencen hasta el ${fmtFechaAr(r.hasta)}.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function elegirCarpeta(ruta) {
    setPicker(false);
    try {
      const r = await client.cambiarCarpetaVencidos(ruta);
      setMessage(`Carpeta cambiada: los próximos Excel se guardan en ${r.dir}.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    }
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const lotes = data.items
    .filter((it) => !sector || it.sector === sector)
    .map((it) => {
      const dias = it.vencimiento ? Math.round((new Date(`${it.vencimiento}T00:00:00`) - hoy) / 86400000) : null;
      return { ...it, dias, estado: estadoVencimiento(dias) };
    });
  const filtros = {
    todos: { label: 'Todos', pred: () => true },
    vencido: { label: 'Vencidos', pred: (x) => x.estado === 'vencido' },
    d30: { label: 'Vencen en 30 días o menos', pred: (x) => x.estado === 'd30' },
    d90: { label: 'Vencen en 31 a 90 días', pred: (x) => x.estado === 'd90' },
    mas: { label: 'Vencen en más de 90 días', pred: (x) => x.estado === 'mas' }
  };
  const visibles = lotes.filter(filtros[filtro].pred);
  const unidades = (lista) => lista.reduce((a, x) => a + Number(x.stock || 0), 0);
  const ultima = data.descargas[0];
  const descargaVista = data.descargas.find((d) => d.id === data.descargaId);
  const sectoresItems = Array.from(new Set(data.items.map((it) => it.sector)));

  return (
    <div className="req-page">
      <section className="page-title">
        <h2>Vencimientos (Farmacia MS)</h2>
      </section>
      <AyudaPagina id="vencidos" />

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Carpeta de los Excel: {data.dir || 'D:\\FARMACIA\\VENCIDOS'}</span>
        <span style={{ color: '#5b6b76' }}>Sectores: {data.sectores.join(', ')}</span>
        <button className="ghost small" onClick={() => setPicker(true)} disabled={busy || Boolean(data.enCurso)}><Folder size={15} /> Elegir carpeta</button>
      </section>

      <section className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>Lotes que vencen hasta:</span>
        <select value={meses} onChange={(event) => setMeses(Number(event.target.value))}>
          <option value={3}>3 meses</option>
          <option value={6}>6 meses</option>
          <option value={12}>12 meses</option>
          <option value={24}>24 meses</option>
          <option value={60}>Todo el stock (5 años)</option>
        </select>
        <button className="script-button" onClick={descargar} disabled={busy || Boolean(data.enCurso)}>
          <Download size={18} /> {data.enCurso ? 'Descargando…' : 'Descargar vencimientos ahora'}
        </button>
        <button className="ghost small" onClick={refresh} disabled={busy}><RefreshCw size={15} /> Actualizar</button>
      </section>

      {message ? <div className="notice">{message}</div> : null}
      {ultima ? (
        <div className={ultima.estado === 'error' ? 'alert' : 'notice'} style={{ marginTop: 8 }}>
          Última descarga #{ultima.id} ({new Date(ultima.started_at).toLocaleString('es-AR', { hour12: false })}, hasta el {fmtFechaAr(ultima.hasta)}):{' '}
          <span className={`status ${ESTADOS_DESCARGA[ultima.estado]?.clase}`}>{ESTADOS_DESCARGA[ultima.estado]?.texto}</span>{' '}
          {ultima.mensaje}
        </div>
      ) : null}

      {picker ? (
        <FolderPicker
          client={client}
          inicial={data.dir}
          titulo="Carpeta donde guardar los Excel de vencidos"
          contarPdfs={false}
          onElegir={elegirCarpeta}
          onCerrar={() => setPicker(false)}
        />
      ) : null}

      <section className="summary-grid">
        <Metric label="Lotes" value={lotes.length} />
        <Metric label="Vencidos" value={`${lotes.filter(filtros.vencido.pred).length} (${fmtCantidad(unidades(lotes.filter(filtros.vencido.pred)))} u.)`} />
        <Metric label="Vencen en ≤ 30 días" value={`${lotes.filter(filtros.d30.pred).length} (${fmtCantidad(unidades(lotes.filter(filtros.d30.pred)))} u.)`} />
        <Metric label="Vencen en 31 a 90 días" value={`${lotes.filter(filtros.d90.pred).length} (${fmtCantidad(unidades(lotes.filter(filtros.d90.pred)))} u.)`} />
        <Metric label="Revisado hasta" value={descargaVista?.hasta ? fmtFechaAr(descargaVista.hasta) : '-'} />
      </section>

      <section className="filters">
        <FiltroSituacion
          titulo="Vencimiento:"
          valor={filtro}
          onCambiar={setFiltro}
          opciones={Object.entries(filtros).map(([k, f]) => ({ clave: k, label: f.label, cantidad: lotes.filter(f.pred).length }))}
        />
        <select value={sector} onChange={(event) => setSector(event.target.value)}>
          <option value="">Todos los sectores</option>
          {sectoresItems.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </section>

      <ExportButton targetId="tabla-vencidos" name="vencimientos" />
      <section className="table-wrap">
        <table id="tabla-vencidos" className="compact">
          <thead>
            <tr>
              <th>Sector</th>
              <th>Código</th>
              <th>Producto</th>
              <th>Concentración</th>
              <th>Presentación</th>
              <th>Forma</th>
              <th>Lote</th>
              <th>Vence</th>
              <th style={{ textAlign: 'right' }}>Días</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((x) => (
              <tr key={x.id} style={ESTADOS_VTO[x.estado].fondo ? { background: ESTADOS_VTO[x.estado].fondo } : undefined}>
                <td>{/PSICO/i.test(x.sector) ? 'Psicofármacos' : /UNIFICADA/i.test(x.sector) ? 'Unificada' : x.sector}</td>
                <td className="code">{x.codigo}</td>
                <td style={{ fontWeight: 700 }}>{x.nombre_generico}</td>
                <td>{x.concentracion}</td>
                <td>{x.presentacion}</td>
                <td>{x.forma}</td>
                <td className="code">{x.lote}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtFechaAr(x.vencimiento)}</td>
                <td style={{ textAlign: 'right' }}>{x.dias == null ? '-' : x.dias}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCantidad(x.stock)}</td>
                <td>
                  <span className={`status ${ESTADOS_VTO[x.estado].clase}`} style={{ cursor: 'pointer' }} title="Tocá para filtrar por este estado (otra vez para ver todos)" onClick={() => setFiltro((cur) => (cur === x.estado ? 'todos' : x.estado))}>
                    {ESTADOS_VTO[x.estado].label}
                  </span>
                </td>
              </tr>
            ))}
            {!visibles.length ? (
              <tr><td colSpan="11" className="empty">{data.items.length ? 'Sin lotes en esta categoría' : 'Todavía no hay vencimientos descargados. Elegí el plazo y tocá «Descargar vencimientos ahora».'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function UsersPage({ token, currentUserId }) {
  const client = useMemo(() => apiClient(token), [token]);
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', role: 'operador' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const data = await client.usuarios();
      setUsuarios(data.data.map((user) => ({ ...user, newPassword: '' })));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function crear(event) {
    event.preventDefault();
    setMessage('');
    try {
      await client.crearUsuario(form);
      setForm({ username: '', password: '', role: 'operador' });
      setMessage('Usuario creado.');
      await refresh();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function guardarUsuario(user) {
    setMessage('');
    try {
      const payload = { role: user.role, activo: Boolean(user.activo) };
      if (user.newPassword) payload.password = user.newPassword;
      await client.actualizarUsuario(user.id, payload);
      setMessage(`Usuario ${user.username} actualizado.`);
      await refresh();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <>
      <section className="page-title">
        <h2>Usuarios y permisos</h2>
      </section>
      <AyudaPagina id="usuarios" />

      <form className="user-form" onSubmit={crear}>
        <input placeholder="Usuario" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        <input placeholder="Contrasena inicial" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <button className="primary small">Crear usuario</button>
      </form>

      {message ? <div className="notice">{message}</div> : null}

      <ExportButton targetId="tabla-usuarios" name="usuarios" />
      <section className="table-wrap">
        <table id="tabla-usuarios">
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
            {usuarios.map((user) => (
              <tr key={user.id}>
                <td className="code">{user.username}</td>
                <td>
                  <select value={user.role} onChange={(event) => setUsuarios(updateUser(usuarios, user.id, { role: event.target.value }))}>
                    {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </td>
                <td>
                  <label className="checkline">
                    <input
                      type="checkbox"
                      checked={Boolean(user.activo)}
                      disabled={user.id === currentUserId}
                      onChange={(event) => setUsuarios(updateUser(usuarios, user.id, { activo: event.target.checked ? 1 : 0 }))}
                    />
                    {user.activo ? 'Si' : 'No'}
                  </label>
                </td>
                <td>
                  <input
                    type="password"
                    placeholder="Opcional"
                    value={user.newPassword}
                    onChange={(event) => setUsuarios(updateUser(usuarios, user.id, { newPassword: event.target.value }))}
                  />
                </td>
                <td><button className="icon-btn" title="Guardar usuario" onClick={() => guardarUsuario(user)} disabled={busy}><Save size={17} /></button></td>
              </tr>
            ))}
            {!usuarios.length ? (
              <tr><td colSpan="5" className="empty"><Users size={20} /> Sin usuarios</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

function AccessDenied() {
  return (
    <section className="access-panel">
      <Lock size={26} />
      <strong>Acceso restringido</strong>
      <span>Este modulo requiere nivel admin.</span>
    </section>
  );
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function renderMeses(item, mesesUsados) {
  if (!mesesUsados.length) return '-';
  return mesesUsados.map((month) => (
    <span className="month-chip" key={month.key}>
      {month.label.slice(0, 3)}: {formatNumber(item[month.key])}
    </span>
  ));
}

function formulaSummary(monthCount) {
  const maxDivisor = monthCount;
  const minDivisor = Math.max(1, monthCount / 2);
  return `Maximo sugerido = suma de ${monthCount} meses / ${maxDivisor}. Minimo sugerido = suma de ${monthCount} meses / ${minDivisor}.`;
}

function formulaTooltip(item, field, monthCount = 6) {
  const suma = formatNumber(item.suma_6);
  const maximo = item.maximo_sugerido;
  const minimo = item.minimo_sugerido;
  const minDivisor = Math.max(1, monthCount / 2);
  if (field === 'maximo') {
    return `Suma ${monthCount} meses: ${suma}. Maximo: ${suma} / ${monthCount} = ${maximo}.`;
  }
  return `Suma ${monthCount} meses: ${suma}. Minimo: ${suma} / ${minDivisor} = ${minimo}.`;
}

function StatusBadge({ item }) {
  const estado = item.estado || 'pendiente';
  const tipo = item.tipo_operacion || (item.requiere_carga ? 'carga_inicial' : 'actualizacion');
  let label = estado;
  let className = estado;
  if (estado === 'listo' && tipo === 'actualizacion') {
    label = 'listo actualizar';
    className = 'listo-actualizar';
  } else if (estado === 'listo') {
    label = 'listo carga';
  } else if (estado === 'cargado' && tipo === 'actualizacion') {
    label = 'actualizado';
  }
  return <span className={`status ${className}`}>{label}</span>;
}

function updateItem(items, id, patch) {
  return items.map((item) => item.id === id ? { ...item, ...patch } : item);
}

// Categoria del item para el filtro por estado (misma logica que StatusBadge):
// distingue 'cargado' (carga inicial) de 'actualizado' (ya existia y se modifico).
function estadoCategoria(item) {
  const estado = item.estado || 'pendiente';
  const tipo = item.tipo_operacion || (item.requiere_carga ? 'carga_inicial' : 'actualizacion');
  if (estado === 'cargado' && tipo === 'actualizacion') return 'actualizado';
  if (estado === 'cargado') return 'cargado';
  return estado; // 'pendiente' | 'listo' | 'error'
}

function updateUser(users, id, patch) {
  return users.map((user) => user.id === id ? { ...user, ...patch } : user);
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
