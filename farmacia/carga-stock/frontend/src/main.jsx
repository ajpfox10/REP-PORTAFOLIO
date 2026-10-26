import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  LayoutDashboard,
  Lock,
  LogOut,
  Play,
  Printer,
  RefreshCw,
  Save,
  Search,
  Shield,
  Sigma,
  Tag,
  Upload,
  Users
} from 'lucide-react';
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
    if (!response.ok) throw new Error(data.error || 'Error de API');
    return data;
  }
  return {
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
    trimestreSource: () => request('/trimestre/source'),
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

      {view === 'dashboard' ? <Dashboard user={session.user} onOpen={setView} /> : null}
      {view === 'stock' && isAdmin ? <StockPage token={session.token} /> : null}
      {view === 'consumo' && isAdmin ? <ConsumoPage token={session.token} /> : null}
      {view === 'comparar' && isAdmin ? <ComparacionPage token={session.token} /> : null}
      {view === 'trimestral' && isAdmin ? <TrimestralPage token={session.token} /> : null}
      {view === 'sugeridos' && isAdmin ? <SugeridosPage token={session.token} /> : null}
      {view === 'rotulos' && canRotulos ? <RotulosPage token={session.token} /> : null}
      {view === 'ordenes' && isAdmin ? <OrdenesCompraPage token={session.token} /> : null}
      {view === 'usuarios' && isAdmin ? <UsersPage token={session.token} currentUserId={session.user.id} /> : null}
      {!allowedView ? <AccessDenied /> : null}
    </main>
  );
}

