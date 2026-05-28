// src/pages/ResolucionesPage/index.tsx
// Gestión de Resoluciones, Expedientes y Archivos por agente.
// v2: incluye escaneo obligatorio al crear una resolución nueva.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { searchPersonal } from '../../api/searchPersonal';
import { useAuth } from '../../auth/AuthProvider';
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
    headers: { 'content-type': 'application/json', ...getScannerHeaders(), ...(opts?.headers || {}) },
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

// ─── Favoritos ────────────────────────────────────────────────────────────────
const FAV_KEY = 'scanner_favorites_v1';
function loadFavorites(): number[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(ids: number[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch {}
}

// ─── Tipos scanner ────────────────────────────────────────────────────────────
interface Device {
  id: number; name: string; driver: string; is_active: boolean;
  last_seen_at: string | null; hostname: string | null;
  online?: boolean; capabilities?: DeviceCapabilities;
}
interface DeviceCapabilities {
  sources: ('flatbed' | 'adf' | 'adf_duplex')[];
  resolutions: number[]; paper_sizes: string[]; color_modes: string[];
  max_pages_adf: number | null; duplex: boolean;
  model: string | null; manufacturer: string | null; online: boolean;
}
type PaperState = 'loaded' | 'empty' | 'unknown';
interface PaperStatus {
  device_id: number; adf: PaperState; flatbed: PaperState;
  flatbed_detectable?: boolean; engine?: string;
}
interface ScannedPage {
  jobId: number; pageNumber: number;
  storageKey: string; blobUrl: string | null; loadError: boolean;
}
type ScanPhase = 'idle' | 'creating' | 'waiting' | 'loading_pages' | 'done' | 'error';
type OutputFormat = 'pdf' | 'pdf_a' | 'tiff' | 'jpg';
type ViewerState = { title: string; url: string; revokeOnClose: boolean } | null;

// ─── Constantes scanner ───────────────────────────────────────────────────────
const SOURCE_LABEL: Record<string, string> = {
  flatbed: '🪟 Vidrio plano', adf: '📄 ADF (alimentador)', adf_duplex: '📄 ADF Dúplex',
};
const PAPER_LABEL: Record<PaperState, string> = {
  loaded: 'Con hojas', empty: 'Sin hojas', unknown: 'No detectable',
};
const SCAN_PHASE_LABEL: Record<ScanPhase, string> = {
  idle: '', creating: '📡 Creando trabajo…', waiting: '⏳ Esperando al escáner…',
  loading_pages: '🖼️ Cargando páginas…', done: '', error: '',
};

function deviceOnline(d: Device) {
  if (d.capabilities?.online === true) return true;
  if (typeof d.online === 'boolean') return d.online;
  if (!d.last_seen_at) return false;
  return (Date.now() - new Date(d.last_seen_at).getTime()) < 10 * 60_000;
}
function normalizeCaps(caps?: Partial<DeviceCapabilities> | null): DeviceCapabilities {
  return {
    sources: (Array.isArray(caps?.sources) && caps!.sources!.length ? caps!.sources! : ['flatbed']) as DeviceCapabilities['sources'],
    resolutions: Array.isArray(caps?.resolutions) && caps!.resolutions!.length ? caps!.resolutions! : [150, 300, 600],
    paper_sizes: Array.isArray(caps?.paper_sizes) && caps!.paper_sizes!.length ? caps!.paper_sizes! : ['A4'],
    color_modes: Array.isArray(caps?.color_modes) && caps!.color_modes!.length ? caps!.color_modes! : ['color', 'grayscale'],
    max_pages_adf: caps?.max_pages_adf ?? null, duplex: caps?.duplex === true,
    model: caps?.model ?? null, manufacturer: caps?.manufacturer ?? null, online: caps?.online ?? true,
  };
}
function paperClass(state?: PaperState | null) {
  if (state === 'loaded') return ' ok';
  if (state === 'empty') return ' danger';
  return ' unknown';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d?: string | null): string {
  if (!d) return '—';
  try {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-').map(Number);
    if (!y || !m || !day) return String(d);
    return new Date(y, m - 1, day).toLocaleDateString('es-AR');
  } catch { return String(d); }
}
async function fetchAll<T = any>(endpoint: string): Promise<T[]> {
  const PAGE = 200; let page = 1; let all: T[] = []; let total = Infinity;
  while (all.length < total) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const res = await apiFetch<any>(`${endpoint}${sep}limit=${PAGE}&page=${page}`);
    const rows: T[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total); else total = all.length;
    if (rows.length < PAGE) break;
    page++;
  }
  return all;
}

// ─── Estilos tabla ────────────────────────────────────────────────────────────
const th: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: '#94a3b8',
  fontSize: '0.68rem', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.05)',
};
const td: React.CSSProperties = { padding: '6px 10px', fontSize: '0.8rem', whiteSpace: 'nowrap' };
const fg: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const lbl: React.CSSProperties = { fontSize: '0.72rem', color: '#94a3b8' };

type TabId = 'resoluciones' | 'expedientes' | 'archivos';

