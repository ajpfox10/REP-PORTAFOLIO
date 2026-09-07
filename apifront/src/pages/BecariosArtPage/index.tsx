// src/pages/BecariosArtPage/index.tsx
// Alta de agentes becarios en ART.
// Panel izquierdo: becarios activos no registrados → selección + ingreso de página ART.
// Panel derecho:  becarios ya registrados → tabla con todos los datos incluyendo dirección.

import React, { useState, useCallback, useEffect } from 'react';
import { Layout }   from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

// ─── tipos ───────────────────────────────────────────────────────────────────

interface Candidato {
  dni:              number;
  apellido:         string;
  nombre:           string;
  legajo:           number | null;
  ley_nombre:       string | null;
  cuil:             string | null;
  telefono:         string | null;
  fecha_nacimiento: string | null;
  establecimiento:  string | null;
  direccion:        string | null;
  // Validación de dirección para ART (calculada en el backend)
  art_listo?:            boolean;
  art_faltan?:           string[];
  art_fuente_direccion?: 'personal' | 'excel' | null;
  // Estado de la cola de alta automática en ART
  art_status?:    'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR' | 'SKIPPED' | null;
  art_error?:     string | null;
  art_resultado?: string | null;
  art_attempts?:  number | null;
}

interface Direccion {
  calle:             string | null;
  numero:            string | null;
  piso:              string | null;
  departamento:      string | null;
  localidad:         string | null;
  codigo_postal:     string | null;
  otras_referencias: string | null;
  dependencia:       string | null;
}

interface Registrado {
  id:                    number;
  dni:                   number;
  apellido:              string;
  nombre:                string;
  legajo:                number | null;
  pagina:                string;
  origen_art:            'manual' | 'automatico' | null;
  creado_por:            number | null;
  creado_por_nombre:     string | null;
  actualizado_por:       number | null;
  actualizado_por_nombre: string | null;
  created_at:            string;
  updated_at:            string;
  direccion:             Direccion | null;
}

interface ErrorArt {
  dni:        number;
  motivo:     string | null;
  detalle:    string | null;
  screenshot: string | null;
  lote:       string | null;
  updated_at: string;
  apellido:   string | null;
  nombre:     string | null;
  cuil:       string | null;
  legajo:     number | null;
  ley_nombre: string | null;
}

// Fila de la cola de alta automática (art_alta_queue). Trae el error REAL del script,
// incluidos los crashes que nunca llegan a becarios_art_errores.
interface ColaItem {
  id:            number;
  dni:           number;
  status:        'PENDING' | 'PROCESSING' | 'DONE' | 'ERROR' | 'SKIPPED';
  attempts:      number | null;
  last_error:    string | null;
  resultado_art: string | null;
  created_at:    string;
  updated_at:    string;
  apellido:      string | null;
  nombre:        string | null;
  legajo:        number | null;
  ley_nombre:    string | null;
}

