// src/pages/EscaneoAgentePage/index.tsx
// Página de escaneo — v4
//  · Scanners favoritos (★, guardados en localStorage)
//  · Multi-página: escanea una o más páginas y luego guarda
//  · Vista previa inline con auth (blob URL) — las imágenes SÍ se ven
//  · No abre la cola automáticamente

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import '../EscaneoPage/styles/EscaneoPage.css';

// ─── Scanner API helpers ──────────────────────────────────────────────────────
function getScannerBase(): string {
  const cfg = (window as any).__RUNTIME_CONFIG__ || {};
  return (cfg.scannerApiUrl || (import.meta as any)?.env?.VITE_SCANNER_API_URL || 'http://localhost:3001').replace(/\/$/, '');
}
function getScannerHeaders(): Record<string, string> {
  const cfg = (window as any).__RUNTIME_CONFIG__ || {};
  const tenant = cfg.scannerTenantId || (import.meta as any)?.env?.VITE_SCANNER_TENANT_ID || '1';
  let token = cfg.scannerToken || (import.meta as any)?.env?.VITE_SCANNER_TOKEN || '';
  if (!token) {
    try {
      token = JSON.parse(
        localStorage.getItem('personalv5.session') || sessionStorage.getItem('personalv5.session') || '{}'
      )?.accessToken || '';
    } catch {}
  }
  return { 'x-tenant': tenant, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function scannerFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getScannerBase()}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...getScannerHeaders(), ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.message || e?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Carga una imagen del scanner con auth y devuelve un blob URL
async function loadScanImage(storageKey: string): Promise<string> {
  const url = `${getScannerBase()}/v1/documents/files/${storageKey}`;
  const res = await fetch(url, { headers: getScannerHeaders() });
  if (!res.ok) throw new Error(`No se pudo cargar la imagen (HTTP ${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
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
  capabilities?: DeviceCaps;
}
interface DeviceCaps {
  sources: string[]; resolutions: number[];
  paper_sizes: string[]; color_modes: string[];
  max_pages_adf: number | null; duplex: boolean;
  model: string | null; manufacturer: string | null; online: boolean;
}
interface ScanProfile {
  id: number; name: string; dpi: number; color: boolean;
  auto_rotate: boolean; blank_page_detection: boolean;
  compression: string; output_format: string;
}
interface ScannedPage {
  jobId: number;
  pageNumber: number;
  storageKey: string;
  blobUrl: string | null;
  loadError: boolean;
}
type ScanPhase = 'idle' | 'creating' | 'waiting' | 'loading_pages' | 'done' | 'error';

const SOURCE_LABEL: Record<string, string> = {
  flatbed: '🪟 Vidrio plano',
  adf: '📄 ADF (alimentador)',
  adf_duplex: '📄 ADF Dúplex',
};

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

// ─── Favoritos (localStorage) ─────────────────────────────────────────────────
const FAV_KEY = 'scanner_favorites_v1';
function loadFavorites(): number[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(ids: number[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch {}
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function EscaneoAgentePage() {
  const { dni: dniParam } = useParams<{ dni: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [agente, setAgente]             = useState<any>(null);
  const [loadingAgente, setLoadingAgente] = useState(false);
  const [docHistory, setDocHistory]     = useState<any[]>([]);

  const [tipoDoc, setTipoDoc]           = useState<string>('');
  const [descripcion, setDescripcion]   = useState('');

  const [devices, setDevices]             = useState<Device[]>([]);
  const [favorites, setFavorites]         = useState<number[]>(loadFavorites);
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [profiles, setProfiles]           = useState<ScanProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);

  const [source, setSource] = useState<string>('flatbed');
  const [dpi, setDpi]       = useState<number>(300);
  const [color, setColor]   = useState(true);
  const [duplex, setDuplex] = useState(false);

  const [session, setSession]     = useState<ScannedPage[]>([]);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);

  const blobUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => { blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u)); };
  }, []);

  // ── Cargar agente ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dniParam) return;
    const clean = dniParam.replace(/\D/g, '');
    if (!clean) return;
    setLoadingAgente(true);
    apiFetch<any>(`/personal/${clean}`)
      .then(res => {
        if (!res?.ok || !res?.data) { toast.error('Agente no encontrado', `DNI ${clean}`); return; }
        setAgente({ ...res.data, dni: res.data.dni || Number(clean) });
        apiFetch<any>(`/scanner/documents/${clean}`)
          .then(r => setDocHistory(r?.data || []))
          .catch(() => {});
      })
      .catch((e: any) => toast.error('Error al cargar agente', e?.message))
      .finally(() => setLoadingAgente(false));
  }, [dniParam]);

  // ── Cargar dispositivos ─────────────────────────────────────────────────────
  const cargarDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const r = await scannerFetch<{ items: Device[] }>('/v1/devices?limit=50');
      const devs = r.items || [];
      const withCaps = await Promise.all(devs.map(async (d) => {
        if (!deviceOnline(d)) return d;
        try {
          const caps = await scannerFetch<DeviceCaps>(`/v1/devices/${d.id}/capabilities`);
          return { ...d, capabilities: caps };
        } catch { return d; }
      }));
      setDevices(withCaps);
      setSelectedDevice(prev => {
        if (prev && withCaps.find(d => d.id === prev)) return prev;
        const favOnline = withCaps.find(d => favorites.includes(d.id) && deviceOnline(d));
        if (favOnline) return favOnline.id;
        const anyOnline = withCaps.find(d => deviceOnline(d));
        return anyOnline?.id ?? (withCaps[0]?.id ?? null);
      });
    } catch (e: any) {
      toast.error('Scanner no disponible', e?.message);
    } finally {
      setLoadingDevices(false);
    }
  }, [favorites]);

  useEffect(() => {
    cargarDevices();
    scannerFetch<{ items: ScanProfile[] }>('/v1/profiles')
      .then(r => setProfiles(r.items || []))
      .catch(() => {});
  }, []);

  // ── Toggle favorito ─────────────────────────────────────────────────────────
  const toggleFavorite = useCallback((deviceId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId];
      saveFavorites(next);
      return next;
    });
  }, []);

  // ── Poll job ────────────────────────────────────────────────────────────────
  async function pollJob(jobId: number, maxMs = 120_000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 2500));
      const job = await scannerFetch<any>(`/v1/scan-jobs/${jobId}`);
      if (['completed', 'failed', 'canceled'].includes(job.status)) return job.status;
    }
    throw new Error('Tiempo de espera agotado (120s)');
  }

  // ── Escanear página ─────────────────────────────────────────────────────────
  const escanearPagina = useCallback(async () => {
    if (!agente || !tipoDoc || !selectedDevice) return;
    setScanPhase('creating');
    setScanError(null);
    try {
      const tipoLabel = TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label || tipoDoc;
      const job = await scannerFetch<{ id: number }>('/v1/scan-jobs', {
        method: 'POST',
        body: JSON.stringify({
          device_id: selectedDevice,
          profile_id: selectedProfile || undefined,
          priority: 5,
          personal_dni: agente.dni,
          personal_ref: tipoDoc,
          doc_class: tipoDoc,
        }),
      });

      apiFetch('/scanner/registrar-escaneo', {
        method: 'POST',
        body: JSON.stringify({
          dni: agente.dni,
          tipo_documento: tipoDoc,
          descripcion: descripcion.trim() || tipoLabel,
          nombre_archivo: `scan-job-${job.id}.pdf`,
        }),
      }).catch(() => {});

      setScanPhase('waiting');
      const status = await pollJob(job.id);
      if (status !== 'completed') throw new Error(`Escaneo terminó con estado: ${status}`);

      setScanPhase('loading_pages');
      const pagesRes = await scannerFetch<{ doc_id: number | null; pages: any[] }>(
        `/v1/scan-jobs/${job.id}/pages`
      );
      if (!pagesRes.pages?.length) throw new Error('El agente no subió ninguna página');

      const newPages: ScannedPage[] = pagesRes.pages.map(p => ({
        jobId: job.id,
        pageNumber: p.page_number,
        storageKey: p.storage_key,
        blobUrl: null,
        loadError: false,
      }));
      setSession(prev => [...prev, ...newPages]);

      // Cargar imágenes con auth en background
      pagesRes.pages.forEach(async (p) => {
        try {
          const blobUrl = await loadScanImage(p.storage_key);
          blobUrlsRef.current.push(blobUrl);
          setSession(prev => prev.map(pg => pg.storageKey === p.storage_key ? { ...pg, blobUrl } : pg));
        } catch {
          setSession(prev => prev.map(pg => pg.storageKey === p.storage_key ? { ...pg, loadError: true } : pg));
        }
      });

      setScanPhase('done');
      toast.ok('✅ Escaneado', `${pagesRes.pages.length} hoja(s) — ${tipoLabel}`);
    } catch (e: any) {
      setScanPhase('error');
      setScanError(e?.message || 'Error desconocido');
      toast.error('Error en el escaneo', e?.message);
    }
  }, [agente, tipoDoc, selectedDevice, selectedProfile, descripcion]);

  // ── Guardar sesión ──────────────────────────────────────────────────────────
  const guardarSesion = useCallback(async () => {
    if (!session.length || !agente) return;
    setSaving(true);
    try {
      toast.ok('✅ Guardado', `${session.length} página(s) registradas`);
      apiFetch<any>(`/scanner/documents/${agente.dni}`)
        .then(r => setDocHistory(r?.data || [])).catch(() => {});
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      blobUrlsRef.current = [];
      setSession([]);
      setScanPhase('idle');
      setScanError(null);
    } finally {
      setSaving(false);
    }
  }, [session, agente]);

  const descartarSesion = useCallback(() => {
    blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
    blobUrlsRef.current = [];
    setSession([]);
    setScanPhase('idle');
    setScanError(null);
  }, []);

  const quitarPagina = useCallback((storageKey: string) => {
    setSession(prev => {
      const page = prev.find(p => p.storageKey === storageKey);
      if (page?.blobUrl) URL.revokeObjectURL(page.blobUrl);
      return prev.filter(p => p.storageKey !== storageKey);
    });
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const device     = devices.find(d => d.id === selectedDevice) || null;
  const caps       = device?.capabilities;
  const isOnline   = device ? deviceOnline(device) : false;
  const isScanning = ['creating', 'waiting', 'loading_pages'].includes(scanPhase);
  const canScan    = !!agente && !!tipoDoc && !!selectedDevice && !isScanning;
  const hasPages   = session.length > 0;

  const sortedDevices = [...devices].sort((a, b) => {
    const af = favorites.includes(a.id) ? 0 : 1;
    const bf = favorites.includes(b.id) ? 0 : 1;
    if (af !== bf) return af - bf;
    return (deviceOnline(a) ? 0 : 1) - (deviceOnline(b) ? 0 : 1);
  });

  const scanPhaseLabel: Record<ScanPhase, string> = {
    idle: '', creating: '📡 Creando trabajo…',
    waiting: '⏳ Esperando al escáner…',
    loading_pages: '🖼️ Cargando páginas…',
    done: '', error: '',
  };

  return (
    <Layout title="Escanear documento" showBack>
      <div className="scan-page">

        {/* ── Banner agente ── */}
        <div className="card scan-card" style={{ marginBottom: 0, borderLeft: '3px solid #10b981' }}>
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
              </div>
              <button className="btn" style={{ marginLeft: 'auto', fontSize: '0.78rem' }} onClick={() => navigate('/app/atencion')}>
                ← Atención
              </button>
            </div>
          ) : (
            <div className="muted">⚠️ DNI {dniParam} — agente no encontrado</div>
          )}
        </div>

        <div className="scan-layout">
          {/* ── IZQUIERDA ── */}
          <div className="scan-col">
            <div className={`card scan-card${!tipoDoc ? ' scan-card-required' : ' scan-card-ok'}`}>
              <div className="scan-section-title">
                🗂️ Tipo de Documento
                <span className="scan-required-badge">obligatorio</span>
              </div>
              <div className="scan-tipos-grid">
                {TIPOS_DOCUMENTO.map(t => (
                  <button key={t.value} className={`scan-tipo-btn${tipoDoc === t.value ? ' selected' : ''}`}
                    onClick={() => setTipoDoc(t.value)} type="button">
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
              <input className="input" value={descripcion} onChange={e => setDescripcion(e.target.value)}
                placeholder="Ej: Renovación 2024, frente y dorso…" style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>

            {docHistory.length > 0 && (
              <div className="card scan-card">
                <div className="scan-section-title">🗂️ Documentos previos ({docHistory.length})</div>
                <div className="scan-doc-list">
                  {docHistory.slice(0, 6).map((d: any) => (
                    <div key={d.id} className="scan-doc-item">
                      <div className="scan-doc-class">{TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.icon || '📄'}</div>
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

          {/* ── DERECHA ── */}
          <div className="scan-col">

            {/* Escáneres con favoritos */}
            <div className="card scan-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div className="scan-section-title" style={{ marginBottom: 0 }}>🖨️ Escáner</div>
                <button className="btn" style={{ fontSize: '0.72rem', padding: '4px 10px' }}
                  onClick={cargarDevices} disabled={loadingDevices}>
                  {loadingDevices ? '🔄' : '↺ Refrescar'}
                </button>
              </div>
              {loadingDevices ? (
                <div className="muted" style={{ fontSize: '0.83rem' }}>Cargando…</div>
              ) : sortedDevices.length === 0 ? (
                <div className="scan-no-devices">
                  <div style={{ fontSize: '2rem' }}>🔍</div>
                  <div>No hay dispositivos registrados</div>
                  <button className="btn"
                    onClick={() => scannerFetch('/v1/devices/discover', { method: 'POST' }).then(() => cargarDevices()).catch(() => {})}>
                    📡 Buscar en red
                  </button>
                </div>
              ) : (
                <div className="scan-device-list">
                  {sortedDevices.map(d => {
                    const online = deviceOnline(d);
                    const isFav  = favorites.includes(d.id);
                    return (
                      <button key={d.id}
                        className={`scan-device-btn${selectedDevice === d.id ? ' selected' : ''}${!online ? ' offline' : ''}`}
                        onClick={() => setSelectedDevice(d.id)}>
                        <div className="scan-device-row">
                          <span
                            title={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
                            style={{ fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0,
                              color: isFav ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}
                            onClick={e => toggleFavorite(d.id, e)}
                          >{isFav ? '★' : '☆'}</span>
                          <span className={`scan-dot${online ? ' online' : ''}`} />
                          <b style={{ flexGrow: 1, textAlign: 'left' }}>{d.name}</b>
                          <span className="muted" style={{ fontSize: '0.72rem' }}>{online ? 'En línea' : 'Sin conexión'}</span>
                        </div>
                        {d.hostname && (
                          <div className="muted" style={{ fontSize: '0.7rem', paddingLeft: 40 }}>
                            {d.hostname} · {d.driver}
                            {isFav && <span style={{ marginLeft: 6, color: '#fbbf24', fontSize: '0.65rem' }}>★ FAV</span>}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Configuración */}
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
                <div className="scan-section-title">📋 Perfil de escaneo</div>
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

            {/* Botones de acción */}
            <div className="card scan-card scan-launch-card">
              <div className="scan-section-title">🚀 Escaneo</div>
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
                  {selectedDevice ? '✅' : '⭕'} Escáner
                  {device && <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>{device.name}</span>}
                </div>
              </div>

              {!isOnline && device && (
                <div className="scan-warn">⚠️ Dispositivo offline — verificá la conexión</div>
              )}

              {isScanning && (
                <div style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 10,
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                  fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="scan-pulse-dot" />
                  {scanPhaseLabel[scanPhase]}
                </div>
              )}

              {scanPhase === 'error' && scanError && (
                <div className="scan-job-err" style={{ marginBottom: 10 }}>❌ {scanError}</div>
              )}

              <button className={`btn scan-btn-launch${canScan ? ' ready' : ''}`}
                onClick={escanearPagina} disabled={!canScan}>
                {isScanning ? (scanPhaseLabel[scanPhase] || '⏳ Escaneando…')
                  : hasPages ? '📄 Escanear otra página'
                  : !tipoDoc ? '🗂️ Falta el tipo de documento'
                  : !selectedDevice ? '🖨️ Falta el escáner'
                  : '▶ Escanear'}
              </button>

              {hasPages && !isScanning && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn" style={{ flex: 1,
                    background: 'rgba(16,185,129,0.15)', borderColor: '#10b981', color: '#6ee7b7' }}
                    onClick={guardarSesion} disabled={saving}>
                    {saving ? '⏳ Guardando…' : `✅ Guardar ${session.length} pág.`}
                  </button>
                  <button className="btn" style={{
                    background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}
                    onClick={descartarSesion} disabled={saving} title="Descartar sesión">
                    🗑️
                  </button>
                </div>
              )}
            </div>

            {/* Vista previa de páginas escaneadas */}
            {hasPages && (
              <div className="card scan-card">
                <div className="scan-section-title">
                  🖼️ Páginas escaneadas
                  <span className="badge" style={{ marginLeft: 6, background: 'rgba(16,185,129,0.2)', color: '#6ee7b7' }}>
                    {session.length} pág.
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                  {session.map((page, idx) => (
                    <div key={page.storageKey} style={{
                      position: 'relative', borderRadius: 8, overflow: 'hidden',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      aspectRatio: '0.71', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {page.blobUrl ? (
                        <img src={page.blobUrl} alt={`Página ${idx + 1}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : page.loadError ? (
                        <div style={{ textAlign: 'center', padding: 8, fontSize: '0.7rem', color: '#fca5a5' }}>
                          ❌<br />Error al cargar
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: 8, fontSize: '0.7rem', color: '#94a3b8' }}>
                          <div className="scan-pulse-dot" style={{ margin: '0 auto 6px' }} />
                          Cargando…
                        </div>
                      )}
                      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0,
                        textAlign: 'center', fontSize: '0.65rem',
                        background: 'rgba(0,0,0,0.6)', color: '#e2e8f0', padding: '2px 0' }}>
                        Pág. {idx + 1}
                      </div>
                      <button onClick={() => quitarPagina(page.storageKey)} style={{
                        position: 'absolute', top: 3, right: 3, width: 20, height: 20,
                        borderRadius: '50%', background: 'rgba(239,68,68,0.8)',
                        border: 'none', cursor: 'pointer', color: 'white',
                        fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }} title="Quitar página">×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </Layout>
  );
}