// ─── Página ───────────────────────────────────────────────────────────────────
export function ResolucionesPage() {
  const toast  = useToast();
  const { session } = useAuth();

  // ── Código de bypass (leído del env, nunca hardcodeado) ────────────────────
  const BYPASS_CODE = (import.meta as any)?.env?.VITE_SCAN_BYPASS_CODE || '';

  // ── Búsqueda agente ────────────────────────────────────────────────────────
  const [dniInput,  setDniInput]  = useState('');
  const [nameInput, setNameInput] = useState('');
  const [matches,   setMatches]   = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [agente,    setAgente]    = useState<any | null>(null);

  // ── Datos del agente ───────────────────────────────────────────────────────
  const [resoluciones, setResoluciones] = useState<any[]>([]);
  const [expedientes,  setExpedientes]  = useState<any[]>([]);
  const [archivos,     setArchivos]     = useState<any[]>([]);
  const [tiposRes,     setTiposRes]     = useState<any[]>([]);
  const [loadingData,  setLoadingData]  = useState(false);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>('resoluciones');

  // ── Forms ──────────────────────────────────────────────────────────────────
  const emptyRes = { motivo: '', numero: '', observaciones: '', fecha: '' };
  const emptyExp = { numero: '', caratula: '', fecha: '', estado: '' };
  const [formRes,   setFormRes]   = useState(emptyRes);
  const [formExp,   setFormExp]   = useState(emptyExp);
  const [savingRes, setSavingRes] = useState(false);
  const [savingExp, setSavingExp] = useState(false);
  const [editRes,   setEditRes]   = useState<any | null>(null);
  const [editExp,   setEditExp]   = useState<any | null>(null);

  // ── Upload archivos ────────────────────────────────────────────────────────
  const emptyUpload = { nombre: '', numero: '', tipo: 'resolución', fecha: '', descripcion: '' };
  const [uploadForm,     setUploadForm]     = useState(emptyUpload);
  const [uploading,      setUploading]      = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);

  // ── Scanner — dispositivos ─────────────────────────────────────────────────
  const [scanDevices,        setScanDevices]        = useState<Device[]>([]);
  const [scanFavorites,      setScanFavorites]      = useState<number[]>(loadFavorites);
  const [scanSelectedDevice, setScanSelectedDevice] = useState<number | null>(null);
  const [scanLoadingDevices, setScanLoadingDevices] = useState(false);
  const [scanDiscovering,    setScanDiscovering]    = useState(false);

  // ── Scanner — papel ────────────────────────────────────────────────────────
  const [scanPaperStatus,           setScanPaperStatus]           = useState<PaperStatus | null>(null);
  const [scanLoadingPaper,          setScanLoadingPaper]          = useState(false);
  const [scanFlatbedPromptDismissed, setScanFlatbedPromptDismissed] = useState(false);

  // ── Scanner — config ───────────────────────────────────────────────────────
  const [scanSource,       setScanSource]       = useState<string>('flatbed');
  const [scanDpi,          setScanDpi]          = useState<number>(300);
  const [scanColor,        setScanColor]        = useState(true);
  const [scanDuplex,       setScanDuplex]       = useState(false);
  const [scanOutputFormat, setScanOutputFormat] = useState<OutputFormat>('pdf');
  const [scanPaperSize,    setScanPaperSize]    = useState<string>('A4');

  // ── Scanner — sesión de páginas ────────────────────────────────────────────
  const [scanSession,   setScanSession]   = useState<ScannedPage[]>([]);
  const [scanPhase,     setScanPhase]     = useState<ScanPhase>('idle');
  const [scanError,     setScanError]     = useState<string | null>(null);
  const blobUrlsRef   = useRef<string[]>([]);
  const viewerUrlRef  = useRef<string | null>(null);

  // ── Scanner — viewer ───────────────────────────────────────────────────────
  const [scanViewer, setScanViewer] = useState<ViewerState>(null);

  // ── Bypass ─────────────────────────────────────────────────────────────────
  const [showBypass,     setShowBypass]     = useState(false);
  const [bypassInput,    setBypassInput]    = useState('');
  const [bypassUnlocked, setBypassUnlocked] = useState(false);

  // ── Limpiar blob URLs al desmontar ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current);
    };
  }, []);

  // ── Cargar tipos de resolución ─────────────────────────────────────────────
  useEffect(() => {
    fetchAll('/tipoderesolucion').then(setTiposRes).catch(() => {});
  }, []);

  // ── Reset scan + bypass ────────────────────────────────────────────────────
  const resetScan = useCallback(() => {
    blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
    blobUrlsRef.current = [];
    setScanSession([]); setScanPhase('idle'); setScanError(null);
    setBypassUnlocked(false); setBypassInput(''); setShowBypass(false);
    setScanFlatbedPromptDismissed(false);
  }, []);

  // ── Scanner — cargar dispositivos ─────────────────────────────────────────
  const cargarScanDevices = useCallback(async () => {
    setScanLoadingDevices(true);
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
      setScanDevices(withCaps);
      setScanSelectedDevice(prev => {
        if (prev && withCaps.find(d => d.id === prev && deviceOnline(d))) return prev;
        const favOnline = withCaps.find(d => scanFavorites.includes(d.id) && deviceOnline(d));
        if (favOnline) return favOnline.id;
        return withCaps.find(d => deviceOnline(d))?.id ?? null;
      });
    } catch (e: any) {
      toast.error('Scanner no disponible', e?.message);
    } finally { setScanLoadingDevices(false); }
  }, [scanFavorites]);

  const descubrirScanDevices = useCallback(async () => {
    setScanDiscovering(true);
    try {
      const r = await scannerFetch<{ devices: any[] }>('/v1/devices/discover', { method: 'POST' });
      const found = r.devices?.length || 0;
      if (found > 0) {
        toast.ok(`${found} dispositivo(s) encontrado(s)`, 'Recargando…');
        await cargarScanDevices();
      } else {
        toast.error('Sin dispositivos', 'No se encontraron escáneres en la red');
      }
    } catch (e: any) { toast.error('Error al descubrir', e?.message); }
    finally { setScanDiscovering(false); }
  }, [cargarScanDevices]);

  // ── Scanner — papel ────────────────────────────────────────────────────────
  const cargarPaperStatus = useCallback(async () => {
    if (!scanSelectedDevice) { setScanPaperStatus(null); return; }
    const dev = scanDevices.find(d => d.id === scanSelectedDevice);
    if (dev && !deviceOnline(dev)) { setScanPaperStatus(null); return; }
    setScanPaperStatus(null); setScanLoadingPaper(true);
    try {
      const s = await scannerFetch<PaperStatus>(`/v1/devices/${scanSelectedDevice}/paper-status`);
      setScanPaperStatus(s);
    } catch {
      setScanPaperStatus({ device_id: scanSelectedDevice, adf: 'unknown', flatbed: 'unknown', flatbed_detectable: false });
    } finally { setScanLoadingPaper(false); }
  }, [scanSelectedDevice, scanDevices]);

  // ── Scanner — efectos ─────────────────────────────────────────────────────
  useEffect(() => { cargarScanDevices(); }, []);
  useEffect(() => { setScanFlatbedPromptDismissed(false); cargarPaperStatus(); }, [scanSelectedDevice]);
  useEffect(() => { setScanFlatbedPromptDismissed(false); }, [scanSource, scanSelectedDevice]);

  // Validar caps cuando cambia dispositivo o config
  useEffect(() => {
    const dev = scanDevices.find(d => d.id === scanSelectedDevice);
    const caps = dev?.capabilities;
    if (!caps) return;
    if (!caps.sources.includes(scanSource as any)) setScanSource(caps.sources[0] || 'flatbed');
    if (!caps.resolutions.includes(scanDpi)) setScanDpi(caps.resolutions.includes(300) ? 300 : caps.resolutions[0] || 300);
    const colorKey = scanColor ? 'color' : 'grayscale';
    if (!caps.color_modes.includes(colorKey) && !caps.color_modes.includes(scanColor ? 'color' : 'gris')) {
      setScanColor(caps.color_modes.includes('color'));
    }
    if (!caps.duplex) setScanDuplex(false);
    if (Array.isArray(caps.paper_sizes) && caps.paper_sizes.length && !caps.paper_sizes.includes(scanPaperSize)) {
      setScanPaperSize(caps.paper_sizes.includes('A4') ? 'A4' : caps.paper_sizes[0]);
    }
  }, [scanDevices, scanSelectedDevice, scanSource, scanDpi, scanColor, scanPaperSize]);

  // JPG no válido con ADF
  useEffect(() => {
    if (scanOutputFormat === 'jpg' && (scanSource !== 'flatbed' || scanDuplex)) setScanOutputFormat('pdf');
  }, [scanOutputFormat, scanSource, scanDuplex]);

  // ── Scanner — toggle favorito ──────────────────────────────────────────────
  const toggleScanFavorite = useCallback((deviceId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setScanFavorites(prev => {
      const next = prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId];
      saveFavorites(next); return next;
    });
  }, []);

  // ── Scanner — poll job ─────────────────────────────────────────────────────
  async function pollScanJob(jobId: number, maxMs = 120_000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 2500));
      const job = await scannerFetch<any>(`/v1/scan-jobs/${jobId}`);
      if (['completed', 'failed', 'canceled'].includes(job.status)) return job;
    }
    throw new Error('Tiempo de espera agotado (120s)');
  }

  // ── Scanner — lanzar escaneo ───────────────────────────────────────────────
  const lanzarEscaneo = useCallback(async () => {
    if (!agente)             { toast.error('Seleccioná un agente'); return; }
    if (!scanSelectedDevice) { toast.error('Seleccioná un dispositivo'); return; }
    if (scanOutputFormat === 'jpg' && (scanSource !== 'flatbed' || scanDuplex)) {
      toast.error('JPG solo con cristal'); return;
    }
    const docName = [formRes.motivo, formRes.numero].filter(Boolean).join(' — ') || 'resolucion';
    setScanPhase('creating'); setScanError(null);
    try {
      const r = await scannerFetch<{ id: number }>('/v1/scan-jobs', {
        method: 'POST',
        body: JSON.stringify({
          device_id: scanSelectedDevice,
          priority: 5, source: scanSource,
          duplex: scanDuplex || scanSource === 'adf_duplex',
          dpi: scanDpi, color: scanColor,
          paper_size: scanPaperSize,
          auto_rotate: true, blank_page_detection: true,
          compression: 'medium', output_format: scanOutputFormat,
          personal_dni: agente.dni,
          personal_ref: formRes.motivo || 'resolucion',
          doc_class: 'resolucion',
          doc_name: docName,
        }),
      });
      setScanPhase('waiting');
      const finalJob = await pollScanJob(r.id);
      if (finalJob.status !== 'completed') throw new Error(finalJob.error_message || `Estado: ${finalJob.status}`);
      setScanPhase('loading_pages');
      const pagesRes = await scannerFetch<{ pages: any[] }>(`/v1/scan-jobs/${r.id}/pages`);
      if (!pagesRes.pages?.length) throw new Error('El escáner no subió ninguna página');
      const newPages: ScannedPage[] = pagesRes.pages.map(p => ({
        jobId: r.id, pageNumber: p.page_number,
        storageKey: p.storage_key, blobUrl: null, loadError: false,
      }));
      setScanSession(prev => [...prev, ...newPages]);
      pagesRes.pages.forEach(async (p) => {
        try {
          const blobUrl = await loadScanImage(p.storage_key);
          blobUrlsRef.current.push(blobUrl);
          setScanSession(prev => prev.map(pg => pg.storageKey === p.storage_key ? { ...pg, blobUrl } : pg));
        } catch {
          setScanSession(prev => prev.map(pg => pg.storageKey === p.storage_key ? { ...pg, loadError: true } : pg));
        }
      });
      setScanPhase('done');
      toast.ok('✅ Página escaneada', `Job #${r.id} · ${docName}`);
    } catch (e: any) {
      setScanPhase('error'); setScanError(e?.message || 'Error desconocido');
      toast.error('Error al escanear', e?.message);
    }
  }, [agente, scanSelectedDevice, scanSource, scanDuplex, scanDpi, scanColor, scanPaperSize, scanOutputFormat, formRes.motivo, formRes.numero]);

  const quitarPaginaScan = useCallback((storageKey: string) => {
    setScanSession(prev => {
      const page = prev.find(p => p.storageKey === storageKey);
      if (page?.blobUrl) URL.revokeObjectURL(page.blobUrl);
      return prev.filter(p => p.storageKey !== storageKey);
    });
  }, []);

  const cerrarViewer = useCallback(() => {
    setScanViewer(prev => {
      if (prev?.revokeOnClose && viewerUrlRef.current === prev.url) {
        URL.revokeObjectURL(prev.url); viewerUrlRef.current = null;
      }
      return null;
    });
  }, []);

  const abrirPaginaEscaneada = useCallback((page: ScannedPage, index: number) => {
    if (!page.blobUrl) return;
    setScanViewer({ title: `Página escaneada ${index + 1}`, url: page.blobUrl, revokeOnClose: false });
  }, []);

  // ── Bypass ─────────────────────────────────────────────────────────────────
  const intentarBypass = () => {
    if (!BYPASS_CODE) { toast.error('Bypass no configurado'); return; }
    if (bypassInput === BYPASS_CODE) {
      setBypassUnlocked(true); setShowBypass(false); setBypassInput('');
      toast.ok('✅ Obligación de escaneo omitida');
    } else {
      toast.error('Código incorrecto');
      setBypassInput('');
    }
  };

  // ── Buscar por DNI ─────────────────────────────────────────────────────────
  const buscarPorDni = useCallback(async () => {
    const clean = dniInput.replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido'); return; }
    setSearching(true);
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (!res?.ok || !res?.data) { toast.error('No encontrado', `DNI ${clean} no existe`); return; }
      seleccionarAgente(res.data);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSearching(false); }
  }, [dniInput]);

  const buscarPorNombre = useCallback(async () => {
    const q = nameInput.trim();
    if (!q) { toast.error('Ingresá un apellido'); return; }
    setSearching(true);
    try {
      const results = await searchPersonal(q);
      setMatches(results.slice(0, 30));
      if (!results.length) toast.error('Sin resultados', `No se encontró "${q}"`);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSearching(false); }
  }, [nameInput]);

  const seleccionarAgente = useCallback(async (a: any) => {
    const dni = String(a.dni).replace(/\D/g, '');
    const perfilCompleto = a.personal || a;
    setAgente({ ...perfilCompleto, dni: Number(dni) });
    setMatches([]);
    setTab('resoluciones');
    setEditRes(null); setFormRes(emptyRes);
    setEditExp(null); setFormExp(emptyExp);
    resetScan();
    setLoadingData(true);
    try {
      const [rRes, rExp, rArch] = await Promise.allSettled([
        fetchAll<any>(`/resoluciones?dni=${dni}`),
        fetchAll<any>(`/expedientes?dni=${dni}`),
        fetchAll<any>(`/tblarchivos?dni=${dni}`),
      ]);
      if (rRes.status  === 'fulfilled') setResoluciones(rRes.value);
      if (rExp.status  === 'fulfilled') setExpedientes(rExp.value);
      if (rArch.status === 'fulfilled') setArchivos(rArch.value);
    } catch (e: any) { toast.error('Error cargando datos', e?.message); }
    finally { setLoadingData(false); }
  }, [resetScan]);

  // ── Guardar resolución ─────────────────────────────────────────────────────
  const guardarRes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) return;
    if (!formRes.motivo) { toast.error('Requerido', 'Seleccioná un tipo de resolución'); return; }

    // Obligación de escaneo para resoluciones NUEVAS
    if (!editRes && scanSession.length === 0 && !bypassUnlocked) {
      toast.error('Escaneo requerido', 'Escaneá la resolución antes de guardar, o ingresá el código de omisión');
      return;
    }

    setSavingRes(true);
    try {
      const body = {
        dni: agente.dni,
        motivo: formRes.motivo,
        numero: formRes.numero || null,
        observaciones: formRes.observaciones || null,
        fecha: formRes.fecha || null,
        created_by: session?.user?.id || null,
      };
      if (editRes) {
        await apiFetch(`/resoluciones/${editRes.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Resolución actualizada');
      } else {
        await apiFetch('/resoluciones', { method: 'POST', body: JSON.stringify(body) });
        // Sincronizar escáner → G:\docu\{dni}\
        if (scanSession.length > 0) {
          const jobIds = [...new Set(scanSession.map(p => p.jobId))];
          await Promise.all(jobIds.map(id =>
            scannerFetch(`/v1/scan-jobs/${id}/sync-personal`, { method: 'POST' }).catch(() => {})
          ));
        }
        toast.ok('Guardado', `Resolución y ${scanSession.length} pág. escaneada(s)`);
      }
      setEditRes(null); setFormRes(emptyRes);
      resetScan();
      const rows = await fetchAll<any>(`/resoluciones?dni=${agente.dni}`);
      setResoluciones(rows);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSavingRes(false); }
  };

  // ── Guardar expediente ─────────────────────────────────────────────────────
  const guardarExp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) return;
    if (!formExp.numero) { toast.error('Requerido', 'El número de expediente es obligatorio'); return; }
    setSavingExp(true);
    try {
      const body = {
        dni: agente.dni, numero: formExp.numero, caratula: formExp.caratula || null,
        fecha: formExp.fecha || null, estado: formExp.estado || null,
        created_by: session?.user?.id || null,
      };
      if (editExp) {
        await apiFetch(`/expedientes/${editExp.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.ok('Actualizado', 'Expediente actualizado');
      } else {
        await apiFetch('/expedientes', { method: 'POST', body: JSON.stringify(body) });
        toast.ok('Guardado', 'Expediente cargado');
      }
      setEditExp(null); setFormExp(emptyExp);
      const rows = await fetchAll<any>(`/expedientes?dni=${agente.dni}`);
      setExpedientes(rows);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setSavingExp(false); }
  };

  // ── Cargar archivo ─────────────────────────────────────────────────────────
  const cargarArchivo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agente) return;
    setUploading(true);
    try {
      await apiFetch('/tblarchivos', {
        method: 'POST',
        body: JSON.stringify({
          dni: agente.dni, nombre: uploadForm.nombre || null,
          numero: uploadForm.numero || null, tipo: uploadForm.tipo || 'documento',
          fecha: uploadForm.fecha || null, descripcion_archivo: uploadForm.descripcion || null,
          anio: new Date().getFullYear(),
        }),
      });
      toast.ok('Archivo cargado');
      setShowUploadForm(false); setUploadForm(emptyUpload);
      const rows = await fetchAll<any>(`/tblarchivos?dni=${agente.dni}`);
      setArchivos(rows);
    } catch (e: any) { toast.error('Error al cargar', e?.message); }
    finally { setUploading(false); }
  };

  const startEditRes = (r: any) => {
    setEditRes(r);
    setFormRes({ motivo: r.motivo || '', numero: r.numero || '', observaciones: r.observaciones || '', fecha: r.fecha ? String(r.fecha).slice(0, 10) : '' });
    resetScan();
    setTab('resoluciones');
  };
  const startEditExp = (r: any) => {
    setEditExp(r);
    setFormExp({ numero: r.numero || '', caratula: r.caratula || '', fecha: r.fecha ? String(r.fecha).slice(0, 10) : '', estado: r.estado || '' });
    setTab('expedientes');
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const dni = agente?.dni ? String(agente.dni) : '';
  const nombreCompleto = agente ? `${agente.apellido || ''}, ${agente.nombre || ''}`.trim().replace(/^,\s*/, '') : '';

  const scanDevice   = scanDevices.find(d => d.id === scanSelectedDevice) || null;
  const scanCaps     = scanDevice?.capabilities;
  const scanIsOnline = scanDevice ? deviceOnline(scanDevice) : false;
  const scanOnlineDevices = scanDevices.filter(deviceOnline);
  const scanUsesAdf  = scanSource === 'adf' || scanSource === 'adf_duplex';
  const scanAdfEmpty = scanUsesAdf && scanPaperStatus?.adf === 'empty';
  const scanFlatbedQ = scanUsesAdf && scanPaperStatus?.flatbed === 'loaded' && !scanFlatbedPromptDismissed;
  const isScanning   = ['creating', 'waiting', 'loading_pages'].includes(scanPhase);
  const hasPages     = scanSession.length > 0;
  const puedeEscanear = !!agente && !!scanSelectedDevice && scanIsOnline && !isScanning && !scanAdfEmpty && !scanFlatbedQ;
  const puedeGuardar  = !editRes ? (hasPages || bypassUnlocked) : true;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Layout title="Resoluciones y Expedientes" showBack>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* ── Título ── */}
        <div style={{ marginBottom: 18 }}>
          <strong style={{ fontSize: '1.05rem' }}>📋 Resoluciones y Expedientes</strong>
          <div className="muted" style={{ fontSize: '0.73rem', marginTop: 3 }}>
            Gestioná resoluciones, expedientes y archivos por agente
          </div>
        </div>

        {/* ── Buscador de agente ── */}
        <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label htmlFor="res-busq-dni" style={lbl}>Buscar por DNI</label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input id="res-busq-dni" name="dniInput" className="input"
                  style={{ fontSize: '0.85rem' }} placeholder="Ej: 28305607"
                  value={dniInput}
                  onChange={e => setDniInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && buscarPorDni()} />
                <button className="btn primary" onClick={buscarPorDni} disabled={searching} style={{ whiteSpace: 'nowrap' }}>
                  {searching ? '…' : 'Buscar'}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="res-busq-nombre" style={lbl}>Buscar por apellido / nombre</label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input id="res-busq-nombre" name="nameInput" className="input"
                  style={{ fontSize: '0.85rem' }} placeholder="Ej: García"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && buscarPorNombre()} />
                <button className="btn" onClick={buscarPorNombre} disabled={searching} style={{ whiteSpace: 'nowrap' }}>
                  {searching ? '…' : 'Buscar'}
                </button>
              </div>
            </div>
          </div>
          {matches.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 220, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
              {matches.map((m, i) => (
                <div key={i} onClick={() => seleccionarAgente(m)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.83rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 12, alignItems: 'center' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <span style={{ fontFamily: 'monospace', color: '#94a3b8', minWidth: 80 }}>{m.dni}</span>
                  <span style={{ fontWeight: 600 }}>{m.apellido}, {m.nombre}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Panel del agente ── */}
        {agente && (
          <>
            {/* Header agente */}
            <div className="card" style={{ marginBottom: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>{nombreCompleto}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>DNI {dni}</div>
              </div>
              <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => { setAgente(null); setMatches([]); setDniInput(''); setNameInput(''); resetScan(); }}>
                ✕ Cerrar
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              {(['resoluciones', 'expedientes', 'archivos'] as TabId[]).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)} style={{
                  fontSize: '0.82rem', padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${tab === t ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                  background: tab === t ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.04)',
                  color: tab === t ? '#c4b5fd' : '#94a3b8', fontWeight: tab === t ? 700 : 400,
                }}>
                  {t === 'resoluciones' && `📜 Resoluciones (${resoluciones.length})`}
                  {t === 'expedientes'  && `📁 Expedientes (${expedientes.length})`}
                  {t === 'archivos'     && `🗂️ Archivos (${archivos.length})`}
                </button>
              ))}
            </div>

            {loadingData ? (
              <div className="card" style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>🔄 Cargando…</div>
            ) : (
              <>

                {/* ══════════════════════════════════════════
                    TAB RESOLUCIONES
                ══════════════════════════════════════════ */}
                {tab === 'resoluciones' && (
                  <div style={{ display: 'grid', gridTemplateColumns: editRes ? '1fr 340px' : '1fr 520px', gap: 14, alignItems: 'start' }}>

                    {/* ── Tabla resoluciones ── */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        Resoluciones del agente
                      </div>
                      {resoluciones.length === 0 ? (
                        <div className="muted" style={{ padding: '20px 14px', fontSize: '0.82rem' }}>Sin resoluciones registradas.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={th}>Tipo / Motivo</th>
                                <th style={th}>Número</th>
                                <th style={th}>Fecha</th>
                                <th style={th}>Observaciones</th>
                                <th style={th}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {resoluciones.map(r => (
                                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                  <td style={td}>{r.motivo || '—'}</td>
                                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.numero || '—'}</td>
                                  <td style={td}>{fmt(r.fecha)}</td>
                                  <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.observaciones || '—'}</td>
                                  <td style={td}>
                                    <button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => startEditRes(r)}>✏️</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* ── Columna derecha: form + scanner ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                      {/* ── Formulario ── */}
                      <div className="card" style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12 }}>
                          {editRes ? '✏️ Editar resolución' : '+ Nueva resolución'}
                        </div>
                        <form onSubmit={guardarRes} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={fg}>
                            <label htmlFor="res-tipo" style={lbl}>Tipo de resolución *</label>
                            <select id="res-tipo" name="resMotivo" className="input" style={{ fontSize: '0.83rem' }}
                              value={formRes.motivo}
                              onChange={e => setFormRes(f => ({ ...f, motivo: e.target.value }))} required>
                              <option value="">— Seleccioná —</option>
                              {tiposRes.map(t => (
                                <option key={t.id} value={t.resolucion_nombre}>{t.resolucion_nombre}</option>
                              ))}
                            </select>
                          </div>
                          <div style={fg}>
                            <label htmlFor="res-numero" style={lbl}>Número</label>
                            <input id="res-numero" name="resNumero" className="input" style={{ fontSize: '0.83rem' }}
                              placeholder="Ej: 1234/2026" value={formRes.numero}
                              onChange={e => setFormRes(f => ({ ...f, numero: e.target.value }))} />
                          </div>
                          <div style={fg}>
                            <label htmlFor="res-fecha" style={lbl}>Fecha</label>
                            <input id="res-fecha" name="resFecha" className="input" type="date" style={{ fontSize: '0.83rem' }}
                              value={formRes.fecha} onChange={e => setFormRes(f => ({ ...f, fecha: e.target.value }))} />
                          </div>
                          <div style={fg}>
                            <label htmlFor="res-obs" style={lbl}>Observaciones</label>
                            <input id="res-obs" name="resObservaciones" className="input" style={{ fontSize: '0.83rem' }}
                              placeholder="Texto corto…" maxLength={50} value={formRes.observaciones}
                              onChange={e => setFormRes(f => ({ ...f, observaciones: e.target.value }))} />
                          </div>

                          {/* Indicador de escaneo (solo nueva) */}
                          {!editRes && (
                            <div style={{
                              padding: '8px 10px', borderRadius: 8, fontSize: '0.78rem',
                              background: hasPages
                                ? 'rgba(16,185,129,0.12)' : bypassUnlocked
                                ? 'rgba(245,158,11,0.12)'
                                : 'rgba(239,68,68,0.1)',
                              border: `1px solid ${hasPages ? 'rgba(16,185,129,0.3)' : bypassUnlocked ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                              color: hasPages ? '#6ee7b7' : bypassUnlocked ? '#fcd34d' : '#fca5a5',
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                              {hasPages
                                ? `✅ ${scanSession.length} página(s) escaneada(s) — listo para guardar`
                                : bypassUnlocked
                                ? '🔓 Escaneo omitido con código de autorización'
                                : '📷 Requerido: escaneá la resolución antes de guardar'}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn primary" type="submit"
                              disabled={savingRes || !puedeGuardar}
                              style={{ flex: 1, opacity: !puedeGuardar ? 0.45 : 1 }}>
                              {savingRes ? '⏳ Guardando…' : editRes ? 'Actualizar' : 'Guardar resolución'}
                            </button>
                            {editRes && (
                              <button className="btn" type="button" onClick={() => { setEditRes(null); setFormRes(emptyRes); }}>
                                Cancelar
                              </button>
                            )}
                          </div>

                          {/* Bypass — solo para nueva resolución */}
                          {!editRes && !bypassUnlocked && (
                            <div style={{ marginTop: 4 }}>
                              {!showBypass ? (
                                <button type="button" className="btn" style={{ fontSize: '0.72rem', color: '#94a3b8', padding: '3px 8px' }}
                                  onClick={() => setShowBypass(true)}>
                                  🔓 Omitir escaneo
                                </button>
                              ) : (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  <input
                                    className="input" type="password"
                                    style={{ fontSize: '0.8rem', flex: 1 }}
                                    placeholder="Código de autorización"
                                    value={bypassInput}
                                    onChange={e => setBypassInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && intentarBypass()}
                                    autoFocus
                                  />
                                  <button type="button" className="btn primary" style={{ fontSize: '0.78rem' }} onClick={intentarBypass}>
                                    Desbloquear
                                  </button>
                                  <button type="button" className="btn" style={{ fontSize: '0.78rem' }} onClick={() => { setShowBypass(false); setBypassInput(''); }}>
                                    ✕
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </form>
                      </div>

                      {/* ══════════════════════════════════════
                          SECCIÓN ESCÁNER — solo nueva resolución
                      ══════════════════════════════════════ */}
                      {!editRes && (
                        <div className="card scan-card">
                          <div className="scan-section-title" style={{ marginBottom: 12 }}>
                            📷 Escanear resolución
                            {formRes.motivo && (
                              <span className="badge" style={{ marginLeft: 8, fontSize: '0.68rem', fontWeight: 400 }}>
                                {[formRes.motivo, formRes.numero].filter(Boolean).join(' — ')}
                              </span>
                            )}
                          </div>

                          {/* ── Dispositivo ── */}
                          <div className="muted scan-label">Dispositivo</div>
                          {scanLoadingDevices ? (
                            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>Cargando escáneres…</div>
                          ) : scanOnlineDevices.length === 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                              <div className="muted" style={{ fontSize: '0.78rem' }}>No hay escáneres en línea</div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn" style={{ fontSize: '0.75rem' }} onClick={cargarScanDevices} disabled={scanLoadingDevices}>↺ Actualizar</button>
                                <button className="btn" style={{ fontSize: '0.75rem' }} onClick={descubrirScanDevices} disabled={scanDiscovering}>
                                  {scanDiscovering ? '🔄 Buscando…' : '📡 Buscar en red'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginTop: 4 }}>
                              <div className="scan-device-list scan-device-list-scroll" style={{ maxHeight: 160 }}>
                                {scanOnlineDevices.map(d => {
                                  const isFav = scanFavorites.includes(d.id);
                                  return (
                                    <button key={d.id}
                                      className={`scan-device-btn${scanSelectedDevice === d.id ? ' selected' : ''}`}
                                      onClick={() => setScanSelectedDevice(d.id)}>
                                      <div className="scan-device-row">
                                        <span style={{ fontSize: '0.85rem', cursor: 'pointer', color: isFav ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}
                                          onClick={e => toggleScanFavorite(d.id, e)}>
                                          {isFav ? '★' : '☆'}
                                        </span>
                                        <span className="scan-dot online" />
                                        <b style={{ flexGrow: 1, textAlign: 'left', fontSize: '0.8rem' }}>{d.name}</b>
                                      </div>
                                      {d.capabilities?.model && (
                                        <div className="muted" style={{ fontSize: '0.68rem', paddingLeft: 36 }}>
                                          {d.capabilities.manufacturer} {d.capabilities.model}
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                              <button className="btn" style={{ fontSize: '0.72rem', marginTop: 4 }} onClick={cargarScanDevices} disabled={scanLoadingDevices}>
                                {scanLoadingDevices ? '🔄' : '↺ Actualizar'}
                              </button>
                            </div>
                          )}

                          {/* ── Config — solo si hay caps ── */}
                          {scanCaps && (
                            <>
                              {/* Estado del papel */}
                              <div className="scan-paper-panel" style={{ marginTop: 10 }}>
                                <div className="scan-paper-row">
                                  <span className={`scan-paper-pill${paperClass(scanPaperStatus?.adf)}`}>
                                    ADF: {scanLoadingPaper ? '…' : PAPER_LABEL[scanPaperStatus?.adf || 'unknown']}
                                  </span>
                                  <span className={`scan-paper-pill${paperClass(scanPaperStatus?.flatbed)}`}>
                                    Cristal: {scanLoadingPaper ? '…' : PAPER_LABEL[scanPaperStatus?.flatbed || 'unknown']}
                                  </span>
                                  <button type="button" className="scan-paper-refresh"
                                    onClick={cargarPaperStatus} disabled={scanLoadingPaper || !scanSelectedDevice}>
                                    Actualizar
                                  </button>
                                </div>
                                {scanAdfEmpty && (
                                  <div className="scan-paper-warning">ADF sin hojas. Cargá hojas o cambiá a cristal.</div>
                                )}
                                {scanFlatbedQ && (
                                  <div className="scan-source-question">
                                    <span>Hay hoja en cristal. ¿Escaneás por cristal?</span>
                                    <div className="scan-source-question-actions">
                                      <button type="button" className="btn" onClick={() => { setScanSource('flatbed'); setScanDuplex(false); setScanFlatbedPromptDismissed(true); }}>Usar cristal</button>
                                      <button type="button" className="btn" onClick={() => setScanFlatbedPromptDismissed(true)}>Seguir ADF</button>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Bandeja / Fuente */}
                              <div className="muted scan-label" style={{ marginTop: 10 }}>Bandeja / Fuente</div>
                              <div className="scan-caps-grid">
                                {scanCaps.sources.map(s => (
                                  <button key={s} type="button"
                                    className={`scan-cap-btn${scanSource === s ? ' selected' : ''}`}
                                    onClick={() => { setScanSource(s); if (s !== 'adf_duplex') setScanDuplex(false); }}>
                                    {SOURCE_LABEL[s] || s}
                                    {s === 'adf_duplex' && <span className="scan-cap-tag">Dúplex</span>}
                                  </button>
                                ))}
                              </div>

                              {/* Resolución */}
                              <div className="muted scan-label" style={{ marginTop: 10 }}>Resolución</div>
                              <div className="scan-caps-grid">
                                {(scanCaps.resolutions.length ? scanCaps.resolutions : [150, 300, 600]).map(r => (
                                  <button key={r} type="button"
                                    className={`scan-cap-btn${scanDpi === r ? ' selected' : ''}`}
                                    onClick={() => setScanDpi(r)}>
                                    {r} dpi
                                  </button>
                                ))}
                              </div>

                              {/* Modo de color */}
                              <div className="muted scan-label" style={{ marginTop: 10 }}>Color</div>
                              <div className="scan-caps-grid">
                                {(scanCaps.color_modes.length ? scanCaps.color_modes : ['color', 'gris']).map(m => (
                                  <button key={m} type="button"
                                    className={`scan-cap-btn${(scanColor ? 'color' : 'gris') === m ? ' selected' : ''}`}
                                    onClick={() => setScanColor(m === 'color')}>
                                    {m === 'color' ? '🎨 Color' : '⬜ Grises'}
                                  </button>
                                ))}
                              </div>

                              {/* Tamaño de página */}
                              <div className="muted scan-label" style={{ marginTop: 10 }}>Tamaño de página</div>
                              <div className="scan-caps-grid">
                                {(scanCaps.paper_sizes.length ? scanCaps.paper_sizes : ['A4']).map(p => (
                                  <button key={p} type="button"
                                    className={`scan-cap-btn${scanPaperSize === p ? ' selected' : ''}`}
                                    onClick={() => setScanPaperSize(p)}>
                                    {p === 'Letter' || p === 'Carta' ? 'Carta / Letter' :
                                     p === 'Legal'  || p === 'Oficio' ? 'Oficio / Legal' : p}
                                  </button>
                                ))}
                              </div>

                              {/* Formato */}
                              <div className="muted scan-label" style={{ marginTop: 10 }}>Formato</div>
                              <div className="scan-caps-grid">
                                {(['pdf', 'pdf_a', 'tiff', 'jpg'] as OutputFormat[]).map(fmt => {
                                  const dis = fmt === 'jpg' && (scanSource !== 'flatbed' || scanDuplex);
                                  return (
                                    <button key={fmt} type="button"
                                      className={`scan-cap-btn${scanOutputFormat === fmt ? ' selected' : ''}`}
                                      onClick={() => { if (!dis) setScanOutputFormat(fmt); }}
                                      disabled={dis} title={dis ? 'JPG solo con cristal' : undefined}>
                                      {fmt.toUpperCase()}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Dúplex */}
                              {(scanSource === 'adf' || scanSource === 'adf_duplex') && scanCaps.duplex && (
                                <label className="scan-checkbox-row" style={{ marginTop: 10 }}>
                                  <input type="checkbox" checked={scanDuplex} onChange={e => setScanDuplex(e.target.checked)} />
                                  <span>Escanear ambas caras (dúplex)</span>
                                </label>
                              )}
                            </>
                          )}

                          {/* ── Resumen ── */}
                          {scanDevice && (
                            <div className="scan-summary" style={{ marginTop: 12 }}>
                              <div className="scan-summary-row">
                                <span className="muted">Dispositivo</span>
                                <span>
                                  <span className={`scan-dot${scanIsOnline ? ' online' : ''}`} style={{ marginRight: 5 }} />
                                  {scanDevice.name}
                                </span>
                              </div>
                              <div className="scan-summary-row">
                                <span className="muted">Resolución</span>
                                <span>{scanDpi} dpi · {scanColor ? 'Color' : 'Grises'}</span>
                              </div>
                              <div className="scan-summary-row">
                                <span className="muted">Tamaño</span>
                                <span>{scanPaperSize}</span>
                              </div>
                              <div className="scan-summary-row">
                                <span className="muted">Formato</span>
                                <span>{scanOutputFormat.toUpperCase()}</span>
                              </div>
                            </div>
                          )}

                          {/* ── Fase activa ── */}
                          {isScanning && (
                            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', fontSize: '0.82rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span className="scan-pulse-dot" />
                              {SCAN_PHASE_LABEL[scanPhase]}
                            </div>
                          )}
                          {scanPhase === 'error' && scanError && (
                            <div className="scan-job-err" style={{ marginTop: 8 }}>❌ {scanError}</div>
                          )}

                          {/* ── Botón escanear ── */}
                          <button type="button"
                            className={`btn scan-btn-launch${puedeEscanear ? ' ready' : ''}`}
                            style={{ marginTop: 10, width: '100%' }}
                            onClick={lanzarEscaneo} disabled={!puedeEscanear}>
                            {isScanning ? (SCAN_PHASE_LABEL[scanPhase] || '⏳ Escaneando…')
                              : !scanSelectedDevice || !scanIsOnline ? '🔌 Sin escáner'
                              : scanAdfEmpty ? '📄 ADF sin hojas'
                              : scanFlatbedQ  ? '🪟 Confirmar fuente'
                              : hasPages ? '📄 Escanear otra página'
                              : '▶ Escanear resolución'}
                          </button>

                          {/* ── Preview páginas ── */}
                          {hasPages && (
                            <div style={{ marginTop: 14 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <span className="scan-section-title" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
                                  🖼️ Páginas escaneadas
                                  <span className="badge" style={{ marginLeft: 6, background: 'rgba(16,185,129,0.2)', color: '#6ee7b7' }}>
                                    {scanSession.length} pág.
                                  </span>
                                </span>
                                <button type="button" className="btn" style={{ fontSize: '0.7rem', padding: '3px 8px', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}
                                  onClick={resetScan}>
                                  🗑️ Descartar
                                </button>
                              </div>
                              <div className="scan-preview-grid">
                                {scanSession.map((page, idx) => (
                                  <div key={page.storageKey}
                                    className="scan-preview-thumb scan-preview-thumb-live"
                                    role="button" tabIndex={0}
                                    title="Doble click para ampliar"
                                    onDoubleClick={() => abrirPaginaEscaneada(page, idx)}
                                    onKeyDown={e => e.key === 'Enter' && abrirPaginaEscaneada(page, idx)}>
                                    <div className="scan-preview-frame">
                                      {page.blobUrl ? (
                                        <img src={page.blobUrl} alt={`Pág. ${idx + 1}`} className="scan-preview-img" />
                                      ) : page.loadError ? (
                                        <div className="scan-preview-state scan-preview-error">❌<br />Error</div>
                                      ) : (
                                        <div className="scan-preview-state">
                                          <div className="scan-pulse-dot" style={{ margin: '0 auto 4px' }} />
                                          Cargando…
                                        </div>
                                      )}
                                      <div className="scan-preview-num">Pág. {idx + 1}</div>
                                      <button type="button" className="scan-preview-remove"
                                        onClick={e => { e.stopPropagation(); quitarPaginaScan(page.storageKey); }}
                                        title="Quitar">×</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* fin columna derecha */}

                  </div>
                )}
                {/* fin tab resoluciones */}

                {/* ══════════════════════════════════════════
                    TAB EXPEDIENTES
                ══════════════════════════════════════════ */}
                {tab === 'expedientes' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 14, alignItems: 'start' }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        Expedientes del agente
                      </div>
                      {expedientes.length === 0 ? (
                        <div className="muted" style={{ padding: '20px 14px', fontSize: '0.82rem' }}>Sin expedientes registrados.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={th}>Número</th><th style={th}>Carátula</th>
                                <th style={th}>Fecha</th><th style={th}>Estado</th><th style={th}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {expedientes.map(r => (
                                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{r.numero || '—'}</td>
                                  <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.caratula || '—'}</td>
                                  <td style={td}>{fmt(r.fecha)}</td>
                                  <td style={td}>
                                    {r.estado
                                      ? <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5, background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', fontWeight: 600 }}>{r.estado}</span>
                                      : '—'}
                                  </td>
                                  <td style={td}><button className="btn" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => startEditExp(r)}>✏️</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div className="card" style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 12 }}>
                        {editExp ? '✏️ Editar expediente' : '+ Nuevo expediente'}
                      </div>
                      <form onSubmit={guardarExp} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={fg}>
                          <label htmlFor="exp-numero" style={lbl}>Número de expediente *</label>
                          <input id="exp-numero" name="expNumero" className="input" style={{ fontSize: '0.83rem', fontFamily: 'monospace' }}
                            placeholder="EX-23756257-GDEBA-2026" value={formExp.numero}
                            onChange={e => setFormExp(f => ({ ...f, numero: e.target.value }))} required />
                          <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Formato: EX-NNNNN-GDEBA-AAAA</span>
                        </div>
                        <div style={fg}>
                          <label htmlFor="exp-caratula" style={lbl}>Carátula</label>
                          <input id="exp-caratula" name="expCaratula" className="input" style={{ fontSize: '0.83rem' }}
                            placeholder="Descripción del expediente" value={formExp.caratula}
                            onChange={e => setFormExp(f => ({ ...f, caratula: e.target.value }))} />
                        </div>
                        <div style={fg}>
                          <label htmlFor="exp-fecha" style={lbl}>Fecha</label>
                          <input id="exp-fecha" name="expFecha" className="input" type="date" style={{ fontSize: '0.83rem' }}
                            value={formExp.fecha} onChange={e => setFormExp(f => ({ ...f, fecha: e.target.value }))} />
                        </div>
                        <div style={fg}>
                          <label htmlFor="exp-estado" style={lbl}>Estado</label>
                          <select id="exp-estado" name="expEstado" className="input" style={{ fontSize: '0.83rem' }}
                            value={formExp.estado} onChange={e => setFormExp(f => ({ ...f, estado: e.target.value }))}>
                            <option value="">— Sin estado —</option>
                            <option value="En trámite">En trámite</option>
                            <option value="Resuelto">Resuelto</option>
                            <option value="Archivado">Archivado</option>
                            <option value="Pendiente">Pendiente</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn primary" type="submit" disabled={savingExp} style={{ flex: 1 }}>
                            {savingExp ? '…' : editExp ? 'Actualizar' : 'Guardar'}
                          </button>
                          {editExp && (
                            <button className="btn" type="button" onClick={() => { setEditExp(null); setFormExp(emptyExp); }}>Cancelar</button>
                          )}
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {/* ══════════════════════════════════════════
                    TAB ARCHIVOS
                ══════════════════════════════════════════ */}
                {tab === 'archivos' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="card" style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>🗂️ Archivos del agente</span>
                        <button className="btn" style={{ fontSize: '0.75rem' }} onClick={() => setShowUploadForm(s => !s)}>
                          {showUploadForm ? 'Cancelar' : '+ Nuevo registro'}
                        </button>
                      </div>
                      {showUploadForm && (
                        <form onSubmit={cargarArchivo} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ flex: 2, minWidth: 160 }}>
                              <label htmlFor="res-up-nombre" style={lbl}>NOMBRE DEL ARCHIVO</label>
                              <input id="res-up-nombre" name="nombre" className="input" placeholder="Ej: Resolución ascenso 2026"
                                value={uploadForm.nombre} onChange={e => setUploadForm(f => ({ ...f, nombre: e.target.value }))}
                                style={{ width: '100%', boxSizing: 'border-box', marginTop: 3 }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 120 }}>
                              <label htmlFor="res-up-numero" style={lbl}>NÚMERO</label>
                              <input id="res-up-numero" name="numero" className="input" placeholder="Ej: 1234/2026"
                                value={uploadForm.numero} onChange={e => setUploadForm(f => ({ ...f, numero: e.target.value }))}
                                style={{ width: '100%', boxSizing: 'border-box', marginTop: 3 }} />
                            </div>
                            <div style={{ minWidth: 140 }}>
                              <label htmlFor="res-up-tipo" style={lbl}>TIPO</label>
                              <select id="res-up-tipo" name="tipo" className="input" value={uploadForm.tipo}
                                onChange={e => setUploadForm(f => ({ ...f, tipo: e.target.value }))}
                                style={{ width: '100%', boxSizing: 'border-box', marginTop: 3 }}>
                                <option value="resolución">resolución</option>
                                <option value="expediente">expediente</option>
                                <option value="nota">nota</option>
                                <option value="certificado">certificado</option>
                                <option value="foto">foto</option>
                                <option value="documento">documento</option>
                                <option value="otro">otro</option>
                              </select>
                            </div>
                            <div style={{ minWidth: 130 }}>
                              <label htmlFor="res-up-fecha" style={lbl}>FECHA</label>
                              <input id="res-up-fecha" name="fecha" type="date" className="input" value={uploadForm.fecha}
                                onChange={e => setUploadForm(f => ({ ...f, fecha: e.target.value }))}
                                style={{ width: '100%', boxSizing: 'border-box', marginTop: 3 }} />
                            </div>
                          </div>
                          <div>
                            <label htmlFor="res-up-desc" style={lbl}>DESCRIPCIÓN</label>
                            <input id="res-up-desc" name="descripcion" className="input" placeholder="Descripción del archivo"
                              value={uploadForm.descripcion} onChange={e => setUploadForm(f => ({ ...f, descripcion: e.target.value }))}
                              style={{ width: '100%', boxSizing: 'border-box', marginTop: 3 }} />
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn primary" type="submit" disabled={uploading}>
                              {uploading ? '⏳ Guardando…' : '💾 Guardar'}
                            </button>
                            <button className="btn" type="button" onClick={() => { setShowUploadForm(false); setUploadForm(emptyUpload); }}>Cancelar</button>
                          </div>
                        </form>
                      )}
                    </div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        Archivos escaneados del agente
                      </div>
                      {archivos.length === 0 ? (
                        <div className="muted" style={{ padding: '20px 14px', fontSize: '0.82rem' }}>Sin archivos registrados.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={th}>Archivo</th><th style={th}>Tipo</th><th style={th}>Número</th>
                                <th style={th}>Año</th><th style={th}>Fecha</th><th style={th}>Descripción</th><th style={th}>Ruta</th>
                              </tr>
                            </thead>
                            <tbody>
                              {archivos.map(a => (
                                <tr key={a.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                  <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#c4b5fd' }}>
                                      {a.nombre_archivo_original || a.nombre || '—'}
                                    </span>
                                  </td>
                                  <td style={td}>{a.tipo || '—'}</td>
                                  <td style={{ ...td, fontFamily: 'monospace' }}>{a.numero || '—'}</td>
                                  <td style={td}>{a.anio || '—'}</td>
                                  <td style={td}>{fmt(a.fecha)}</td>
                                  <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.descripcion_archivo || '—'}</td>
                                  <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    <span className="muted" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }} title={a.ruta || ''}>{a.ruta || '—'}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </>
            )}
          </>
        )}
      </div>

      {/* ── Viewer de páginas escaneadas ── */}
      {scanViewer && (
        <div className="scan-viewer-backdrop" role="dialog" aria-modal="true" onClick={cerrarViewer}>
          <div className="scan-viewer-modal" onClick={e => e.stopPropagation()}>
            <div className="scan-viewer-header">
              <div className="scan-viewer-title">{scanViewer.title}</div>
              <button className="btn" type="button" onClick={cerrarViewer}>Cerrar</button>
            </div>
            <div className="scan-viewer-body">
              <img src={scanViewer.url} alt={scanViewer.title} className="scan-viewer-image" />
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
