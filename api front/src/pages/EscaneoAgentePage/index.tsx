// src/pages/EscaneoAgentePage/index.tsx
// Página de escaneo con agente PRE-CARGADO desde la URL (/app/escaneo-agente/:dni)
// Abierta desde AtencionPublicoPage — el DNI ya viene en los params de la ruta.
// Idéntica a EscaneoPage pero arranca con el agente ya seleccionado.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import '../EscaneoPage/styles/EscaneoPage.css';

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
  try { sessionToken = JSON.parse(localStorage.getItem('personalv5.session') || '{}')?.accessToken || ''; } catch {}
  const token = runtimeToken || sessionToken;
  return { 'x-tenant': tenant, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function scannerFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getScannerBase()}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...getScannerHeaders(), ...(opts?.headers || {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.message || e?.error || `HTTP ${res.status}`); }
  return res.json();
}

// ─── Tipos de documento ───────────────────────────────────────────────────────
const TIPOS_DOCUMENTO = [
  { value: 'dni_frente',           label: 'DNI — Frente',                     icon: '🪪' },
  { value: 'dni_dorso',            label: 'DNI — Dorso',                      icon: '🪪' },
  { value: 'titulo_secundario',    label: 'Título Secundario',                icon: '📜' },
  { value: 'titulo_universitario', label: 'Título Universitario / Terciario', icon: '🎓' },
  { value: 'licencia_conducir',    label: 'Licencia de Conducir',             icon: '🚗' },
  { value: 'acta_nacimiento',      label: 'Acta de Nacimiento',               icon: '👶' },
  { value: 'partida_matrimonio',   label: 'Partida de Matrimonio',            icon: '💍' },
  { value: 'contrato_trabajo',     label: 'Contrato de Trabajo',              icon: '📋' },
  { value: 'certificado_medico',   label: 'Certificado Médico',               icon: '🏥' },
  { value: 'certificado_estudio',  label: 'Certificado de Estudios',          icon: '📚' },
  { value: 'recibo_sueldo',        label: 'Recibo de Sueldo',                 icon: '💰' },
  { value: 'declaracion_jurada',   label: 'Declaración Jurada',               icon: '✍️' },
  { value: 'resolucion',           label: 'Resolución',                       icon: '📄' },
  { value: 'nota_pedido',          label: 'Nota / Pedido',                    icon: '📝' },
  { value: 'jubilacion',           label: 'Documentación Jubilación',         icon: '🏦' },
  { value: 'ioma',                 label: 'Documentación IOMA',               icon: '🏥' },
  { value: 'foto_carnet',          label: 'Foto Carnet',                      icon: '📷' },
  { value: 'otro',                 label: 'Otro documento',                   icon: '📦' },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface Device {
  id: number; name: string; driver: string; is_active: boolean;
  last_seen_at: string | null; hostname: string | null; online?: boolean;
  capabilities?: DeviceCapabilities;
}
interface DeviceCapabilities {
  sources: ('flatbed' | 'adf' | 'adf_duplex')[]; resolutions: number[];
  paper_sizes: string[]; color_modes: string[];
  max_pages_adf: number | null; duplex: boolean;
  model: string | null; manufacturer: string | null; online: boolean;
}
interface ScanJob {
  id: number; status: string; page_count: number | null;
  error_message: string | null; personal_dni: number | null;
  personal_ref: string | null; created_at: string;
  completed_at: string | null; device_id: number; doc_class?: string;
}
interface ScanProfile {
  id: number; name: string; dpi: number; color: boolean;
  auto_rotate: boolean; blank_page_detection: boolean;
  compression: string; output_format: string;
}

const STATUS_ICON: Record<string, string> = { queued: '⏳', in_progress: '🔄', completed: '✅', failed: '❌', canceled: '⊘' };
const STATUS_COLOR: Record<string, string> = { queued: '#f59e0b', in_progress: '#6366f1', completed: '#10b981', failed: '#ef4444', canceled: '#64748b' };
const SOURCE_LABEL: Record<string, string> = { flatbed: '🪟 Vidrio plano', adf: '📄 ADF (alimentador)', adf_duplex: '📄 ADF Dúplex' };

function fmtDT(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}
function deviceOnline(d: Device) {
  if (typeof d.online === 'boolean') return d.online;
  if (!d.last_seen_at) return false;
  return (Date.now() - new Date(d.last_seen_at).getTime()) < 90_000;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function EscaneoAgentePage() {
  const { dni: dniParam } = useParams<{ dni: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  // Agente — pre-cargado desde la URL
  const [agente, setAgente]   = useState<any>(null);
  const [loadingAgente, setLoadingAgente] = useState(false);
  const [docHistory, setDocHistory] = useState<any[]>([]);

  // Tipo de documento — OBLIGATORIO
  const [tipoDoc, setTipoDoc]       = useState<string>('');
  const [descripcion, setDescripcion] = useState('');

  // Dispositivos
  const [devices, setDevices]               = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [discovering, setDiscovering]       = useState(false);
  const [profiles, setProfiles]             = useState<ScanProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);

  // Opciones escaneo
  const [source, setSource] = useState<string>('flatbed');
  const [dpi, setDpi]       = useState<number>(300);
  const [color, setColor]   = useState(true);
  const [duplex, setDuplex] = useState(false);

  // Cola
  const [jobs, setJobs]               = useState<ScanJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showCola, setShowCola]       = useState(false);

  // Lanzar
  const [launching, setLaunching] = useState(false);

  // ── Cargar agente al montar ───────────────────────────────────────────────
  useEffect(() => {
    if (!dniParam) return;
    const clean = dniParam.replace(/\D/g, '');
    if (!clean) return;
    setLoadingAgente(true);
    apiFetch<any>(`/personal/${clean}`)
      .then(res => {
        if (!res?.ok || !res?.data) { toast.error('Agente no encontrado', `DNI ${clean}`); return; }
        const row = { ...res.data, dni: res.data.dni || Number(clean) };
        setAgente(row);
        // Cargar historial documentos escaneados
        apiFetch<any>(`/scanner/documents/${clean}`)
          .then(r => setDocHistory(r?.data || []))
          .catch(() => setDocHistory([]));
      })
      .catch((e: any) => toast.error('Error al cargar agente', e?.message))
      .finally(() => setLoadingAgente(false));
  }, [dniParam]);

  // ── Cargar dispositivos y perfiles ───────────────────────────────────────
  const cargarDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const r = await scannerFetch<{ items: Device[] }>('/v1/devices?limit=50');
      const devs = r.items || [];
      const withCaps = await Promise.all(devs.map(async (d) => {
        if (!deviceOnline(d)) return d;
        try { const caps = await scannerFetch<DeviceCapabilities>(`/v1/devices/${d.id}/capabilities`); return { ...d, capabilities: caps }; }
        catch { return d; }
      }));
      setDevices(withCaps);
      if (!selectedDevice && withCaps.length) {
        const onlineFirst = withCaps.find(d => deviceOnline(d));
        if (onlineFirst) setSelectedDevice(onlineFirst.id);
      }
    } catch (e: any) { toast.error('Scanner no disponible', e?.message); }
    finally { setLoadingDevices(false); }
  }, [selectedDevice]);

  useEffect(() => {
    cargarDevices();
    scannerFetch<{ items: ScanProfile[] }>('/v1/profiles')
      .then(r => setProfiles(r.items || []))
      .catch(() => {});
  }, []);

  // ── Polling de cola ───────────────────────────────────────────────────────
  const cargarJobs = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoadingJobs(true);
    try {
      const r = await scannerFetch<{ items: ScanJob[] }>(`/v1/scan-jobs?limit=20${dniParam ? `&personal_dni=${dniParam}` : ''}`);
      setJobs(r.items || []);
    } catch {}
    finally { if (!silencioso) setLoadingJobs(false); }
  }, [dniParam]);

  useEffect(() => {
    if (showCola) {
      cargarJobs();
      pollingRef.current = setInterval(() => cargarJobs(true), 3000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [showCola, cargarJobs]);

  // ── Lanzar escaneo ────────────────────────────────────────────────────────
  const validarYLanzar = useCallback(async () => {
    if (!agente) { toast.error('Sin agente'); return; }
    if (!tipoDoc) { toast.error('Tipo de documento requerido', 'Seleccioná qué documento vas a escanear'); return; }
    if (!selectedDevice) { toast.error('Seleccioná un dispositivo'); return; }

    const tipoLabel = TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label || tipoDoc;
    setLaunching(true);
    try {
      const body: any = {
        device_id: selectedDevice, profile_id: selectedProfile || undefined,
        priority: 5, personal_dni: agente.dni, personal_ref: tipoDoc, doc_class: tipoDoc,
      };
      const r = await scannerFetch<{ id: number; pending_tramites?: any[] }>('/v1/scan-jobs', {
        method: 'POST', body: JSON.stringify(body),
      });

      try {
        await apiFetch('/scanner/registrar-escaneo', {
          method: 'POST',
          body: JSON.stringify({ dni: agente.dni, tipo_documento: tipoDoc, descripcion: descripcion.trim() || tipoLabel, nombre_archivo: `scan-job-${r.id}.pdf` }),
        });
      } catch {}

      toast.ok(`✅ Job #${r.id} creado`, `${tipoLabel} para DNI ${agente.dni}`);
      setTipoDoc(''); setDescripcion('');
      setShowCola(true);
      setTimeout(() => cargarJobs(), 800);
    } catch (e: any) {
      toast.error('Error al lanzar scan', e?.message);
    } finally { setLaunching(false); }
  }, [agente, tipoDoc, selectedDevice, selectedProfile, descripcion, cargarJobs]);

  const device   = devices.find(d => d.id === selectedDevice) || null;
  const caps     = device?.capabilities;
  const isOnline = device ? deviceOnline(device) : false;
  const puedeEscanear = !!agente && !!tipoDoc && !!selectedDevice;

  const activeJobs = jobs.filter(j => ['queued', 'in_progress'].includes(j.status));
  const doneJobs   = jobs.filter(j => !['queued', 'in_progress'].includes(j.status));

  return (
    <Layout title="Escanear documento" showBack>
      <div className="scan-page">

        {/* ── Banner del agente (fijo en el top) ── */}
        <div className="card scan-card" style={{ marginBottom: 12, borderLeft: '3px solid #10b981' }}>
          {loadingAgente ? (
            <div className="muted">🔄 Cargando agente…</div>
          ) : agente ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>
                  👤 {agente.apellido}, {agente.nombre}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                  <span className="badge">DNI {agente.dni}</span>
                  {agente.dependencia_nombre && <span className="muted" style={{ fontSize: '0.78rem' }}>{agente.dependencia_nombre}</span>}
                  {agente.ley_nombre && <span className="muted" style={{ fontSize: '0.78rem' }}>{agente.ley_nombre}</span>}
                </div>
                <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4, fontFamily: 'monospace' }}>
                  📁 Se guardará en: …\docu\{agente.dni}\
                </div>
              </div>
              <button
                className="btn"
                style={{ marginLeft: 'auto', fontSize: '0.78rem' }}
                onClick={() => navigate('/app/atencion')}
              >
                ← Volver a Atención
              </button>
            </div>
          ) : (
            <div className="muted">⚠️ DNI {dniParam} — agente no encontrado</div>
          )}
        </div>

        <div className="scan-layout">
          {/* IZQUIERDA: tipo de documento */}
          <div className="scan-col">

            {/* Tipo de documento OBLIGATORIO */}
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
              {!tipoDoc && <div className="scan-required-hint">⚠️ Seleccioná qué documento vas a escanear</div>}
              {tipoDoc && (
                <div className="scan-tipo-selected">
                  ✅ {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.icon} {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label}
                </div>
              )}
              <div className="muted scan-label" style={{ marginTop: 12 }}>Descripción adicional (opcional)</div>
              <input
                className="input"
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                placeholder="Ej: Renovación 2024, frente y dorso…"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            {/* Documentos escaneados previos */}
            {docHistory.length > 0 && (
              <div className="card scan-card">
                <div className="scan-section-title">🗂️ Documentos previos ({docHistory.length})</div>
                <div className="scan-doc-list">
                  {docHistory.slice(0, 6).map((d: any) => (
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

          {/* DERECHA: dispositivo + lanzar + cola */}
          <div className="scan-col">

            {/* Dispositivo */}
            <div className="card scan-card">
              <div className="scan-section-title">🖨️ Dispositivo</div>
              {loadingDevices ? (
                <div className="muted">Cargando dispositivos…</div>
              ) : devices.length === 0 ? (
                <div className="scan-no-devices">
                  <div style={{ fontSize: '2rem' }}>🔍</div>
                  <div>No hay dispositivos registrados</div>
                  <button className="btn" onClick={() => scannerFetch('/v1/devices/discover', { method: 'POST' }).then(() => cargarDevices()).catch(() => {})} disabled={discovering}>
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
                          <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>{online ? 'En línea' : 'Sin conexión'}</span>
                        </div>
                        {d.hostname && <div className="muted" style={{ fontSize: '0.72rem', paddingLeft: 18 }}>{d.hostname} · {d.driver}</div>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Configuración del dispositivo */}
            {caps && (
              <div className="card scan-card">
                <div className="scan-section-title">⚙️ Configuración</div>
                <div className="muted scan-label">Bandeja</div>
                <div className="scan-caps-grid">
                  {caps.sources.map(s => (
                    <button key={s} className={`scan-cap-btn${source === s ? ' selected' : ''}`}
                      onClick={() => { setSource(s); if (s !== 'adf_duplex') setDuplex(false); }}>
                      {SOURCE_LABEL[s] || s}
                    </button>
                  ))}
                </div>
                <div className="muted scan-label" style={{ marginTop: 10 }}>Resolución</div>
                <div className="scan-caps-grid">
                  {(caps.resolutions.length ? caps.resolutions : [150, 300, 600]).map(r => (
                    <button key={r} className={`scan-cap-btn${dpi === r ? ' selected' : ''}`} onClick={() => setDpi(r)}>{r} dpi</button>
                  ))}
                </div>
                <div className="muted scan-label" style={{ marginTop: 10 }}>Color</div>
                <div className="scan-caps-grid">
                  {(caps.color_modes.length ? caps.color_modes : ['color', 'gris']).map(m => (
                    <button key={m} className={`scan-cap-btn${(color ? 'color' : 'gris') === m ? ' selected' : ''}`}
                      onClick={() => setColor(m === 'color')}>
                      {m === 'color' ? '🎨 Color' : '⬜ Grises'}
                    </button>
                  ))}
                </div>
                {(source === 'adf' || source === 'adf_duplex') && caps.duplex && (
                  <label className="scan-checkbox-row" style={{ marginTop: 10 }}>
                    <input type="checkbox" checked={duplex} onChange={e => setDuplex(e.target.checked)} />
                    <span>Escanear ambas caras</span>
                  </label>
                )}
              </div>
            )}

            {/* Perfiles */}
            {profiles.length > 0 && (
              <div className="card scan-card">
                <div className="scan-section-title">📋 Perfil</div>
                <div className="scan-caps-grid">
                  <button className={`scan-cap-btn${!selectedProfile ? ' selected' : ''}`} onClick={() => setSelectedProfile(null)}>Manual</button>
                  {profiles.map(p => (
                    <button key={p.id} className={`scan-cap-btn${selectedProfile === p.id ? ' selected' : ''}`}
                      onClick={() => { setSelectedProfile(p.id); setDpi(p.dpi); setColor(p.color); }}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Lanzar */}
            <div className="card scan-card scan-launch-card">
              <div className="scan-section-title">🚀 Lanzar Escaneo</div>
              <div className="scan-checklist">
                <div className={`scan-check-item${agente ? ' ok' : ' pending'}`}>
                  {agente ? '✅' : '⭕'} Agente
                  {agente && <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>DNI {agente.dni}</span>}
                </div>
                <div className={`scan-check-item${tipoDoc ? ' ok' : ' pending'}`}>
                  {tipoDoc ? '✅' : '⭕'} Tipo de documento
                  {tipoDoc && <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>{TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label}</span>}
                </div>
                <div className={`scan-check-item${selectedDevice ? ' ok' : ' pending'}`}>
                  {selectedDevice ? '✅' : '⭕'} Dispositivo
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
                    <span><span className={`scan-dot${isOnline ? ' online' : ''}`} style={{ marginRight: 6 }} />{device.name}</span>
                  </div>
                </div>
              )}

              {!isOnline && device && (
                <div className="scan-warn">⚠️ Dispositivo offline — el job quedará en cola.</div>
              )}

              <button
                className={`btn scan-btn-launch${puedeEscanear ? ' ready' : ''}`}
                onClick={validarYLanzar}
                disabled={launching || !puedeEscanear}
              >
                {launching ? '⏳ Enviando…' : !tipoDoc ? '🗂️ Falta el tipo de documento' : !selectedDevice ? '🖨️ Falta el dispositivo' : '▶ Iniciar Escaneo'}
              </button>
            </div>

            {/* Cola de jobs (toggle) */}
            <div className="card scan-card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="scan-section-title" style={{ marginBottom: 0 }}>
                  ⏳ Cola de escaneo
                  {activeJobs.length > 0 && (
                    <span className="badge" style={{ marginLeft: 8, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc' }}>
                      {activeJobs.length} activo{activeJobs.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => { setShowCola(v => !v); if (!showCola) cargarJobs(); }}>
                  {showCola ? 'Ocultar' : 'Ver cola'}
                </button>
              </div>

              {showCola && (
                <div style={{ marginTop: 12 }}>
                  {loadingJobs ? (
                    <div className="muted" style={{ fontSize: '0.82rem' }}>🔄 Cargando…</div>
                  ) : jobs.length === 0 ? (
                    <div className="muted" style={{ fontSize: '0.82rem' }}>Sin jobs para este agente</div>
                  ) : (
                    <div className="scan-jobs-list">
                      {[...activeJobs, ...doneJobs].slice(0, 10).map(j => (
                        <div key={j.id} className={`card scan-job-card${j.status === 'failed' ? ' failed' : activeJobs.includes(j) ? ' active' : ''}`} style={{ padding: '10px 12px' }}>
                          <div className="scan-job-header">
                            <span style={{ color: STATUS_COLOR[j.status], fontSize: '1.1rem' }}>{STATUS_ICON[j.status]}</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Job #{j.id}</div>
                              <div className="muted" style={{ fontSize: '0.72rem' }}>
                                {TIPOS_DOCUMENTO.find(t => t.value === j.doc_class)?.label || j.doc_class || 'doc'} · {fmtDT(j.created_at)}
                              </div>
                            </div>
                            <div style={{ marginLeft: 'auto', fontSize: '0.78rem', color: STATUS_COLOR[j.status], fontWeight: 600 }}>
                              {j.status === 'queued' ? 'En cola' : j.status === 'in_progress' ? 'Procesando' : j.status === 'completed' ? 'Listo' : j.status}
                            </div>
                          </div>
                          {j.status === 'in_progress' && (
                            <div className="scan-job-progress" style={{ marginTop: 8 }}><div className="scan-job-bar" /></div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </Layout>
  );
}
