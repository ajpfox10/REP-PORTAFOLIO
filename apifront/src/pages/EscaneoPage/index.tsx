// src/pages/EscaneoPage/index.tsx — Scanner v3: dispositivos, bandejas, cola en tiempo real
// CAMBIOS: selector de tipo de documento OBLIGATORIO, agente OBLIGATORIO, guardado en G:\docu\{DNI}\
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import './styles/EscaneoPage.css';

// ─── Scanner API client ───────────────────────────────────────────────────────
function getScannerBase() {
  const cfg = (window as any).__RUNTIME_CONFIG__ || {};
  return (cfg.scannerApiUrl || (import.meta as any)?.env?.VITE_SCANNER_API_URL || 'http://localhost:3001').replace(/\/$/, '');
}
function getScannerHeaders(): Record<string, string> {
  const cfg = (window as any).__RUNTIME_CONFIG__ || {};
  const tenant = cfg.scannerTenantId || (import.meta as any)?.env?.VITE_SCANNER_TENANT_ID || '1';
  const runtimeToken = cfg.scannerToken || (import.meta as any)?.env?.VITE_SCANNER_TOKEN || '';
  let sessionToken = '';
  try {
    // Intentar localStorage, sessionStorage y memory en orden
    const raw = localStorage.getItem('personalv5.session') || sessionStorage.getItem('personalv5.session') || '';
    sessionToken = JSON.parse(raw || '{}')?.accessToken || '';
  } catch {}
  const token = runtimeToken || sessionToken;
  return {
    'x-tenant': tenant,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function scannerFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getScannerBase()}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...getScannerHeaders(),
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.message || e?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Tipos de documento disponibles ──────────────────────────────────────────
const TIPOS_DOCUMENTO = [
  { value: 'dni_frente',           label: 'DNI — Frente',                    icon: '🪪' },
  { value: 'dni_dorso',            label: 'DNI — Dorso',                     icon: '🪪' },
  { value: 'titulo_secundario',    label: 'Título Secundario',               icon: '📜' },
  { value: 'titulo_universitario', label: 'Título Universitario / Terciario',icon: '🎓' },
  { value: 'licencia_conducir',    label: 'Licencia de Conducir',            icon: '🚗' },
  { value: 'acta_nacimiento',      label: 'Acta de Nacimiento',              icon: '👶' },
  { value: 'partida_matrimonio',   label: 'Partida de Matrimonio',           icon: '💍' },
  { value: 'contrato_trabajo',     label: 'Contrato de Trabajo',             icon: '📋' },
  { value: 'certificado_medico',   label: 'Certificado Médico',              icon: '🏥' },
  { value: 'certificado_estudio',  label: 'Certificado de Estudios',         icon: '📚' },
  { value: 'recibo_sueldo',        label: 'Recibo de Sueldo',                icon: '💰' },
  { value: 'declaracion_jurada',   label: 'Declaración Jurada',              icon: '✍️' },
  { value: 'resolucion',           label: 'Resolución',                      icon: '📄' },
  { value: 'nota_pedido',          label: 'Nota / Pedido',                   icon: '📝' },
  { value: 'jubilacion',           label: 'Documentación Jubilación',        icon: '🏦' },
  { value: 'ioma',                 label: 'Documentación IOMA',              icon: '🏥' },
  { value: 'foto_carnet',          label: 'Foto Carnet',                     icon: '📷' },
  { value: 'otro',                 label: 'Otro documento',                  icon: '📦' },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface Device {
  id: number; name: string; driver: string; is_active: boolean;
  last_seen_at: string | null; hostname: string | null;
  online?: boolean;
  capabilities?: DeviceCapabilities;
}
interface DeviceCapabilities {
  sources: ('flatbed' | 'adf' | 'adf_duplex')[];
  resolutions: number[];
  paper_sizes: string[];
  color_modes: string[];
  max_pages_adf: number | null;
  duplex: boolean;
  model: string | null;
  manufacturer: string | null;
  online: boolean;
}
interface ScanJob {
  id: number; status: string; page_count: number | null;
  error_message: string | null; personal_dni: number | null;
  personal_ref: string | null; created_at: string;
  completed_at: string | null; device_id: number;
  doc_class?: string;
}
interface ScanProfile {
  id: number; name: string; dpi: number; color: boolean;
  auto_rotate: boolean; blank_page_detection: boolean;
  compression: string; output_format: string;
}

const STATUS_ICON: Record<string, string> = {
  queued: '⏳', in_progress: '🔄', completed: '✅', failed: '❌', canceled: '⊘',
};
const STATUS_COLOR: Record<string, string> = {
  queued: '#f59e0b', in_progress: '#6366f1', completed: '#10b981',
  failed: '#ef4444', canceled: '#64748b',
};
const SOURCE_LABEL: Record<string, string> = {
  flatbed: '🪟 Vidrio plano', adf: '📄 ADF (alimentador)', adf_duplex: '📄 ADF Dúplex',
};

function fmtDT(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return s; }
}
function deviceOnline(d: Device) {
  if (typeof d.online === 'boolean') return d.online;
  if (!d.last_seen_at) return false;
  return (Date.now() - new Date(d.last_seen_at).getTime()) < 90_000;
}

type Tab = 'escanear' | 'dispositivos' | 'cola' | 'documentos';

// ─── Componente principal ─────────────────────────────────────────────────────
export function EscaneoPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('escanear');

  // Agente — OBLIGATORIO para escanear
  const [dni, setDni]           = useState('');
  const [fullName, setFullName] = useState('');
  const [agente, setAgente]     = useState<any>(null);
  const [matches, setMatches]   = useState<any[]>([]);
  const [loadingAgente, setLoadingAgente] = useState(false);

  // Tipo de documento — OBLIGATORIO
  const [tipoDoc, setTipoDoc] = useState<string>('');

  // Descripción adicional (opcional)
  const [descripcion, setDescripcion] = useState('');

  // Dispositivos y capacidades
  const [devices, setDevices]               = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [discovering, setDiscovering]       = useState(false);

  // Perfiles
  const [profiles, setProfiles]             = useState<ScanProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);

  // Opciones de escaneo
  const [source, setSource]   = useState<string>('flatbed');
  const [dpi, setDpi]         = useState<number>(300);
  const [color, setColor]     = useState(true);
  const [duplex, setDuplex]   = useState(false);

  // Cola de jobs
  const [jobs, setJobs]               = useState<ScanJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Historial documentos del agente (desde api_personal)
  const [docHistory, setDocHistory] = useState<any[]>([]);

  // Lanzar scan
  const [launching, setLaunching] = useState(false);

  // ── Cargar dispositivos ───────────────────────────────────────────────────
  const cargarDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const r = await scannerFetch<{ items: Device[] }>('/v1/devices?limit=50');
      const devs = r.items || [];
      const withCaps = await Promise.all(devs.map(async (d) => {
        if (!deviceOnline(d)) return d;
        try {
          const caps = await scannerFetch<DeviceCapabilities>(`/v1/devices/${d.id}/capabilities`);
          return { ...d, capabilities: caps };
        } catch { return d; }
      }));
      setDevices(withCaps);
      if (!selectedDevice && withCaps.length) {
        const onlineFirst = withCaps.find(d => deviceOnline(d));
        if (onlineFirst) setSelectedDevice(onlineFirst.id);
      }
    } catch (e: any) {
      toast.error('Scanner no disponible', e?.message);
    } finally { setLoadingDevices(false); }
  }, [selectedDevice]);

  const cargarProfiles = useCallback(async () => {
    try {
      const r = await scannerFetch<{ items: ScanProfile[] }>('/v1/profiles');
      setProfiles(r.items || []);
    } catch { /* silencioso */ }
  }, []);

  const descubrirDispositivos = useCallback(async () => {
    setDiscovering(true);
    try {
      const r = await scannerFetch<{ devices: any[] }>('/v1/devices/discover', { method: 'POST' });
      const found = r.devices?.length || 0;
      if (found > 0) {
        toast.ok(`${found} dispositivo(s) encontrado(s)`, 'Recargando lista…');
        await cargarDevices();
      } else {
        toast.error('Sin dispositivos', 'No se encontraron escáneres en la red');
      }
    } catch (e: any) {
      toast.error('Error al descubrir', e?.message);
    } finally { setDiscovering(false); }
  }, [cargarDevices]);

  const cargarJobs = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoadingJobs(true);
    try {
      const r = await scannerFetch<{ items: ScanJob[] }>('/v1/scan-jobs?limit=30');
      setJobs(r.items || []);
    } catch { /* silencioso */ }
    finally { if (!silencioso) setLoadingJobs(false); }
  }, []);

  useEffect(() => {
    if (tab === 'cola') {
      cargarJobs();
      pollingRef.current = setInterval(() => cargarJobs(true), 3000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [tab, cargarJobs]);

  useEffect(() => {
    cargarDevices();
    cargarProfiles();
  }, []);

  // ── Buscar agente ─────────────────────────────────────────────────────────
  const cargarDocHistory = useCallback(async (cleanDni: string) => {
    try {
      const r = await apiFetch<any>(`/scanner/documents/${cleanDni}`);
      setDocHistory(r?.data || []);
    } catch { setDocHistory([]); }
  }, []);

  const buscarPorDni = useCallback(async (dniOverride?: string) => {
    const clean = (dniOverride ?? dni).replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido'); return; }
    setLoadingAgente(true); setAgente(null); setMatches([]); setDocHistory([]);
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (!res?.ok || !res?.data) { toast.error('No encontrado'); return; }
      const row = { ...res.data, dni: res.data.dni || Number(clean) };
      setAgente(row);
      toast.ok('Agente cargado', `${row.apellido}, ${row.nombre}`);
      cargarDocHistory(clean);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoadingAgente(false); }
  }, [dni, cargarDocHistory]);

  const buscarPorNombre = useCallback(async () => {
    const q = fullName.trim();
    if (!q) { toast.error('Ingresá apellido'); return; }
    setLoadingAgente(true); setMatches([]);
    try {
      const results = await searchPersonal(q, 30);
      setMatches(results);
      if (!results.length) toast.error('Sin resultados');
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoadingAgente(false); }
  }, [fullName]);

  // ── Validación antes de lanzar ────────────────────────────────────────────
  const validarYLanzar = useCallback(async () => {
    if (!agente) {
      toast.error('Agente requerido', 'Buscá y seleccioná el agente antes de escanear');
      return;
    }
    if (!tipoDoc) {
      toast.error('Tipo de documento requerido', 'Seleccioná qué documento vas a escanear');
      return;
    }
    if (!selectedDevice) {
      toast.error('Seleccioná un dispositivo');
      return;
    }

    const tipoLabel = TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label || tipoDoc;

    setLaunching(true);
    try {
      // 1. Crear job en el scanner API
      const body: any = {
        device_id:    selectedDevice,
        profile_id:   selectedProfile || undefined,
        priority:     5,
        personal_dni: agente.dni,
        personal_ref: tipoDoc,  // el tipo va como referencia para el scanner
        doc_class:    tipoDoc,
      };
      const r = await scannerFetch<{ id: number; pending_tramites?: any[] }>('/v1/scan-jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      // 2. Pre-registrar en api_personal (el scanner completará después vía /document-ready)
      //    Esto permite que el job quede trazado con tipo y descripción
      try {
        await apiFetch('/scanner/registrar-escaneo', {
          method: 'POST',
          body: JSON.stringify({
            dni:           agente.dni,
            tipo_documento: tipoDoc,
            descripcion:   descripcion.trim() || tipoLabel,
            nombre_archivo: `scan-job-${r.id}.pdf`,
          }),
        });
      } catch (regErr: any) {
        // No bloquear si el registro previo falla — el scanner lo completará
        console.warn('[scan] pre-registro falló:', regErr?.message);
      }

      toast.ok(`✅ Job #${r.id} creado`, `${tipoLabel} para DNI ${agente.dni}`);
      if (r.pending_tramites?.length) {
        toast.error(`⚠️ ${r.pending_tramites.length} trámite(s) pendiente(s)`, '');
      }

      // Reset tipo y descripción, mantener agente
      setTipoDoc('');
      setDescripcion('');
      setTab('cola');
      setTimeout(() => cargarJobs(), 800);
    } catch (e: any) {
      toast.error('Error al lanzar scan', e?.message);
    } finally { setLaunching(false); }
  }, [agente, tipoDoc, selectedDevice, selectedProfile, descripcion, cargarJobs]);

  const cancelarJob = useCallback(async (jobId: number) => {
    try {
      await scannerFetch(`/v1/scan-jobs/${jobId}/cancel`, { method: 'POST' });
      toast.ok('Job cancelado');
      cargarJobs(true);
    } catch (e: any) { toast.error('Error al cancelar', e?.message); }
  }, [cargarJobs]);

  const device   = devices.find(d => d.id === selectedDevice) || null;
  const caps     = device?.capabilities;
  const isOnline = device ? deviceOnline(device) : false;

  const activeJobs = jobs.filter(j => ['queued','in_progress'].includes(j.status));
  const doneJobs   = jobs.filter(j => !['queued','in_progress'].includes(j.status));

  // Validación para el botón
  const puedeEscanear = !!agente && !!tipoDoc && !!selectedDevice;

  return (
    <Layout title="Escaneo" showBack>
      <div className="scan-page">

        {/* ── TABS ── */}
        <div className="scan-tabs">
          {([
            ['escanear',    '📷 Escanear'],
            ['dispositivos','🖨️ Dispositivos'],
            ['cola',        `⏳ Cola${activeJobs.length ? ` (${activeJobs.length})` : ''}`],
            ['documentos',  '📂 Documentos'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              className={`scan-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >{label}</button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════
            TAB: ESCANEAR
        ══════════════════════════════════════════════ */}
        {tab === 'escanear' && (
          <div className="scan-layout">

            {/* IZQUIERDA */}
            <div className="scan-col">

              {/* ── AGENTE — OBLIGATORIO ── */}
              <div className={`card scan-card${!agente ? ' scan-card-required' : ' scan-card-ok'}`}>
                <div className="scan-section-title">
                  👤 Agente
                  <span className="scan-required-badge">obligatorio</span>
                </div>
                <div className="scan-search-grid">
                  <div>
                    <div className="muted scan-label">DNI</div>
                    <input className="input" value={dni} placeholder="DNI (Enter)"
                      onChange={e => setDni(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && buscarPorDni()}
                      disabled={loadingAgente} style={{ width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div className="muted scan-label">Apellido</div>
                    <input className="input" value={fullName} placeholder="Apellido (Enter)"
                      onChange={e => setFullName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                      disabled={loadingAgente} style={{ width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn" onClick={() => buscarPorDni()} disabled={loadingAgente || !dni.trim()}>
                    {loadingAgente ? '…' : 'Buscar'}
                  </button>
                  <button className="btn" onClick={buscarPorNombre} disabled={loadingAgente || !fullName.trim()}>
                    {loadingAgente ? '…' : 'Por nombre'}
                  </button>
                  {agente && (
                    <button className="btn" onClick={() => { setAgente(null); setDni(''); setDocHistory([]); }}>✕ Limpiar</button>
                  )}
                </div>

                {matches.length > 0 && (
                  <div className="scan-matches" style={{ marginTop: 8 }}>
                    {matches.map((m: any) => (
                      <button key={m.dni} className="scan-match-item"
                        onClick={() => { setDni(String(m.dni)); setMatches([]); buscarPorDni(String(m.dni)); }}>
                        <b>{m.apellido}, {m.nombre}</b>
                        <span className="badge" style={{ marginLeft: 8 }}>{m.dni}</span>
                      </button>
                    ))}
                  </div>
                )}

                {agente ? (
                  <div className="scan-agente-bar scan-agente-ok" style={{ marginTop: 10 }}>
                    <span className="scan-check-icon">✅</span>
                    <div>
                      <div className="scan-agente-name">{agente.apellido}, {agente.nombre}</div>
                      <div className="scan-agente-meta">
                        <span className="badge">DNI {agente.dni}</span>
                        {agente.dependencia_nombre && <span className="muted">{agente.dependencia_nombre}</span>}
                      </div>
                      <div className="scan-ruta-hint muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                        📁 Se guardará en: …\docu\{agente.dni}\
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="scan-required-hint">
                    ⚠️ Buscá el agente antes de escanear
                  </div>
                )}
              </div>

              {/* ── TIPO DE DOCUMENTO — OBLIGATORIO ── */}
              <div className={`card scan-card${!tipoDoc ? ' scan-card-required' : ' scan-card-ok'}`}>
                <div className="scan-section-title">
                  🗂️ Tipo de Documento
                  <span className="scan-required-badge">obligatorio</span>
                </div>
                <div className="scan-tipos-grid">
                  {TIPOS_DOCUMENTO.map(t => (
                    <button
                      key={t.value}
                      className={`scan-tipo-btn${tipoDoc === t.value ? ' selected' : ''}`}
                      onClick={() => setTipoDoc(t.value)}
                      type="button"
                    >
                      <span className="scan-tipo-icon">{t.icon}</span>
                      <span className="scan-tipo-label">{t.label}</span>
                    </button>
                  ))}
                </div>
                {!tipoDoc && (
                  <div className="scan-required-hint">⚠️ Seleccioná qué documento vas a escanear</div>
                )}
                {tipoDoc && (
                  <div className="scan-tipo-selected">
                    ✅ {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.icon} {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label}
                  </div>
                )}

                {/* Descripción adicional */}
                <div className="muted scan-label" style={{ marginTop: 12 }}>Descripción adicional (opcional)</div>
                <input
                  className="input"
                  value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  placeholder="Ej: Renovación 2024, página 1 de 2…"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

            </div>

            {/* DERECHA */}
            <div className="scan-col">

              {/* ── Dispositivo ── */}
              <div className="card scan-card">
                <div className="scan-section-title">🖨️ Dispositivo</div>
                {loadingDevices ? (
                  <div className="muted">Cargando dispositivos…</div>
                ) : devices.length === 0 ? (
                  <div className="scan-no-devices">
                    <div style={{ fontSize: '2rem' }}>🔍</div>
                    <div>No hay dispositivos registrados</div>
                    <button className="btn" onClick={descubrirDispositivos} disabled={discovering}>
                      {discovering ? '🔄 Buscando…' : '📡 Buscar en red'}
                    </button>
                  </div>
                ) : (
                  <div className="scan-device-list">
                    {devices.map(d => {
                      const online = deviceOnline(d);
                      return (
                        <button
                          key={d.id}
                          className={`scan-device-btn${selectedDevice === d.id ? ' selected' : ''}${!online ? ' offline' : ''}`}
                          onClick={() => setSelectedDevice(d.id)}
                        >
                          <div className="scan-device-row">
                            <span className={`scan-dot${online ? ' online' : ''}`} />
                            <b>{d.name}</b>
                            <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>
                              {online ? 'En línea' : 'Sin conexión'}
                            </span>
                          </div>
                          {d.hostname && (
                            <div className="muted" style={{ fontSize: '0.72rem', paddingLeft: 18 }}>
                              {d.hostname} · {d.driver}
                            </div>
                          )}
                          {d.capabilities?.model && (
                            <div className="muted" style={{ fontSize: '0.72rem', paddingLeft: 18 }}>
                              {d.capabilities.manufacturer} {d.capabilities.model}
                            </div>
                          )}
                        </button>
                      );
                    })}
                    <button className="btn" style={{ marginTop: 6 }} onClick={descubrirDispositivos} disabled={discovering}>
                      {discovering ? '🔄 Buscando…' : '📡 Buscar en red'}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Configuración del dispositivo ── */}
              {caps && (
                <div className="card scan-card">
                  <div className="scan-section-title">⚙️ Configuración de Escaneo</div>

                  <div className="muted scan-label">Bandeja / Fuente</div>
                  <div className="scan-caps-grid">
                    {caps.sources.map(s => (
                      <button
                        key={s}
                        className={`scan-cap-btn${source === s ? ' selected' : ''}`}
                        onClick={() => { setSource(s); if (s !== 'adf_duplex') setDuplex(false); }}
                      >
                        {SOURCE_LABEL[s] || s}
                        {s === 'adf_duplex' && <span className="scan-cap-tag">Dúplex</span>}
                      </button>
                    ))}
                  </div>

                  <div className="muted scan-label" style={{ marginTop: 12 }}>Resolución (DPI)</div>
                  <div className="scan-caps-grid">
                    {(caps.resolutions.length ? caps.resolutions : [150, 300, 600]).map(r => (
                      <button
                        key={r}
                        className={`scan-cap-btn${dpi === r ? ' selected' : ''}`}
                        onClick={() => setDpi(r)}
                      >{r} dpi</button>
                    ))}
                  </div>

                  <div className="muted scan-label" style={{ marginTop: 12 }}>Modo de color</div>
                  <div className="scan-caps-grid">
                    {(caps.color_modes.length ? caps.color_modes : ['color','gris']).map(m => (
                      <button
                        key={m}
                        className={`scan-cap-btn${(color ? 'color' : 'gris') === m ? ' selected' : ''}`}
                        onClick={() => setColor(m === 'color')}
                      >{m === 'color' ? '🎨 Color' : '⬜ Escala de grises'}</button>
                    ))}
                  </div>

                  {(source === 'adf' || source === 'adf_duplex') && caps.duplex && (
                    <label className="scan-checkbox-row" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={duplex} onChange={e => setDuplex(e.target.checked)} />
                      <span>Escanear ambas caras (dúplex)</span>
                    </label>
                  )}

                  {caps.max_pages_adf && (source === 'adf' || source === 'adf_duplex') && (
                    <div className="muted" style={{ fontSize: '0.72rem', marginTop: 6 }}>
                      ADF: máx. {caps.max_pages_adf} páginas
                    </div>
                  )}
                </div>
              )}

              {/* ── Perfiles ── */}
              {profiles.length > 0 && (
                <div className="card scan-card">
                  <div className="scan-section-title">📋 Perfil de Escaneo</div>
                  <div className="scan-caps-grid">
                    <button
                      className={`scan-cap-btn${!selectedProfile ? ' selected' : ''}`}
                      onClick={() => setSelectedProfile(null)}
                    >Manual</button>
                    {profiles.map(p => (
                      <button
                        key={p.id}
                        className={`scan-cap-btn${selectedProfile === p.id ? ' selected' : ''}`}
                        onClick={() => {
                          setSelectedProfile(p.id);
                          setDpi(p.dpi); setColor(p.color);
                        }}
                      >
                        {p.name}
                        <span className="muted" style={{ fontSize: '0.68rem', display: 'block' }}>
                          {p.dpi}dpi · {p.color ? 'Color' : 'Gris'} · {p.output_format}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Resumen y lanzar ── */}
              <div className="card scan-card scan-launch-card">
                <div className="scan-section-title">🚀 Lanzar Escaneo</div>

                {/* Checklist de requisitos */}
                <div className="scan-checklist">
                  <div className={`scan-check-item${agente ? ' ok' : ' pending'}`}>
                    {agente ? '✅' : '⭕'} Agente seleccionado
                    {agente && <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>DNI {agente.dni}</span>}
                  </div>
                  <div className={`scan-check-item${tipoDoc ? ' ok' : ' pending'}`}>
                    {tipoDoc ? '✅' : '⭕'} Tipo de documento
                    {tipoDoc && <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>
                      {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label}
                    </span>}
                  </div>
                  <div className={`scan-check-item${selectedDevice ? ' ok' : ' pending'}`}>
                    {selectedDevice ? '✅' : '⭕'} Dispositivo seleccionado
                    {device && <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>{device.name}</span>}
                  </div>
                </div>

                {device && agente && tipoDoc && (
                  <div className="scan-summary">
                    <div className="scan-summary-row">
                      <span className="muted">Agente</span>
                      <span>{agente.apellido}, {agente.nombre} (DNI {agente.dni})</span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Documento</span>
                      <span>{TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.icon} {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label}</span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Destino</span>
                      <span className="scan-ruta-val">📁 …\docu\{agente.dni}\</span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Dispositivo</span>
                      <span>
                        <span className={`scan-dot${isOnline ? ' online' : ''}`} style={{ marginRight: 6 }} />
                        {device.name}
                      </span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Resolución</span>
                      <span>{dpi} dpi · {color ? 'Color' : 'Escala de grises'}</span>
                    </div>
                    {duplex && (
                      <div className="scan-summary-row">
                        <span className="muted">Dúplex</span>
                        <span>✓ Ambas caras</span>
                      </div>
                    )}
                  </div>
                )}

                {!isOnline && device && (
                  <div className="scan-warn">
                    ⚠️ El dispositivo <b>{device.name}</b> no está en línea.
                    El job se encolará y el agente lo tomará cuando esté disponible.
                  </div>
                )}

                <button
                  className={`btn scan-btn-launch${puedeEscanear ? ' ready' : ''}`}
                  onClick={validarYLanzar}
                  disabled={launching || !puedeEscanear}
                  title={!agente ? 'Falta seleccionar el agente' : !tipoDoc ? 'Falta seleccionar el tipo de documento' : !selectedDevice ? 'Falta seleccionar el dispositivo' : ''}
                >
                  {launching ? '⏳ Enviando…' : !agente ? '👤 Falta el agente' : !tipoDoc ? '🗂️ Falta el tipo de documento' : '▶ Iniciar Escaneo'}
                </button>
              </div>

              {/* Docs previos del agente */}
              {agente && docHistory.length > 0 && (
                <div className="card scan-card">
                  <div className="scan-section-title">🗂️ Documentos previos del agente</div>
                  <div className="scan-doc-list">
                    {docHistory.slice(0, 8).map((d: any) => (
                      <div key={d.id} className="scan-doc-item">
                        <div className="scan-doc-class">
                          {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.icon || '📄'}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.83rem' }}>{d.nombre || `Documento #${d.id}`}</div>
                          <div className="muted" style={{ fontSize: '0.72rem' }}>
                            {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo} · {fmtDT(d.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            TAB: DISPOSITIVOS
        ══════════════════════════════════════════════ */}
        {tab === 'dispositivos' && (
          <div className="scan-devices-page">
            <div className="scan-devices-toolbar">
              <button className="btn" onClick={cargarDevices} disabled={loadingDevices}>
                {loadingDevices ? '🔄' : '↺ Actualizar'}
              </button>
              <button className="btn scan-discover-btn" onClick={descubrirDispositivos} disabled={discovering}>
                {discovering ? '🔄 Buscando en red…' : '📡 Descubrir en red'}
              </button>
            </div>

            <div className="scan-devices-grid">
              {devices.map(d => {
                const online = deviceOnline(d);
                const caps   = d.capabilities;
                return (
                  <div key={d.id} className={`card scan-device-card${online ? ' online' : ''}`}>
                    <div className="scan-device-header">
                      <span className={`scan-dot-lg${online ? ' online' : ''}`} />
                      <div>
                        <div className="scan-device-title">{d.name}</div>
                        {caps?.model && (
                          <div className="muted" style={{ fontSize: '0.78rem' }}>
                            {caps.manufacturer} {caps.model}
                          </div>
                        )}
                      </div>
                      <span className="badge" style={{ marginLeft: 'auto', background: online ? 'rgba(16,185,129,0.2)' : undefined, color: online ? '#6ee7b7' : undefined }}>
                        {online ? 'En línea' : 'Sin conexión'}
                      </span>
                    </div>

                    <div className="scan-device-info">
                      <div className="scan-info-row"><span className="muted">Driver</span><span>{d.driver}</span></div>
                      {d.hostname && <div className="scan-info-row"><span className="muted">Host</span><span>{d.hostname}</span></div>}
                      <div className="scan-info-row"><span className="muted">Última vez</span><span>{fmtDT(d.last_seen_at)}</span></div>
                    </div>

                    {caps && (
                      <div className="scan-device-caps">
                        <div className="scan-caps-title">Capacidades</div>
                        <div className="scan-cap-tags">
                          {caps.sources.map(s => (
                            <span key={s} className="scan-cap-tag-sm">{SOURCE_LABEL[s] || s}</span>
                          ))}
                          {caps.duplex && <span className="scan-cap-tag-sm">Dúplex</span>}
                          {caps.resolutions.map(r => (
                            <span key={r} className="scan-cap-tag-sm">{r}dpi</span>
                          ))}
                          {caps.paper_sizes.map(p => (
                            <span key={p} className="scan-cap-tag-sm">{p}</span>
                          ))}
                          {caps.max_pages_adf && (
                            <span className="scan-cap-tag-sm">ADF máx {caps.max_pages_adf} págs</span>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      className="btn"
                      style={{ marginTop: 10, width: '100%' }}
                      onClick={() => { setSelectedDevice(d.id); setTab('escanear'); }}
                    >Usar este dispositivo</button>
                  </div>
                );
              })}

              {!loadingDevices && devices.length === 0 && (
                <div className="scan-empty-state">
                  <div style={{ fontSize: '3rem' }}>🖨️</div>
                  <div>No hay dispositivos registrados</div>
                  <button className="btn" onClick={descubrirDispositivos} disabled={discovering}>
                    {discovering ? '🔄 Buscando…' : '📡 Buscar en red local'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            TAB: COLA
        ══════════════════════════════════════════════ */}
        {tab === 'cola' && (
          <div className="scan-cola-page">
            <div className="scan-devices-toolbar">
              <div className="muted" style={{ fontSize: '0.78rem' }}>
                Actualizando automáticamente cada 3s
                <span className="scan-pulse-dot" />
              </div>
              <button className="btn" onClick={() => cargarJobs()} disabled={loadingJobs}>
                {loadingJobs ? '🔄' : '↺ Actualizar'}
              </button>
            </div>

            {activeJobs.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div className="scan-cola-section">⚡ En progreso y en cola</div>
                <div className="scan-jobs-list">
                  {activeJobs.map(j => (
                    <div key={j.id} className="card scan-job-card active">
                      <div className="scan-job-header">
                        <span className="scan-status-icon" style={{ color: STATUS_COLOR[j.status] }}>
                          {STATUS_ICON[j.status]}
                        </span>
                        <div>
                          <div style={{ fontWeight: 700 }}>Job #{j.id}</div>
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            {j.personal_dni ? `DNI ${j.personal_dni}` : 'Sin agente'}
                            {j.doc_class && j.doc_class !== 'unknown' ? ` · ${TIPOS_DOCUMENTO.find(t => t.value === j.doc_class)?.label || j.doc_class}` : ''}
                          </div>
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                          <div style={{ fontWeight: 600, color: STATUS_COLOR[j.status], fontSize: '0.83rem' }}>
                            {j.status === 'queued' ? 'En cola' : 'Procesando…'}
                          </div>
                          <div className="muted" style={{ fontSize: '0.72rem' }}>{fmtDT(j.created_at)}</div>
                        </div>
                      </div>
                      {j.status === 'queued' && (
                        <button className="btn" style={{ marginTop: 8, fontSize: '0.78rem' }}
                          onClick={() => cancelarJob(j.id)}>Cancelar</button>
                      )}
                      {j.status === 'in_progress' && (
                        <div className="scan-job-progress">
                          <div className="scan-job-bar" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {doneJobs.length > 0 && (
              <div>
                <div className="scan-cola-section">Historial reciente</div>
                <div className="scan-jobs-list">
                  {doneJobs.map(j => (
                    <div key={j.id} className={`card scan-job-card${j.status === 'failed' ? ' failed' : ''}`}>
                      <div className="scan-job-header">
                        <span className="scan-status-icon" style={{ color: STATUS_COLOR[j.status] }}>
                          {STATUS_ICON[j.status]}
                        </span>
                        <div>
                          <div style={{ fontWeight: 600 }}>Job #{j.id}</div>
                          <div className="muted" style={{ fontSize: '0.72rem' }}>
                            {j.personal_dni ? `DNI ${j.personal_dni}` : 'Sin agente'}
                            {j.page_count ? ` · ${j.page_count} págs.` : ''}
                            {j.doc_class && j.doc_class !== 'unknown' ? ` · ${TIPOS_DOCUMENTO.find(t => t.value === j.doc_class)?.label || j.doc_class}` : ''}
                          </div>
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                          <div style={{ fontSize: '0.8rem', color: STATUS_COLOR[j.status], fontWeight: 600 }}>
                            {j.status === 'completed' ? 'Completado' : j.status === 'failed' ? 'Falló' : 'Cancelado'}
                          </div>
                          <div className="muted" style={{ fontSize: '0.72rem' }}>{fmtDT(j.completed_at || j.created_at)}</div>
                        </div>
                      </div>
                      {j.error_message && (
                        <div className="scan-job-err">{j.error_message}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {jobs.length === 0 && !loadingJobs && (
              <div className="scan-empty-state">
                <div style={{ fontSize: '3rem' }}>📭</div>
                <div>No hay jobs en la cola</div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════
            TAB: DOCUMENTOS
        ══════════════════════════════════════════════ */}
        {tab === 'documentos' && (
          <div className="scan-docs-page">
            <div className="card scan-card">
              <div className="scan-section-title">🔍 Buscar documentos escaneados</div>
              <div className="scan-search-grid">
                <div>
                  <div className="muted scan-label">DNI del agente</div>
                  <input className="input" value={dni} placeholder="DNI (Enter)"
                    onChange={e => setDni(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorDni()}
                    style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div className="muted scan-label">Apellido</div>
                  <input className="input" value={fullName} placeholder="Apellido (Enter)"
                    onChange={e => setFullName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorNombre()}
                    style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => buscarPorDni()} disabled={loadingAgente || !dni.trim()}>Buscar</button>
                <button className="btn" onClick={buscarPorNombre} disabled={loadingAgente || !fullName.trim()}>Por nombre</button>
              </div>
              {matches.length > 0 && (
                <div className="scan-matches" style={{ marginTop: 8 }}>
                  {matches.map((m: any) => (
                    <button key={m.dni} className="scan-match-item"
                      onClick={() => { setDni(String(m.dni)); setMatches([]); buscarPorDni(String(m.dni)); }}>
                      <b>{m.apellido}, {m.nombre}</b>
                      <span className="badge" style={{ marginLeft: 8 }}>{m.dni}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {agente && (
              <div className="scan-agente-bar" style={{ margin: '4px 0' }}>
                <div className="scan-agente-name">👤 {agente.apellido}, {agente.nombre}</div>
                <div className="scan-agente-meta">
                  <span className="badge">DNI {agente.dni}</span>
                  <span className="muted scan-ruta-hint">📁 G:\docu\{agente.dni}\</span>
                </div>
              </div>
            )}

            {docHistory.length > 0 && (
              <div className="scan-docs-grid">
                {docHistory.map((d: any) => (
                  <div key={d.id} className="card scan-doc-card">
                    <div className="scan-doc-class-badge">
                      {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.icon || '📄'} {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo || 'doc'}
                    </div>
                    <div className="scan-doc-title">{d.nombre || `Documento #${d.id}`}</div>
                    {d.descripcion_archivo && (
                      <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>{d.descripcion_archivo}</div>
                    )}
                    <div className="muted" style={{ fontSize: '0.72rem', marginTop: 4 }}>
                      {fmtDT(d.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {agente && docHistory.length === 0 && (
              <div className="scan-empty-state" style={{ marginTop: 16 }}>
                <div style={{ fontSize: '2.5rem' }}>📂</div>
                <div>Sin documentos escaneados para este agente</div>
              </div>
            )}

            {!agente && (
              <div className="scan-empty-state" style={{ marginTop: 16 }}>
                <div style={{ fontSize: '2.5rem' }}>🔍</div>
                <div className="muted">Buscá un agente por DNI o apellido</div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
