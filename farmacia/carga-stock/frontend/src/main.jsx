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
  Download,
  FileSpreadsheet,
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
    guardarValores: (id, payload) => request(`/items/${id}/valores`, { method: 'PUT', body: JSON.stringify(payload) })
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
            {items.map((item) => (
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
            {!items.length ? (
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
