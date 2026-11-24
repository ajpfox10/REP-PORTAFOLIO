// src/pages/EscaneoPage/index.tsx — Scanner v3: dispositivos, bandejas, cola en tiempo real

// ─── Types ────────────────────────────────────────────────────────────────────
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { TIPOS_DOCUMENTO, GROUP_LABELS } from './documentTypes';
import { SUBCARPETAS_PRESETS, presetSubdivisiones, CARPETA_POR_TIPO } from './subcarpetas';
import { ScanPagesOrganizer, scanPageId, applyScanPageOrder } from './ScanPagesOrganizer';
import './styles/EscaneoPage.css';
import { useAuth } from '../../auth/AuthProvider';

// Tipo "Resolución": no va al legajo (DOCU) sino a RESOLUCIONES Y VARIOS, con el nombre de la
// resolución y vinculada a ella. Se usa el mismo ref que la página Resoluciones:
// 'respage|motivo|numero|fecha' (el backend decide carpeta, nombre y archivo_id con eso).
const TIPO_RESOLUCION = 'resolucion';
const refResolucion = (motivo: string, numero: string, fecha: string) =>
  ['respage', motivo || '', numero || '', fecha || ''].join('|');

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

async function loadScanImage(storageKey: string, timeoutMs = 20_000): Promise<string> {
  const url = `${getScannerBase()}/v1/documents/files/${storageKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: getScannerHeaders(), signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Timeout cargando miniatura');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const FAV_KEY = 'scanner_favorites_v1';
function loadFavorites(): number[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(ids: number[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch {}
}

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
  progress_message?: string | null;
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
  storageKey: string; blobUrl: string | null; loadError: boolean; rotating?: boolean;
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

const PAPER_SIZE_LABELS: Record<string, string> = {
  A4: 'A4', A3: 'A3', A5: 'A5', A6: 'A6', B4: 'B4', B5: 'B5',
  Letter: 'Carta / Letter', Carta: 'Carta / Letter',
  Legal: 'Oficio / Legal', Oficio: 'Oficio / Legal',
  Folio: 'Folio', Tabloid: 'Tabloid / Ledger', Ledger: 'Tabloid / Ledger',
  Executive: 'Executive', Statement: 'Statement',
};

const PAPER_LABEL: Record<PaperState, string> = {
  loaded: 'Con hojas',
  empty: 'Sin hojas',
  unknown: 'No detectable',
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
function scanUserLabel(d: any) {
  return d?.escaneado_por_nombre || d?.escaneado_por_email || '';
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
    .replace(/[\u0300-\u036f]/g, '')
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
  title: string;
  url: string;
  contentType?: string;
  filename?: string | null;
  kind: 'scan' | 'document';
  revokeOnClose: boolean;
} | null;

// Resolución por defecto de TODOS los escaneos: 600 dpi; si el equipo no la tiene, la más alta que ofrezca.
const DPI_PREFERIDO = 600;
function dpiPreferido(res: number[] | null | undefined): number {
  if (!Array.isArray(res) || !res.length) return DPI_PREFERIDO;
  return res.includes(DPI_PREFERIDO) ? DPI_PREFERIDO : Math.max(...res);
}

// modo 'reemplazar' = 📷 Re-escanear documento (lo de antes va a Trasladados);
// modo 'agregar' = ➕ Agregar hoja (se mete en su lugar: después de `despuesDe`, o al final si es null).
type ReescaneoInfo = {
  id: string; modo: 'reemplazar' | 'agregar'; dni: number; documento: string; carpeta: string;
  rels: string[]; archivos: string[]; despuesDe: { rel: string; page: number; n: number } | null;
};

// Oscuridad que se aplica a cada hoja al guardar (el escáner no acepta brillo/contraste por eSCL).
const OSCURIDADES: Array<{ v: 0 | 1 | 2 | 3; label: string }> = [
  { v: 0, label: 'Normal' }, { v: 1, label: 'Oscuro' }, { v: 2, label: 'Más oscuro' }, { v: 3, label: 'Muy oscuro' },
];

function leerReescaneoDeUrl(): ReescaneoInfo | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('reescaneo');
    if (!raw) return null;
    const d = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (!d || !Number(d.dni) || !d.carpeta || !Array.isArray(d.rels)) return null;
    const dd = d.despuesDe && d.despuesDe.rel
      ? { rel: String(d.despuesDe.rel), page: Number(d.despuesDe.page) || 0, n: Number(d.despuesDe.n) || 0 }
      : null;
    return {
      id: String(d.id || Date.now()), modo: d.modo === 'agregar' ? 'agregar' : 'reemplazar',
      dni: Number(d.dni), documento: String(d.documento || d.carpeta),
      carpeta: String(d.carpeta), rels: d.rels.map(String), archivos: Array.isArray(d.archivos) ? d.archivos.map(String) : [],
      despuesDe: dd,
    };
  } catch { return null; }
}

const sinTildesLower = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

// Tipo de documento a partir del nombre de los archivos viejos (el escáner los nombra con
// el label del tipo: "Decl. Jurada de Condiciones de Salud (2-4).jpg", "…-1142.pdf").
function tipoDesdeArchivos(archivos: string[]): string {
  for (const a of archivos) {
    const base = sinTildesLower(a.replace(/\.[^.]+$/, '').replace(/\s*\(\d+-\d+\)$/, '').replace(/-\d+$/, ''));
    const t = TIPOS_DOCUMENTO.find(x => sinTildesLower(x.label) === base);
    if (t) return t.value;
  }
  return '';
}

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

  // Modo "📷 Re-escanear documento" (viene de Trámites → 🗂️ Documentos en otra pestaña):
  // ?reescaneo=<base64 JSON {id,dni,documento,carpeta,rels,archivos}>. Precarga agente,
  // carpeta, tipo y máx. resolución; al guardar, los archivos de antes van a Trasladados.
  const [reescaneo, setReescaneo] = useState<ReescaneoInfo | null>(leerReescaneoDeUrl);
  const reescaneoPrecargadoRef = useRef(false);

  // Tipo de documento — OBLIGATORIO
  const [tipoDoc, setTipoDoc] = useState<string>('');

  // Descripción adicional (opcional)
  const [descripcion, setDescripcion] = useState('');

  // Tipo Resolución: de qué resolución es (una del agente sin archivo, o una nueva)
  const { session: authSession } = useAuth();
  const [resPendientes, setResPendientes] = useState<any[]>([]);
  const [tiposRes, setTiposRes]           = useState<any[]>([]);
  const [resElegida, setResElegida]       = useState<string>(''); // id de una ya cargada | '' = form nuevo
  const RES_VACIA = { motivo: '', numero: '', fecha: '', observaciones: '' };
  const [resNueva, setResNueva]           = useState(RES_VACIA);
  const [resGuardada, setResGuardada]     = useState<{ numero: string; ruta: string | null; buscando: boolean } | null>(null);
  const esResolucion = tipoDoc === TIPO_RESOLUCION;

  // Subcarpeta destino dentro del legajo (…\docu\<DNI>\<categoría>\<subdivisión>\)
  // '' en ambos = raíz del legajo (comportamiento clásico)
  const [subCategoria, setSubCategoria] = useState('');
  const [subDivision, setSubDivision]   = useState('');
  const [subDiskL1, setSubDiskL1]       = useState<string[]>([]); // carpetas ya existentes en la raíz del DNI
  const [subDiskL2, setSubDiskL2]       = useState<string[]>([]); // carpetas ya existentes dentro de la categoría
  const [nuevaSub, setNuevaSub]         = useState('');
  const [creandoSub, setCreandoSub]     = useState(false);

  // Ruta relativa elegida ('' = raíz) y opciones derivadas para la UI
  const subRelPath = [subCategoria, subDivision].filter(Boolean).join('/');
  const rutaLegajoLabel = subRelPath ? subRelPath.replace(/\//g, '\\') : '';
  const categoriaOptions = Array.from(new Set([
    ...SUBCARPETAS_PRESETS.map(p => p.categoria),
    ...subDiskL1,
  ]));
  const subdivisionOptions = subCategoria
    ? Array.from(new Set([...presetSubdivisiones(subCategoria), ...subDiskL2]))
    : [];

  // Dispositivos, capacidades y favoritos
  const [devices, setDevices]               = useState<Device[]>([]);
  const [favorites, setFavorites]           = useState<number[]>(loadFavorites);
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [discovering, setDiscovering]       = useState(false);
  const [renamingDevice, setRenamingDevice] = useState<{ id: number; nombre: string } | null>(null);
  const [savingRename, setSavingRename]     = useState(false);
  const [paperStatus, setPaperStatus]       = useState<PaperStatus | null>(null);
  const [loadingPaperStatus, setLoadingPaperStatus] = useState(false);
  const [flatbedPromptDismissed, setFlatbedPromptDismissed] = useState(false);

  // Perfiles
  const [profiles, setProfiles]             = useState<ScanProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<number | null>(null);

  // Opciones de escaneo
  const [source, setSource]   = useState<string>('flatbed');
  const [dpi, setDpi]         = useState<number>(DPI_PREFERIDO);
  const [color, setColor]     = useState(true);
  const [duplex, setDuplex]   = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('pdf');
  const [paperSize, setPaperSize] = useState<string>('A4');
  const [oscuridad, setOscuridad] = useState<0 | 1 | 2 | 3>(0);

  // Sesión multi-página
  const [session, setSession]     = useState<ScannedPage[]>([]);
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  // Lo que informa el agente mientras escanea + segundos transcurridos.
  const [scanProgress, setScanProgress] = useState<{ msg: string; seg: number }>({ msg: '', seg: 0 });
  const [scanError, setScanError] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const blobUrlsRef = useRef<string[]>([]);

  // Cola de jobs (tab Cola)
  const [jobs, setJobs]               = useState<ScanJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Historial documentos del agente (desde api_personal)
  const [docHistory, setDocHistory] = useState<any[]>([]);
  const [docSearch, setDocSearch] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [devicePage, setDevicePage] = useState(1);
  const [viewer, setViewer] = useState<ViewerState>(null);
  const [organizerPageId, setOrganizerPageId] = useState<string | null>(null);
  const viewerUrlRef = useRef<string | null>(null);

  // Lanzar scan (legacy — se mantiene para compatibilidad de estado)
  const [launching, setLaunching] = useState(false);

  // Limpiar blob URLs al desmontar
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current);
    };
  }, []);

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
    if (!selectedDevice) {
      setPaperStatus(null);
      return;
    }
    const current = devices.find(d => d.id === selectedDevice);
    if (current && !deviceOnline(current)) {
      setPaperStatus(null);
      return;
    }
    setPaperStatus(null);
    setLoadingPaperStatus(true);
    try {
      const status = await scannerFetch<PaperStatus>(`/v1/devices/${selectedDevice}/paper-status`);
      setPaperStatus(status);
    } catch {
      setPaperStatus({
        device_id: selectedDevice,
        adf: 'unknown',
        flatbed: 'unknown',
        flatbed_detectable: false,
        engine: 'none',
      });
    } finally {
      setLoadingPaperStatus(false);
    }
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

  const guardarNombreDispositivo = useCallback(async () => {
    if (!renamingDevice) return;
    const nombre = renamingDevice.nombre.trim();
    if (!nombre) { toast.error('Nombre vacío', 'Escribí un nombre para el equipo'); return; }
    setSavingRename(true);
    try {
      await scannerFetch(`/v1/devices/${renamingDevice.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nombre }),
      });
      setDevices(prev => prev.map(d => (d.id === renamingDevice.id ? { ...d, name: nombre } : d)));
      setRenamingDevice(null);
      toast.ok('Nombre actualizado', nombre);
    } catch (e: any) {
      toast.error('No se pudo renombrar', e?.message);
    } finally { setSavingRename(false); }
  }, [renamingDevice]);

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
  }, [selectedDevice, source, cargarPaperStatus]);

  // Auto-refresh del estado del papel cada 4s cuando el ADF dice "vacío"
  // (el escáner tarda en detectar el papel después de cargarlo)
  useEffect(() => {
    const usesAdf = source === 'adf' || source === 'adf_duplex';
    if (!usesAdf || !selectedDevice || paperStatus?.adf !== 'empty') return;
    const t = setInterval(() => { cargarPaperStatus(); }, 4_000);
    return () => clearInterval(t);
  }, [source, selectedDevice, paperStatus?.adf, cargarPaperStatus]);

  useEffect(() => {
    const selected = devices.find(d => d.id === selectedDevice);
    const caps = selected?.capabilities;
    if (!caps) return;
    if (!caps.sources.includes(source as any)) {
      setSource(caps.sources[0] || 'flatbed');
    }
    if (!caps.resolutions.includes(dpi)) {
      setDpi(dpiPreferido(caps.resolutions));
    }
    const colorKey = color ? 'color' : 'grayscale';
    if (!caps.color_modes.includes(colorKey) && !caps.color_modes.includes(color ? 'color' : 'gris')) {
      setColor(caps.color_modes.includes('color'));
    }
    if (!caps.duplex) setDuplex(false);
    if (Array.isArray(caps.paper_sizes) && caps.paper_sizes.length && !caps.paper_sizes.includes(paperSize)) {
          setPaperSize(caps.paper_sizes.includes('A4') ? 'A4' : caps.paper_sizes[0]);
      }
  }, [devices, selectedDevice, source, dpi, color, paperSize]);

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
  }, [outputFormat, source, duplex]);

  // ── Buscar agente ─────────────────────────────────────────────────────────
  const cargarDocHistory = useCallback(async (cleanDni: string) => {
    try {
      const r = await apiFetch<any>(`/scanner/documents/${cleanDni}`);
      setDocHistory(r?.data || []);
    } catch { setDocHistory([]); }
  }, []);

  // ── Subcarpetas del legajo (leer/crear en …\docu\<DNI>\…) ───────────────────
  const cargarSubDisk = useCallback(async (dniStr: string, parentRel: string, level: 1 | 2) => {
    try {
      const q = parentRel ? `?path=${encodeURIComponent(parentRel)}` : '';
      const r = await apiFetch<any>(`/scanner/subcarpetas/${dniStr}${q}`);
      const list: string[] = r?.data || [];
      if (level === 1) setSubDiskL1(list); else setSubDiskL2(list);
    } catch {
      if (level === 1) setSubDiskL1([]); else setSubDiskL2([]);
    }
  }, []);

  const resetSubcarpetas = useCallback(() => {
    setSubCategoria(''); setSubDivision(''); setSubDiskL1([]); setSubDiskL2([]); setNuevaSub('');
  }, []);

  const seleccionarCategoria = useCallback((cat: string, dniStr: string) => {
    setSubCategoria(cat);
    setSubDivision('');
    setSubDiskL2([]);
    if (cat) cargarSubDisk(dniStr, cat, 2);
  }, [cargarSubDisk]);

  // Tipos con carpeta fija en el legajo (antecedentes): se preselecciona; se puede cambiar a mano
  const elegirTipo = useCallback((tipo: string) => {
    setTipoDoc(tipo);
    const carpeta = CARPETA_POR_TIPO[tipo];
    if (carpeta && agente) seleccionarCategoria(carpeta, String(agente.dni));
  }, [agente, seleccionarCategoria]);

  const crearSubcarpeta = useCallback(async () => {
    const nombre = nuevaSub.trim();
    if (!nombre || !agente) return;
    const parent = subCategoria; // '' = raíz → crea categoría; con categoría → crea subdivisión
    setCreandoSub(true);
    try {
      const r = await apiFetch<any>(`/scanner/subcarpetas/${agente.dni}`, {
        method: 'POST',
        body: JSON.stringify({ path: parent, nombre }),
      });
      const created = r?.data?.nombre || nombre;
      setNuevaSub('');
      if (!parent) {
        await cargarSubDisk(String(agente.dni), '', 1);
        setSubCategoria(created); setSubDivision(''); setSubDiskL2([]);
        cargarSubDisk(String(agente.dni), created, 2);
      } else {
        await cargarSubDisk(String(agente.dni), parent, 2);
        setSubDivision(created);
      }
      toast.ok('Subcarpeta creada', created);
    } catch (e: any) {
      toast.error('No se pudo crear la subcarpeta', e?.message);
    } finally { setCreandoSub(false); }
  }, [nuevaSub, agente, subCategoria, cargarSubDisk]);

  const buscarPorDni = useCallback(async (dniOverride?: string) => {
    const clean = (dniOverride ?? dni).replace(/\D/g, '');
    if (!clean) { toast.error('DNI inválido'); return; }
    setLoadingAgente(true); setAgente(null); setMatches([]); setDocHistory([]); resetSubcarpetas();
    try {
      const res = await apiFetch<any>(`/personal/${clean}`);
      if (!res?.ok || !res?.data) { toast.error('No encontrado'); return; }
      const row = { ...res.data, dni: res.data.dni || Number(clean) };
      setAgente(row);
      toast.ok('Agente cargado', `${row.apellido}, ${row.nombre}`);
      cargarDocHistory(clean);
      cargarSubDisk(clean, '', 1);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoadingAgente(false); }
  }, [dni, cargarDocHistory, cargarSubDisk, resetSubcarpetas]);

  // Re-escaneo: 1) buscar el agente; 2) con el agente cargado, fijar carpeta/tipo/formato.
  useEffect(() => {
    if (!reescaneo || reescaneoPrecargadoRef.current) return;
    if (!agente) {
      if (!loadingAgente && dni !== String(reescaneo.dni)) { setDni(String(reescaneo.dni)); void buscarPorDni(String(reescaneo.dni)); }
      return;
    }
    if (Number(agente.dni) !== reescaneo.dni) return;
    reescaneoPrecargadoRef.current = true;
    seleccionarCategoria(reescaneo.carpeta, String(agente.dni));
    const tipo = tipoDesdeArchivos(reescaneo.archivos);
    if (tipo) setTipoDoc(tipo);
    const todosJpg = reescaneo.archivos.length > 0 && reescaneo.archivos.every(a => /\.jpe?g$/i.test(a));
    setOutputFormat(todosJpg ? 'jpg' : 'pdf');
    setColor(true);
    setOscuridad(1); // las hojas que se re-escanean suelen ser las que salieron claras
  }, [reescaneo, agente, loadingAgente, dni, buscarPorDni, seleccionarCategoria]);

  // Re-escaneo: siempre 600 dpi (o la más alta del equipo elegido), aunque se haya cambiado a mano.
  useEffect(() => {
    if (!reescaneo) return;
    const res = devices.find(d => d.id === selectedDevice)?.capabilities?.resolutions;
    if (Array.isArray(res) && res.length) setDpi(dpiPreferido(res));
  }, [reescaneo, devices, selectedDevice]);

  const buscarPorNombre = useCallback(async () => {
    const q = fullName.trim();
    if (!q) { toast.error('Ingresá apellido'); return; }
    setLoadingAgente(true); setMatches([]);
    try {
      const results = await searchPersonal(q);
      setMatches(results);
      if (!results.length) toast.error('Sin resultados');
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoadingAgente(false); }
  }, [fullName]);

  // ── Toggle favorito ────────────────────────────────────────────────────────
  const toggleFavorite = useCallback((deviceId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId];
      saveFavorites(next);
      return next;
    });
  }, []);

  // ── Poll job ────────────────────────────────────────────────────────────────
  async function pollJob(jobId: number, maxMs = 20 * 60_000): Promise<ScanJob> {
    const start = Date.now();
    setScanProgress({ msg: '', seg: 0 });
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 2500));
      const job = await scannerFetch<ScanJob>(`/v1/scan-jobs/${jobId}`);
      setScanProgress({ msg: job.progress_message || '', seg: Math.round((Date.now() - start) / 1000) });
      if (['completed', 'failed', 'canceled'].includes(job.status)) return job;
    }
    throw new Error('Tiempo de espera agotado (20 min)');
  }

  // ── Escanear una página (multi-página) ─────────────────────────────────────
  // ── Tipo Resolución: resoluciones del agente todavía sin archivo + catálogo de tipos ──
  const cargarResPendientes = useCallback(async (dniAgente: number | string) => {
    try {
      const r = await apiFetch<any>(`/resoluciones?dni=${dniAgente}&limit=200`);
      const rows: any[] = r?.data || [];
      setResPendientes(rows.filter(x => !x.archivo_id && !x.deleted_at && String(x.numero || '').trim())
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))));
    } catch { setResPendientes([]); }
  }, []);

  useEffect(() => {
    setResElegida(''); setResNueva(RES_VACIA); setResGuardada(null);
    if (!agente || !esResolucion) { setResPendientes([]); return; }
    cargarResPendientes(agente.dni);
    if (!tiposRes.length) {
      apiFetch<any>('/tipoderesolucion?limit=500').then(r => setTiposRes(r?.data || [])).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agente, esResolucion]);

  /** Motivo/número/fecha de la resolución elegida; null si falta algo. */
  const datosResolucion = useCallback((): { motivo: string; numero: string; fecha: string; nueva: boolean } | null => {
    if (!resElegida) {
      const numero = resNueva.numero.trim();
      if (!resNueva.motivo || !numero) return null;
      return { motivo: resNueva.motivo, numero, fecha: resNueva.fecha, nueva: true };
    }
    const r = resPendientes.find(x => String(x.id) === resElegida);
    if (!r) return null;
    return { motivo: String(r.motivo || ''), numero: String(r.numero || '').trim(), fecha: r.fecha ? String(r.fecha).slice(0, 10) : '', nueva: false };
  }, [resElegida, resNueva, resPendientes]);

  /** Busca el archivo que quedó vinculado (lo graba el backend al recibir el PDF) y lo muestra. */
  const mostrarDondeSeGuardo = useCallback(async (dniAgente: number | string, motivo: string, numero: string) => {
    setResGuardada({ numero, ruta: null, buscando: true });
    for (let intento = 0; intento < 10; intento++) {
      await new Promise(r => window.setTimeout(r, 2000));
      try {
        const r = await apiFetch<any>(`/resoluciones?dni=${dniAgente}&limit=200`);
        const res = (r?.data || []).find((x: any) => String(x.motivo || '') === motivo && String(x.numero || '').trim() === numero && x.archivo_id);
        if (res) {
          const a = await apiFetch<any>(`/tblarchivos/${res.archivo_id}`);
          const arch = a?.data || a;
          // Las resoluciones escaneadas quedan con ruta = nombre del archivo, relativa a RESOLUCIONES Y VARIOS
          // (o ruta = carpeta + nombre_archivo_original aparte, como las filas de la carpeta general).
          let ruta = String(arch?.ruta || arch?.nombre_archivo_original || '');
          if (!/\.[a-z0-9]{2,5}$/i.test(ruta) && arch?.nombre_archivo_original) ruta = `${ruta.replace(/\\+$/, '')}\\${arch.nombre_archivo_original}`;
          const completa = /^[A-Za-z]:|^\\\\/.test(ruta) ? ruta : `\\\\192.168.0.21\\g\\RESOLUCIONES Y VARIOS\\${ruta}`;
          setResGuardada({ numero, ruta: completa, buscando: false });
          cargarResPendientes(dniAgente);
          return;
        }
      } catch { /* reintenta */ }
    }
    setResGuardada({ numero, ruta: null, buscando: false });
  }, [cargarResPendientes]);

  const validarYLanzar = useCallback(async () => {
    if (!agente) { toast.error('Agente requerido', 'Buscá y seleccioná el agente antes de escanear'); return; }
    if (!tipoDoc) { toast.error('Tipo de documento requerido', 'Seleccioná qué documento vas a escanear'); return; }
    if (!selectedDevice) { toast.error('Seleccioná un dispositivo'); return; }
    const datosRes = tipoDoc === TIPO_RESOLUCION ? datosResolucion() : null;
    if (tipoDoc === TIPO_RESOLUCION && !datosRes) {
      toast.error('¿De qué resolución?', 'Elegí la resolución o completá tipo y número antes de escanear');
      return;
    }
    const refInicial = datosRes ? refResolucion(datosRes.motivo, datosRes.numero, datosRes.fecha) : tipoDoc;

    const tipoLabel = TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label || tipoDoc;
    setScanPhase('creating');
    setScanError(null);
    setLaunching(true);

    try {
      // 1. Crear job
      const r = await scannerFetch<{ id: number; pending_tramites?: any[] }>('/v1/scan-jobs', {
        method: 'POST',
        body: JSON.stringify({
          device_id: selectedDevice,
          profile_id: selectedProfile || undefined,
          priority: 5,
          source,
          duplex: duplex || source === 'adf_duplex',
          dpi,
          color,
          paper_size: paperSize,
          auto_rotate: true,
          blank_page_detection: true,
          compression: 'medium',
          output_format: outputFormat,
          personal_ref: refInicial,
          doc_class: tipoDoc,
        }),
      });

      if (r.pending_tramites?.length) toast.error(`⚠️ ${r.pending_tramites.length} trámite(s) pendiente(s)`, '');

      // 2. Esperar al agente
      setScanPhase('waiting');
      const finalJob = await pollJob(r.id);
      if (finalJob.status !== 'completed') {
        throw new Error(finalJob.error_message || `Escaneo termino con estado: ${finalJob.status}`);
      }

      // 3. Obtener páginas
      setScanPhase('loading_pages');
      const pagesRes = await scannerFetch<{ doc_id: number | null; pages: any[] }>(
        `/v1/scan-jobs/${r.id}/pages`
      );
      if (!pagesRes.pages?.length) throw new Error('El agente no subió ninguna página');

      const newPages: ScannedPage[] = pagesRes.pages.map(p => ({
        jobId: r.id, pageNumber: p.page_number,
        storageKey: p.storage_key, blobUrl: null, loadError: false,
      }));
      setSession(prev => [...prev, ...newPages]);

      // 4. Cargar imágenes con auth en background
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
      void cargarPaperStatus();
      // NO cambiamos de tab automáticamente
    } catch (e: any) {
      setScanPhase('error');
      setScanError(e?.message || 'Error desconocido');
      toast.error('Error al escanear', e?.message);
    } finally { setLaunching(false); }
  }, [agente, tipoDoc, datosResolucion, selectedDevice, selectedProfile, source, duplex, dpi, color, paperSize, outputFormat, paperStatus, flatbedPromptDismissed, cargarPaperStatus]);

  // ── Guardar sesión ──────────────────────────────────────────────────────────
  const guardarSesion = useCallback(async () => {
    if (!session.length || !agente) return;
    setSaving(true);
    try {
      const jobIds = Array.from(new Set(session.map(p => p.jobId)));
      // Resolución → RESOLUCIONES Y VARIOS (ref 'respage|…'), nunca al legajo.
      // Si es una resolución nueva, primero se da de alta para que el archivo quede vinculado.
      let refRes: string | null = null;
      if (tipoDoc === TIPO_RESOLUCION) {
        const d = datosResolucion();
        if (!d) { toast.error('¿De qué resolución?', 'Elegí la resolución o completá tipo y número'); return; }
        if (d.nueva) {
          await apiFetch('/resoluciones', {
            method: 'POST',
            body: JSON.stringify({
              dni: agente.dni, motivo: d.motivo, numero: d.numero, fecha: d.fecha || null,
              observaciones: resNueva.observaciones.trim() || descripcion.trim() || null, created_by: authSession?.user?.id || null,
            }),
          });
        }
        refRes = refResolucion(d.motivo, d.numero, d.fecha);
      }
      // Si hay subcarpeta elegida, se codifica en personal_ref: 'docu|<relpath>|<tipo>'.
      // doc_class queda como el tipo puro para que el backend detecte el tipo aunque falle el parse.
      // Oscuridad: el back de personal oscurece cada hoja antes de escribirla ('|osc:N' al final).
      const personalRef = refRes ?? (oscuridad
        ? `docu|${subRelPath}|${tipoDoc}|osc:${oscuridad}`
        : (subRelPath ? `docu|${subRelPath}|${tipoDoc}` : tipoDoc));
      const resp = await scannerFetch<{ output_format?: string; documents?: number }>('/v1/scan-jobs/consolidate', {
        method: 'POST',
        body: JSON.stringify({
          job_ids: jobIds,
          page_keys: session.map(p => p.storageKey),
          personal_dni: agente.dni,
          personal_ref: personalRef,
          doc_class: tipoDoc,
          output_format: outputFormat,
        }),
      });
      const savedFmt = resp?.output_format || outputFormat;
      const fmtLabel = savedFmt === 'pdf_a' ? 'PDF/A' : savedFmt.toUpperCase();
      const nDocs = resp?.documents ?? 1;
      if (savedFmt === 'jpg' && nDocs > 1) {
        toast.ok(`✅ ${nDocs} JPG guardados`, `1 archivo por página (${session.length} en total)`);
      } else {
        toast.ok(`✅ ${fmtLabel} guardado`, `${session.length} página(s) unidas en un documento`);
      }
      apiFetch<any>(`/scanner/documents/${agente.dni}`)
        .then(r => setDocHistory(r?.data || [])).catch(() => {});
      const avisarDocumentos = (info: ReescaneoInfo) => {
        try { localStorage.setItem('reescaneo-hecho', JSON.stringify({ id: info.id, dni: info.dni, documento: info.documento, t: Date.now() })); } catch { /* noop */ }
      };
      if (reescaneo?.modo === 'agregar' && Number(agente.dni) === reescaneo.dni && subRelPath === reescaneo.carpeta) {
        // El escáner escribe el archivo unos segundos después del consolidate: se reintenta hasta 2 min.
        const info = reescaneo;
        const antes = info.archivos;
        let listo = false;
        for (let intento = 0; intento < 40 && !listo; intento += 1) {
          try {
            const rr = await apiFetch<{ ok: boolean; data: { modo: string; insertadas: number } }>(
              '/tramites-documentales/combinar-insertar',
              { method: 'POST', body: JSON.stringify({ dni: info.dni, carpeta: info.carpeta, despuesDe: info.despuesDe, antes }) });
            listo = true;
            toast.ok('Hoja agregada', info.despuesDe
              ? `${rr.data.insertadas} hoja(s) agregada(s) después de la #${info.despuesDe.n} de ${info.documento}`
              : `${rr.data.insertadas} hoja(s) agregada(s) al final de ${info.documento}`);
            avisarDocumentos(info);
            setReescaneo(null);
          } catch (e: any) {
            if (/todavía no llegó/i.test(e?.message || '')) { await new Promise(r => setTimeout(r, 3000)); continue; }
            toast.error('Se guardó la hoja, pero no se pudo ubicar en el documento', `${e?.message || 'Error'} — acomodala desde Documentos`);
            listo = true;
          }
        }
        if (!listo) toast.error('La hoja nueva no apareció en la carpeta', 'Revisá en Documentos con 🔄 en un rato');
      } else if (reescaneo && Number(agente.dni) === reescaneo.dni && subRelPath === reescaneo.carpeta) {
        try {
          const rr = await apiFetch<{ ok: boolean; data: { movidos: string[]; yaNoEstaban: string[] } }>(
            '/tramites-documentales/combinar-reemplazar-doc',
            { method: 'POST', body: JSON.stringify({ dni: reescaneo.dni, rels: reescaneo.rels }) });
          toast.ok('Documento reemplazado', `${rr.data.movidos.length} archivo(s) viejo(s) → Trasladados\\${reescaneo.carpeta} (se recuperan en ♻️ Restaurar)`);
          avisarDocumentos(reescaneo);
          setReescaneo(null);
        } catch (e: any) {
          toast.error('Se guardó el escaneo nuevo, pero no se pudieron trasladar los viejos', e?.message || 'Error');
        }
      }
      if (refRes) {
        const d = datosResolucion();
        setResElegida(''); setResNueva(RES_VACIA);
        if (d) void mostrarDondeSeGuardo(agente.dni, d.motivo, d.numero);
      }
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      blobUrlsRef.current = [];
      setSession([]); setScanPhase('idle'); setScanError(null);
    } catch (e: any) {
      const msg = e?.message || 'Error sincronizando con legajo';
      const isPagesLost = msg.includes('scan_pages_lost') || msg.includes('ya no están disponibles');
      if (isPagesLost) {
        // Las páginas se perdieron (reinicio del servidor) — descartar automáticamente y avisar
        blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
        blobUrlsRef.current = [];
        setSession([]); setScanPhase('idle'); setScanError(null);
        toast.error(
          '⚠️ Páginas perdidas — hay que escanear de nuevo',
          'El servidor se reinició y los archivos ya no están disponibles. La sesión fue descartada.'
        );
      } else {
        toast.error('No se pudo guardar', msg);
      }
    } finally { setSaving(false); }
  }, [session, agente, tipoDoc, outputFormat, subRelPath, datosResolucion, descripcion, authSession, resNueva, mostrarDondeSeGuardo, reescaneo, oscuridad]);

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

  const rotarPagina = useCallback(async (page: ScannedPage, degrees = 90) => {
    if (page.rotating) return;
    setSession(prev => prev.map(p => p.storageKey === page.storageKey ? { ...p, rotating: true } : p));
    try {
      const result = await scannerFetch<{ storage_key: string }>(
        `/v1/scan-jobs/${page.jobId}/pages/${page.pageNumber}/rotate`,
        { method: 'POST', body: JSON.stringify({ degrees }) }
      );
      const blobUrl = await loadScanImage(result.storage_key);
      blobUrlsRef.current.push(blobUrl);
      if (page.blobUrl) URL.revokeObjectURL(page.blobUrl);
      setViewer(prev => prev?.kind === 'scan' && prev.url === page.blobUrl ? null : prev);
      setSession(prev => prev.map(p => p.storageKey === page.storageKey
        ? { ...p, storageKey: result.storage_key, blobUrl, loadError: false, rotating: false }
        : p));
      toast.ok('Pagina rotada', 'El archivo guardado tambien fue actualizado');
    } catch (e: any) {
      setSession(prev => prev.map(p => p.storageKey === page.storageKey ? { ...p, rotating: false } : p));
      toast.error('No se pudo rotar', e?.message);
    }
  }, [toast]);

  const cerrarViewer = useCallback(() => {
    setViewer(prev => {
      if (prev?.revokeOnClose && viewerUrlRef.current === prev.url) {
        URL.revokeObjectURL(prev.url);
        viewerUrlRef.current = null;
      }
      return null;
    });
  }, []);

  const abrirPaginaEscaneada = useCallback((page: ScannedPage, index: number) => {
    if (!page.blobUrl) return;
    setViewer({
      title: `Pagina escaneada ${index + 1}`,
      url: page.blobUrl,
      contentType: 'image/*',
      filename: null,
      kind: 'scan',
      revokeOnClose: false,
    });
  }, []);

  const abrirDocumentoPrevio = useCallback(async (doc: any) => {
    try {
      if (viewerUrlRef.current) {
        URL.revokeObjectURL(viewerUrlRef.current);
        viewerUrlRef.current = null;
      }
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(`/documents/${doc.id}/file`);
      const url = URL.createObjectURL(blob);
      viewerUrlRef.current = url;
      setViewer({
        title: doc.nombre || filename || `Documento #${doc.id}`,
        url,
        contentType,
        filename,
        kind: 'document',
        revokeOnClose: true,
      });
    } catch (e: any) {
      toast.error('No se pudo abrir el documento', e?.message);
    }
  }, [toast]);

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
  const sourceUsesAdf = source === 'adf' || source === 'adf_duplex';
  const adfPaperEmpty = sourceUsesAdf && paperStatus?.adf === 'empty';
  const flatbedPaperQuestion = sourceUsesAdf && paperStatus?.flatbed === 'loaded' && !flatbedPromptDismissed;

  const isScanning = ['creating', 'waiting', 'loading_pages'].includes(scanPhase);
  const hasPages   = session.length > 0;
  const isRotating = session.some(page => page.rotating);

  const activeJobs = jobs.filter(j => ['queued','in_progress'].includes(j.status));
  const doneJobs   = jobs.filter(j => !['queued','in_progress'].includes(j.status));

  // adfPaperEmpty ya NO bloquea el botón — solo muestra advertencia.
  // El escáner dará el error real si realmente no hay papel.
  const faltaResolucion = esResolucion && !datosResolucion();
  const puedeEscanear = !!agente && !!tipoDoc && !faltaResolucion && !!selectedDevice && isOnline && !isScanning && !flatbedPaperQuestion;

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
  const safeDevicePage = Math.min(devicePage, devicePageCount);
  const pagedOnlineDevices = filteredOnlineDevices.slice(
    (safeDevicePage - 1) * DEVICE_PAGE_SIZE,
    safeDevicePage * DEVICE_PAGE_SIZE
  );

  const docNeedle = normSearch(docSearch);
  const filteredDocHistory = docHistory.filter((d: any) => {
    if (!docNeedle) return true;
    const tipoLabel = TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo;
    return normSearch([d.nombre, tipoLabel, d.descripcion_archivo, d.ruta, fmtDT(d.created_at), scanUserLabel(d)].join(' ')).includes(docNeedle);
  });

  useEffect(() => { setDevicePage(1); }, [deviceSearch, onlineDevices.length]);
  useEffect(() => {
    if (devicePage > devicePageCount) setDevicePage(devicePageCount);
  }, [devicePage, devicePageCount]);

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
            role="button"
            tabIndex={0}
            title="Doble click para ordenar, rotar o ampliar"
            onDoubleClick={() => setOrganizerPageId(scanPageId(page))}
            onKeyDown={e => e.key === 'Enter' && setOrganizerPageId(scanPageId(page))}
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
              <button type="button" className="scan-preview-rotate"
                disabled={page.rotating || !page.blobUrl}
                onClick={e => { e.stopPropagation(); rotarPagina(page); }}
                title="Rotar 90 grados">
                {page.rotating ? '...' : '↻'}
              </button>
              <button type="button" className="scan-preview-rotate scan-preview-rotate-180"
                disabled={page.rotating || !page.blobUrl}
                onClick={e => { e.stopPropagation(); rotarPagina(page, 180); }}
                title="Rotar 180 grados">
                180°
              </button>
              <button
                type="button"
                className="scan-preview-remove"
                onClick={e => { e.stopPropagation(); quitarPagina(page.storageKey); }}
                title="Quitar"
              >×</button>
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
        <input
          className="input scan-doc-search"
          value={docSearch}
          onChange={e => setDocSearch(e.target.value)}
          placeholder="Buscar por nombre, tipo o fecha"
        />
      )}
      {docHistory.length > 0 ? (
        filteredDocHistory.length > 0 ? (
          <div className="scan-doc-list scan-doc-list-compact">
            {filteredDocHistory.slice(0, 12).map((d: any) => (
              <button
                key={d.id}
                type="button"
                className="scan-doc-item scan-doc-button"
                onClick={() => abrirDocumentoPrevio(d)}
                title="Abrir documento"
              >
                <div className="scan-doc-class">
                  {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.icon || '📄'}
                </div>
                <div className="scan-doc-body">
                  <div className="scan-doc-name">{d.nombre || `Documento #${d.id}`}</div>
                  <div className="muted" style={{ fontSize: '0.72rem' }}>
                    {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo} · {fmtDT(d.created_at)}
                    {scanUserLabel(d) && <> · {scanUserLabel(d)}</>}
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

              {reescaneo && (
                <div className="card scan-card" style={{ border: '1px solid rgba(250,204,21,0.5)', background: 'rgba(250,204,21,0.08)' }}>
                  <div className="scan-section-title">{reescaneo.modo === 'agregar' ? '➕ Agregar hoja al documento' : '📷 Re-escaneo de documento'}</div>
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                    <b>{reescaneo.documento}</b> · DNI {reescaneo.dni}<br />
                    {reescaneo.modo === 'agregar' ? (
                      <>Escaneá <b>solo la hoja que falta</b>. Al guardar se mete {reescaneo.despuesDe
                        ? <><b>después de la hoja #{reescaneo.despuesDe.n}</b></>
                        : <><b>al final</b></>} del documento. No se mueve nada a Trasladados.</>
                    ) : (
                      <>Escaneá el documento <b>completo</b> (todas las hojas). Al guardar, los {reescaneo.rels.length} archivo(s)
                      que tiene ahora pasan a <b>Trasladados\{reescaneo.carpeta}</b> (se recuperan en ♻️ Restaurar).</>
                    )}
                    {subRelPath !== reescaneo.carpeta && (
                      <div style={{ color: '#f87171', marginTop: 4 }}>⚠️ La carpeta destino no es «{reescaneo.carpeta}»: así no se {reescaneo.modo === 'agregar' ? 'agrega al documento' : 'reemplaza nada'}.</div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <button className="btn" onClick={() => setReescaneo(null)}>Cancelar (escaneo normal)</button>
                  </div>
                </div>
              )}

              {/* ── AGENTE — OBLIGATORIO ── */}
              <div className={`card scan-card${!agente ? ' scan-card-required' : ' scan-card-ok'}`}>
                <div className="scan-section-title">
                  👤 Agente
                  <span className="scan-required-badge">obligatorio</span>
                </div>
                <div className="scan-search-grid">
                  <div>
                    <label htmlFor="esc-dni" className="muted scan-label">DNI</label>
                    <input id="esc-dni" name="dni" className="input" value={dni} placeholder="DNI (Enter)"
                      onChange={e => setDni(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && buscarPorDni()}
                      disabled={loadingAgente} style={{ width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label htmlFor="esc-nombre" className="muted scan-label">Apellido</label>
                    <input id="esc-nombre" name="fullName" className="input" value={fullName} placeholder="Apellido (Enter)"
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
                    <button className="btn" onClick={() => { setAgente(null); setDni(''); setDocHistory([]); resetSubcarpetas(); }}>✕ Limpiar</button>
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
                        📁 Se guardará en: …\docu\{agente.dni}\{rutaLegajoLabel ? `${rutaLegajoLabel}\\` : ''}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="scan-required-hint">
                    ⚠️ Buscá el agente antes de escanear
                  </div>
                )}
              </div>

              {/* ── CARPETA DESTINO EN EL LEGAJO (opcional) ── */}
              {agente && (
                <div className="card scan-card">
                  <div className="scan-section-title">📂 Carpeta destino en el legajo</div>

                  {/* Nivel 1: categoría (o raíz) */}
                  <div className="muted scan-label">Carpeta</div>
                  <div className="scan-tipos-grid">
                    <button
                      type="button"
                      className={`scan-tipo-btn${!subCategoria ? ' selected' : ''}`}
                      onClick={() => seleccionarCategoria('', String(agente.dni))}
                    >
                      <span className="scan-tipo-icon">📁</span>
                      <span className="scan-tipo-label">Raíz del legajo</span>
                    </button>
                    {categoriaOptions.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        className={`scan-tipo-btn${subCategoria === cat ? ' selected' : ''}`}
                        onClick={() => seleccionarCategoria(cat, String(agente.dni))}
                      >
                        <span className="scan-tipo-icon">🗂️</span>
                        <span className="scan-tipo-label">{cat}</span>
                      </button>
                    ))}
                  </div>

                  {/* Nivel 2: subdivisión dentro de la categoría */}
                  {subCategoria && (
                    <div className="scan-group-section">
                      <div className="scan-group-header">📁 {subCategoria} › subcarpeta</div>
                      <div className="scan-tipos-grid">
                        <button
                          type="button"
                          className={`scan-tipo-btn${!subDivision ? ' selected' : ''}`}
                          onClick={() => setSubDivision('')}
                        >
                          <span className="scan-tipo-icon">📂</span>
                          <span className="scan-tipo-label">Carpeta principal</span>
                        </button>
                        {subdivisionOptions.map(sub => (
                          <button
                            key={sub}
                            type="button"
                            className={`scan-tipo-btn${subDivision === sub ? ' selected' : ''}`}
                            onClick={() => setSubDivision(sub)}
                          >
                            <span className="scan-tipo-icon">📄</span>
                            <span className="scan-tipo-label">{sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Crear nueva carpeta en el nivel actual */}
                  <label className="muted scan-label" style={{ marginTop: 12, display: 'block' }}>
                    ➕ Crear {subCategoria ? `subcarpeta dentro de "${subCategoria}"` : 'carpeta nueva'}
                  </label>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input"
                      value={nuevaSub}
                      onChange={e => setNuevaSub(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && crearSubcarpeta()}
                      placeholder="Nombre de la carpeta"
                      style={{ flex: 1, boxSizing: 'border-box' }}
                    />
                    <button className="btn" onClick={crearSubcarpeta} disabled={creandoSub || !nuevaSub.trim()}>
                      {creandoSub ? '…' : 'Crear'}
                    </button>
                  </div>

                  <div className="scan-tipo-selected" style={{ marginTop: 10 }}>
                    📁 Destino: …\docu\{agente.dni}\{rutaLegajoLabel ? `${rutaLegajoLabel}\\` : ''}
                    {!rutaLegajoLabel && <span className="muted"> (raíz del legajo)</span>}
                  </div>
                </div>
              )}

              {/* ── TIPO DE DOCUMENTO — OBLIGATORIO ── */}
              <div className={`card scan-card${!tipoDoc ? ' scan-card-required' : ' scan-card-ok'}`}>
                <div className="scan-section-title">
                  🗂️ Tipo de Documento
                  <span className="scan-required-badge">obligatorio</span>
                </div>
                {/* Tipos sin grupo */}
                <div className="scan-tipos-grid">
                  {TIPOS_DOCUMENTO.filter(t => !t.group).map(t => (
                    <button
                      key={t.value}
                      className={`scan-tipo-btn${tipoDoc === t.value ? ' selected' : ''}`}
                      onClick={() => elegirTipo(t.value)}
                      type="button"
                    >
                      <span className="scan-tipo-icon">{t.icon}</span>
                      <span className="scan-tipo-label">{t.label}</span>
                    </button>
                  ))}
                </div>
                {/* Grupos con encabezado */}
                {[...new Set(TIPOS_DOCUMENTO.filter(t => t.group).map(t => t.group!))].map(group => (
                  <div key={group} className="scan-group-section">
                    <div className="scan-group-header">{GROUP_LABELS[group] ?? group.toUpperCase()}</div>
                    <div className="scan-tipos-grid">
                      {TIPOS_DOCUMENTO.filter(t => t.group === group).map(t => (
                        <button
                          key={t.value}
                          className={`scan-tipo-btn${tipoDoc === t.value ? ' selected' : ''}`}
                          onClick={() => elegirTipo(t.value)}
                          type="button"
                        >
                          <span className="scan-tipo-icon">{t.icon}</span>
                          <span className="scan-tipo-label">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {!tipoDoc && (
                  <div className="scan-required-hint">⚠️ Seleccioná qué documento vas a escanear</div>
                )}
                {tipoDoc && (
                  <div className="scan-tipo-selected">
                    ✅ {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.icon} {TIPOS_DOCUMENTO.find(t => t.value === tipoDoc)?.label}
                  </div>
                )}

                {/* Resolución → RESOLUCIONES Y VARIOS: mismo formulario que la página Resoluciones */}
                {esResolucion && agente && (
                  <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(15,23,42,0.5)' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 2 }}>+ Datos de la resolución</div>
                    <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 10 }}>
                      Se guarda en <b>RESOLUCIONES Y VARIOS</b> con el número de la resolución y queda vinculada al agente (no va a la carpeta del legajo).
                    </div>

                    {resPendientes.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                        <label className="muted" style={{ fontSize: '0.72rem' }}>¿Ya está cargada? Elegila (resoluciones del agente sin archivo)</label>
                        <select className="input" value={resElegida} onChange={e => setResElegida(e.target.value)}>
                          <option value="">— No, es nueva: completar abajo —</option>
                          {resPendientes.map(r => (
                            <option key={r.id} value={r.id}>
                              {r.motivo || 'Sin tipo'} · {r.numero}{r.fecha ? ` · ${String(r.fecha).slice(0, 10).split('-').reverse().join('/')}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {!resElegida && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label className="muted" style={{ fontSize: '0.72rem' }}>Tipo de resolución *</label>
                          <select className="input" value={resNueva.motivo} onChange={e => setResNueva(v => ({ ...v, motivo: e.target.value }))}>
                            <option value="">— Seleccioná —</option>
                            {tiposRes.map(t => <option key={t.id} value={t.resolucion_nombre}>{t.resolucion_nombre}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label className="muted" style={{ fontSize: '0.72rem' }}>Número *</label>
                          <input className="input" placeholder="Ej: 1234/2026" value={resNueva.numero}
                            onChange={e => setResNueva(v => ({ ...v, numero: e.target.value }))} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label className="muted" style={{ fontSize: '0.72rem' }}>Fecha</label>
                          <input className="input" type="date" value={resNueva.fecha}
                            onChange={e => setResNueva(v => ({ ...v, fecha: e.target.value }))} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label className="muted" style={{ fontSize: '0.72rem' }}>Observaciones</label>
                          <input className="input" placeholder="Texto corto…" value={resNueva.observaciones}
                            onChange={e => setResNueva(v => ({ ...v, observaciones: e.target.value }))} />
                        </div>
                      </div>
                    )}

                    {faltaResolucion && (
                      <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#fca5a5' }}>⚖️ Requerido: tipo y número de la resolución antes de escanear</div>
                    )}

                    {resGuardada && (
                      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, fontSize: '0.78rem',
                        border: `1px solid ${resGuardada.ruta ? 'rgba(34,197,94,0.5)' : 'rgba(245,158,11,0.5)'}`,
                        background: resGuardada.ruta ? 'rgba(20,83,45,0.3)' : 'rgba(120,53,15,0.25)' }}>
                        {resGuardada.buscando
                          ? <>⏳ Guardando {resGuardada.numero}…</>
                          : resGuardada.ruta
                            ? <>✅ <b>{resGuardada.numero}</b> guardada en:<br /><code style={{ fontSize: '0.75rem', overflowWrap: 'anywhere', userSelect: 'all' }}>{resGuardada.ruta}</code></>
                            : <>⚠️ Se envió {resGuardada.numero}, pero todavía no aparece vinculada. Revisala en Resoluciones (aviso de resoluciones sin archivo).</>}
                      </div>
                    )}
                  </div>
                )}

                {/* Descripción adicional */}
                <label htmlFor="esc-desc" className="muted scan-label" style={{ marginTop: 12, display: 'block' }}>Descripción adicional (opcional)</label>
                <input
                  id="esc-desc"
                  name="descripcion"
                  className="input"
                  value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  placeholder="Ej: Renovación 2024, página 1 de 2…"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              {paginasEscaneadasCard}
              {documentosPreviosCard}

            </div>

            {/* DERECHA */}
            <div className="scan-col">

              {/* ── Dispositivo ── */}
              <div className="card scan-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div className="scan-section-title" style={{ marginBottom: 0 }}>🖨️ Dispositivo</div>
                  <button className="btn" style={{ fontSize: '0.72rem', padding: '4px 10px' }} onClick={cargarDevices} disabled={loadingDevices}>
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
                    <input
                      className="input scan-device-search"
                      value={deviceSearch}
                      onChange={e => setDeviceSearch(e.target.value)}
                      placeholder="Buscar escáner"
                    />
                    {filteredOnlineDevices.length === 0 ? (
                      <div className="scan-empty-inline">Sin escáneres para esa búsqueda</div>
                    ) : (
                      <div className="scan-device-list scan-device-list-scroll">
                    {pagedOnlineDevices.map(d => {
                      const online = deviceOnline(d);
                      const isFav  = favorites.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          className={`scan-device-btn${selectedDevice === d.id ? ' selected' : ''}${!online ? ' offline' : ''}`}
                          onClick={() => setSelectedDevice(d.id)}
                        >
                          <div className="scan-device-row">
                            <span
                              title={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
                              style={{ fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0,
                                color: isFav ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}
                              onClick={e => toggleFavorite(d.id, e)}
                            >{isFav ? '★' : '☆'}</span>
                            <span className={`scan-dot${online ? ' online' : ''}`} />
                            <b style={{ flexGrow: 1, textAlign: 'left' }}>{d.name}</b>
                            <span className="muted" style={{ fontSize: '0.75rem' }}>
                              {online ? 'En línea' : 'Sin conexión'}
                            </span>
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

                  <div className="scan-paper-panel">
                    <div className="scan-paper-row">
                      <span className={`scan-paper-pill${paperClass(paperStatus?.adf)}`}>
                        ADF: {loadingPaperStatus ? 'Consultando...' : PAPER_LABEL[paperStatus?.adf || 'unknown']}
                      </span>
                      <span className={`scan-paper-pill${paperClass(paperStatus?.flatbed)}`}>
                        Cristal: {loadingPaperStatus ? 'Consultando...' : PAPER_LABEL[paperStatus?.flatbed || 'unknown']}
                      </span>
                      <button
                        type="button"
                        className="scan-paper-refresh"
                        onClick={cargarPaperStatus}
                        disabled={loadingPaperStatus || !selectedDevice}
                      >
                        Actualizar
                      </button>
                    </div>

                    {adfPaperEmpty && (
                      <div className="scan-paper-warning">
                        ADF sin hojas. Carga hojas en el alimentador o cambia a cristal.
                      </div>
                    )}

                    {flatbedPaperQuestion && (
                      <div className="scan-source-question">
                        <span>Hay hoja en cristal. Queres escanear por cristal?</span>
                        <div className="scan-source-question-actions">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => { setSource('flatbed'); setDuplex(false); setFlatbedPromptDismissed(true); }}
                          >
                            Usar cristal
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setFlatbedPromptDismissed(true)}
                          >
                            Seguir ADF
                          </button>
                        </div>
                      </div>
                    )}

                    {paperStatus && paperStatus.flatbed === 'unknown' && (
                      <div className="muted scan-paper-note">
                        Cristal: este equipo no informa si hay hoja antes de escanear.
                      </div>
                    )}
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

                  <div className="muted scan-label" style={{ marginTop: 12 }} title="Se aplica a cada hoja al guardar: letras claras → más oscuras, fondo blanco">Oscuridad (letras claras)</div>
                  <div className="scan-caps-grid">
                    {OSCURIDADES.map(o => (
                      <button key={o.v} className={`scan-cap-btn${oscuridad === o.v ? ' selected' : ''}`}
                        onClick={() => setOscuridad(o.v)}>{o.v ? '🌑 ' : ''}{o.label}</button>
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

                  <div className="muted scan-label" style={{ marginTop: 12 }}>Tamaño de página</div>
                  <div className="scan-caps-grid">
                    {(caps.paper_sizes.length ? caps.paper_sizes : ['A4']).map(p => (
                      <button
                        key={p}
                        className={`scan-cap-btn${paperSize === p ? ' selected' : ''}`}
                        onClick={() => setPaperSize(p)}
                        type="button"
                      >
                        {PAPER_SIZE_LABELS[p] || p}
                      </button>
                    ))}
                  </div>

                  <div className="muted scan-label" style={{ marginTop: 12 }}>Formato de salida</div>
                  <div className="scan-caps-grid">
                    {([
                      ['pdf', 'PDF'],
                      ['pdf_a', 'PDF/A'],
                      ['tiff', 'TIFF'],
                      ['jpg', 'JPG'],
                    ] as [OutputFormat, string][]).map(([fmt, label]) => {
                      const jpgPorPagina = fmt === 'jpg' && (source !== 'flatbed' || duplex || session.length > 1);
                      return (
                        <button
                          key={fmt}
                          className={`scan-cap-btn${outputFormat === fmt ? ' selected' : ''}`}
                          onClick={() => { setOutputFormat(fmt); setSelectedProfile(null); }}
                          title={jpgPorPagina ? 'Con ADF/dúplex se guarda 1 archivo JPG por página' : undefined}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {outputFormat === 'jpg' && (
                    <div className="muted" style={{ fontSize: '0.72rem', marginTop: 6 }}>
                      JPG se guarda como imagen de una sola página.
                    </div>
                  )}

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
                          setOutputFormat((p.output_format as OutputFormat) || 'pdf');
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
                <div className="scan-section-title">🚀 Escaneo</div>

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
                      <span>{dpi} dpi · {color ? 'Color' : 'Grises'}{oscuridad ? ` · 🌑 ${OSCURIDADES[oscuridad].label}` : ''}</span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Tamaño</span>
                      <span>{paperSize}</span>
                    </div>
                    <div className="scan-summary-row">
                      <span className="muted">Formato</span>
                      <span>{outputFormat.toUpperCase()}</span>
                    </div>
                  </div>
                )}

                {!isOnline && device && (
                  <div className="scan-warn">
                    ⚠️ El dispositivo <b>{device.name}</b> no está en línea. Verificá la conexión.
                  </div>
                )}

                {adfPaperEmpty && (
                  <div className="scan-warn">
                    ⚠️ ADF sin hojas. Cargá hojas en el alimentador o cambiá la fuente a cristal.
                  </div>
                )}

                {flatbedPaperQuestion && (
                  <div className="scan-warn">
                    ⚠️ Hay hoja en cristal. Confirmá la fuente en Configuración de Escaneo.
                  </div>
                )}

                {isScanning && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 10,
                    background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                    fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="scan-pulse-dot" />
                    <div>
                      <div>
                        {scanPhaseLabel[scanPhase]}
                        {scanPhase === 'waiting' && scanProgress.seg > 0 && (
                          <span className="muted"> ({Math.floor(scanProgress.seg / 60)}:{String(scanProgress.seg % 60).padStart(2, '0')})</span>
                        )}
                      </div>
                      {scanPhase === 'waiting' && (
                        <div style={{ marginTop: 4, fontSize: '0.8rem', opacity: 0.9 }}>
                          {scanProgress.msg || 'Espere: no cierre esta pantalla ni retire las hojas. En 600 dpi color puede tardar varios minutos.'}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {scanPhase === 'error' && scanError && (
                  <div className="scan-job-err" style={{ marginBottom: 10 }}>❌ {scanError}</div>
                )}

                <button
                  className={`btn scan-btn-launch${puedeEscanear ? ' ready' : ''}`}
                  onClick={validarYLanzar}
                  disabled={!puedeEscanear}
                >
                  {isScanning ? (scanPhaseLabel[scanPhase] || '⏳ Escaneando…')
                    : !agente ? '👤 Falta el agente'
                    : !tipoDoc ? '🗂️ Falta el tipo de documento'
                    : faltaResolucion ? '⚖️ Falta elegir la resolución'
                    : flatbedPaperQuestion ? '🪟 Confirmar fuente'
                    : !isOnline ? '🔌 Scanner sin conexión'
                    : hasPages ? '📄 Escanear otra página'
                    : '▶ Iniciar Escaneo'}
                </button>

                {hasPages && !isScanning && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn" style={{ flex: 1,
                      background: 'rgba(16,185,129,0.15)', borderColor: '#10b981', color: '#6ee7b7' }}
                      onClick={guardarSesion} disabled={saving || isRotating}>
                      {isRotating ? 'Rotando página...' : saving ? '⏳ Guardando…' : `✅ Guardar ${session.length} pág. en ${outputFormat === 'pdf_a' ? 'PDF/A' : outputFormat.toUpperCase()}`}
                    </button>
                    <button className="btn" style={{
                      background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}
                      onClick={descartarSesion} disabled={saving || isRotating} title="Descartar sesión">
                      🗑️
                    </button>
                  </div>
                )}
              </div>

              {/* ── Vista previa de páginas escaneadas ── */}
              {false && hasPages && (
                <div className="card scan-card">
                  <div className="scan-section-title">
                    🖼️ Páginas escaneadas
                    <span className="badge" style={{ marginLeft: 6, background: 'rgba(16,185,129,0.2)', color: '#6ee7b7' }}>
                      {session.length} pág.
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
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
                            ❌<br />Error
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', padding: 8, fontSize: '0.7rem', color: '#94a3b8' }}>
                            <div className="scan-pulse-dot" style={{ margin: '0 auto 4px' }} />
                            Cargando…
                          </div>
                        )}
                        <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0,
                          textAlign: 'center', fontSize: '0.65rem',
                          background: 'rgba(0,0,0,0.6)', color: '#e2e8f0', padding: '2px 0' }}>
                          Pág. {idx + 1}
                        </div>
                        <button onClick={() => quitarPagina(page.storageKey)} style={{
                          position: 'absolute', top: 3, right: 3, width: 18, height: 18,
                          borderRadius: '50%', background: 'rgba(239,68,68,0.8)',
                          border: 'none', cursor: 'pointer', color: 'white',
                          fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }} title="Quitar">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Docs previos del agente */}
              {false && agente && docHistory.length > 0 && (
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
                        {renamingDevice?.id === d.id ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                              className="input"
                              value={renamingDevice.nombre}
                              autoFocus
                              onChange={e => setRenamingDevice({ id: d.id, nombre: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === 'Enter') guardarNombreDispositivo();
                                if (e.key === 'Escape') setRenamingDevice(null);
                              }}
                              style={{ fontSize: '0.85rem', minWidth: 200 }}
                            />
                            <button className="btn" disabled={savingRename} onClick={guardarNombreDispositivo}>
                              {savingRename ? '…' : 'Guardar'}
                            </button>
                            <button className="btn" onClick={() => setRenamingDevice(null)}>Cancelar</button>
                          </div>
                        ) : (
                          <div className="scan-device-title">
                            {d.name}
                            <button
                              className="btn"
                              title="Renombrar equipo"
                              onClick={() => setRenamingDevice({ id: d.id, nombre: d.name })}
                              style={{ marginLeft: 8, padding: '0 6px', fontSize: '0.75rem' }}
                            >✏️</button>
                          </div>
                        )}
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
                  <label htmlFor="esc-docs-dni" className="muted scan-label">DNI del agente</label>
                  <input id="esc-docs-dni" name="dni" className="input" value={dni} placeholder="DNI (Enter)"
                    onChange={e => setDni(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorDni()}
                    style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label htmlFor="esc-docs-nombre" className="muted scan-label">Apellido</label>
                  <input id="esc-docs-nombre" name="fullName" className="input" value={fullName} placeholder="Apellido (Enter)"
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
              <input
                className="input scan-doc-search"
                value={docSearch}
                onChange={e => setDocSearch(e.target.value)}
                placeholder="Buscar por nombre, tipo o fecha"
              />
            )}

            {docHistory.length > 0 && filteredDocHistory.length > 0 && (
              <div className="scan-docs-grid">
                {filteredDocHistory.map((d: any) => (
                  <button key={d.id} type="button" className="card scan-doc-card scan-doc-card-button" onClick={() => abrirDocumentoPrevio(d)}>
                    <div className="scan-doc-class-badge">
                      {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.icon || '📄'} {TIPOS_DOCUMENTO.find(t => t.value === d.tipo)?.label || d.tipo || 'doc'}
                    </div>
                    <div className="scan-doc-title">{d.nombre || `Documento #${d.id}`}</div>
                    {d.descripcion_archivo && (
                      <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>{d.descripcion_archivo}</div>
                    )}
                    <div className="muted" style={{ fontSize: '0.72rem', marginTop: 4 }}>
                      {fmtDT(d.created_at)}
                      {scanUserLabel(d) && <> · {scanUserLabel(d)}</>}
                    </div>
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
                <div style={{ fontSize: '2.5rem' }}>🔍</div>
                <div className="muted">Buscá un agente por DNI o apellido</div>
              </div>
            )}
          </div>
        )}

        {organizerPageId && session.length > 0 && (
          <ScanPagesOrganizer
            pages={session}
            initialPageId={organizerPageId}
            onRotate={(page, degrees) => rotarPagina(page, degrees)}
            onApply={ids => { setSession(prev => applyScanPageOrder(prev, ids)); setOrganizerPageId(null); }}
            onClose={() => setOrganizerPageId(null)}
          />
        )}

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
