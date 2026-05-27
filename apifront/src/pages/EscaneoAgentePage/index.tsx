// src/pages/EscaneoAgentePage/index.tsx
// Igual a EscaneoPage pero el agente viene del parámetro de ruta (:dni)
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import '../EscaneoPage/styles/EscaneoPage.css';

// ─── Scanner API client ───────────────────────────────────────────────────────
function getScannerBase() {
  const cfg = (window as any).__RUNTIME_CONFIG__ || {};
  return (cfg.scannerApiUrl || (import.meta as any)?.env?.VITE_SCANNER_API_URL || 'http://localhost:3002').replace(/\/$/, '');
}
function getScannerHeaders(): Record<string, string> {
  const cfg = (window as any).__RUNTIME_CONFIG__ || {};
  const tenant = cfg.scannerTenantId || (import.meta as any)?.env?.VITE_SCANNER_TENANT_ID || '1';
  const runtimeToken = cfg.scannerToken || (import.meta as any)?.env?.VITE_SCANNER_TOKEN || '';
  let sessionToken = '';
  try {
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

async function loadScanImage(storageKey: string): Promise<string> {
  const url = `${getScannerBase()}/v1/documents/files/${storageKey}`;
  const res = await fetch(url, { headers: getScannerHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ─── Favoritos en localStorage ────────────────────────────────────────────────
const FAV_KEY = 'scanner_favorites_v1';
function loadFavorites(): number[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(ids: number[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch {}
}

// ─── Tipos de documento ───────────────────────────────────────────────────────
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
  { value: 'cert_rotacion',        label: 'Certificación de rotación',       icon: '🔄' },
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
type PaperState = 'loaded' | 'empty' | 'unknown';
interface PaperStatus {
  device_id: number;
  adf: PaperState;
  flatbed: PaperState;
  flatbed_detectable?: boolean;
  engine?: 'escl' | 'wia' | 'mixed' | 'none';
  adf_raw?: string | null;
  flatbed_raw?: string | null;
  message?: string;
  checked_at?: string;
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
interface ScannedPage {
  jobId: number; pageNumber: number;
  storageKey: string; blobUrl: string | null; loadError: boolean;
}
type ScanPhase = 'idle' | 'creating' | 'waiting' | 'loading_pages' | 'done' | 'error';

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
const PAPER_LABEL: Record<PaperState, string> = {
  loaded: 'Con hojas', empty: 'Sin hojas', unknown: 'No detectable',
};

function paperClass(state?: PaperState | null) {
  if (state === 'loaded') return ' ok';
  if (state === 'empty') return ' danger';
  return ' unknown';
}
function fmtDT(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch { return s; }
}
function deviceOnline(d: Device) {
  if (d.capabilities?.online === true) return true;
  if (typeof d.online === 'boolean') return d.online;
  if (!d.last_seen_at) return false;
  return (Date.now() - new Date(d.last_seen_at).getTime()) < 10 * 60_000;
}
function normSearch(value: any) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
function normalizeCaps(caps?: Partial<DeviceCapabilities> | null): DeviceCapabilities {
  return {
    sources: (Array.isArray(caps?.sources) && caps!.sources!.length ? caps!.sources! : ['flatbed']) as DeviceCapabilities['sources'],
    resolutions: Array.isArray(caps?.resolutions) && caps!.resolutions!.length ? caps!.resolutions! : [150, 300, 600],
    paper_sizes: Array.isArray(caps?.paper_sizes) && caps!.paper_sizes!.length ? caps!.paper_sizes! : ['A4'],
    color_modes: Array.isArray(caps?.color_modes) && caps!.color_modes!.length ? caps!.color_modes! : ['color', 'grayscale'],
    max_pages_adf: caps?.max_pages_adf ?? null,
    duplex: caps?.duplex === true,
    model: caps?.model ?? null,
    manufacturer: caps?.manufacturer ?? null,
    online: caps?.online ?? true,
  };
}

type Tab = 'escanear' | 'dispositivos' | 'cola' | 'documentos';
const DEVICE_PAGE_SIZE = 4;
type OutputFormat = 'pdf' | 'pdf_a' | 'tiff' | 'jpg';
type ViewerState = {
  title: string; url: string; contentType?: string;
  filename?: string | null; kind: 'scan' | 'document'; revokeOnClose: boolean;
} | null;

// ─── Componente principal ─────────────────────────────────────────────────────
export function EscaneoAgentePage() {
  const { dni: dniParam } = useParams<{ dni: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('escanear');

  // Agente (cargado desde URL param)
  const [agente, setAgente]               = useState<any>(null);
  const [loadingAgente, setLoadingAgente] = useState(false);

  // Tipo de documento y descripción
  const [tipoDoc, setTipoDoc]         = useState<string>('');
  const [descripcion, setDescripcion] = useState('');

  // Dispositivos, capacidades y favoritos
  const [devices, setDevices]               = useState<Device[]>([]);
  const [favorites, setFavorites]           = useState<number[]>(loadFavorites);
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [discovering, setDiscovering]       = useState(false);
  const [paperStatus, setPaperStatus]       = useState<PaperStatus | null>(null);
  const [loadingPaperStatus, setLoadingPaperStatus] = useState(false);
  const [flatbedPromptDismissed, setFlatbedPromptDismissed] = useState(false);

  // Perfiles
  const [profiles, setProfiles]               = useState<ScanProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);

  // Opciones de escaneo
  const [source, setSource]   = useState<string>('flatbed');
  const [dpi, setDpi]         = useState<number>(300);
  const [color, setColor]     = useState(true);
  const [duplex, setDuplex]   = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('pdf');

  // Sesión multi-página
  const [session, setSession]     = useState<ScannedPage[]>([]);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const blobUrlsRef = useRef<string[]>([]);

  // Cola de jobs
  const [jobs, setJobs]               = useState<ScanJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Historial de documentos del agente
  const [docHistory, setDocHistory] = useState<any[]>([]);
  const [docSearch, setDocSearch]   = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [devicePage, setDevicePage] = useState(1);
  const [viewer, setViewer]         = useState<ViewerState>(null);
  const viewerUrlRef = useRef<string | null>(null);

  // Limpiar blob URLs al desmontar
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current);
    };
  }, []);

  // ── Cargar agente desde URL param ──────────────────────────────────────────
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
        apiFetch<any>(`/scanner/documents/${clean}`)
          .then(r => setDocHistory(r?.data || []))
          .catch(() => {});
      })
      .catch((e: any) => toast.error('Error al cargar agente', e?.message))
      .finally(() => setLoadingAgente(false));
  }, [dniParam]);

  // ── Cargar dispositivos ───────────────────────────────────────────────────
  const cargarDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const r = await scannerFetch<{ items: Device[] }>('/v1/devices?limit=200&fast=1');
      const devs = r.items || [];
      const withCaps = await Promise.all(devs.map(async (d) => {
        if (!deviceOnline(d)) return d;
        try {
          const caps = await scannerFetch<DeviceCapabilities>(`/v1/devices/${d.id}/capabilities`);
          return { ...d, capabilities: normalizeCaps(caps) };
        } catch { return d; }
      }));
      setDevices(withCaps);
      setSelectedDevice(prev => {
        if (prev && withCaps.find(d => d.id === prev && deviceOnline(d))) return prev;
        const favOnline = withCaps.find(d => favorites.includes(d.id) && deviceOnline(d));
        if (favOnline) return favOnline.id;
        const anyOnline = withCaps.find(d => deviceOnline(d));
        return anyOnline?.id ?? null;
      });
    } catch (e: any) {
      toast.error('Scanner no disponible', e?.message);
    } finally { setLoadingDevices(false); }
  }, [favorites]);

  const cargarProfiles = useCallback(async () => {
    try {
      const r = await scannerFetch<{ items: ScanProfile[] }>('/v1/profiles');
      setProfiles(r.items || []);
    } catch { /* silencioso */ }
  }, []);

  const cargarPaperStatus = useCallback(async () => {
    if (!selectedDevice) { setPaperStatus(null); return; }
    const current = devices.find(d => d.id === selectedDevice);
    if (current && !deviceOnline(current)) { setPaperStatus(null); return; }
    setPaperStatus(null);
    setLoadingPaperStatus(true);
    try {
      const status = await scannerFetch<PaperStatus>(`/v1/devices/${selectedDevice}/paper-status`);
      setPaperStatus(status);
    } catch {
      setPaperStatus({ device_id: selectedDevice, adf: 'unknown', flatbed: 'unknown', flatbed_detectable: false, engine: 'none' });
    } finally { setLoadingPaperStatus(false); }
  }, [selectedDevice, devices]);

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

  useEffect(() => {
    setFlatbedPromptDismissed(false);
    cargarPaperStatus();
  }, [selectedDevice, cargarPaperStatus]);

  useEffect(() => { setFlatbedPromptDismissed(false); }, [source, selectedDevice]);

  useEffect(() => {
    const selected = devices.find(d => d.id === selectedDevice);
    const caps = selected?.capabilities;
    if (!caps) return;
    if (!caps.sources.includes(source as any)) setSource(caps.sources[0] || 'flatbed');
    if (!caps.resolutions.includes(dpi)) setDpi(caps.resolutions.includes(300) ? 300 : caps.resolutions[0] || 300);
    const colorKey = color ? 'color' : 'grayscale';
    if (!caps.color_modes.includes(colorKey) && !caps.color_modes.includes(color ? 'color' : 'gris')) {
      setColor(caps.color_modes.includes('color'));
    }
    if (!caps.duplex) setDuplex(false);
  }, [devices, selectedDevice]);

  useEffect(() => {
    const usesAdf = source === 'adf' || source === 'adf_duplex';
    if (usesAdf && paperStatus?.adf === 'empty') {
      toast.error('ADF sin hojas', 'Carga hojas en el alimentador o cambia a cristal');
      return;
    }
    if (usesAdf && paperStatus?.flatbed === 'loaded' && !flatbedPromptDismissed) {
      toast.error('Hoja en cristal', 'Confirma si queres usar cristal o seguir por ADF');
      return;
    }
    if (outputFormat === 'jpg' && (source !== 'flatbed' || duplex)) setOutputFormat('pdf');
  }, [outputFormat, source, duplex]);

  // ── Toggle favorito ──────────────────────────────────────────────────────
  const toggleFavorite = useCallback((deviceId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId];
      saveFavorites(next);
      return next;
    });
  }, []);

  // ── Poll job ─────────────────────────────────────────────────────────────
  async function pollJob(jobId: number, maxMs = 120_000): Promise<ScanJob> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 2500));
      const job = await scannerFetch<ScanJob>(`/v1/scan-jobs/${jobId}`);
      if (['completed', 'failed', 'canceled'].includes(job.status)) return job;
    }
    throw new Error('Tiempo de espera agotado (120s)');
  }

  // ── Escanear ─────────────────────────────────────────────────────────────
  const validarYLanzar = useCallback(async () => {
    if (!agente) { toast.error('Agente requerido'); return; }
    if (!tipoDoc) { toast.error('Tipo de documento requerido', 'Seleccioná qué documento vas a escanear'); return; }
    if (!selectedDevice) { toast.error('Seleccioná un dispositivo'); return; }
    if (outputFormat === 'jpg' && (source !== 'flatbed' || duplex)) {
      toast.error('JPG solo con cristal', 'Para ADF o dúplex usá PDF o TIFF'); return;
    }
    const tipoLabel = TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label || tipoDoc;
    setScanPhase('creating'); setScanError(null);
    try {
      const r = await scannerFetch<{ id: number; pending_tramites?: any[] }>('/v1/scan-jobs', {
        method: 'POST',
        body: JSON.stringify({
          device_id: selectedDevice, profile_id: selectedProfile || undefined,
          priority: 5, source, duplex: duplex || source === 'adf_duplex',
          dpi, color, auto_rotate: true, blank_page_detection: true,
          compression: 'medium', output_format: outputFormat,
          personal_dni: agente.dni, personal_ref: tipoDoc, doc_class: tipoDoc,
        }),
      });
      if (r.pending_tramites?.length) toast.error(`⚠️ ${r.pending_tramites.length} trámite(s) pendiente(s)`, '');
      setScanPhase('waiting');
      const finalJob = await pollJob(r.id);
      if (finalJob.status !== 'completed') throw new Error(finalJob.error_message || `Escaneo terminó con estado: ${finalJob.status}`);
      setScanPhase('loading_pages');
      const pagesRes = await scannerFetch<{ doc_id: number | null; pages: any[] }>(`/v1/scan-jobs/${r.id}/pages`);
      if (!pagesRes.pages?.length) throw new Error('El agente no subió ninguna página');
      const newPages: ScannedPage[] = pagesRes.pages.map(p => ({
        jobId: r.id, pageNumber: p.page_number, storageKey: p.storage_key, blobUrl: null, loadError: false,
      }));
      setSession(prev => [...prev, ...newPages]);
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
      toast.ok(`✅ Pág. escaneada`, `${tipoLabel} — job #${r.id}`);
    } catch (e: any) {
      setScanPhase('error'); setScanError(e?.message || 'Error desconocido');
      toast.error('Error al escanear', e?.message);
    }
  }, [agente, tipoDoc, selectedDevice, selectedProfile, source, duplex, dpi, color, outputFormat]);

  // ── Guardar sesión ───────────────────────────────────────────────────────
  const guardarSesion = useCallback(async () => {
    if (!session.length || !agente) return;
    setSaving(true);
    try {
      const jobIds = Array.from(new Set(session.map(p => p.jobId)));
      await Promise.all(jobIds.map(jobId => scannerFetch(`/v1/scan-jobs/${jobId}/sync-personal`, { method: 'POST' })));
      toast.ok('✅ Guardado', `${session.length} página(s) registradas`);
      apiFetch<any>(`/scanner/documents/${agente.dni}`)
        .then(r => setDocHistory(r?.data || [])).catch(() => {});
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      blobUrlsRef.current = [];
      setSession([]); setScanPhase('idle'); setScanError(null);
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message || 'Error sincronizando con legajo');
    } finally { setSaving(false); }
  }, [session, agente]);

  const descartarSesion = useCallback(() => {
    blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
    blobUrlsRef.current = [];
    setViewer(prev => prev?.kind === 'scan' ? null : prev);
    setSession([]); setScanPhase('idle'); setScanError(null);
  }, []);

  const quitarPagina = useCallback((storageKey: string) => {
    setSession(prev => {
      const page = prev.find(p => p.storageKey === storageKey);
      if (page?.blobUrl) URL.revokeObjectURL(page.blobUrl);
      return prev.filter(p => p.storageKey !== storageKey);
    });
  }, []);

  const cerrarViewer = useCallback(() => {
    setViewer(prev => {
      if (prev?.revokeOnClose && viewerUrlRef.current === prev.url) {
        URL.revokeObjectURL(prev.url); viewerUrlRef.current = null;
      }
      return null;
    });
  }, []);

  const abrirPaginaEscaneada = useCallback((page: ScannedPage, index: number) => {
    if (!page.blobUrl) return;
    setViewer({ title: `Pagina escaneada ${index + 1}`, url: page.blobUrl, contentType: 'image/*', filename: null, kind: 'scan', revokeOnClose: false });
  }, []);

  const abrirDocumentoPrevio = useCallback(async (doc: any) => {
    try {
      if (viewerUrlRef.current) { URL.revokeObjectURL(viewerUrlRef.current); viewerUrlRef.current = null; }
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(`/documents/${doc.id}/file`);
      const url = URL.createObjectURL(blob);
      viewerUrlRef.current = url;
      setViewer({ title: doc.nombre || filename || `Documento #${doc.id}`, url, contentType, filename, kind: 'document', revokeOnClose: true });
    } catch (e: any) { toast.error('No se pudo abrir el documento', e?.message); }
  }, [toast]);

  const cancelarJob = useCallback(async (jobId: number) => {
    try {
      await scannerFetch(`/v1/scan-jobs/${jobId}/cancel`, { method: 'POST' });
      toast.ok('Job cancelado'); cargarJobs(true);
    } catch (e: any) { toast.error('Error al cancelar', e?.message); }
  }, [cargarJobs]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const device   = devices.find(d => d.id === selectedDevice) || null;
  const caps     = device?.capabilities;
  const isOnline = device ? deviceOnline(device) : false;
  const sourceUsesAdf = source === 'adf' || source === 'adf_duplex';
  const adfPaperEmpty = sourceUsesAdf && paperStatus?.adf === 'empty';
  const flatbedPaperQuestion = sourceUsesAdf && paperStatus?.flatbed === 'loaded' && !flatbedPromptDismissed;
  const isScanning = ['creating', 'waiting', 'loading_pages'].includes(scanPhase);
  const hasPages   = session.length > 0;
  const activeJobs = jobs.filter(j => ['queued','in_progress'].includes(j.status));
  const doneJobs   = jobs.filter(j => !['queued','in_progress'].includes(j.status));
  const puedeEscanear = !!agente && !!tipoDoc && !!selectedDevice && isOnline && !isScanning && !adfPaperEmpty && !flatbedPaperQuestion;

  const sortedDevices = [...devices].sort((a, b) => {
    const af = favorites.includes(a.id) ? 0 : 1;
    const bf = favorites.includes(b.id) ? 0 : 1;
    if (af !== bf) return af - bf;
    return (deviceOnline(a) ? 0 : 1) - (deviceOnline(b) ? 0 : 1);
  });
  const onlineDevices = sortedDevices.filter(deviceOnline);
  const deviceNeedle = normSearch(deviceSearch);
  const filteredOnlineDevices = onlineDevices.filter(d => {
    if (!deviceNeedle) return true;
    return normSearch([d.name, d.hostname, d.driver, d.capabilities?.model, d.capabilities?.manufacturer].join(' ')).includes(deviceNeedle);
  });
  const devicePageCount = Math.max(1, Math.ceil(filteredOnlineDevices.length / DEVICE_PAGE_SIZE));
  const safeDevicePage  = Math.min(devicePage, devicePageCount);
  const pagedOnlineDevices = filteredOnlineDevices.slice((safeDevicePage - 1) * DEVICE_PAGE_SIZE, safeDevicePage * DEVICE_PAGE_SIZE);

  const docNeedle = normSearch(docSearch);
  const filteredDocHistory = docHistory.filter((d: any) => {
    if (!docNeedle) return true;
    const tipoLabel = TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo;
    return normSearch([d.nombre, tipoLabel, d.descripcion_archivo, d.ruta, fmtDT(d.created_at)].join(' ')).includes(docNeedle);
  });

  useEffect(() => { setDevicePage(1); }, [deviceSearch, onlineDevices.length]);
  useEffect(() => { if (devicePage > devicePageCount) setDevicePage(devicePageCount); }, [devicePage, devicePageCount]);

  const scanPhaseLabel: Record<ScanPhase, string> = {
    idle: '', creating: '📡 Creando trabajo…',
    waiting: '⏳ Esperando al escáner…',
    loading_pages: '🖼️ Cargando páginas…',
    done: '', error: '',
  };

  const paginasEscaneadasCard = hasPages ? (
    <div className="card scan-card scan-preview-card">
      <div className="scan-section-title">
        🖼️ Páginas escaneadas
        <span className="badge" style={{ marginLeft: 6, background: 'rgba(16,185,129,0.2)', color: '#6ee7b7' }}>
          {session.length} pág.
        </span>
      </div>
      <div className="scan-preview-grid">
        {session.map((page, idx) => (
          <div
            key={page.storageKey}
            className="scan-preview-thumb scan-preview-thumb-live"
            role="button" tabIndex={0}
            title="Doble click para ampliar"
            onDoubleClick={() => abrirPaginaEscaneada(page, idx)}
            onKeyDown={e => e.key === 'Enter' && abrirPaginaEscaneada(page, idx)}
          >
            <div className="scan-preview-frame">
              {page.blobUrl ? (
                <img src={page.blobUrl} alt={`Página ${idx + 1}`} className="scan-preview-img" />
              ) : page.loadError ? (
                <div className="scan-preview-state scan-preview-error">❌<br />Error</div>
              ) : (
                <div className="scan-preview-state">
                  <div className="scan-pulse-dot" style={{ margin: '0 auto 4px' }} />
                  Cargando...
                </div>
              )}
              <div className="scan-preview-num">Pág. {idx + 1}</div>
              <button type="button" className="scan-preview-remove"
                onClick={e => { e.stopPropagation(); quitarPagina(page.storageKey); }} title="Quitar">×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const documentosPreviosCard = agente ? (
    <div className="card scan-card">
      <div className="scan-section-title">🗂️ Documentos previos del agente</div>
      {docHistory.length > 0 && (
        <input className="input scan-doc-search" value={docSearch}
          onChange={e => setDocSearch(e.target.value)} placeholder="Buscar por nombre, tipo o fecha" />
      )}
      {docHistory.length > 0 ? (
        filteredDocHistory.length > 0 ? (
          <div className="scan-doc-list scan-doc-list-compact">
            {filteredDocHistory.slice(0, 12).map((d: any) => (
              <button key={d.id} type="button" className="scan-doc-item scan-doc-button"
                onClick={() => abrirDocumentoPrevio(d)} title="Abrir documento">
                <div className="scan-doc-class">
                  {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.icon || '📄'}
                </div>
                <div className="scan-doc-body">
                  <div className="scan-doc-name">{d.nombre || `Documento #${d.id}`}</div>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo} · {fmtDT(d.created_at)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="scan-empty-inline">Sin resultados para esa búsqueda</div>
        )
      ) : (
        <div className="scan-empty-inline">Sin documentos escaneados para este agente</div>
      )}
    </div>
  ) : null;

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
                <div className="scan-ruta-hint muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                  📁 Se guardará en: …\docu\{agente.dni}\
                </div>
              </div>
              <button className="btn" style={{ marginLeft: 'auto', fontSize: '0.78rem' }}
                onClick={() => navigate('/app/atencion')}>
                ← Atención
              </button>
            </div>
          ) : (
            <div className="muted">⚠️ DNI {dniParam} — agente no encontrado</div>
          )}
        </div>

        {/* ── TABS ── */}
        <div className="scan-tabs">
          {([
            ['escanear',    '📷 Escanear'],
            ['dispositivos','🖨️ Dispositivos'],
            ['cola',        `⏳ Cola${activeJobs.length ? ` (${activeJobs.length})` : ''}`],
            ['documentos',  '📂 Documentos'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button key={t} className={`scan-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════
            TAB: ESCANEAR
        ══════════════════════════════════════════════ */}
        {tab === 'escanear' && (
          <div className="scan-layout">

            {/* IZQUIERDA */}
            <div className="scan-col">

              {/* Tipo de documento */}
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
                <label htmlFor="esca-desc" className="muted scan-label" style={{ marginTop: 12, display: 'block' }}>Descripción adicional (opcional)</label>
                <input id="esca-desc" name="descripcion" className="input" value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  placeholder="Ej: Renovación 2024, página 1 de 2…"
                  style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>

              {paginasEscaneadasCard}
              {documentosPreviosCard}
            </div>

            {/* DERECHA */}
            <div className="scan-col">

              {/* Dispositivo */}
              <div className="card scan-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div className="scan-section-title" style={{ marginBottom: 0 }}>🖨️ Dispositivo</div>
                  <button className="btn" style={{ fontSize: '0.72rem', padding: '4px 10px' }}
                    onClick={cargarDevices} disabled={loadingDevices}>
                    {loadingDevices ? '🔄' : '↺'}
                  </button>
                </div>
                {loadingDevices ? (
                  <div className="muted">Cargando dispositivos…</div>
                ) : onlineDevices.length === 0 ? (
                  <div className="scan-no-devices">
                    <div style={{ fontSize: '2rem' }}>🔍</div>
                    <div>No hay escáneres en línea</div>
                    {devices.length > 0 && (
                      <div className="muted" style={{ fontSize: '0.76rem' }}>
                        Hay {devices.length} registrado(s), pero sin conexión activa.
                      </div>
                    )}
                    <button className="btn" onClick={descubrirDispositivos} disabled={discovering}>
                      {discovering ? '🔄 Buscando…' : '📡 Buscar en red'}
                    </button>
                  </div>
                ) : (
                  <div className="scan-device-picker">
                    <input className="input scan-device-search" value={deviceSearch}
                      onChange={e => setDeviceSearch(e.target.value)} placeholder="Buscar escáner" />
                    {filteredOnlineDevices.length === 0 ? (
                      <div className="scan-empty-inline">Sin escáneres para esa búsqueda</div>
                    ) : (
                      <div className="scan-device-list scan-device-list-scroll">
                        {pagedOnlineDevices.map(d => {
                          const online = deviceOnline(d);
                          const isFav  = favorites.includes(d.id);
                          return (
                            <button key={d.id}
                              className={`scan-device-btn${selectedDevice === d.id ? ' selected' : ''}${!online ? ' offline' : ''}`}
                              onClick={() => setSelectedDevice(d.id)}>
                              <div className="scan-device-row">
                                <span title={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
                                  style={{ fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0, color: isFav ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}
                                  onClick={e => toggleFavorite(d.id, e)}>
                                  {isFav ? '★' : '☆'}
                                </span>
                                <span className={`scan-dot${online ? ' online' : ''}`} />
                                <b style={{ flexGrow: 1, textAlign: 'left' }}>{d.name}</b>
                                <span className="muted" style={{ fontSize: '0.75rem' }}>{online ? 'En línea' : 'Sin conexión'}</span>
                              </div>
                              {d.hostname && (
                                <div className="muted" style={{ fontSize: '0.72rem', paddingLeft: 40 }}>
                                  {d.hostname} · {d.driver}
                                  {isFav && <span style={{ marginLeft: 6, color: '#fbbf24', fontSize: '0.65rem' }}>★ FAV</span>}
                                </div>
                              )}
                              {d.capabilities?.model && (
                                <div className="muted" style={{ fontSize: '0.72rem', paddingLeft: 40 }}>
                                  {d.capabilities.manufacturer} {d.capabilities.model}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {filteredOnlineDevices.length > DEVICE_PAGE_SIZE && (
                      <div className="scan-pager">
                        <button className="btn" onClick={() => setDevicePage(p => Math.max(1, p - 1))} disabled={safeDevicePage <= 1}>‹</button>
                        <span className="muted">Página {safeDevicePage} de {devicePageCount}</span>
                        <button className="btn" onClick={() => setDevicePage(p => Math.min(devicePageCount, p + 1))} disabled={safeDevicePage >= devicePageCount}>›</button>
                      </div>
                    )}
                    <button className="btn" style={{ marginTop: 6 }} onClick={descubrirDispositivos} disabled={discovering}>
                      {discovering ? '🔄 Buscando…' : '📡 Buscar en red'}
                    </button>
                  </div>
                )}
              </div>

              {/* Configuración del dispositivo */}
              {caps && (
                <div className="card scan-card">
                  <div className="scan-section-title">⚙️ Configuración de Escaneo</div>

                  <div className="muted scan-label">Bandeja / Fuente</div>
                  <div className="scan-caps-grid">
                    {caps.sources.map(s => (
                      <button key={s} className={`scan-cap-btn${source === s ? ' selected' : ''}`}
                        onClick={() => { setSource(s); if (s !== 'adf_duplex') setDuplex(false); }}>
                        {SOURCE_LABEL[s] || s}
                        {s === 'adf_duplex' && <span className="scan-cap-tag">Dúplex</span>}
                      </button>
                    ))}
                  </div>

                  <div className="scan-paper-panel">
                    <div className="scan-paper-row">
                      <span className={`scan-paper-pill${paperClass(paperStatus?.adf)}`}>
                        ADF: {loadingPaperStatus ? 'Consultando...' : PAPER_LABEL[paperStatus?.adf || 'unknown']}
                      </span>
                      <span className={`scan-paper-pill${paperClass(paperStatus?.flatbed)}`}>
                        Cristal: {loadingPaperStatus ? 'Consultando...' : PAPER_LABEL[paperStatus?.flatbed || 'unknown']}
                      </span>
                      <button type="button" className="scan-paper-refresh"
                        onClick={cargarPaperStatus} disabled={loadingPaperStatus || !selectedDevice}>
                        Actualizar
                      </button>
                    </div>
                    {adfPaperEmpty && (
                      <div className="scan-paper-warning">ADF sin hojas. Carga hojas en el alimentador o cambia a cristal.</div>
                    )}
                    {flatbedPaperQuestion && (
                      <div className="scan-source-question">
                        <span>Hay hoja en cristal. Queres escanear por cristal?</span>
                        <div className="scan-source-question-actions">
                          <button type="button" className="btn"
                            onClick={() => { setSource('flatbed'); setDuplex(false); setFlatbedPromptDismissed(true); }}>
                            Usar cristal
                          </button>
                          <button type="button" className="btn" onClick={() => setFlatbedPromptDismissed(true)}>Seguir ADF</button>
                        </div>
                      </div>
                    )}
                    {paperStatus && paperStatus.flatbed === 'unknown' && (
                      <div className="muted scan-paper-note">Cristal: este equipo no informa si hay hoja antes de escanear.</div>
                    )}
                  </div>

                  <div className="muted scan-label" style={{ marginTop: 12 }}>Resolución (DPI)</div>
                  <div className="scan-caps-grid">
                    {(caps.resolutions.length ? caps.resolutions : [150, 300, 600]).map(r => (
                      <button key={r} className={`scan-cap-btn${dpi === r ? ' selected' : ''}`}
                        onClick={() => setDpi(r)}>{r} dpi</button>
                    ))}
                  </div>

                  <div className="muted scan-label" style={{ marginTop: 12 }}>Modo de color</div>
                  <div className="scan-caps-grid">
                    {(caps.color_modes.length ? caps.color_modes : ['color','gris']).map(m => (
                      <button key={m} className={`scan-cap-btn${(color ? 'color' : 'gris') === m ? ' selected' : ''}`}
                        onClick={() => setColor(m === 'color')}>
                        {m === 'color' ? '🎨 Color' : '⬜ Escala de grises'}
                      </button>
                    ))}
                  </div>

                  <div className="muted scan-label" style={{ marginTop: 12 }}>Formato de salida</div>
                  <div className="scan-caps-grid">
                    {([['pdf','PDF'],['pdf_a','PDF/A'],['tiff','TIFF'],['jpg','JPG']] as [OutputFormat, string][]).map(([fmt, label]) => {
                      const disabled = fmt === 'jpg' && (source !== 'flatbed' || duplex);
                      return (
                        <button key={fmt} className={`scan-cap-btn${outputFormat === fmt ? ' selected' : ''}`}
                          onClick={() => { if (!disabled) { setOutputFormat(fmt); setSelectedProfile(null); } }}
                          disabled={disabled} title={disabled ? 'JPG solo se usa con cristal / vidrio plano' : undefined}>
                          {label}
                        </button>
                      );
                    })}
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

              {/* Perfiles */}
              {profiles.length > 0 && (
                <div className="card scan-card">
                  <div className="scan-section-title">📋 Perfil de Escaneo</div>
                  <div className="scan-caps-grid">
                    <button className={`scan-cap-btn${!selectedProfile ? ' selected' : ''}`}
                      onClick={() => setSelectedProfile(null)}>Manual</button>
                    {profiles.map(p => (
                      <button key={p.id} className={`scan-cap-btn${selectedProfile === p.id ? ' selected' : ''}`}
                        onClick={() => { setSelectedProfile(p.id); setDpi(p.dpi); setColor(p.color); setOutputFormat((p.output_format as OutputFormat) || 'pdf'); }}>
                        {p.name}
                        <span className="muted" style={{ fontSize: '0.68rem', display: 'block' }}>
                          {p.dpi}dpi · {p.color ? 'Color' : 'Gris'} · {p.output_format}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Resumen y lanzar */}
              <div className="card scan-card scan-launch-card">
                <div className="scan-section-title">🚀 Escaneo</div>
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
                  <div className={`scan-check-item${isOnline ? ' ok' : ' pending'}`}>
                    {isOnline ? '✅' : '⭕'} Dispositivo en línea
                    {device && <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>{device.name}</span>}
                  </div>
                  {sourceUsesAdf && (
                    <div className={`scan-check-item${adfPaperEmpty ? ' pending' : ' ok'}`}>
                      {adfPaperEmpty ? '⭕' : paperStatus?.adf === 'loaded' ? '✅' : '◌'} ADF
                      <span className="muted" style={{ marginLeft: 6, fontSize: '0.75rem' }}>
                        {loadingPaperStatus ? 'consultando...' : PAPER_LABEL[paperStatus?.adf || 'unknown']}
                      </span>
                    </div>
                  )}
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
                      <span className="muted">Dispositivo</span>
                      <span>
                        <span className={`scan-dot${isOnline ? ' online' : ''}`} style={{ marginRight: 6 }} />
                        {device.name}
                      </span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Resolución</span>
                      <span>{dpi} dpi · {color ? 'Color' : 'Grises'}</span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Formato</span>
                      <span>{outputFormat.toUpperCase()}</span>
                    </div>
                  </div>
                )}

                {!isOnline && device && (
                  <div className="scan-warn">⚠️ El dispositivo <b>{device.name}</b> no está en línea. Verificá la conexión.</div>
                )}
                {adfPaperEmpty && (
                  <div className="scan-warn">⚠️ ADF sin hojas. Cargá hojas en el alimentador o cambiá la fuente a cristal.</div>
                )}
                {flatbedPaperQuestion && (
                  <div className="scan-warn">⚠️ Hay hoja en cristal. Confirmá la fuente en Configuración de Escaneo.</div>
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

                <button className={`btn scan-btn-launch${puedeEscanear ? ' ready' : ''}`}
                  onClick={validarYLanzar} disabled={!puedeEscanear}>
                  {isScanning ? (scanPhaseLabel[scanPhase] || '⏳ Escaneando…')
                    : !agente ? '👤 Cargando agente…'
                    : !tipoDoc ? '🗂️ Falta el tipo de documento'
                    : adfPaperEmpty ? '📄 ADF sin hojas'
                    : flatbedPaperQuestion ? '🪟 Confirmar fuente'
                    : !isOnline ? '🔌 Scanner sin conexión'
                    : hasPages ? '📄 Escanear otra página'
                    : '▶ Iniciar Escaneo'}
                </button>

                {hasPages && !isScanning && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn" style={{ flex: 1, background: 'rgba(16,185,129,0.15)', borderColor: '#10b981', color: '#6ee7b7' }}
                      onClick={guardarSesion} disabled={saving}>
                      {saving ? '⏳ Guardando…' : `✅ Guardar ${session.length} pág.`}
                    </button>
                    <button className="btn" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}
                      onClick={descartarSesion} disabled={saving} title="Descartar sesión">
                      🗑️
                    </button>
                  </div>
                )}
              </div>

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
                const dcaps  = d.capabilities;
                return (
                  <div key={d.id} className={`card scan-device-card${online ? ' online' : ''}`}>
                    <div className="scan-device-header">
                      <span className={`scan-dot-lg${online ? ' online' : ''}`} />
                      <div>
                        <div className="scan-device-title">{d.name}</div>
                        {dcaps?.model && (
                          <div className="muted" style={{ fontSize: '0.78rem' }}>{dcaps.manufacturer} {dcaps.model}</div>
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
                    {dcaps && (
                      <div className="scan-device-caps">
                        <div className="scan-caps-title">Capacidades</div>
                        <div className="scan-cap-tags">
                          {dcaps.sources.map(s => <span key={s} className="scan-cap-tag-sm">{SOURCE_LABEL[s] || s}</span>)}
                          {dcaps.duplex && <span className="scan-cap-tag-sm">Dúplex</span>}
                          {dcaps.resolutions.map(r => <span key={r} className="scan-cap-tag-sm">{r}dpi</span>)}
                          {dcaps.paper_sizes.map(p => <span key={p} className="scan-cap-tag-sm">{p}</span>)}
                          {dcaps.max_pages_adf && <span className="scan-cap-tag-sm">ADF máx {dcaps.max_pages_adf} págs</span>}
                        </div>
                      </div>
                    )}
                    <button className="btn" style={{ marginTop: 10, width: '100%' }}
                      onClick={() => { setSelectedDevice(d.id); setTab('escanear'); }}>
                      Usar este dispositivo
                    </button>
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
                        <span className="scan-status-icon" style={{ color: STATUS_COLOR[j.status] }}>{STATUS_ICON[j.status]}</span>
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
                        <button className="btn" style={{ marginTop: 8, fontSize: '0.78rem' }} onClick={() => cancelarJob(j.id)}>Cancelar</button>
                      )}
                      {j.status === 'in_progress' && (
                        <div className="scan-job-progress"><div className="scan-job-bar" /></div>
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
                        <span className="scan-status-icon" style={{ color: STATUS_COLOR[j.status] }}>{STATUS_ICON[j.status]}</span>
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
                      {j.error_message && <div className="scan-job-err">{j.error_message}</div>}
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
              <input className="input scan-doc-search" value={docSearch}
                onChange={e => setDocSearch(e.target.value)} placeholder="Buscar por nombre, tipo o fecha" />
            )}

            {docHistory.length > 0 && filteredDocHistory.length > 0 && (
              <div className="scan-docs-grid">
                {filteredDocHistory.map((d: any) => (
                  <button key={d.id} type="button" className="card scan-doc-card scan-doc-card-button"
                    onClick={() => abrirDocumentoPrevio(d)}>
                    <div className="scan-doc-class-badge">
                      {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.icon || '📄'} {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo || 'doc'}
                    </div>
                    <div className="scan-doc-title">{d.nombre || `Documento #${d.id}`}</div>
                    {d.descripcion_archivo && (
                      <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>{d.descripcion_archivo}</div>
                    )}
                    <div className="muted" style={{ fontSize: '0.72rem', marginTop: 4 }}>{fmtDT(d.created_at)}</div>
                  </button>
                ))}
              </div>
            )}

            {agente && docHistory.length > 0 && filteredDocHistory.length === 0 && (
              <div className="scan-empty-state" style={{ marginTop: 16 }}>
                <div style={{ fontSize: '2.5rem' }}>🔍</div>
                <div>Sin resultados para esa búsqueda</div>
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
                <div style={{ fontSize: '2.5rem' }}>🔄</div>
                <div className="muted">Cargando agente…</div>
              </div>
            )}
          </div>
        )}

        {/* ── Visor de documentos/páginas ── */}
        {viewer && (
          <div className="scan-viewer-backdrop" role="dialog" aria-modal="true" onClick={cerrarViewer}>
            <div className="scan-viewer-modal" onClick={e => e.stopPropagation()}>
              <div className="scan-viewer-header">
                <div className="scan-viewer-title">{viewer.title}</div>
                <div className="scan-viewer-actions">
                  {viewer.kind === 'document' && (
                    <a className="btn" href={viewer.url} download={viewer.filename || undefined}>Descargar</a>
                  )}
                  <button className="btn" type="button" onClick={cerrarViewer}>Cerrar</button>
                </div>
              </div>
              <div className="scan-viewer-body">
                {(viewer.contentType || '').includes('pdf') ? (
                  <iframe title={viewer.title} src={viewer.url} className="scan-viewer-frame" />
                ) : (viewer.contentType || '').startsWith('image/') || viewer.kind === 'scan' ? (
                  <img src={viewer.url} alt={viewer.title} className="scan-viewer-image" />
                ) : (
                  <div className="scan-empty-state">
                    <div>Vista previa no disponible</div>
                    <a className="btn" href={viewer.url} download={viewer.filename || undefined}>Descargar archivo</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
