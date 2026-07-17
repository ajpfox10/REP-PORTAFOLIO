import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';
import { AptosTab } from './AptosTab';
import './styles/TramitesDocumentalesPage.css';

type ConfigData = {
  inputDir: string;
  docuBaseDir: string;
  inputDirExists: boolean;
  docuBaseDirExists: boolean;
  pdfCount: number;
  ocrEnabled: boolean;
  ocrMaxPages: number;
  tramites: Array<{ value: string; label: string }>;
  poblaciones: Array<{ value: string; label: string }>;
  becaTipos?: Array<{ value: string; label: string; total?: number }>;
};

type ExpedienteOption = {
  value: string;
  label: string;
  total?: number;
  createdAt?: string | null;
};

type AnalysisRow = {
  fileName: string;
  fileUrl: string;
  bytes: number;
  pages: number;
  detectedDni: number | null;
  agente: { dni: number; apellido: string; nombre: string; cuil: string | null } | null;
  candidates: number[];
  status: 'detectado' | 'sin_agente' | 'ambiguedad' | 'sin_texto' | 'error';
  reason: string | null;
  lectura: 'texto' | 'ocr' | 'sin_texto';
  manualDni?: string;
  incluido?: boolean;
  pageTitles?: string[];
  pageSubOrder?: number[];
};

type ManualRow = {
  id: string;
  dni: string;
  apellidoNombre: string;
  fechaIngresoExcel: string;
  expediente: string;
  incluido: boolean;
  leyNombre?: string | null;
  plantaNombre?: string | null;
  ocupacionNombre?: string | null;
  ocupacionLey?: string | null;
  tipoBeca?: string | null;
  dependenciaNombre?: string | null;
  // Overrides manuales para la providencia (si null/undefined → se calcula por profesión)
  leyOverride?: ProvidenciaLey | null;
  regimen10471Override?: ProvidenciaRegimen10471 | null;
  cambioExcepcional?: boolean;
};

type PdfModal = {
  title: string;
  url: string;
  filename: string | null;
  currentFileName?: string;
  groupKey?: string | null;
};

type PdfGroup = {
  key: string;
  dni: string;
  agenteNombre: string;
  rows: AnalysisRow[];
  includedCount: number;
  totalPages: number;
  status: 'listo' | 'revisar' | 'sin_agente';
};

type ExtraDocInfo = {
  found: boolean;
  verificado?: boolean;
  fileName?: string;
  pages?: number;
  bytes?: number;
  reason?: string;
  key?: string;
};

type ExtraDocsStatus = { rupa?: ExtraDocInfo; caratula?: ExtraDocInfo };

type SavedListado = {
  id: string;
  name: string;
  createdAt: string;
  poblacion: string;
  tramite: string;
  anioBeca: string;
  programaBeca: string;
  dependenciaId: string;
  expedienteModo: 'unico' | 'individual';
  expedienteUnico: string;
  rows: ManualRow[];
};

const CARATULA_DOC_KEY = '__caratula__';
const RUPA_DOC_KEY = '__rupa__';
const SAVED_LISTADOS_KEY = 'tramites-documentales:listados-preparados:v1';
const SAVED_LISTADOS_MIGRATED_KEY = 'tramites-documentales:listados-preparados:migrated-to-api:v1';
const CARATULA_EXPECTED_NAMES = [
  'caratulahtal10430.pdf',
  'caratulahtal10471.pdf',
  'caratulaupa1810430.pdf',
  'caratulaupa1810471.pdf',
  'caratulaupa410430.pdf',
  'caratulaupa410471.pdf',
];