// ─── badges de estado ART por candidato ──────────────────────────────────────
function ArtBadges({ cand }: { cand: Candidato }) {
  const chip = (bg: string, color: string, text: string, title?: string) => (
    <span title={title} style={{ background: bg, color, borderRadius: 4, padding: '2px 8px',
      fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' as const }}>{text}</span>
  );
  const st = cand.art_status;
  const estado =
    st === 'DONE'       ? chip('rgba(34,197,94,0.15)',  '#4ade80', '✅ Cargado en ART') :
    st === 'ERROR'      ? chip('rgba(239,68,68,0.15)',  '#f87171', '❌ Error en ART', cand.art_error || undefined) :
    st === 'PROCESSING' ? chip('rgba(59,130,246,0.15)', '#93c5fd', '⏳ Procesando') :
    st === 'PENDING'    ? chip('rgba(148,163,184,0.15)','#cbd5e1', '🕓 En cola') :
    st === 'SKIPPED'    ? chip('rgba(148,163,184,0.15)','#cbd5e1', '⤼ Omitido') :
    null;

  const validacion =
    cand.art_listo === false
      ? chip('rgba(239,68,68,0.15)', '#f87171', `⚠ Faltan: ${(cand.art_faltan || []).join(', ')}`)
      : cand.art_listo === true
        ? chip('rgba(34,197,94,0.12)', '#4ade80', '✓ Datos completos')
        : null;

  const fuente = cand.art_fuente_direccion
    ? <span style={{ fontSize: '0.66rem', color: '#64748b' }}>dir: {cand.art_fuente_direccion}</span>
    : null;

  if (!estado && !validacion) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' }}>
      {estado}
      {validacion}
      {fuente}
      {st === 'ERROR' && cand.art_error && (
        <span style={{ fontSize: '0.68rem', color: '#fca5a5', width: '100%' }}>{cand.art_error}</span>
      )}
    </div>
  );
}

// ─── estilos ─────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  wrap:       { display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' as const },
  panel:      { flex: '1 1 340px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18 },
  panelTitle: { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'rgba(255,255,255,0.5)', marginBottom: 14 },
  label:      { fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:      { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '6px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.84rem' },
  btn:        { cursor: 'pointer', borderRadius: 8, padding: '7px 16px', fontWeight: 600, fontSize: '0.82rem', border: 'none' },
  row:        { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, marginBottom: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' },
  rowSel:     { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, marginBottom: 6, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.35)' },
  name:       { flex: 1, fontSize: '0.84rem', color: '#e2e8f0' },
  sub:        { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' },
  pagInput:   { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 8px', width: 72, fontSize: '0.82rem', textAlign: 'center' as const },
  th:         { padding: '5px 8px', textAlign: 'left' as const, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' as const, color: '#94a3b8', whiteSpace: 'nowrap' as const, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td:         { padding: '6px 8px', fontSize: '0.78rem', verticalAlign: 'top' as const, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  badge:      { display: 'inline-block', borderRadius: 4, padding: '2px 7px', fontSize: '0.7rem', fontWeight: 700, background: '#1e3a8a', color: '#93c5fd' },
  empty:      { color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', padding: '18px 0', textAlign: 'center' as const },
  searchWrap: { display: 'flex', gap: 8, marginBottom: 12 },
  tabs:       { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' as const },
  tab:        { cursor: 'pointer', borderRadius: 6, padding: '6px 11px', fontWeight: 700, fontSize: '0.76rem', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8' },
  tabActive:  { background: '#1d4ed8', color: '#fff', borderColor: '#2563eb' },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(dt?: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function copiar(texto: string, toast: any) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(texto).then(
      () => toast.ok('Copiado', texto),
      () => toast.error('No se pudo copiar')
    );
  } else {
    // Fallback para HTTP (sin HTTPS)
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      toast.ok('Copiado', texto);
    } catch {
      toast.error('No se pudo copiar');
    }
    document.body.removeChild(ta);
  }
}

function CopyChip({ label, value, toast }: { label: string; value: string | null | undefined; toast: any }) {
  if (!value) return <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)' }}>—</span>;
  return (
    <span
      title={`Copiar ${label}`}
      onClick={() => copiar(value, toast)}
      style={{
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 5, padding: '2px 7px', fontSize: '0.72rem', color: '#cbd5e1',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span>{value}</span>
      <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>⎘</span>
    </span>
  );
}

function dirStr(d: Direccion | null): string {
  if (!d) return '—';
  const partes: string[] = [];
  if (d.calle)     partes.push(d.calle + (d.numero ? ' ' + d.numero : ''));
  if (d.piso)      partes.push('Piso ' + d.piso + (d.departamento ? ' Dpto ' + d.departamento : ''));
  if (d.localidad) partes.push(d.localidad + (d.codigo_postal ? ' (' + d.codigo_postal + ')' : ''));
  return partes.join(' – ') || '—';
}

// Clasificación del motivo de error para poder filtrar. Orden = prioridad.
const CATEGORIAS_ERROR: { label: string; test: RegExp }[] = [
  { label: 'Establecimiento', test: /establecimiento|debe cargar/i },
  { label: 'CUIL',            test: /c\.?u\.?i\.?l|cuil/i },
  { label: 'Localidad',       test: /localidad|cblocalidad|no se pudo seleccionar/i },
  { label: 'Teléfono',        test: /tel[eé]fono|debe tener\s*\d+\s*d[ií]git/i },
  { label: 'Código Postal',   test: /c[oó]digo postal|no corresponde/i },
  { label: 'Domicilio',       test: /calle|domicilio/i },
  { label: 'Red / Timeout',   test: /page\.goto|navigation|net::|timeout|networkidle/i },
];

function categoriaError(motivo: string | null): string {
  const m = motivo ?? '';
  for (const c of CATEGORIAS_ERROR) if (c.test.test(m)) return c.label;
  return 'Otro';
}

// ─── componente ──────────────────────────────────────────────────────────────

export function BecariosArtPage() {
  const toast = useToast();

  // candidatos (becarios activos sin registrar)
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loadingCand, setLoadingCand]   = useState(false);
  const [searchCand, setSearchCand]     = useState('');

  // páginas ART editadas inline para cada candidato (dni → pagina)
  const [paginas, setPaginas] = useState<Record<number, string>>({});
  // registrando (dni → true mientras el POST está en vuelo)
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  // registrados en ART
  const [registrados, setRegistrados]   = useState<Registrado[]>([]);
  const [loadingReg, setLoadingReg]     = useState(false);
  const [searchReg, setSearchReg]       = useState('');
  const [tabReg, setTabReg]             = useState<'todos' | 'automaticos'>('todos');

  // detalle de dirección expandido (id del registro)
  const [expandDir, setExpandDir]       = useState<number | null>(null);

  // editar pagina inline (id → nuevo valor)
  const [editPag, setEditPag]           = useState<Record<number, string>>({});
  const [savingPag, setSavingPag]       = useState<Record<number, boolean>>({});

  // errores de la carga automática ART
  const [errores, setErrores]           = useState<ErrorArt[]>([]);
  const [loadingErr, setLoadingErr]     = useState(false);
  const [resolviendo, setResolviendo]   = useState<Record<number, boolean>>({});
  const [filtroErr, setFiltroErr]       = useState<string>('todos');

  // cola de alta automática (art_alta_queue): estado + error real por agente
  const [cola, setCola]                 = useState<ColaItem[]>([]);
  const [colaResumen, setColaResumen]   = useState<Record<string, number>>({});
  const [reencolando, setReencolando]   = useState<Record<number, boolean>>({});

  // ── carga ─────────────────────────────────────────────────────────────────

  const loadCandidatos = useCallback(async () => {
    setLoadingCand(true);
    try {
      const res = await apiFetch<any>('/becarios-art/candidatos');
      setCandidatos(Array.isArray(res?.data) ? res.data : []);
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudieron cargar los candidatos');
    } finally {
      setLoadingCand(false);
    }
  }, []);

  const loadRegistrados = useCallback(async () => {
    setLoadingReg(true);
    try {
      const res = await apiFetch<any>('/becarios-art');
      setRegistrados(Array.isArray(res?.data) ? res.data : []);
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudieron cargar los registrados');
    } finally {
      setLoadingReg(false);
    }
  }, []);

  const loadErrores = useCallback(async () => {
    setLoadingErr(true);
    try {
      const res = await apiFetch<any>('/becarios-art/errores');
      setErrores(Array.isArray(res?.data) ? res.data : []);
    } catch (e: any) {
      // no molestamos con toast si falla (tabla puede no existir aún)
      setErrores([]);
    } finally {
      setLoadingErr(false);
    }
  }, []);

  const loadCola = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/becarios-art/cola');
      setCola(Array.isArray(res?.data) ? res.data : []);
      setColaResumen(res?.resumen && typeof res.resumen === 'object' ? res.resumen : {});
    } catch {
      // sin toast: la tabla puede no existir aún
      setCola([]);
      setColaResumen({});
    }
  }, []);

  useEffect(() => {
    loadCandidatos();
    loadRegistrados();
    loadErrores();
    loadCola();
  }, [loadCandidatos, loadRegistrados, loadErrores, loadCola]);

  // ── acciones ──────────────────────────────────────────────────────────────

  const handleRegistrar = useCallback(async (cand: Candidato) => {
    setSaving(prev => ({ ...prev, [cand.dni]: true }));
    try {
      await apiFetch('/becarios-art', { method: 'POST', body: JSON.stringify({ dni: cand.dni, pagina: '' }) });
      toast.ok('Registrado', `${cand.apellido}, ${cand.nombre} dado de alta en ART`);
      setPaginas(prev => { const n = { ...prev }; delete n[cand.dni]; return n; });
      await Promise.all([loadCandidatos(), loadRegistrados()]);
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudo registrar');
    } finally {
      setSaving(prev => ({ ...prev, [cand.dni]: false }));
    }
  }, [paginas, loadCandidatos, loadRegistrados]);

  const handleActualizarPagina = useCallback(async (reg: Registrado) => {
    const nueva = (editPag[reg.id] ?? reg.pagina).trim();
    if (!nueva) return;
    setSavingPag(prev => ({ ...prev, [reg.id]: true }));
    try {
      await apiFetch(`/becarios-art/${reg.dni}`, { method: 'PATCH', body: JSON.stringify({ pagina: nueva }) });
      toast.ok('Actualizado', 'Página ART actualizada');
      setEditPag(prev => { const n = { ...prev }; delete n[reg.id]; return n; });
      await loadRegistrados();
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudo actualizar');
    } finally {
      setSavingPag(prev => ({ ...prev, [reg.id]: false }));
    }
  }, [editPag, loadRegistrados]);

  const handleEliminar = useCallback(async (reg: Registrado) => {
    if (!window.confirm(`¿Dar de baja a ${reg.apellido}, ${reg.nombre} del registro ART?`)) return;
    try {
      await apiFetch(`/becarios-art/${reg.dni}`, { method: 'DELETE' });
      toast.ok('Eliminado', 'Registro dado de baja');
      await Promise.all([loadCandidatos(), loadRegistrados()]);
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudo eliminar');
    }
  }, [loadCandidatos, loadRegistrados]);

  // "Cargar": encola el alta ART para ese DNI. NO corre el navegador en el server (headless
  // bajo pm2 falla el menú): lo procesa el worker de escritorio con Chrome visible. El error
  // se quita solo cuando el worker completa el alta (refrescar la lista para verlo).
  const handleResolverError = useCallback(async (err: ErrorArt) => {
    setResolviendo(prev => ({ ...prev, [err.dni]: true }));
    try {
      const res = await apiFetch<any>(`/becarios-art/errores/${err.dni}/reintentar`, { method: 'POST' });
      if (res?.ok) {
        toast.ok('Encolado', `${err.apellido ?? err.dni} quedó en cola. Lo procesa el worker (Chrome visible).`);
      } else {
        toast.error('No se encoló', res?.error ?? 'No se pudo encolar');
      }
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudo encolar la carga');
    } finally {
      setResolviendo(prev => ({ ...prev, [err.dni]: false }));
    }
  }, [toast]);

  // Reencolar una fila de la cola (resetea a PENDING vía el mismo endpoint que "Cargar").
  const handleReencolarCola = useCallback(async (item: ColaItem) => {
    setReencolando(prev => ({ ...prev, [item.dni]: true }));
    try {
      const res = await apiFetch<any>(`/becarios-art/errores/${item.dni}/reintentar`, { method: 'POST' });
      if (res?.ok) {
        const quien = item.apellido ? `${item.apellido}, ${item.nombre ?? ''}` : String(item.dni);
        toast.ok('Reencolado', `${quien} quedó en cola. El worker lo reintenta en el próximo ciclo.`);
        await loadCola();
      } else {
        toast.error('No se reencoló', res?.error ?? 'No se pudo reencolar');
      }
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'No se pudo reencolar');
    } finally {
      setReencolando(prev => ({ ...prev, [item.dni]: false }));
    }
  }, [toast, loadCola]);

  // ── filtros ───────────────────────────────────────────────────────────────

  const candFiltrados = candidatos.filter(c => {
    if (!searchCand) return true;
    const q = searchCand.toLowerCase();
    return (
      c.apellido.toLowerCase().includes(q) ||
      c.nombre.toLowerCase().includes(q) ||
      String(c.dni).includes(q) ||
      String(c.legajo ?? '').includes(q)
    );
  });

  const registradosAutomaticos = registrados.filter(r => r.origen_art === 'automatico');
  const regBase = tabReg === 'automaticos' ? registradosAutomaticos : registrados;

  const regFiltrados = regBase.filter(r => {
    if (!searchReg) return true;
    const q = searchReg.toLowerCase();
    return (
      r.apellido.toLowerCase().includes(q) ||
      r.nombre.toLowerCase().includes(q) ||
      String(r.dni).includes(q) ||
      String(r.legajo ?? '').includes(q) ||
      r.pagina.toLowerCase().includes(q)
    );
  });

  // errores clasificados por categoría + filtro
  const erroresPorCat: Record<string, number> = {};
  for (const e of errores) { const c = categoriaError(e.motivo); erroresPorCat[c] = (erroresPorCat[c] || 0) + 1; }
  const catsPresentes = CATEGORIAS_ERROR.map(c => c.label).filter(l => erroresPorCat[l]).concat(erroresPorCat['Otro'] ? ['Otro'] : []);
  const erroresFiltrados = filtroErr === 'todos' ? errores : errores.filter(e => categoriaError(e.motivo) === filtroErr);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Layout title="Carga de ART">
      <div style={{ padding: '24px 20px', maxWidth: 1400, margin: '0 auto' }}>

        {/* Encabezado */}
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
            Carga de ART
          </h1>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>
            Alta de agentes en ART: pendientes, registrados y errores de la carga automática.
          </p>
        </div>

        {/* ── Estado de la cola de carga automática (art_alta_queue) ─────────── */}
        {(cola.length > 0 || Object.keys(colaResumen).length > 0) && (
          <div style={{ ...S.panel, marginBottom: 20 }}>
            <div style={{ ...S.panelTitle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Carga automática en ART (cola)</span>
              <button style={{ ...S.btn, background: '#334155', color: '#94a3b8', padding: '4px 10px' }} onClick={loadCola} title="Recargar">
                ↺
              </button>
            </div>

            {/* Resumen por estado */}
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: cola.length > 0 ? 14 : 0 }}>
              {([
                ['DONE',       'Cargados',   'rgba(34,197,94,0.15)',  '#4ade80'],
                ['PENDING',    'En cola',    'rgba(148,163,184,0.15)','#cbd5e1'],
                ['PROCESSING', 'Procesando', 'rgba(59,130,246,0.15)', '#93c5fd'],
                ['ERROR',      'Con error',  'rgba(239,68,68,0.15)',  '#f87171'],
                ['SKIPPED',    'Omitidos',   'rgba(148,163,184,0.12)','#cbd5e1'],
              ] as const).map(([key, label, bg, color]) => (
                <span key={key} style={{ background: bg, color, borderRadius: 6, padding: '4px 10px', fontSize: '0.74rem', fontWeight: 600 }}>
                  {label}: {colaResumen[key] ?? 0}
                </span>
              ))}
            </div>

            {cola.length === 0 ? (
              <div style={{ ...S.empty, padding: '10px 0' }}>Sin agentes pendientes ni con error en la cola.</div>
            ) : (
              <div style={{ overflowX: 'auto' as const }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Apellido y nombre</th>
                      <th style={S.th}>DNI</th>
                      <th style={S.th}>Ley</th>
                      <th style={S.th}>Estado</th>
                      <th style={S.th}>Intentos</th>
                      <th style={S.th}>Error informado</th>
                      <th style={S.th}>Actualizado</th>
                      <th style={S.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cola.map(item => {
                      const st = item.status;
                      const stChip =
                        st === 'ERROR'      ? ['rgba(239,68,68,0.15)',  '#f87171', '❌ Error'] :
                        st === 'PROCESSING' ? ['rgba(59,130,246,0.15)', '#93c5fd', '⏳ Procesando'] :
                        st === 'PENDING'    ? ['rgba(148,163,184,0.15)','#cbd5e1', '🕓 En cola'] :
                        st === 'SKIPPED'    ? ['rgba(148,163,184,0.12)','#cbd5e1', '⤼ Omitido'] :
                                              ['rgba(34,197,94,0.15)',  '#4ade80', '✅ Cargado'];
                      return (
                        <tr key={item.id}>
                          <td style={{ ...S.td, fontWeight: 600 }}>
                            {item.apellido ? `${item.apellido}, ${item.nombre ?? ''}` : '—'}
                          </td>
                          <td style={S.td}><CopyChip label="DNI" value={String(item.dni)} toast={toast} /></td>
                          <td style={{ ...S.td, fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>{item.ley_nombre ?? '—'}</td>
                          <td style={S.td}>
                            <span style={{ background: stChip[0], color: stChip[1], borderRadius: 4, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' as const }}>
                              {stChip[2]}
                            </span>
                          </td>
                          <td style={{ ...S.td, textAlign: 'center' as const, color: (item.attempts ?? 0) >= 3 ? '#f87171' : undefined }}>
                            {item.attempts ?? 0}
                          </td>
                          <td style={{ ...S.td, color: item.last_error ? '#fca5a5' : 'rgba(255,255,255,0.3)', maxWidth: 460, fontSize: '0.74rem', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }} title={item.last_error ?? undefined}>
                            {item.last_error ? item.last_error.slice(0, 300) : (st === 'DONE' ? (item.resultado_art ?? '—') : '—')}
                          </td>
                          <td style={{ ...S.td, fontSize: '0.72rem', whiteSpace: 'nowrap' as const, color: 'rgba(255,255,255,0.4)' }}>
                            {fmt(item.updated_at)}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right' as const }}>
                            {st !== 'PROCESSING' && (
                              <button
                                style={{ ...S.btn, padding: '3px 10px', background: '#166534', color: '#4ade80', fontSize: '0.72rem', opacity: reencolando[item.dni] ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
                                onClick={() => handleReencolarCola(item)}
                                disabled={reencolando[item.dni]}
                                title="Volver a poner en cola (PENDING). El worker lo reintenta en el próximo ciclo."
                              >
                                {reencolando[item.dni] ? 'Reencolando…' : 'Reencolar ⟳'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Errores de la carga automática (para corregir) ─────────────────── */}
        {errores.length > 0 && (
          <div style={{ ...S.panel, borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.06)', marginBottom: 20 }}>
            <div style={{ ...S.panelTitle, color: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>
                Errores de carga automática ART
                <span style={{ marginLeft: 8, background: 'rgba(248,113,113,0.18)', color: '#fca5a5', borderRadius: 4, padding: '1px 7px', fontSize: '0.7rem' }}>
                  {errores.length}
                </span>
              </span>
              <button style={{ ...S.btn, background: '#334155', color: '#94a3b8', padding: '4px 10px' }} onClick={loadErrores} title="Recargar">
                ↺
              </button>
            </div>

            {/* Filtro por tipo de error */}
            <div style={S.tabs}>
              <button
                type="button"
                style={{ ...S.tab, ...(filtroErr === 'todos' ? S.tabActive : {}) }}
                onClick={() => setFiltroErr('todos')}
              >
                Todos ({errores.length})
              </button>
              {catsPresentes.map(cat => (
                <button
                  key={cat}
                  type="button"
                  style={{ ...S.tab, ...(filtroErr === cat ? S.tabActive : {}) }}
                  onClick={() => setFiltroErr(cat)}
                >
                  {cat} ({erroresPorCat[cat]})
                </button>
              ))}
            </div>

            <div style={{ overflowX: 'auto' as const }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                <thead>
                  <tr>
                    <th style={S.th}>Apellido y nombre</th>
                    <th style={S.th}>DNI</th>
                    <th style={S.th}>CUIL</th>
                    <th style={S.th}>Ley</th>
                    <th style={S.th}>Motivo</th>
                    <th style={S.th}>Fecha</th>
                    <th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {erroresFiltrados.map(err => (
                    <tr key={err.dni}>
                      <td style={{ ...S.td, fontWeight: 600 }}>
                        {err.apellido ? `${err.apellido}, ${err.nombre ?? ''}` : '—'}
                      </td>
                      <td style={S.td}><CopyChip label="DNI" value={String(err.dni)} toast={toast} /></td>
                      <td style={S.td}><CopyChip label="CUIL" value={err.cuil} toast={toast} /></td>
                      <td style={{ ...S.td, fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>{err.ley_nombre ?? '—'}</td>
                      <td style={{ ...S.td, color: '#fca5a5', maxWidth: 420 }} title={err.detalle ?? undefined}>
                        {err.motivo ?? '—'}
                      </td>
                      <td style={{ ...S.td, fontSize: '0.72rem', whiteSpace: 'nowrap' as const, color: 'rgba(255,255,255,0.4)' }}>
                        {fmt(err.updated_at)}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right' as const }}>
                        <button
                          style={{ ...S.btn, padding: '3px 10px', background: '#166534', color: '#4ade80', fontSize: '0.72rem', opacity: resolviendo[err.dni] ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
                          onClick={() => handleResolverError(err)}
                          disabled={resolviendo[err.dni]}
                          title="Reintentar la carga en ART (abre el navegador, ~30-60s). Si sale OK, se quita solo."
                        >
                          {resolviendo[err.dni] ? 'Cargando…' : 'Cargar ⟳'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={S.wrap}>

          {/* ── Panel izquierdo: candidatos ───────────────────────────────── */}
          <div style={S.panel}>
            <div style={S.panelTitle}>
              Becarios activos sin registrar
              <span style={{ marginLeft: 8, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', borderRadius: 4, padding: '1px 7px', fontSize: '0.7rem' }}>
                {candidatos.length}
              </span>
            </div>

            {/* Búsqueda */}
            <div style={S.searchWrap}>
              <input
                style={{ ...S.input, flex: 1 }}
                placeholder="Buscar apellido, nombre, DNI…"
                value={searchCand}
                onChange={e => setSearchCand(e.target.value)}
              />
              <button style={{ ...S.btn, background: '#334155', color: '#94a3b8' }} onClick={loadCandidatos} title="Recargar">
                ↺
              </button>
            </div>

            {loadingCand ? (
              <div style={S.empty}>Cargando…</div>
            ) : candFiltrados.length === 0 ? (
              <div style={S.empty}>
                {candidatos.length === 0
                  ? 'No hay becarios activos pendientes de registro'
                  : 'No hay resultados para la búsqueda'}
              </div>
            ) : (
              <div style={{ maxHeight: 540, overflowY: 'auto' as const }}>
                {candFiltrados.map(cand => {
                  const isSaving = saving[cand.dni];
                  return (
                    <div key={cand.dni} style={{ ...S.row, flexDirection: 'column' as const, alignItems: 'flex-start', gap: 8 }}>
                      {/* Nombre + botón registrar */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', gap: 8 }}>
                        <CopyChip label="Nombre" value={`${cand.apellido}, ${cand.nombre}`} toast={toast} />
                        <button
                          style={{ ...S.btn, background: isSaving ? '#334155' : '#1d4ed8', color: '#fff', opacity: isSaving ? 0.6 : 1, whiteSpace: 'nowrap' as const, flexShrink: 0 }}
                          onClick={() => handleRegistrar(cand)}
                          disabled={isSaving}
                        >
                          {isSaving ? '…' : 'Registrar'}
                        </button>
                      </div>
                      {/* Chips copiables */}
                      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                        <CopyChip label="DNI"         value={String(cand.dni)}          toast={toast} />
                        <CopyChip label="CUIL"        value={cand.cuil}                 toast={toast} />
                        <CopyChip label="Teléfono"    value={cand.telefono}             toast={toast} />
                        <CopyChip label="Nacimiento"  value={cand.fecha_nacimiento}     toast={toast} />
                        <CopyChip label="Ley"         value={cand.ley_nombre}           toast={toast} />
                        <CopyChip label="Legajo"      value={cand.legajo ? String(cand.legajo) : null} toast={toast} />
                        <CopyChip label="Establecimiento" value={cand.establecimiento}  toast={toast} />
                        <CopyChip label="Dirección"       value={cand.direccion}         toast={toast} />
                      </div>
                      {/* Estado de carga en ART + validación de dirección */}
                      <ArtBadges cand={cand} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Panel derecho: registrados ────────────────────────────────── */}
          <div style={{ ...S.panel, flex: '2 1 560px' }}>
            <div style={S.panelTitle}>
              Registrados en ART
              <span style={{ marginLeft: 8, background: 'rgba(34,197,94,0.15)', color: '#4ade80', borderRadius: 4, padding: '1px 7px', fontSize: '0.7rem' }}>
                {registrados.length}
              </span>
              <span style={{ marginLeft: 6, background: 'rgba(59,130,246,0.15)', color: '#93c5fd', borderRadius: 4, padding: '1px 7px', fontSize: '0.7rem' }}>
                auto {registradosAutomaticos.length}
              </span>
            </div>

            <div style={S.tabs}>
              <button
                type="button"
                style={{ ...S.tab, ...(tabReg === 'todos' ? S.tabActive : {}) }}
                onClick={() => setTabReg('todos')}
              >
                Todos ({registrados.length})
              </button>
              <button
                type="button"
                style={{ ...S.tab, ...(tabReg === 'automaticos' ? S.tabActive : {}) }}
                onClick={() => setTabReg('automaticos')}
              >
                Automaticos ({registradosAutomaticos.length})
              </button>
            </div>

            {/* Búsqueda */}
            <div style={S.searchWrap}>
              <input
                style={{ ...S.input, flex: 1 }}
                placeholder="Buscar apellido, nombre, DNI, página…"
                value={searchReg}
                onChange={e => setSearchReg(e.target.value)}
              />
              <button style={{ ...S.btn, background: '#334155', color: '#94a3b8' }} onClick={loadRegistrados} title="Recargar">
                ↺
              </button>
            </div>

            {loadingReg ? (
              <div style={S.empty}>Cargando…</div>
            ) : regFiltrados.length === 0 ? (
              <div style={S.empty}>
                {registrados.length === 0 ? 'Todavía no hay becarios registrados en ART' : 'Sin resultados'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' as const }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Apellido y nombre</th>
                      <th style={S.th}>DNI</th>
                      <th style={S.th}>Legajo</th>
                      <th style={S.th}>Origen</th>
                      <th style={S.th}>Pág. ART</th>
                      <th style={S.th}>Dirección</th>
                      <th style={S.th}>Cargado por usuario</th>
                      <th style={S.th}>Fecha alta</th>
                      <th style={S.th}>Actualizado</th>
                      <th style={S.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {regFiltrados.map(reg => {
                      const editing  = editPag[reg.id] !== undefined;
                      const isSaving = savingPag[reg.id];
                      const dir      = reg.direccion;
                      const expanded = expandDir === reg.id;
                      const isAuto   = reg.origen_art === 'automatico';

                      return (
                        <React.Fragment key={reg.id}>
                          <tr style={{ background: expanded ? 'rgba(59,130,246,0.06)' : undefined }}>
                            {/* Nombre */}
                            <td style={{ ...S.td, fontWeight: 600 }}>
                              {reg.apellido}, {reg.nombre}
                            </td>
                            {/* DNI */}
                            <td style={S.td}>{reg.dni}</td>
                            {/* Legajo */}
                            <td style={{ ...S.td, textAlign: 'center' as const }}>{reg.legajo ?? '—'}</td>
                            {/* Origen */}
                            <td style={{ ...S.td, textAlign: 'center' as const }}>
                              <span style={{
                                ...S.badge,
                                background: isAuto ? 'rgba(59,130,246,0.16)' : 'rgba(148,163,184,0.12)',
                                color: isAuto ? '#93c5fd' : '#cbd5e1',
                              }}>
                                {isAuto ? 'Automatico' : 'Manual'}
                              </span>
                            </td>
                            {/* Página ART editable */}
                            <td style={{ ...S.td, textAlign: 'center' as const }}>
                              {editing ? (
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  <input
                                    style={{ ...S.pagInput, width: 60 }}
                                    value={editPag[reg.id]}
                                    onChange={e => setEditPag(prev => ({ ...prev, [reg.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') handleActualizarPagina(reg); if (e.key === 'Escape') setEditPag(prev => { const n={...prev}; delete n[reg.id]; return n; }); }}
                                    autoFocus
                                    disabled={isSaving}
                                  />
                                  <button style={{ ...S.btn, padding: '3px 8px', background: '#166534', color: '#4ade80', fontSize: '0.75rem' }}
                                    onClick={() => handleActualizarPagina(reg)} disabled={isSaving}>✓</button>
                                  <button style={{ ...S.btn, padding: '3px 8px', background: '#450a0a', color: '#f87171', fontSize: '0.75rem' }}
                                    onClick={() => setEditPag(prev => { const n={...prev}; delete n[reg.id]; return n; })}>✕</button>
                                </div>
                              ) : (
                                <span
                                  style={{ ...S.badge, cursor: 'pointer' }}
                                  onClick={() => setEditPag(prev => ({ ...prev, [reg.id]: reg.pagina }))}
                                  title="Hacer clic para editar"
                                >
                                  {reg.pagina}
                                </span>
                              )}
                            </td>
                            {/* Dirección */}
                            <td style={{ ...S.td, maxWidth: 200, fontSize: '0.74rem' }}>
                              {dir ? (
                                <span
                                  style={{ cursor: 'pointer', color: expanded ? '#93c5fd' : '#94a3b8', textDecoration: 'underline dotted' }}
                                  onClick={() => setExpandDir(expanded ? null : reg.id)}
                                  title="Ver dirección completa"
                                >
                                  {dir.calle ? `${dir.calle}${dir.numero ? ' ' + dir.numero : ''}` : '—'}
                                </span>
                              ) : (
                                <span style={{ color: 'rgba(255,255,255,0.2)' }}>Sin dirección</span>
                              )}
                            </td>
                            {/* Cargado por */}
                            <td style={{ ...S.td, fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>
                              {isAuto ? 'Script automatico' : (reg.creado_por_nombre ?? `#${reg.creado_por ?? '?'}`)}
                            </td>
                            {/* Fecha alta */}
                            <td style={{ ...S.td, fontSize: '0.72rem', whiteSpace: 'nowrap' as const, color: 'rgba(255,255,255,0.5)' }}>
                              {fmt(reg.created_at)}
                            </td>
                            {/* Última actualización */}
                            <td style={{ ...S.td, fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>
                              {reg.actualizado_por_nombre
                                ? `${reg.actualizado_por_nombre} · ${fmt(reg.updated_at)}`
                                : '—'}
                            </td>
                            {/* Acciones */}
                            <td style={{ ...S.td, textAlign: 'right' as const }}>
                              <button
                                style={{ ...S.btn, padding: '3px 10px', background: '#450a0a', color: '#f87171', fontSize: '0.72rem' }}
                                onClick={() => handleEliminar(reg)}
                                title="Dar de baja"
                              >
                                Baja
                              </button>
                            </td>
                          </tr>

                          {/* Fila expandida: dirección completa */}
                          {expanded && dir && (
                            <tr>
                              <td colSpan={10} style={{ padding: '0 12px 12px 24px', background: 'rgba(59,130,246,0.04)' }}>
                                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' as const, fontSize: '0.78rem', color: '#94a3b8', paddingTop: 8 }}>
                                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>Dependencia: </span>{dir.dependencia ?? '—'}</div>
                                  <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>Dirección: </span>{dirStr(dir)}</div>
                                  {dir.otras_referencias && <div><span style={{ color: 'rgba(255,255,255,0.35)' }}>Ref.: </span>{dir.otras_referencias}</div>}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </Layout>
  );
}