function Dashboard({ user, onOpen }) {
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
  // Numero puro con decimal opcional -> numero real (salvo codigos con cero inicial)
  if (/^-?\d+(\.\d+)?$/.test(value) && !/^-?0\d/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

function descargarLibro(wb, filename) {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  XLSX.writeFile(wb, `${filename}-${fecha}.xlsx`);
}

function exportTableToXlsx(table, filename) {
  if (!table) return;
  const aoa = [];
  aoa.push(Array.from(table.querySelectorAll('thead th'))
    .map((th) => String(th.textContent || '').replace(/\s+/g, ' ').trim()));
  for (const tr of table.querySelectorAll('tbody tr')) {
    if (tr.classList.contains('detail-row') || tr.querySelector('td.empty')) continue;
    aoa.push(Array.from(tr.children).map((td) => cellValue(td.textContent)));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  descargarLibro(wb, filename);
}

function ExportButton({ targetId, name }) {
  return (
    <div className="table-actions">
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

  const periodoKey = (x) => `${String(x.periodo_desde).slice(0, 10)}__${String(x.periodo_hasta).slice(0, 10)}`;
  const periodos = [];
  const vistos = new Set();
  for (const imp of importaciones) {
    const key = periodoKey(imp);
    if (vistos.has(key)) continue;
    vistos.add(key);
    periodos.push({ key, label: `${imp.anio || ''} ${fmtPeriodoCorto(imp.periodo_desde, imp.periodo_hasta)}` });
  }
  const itemsFiltrados = periodoFiltro
    ? items.filter((it) => periodoKey(it) === periodoFiltro)
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

  // Misma logica para la pestaña "Importados": agrupa por nombre + forma + periodo, suma el
  // total del trimestre y recalcula min/max desde ese total (no se suman min/max individuales).
  const gruposItems = useMemo(() => {
    const map = new Map();
    for (const it of itemsFiltrados) {
      const nombre = String(it.nombre_generico || it.codigo_articulo || '').trim();
      const forma = String(it.forma || '').trim();
      const conc = String(it.concentracion || '').trim();
      const pres = String(it.presentacion || '').trim();
      const pk = periodoKey(it);
      const key = `IT::${norm(nombre) || it.codigo_articulo}||${formaCanonica(forma)}||${norm(conc)}||${norm(pres)}||${pk}`;
      let g = map.get(key);
      if (!g) {
        g = { key, nombre, forma, concentracion: it.concentracion || null, presentacion: it.presentacion || null, sector: it.sector, periodo_desde: it.periodo_desde, periodo_hasta: it.periodo_hasta, total: 0, items: [] };
        map.set(key, g);
      }
      g.items.push(it);
      g.total += Number(it.total_periodo || 0);
    }
    const arr = Array.from(map.values());
    for (const g of arr) { g.minimo = Math.ceil(g.total * 2 / 3); g.maximo = Math.ceil(g.total * 2); }
    return arr.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es') || String(a.forma).localeCompare(String(b.forma), 'es'));
  }, [itemsFiltrados]);

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
      if (v != null) { o.trimestres[`T${imp.trimestre}`] = Number(v); o.presentes.push(Number(v)); }
    }
    const detalle = [...semMap.values()].sort((a, b) => (b.anio - a.anio) || (b.semestre - a.semestre));
    for (const o of detalle) {
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
      </section>

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
              <option value="">Todos los períodos</option>
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
                  <th>Codigo</th>
                  <th>Producto</th>
                  <th>Forma</th>
                  <th>Concentracion</th>
                  <th>Present.</th>
                  <th style={{ textAlign: 'center' }}>Total Trimestre</th>
                  <th style={{ textAlign: 'center' }} title="Mayor semestre ÷ 3 (sobre todos los períodos del producto)">Stock Mín.</th>
                  <th style={{ textAlign: 'center' }} title="Mayor total semestral (suma 6 meses). ⓘ para ver el cálculo">Stock Máx.</th>
                  <th>Sector</th>
                  <th>Periodo</th>
                </tr>
              </thead>
              <tbody>
                {gruposItems.map((g) => {
                  const multi = g.items.length > 1;
                  const abierto = gruposAbiertos.has(g.key);
                  const stockG = calcStockCodigos([...new Set(g.items.map((i) => i.codigo_articulo))]);
                  const calcOpen = calcAbierto.has(g.key);
                  return (
                    <React.Fragment key={g.key}>
                      <tr
                        onClick={multi ? () => toggleGrupo(g.key) : undefined}
                        style={multi ? { cursor: 'pointer', background: abierto ? '#eef4fb' : undefined } : undefined}
                        title={multi ? `${g.items.length} códigos con este nombre y forma — sumados. Click para ${abierto ? 'ocultar' : 'desglosar'}.` : undefined}
                      >
                        <td className="code">
                          {multi
                            ? <span style={{ fontWeight: 700, color: '#174e8d' }}>{abierto ? '▾' : '▸'} {g.items.length} cód.</span>
                            : g.items[0].codigo_articulo}
                        </td>
                        <td style={multi ? { fontWeight: 700 } : undefined}>{multi ? (g.nombre || '-') : celdaEditable(g.items[0], 'nombre_generico')}</td>
                        <td style={{ color: '#5b6b76' }} title={g.forma || ''}>{multi ? abrevForma(g.forma) : celdaFormaItem(g.items[0])}</td>
                        <td style={{ color: '#5b6b76' }}>{multi ? (g.concentracion || '-') : celdaEditable(g.items[0], 'concentracion')}</td>
                        <td style={{ color: '#5b6b76' }}>{multi ? (g.presentacion || '-') : celdaEditable(g.items[0], 'presentacion')}</td>
                        <td style={{ textAlign: 'center', fontWeight: multi ? 700 : undefined }}>{formatNumber(g.total)}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#176338' }}>{stockG.minimo != null ? formatNumber(stockG.minimo) : '-'}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#174e8d', whiteSpace: 'nowrap' }}>
                          {stockG.maximo != null ? formatNumber(stockG.maximo) : '-'}
                          {stockG.detalle.length
                            ? <button className="ghost small" style={{ marginLeft: 4, padding: '0 5px' }} title="Ver cálculo"
                                onClick={(e) => { e.stopPropagation(); toggleCalc(g.key); }}>{calcOpen ? '▾' : 'ⓘ'}</button>
                            : null}
                        </td>
                        <td>{g.sector || '-'}</td>
                        <td>{fmtPeriodoCorto(g.periodo_desde, g.periodo_hasta)}</td>
                      </tr>
                      {calcOpen ? detalleCalculoRow(g.key, stockG, 10) : null}
                      {multi && abierto ? g.items.map((it) => {
                        const stockIt = calcStockCodigos([it.codigo_articulo]);
                        return (
                        <tr key={it.id} style={{ background: '#f7fafd', color: '#5b6b76' }}>
                          <td className="code" style={{ paddingLeft: 26 }}>{it.codigo_articulo}</td>
                          <td>{celdaEditable(it, 'nombre_generico')}</td>
                          <td title={it.forma || ''}>{celdaFormaItem(it)}</td>
                          <td>{celdaEditable(it, 'concentracion')}</td>
                          <td>{celdaEditable(it, 'presentacion')}</td>
                          <td style={{ textAlign: 'center' }}>{formatNumber(it.total_periodo)}</td>
                          <td style={{ textAlign: 'center' }}>{stockIt.minimo != null ? formatNumber(stockIt.minimo) : '-'}</td>
                          <td style={{ textAlign: 'center' }}>{stockIt.maximo != null ? formatNumber(stockIt.maximo) : '-'}</td>
                          <td>{it.sector || '-'}</td>
                          <td>{fmtPeriodoCorto(it.periodo_desde, it.periodo_hasta)}</td>
                        </tr>
                        );
                      }) : null}
                    </React.Fragment>
                  );
                })}
                {!gruposItems.length ? (
                  <tr><td colSpan="10" className="empty"><CalendarRange size={20} /> Sin productos importados</td></tr>
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
function FolderPicker({ client, inicial, titulo, onElegir, onCerrar }) {
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
          <span>{data?.ruta ? `${data.pdfs} PDF en esta carpeta` : ''}</span>
          <button type="button" className="script-button" disabled={!data?.ruta} onClick={() => onElegir(data.ruta)}>
            <Check size={18} /> Usar esta carpeta
          </button>
        </div>
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
  const [error, setError] = useState('');

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

  async function guardarRenglon(ordenId, renglonId, patch) {
    setError('');
    try {
      const { data } = await client.ocEditarRenglon(renglonId, patch);
      setOrdenes((prev) => prev.map((o) => {
        if (o.id !== ordenId) return o;
        const renglones = o.renglones.map((r) => (r.id === renglonId ? data : r));
        return { ...o, renglones, estado: renglones.every((r) => r.completo === 'SI') ? 'COMPLETA' : 'INCOMPLETA' };
      }));
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

  const texto = search.trim().toLowerCase();
  const visibles = ordenes.filter((o) => {
    if (filtroEstado && o.estado !== filtroEstado) return false;
    if (!texto) return true;
    return o.oc.toLowerCase().includes(texto)
      || o.proveedor.toLowerCase().includes(texto)
      || o.renglones.some((r) => r.codigo.toLowerCase().includes(texto) || r.descripcion.toLowerCase().includes(texto));
  });
  const totalRenglones = ordenes.reduce((acc, o) => acc + o.renglones.length, 0);
  const completas = ordenes.filter((o) => o.estado === 'COMPLETA').length;
  const resultados = importacion?.resultados || [];

  return (
    <>
      <section className="page-title">
        <h2>Órdenes de Compra</h2>
      </section>

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

      <section className="summary-grid">
        <Metric label="Órdenes cargadas" value={ordenes.length} />
        <Metric label="Renglones" value={totalRenglones} />
        <Metric label="Completas" value={completas} />
        <Metric label="Incompletas" value={ordenes.length - completas} />
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((o) => {
              const abierto = expandido === o.id;
              const listos = o.renglones.filter((r) => r.completo === 'SI').length;
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
                      <button type="button" className="ghost small" title="Eliminar O.C." onClick={(event) => { event.stopPropagation(); eliminarOrden(o); }} disabled={!!busy}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                  {abierto ? (
                    <tr className="detail-row">
                      <td colSpan={9}>
                        <table className="oc-renglones">
                          <thead>
                            <tr>
                              <th>Renglón</th>
                              <th>Código</th>
                              <th>Descripción</th>
                              <th style={{ textAlign: 'right' }}>Cantidad</th>
                              <th style={{ textAlign: 'right' }}>Entregada</th>
                              <th style={{ textAlign: 'right' }}>Falta</th>
                              <th>Completo</th>
                              <th>N° de ingreso</th>
                              <th>Observación</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.renglones.map((r) => {
                              const falta = r.entregada == null ? r.cantidad : r.cantidad - r.entregada;
                              return (
                                <tr key={r.id} className={r.completo === 'SI' ? 'oc-ok' : r.entregada != null && falta > 0 ? 'oc-parcial' : ''}>
                                  <td>{r.renglon}</td>
                                  <td className="code">{r.codigo}</td>
                                  <td>{r.descripcion}</td>
                                  <td style={{ textAlign: 'right' }}>{formatNumber(r.cantidad)}</td>
                                  <td style={{ textAlign: 'right', minWidth: 90 }}>
                                    <EditableCell
                                      value={r.entregada == null ? '' : String(r.entregada)}
                                      display={r.entregada == null ? '—' : formatNumber(r.entregada)}
                                      onSave={(v) => guardarRenglon(o.id, r.id, { entregada: v })}
                                    />
                                  </td>
                                  <td style={{ textAlign: 'right' }}>{formatNumber(falta)}</td>
                                  <td>
                                    <select
                                      value={r.completo || ''}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={(event) => guardarRenglon(o.id, r.id, { completo: event.target.value })}
                                    >
                                      <option value="">-</option>
                                      <option value="SI">SI</option>
                                      <option value="NO">NO</option>
                                    </select>
                                  </td>
                                  <td style={{ minWidth: 110 }}>
                                    <EditableCell value={r.nroIngreso || ''} onSave={(v) => guardarRenglon(o.id, r.id, { nroIngreso: v })} />
                                  </td>
                                  <td style={{ minWidth: 160 }}>
                                    <EditableCell value={r.observacion || ''} onSave={(v) => guardarRenglon(o.id, r.id, { observacion: v })} />
                                  </td>
                                </tr>
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
              <tr><td colSpan={9} className="empty">{ordenes.length ? 'Ninguna orden coincide con el filtro' : 'Todavía no hay órdenes cargadas. Subí los PDF arriba.'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>

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