type ProvidenciaLey = '10471' | '10430';
type ProvidenciaRegimen10471 = 'planta' | 'guardia';

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatTodayDmy() {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

function buildRegimenProvidencia(ley: ProvidenciaLey, regimen10471: ProvidenciaRegimen10471) {
  if (ley === '10430') return '48 horas semanales de labor';
  return regimen10471 === 'guardia' ? '36 horas semanales guardia' : '36 horas semanales planta';
}

// La ley por defecto sale de la ocupación (ocupaciones.ley_id, resuelto en el backend
// como '10471'/'10430'). El resto → 10430. Siempre editable por fila en la providencia.
function leyAutoDeAgente(row: ManualRow): ProvidenciaLey {
  return row.ocupacionLey === '10471' ? '10471' : '10430';
}

function leyDeFila(row: ManualRow): ProvidenciaLey {
  return row.leyOverride ?? leyAutoDeAgente(row);
}

function regimen10471DeFila(row: ManualRow): ProvidenciaRegimen10471 {
  return row.regimen10471Override ?? 'planta';
}

function regimenDeFila(row: ManualRow): string {
  return buildRegimenProvidencia(leyDeFila(row), regimen10471DeFila(row));
}

function normalizeProvidenciaText(value: unknown) {
  return String(value ?? '').trim();
}

function loadSavedListados(): SavedListado[] {
  try {
    const raw = window.localStorage.getItem(SAVED_LISTADOS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeSavedListados(rows: SavedListado[]) {
  window.localStorage.setItem(SAVED_LISTADOS_KEY, JSON.stringify(rows));
}

// Identidad de un listado: población/trámite/año/programa/dependencia (no fecha ni id).
// Dos listados con la misma identidad son "el mismo" → se actualiza, no se duplica.
function listadoIdentity(l: SavedListado): string {
  return [l.poblacion, l.tramite, l.anioBeca, l.programaBeca, l.dependenciaId]
    .map((v) => String(v ?? '').trim().toUpperCase())
    .join('|');
}

function mergeSavedListados(...groups: SavedListado[][]) {
  const sorted = groups.flat()
    .filter((item) => item?.id)
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  const seen = new Set<string>();
  const out: SavedListado[] = [];
  for (const item of sorted) {
    const key = listadoIdentity(item);
    if (seen.has(key)) continue; // ya hay uno más nuevo con esta identidad
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 25);
}

function newManualRow(): ManualRow {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    dni: '',
    apellidoNombre: '',
    fechaIngresoExcel: '',
    expediente: '',
    incluido: true,
  };
}

function statusLabel(status: AnalysisRow['status']) {
  if (status === 'detectado') return 'Detectado';
  if (status === 'ambiguedad') return 'Revisar';
  if (status === 'sin_texto') return 'Sin texto';
  if (status === 'sin_agente') return 'Sin agente';
  return 'Error';
}

function bytesLabel(bytes: number) {
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function lecturaLabel(value: AnalysisRow['lectura']) {
  if (value === 'ocr') return 'OCR';
  if (value === 'texto') return 'Texto';
  return 'Sin texto';
}

function pdfItemLabel(row: AnalysisRow, index: number) {
  const pages = row.pages ? `${row.pages} pág.` : 'sin pág.';
  return `PDF ${index + 1} - ${pages} - ${bytesLabel(row.bytes)}`;
}

function pagesFromOrder(rawOrder: string | null | undefined, totalPages: number) {
  const allPages = Array.from({ length: Math.max(0, totalPages) }, (_, index) => index + 1);
  const raw = String(rawOrder || '').trim();
  if (!raw || totalPages <= 0) return allPages;

  const selected: number[] = [];
  for (const part of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
      const step = from <= to ? 1 : -1;
      for (let page = from; step > 0 ? page <= to : page >= to; page += step) {
        if (page >= 1 && page <= totalPages) selected.push(page);
      }
      continue;
    }
    const page = Number(part);
    if (Number.isInteger(page) && page >= 1 && page <= totalPages) selected.push(page);
  }

  return selected.length ? Array.from(new Set(selected)) : allPages;
}

function compactPageOrder(pages: number[], totalPages: number) {
  const clean = Array.from(new Set(
    pages.filter((page) => Number.isInteger(page) && page >= 1 && page <= totalPages)
  ));
  if (!clean.length || clean.length === totalPages) return '';
  return clean.join(',');
}

function movePageInOrder(pages: number[], fromPage: number, toPage: number) {
  const next = [...pages];
  const fromIndex = next.indexOf(fromPage);
  const toIndex = next.indexOf(toPage);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return next;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function normTitle(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Orden fijo del combinado (planilla del área). Cada hoja se ubica por su TÍTULO (encabezado
// del SIAPE/eRreH). El menor rank va primero. Ver Excel "Orden en personalPV5".
const COMBINED_PAGE_ORDER: Array<{ rank: number; match: (t: string) => boolean }> = [
  { rank: 1, match: (t) => t.includes('planilla de datos personales') },
  { rank: 2, match: (t) => t.includes('documento de identidad') },
  { rank: 3, match: (t) => t.includes('constancia de cuil') },
  { rank: 4, match: (t) => t.includes('curriculum') },
  { rank: 5, match: (t) => t.includes('titulo') && t.includes('matricula') },
  { rank: 6, match: (t) => t.includes('incompatibilidad') },
  { rank: 7, match: (t) => t.includes('antecedentes') && t.includes('provincial') },
  { rank: 8, match: (t) => t.includes('reincidencia') },
  { rank: 10, match: (t) => t.includes('condiciones de salud') },
  { rank: 11, match: (t) => t.includes('aptitud psicofisica') || t.includes('medicina ocupacional') },
  { rank: 12, match: (t) => t.includes('libre deuda') || t.includes('registro de deudores') },
  { rank: 15, match: (t) => t.includes('acepto designacion') || t.includes('conformidad de designacion') },
];
const RANK_RUPA = 13;
const RANK_CARATULA = 14;
const RANK_UNKNOWN = 12.5; // hojas sin match → antes de rupa/carátula/aceptación

function rankForPageTitle(title: string): number {
  const t = normTitle(title);
  for (const o of COMBINED_PAGE_ORDER) {
    if (o.match(t)) return o.rank;
  }
  return RANK_UNKNOWN;
}

// Nombre corto de la hoja para mostrar: el título sin el encabezado (fecha + nombre + CUIL).
function pageTitleShort(title?: string): string {
  const t = String(title || '').trim();
  if (!t) return '';
  const afterCuil = t.replace(/^.*?\b\d{11}\b\s*/, '');
  return (afterCuil || t).slice(0, 45).trim();
}

function pageDragPayload(groupKey: string, docKey: string, page: number) {
  return JSON.stringify({ groupKey, docKey, page });
}

function parsePageDragPayload(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return {
      groupKey: String(parsed?.groupKey || ''),
      docKey: String(parsed?.docKey || ''),
      page: Number(parsed?.page || 0),
    };
  } catch {
    return { groupKey: '', docKey: '', page: 0 };
  }
}

export function TramitesDocumentalesPage() {
  const toast = useToast();
  const [pageTab, setPageTab] = useState<'tramites' | 'aptos'>('tramites');
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [becaTipos, setBecaTipos] = useState<Array<{ value: string; label: string; total?: number }>>([]);
  const [dependencias, setDependencias] = useState<Array<{ value: string; label: string; total?: number }>>([]);
  const [poblacion, setPoblacion] = useState('BECARIOS');
  const [tramite, setTramite] = useState('DESIGNACION');
  const [anioBeca, setAnioBeca] = useState('');
  const [programaBeca, setProgramaBeca] = useState('TODAS');
  const [dependenciaId, setDependenciaId] = useState('TODAS');
  const [expedienteModo, setExpedienteModo] = useState<'unico' | 'individual'>('unico');
  const [expedienteUnico, setExpedienteUnico] = useState('');
  const [expedienteAgenteId, setExpedienteAgenteId] = useState('');
  const [expedienteAgenteNumero, setExpedienteAgenteNumero] = useState('');
  const [expedienteBuscar, setExpedienteBuscar] = useState('');
  const [expedienteOptions, setExpedienteOptions] = useState<ExpedienteOption[]>([]);
  const [providenciaOpen, setProvidenciaOpen] = useState(false);
  const [providenciaLugarFecha, setProvidenciaLugarFecha] = useState(`Gonzalez Catan, ${formatTodayDmy()}`);
  const [providenciaLey, setProvidenciaLey] = useState<ProvidenciaLey>('10471');
  const [providenciaRegimen10471, setProvidenciaRegimen10471] = useState<ProvidenciaRegimen10471>('planta');
  const [includeCaratula, setIncludeCaratula] = useState(false);
  const [includeRupa, setIncludeRupa] = useState(true);
  const [rupaSourceMode, setRupaSourceMode] = useState<'docu' | 'descargas' | 'custom'>('docu');
  const [rupaDir, setRupaDir] = useState('');
  const [manualRows, setManualRows] = useState<ManualRow[]>([newManualRow()]);
  const [savedListados, setSavedListados] = useState<SavedListado[]>(() => loadSavedListados());
  const [selectedListadoId, setSelectedListadoId] = useState('');
  const [analysisRows, setAnalysisRows] = useState<AnalysisRow[]>([]);
  const [reviewFilter, setReviewFilter] = useState<'TODOS' | 'LISTOS' | 'REVISAR' | 'SIN_AGENTE'>('TODOS');
  const [loading, setLoading] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewingDni, setPreviewingDni] = useState<string | null>(null);
  const [pendingSaveDni, setPendingSaveDni] = useState<string | null>(null);
  const [savedResults, setSavedResults] = useState<any[]>([]);
  const [docOrderByGroup, setDocOrderByGroup] = useState<Record<string, string[]>>({});
  const [pageOrderByDoc, setPageOrderByDoc] = useState<Record<string, string>>({});
  const [combinedOrderByGroup, setCombinedOrderByGroup] = useState<Record<string, string[]>>({});
  const [combinedExcludedByGroup, setCombinedExcludedByGroup] = useState<Record<string, string[]>>({});
  const [extraDocsByDni, setExtraDocsByDni] = useState<Record<string, ExtraDocsStatus>>({});
  const [extraStatusLoading, setExtraStatusLoading] = useState(false);
  const [modal, setModal] = useState<PdfModal | null>(null);
  const modalUrlRef = useRef<string | null>(null);

  function revokeModalUrl() {
    if (modalUrlRef.current) {
      URL.revokeObjectURL(modalUrlRef.current);
      modalUrlRef.current = null;
    }
  }

  async function refreshSavedListadosFromServer() {
    const res = await apiFetch<{ ok: boolean; data: { rows: SavedListado[] } }>('/tramites-documentales/listados');
    const rows = res.data.rows || [];
    setSavedListados(rows);
    storeSavedListados(rows);
    setSelectedListadoId((current) => (
      current && rows.some((item) => item.id === current) ? current : rows[0]?.id || ''
    ));
    return rows;
  }

  useEffect(() => {
    apiFetch<{ ok: boolean; data: ConfigData }>('/tramites-documentales/config')
      .then((res) => {
        setConfig(res.data);
        setBecaTipos(res.data.becaTipos || []);
      })
      .catch((e: any) => toast.error('No se pudo cargar configuración', e?.message || 'Error'));

    return () => revokeModalUrl();
  }, []);

  useEffect(() => {
    const legacyRows = loadSavedListados();
    if (legacyRows.length) {
      setSavedListados((current) => mergeSavedListados(current, legacyRows));
    }

    apiFetch<{ ok: boolean; data: { rows: SavedListado[] } }>('/tramites-documentales/listados')
      .then(async (res) => {
        const serverRows = res.data.rows || [];
        const alreadyMigrated = window.localStorage.getItem(SAVED_LISTADOS_MIGRATED_KEY) === '1';
        const missingLegacy = alreadyMigrated
          ? []
          : legacyRows.filter((legacy) => !serverRows.some((row) => row.id === legacy.id));

        if (missingLegacy.length) {
          await Promise.all(missingLegacy.map((listado) => (
            apiFetch('/tramites-documentales/listados', {
              method: 'POST',
              body: JSON.stringify({ listado }),
            })
          )));
          window.localStorage.setItem(SAVED_LISTADOS_MIGRATED_KEY, '1');
          await refreshSavedListadosFromServer();
          return;
        }

        const rows = mergeSavedListados(serverRows, legacyRows);
        setSavedListados(rows);
        storeSavedListados(rows);
        setSelectedListadoId((current) => (
          current && rows.some((item) => item.id === current) ? current : rows[0]?.id || ''
        ));
      })
      .catch((e: any) => {
        if (!legacyRows.length) {
          toast.error('No se pudieron cargar listados', e?.message || 'Error');
        }
      });
  }, []);

  useEffect(() => {
    if (poblacion !== 'BECARIOS') return;
    const qs = new URLSearchParams();
    if (/^\d{4}$/.test(anioBeca)) {
      qs.set('anioDesde', anioBeca);
      qs.set('anioHasta', anioBeca);
    }
    if (dependenciaId !== 'TODAS') qs.set('dependenciaId', dependenciaId);
    apiFetch<{ ok: boolean; data: { rows: Array<{ value: string; label: string; total?: number }> } }>(`/tramites-documentales/beca-tipos?${qs.toString()}`)
      .then((res) => {
        const rows = res.data.rows || [];
        setBecaTipos(rows);
        if (programaBeca !== 'TODAS' && !rows.some((row) => row.value === programaBeca)) {
          setProgramaBeca('TODAS');
        }
      })
      .catch((e: any) => toast.error('No se pudieron cargar programas', e?.message || 'Error'));
  }, [poblacion, anioBeca, programaBeca, dependenciaId]);

  useEffect(() => {
    if (poblacion !== 'BECARIOS') return;
    const qs = new URLSearchParams();
    if (/^\d{4}$/.test(anioBeca)) {
      qs.set('anioDesde', anioBeca);
      qs.set('anioHasta', anioBeca);
    }
    if (programaBeca !== 'TODAS') qs.set('tipoBeca', programaBeca);
    apiFetch<{ ok: boolean; data: { rows: Array<{ value: string; label: string; total?: number }> } }>(`/tramites-documentales/dependencias?${qs.toString()}`)
      .then((res) => {
        const rows = res.data.rows || [];
        setDependencias(rows);
        if (dependenciaId !== 'TODAS' && !rows.some((row) => row.value === dependenciaId)) {
          setDependenciaId('TODAS');
        }
      })
      .catch((e: any) => toast.error('No se pudieron cargar dependencias', e?.message || 'Error'));
  }, [poblacion, anioBeca, programaBeca, dependenciaId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const qs = new URLSearchParams();
      if (expedienteBuscar.trim()) qs.set('q', expedienteBuscar.trim());
      apiFetch<{ ok: boolean; data: { rows: ExpedienteOption[] } }>(`/tramites-documentales/expedientes?${qs.toString()}`)
        .then((res) => setExpedienteOptions(res.data.rows || []))
        .catch(() => setExpedienteOptions([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [expedienteBuscar]);

  function setExpedienteSeleccionado(value: string) {
    if (expedienteModo === 'individual') {
      setExpedienteAgenteNumero(value);
    } else {
      setExpedienteUnico(value);
    }
  }

  useEffect(() => {
    const dnis = Array.from(new Set(
      analysisRows.map((row) => dniFromAnalysis(row)).filter(Boolean)
    ));
    if (!dnis.length) {
      setExtraDocsByDni({});
      setExtraStatusLoading(false);
      return;
    }
    setExtraStatusLoading(true);
    apiFetch<{ ok: boolean; data: { rows: Record<string, ExtraDocsStatus> } }>('/tramites-documentales/extra-status', {
      method: 'POST',
      body: JSON.stringify({
        dnis,
        extraDocs: {
          includeCaratula,
          includeRupa,
          rupaSourceMode,
          rupaDir: rupaSourceMode === 'custom' ? rupaDir : null,
        },
      }),
    })
      .then((res) => setExtraDocsByDni(res.data.rows || {}))
      .catch(() => setExtraDocsByDni({}))
      .finally(() => setExtraStatusLoading(false));
  }, [analysisRows, includeCaratula, includeRupa, rupaSourceMode, rupaDir]);

  const tramiteOptions = (config?.tramites || [])
    .filter((t) => poblacion !== 'INTERINOS_10430' || t.value !== 'NOMBRAMIENTO');

  useEffect(() => {
    if (poblacion === 'INTERINOS_10430' && tramite === 'NOMBRAMIENTO') {
      setTramite('RENOVACION');
    }
  }, [poblacion, tramite]);

  const agentesSeteados = manualRows.filter((row) => row.incluido !== false && (row.dni || row.apellidoNombre));

  function providenciaCargo(row: ManualRow) {
    const raw = normalizeProvidenciaText(row.ocupacionNombre)
      || normalizeProvidenciaText(row.plantaNombre)
      || normalizeProvidenciaText(row.tipoBeca)
      || normalizeProvidenciaText(row.leyNombre)
      || '-';
    // Sacar el grado final (A/B/C/D) y mostrar en mayúsculas: "Enfermero C" -> "ENFERMERO"
    return (raw.replace(/\s+[A-D]\s*$/i, '').trim() || raw).toUpperCase();
  }

  function providenciaBaseRows() {
    return agentesSeteados.map((row) => ({
      id: row.id,
      apellidoNombre: normalizeProvidenciaText(row.apellidoNombre) || '-',
      dni: normalizeProvidenciaText(row.dni) || '-',
      cargo: providenciaCargo(row),
      ley: leyDeFila(row),
      regimen: regimenDeFila(row),
      regimen10471: regimen10471DeFila(row),
      dependencia: normalizeProvidenciaText(row.dependenciaNombre) || '-',
      cambioExcepcional: Boolean(row.cambioExcepcional),
    }));
  }

  type ProvidenciaFila = ReturnType<typeof providenciaBaseRows>[number] & { numero: number };
  type ProvidenciaGrupo = { ley: ProvidenciaLey; rows: ProvidenciaFila[] };

  // Un cuadro por ley: agrupa los agentes por ley (orden de aparición) y numera dentro de cada grupo.
  function providenciaGrupos(): ProvidenciaGrupo[] {
    const grupos: ProvidenciaGrupo[] = [];
    for (const r of providenciaBaseRows()) {
      let g = grupos.find((x) => x.ley === r.ley);
      if (!g) { g = { ley: r.ley, rows: [] }; grupos.push(g); }
      g.rows.push({ ...r, numero: g.rows.length + 1 });
    }
    return grupos;
  }

  function providenciaIntroGrupo(grupo: ProvidenciaGrupo) {
    const total = grupo.rows.length;
    const agTxt = total === 1 ? 'agente' : 'agentes';
    const desTxt = total === 1 ? 'designado' : 'designados';
    const regs = Array.from(new Set(grupo.rows.map((r) => r.regimen)));
    const regTxt = regs.length === 1
      ? `con regimen horario de ${regs[0]}`
      : 'con el regimen horario que se detalla en el cuadro';
    return `Se eleva la presente a fin de propiciar la designacion de ${total} ${agTxt}, conforme surge del cuadro agregado, para ser ${desTxt} en la Ley ${grupo.ley}, ${regTxt}.`;
  }

  // Aclaraciones por agentes marcados como "cambio excepcional".
  // El texto cambia segun la ley del agente:
  //  - 10471: se lo solicita como {cargo} por un cambio excepcional...
  //  - 10430: se tramita por expediente {expediente} su designacion atento a...
  function providenciaAclaraciones() {
    return providenciaBaseRows()
      .filter((r) => r.cambioExcepcional)
      .map((r) => {
        if (r.ley === '10430') {
          return `El cambio excepcional del agente ${r.apellidoNombre} se tramita por expediente __________ atento a las necesidades del servicio.`;
        }
        return `${r.apellidoNombre} se lo solicita como ${r.cargo} por un cambio excepcional y responde por las necesidades de la dependencia.`;
      });
  }

  function providenciaPlainText() {
    const parts: string[] = [providenciaLugarFecha, ''];
    for (const grupo of providenciaGrupos()) {
      parts.push(
        providenciaIntroGrupo(grupo),
        '',
        'N° | Apellido y nombre | DNI | Cargo / profesion | Ley | Regimen horario | Dependencia',
      );
      for (const row of grupo.rows) {
        parts.push(`${row.numero} | ${row.apellidoNombre} | ${row.dni} | ${row.cargo} | ${row.ley} | ${row.regimen} | ${row.dependencia}`);
      }
      parts.push('');
    }
    const aclaraciones = providenciaAclaraciones();
    if (aclaraciones.length) {
      parts.push('Aclaraciones:');
      for (const a of aclaraciones) parts.push(`- ${a}`);
    }
    return parts.join('\n').trimEnd();
  }

  async function copyProvidenciaText() {
    if (!agentesSeteados.length) {
      toast.warning('Sin agentes', 'Tilda al menos un agente de la grilla.');
      return;
    }
    await navigator.clipboard.writeText(providenciaPlainText());
    toast.ok('Providencia copiada', `${agentesSeteados.length} agente(s)`);
  }

  function openProvidencia() {
    if (!agentesSeteados.length) {
      toast.warning('Sin agentes', 'Tilda al menos un agente de la grilla.');
      return;
    }
    setProvidenciaOpen(true);
  }

  function aplicarLeyRegimenATodos() {
    setManualRows((rows) => rows.map((row) => (
      row.incluido !== false && (row.dni || row.apellidoNombre)
        ? {
            ...row,
            leyOverride: providenciaLey,
            regimen10471Override: providenciaLey === '10471' ? providenciaRegimen10471 : null,
          }
        : row
    )));
  }

  function docxCell(text: string, bold = false) {
    return new TableCell({
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
        right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
      },
      children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })],
    });
  }

  function providenciaDocxTable(rows: ProvidenciaFila[]) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ['N°', 'Apellido y nombre', 'DNI', 'Cargo / profesion', 'Ley', 'Regimen horario', 'Dependencia']
            .map((label) => docxCell(label, true)),
        }),
        ...rows.map((row) => new TableRow({
          children: [
            String(row.numero),
            row.apellidoNombre,
            row.dni,
            row.cargo,
            row.ley,
            row.regimen,
            row.dependencia,
          ].map((value) => docxCell(value)),
        })),
      ],
    });
  }

  async function downloadProvidenciaDocx() {
    if (!agentesSeteados.length) {
      toast.warning('Sin agentes', 'Tilda al menos un agente de la grilla.');
      return;
    }
    const grupos = providenciaGrupos();
    const children: Array<Paragraph | Table> = [
      new Paragraph({ text: providenciaLugarFecha, alignment: AlignmentType.RIGHT, spacing: { after: 600 } }),
    ];
    grupos.forEach((grupo, idx) => {
      children.push(new Paragraph({ children: [new TextRun({ text: providenciaIntroGrupo(grupo), size: 24 })], spacing: { after: 360 } }));
      children.push(providenciaDocxTable(grupo.rows));
      if (idx < grupos.length - 1) {
        children.push(new Paragraph({ text: '', spacing: { after: 360 } }));
      }
    });
    const aclaraciones = providenciaAclaraciones();
    if (aclaraciones.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Aclaraciones:', bold: true, size: 24 })], spacing: { before: 360, after: 120 } }));
      aclaraciones.forEach((a) => {
        children.push(new Paragraph({ children: [new TextRun({ text: a, size: 24 })], spacing: { after: 120 } }));
      });
    }
    const doc = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(doc);
    const leySufijo = grupos.length === 1 ? grupos[0].ley : 'mixta';
    triggerBlobDownload(blob, `providencia_designacion_${leySufijo}.docx`);
  }

  useEffect(() => {
    if (expedienteModo !== 'individual') return;
    if (!agentesSeteados.length) {
      setExpedienteAgenteId('');
      return;
    }
    if (!agentesSeteados.some((row) => row.id === expedienteAgenteId)) {
      setExpedienteAgenteId(agentesSeteados[0].id);
    }
  }, [expedienteModo, manualRows, expedienteAgenteId]);

  const populationTabs = config?.poblaciones?.length
    ? config.poblaciones
    : [
        { value: 'BECARIOS', label: 'Becarios' },
        { value: 'INTERINOS_10430', label: 'Interinos Ley 10430' },
      ];

  function applyExpedienteUnicoToManual() {
    const numero = expedienteUnico.trim();
    if (!numero) {
      toast.warning('Falta expediente', 'Carga el numero de expediente.');
      return;
    }
    if (!agentesSeteados.length) {
      toast.warning('Sin agentes seteados', 'Primero precarga o carga agentes.');
      return;
    }
    setManualRows((rows) => rows.map((row) => (
      row.incluido !== false && (row.dni || row.apellidoNombre)
        ? { ...row, expediente: numero }
        : row
    )));
    toast.ok('Expediente cargado', `${agentesSeteados.length} agente(s) actualizados`);
  }

  function applyExpedienteIndividualToManual() {
    const numero = expedienteAgenteNumero.trim();
    if (!expedienteAgenteId) {
      toast.warning('Falta agente', 'Elegi un agente del listado.');
      return;
    }
    if (!numero) {
      toast.warning('Falta expediente', 'Carga el numero de expediente.');
      return;
    }
    const selected = manualRows.find((row) => row.id === expedienteAgenteId);
    setManualRows((rows) => rows.map((row) => (
      row.id === expedienteAgenteId ? { ...row, expediente: numero } : row
    )));
    toast.ok('Expediente cargado', selected?.apellidoNombre || selected?.dni || 'Agente actualizado');
  }

  async function analyzePdfs() {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: AnalysisRow[] } }>('/tramites-documentales/analizar', {
        method: 'POST',
        body: JSON.stringify({ poblacion, tramite }),
      });
      setSavedResults([]);
      setAnalysisRows((res.data.rows || []).map((row) => ({
        ...row,
        manualDni: row.detectedDni ? String(row.detectedDni) : '',
        incluido: row.status === 'detectado',
      })));
      const total = res.data.rows?.length || 0;
      if (total) {
        toast.ok('Análisis listo', `${total} PDF(s) revisados`);
      } else {
        toast.warning('Sin PDFs para analizar', 'No se encontraron PDFs en Descargas ni en sus subcarpetas.');
      }
    } catch (e: any) {
      toast.error('No se pudo analizar PDFs', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function openPdf(row: AnalysisRow, groupKey?: string | null) {
    try {
      const fileUrl = row.fileUrl.replace(/^\/api\/v1(?=\/)/, '');
      const { blob, filename } = await apiFetchBlobWithMeta(fileUrl);
      revokeModalUrl();
      const url = URL.createObjectURL(blob);
      modalUrlRef.current = url;
      setModal({ title: row.fileName, url, filename, currentFileName: row.fileName, groupKey });
    } catch (e: any) {
      toast.error('No se pudo abrir PDF', e?.message || 'Error');
    }
  }

  async function openSavedPdf(item: any) {
    const fileUrl = String(item?.documento?.fileUrl || item?.combinedFileUrl || '').replace(/^\/api\/v1(?=\/)/, '');
    if (!fileUrl) {
      toast.warning('Sin combinado', 'No hay PDF combinado registrado para abrir.');
      return;
    }
    try {
      const { blob, filename } = await apiFetchBlobWithMeta(fileUrl);
      revokeModalUrl();
      const url = URL.createObjectURL(blob);
      modalUrlRef.current = url;
      setModal({ title: item.combined || `Combinado DNI ${item.dni}`, url, filename });
    } catch (e: any) {
      toast.error('No se pudo abrir combinado', e?.message || 'Error');
    }
  }

  async function openExtraDoc(kind: 'rupa' | 'caratula', group: PdfGroup) {
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/tramites-documentales/extra-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          dni: group.dni,
          extraDocs: {
            includeCaratula,
            includeRupa,
            rupaSourceMode,
            rupaDir: rupaSourceMode === 'custom' ? rupaDir : null,
          },
        }),
      });
      revokeModalUrl();
      const url = URL.createObjectURL(blob);
      modalUrlRef.current = url;
      setModal({
        title: `${kind.toUpperCase()} - ${group.agenteNombre}`,
        url,
        filename,
        groupKey: group.key,
        currentFileName: kind === 'rupa' ? RUPA_DOC_KEY : CARATULA_DOC_KEY,
      });
    } catch (e: any) {
      toast.error('No se pudo abrir adjunto', e?.message || 'Error');
    }
  }

  function navigatePdf(delta: number) {
    if (!modal || !analysisRows.length) return;
    const scopeRows = modal.groupKey
      ? pdfGroups.find((group) => group.key === modal.groupKey)?.rows || analysisRows
      : analysisRows;
    const currentIndex = scopeRows.findIndex((row) => row.fileName === (modal.currentFileName || modal.title));
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + delta + scopeRows.length) % scopeRows.length;
    void openPdf(scopeRows[nextIndex], modal.groupKey);
  }

  function updateManual(id: string, patch: Partial<ManualRow>) {
    setManualRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function updateAnalysis(fileName: string, patch: Partial<AnalysisRow>) {
    setAnalysisRows((rows) => rows.map((row) => row.fileName === fileName ? { ...row, ...patch } : row));
  }

  function setAllManualRows(incluido: boolean) {
    setManualRows((rows) => rows.map((row) => ({ ...row, incluido })));
  }

  function setAllAnalysisRows(incluido: boolean) {
    setAnalysisRows((rows) => rows.map((row) => ({ ...row, incluido })));
  }

  function dniFromAnalysis(row: AnalysisRow) {
    return (row.manualDni || String(row.detectedDni || '')).replace(/\D/g, '');
  }

  function setGroupIncluded(group: PdfGroup, incluido: boolean) {
    const files = new Set(group.rows.map((row) => row.fileName));
    setAnalysisRows((rows) => rows.map((row) => (
      files.has(row.fileName) ? { ...row, incluido } : row
    )));
  }

  function setGroupDni(group: PdfGroup, dniValue: string) {
    const cleanDni = dniValue.replace(/\D/g, '');
    const files = new Set(group.rows.map((row) => row.fileName));
    setAnalysisRows((rows) => rows.map((row) => (
      files.has(row.fileName) ? { ...row, manualDni: cleanDni } : row
    )));
  }

  function fileDocKey(fileName: string) {
    return `file:${fileName}`;
  }

  function fileNameFromDocKey(key: string) {
    return key.startsWith('file:') ? key.slice(5) : '';
  }

  function pageOrderKeyFor(docKey: string, group: PdfGroup) {
    if (docKey === RUPA_DOC_KEY) return `${RUPA_DOC_KEY}:${group.key}`;
    return docKey === CARATULA_DOC_KEY ? CARATULA_DOC_KEY : fileNameFromDocKey(docKey);
  }

  function defaultDocKeysForGroup(group: PdfGroup) {
    return [
      ...(hasCaratulaForGroup(group) ? [CARATULA_DOC_KEY] : []),
      ...group.rows.map((row) => fileDocKey(row.fileName)),
      ...(hasRupaForGroup(group) ? [RUPA_DOC_KEY] : []),
    ];
  }

  function orderedDocKeysForGroup(group: PdfGroup) {
    const defaults = defaultDocKeysForGroup(group);
    const allowed = new Set(defaults);
    const saved = docOrderByGroup[group.key] || [];
    return [
      ...saved.filter((key) => allowed.has(key)),
      ...defaults.filter((key) => !saved.includes(key)),
    ];
  }

  function docLabelForKey(group: PdfGroup, key: string) {
    if (key === CARATULA_DOC_KEY) return 'Caratula';
    if (key === RUPA_DOC_KEY) return 'RUPA desde G DOCU';
    const fileName = fileNameFromDocKey(key);
    const index = group.rows.findIndex((row) => row.fileName === fileName);
    const row = group.rows[index];
    return row ? pdfItemLabel(row, index) : 'PDF';
  }

  function extraDocForKey(group: PdfGroup, key: string) {
    if (key === RUPA_DOC_KEY && group.dni) return extraDocsByDni[group.dni]?.rupa || null;
    return null;
  }

  function hasRupaForGroup(group: PdfGroup) {
    const rupa = group.dni ? extraDocsByDni[group.dni]?.rupa : null;
    return Boolean(includeRupa && rupa?.found && Number(rupa.pages || 0) > 0);
  }

  function caratulaForGroup(group: PdfGroup) {
    return group.dni ? extraDocsByDni[group.dni]?.caratula || null : null;
  }

  function hasCaratulaForGroup(group: PdfGroup) {
    const caratula = caratulaForGroup(group);
    return Boolean(includeCaratula && caratula?.found && Number(caratula.pages || 0) > 0);
  }

  function renderRupaHint(group: PdfGroup) {
    if (!includeRupa || !group.dni) return null;
    const rupa = extraDocsByDni[group.dni]?.rupa;
    const [cls, text] = extraStatusLoading
      ? ['loading', '⏳ Analizando RUPA (OCR)…']
      : rupa?.found
        ? (rupa.verificado
            ? ['ok', '✓ RUPA detectado']
            : ['review', '⚠ RUPA sin verificar — revisar'])
        : ['bad', '— RUPA no encontrado'];
    return <div className={`td-rupa-hint ${cls}`}>{text}</div>;
  }

  function renderCaratulaHint(group: PdfGroup) {
    if (!includeCaratula || !group.dni) return null;
    const caratula = caratulaForGroup(group);
    const [cls, text] = extraStatusLoading
      ? ['loading', '⏳ Buscando carátula (OCR)…']
      : caratula?.found
        ? (caratula.verificado
            ? ['ok', `✓ Carátula ${caratula.key || ''}`.trim()]
            : ['review', `⚠ Carátula ${caratula.key || ''} sin verificar — revisar`.trim()])
        : ['bad', '— Carátula no encontrada (establecimiento/ley)'];
    return <div className={`td-rupa-hint ${cls}`}>{text}</div>;
  }

  function hasMergeableExtraForGroup(group: PdfGroup) {
    return hasCaratulaForGroup(group) || hasRupaForGroup(group);
  }

  function moveDocInGroup(group: PdfGroup, key: string, delta: number) {
    setDocOrderByGroup((current) => {
      const defaults = defaultDocKeysForGroup(group);
      const allowed = new Set(defaults);
      const saved = current[group.key] || [];
      const order = [
        ...saved.filter((item) => allowed.has(item)),
        ...defaults.filter((item) => !saved.includes(item)),
      ];
      const index = order.indexOf(key);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return current;
      const next = [...order];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return { ...current, [group.key]: next };
    });
  }

  function updateDocPageOrder(group: PdfGroup, key: string, value: string) {
    const orderKey = pageOrderKeyFor(key, group);
    setPageOrderByDoc((current) => ({ ...current, [orderKey]: value }));
  }

  function docPageCountForKey(group: PdfGroup, key: string) {
    if (key === RUPA_DOC_KEY) return extraDocForKey(group, key)?.pages || 0;
    if (key === CARATULA_DOC_KEY) return 0;
    const fileName = fileNameFromDocKey(key);
    return group.rows.find((row) => row.fileName === fileName)?.pages || 0;
  }

  function toggleDocPage(group: PdfGroup, key: string, page: number) {
    const totalPages = docPageCountForKey(group, key);
    if (!totalPages) return;
    const orderKey = pageOrderKeyFor(key, group);
    const selected = pagesFromOrder(pageOrderByDoc[orderKey], totalPages);
    const exists = selected.includes(page);
    const next = exists
      ? selected.filter((item) => item !== page)
      : [...selected, page];
    if (!next.length) {
      toast.warning('No se puede dejar vacio', 'Destilda el PDF completo si no queres combinarlo.');
      return;
    }
    updateDocPageOrder(group, key, compactPageOrder(next, totalPages));
  }

  function resetDocPages(group: PdfGroup, key: string) {
    updateDocPageOrder(group, key, '');
  }

  function combinedPageKey(docKey: string, page: number) {
    return `${encodeURIComponent(docKey)}#${page}`;
  }

  function parseCombinedPageKey(key: string) {
    const [rawDocKey, rawPage] = String(key || '').split('#');
    try {
      return { docKey: decodeURIComponent(rawDocKey || ''), page: Number(rawPage || 0) };
    } catch {
      return { docKey: '', page: 0 };
    }
  }

  function defaultCombinedPageKeysForGroup(group: PdfGroup) {
    // Orden por defecto = por TÍTULO de hoja (COMBINED_PAGE_ORDER). Estable: a igual rank se
    // respeta el orden original (así las hojas de un mismo doc, ej. TÍTULO, quedan juntas).
    const entries: Array<{ key: string; rank: number; sub: number; seq: number }> = [];
    let seq = 0;

    if (hasCaratulaForGroup(group)) {
      entries.push({ key: combinedPageKey(CARATULA_DOC_KEY, 0), rank: RANK_CARATULA, sub: 0, seq: seq++ });
    }

    for (const row of group.rows) {
      const docKey = fileDocKey(row.fileName);
      const pages = Math.max(1, Number(row.pages || 1));
      for (let page = 1; page <= pages; page += 1) {
        const title = row.pageTitles?.[page - 1] || '';
        const sub = Number(row.pageSubOrder?.[page - 1] || 0);
        entries.push({ key: combinedPageKey(docKey, page), rank: rankForPageTitle(title), sub, seq: seq++ });
      }
    }

    if (hasRupaForGroup(group)) {
      const pages = Math.max(0, Number(extraDocsByDni[group.dni]?.rupa?.pages || 0));
      for (let page = 1; page <= pages; page += 1) {
        entries.push({ key: combinedPageKey(RUPA_DOC_KEY, page), rank: RANK_RUPA, sub: 0, seq: seq++ });
      }
    }

    // Orden: rank (nombre de hoja) → sub-orden (desempate OCR dentro de un mismo título) → original.
    entries.sort((a, b) => a.rank - b.rank || a.sub - b.sub || a.seq - b.seq);
    return entries.map((entry) => entry.key);
  }

  function orderedCombinedPageKeysForGroup(group: PdfGroup) {
    const defaults = defaultCombinedPageKeysForGroup(group);
    const allowed = new Set(defaults);
    const saved = combinedOrderByGroup[group.key] || [];
    return [
      ...saved.filter((key) => allowed.has(key)),
      ...defaults.filter((key) => !saved.includes(key)),
    ];
  }

  function toggleCombinedPage(group: PdfGroup, pageKey: string) {
    setCombinedExcludedByGroup((current) => {
      const currentList = current[group.key] || [];
      const exists = currentList.includes(pageKey);
      if (!exists) {
        const total = orderedCombinedPageKeysForGroup(group).length;
        if (total > 0 && currentList.length >= total - 1) {
          toast.warning('No se puede dejar vacio', 'El combinado necesita al menos una hoja.');
          return current;
        }
      }
      const next = exists
        ? currentList.filter((key) => key !== pageKey)
        : [...currentList, pageKey];
      return { ...current, [group.key]: next };
    });
  }

  // Reordena por ÍNDICE sobre la lista exacta que se ve en pantalla (orderedKeys). No usa indexOf
  // por key: así es inmune a keys repetidas y a cualquier desajuste al recomputar el orden — la
  // fila que arrastrás es exactamente la que se mueve.
  function reorderCombinedByIndex(group: PdfGroup, orderedKeys: string[], fromIndex: number, toIndex: number) {
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= orderedKeys.length) return;
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= orderedKeys.length) return;
    if (fromIndex === toIndex) return;
    const next = [...orderedKeys];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setCombinedOrderByGroup((current) => ({ ...current, [group.key]: next }));
  }

  function resetCombinedPages(group: PdfGroup) {
    setCombinedOrderByGroup((current) => ({ ...current, [group.key]: [] }));
    setCombinedExcludedByGroup((current) => ({ ...current, [group.key]: [] }));
  }

  function combinedPageLabel(group: PdfGroup, pageKey: string, index: number) {
    const { docKey, page } = parseCombinedPageKey(pageKey);
    if (docKey === CARATULA_DOC_KEY) return `${index + 1}. Caratula`;
    if (docKey === RUPA_DOC_KEY) return `${index + 1}. RUPA${page ? ` hoja ${page}` : ''}`;
    const fileName = fileNameFromDocKey(docKey);
    const rowIndex = group.rows.findIndex((row) => row.fileName === fileName);
    const short = pageTitleShort(group.rows[rowIndex]?.pageTitles?.[page - 1]);
    const name = rowIndex >= 0 ? `PDF ${rowIndex + 1}` : 'PDF';
    return `${index + 1}. ${short || `${name} hoja ${page}`}`;
  }

  function hasCombinedPageEdits(group: PdfGroup) {
    return Boolean((combinedOrderByGroup[group.key] || []).length || (combinedExcludedByGroup[group.key] || []).length);
  }

  function documentOrderForGroup(group: PdfGroup) {
    // SIEMPRE por página (incluye el auto-orden por título + cualquier reorden/exclusión manual),
    // así el preview y el combinado quedan EXACTAMENTE igual que la lista del editor.
    const excluded = new Set(combinedExcludedByGroup[group.key] || []);
    return orderedCombinedPageKeysForGroup(group)
      .filter((pageKey) => !excluded.has(pageKey))
      .map((pageKey) => {
        const { docKey, page } = parseCombinedPageKey(pageKey);
        const pageOrder = page > 0 ? String(page) : null;
        if (docKey === CARATULA_DOC_KEY) return { kind: 'caratula', pageOrder };
        if (docKey === RUPA_DOC_KEY) return { kind: 'rupa', pageOrder };
        return { kind: 'file', fileName: fileNameFromDocKey(docKey), pageOrder };
      });
  }

  function openEscaneoAgente(dniValue: string) {
    const dni = String(dniValue || '').replace(/\D/g, '');
    if (!dni) {
      toast.warning('Falta DNI', 'Carga el DNI del agente.');
      return;
    }
    window.open(`/app/escaneo-agente/${dni}`, '_blank', 'noopener,noreferrer');
  }

  async function precargarDesdeBase(
    overrides: Partial<{
      poblacion: string;
      anioBeca: string;
      programaBeca: string;
      dependenciaId: string;
    }> = {},
    silent = false
  ) {
    const nextPoblacion = overrides.poblacion ?? poblacion;
    const nextAnioBeca = overrides.anioBeca ?? anioBeca;
    const nextProgramaBeca = overrides.programaBeca ?? programaBeca;
    const nextDependenciaId = overrides.dependenciaId ?? dependenciaId;

    if (nextPoblacion === 'BECARIOS') {
      if (!/^\d{4}$/.test(nextAnioBeca)) {
        toast.warning('Año incompleto', 'Indicá el año para becarios.');
        return;
      }
    }

    setPreloading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: any[]; total: number } }>('/tramites-documentales/precargar', {
        method: 'POST',
        body: JSON.stringify({
          poblacion: nextPoblacion,
          anioDesde: nextPoblacion === 'BECARIOS' ? nextAnioBeca : null,
          anioHasta: nextPoblacion === 'BECARIOS' ? nextAnioBeca : null,
          tipoBeca: nextPoblacion === 'BECARIOS' && nextProgramaBeca !== 'TODAS' ? nextProgramaBeca : null,
          dependenciaId: nextPoblacion === 'BECARIOS' && nextDependenciaId !== 'TODAS' ? nextDependenciaId : null,
        }),
      });
      const rows = (res.data.rows || []).map((row: any) => ({
        id: `${row.dni}-${Math.random().toString(16).slice(2)}`,
        dni: String(row.dni || ''),
        apellidoNombre: row.apellidoNombre || '',
        fechaIngresoExcel: row.fechaIngresoExcel || '',
        expediente: row.expediente || '',
        incluido: row.incluido !== false,
        leyNombre: row.leyNombre || null,
        plantaNombre: row.plantaNombre || null,
        ocupacionNombre: row.ocupacionNombre || null,
        ocupacionLey: row.ocupacionLey || null,
        tipoBeca: row.tipoBeca || null,
        dependenciaNombre: row.dependenciaNombre || null,
      }));
      setManualRows(rows.length ? rows : [newManualRow()]);
      if (!silent) {
        toast.ok('Listado precargado', `${res.data.total || rows.length} agente(s) desde la base`);
      }
    } catch (e: any) {
      toast.error('No se pudo precargar', e?.message || 'Error');
    } finally {
      setPreloading(false);
    }
  }

  function precargarSiFiltroCompleto(overrides: Partial<{ anioBeca: string; programaBeca: string; dependenciaId: string }>) {
    const nextAnioBeca = overrides.anioBeca ?? anioBeca;
    if (poblacion !== 'BECARIOS' || !/^\d{4}$/.test(nextAnioBeca)) return;
    void precargarDesdeBase(overrides, true);
  }

  function filesPayload(scopeDniValue?: string | null) {
    const scopeDni = scopeDniValue ? String(scopeDniValue).replace(/\D/g, '') : null;
    const expedientePorDni = new Map(
      manualRows
        .map((row) => [row.dni.replace(/\D/g, ''), row.expediente.trim()] as const)
        .filter(([dni]) => !!dni)
    );
    return analysisRows
      .filter((row) => row.incluido !== false)
      .map((row) => {
        const dni = (row.manualDni || String(row.detectedDni || '')).replace(/\D/g, '');
        return {
          fileName: row.fileName,
          dni,
          pageOrder: pageOrderByDoc[row.fileName]?.trim() || null,
          expediente: expedienteModo === 'individual'
            ? expedientePorDni.get(dni) || null
            : expedienteUnico.trim() || null,
          include: true,
        };
      })
      .filter((row) => !scopeDni || row.dni === scopeDni)
      .filter((row) => row.dni);
  }

  async function previewCombined(group: PdfGroup) {
    if (!group.dni) {
      toast.warning('Falta DNI', 'Completá el DNI antes de previsualizar.');
      return;
    }
    const files = filesPayload(group.dni);
    const includeRupaForGroup = hasRupaForGroup(group);
    const includeCaratulaForGroup = hasCaratulaForGroup(group);
    if (!files.length && !includeCaratulaForGroup && !includeRupaForGroup) {
      toast.warning('Sin PDFs', 'No hay documentos para previsualizar.');
      return;
    }

    setPreviewingDni(group.dni);
    try {
      const { blob, filename } = await apiFetchBlobWithMeta('/tramites-documentales/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poblacion,
          tramite,
          dni: group.dni,
          extraDocs: {
            includeCaratula: includeCaratulaForGroup,
            includeRupa: includeRupaForGroup,
            rupaSourceMode,
            rupaDir: rupaSourceMode === 'custom' ? rupaDir : null,
          },
          documentOrder: documentOrderForGroup(group),
          files,
        }),
      });
      revokeModalUrl();
      const url = URL.createObjectURL(blob);
      modalUrlRef.current = url;
      setModal({ title: `Preview combinado - ${group.agenteNombre}`, url, filename, groupKey: group.key });
      toast.ok('Previsualización lista', `${group.agenteNombre}`);
    } catch (e: any) {
      toast.error('No se pudo previsualizar', e?.message || 'Error');
    } finally {
      setPreviewingDni(null);
    }
  }

  async function saveDocuments(onlyDni?: string | null, documentOrder?: any[]) {
    const scopeDni = onlyDni ? String(onlyDni).replace(/\D/g, '') : null;
    const files = filesPayload(scopeDni);
    const scopeGroup = scopeDni ? pdfGroups.find((group) => group.dni === scopeDni) : null;
    const includeRupaForRequest = scopeGroup ? hasRupaForGroup(scopeGroup) : includeRupa;

    if (!files.length) {
      toast.warning('Sin PDFs para guardar', 'Incluí al menos un PDF y completá el DNI.');
      return;
    }

    setPendingSaveDni(scopeDni);
    setSaving(true);
    try {
      const documentOrders = scopeDni
        ? undefined
        : Object.fromEntries(
          pdfGroups
            .filter((group) => group.dni && group.includedCount)
            .map((group) => [group.dni, documentOrderForGroup(group)])
        );
      const res = await apiFetch<{ ok: boolean; data: { results: any[] } }>('/tramites-documentales/guardar', {
        method: 'POST',
        body: JSON.stringify({
          poblacion,
          tramite,
          expedienteModo,
          expediente: expedienteModo === 'unico' ? expedienteUnico : null,
          extraDocs: {
            includeCaratula,
            includeRupa: includeRupaForRequest,
            rupaSourceMode,
            rupaDir: rupaSourceMode === 'custom' ? rupaDir : null,
          },
          documentOrder: documentOrder || undefined,
          documentOrders,
          files,
        }),
      });
      setPendingSaveDni(null);
      setSavedResults(res.data.results || []);
      toast.ok('Documentos guardados', `${res.data.results?.length || 0} agente(s) procesados`);
    } catch (e: any) {
      toast.error('No se pudo guardar', e?.message || 'Error');
    } finally {
      setSaving(false);
      setPendingSaveDni(null);
    }
  }

  function setSavedListadosWithBackup(next: SavedListado[]) {
    setSavedListados(next);
    storeSavedListados(next);
  }

  function currentListadoName(rows: ManualRow[]) {
    const total = rows.filter((row) => row.incluido !== false && (row.dni || row.apellidoNombre)).length;
    const programa = becaTipos.find((tipo) => tipo.value === programaBeca)?.label || (programaBeca === 'TODAS' ? 'Todos los programas' : programaBeca);
    const dependencia = dependencias.find((dep) => dep.value === dependenciaId)?.label || (dependenciaId === 'TODAS' ? 'Todas las dependencias' : dependenciaId);
    const parts = [
      poblacion === 'INTERINOS_10430' ? 'Interinos Ley 10430' : 'Becarios',
      tramite,
      poblacion === 'BECARIOS' && anioBeca ? `Año ${anioBeca}` : '',
      poblacion === 'BECARIOS' && programaBeca !== 'TODAS' ? programa : '',
      poblacion === 'BECARIOS' && dependenciaId !== 'TODAS' ? dependencia : '',
      `${total} agente(s)`,
    ].filter(Boolean);
    return parts.join(' - ');
  }

  async function persistCurrentListado() {
    const rows = manualRows
      .filter((row) => row.dni || row.apellidoNombre)
      .map((row) => ({ ...row }));
    if (!rows.length) {
      toast.warning('Sin agentes', 'No hay filas cargadas para setear.');
      return null;
    }
    const draft = { poblacion, tramite, anioBeca, programaBeca, dependenciaId } as SavedListado;
    // Si ya hay un listado seteado con la misma identidad, se reusa su id para ACTUALIZARLO
    // en lugar de crear un duplicado nuevo.
    const existente = savedListados.find((item) => listadoIdentity(item) === listadoIdentity(draft));
    const snapshot: SavedListado = {
      id: existente?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: currentListadoName(rows),
      createdAt: new Date().toISOString(),
      poblacion,
      tramite,
      anioBeca,
      programaBeca,
      dependenciaId,
      expedienteModo,
      expedienteUnico,
      rows,
    };
    const next = mergeSavedListados([snapshot], savedListados);
    setSavedListadosWithBackup(next);
    setSelectedListadoId(snapshot.id);
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: SavedListado[] } }>('/tramites-documentales/listados', {
        method: 'POST',
        body: JSON.stringify({ listado: snapshot }),
      });
      const serverRows = res.data.rows || next;
      setSavedListadosWithBackup(serverRows);
      setSelectedListadoId(snapshot.id);
    } catch (e: any) {
      toast.warning('Listado guardado local', e?.message || 'No se pudo guardar en servidor.');
    }
    return snapshot;
  }

  function loadSavedListado(id?: string) {
    const targetId = id || selectedListadoId || savedListados[0]?.id;
    const item = savedListados.find((saved) => saved.id === targetId);
    if (!item) {
      toast.warning('Sin listado', 'No hay listado seteado para cargar.');
      return;
    }
    setPoblacion(item.poblacion || 'BECARIOS');
    setTramite(item.tramite || 'DESIGNACION');
    setAnioBeca(item.anioBeca || '');
    setProgramaBeca(item.programaBeca || 'TODAS');
    setDependenciaId(item.dependenciaId || 'TODAS');
    setExpedienteModo(item.expedienteModo || 'unico');
    setExpedienteUnico(item.expedienteUnico || '');
    setManualRows(item.rows?.length ? item.rows.map((row) => ({ ...row, id: row.id || `${row.dni}-${Math.random().toString(16).slice(2)}` })) : [newManualRow()]);
    setSelectedListadoId(item.id);
    toast.ok('Listado cargado', item.name);
  }

  async function deleteSavedListado() {
    const targetId = selectedListadoId;
    if (!targetId) {
      toast.warning('Sin seleccion', 'Elegi un listado para borrar.');
      return;
    }
    const next = savedListados.filter((item) => item.id !== targetId);
    setSavedListadosWithBackup(next);
    setSelectedListadoId(next[0]?.id || '');
    try {
      const res = await apiFetch<{ ok: boolean; data: { rows: SavedListado[] } }>(`/tramites-documentales/listados/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      const serverRows = res.data.rows || next;
      setSavedListadosWithBackup(serverRows);
      setSelectedListadoId(serverRows[0]?.id || '');
      toast.ok('Listado borrado', 'Se quito de los preparados.');
    } catch (e: any) {
      toast.warning('Borrado local', e?.message || 'No se pudo borrar en servidor.');
    }
  }

  async function submitManual(e: FormEvent) {
    e.preventDefault();
    const saved = await persistCurrentListado();
    if (saved) {
      toast.ok('Tabla preparada', 'Queda cargada y disponible para elegir como listado seteado.');
    }
  }

  const pdfGroupMap = new Map<string, PdfGroup>();
  for (const row of analysisRows) {
    const dni = dniFromAnalysis(row);
    const key = dni || `SIN_AGENTE:${row.fileName}`;
    const manual = dni ? manualRows.find((item) => item.dni.replace(/\D/g, '') === dni) : null;
    const agenteNombre = row.agente
      ? `${row.agente.apellido}, ${row.agente.nombre}`
      : manual?.apellidoNombre || (dni ? `DNI ${dni}` : 'Sin agente');
    if (!pdfGroupMap.has(key)) {
      pdfGroupMap.set(key, {
        key,
        dni,
        agenteNombre,
        rows: [],
        includedCount: 0,
        totalPages: 0,
        status: dni ? 'listo' : 'sin_agente',
      });
    }
    const group = pdfGroupMap.get(key)!;
    group.rows.push(row);
    group.includedCount += row.incluido !== false ? 1 : 0;
    group.totalPages += Number(row.pages || 0);
    if (!dni) {
      group.status = 'sin_agente';
    } else if (row.status !== 'detectado' || row.incluido === false) {
      group.status = 'revisar';
    }
  }

  const pdfGroups = Array.from(pdfGroupMap.values())
    .sort((a, b) => a.agenteNombre.localeCompare(b.agenteNombre, 'es'));
  const pdfSummary = {
    total: pdfGroups.length,
    listos: pdfGroups.filter((group) => group.status === 'listo').length,
    revisar: pdfGroups.filter((group) => group.status === 'revisar').length,
    sinAgente: pdfGroups.filter((group) => group.status === 'sin_agente').length,
    incluidos: analysisRows.filter((row) => row.incluido !== false).length,
  };
  const filteredPdfGroups = pdfGroups.filter((group) => {
    if (reviewFilter === 'LISTOS') return group.status === 'listo';
    if (reviewFilter === 'REVISAR') return group.status === 'revisar';
    if (reviewFilter === 'SIN_AGENTE') return group.status === 'sin_agente';
    return true;
  });
  const modalGroup = modal?.groupKey ? pdfGroups.find((group) => group.key === modal.groupKey) || null : null;
  const isCombinedPreviewModal = Boolean(modalGroup && !modal?.currentFileName);
  const modalScopeRows = isCombinedPreviewModal ? [] : (modalGroup?.rows || (modal?.currentFileName ? analysisRows : []));
  const modalExtras: string[] = modalGroup && !isCombinedPreviewModal
    ? [
        ...(hasCaratulaForGroup(modalGroup) ? [CARATULA_DOC_KEY] : []),
        ...(hasRupaForGroup(modalGroup) ? [RUPA_DOC_KEY] : []),
      ]
    : [];
  const modalTitle = modalGroup
    ? `${modalGroup.agenteNombre} - ${modalGroup.dni ? `DNI ${modalGroup.dni}` : 'sin DNI'}`
    : modal?.title || '';
  const modalSubtitle = modalGroup
    ? isCombinedPreviewModal
      ? `${orderedCombinedPageKeysForGroup(modalGroup).length - (combinedExcludedByGroup[modalGroup.key] || []).length} hoja(s) incluidas en el combinado`
      : `${modalGroup.rows.length} PDF(s) del paquete - ${modalGroup.totalPages || '-'} pag.`
    : modal?.filename || 'PDF';

  const renderExtraDocs = () => (
    <section className="td-card td-extra-docs">
      <div className="td-extra-title">
        <div className="h2">Adjuntos al combinado</div>
        <div className="muted">Se suman al PDF final por agente</div>
      </div>
      <label className="td-checkline">
        <input type="checkbox" checked={includeCaratula} onChange={(e) => setIncludeCaratula(e.target.checked)} />
        <span>Carátula desde Descargas</span>
      </label>
      {includeCaratula ? (
        <div className="td-caratula-warning" role="note">
          <strong>Caratula: nombre esperado en Descargas</strong>
          <span>
            La app busca <code>caratula</code> + establecimiento + ley. Hospital/Evita usa <code>htal</code>;
            UPA 18 usa <code>upa18</code>; UPA 4 usa <code>upa4</code>. No usar <code>siape</code> en el nombre.
          </span>
          <div className="td-caratula-names">
            {CARATULA_EXPECTED_NAMES.map((name) => <code key={name}>{name}</code>)}
          </div>
        </div>
      ) : null}
      <label className="td-checkline">
        <input type="checkbox" checked={includeRupa} onChange={(e) => setIncludeRupa(e.target.checked)} />
        <span>RUPA desde G DOCU</span>
      </label>
      <label className="td-extra-field">
        <span className="label">Origen RUPA</span>
        <select className="input" value={rupaSourceMode} onChange={(e) => setRupaSourceMode(e.target.value as any)} disabled={!includeRupa}>
          <option value="docu">G DOCU / DNI automático</option>
          <option value="descargas">Descargas</option>
          <option value="custom">Ruta manual</option>
        </select>
      </label>
      {includeRupa && rupaSourceMode === 'custom' ? (
        <label className="td-extra-field td-extra-path">
          <span className="label">Ruta RUPA</span>
          <input className="input" value={rupaDir} onChange={(e) => setRupaDir(e.target.value)} placeholder="Ej: D:\G\RUPA" />
        </label>
      ) : null}
    </section>
  );

  return (
    <Layout title="Trámites documentales" showBack>
      {/* Pestañas de la página */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {([['tramites', '📄 Trámites'], ['aptos', '🩺 Aptos']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setPageTab(key)}
            style={{
              padding: '7px 18px', fontSize: '0.8rem', fontWeight: pageTab === key ? 700 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              color: pageTab === key ? '#fff' : '#64748b',
              borderBottom: pageTab === key ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {label}
          </button>
        ))}
      </div>

      {pageTab === 'aptos' ? <AptosTab /> : (<>
      <section className="td-card td-config">
        <div>
          <div className="td-eyebrow">Carpetas</div>
          <div className="td-path"><b>Entrada:</b> {config?.inputDir || '-'}</div>
          <div className="td-path"><b>DOCU:</b> {config?.docuBaseDir || '-'}</div>
        </div>
        <div className="td-pills">
          <span className={config?.inputDirExists ? 'td-pill ok' : 'td-pill bad'}>{config?.pdfCount ?? 0} PDF</span>
          <span className={config?.docuBaseDirExists ? 'td-pill ok' : 'td-pill bad'}>DOCU</span>
          <span className={config?.ocrEnabled ? 'td-pill ok' : 'td-pill bad'}>OCR {config?.ocrEnabled ? `hasta ${config?.ocrMaxPages || '-'} pág.` : 'off'}</span>
        </div>
      </section>

      {renderExtraDocs()}

      <section className="td-card td-pop-tabs" aria-label="Poblacion documental">
        {populationTabs.map((p) => (
          <button
            key={p.value}
            className={poblacion === p.value ? 'td-pop-tab active' : 'td-pop-tab'}
            type="button"
            onClick={() => {
              setPoblacion(p.value);
              void precargarDesdeBase({ poblacion: p.value }, true);
            }}
          >
            {p.label}
          </button>
        ))}
      </section>

      <section className="td-card td-controls">
        <label>
          <span className="label">Trámite</span>
          <select className="input" value={tramite} onChange={(e) => setTramite(e.target.value)}>
            {tramiteOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Expediente</span>
          <select className="input" value={expedienteModo} onChange={(e) => setExpedienteModo(e.target.value as any)}>
            <option value="unico">Único para muchos</option>
            <option value="individual">Uno por agente</option>
          </select>
        </label>
        {expedienteModo === 'unico' ? (
          <label>
            <span className="label">Número</span>
            <input className="input" value={expedienteUnico} onChange={(e) => setExpedienteUnico(e.target.value)} placeholder="Expediente" />
          </label>
        ) : null}
        <label className="td-expediente-picker">
          <span className="label">Buscar expediente</span>
          <input
            className="input"
            value={expedienteBuscar}
            onChange={(e) => setExpedienteBuscar(e.target.value)}
            placeholder="Buscar por número o texto"
          />
          <select className="input" value="" onChange={(e) => setExpedienteSeleccionado(e.target.value)}>
            <option value="">Elegir expediente</option>
            {expedienteOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.value}{opt.total ? ` (${opt.total})` : ''}{opt.createdAt ? ` - ${opt.createdAt}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" type="button" onClick={analyzePdfs} disabled={loading}>
          {loading ? 'Analizando...' : 'Analizar PDFs'}
        </button>
      </section>

      <section className="td-card td-expediente-tools">
        <div>
          <div className="h2">Expediente de designacion</div>
          <div className="muted">{agentesSeteados.length} agente(s) seteados</div>
        </div>
        {expedienteModo === 'unico' ? (
          <button className="btn primary" type="button" onClick={applyExpedienteUnicoToManual}>
            Cargar a agentes seteados
          </button>
        ) : (
          <>
            <label>
              <span className="label">Agente</span>
              <select className="input" value={expedienteAgenteId} onChange={(e) => setExpedienteAgenteId(e.target.value)}>
                {agentesSeteados.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.apellidoNombre || row.dni || 'Sin nombre'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Numero</span>
              <input className="input" value={expedienteAgenteNumero} onChange={(e) => setExpedienteAgenteNumero(e.target.value)} placeholder="Expediente" />
            </label>
            <label>
              <span className="label">Elegir expediente</span>
              <select className="input" value="" onChange={(e) => setExpedienteAgenteNumero(e.target.value)}>
                <option value="">Seleccionar</option>
                {expedienteOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value}{opt.total ? ` (${opt.total})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary" type="button" onClick={applyExpedienteIndividualToManual}>
              Cargar al agente
            </button>
          </>
        )}
      </section>

      <section className="td-card td-saved-listados">
        <div className="td-saved-copy">
          <div className="h2">Listados seteados</div>
          <div className="muted">
            {savedListados.length
              ? 'Elegis un listado ya preparado y vuelve a cargar la grilla.'
              : 'Cuando aprietes Setear listado queda guardado aca para reutilizarlo.'}
          </div>
        </div>
        <label className="td-saved-select">
          <span className="label">Listado</span>
          <select
            className="input"
            value={selectedListadoId}
            onChange={(e) => setSelectedListadoId(e.target.value)}
            disabled={!savedListados.length}
          >
            <option value="">Elegir listado seteado</option>
            {savedListados.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} - {new Date(item.createdAt).toLocaleString('es-AR')}
              </option>
            ))}
          </select>
        </label>
        <div className="td-saved-actions">
          <button className="btn primary td-btn-compact" type="button" onClick={() => loadSavedListado()} disabled={!savedListados.length}>
            Cargar listado
          </button>
          <button className="btn td-btn-compact" type="button" onClick={() => loadSavedListado(savedListados[0]?.id)} disabled={!savedListados.length}>
            Ultimo
          </button>
          <button className="btn td-btn-compact" type="button" onClick={deleteSavedListado} disabled={!selectedListadoId}>
            Borrar
          </button>
        </div>
      </section>

      <section className="td-card td-preload">
        <div>
          <div className="h2">Precarga desde base</div>
          <div className="muted">
            {poblacion === 'BECARIOS'
              ? 'Becarios por año exacto de fecha de ingreso.'
              : 'Interinos: todos los agentes activos de Ley 10430 que no figuran como PERMANENTE.'}
          </div>
        </div>
        {poblacion === 'BECARIOS' ? (
          <>
            <label>
              <span className="label">Año</span>
              <input
                className="input"
                value={anioBeca}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setAnioBeca(value);
                  precargarSiFiltroCompleto({ anioBeca: value });
                }}
                placeholder="Año"
              />
            </label>
            <label className="td-beca-filter">
              <span className="label">Programa a setear</span>
              <select
                className="input"
                value={programaBeca}
                onChange={(e) => {
                  setProgramaBeca(e.target.value);
                  precargarSiFiltroCompleto({ programaBeca: e.target.value });
                }}
              >
                <option value="TODAS">Todos los programas</option>
                {becaTipos.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}{tipo.total ? ` (${tipo.total})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="td-beca-filter">
              <span className="label">Dependencia</span>
              <select
                className="input"
                value={dependenciaId}
                onChange={(e) => {
                  setDependenciaId(e.target.value);
                  precargarSiFiltroCompleto({ dependenciaId: e.target.value });
                }}
              >
                <option value="TODAS">Todas las dependencias</option>
                {dependencias.map((dep) => (
                  <option key={dep.value} value={dep.value}>
                    {dep.label}{dep.total ? ` (${dep.total})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <div className="td-interinos-panel">
            <span className="td-pill ok">Ley 10430</span>
            <span className="td-pill ok">Activos</span>
            <span className="td-pill">Interino / no permanente</span>
          </div>
        )}
        <button className="btn primary" type="button" onClick={() => precargarDesdeBase()} disabled={preloading}>
          {preloading ? 'Precargando...' : poblacion === 'INTERINOS_10430' ? 'Precargar interinos' : 'Precargar agentes'}
        </button>
      </section>

      <section className="td-card">
        <div className="td-section-head">
          <div>
            <div className="h2">Agentes a designar</div>
            <div className="muted">Precarga desde base o carga manual</div>
          </div>
          <div className="td-section-actions">
            {expedienteModo === 'unico' ? (
              <button
                className="btn primary td-btn-compact"
                type="button"
                onClick={applyExpedienteUnicoToManual}
                disabled={!agentesSeteados.length || !expedienteUnico.trim()}
              >
                Cargar expediente a tildados
              </button>
            ) : null}
            <button className="btn primary td-btn-compact" type="button" onClick={openProvidencia} disabled={!agentesSeteados.length}>
              Providencia
            </button>
            <button className="btn td-btn-compact" type="button" onClick={() => setAllManualRows(true)} disabled={!manualRows.length}>Tildar</button>
            <button className="btn td-btn-compact" type="button" onClick={() => setAllManualRows(false)} disabled={!manualRows.length}>Destildar</button>
            <button className="btn td-btn-compact" type="button" onClick={() => setManualRows((rows) => [...rows, newManualRow()])}>+ Fila</button>
          </div>
        </div>

        <form onSubmit={submitManual} className="td-table-wrap">
          <table className="table td-table td-manual-table">
            <thead>
              <tr>
                <th>Incluye</th>
                <th>Cambio excep.</th>
                <th>DNI</th>
                <th>Apellido y nombre</th>
                <th>Fecha ingreso Excel</th>
                <th>Profesión / programa</th>
                <th>Expediente</th>
                <th>Escaneo</th>
              </tr>
            </thead>
            <tbody>
              {manualRows.map((row) => (
                <tr key={row.id}>
                  <td><input type="checkbox" checked={row.incluido} onChange={(e) => updateManual(row.id, { incluido: e.target.checked })} /></td>
                  <td><input type="checkbox" checked={Boolean(row.cambioExcepcional)} onChange={(e) => updateManual(row.id, { cambioExcepcional: e.target.checked })} /></td>
                  <td><input className="input" value={row.dni} onChange={(e) => updateManual(row.id, { dni: e.target.value.replace(/\D/g, '') })} /></td>
                  <td><input className="input" value={row.apellidoNombre} onChange={(e) => updateManual(row.id, { apellidoNombre: e.target.value })} /></td>
                  <td><input className="input" type="date" value={row.fechaIngresoExcel} onChange={(e) => updateManual(row.id, { fechaIngresoExcel: e.target.value })} /></td>
                  <td className="td-detail">
                    {[row.ocupacionNombre, row.tipoBeca || row.leyNombre, row.plantaNombre].filter(Boolean).join(' / ') || '-'}
                  </td>
                  <td><input className="input" value={row.expediente} onChange={(e) => updateManual(row.id, { expediente: e.target.value })} /></td>
                  <td>
                    <button className="btn td-btn-compact td-scan-action" type="button" onClick={() => openEscaneoAgente(row.dni)} disabled={!row.dni}>
                      Escanear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="td-actions">
            <button className="btn primary" type="submit">Setear listado</button>
          </div>
        </form>
      </section>

      <section className="td-card">
        <div className="td-section-head">
          <div>
            <div className="h2">Revisión por agente</div>
            <div className="muted">{pdfSummary.total} paquete(s), {pdfSummary.incluidos} PDF(s) tildados</div>
          </div>
          <div className="td-review-filters">
            <button className={reviewFilter === 'TODOS' ? 'td-filter active' : 'td-filter'} type="button" onClick={() => setReviewFilter('TODOS')}>Todos {pdfSummary.total}</button>
            <button className={reviewFilter === 'LISTOS' ? 'td-filter active' : 'td-filter'} type="button" onClick={() => setReviewFilter('LISTOS')}>Listos {pdfSummary.listos}</button>
            <button className={reviewFilter === 'REVISAR' ? 'td-filter active' : 'td-filter'} type="button" onClick={() => setReviewFilter('REVISAR')}>Revisar {pdfSummary.revisar}</button>
            <button className={reviewFilter === 'SIN_AGENTE' ? 'td-filter active' : 'td-filter'} type="button" onClick={() => setReviewFilter('SIN_AGENTE')}>Sin agente {pdfSummary.sinAgente}</button>
          </div>
        </div>

        <div className="td-agent-grid">
          {filteredPdfGroups.map((group) => (
            <div className={`td-agent-package ${group.status}`} key={group.key}>
              <div className="td-agent-main">
                <label className="td-agent-check">
                  <input
                    type="checkbox"
                    checked={group.rows.some((row) => row.incluido !== false)}
                    onChange={(e) => setGroupIncluded(group, e.target.checked)}
                  />
                </label>
                <div className="td-agent-info">
                  <div className="td-agent-name">{group.agenteNombre}</div>
                  <div className="muted">{group.dni ? `DNI ${group.dni}` : 'Completar DNI manual'} · {group.includedCount}/{group.rows.length} PDF(s) · {group.totalPages || '-'} pág.</div>
                  {renderCaratulaHint(group)}
                  {renderRupaHint(group)}
                </div>
                <span className={`td-agent-status ${group.status}`}>
                  {group.status === 'listo' ? 'Listo' : group.status === 'revisar' ? 'Revisar' : 'Sin agente'}
                </span>
                <div className="td-package-actions">
                  <button className="btn td-btn-compact" type="button" onClick={() => openPdf(group.rows[0], group.key)}>Ver paquete</button>
                  <button className="btn td-btn-compact" type="button" onClick={() => previewCombined(group)} disabled={previewingDni === group.dni || !group.dni || (!group.includedCount && !hasMergeableExtraForGroup(group))}>
                    {previewingDni === group.dni ? 'Preparando...' : 'Previsualizar combinado'}
                  </button>
                  <button className="btn primary td-btn-compact" type="button" onClick={() => saveDocuments(group.dni, documentOrderForGroup(group))} disabled={saving || !group.dni || (!group.includedCount && !hasMergeableExtraForGroup(group))}>
                    {pendingSaveDni === group.dni ? 'Combinando...' : 'Combinar agente'}
                  </button>
                </div>
              </div>
              <div className="td-package-files">
                {group.rows.map((row, idx) => (
                  <div className={row.incluido === false ? 'td-package-file-row off' : 'td-package-file-row'} key={row.fileName}>
                    <button className="td-package-file" type="button" onClick={() => openPdf(row, group.key)} title={row.fileName}>
                      {pdfItemLabel(row, idx)}
                    </button>
                  </div>
                ))}
                {hasCaratulaForGroup(group) ? (() => {
                  const caratula = caratulaForGroup(group);
                  return (
                    <div className="td-package-file-row" key={CARATULA_DOC_KEY}>
                      <button className="td-package-file" type="button" onClick={() => openExtraDoc('caratula', group)} title={caratula?.fileName || 'Carátula del combinado'}>
                        Carátula{caratula?.key ? ` - ${caratula.key}` : ''}{caratula?.pages ? ` - ${caratula.pages} pág.` : ''}
                      </button>
                    </div>
                  );
                })() : null}
                {hasRupaForGroup(group) ? (() => {
                  const rupa = extraDocForKey(group, RUPA_DOC_KEY);
                  return (
                    <div className="td-package-file-row" key={RUPA_DOC_KEY}>
                      <button className="td-package-file" type="button" onClick={() => openExtraDoc('rupa', group)} title={rupa?.fileName || 'RUPA desde G DOCU'}>
                        RUPA - {rupa?.pages || '-'} pág. - {bytesLabel(rupa?.bytes || 0)}
                      </button>
                    </div>
                  );
                })() : null}
              </div>
              {group.status !== 'listo' ? (
                <label className="td-group-dni">
                  <span>Corregir DNI del paquete</span>
                  <input
                    className="input td-package-dni"
                    value={group.dni || ''}
                    onChange={(e) => setGroupDni(group, e.target.value)}
                    placeholder="DNI"
                  />
                </label>
              ) : null}
              <details className="td-order-panel">
                <summary>Orden y páginas del combinado</summary>
                <div className="td-combined-pages">
                  <div className="td-combined-pages-head">
                    <span>Hojas finales del PDF combinado</span>
                    <button className="btn td-mini-btn" type="button" onClick={() => resetCombinedPages(group)} disabled={!hasCombinedPageEdits(group)}>
                      Restaurar
                    </button>
                  </div>
                  <div className="td-combined-page-list" aria-label="Orden final de hojas del combinado">
                    {orderedCombinedPageKeysForGroup(group).map((pageKey, pageIdx, keys) => {
                      const excluded = (combinedExcludedByGroup[group.key] || []).includes(pageKey);
                      return (
                        <button
                          key={pageKey}
                          type="button"
                          draggable
                          className={excluded ? 'td-combined-page-chip removed' : 'td-combined-page-chip selected'}
                          onClick={() => toggleCombinedPage(group, pageKey)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', String(pageIdx));
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            reorderCombinedByIndex(group, keys, Number(event.dataTransfer.getData('text/plain')), pageIdx);
                          }}
                          title={excluded ? 'Hoja excluida del combinado' : 'Hoja incluida. Arrastra para ordenar'}
                        >
                          {combinedPageLabel(group, pageKey, pageIdx)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="td-order-list">
                  {orderedDocKeysForGroup(group).map((key, idx, keys) => {
                    const extra = extraDocForKey(group, key);
                    const totalPages = docPageCountForKey(group, key);
                    const pageKey = pageOrderKeyFor(key, group);
                    const selectedPages = pagesFromOrder(pageOrderByDoc[pageKey], totalPages);
                    const selectedSet = new Set(selectedPages);
                    const pageSummary = pageOrderByDoc[pageKey]?.trim()
                      || (totalPages ? `Todas (${totalPages})` : '');
                    return (
                      <div className="td-order-row" key={key}>
                        <div className="td-order-move">
                          <button className="btn td-icon-btn" type="button" onClick={() => moveDocInGroup(group, key, -1)} disabled={idx === 0}>↑</button>
                          <button className="btn td-icon-btn" type="button" onClick={() => moveDocInGroup(group, key, 1)} disabled={idx === keys.length - 1}>↓</button>
                        </div>
                        <div className="td-order-name">{idx + 1}. {docLabelForKey(group, key)}</div>
                        <div className={extra?.found ? 'td-extra-status ok' : extra ? 'td-extra-status bad' : 'td-extra-status'}>
                          {extra?.found ? `${extra.fileName || 'Encontrado'} - ${extra.pages || '-'} pág. - ${bytesLabel(extra.bytes || 0)}` : extra?.reason || ''}
                          {extra?.found && key === RUPA_DOC_KEY ? (
                            <button className="btn td-mini-btn" type="button" onClick={() => openExtraDoc('rupa', group)}>Ver</button>
                          ) : null}
                        </div>
                        <div className="td-page-picker">
                          {totalPages ? (
                            <>
                              <div className="td-page-picker-head">
                                <span>Hojas: {pageSummary}</span>
                                <button className="btn td-mini-btn" type="button" onClick={() => resetDocPages(group, key)} disabled={!pageOrderByDoc[pageKey]}>
                                  Todas
                                </button>
                              </div>
                              <div className="td-page-chip-list" aria-label="Elegir hojas a combinar">
                                {Array.from({ length: totalPages }, (_, pageIndex) => {
                                  const page = pageIndex + 1;
                                  const selected = selectedSet.has(page);
                                  return (
                                    <button
                                      key={page}
                                      type="button"
                                      className={selected ? 'td-page-chip selected' : 'td-page-chip removed'}
                                      onClick={() => toggleDocPage(group, key, page)}
                                      title={selected ? `Hoja ${page} incluida` : `Hoja ${page} excluida`}
                                    >
                                      {page}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          ) : (
                            <span className="td-page-picker-empty">Sin conteo de hojas</span>
                          )}
                        </div>
                        <input
                          className="input td-page-order"
                          value={pageOrderByDoc[pageOrderKeyFor(key, group)] || ''}
                          onChange={(e) => updateDocPageOrder(group, key, e.target.value)}
                          placeholder="Páginas: 1-3,5"
                        />
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          ))}
          {!filteredPdfGroups.length ? (
            <div className="td-empty">Sin paquetes para mostrar.</div>
          ) : null}
        </div>

        <div className="td-combine-bar">
          <div>
            <div className="h2">Combinado masivo</div>
            <div className="muted">Combina todos los paquetes tildados con DNI cargado</div>
          </div>
          <button className="btn primary td-combine-btn" type="button" onClick={() => saveDocuments()} disabled={saving || !analysisRows.length}>
            {saving ? 'Combinando...' : 'Combinar paquetes tildados'}
          </button>
        </div>
      </section>

      <section className="td-card">
        <div className="td-section-head">
          <div>
            <div className="h2">Detalle técnico de PDFs</div>
            <div className="muted">{analysisRows.length} archivo(s)</div>
          </div>
          <div className="td-section-actions">
            <button className="btn td-btn-compact" type="button" onClick={() => setAllAnalysisRows(true)} disabled={!analysisRows.length}>Tildar</button>
            <button className="btn td-btn-compact" type="button" onClick={() => setAllAnalysisRows(false)} disabled={!analysisRows.length}>Destildar</button>
          </div>
        </div>

        <div className="td-table-wrap">
          <table className="table td-table td-pdf-table">
            <thead>
              <tr>
                <th>Incluye</th>
                <th>PDF</th>
                <th>Agente detectado</th>
                <th>DNI manual</th>
                <th>Páginas</th>
                <th>Tamaño</th>
                <th>Lectura</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {analysisRows.map((row) => (
                <tr key={row.fileName}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.incluido !== false}
                      onChange={(e) => updateAnalysis(row.fileName, { incluido: e.target.checked })}
                    />
                  </td>
                  <td className="td-file">{row.fileName}</td>
                  <td>{row.agente ? `${row.agente.apellido}, ${row.agente.nombre}` : '-'}</td>
                  <td>
                    <input
                      className="input"
                      value={row.manualDni || ''}
                      onChange={(e) => updateAnalysis(row.fileName, { manualDni: e.target.value.replace(/\D/g, '') })}
                      placeholder="DNI"
                    />
                  </td>
                  <td>{row.pages || '-'}</td>
                  <td>{bytesLabel(row.bytes)}</td>
                  <td><span className={`td-status ${row.lectura}`}>{lecturaLabel(row.lectura)}</span></td>
                  <td><span className={`td-status ${row.status}`}>{statusLabel(row.status)}</span></td>
                  <td><button className="btn td-btn-compact td-view-action" type="button" onClick={() => openPdf(row)}>Ver PDF</button></td>
                </tr>
              ))}
              {!analysisRows.length ? (
                <tr><td colSpan={9} className="td-empty">Sin análisis cargado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {savedResults.length ? (
        <section className="td-card">
          <div className="h2">Guardado</div>
          <div className="td-save-list">
            {savedResults.map((item) => (
              <div className="td-save-item" key={`${item.dni}-${item.folder}`}>
                <div><b>DNI {item.dni}</b> - {item.tramite}</div>
                <div className="muted">{item.folder}</div>
                <div className="muted">
                  {item.folderExisted ? 'Carpeta del año existente' : 'Carpeta del año creada'} - combinado {item.combinedReemplazado ? 'reemplazado' : 'creado'}: {item.combined || '-'}
                </div>
                {item.skipped?.length ? (
                  <div className="td-skip-list">
                    {item.skipped.map((skipped: any, idx: number) => (
                      <div key={`${item.dni}-skip-${idx}`}>{skipped.source}: {skipped.reason}</div>
                    ))}
                  </div>
                ) : null}
                <div className="td-save-actions">
                  <div className="muted">
                    Documento registrado: {item.documento?.id || '-'} · Expediente en Gestión: {item.expedienteRegistro?.id ? (item.expedienteRegistro.created ? 'creado' : 'existente') : '-'}
                  </div>
                  <button className="btn td-btn-compact" type="button" onClick={() => openSavedPdf(item)} disabled={!item.documento?.fileUrl && !item.combinedFileUrl}>
                    Ver combinado
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {providenciaOpen ? (
        <div className="td-modal-backdrop" onClick={() => setProvidenciaOpen(false)}>
          <div className="td-modal td-providencia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="td-modal-head">
              <div>
                <div className="h2">Providencia de designacion</div>
                <div className="muted">{agentesSeteados.length} agente(s) seleccionados</div>
              </div>
              <button className="btn" type="button" onClick={() => setProvidenciaOpen(false)}>Cerrar</button>
            </div>
            <div className="td-providencia-body">
              <aside className="td-providencia-side">
                <div className="td-eyebrow">Completar</div>
                <label>
                  <span className="label">Lugar y fecha</span>
                  <input className="input" value={providenciaLugarFecha} onChange={(e) => setProvidenciaLugarFecha(e.target.value)} />
                </label>
                <label>
                  <span className="label">Ley (por defecto)</span>
                  <select className="input" value={providenciaLey} onChange={(e) => setProvidenciaLey(e.target.value as ProvidenciaLey)}>
                    <option value="10471">10471</option>
                    <option value="10430">10430</option>
                  </select>
                </label>
                {providenciaLey === '10471' ? (
                  <label>
                    <span className="label">Regimen 10471</span>
                    <select className="input" value={providenciaRegimen10471} onChange={(e) => setProvidenciaRegimen10471(e.target.value as ProvidenciaRegimen10471)}>
                      <option value="planta">36 horas semanales planta</option>
                      <option value="guardia">36 horas semanales guardia</option>
                    </select>
                  </label>
                ) : (
                  <div className="td-providencia-note">Para 10430 se imprime con 48 horas semanales de labor.</div>
                )}
                <button className="btn" type="button" onClick={aplicarLeyRegimenATodos}>Aplicar a todos</button>
                <div className="td-providencia-note">
                  La ley se asigna automaticamente por profesion (profesionales de salud → 10471, resto → 10430)
                  y se puede corregir por fila en la tabla. Se usan solo los agentes tildados en la grilla; la tabla no incluye expediente.
                </div>
              </aside>
              <section className="td-providencia-sheet">
                <div className="td-providencia-date">{providenciaLugarFecha}</div>
                {providenciaGrupos().map((grupo) => (
                  <div key={grupo.ley} className="td-providencia-grupo">
                    <p>{providenciaIntroGrupo(grupo)}</p>
                    <table>
                      <thead>
                        <tr>
                          <th>N°</th>
                          <th>Apellido y nombre</th>
                          <th>DNI</th>
                          <th>Cargo / profesion</th>
                          <th>Ley</th>
                          <th>Regimen horario</th>
                          <th>Dependencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupo.rows.map((row) => (
                          <tr key={row.id}>
                            <td>{row.numero}</td>
                            <td>{row.apellidoNombre}</td>
                            <td>{row.dni}</td>
                            <td>{row.cargo}</td>
                            <td>
                              <select
                                className="td-providencia-cell-select"
                                style={{ color: '#111', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 4, padding: '1px 4px', fontWeight: 700 }}
                                value={row.ley}
                                onChange={(e) => updateManual(row.id, { leyOverride: e.target.value as ProvidenciaLey })}
                              >
                                <option value="10471">10471</option>
                                <option value="10430">10430</option>
                              </select>
                            </td>
                            <td>
                              {row.ley === '10471' ? (
                                <select
                                  className="td-providencia-cell-select"
                                  style={{ color: '#111', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 4, padding: '1px 4px' }}
                                  value={row.regimen10471}
                                  onChange={(e) => updateManual(row.id, { regimen10471Override: e.target.value as ProvidenciaRegimen10471 })}
                                >
                                  <option value="planta">36 horas semanales planta</option>
                                  <option value="guardia">36 horas semanales guardia</option>
                                </select>
                              ) : (
                                <span>48 horas semanales de labor</span>
                              )}
                            </td>
                            <td>{row.dependencia}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {providenciaAclaraciones().length > 0 ? (
                  <div className="td-providencia-aclaraciones">
                    <p><strong>Aclaraciones:</strong></p>
                    {providenciaAclaraciones().map((a, idx) => (
                      <p key={idx}>{a}</p>
                    ))}
                  </div>
                ) : null}
              </section>
            </div>
            <div className="td-providencia-actions">
              <button className="btn primary" type="button" onClick={copyProvidenciaText}>Copiar texto</button>
              <button className="btn primary" type="button" onClick={downloadProvidenciaDocx}>Descargar DOCX</button>
              <button className="btn" type="button" onClick={() => window.print()}>Imprimir</button>
              <button className="btn" type="button" onClick={() => setProvidenciaOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div className="td-modal-backdrop" onClick={() => { revokeModalUrl(); setModal(null); }}>
          <div className="td-modal" onClick={(e) => e.stopPropagation()}>
            <div className="td-modal-head">
              <div>
                <div className="h2">{modalTitle}</div>
                <div className="muted">{modalSubtitle}</div>
              </div>
              <div className="td-modal-actions">
                <button className="btn" type="button" onClick={() => navigatePdf(-1)} disabled={modalScopeRows.length < 2}>Anterior</button>
                <button className="btn" type="button" onClick={() => navigatePdf(1)} disabled={modalScopeRows.length < 2}>Siguiente</button>
                <button className="btn" type="button" onClick={() => { revokeModalUrl(); setModal(null); }}>Cerrar</button>
              </div>
            </div>
            <div className={isCombinedPreviewModal ? 'td-modal-body td-modal-combined' : modalScopeRows.length > 1 ? 'td-modal-body' : 'td-modal-body full'}>
              {isCombinedPreviewModal && modalGroup ? (
                <div className="td-modal-editor">
                  <div className="td-modal-editor-head">
                    <div>
                      <div className="h2">Editar hojas</div>
                      <div className="muted">Tilda para incluir. Usa flechas o arrastra para ordenar.</div>
                    </div>
                    <button className="btn td-mini-btn" type="button" onClick={() => resetCombinedPages(modalGroup)} disabled={!hasCombinedPageEdits(modalGroup)}>
                      Restaurar
                    </button>
                  </div>
                  <div className="td-modal-page-list">
                    {orderedCombinedPageKeysForGroup(modalGroup).map((pageKey, pageIdx, keys) => {
                      const excluded = (combinedExcludedByGroup[modalGroup.key] || []).includes(pageKey);
                      return (
                        <div
                          className={excluded ? 'td-modal-page-row removed' : 'td-modal-page-row'}
                          key={pageKey}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', String(pageIdx));
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            reorderCombinedByIndex(modalGroup, keys, Number(event.dataTransfer.getData('text/plain')), pageIdx);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!excluded}
                            onChange={() => toggleCombinedPage(modalGroup, pageKey)}
                            title={excluded ? 'Volver a incluir hoja' : 'Excluir hoja del combinado'}
                          />
                          <span title={combinedPageLabel(modalGroup, pageKey, pageIdx)}>
                            {combinedPageLabel(modalGroup, pageKey, pageIdx)}
                          </span>
                          <div className="td-modal-page-actions">
                            <button className="btn td-icon-btn" type="button" onClick={() => reorderCombinedByIndex(modalGroup, keys, pageIdx, pageIdx - 1)} disabled={pageIdx === 0}>^</button>
                            <button className="btn td-icon-btn" type="button" onClick={() => reorderCombinedByIndex(modalGroup, keys, pageIdx, pageIdx + 1)} disabled={pageIdx === keys.length - 1}>v</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="td-modal-editor-actions">
                    <button className="btn primary" type="button" onClick={() => previewCombined(modalGroup)} disabled={previewingDni === modalGroup.dni}>
                      {previewingDni === modalGroup.dni ? 'Actualizando...' : 'Actualizar preview'}
                    </button>
                    <button className="btn" type="button" onClick={() => saveDocuments(modalGroup.dni, documentOrderForGroup(modalGroup))} disabled={saving || !modalGroup.dni}>
                      Combinar agente
                    </button>
                  </div>
                </div>
              ) : modalScopeRows.length + modalExtras.length > 1 ? (
                <div className="td-modal-list">
                  {modalScopeRows.map((row, idx) => (
                    <button
                      key={row.fileName}
                      className={row.fileName === (modal.currentFileName || modal.title) ? 'td-modal-list-item active' : 'td-modal-list-item'}
                      type="button"
                      onClick={() => openPdf(row, modal.groupKey)}
                      title={row.fileName}
                    >
                      <span>{pdfItemLabel(row, idx)}</span>
                      <small>{dniFromAnalysis(row) || 'sin DNI'}</small>
                    </button>
                  ))}
                  {modalGroup ? modalExtras.map((extraKey) => {
                    const info = extraKey === RUPA_DOC_KEY ? extraDocForKey(modalGroup, RUPA_DOC_KEY) : null;
                    const label = extraKey === RUPA_DOC_KEY
                      ? `RUPA - ${info?.pages || '-'} pág.`
                      : 'Carátula';
                    return (
                      <button
                        key={extraKey}
                        className={modal.currentFileName === extraKey ? 'td-modal-list-item active' : 'td-modal-list-item'}
                        type="button"
                        onClick={() => openExtraDoc(extraKey === RUPA_DOC_KEY ? 'rupa' : 'caratula', modalGroup)}
                        title={label}
                      >
                        <span>{label}</span>
                        <small>{extraKey === RUPA_DOC_KEY ? 'G DOCU' : 'adjunto'}</small>
                      </button>
                    );
                  }) : null}
                </div>
              ) : null}
              <iframe title="pdf-tramite" src={modal.url} className="td-pdf-frame" />
            </div>
          </div>
        </div>
      ) : null}
      </>)}
    </Layout>
  );
}
