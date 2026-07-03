// src/pages/HerramientasPage/index.tsx
// Calculadora de Jubilación IPS — Leyes 10471/10430 · Decretos 598/2015, 58/2015, 1554/2022

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Layout }         from '../../components/Layout';
import { apiFetch }       from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel }  from '../../utils/export';
import { useToast }                     from '../../ui/toast';
import { AlertaBannerAgenteConMensaje } from '../../components/AlertaBannerAgente';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface ServicioANSES {
  fecha_desde:  string;
  fecha_hasta:  string;
  es_insalubre: boolean;
}

interface ServicioExterno {
  organismo:    string;
  fecha_desde:  string;
  fecha_hasta:  string;
  es_insalubre: boolean;
}

interface Periodo { anios: number; meses: number; dias: number }

interface Superpuesto extends Periodo {
  organismo: string;
  ganador:   string | null;
  motivo:    string;
  empate:    boolean;
}

interface Resultado {
  edad_actual:                  Periodo | null;
  tiene_beca:                   boolean;
  beca_aporto:                  boolean;
  ips_aporto:                   boolean;
  sin_aportes:                  boolean;
  caja_jubilatoria:             'IPS' | 'ANSES';
  corresponde_anses:            boolean;
  ips_bruto:                    Periodo;
  anses_bruto:                  Periodo;
  servicio_beca:                Periodo;
  servicio_nombrado:            Periodo;
  servicio_nombrado_antes_2015: Periodo;
  servicio_nombrado_desde_2015: Periodo;
  servicio_ips:                 Periodo;
  servicio_ips_ajustado:        Periodo;
  es_insalubre_efectivo:        boolean;
  diferencial_2pct_pagado:      boolean;
  cargo_deudor_2pct:            boolean;
  cargo_deudor_periodo:         Periodo;
  anses_neto:                   Periodo;
  superpuestos:                 Superpuesto[];
  hay_empates:                  boolean;
  total_insalubre:              Periodo;
  total_insalubre_prorateado:   Periodo;
  total_comun:                  Periodo;
  total_prorateado:             Periodo;
  tipo_jubilacion:              string | null;
  cumple_servicio:              boolean;
  cumple_edad:                  boolean;
  falta_servicio:               Periodo;
  falta_edad:                   Periodo;
  pct_servicio_completado:      number;
  pct_edad_completada:          number;
}

interface AgenteInfo {
  dni:                   number;
  apellido:              string;
  nombre:                string;
  fecha_nacimiento:      string | null;
  fecha_ingreso:         string | null;
  fecha_de_nombramiento: string | null;
  ley_nombre:            string | null;
  ocupacion_nombre:      string | null;
  ocupacion_es_insalubre: boolean;
  situacion_sugerida:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const P0 = { anios: 0, meses: 0, dias: 0 };
const isZero = (p: Periodo) => p.anios === 0 && p.meses === 0 && p.dias === 0;

const fmtPeriodo = (p: Periodo | null | undefined): string => {
  if (!p) return '—';
  const parts: string[] = [];
  if (p.anios) parts.push(`${p.anios} año${p.anios !== 1 ? 's' : ''}`);
  if (p.meses) parts.push(`${p.meses} mes${p.meses !== 1 ? 'es' : ''}`);
  if (p.dias)  parts.push(`${p.dias} día${p.dias !== 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : '0 días';
};

const fmtFecha = (v: string | null | undefined): string => {
  if (!v) return '—';
  const [y, m, d] = String(v).split('T')[0].split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

// Convierte string YYYY-MM-DD a formato input[type=date] (ya es YYYY-MM-DD, pero limpia el T)
const toInputDate = (v: string | null | undefined): string =>
  v ? String(v).split('T')[0] : '';

// Extrae YYYY-MM-DD de fecha_nombramiento para el default de fecha_desde de ANSES/externos
const toISODate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const TODAY_ISO = toISODate(new Date());

const S: Record<string, React.CSSProperties> = {
  card:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 20, marginBottom: 16 },
  label:     { fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:     { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  select:    { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  btn:       { cursor: 'pointer', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.84rem', border: 'none' },
  grid2:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  grid3:     { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
  h3:        { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12, color: '#94a3b8' },
  tagGreen:  { background: '#14532d', color: '#86efac', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagRed:    { background: '#450a0a', color: '#fca5a5', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagOrange: { background: '#431407', color: '#fdba74', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagBlue:   { background: '#0c1a4a', color: '#93c5fd', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagPurple: { background: '#2e1065', color: '#d8b4fe', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagGray:   { background: '#1e293b', color: '#94a3b8', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagYellow: { background: '#713f12', color: '#fef08a', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  chkRow:    { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 6 },
  chk:       { width: 17, height: 17, cursor: 'pointer', flexShrink: 0 },
};

const TIPOS_JUBILACION: Record<string, string> = {
  ORDINARIA:             '✅ Jubilación Ordinaria (60 años / 35 años servicio)',
  AGOTAMIENTO_PREMATURO: '⚡ Agotamiento Prematuro (50 años / 25 años servicio)',
  PRORRATEO:             '⚖️ Prorrateo Mixto (Decreto 1554/2022)',
};

const SITUACIONES = [
  { value: 'NORMAL',      label: 'Normal (planta permanente)' },
  { value: 'BECADO',      label: 'Becado' },
  { value: 'RESIDENTE',   label: 'Residente' },
  { value: 'CONCURRENTE', label: 'Concurrente Ley 10430' },
  { value: 'ARTICULO_48', label: 'Artículo 48' },
];

function Barra({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 99, height: 10, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, background: color, height: '100%', borderRadius: 99, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function InfoBox({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ background: color + '10', border: `1px solid ${color}40`, borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: '0.82rem', lineHeight: 1.55 }}>
      {children}
    </div>
  );
}

// ── Fila de servicio con fechas ───────────────────────────────────────────────
function FilaFecha({
  fechaDesde, fechaHasta, esInsalubre, onDesde, onHasta, onInsalubre, onEliminar,
  prefijo, idx,
}: {
  fechaDesde: string; fechaHasta: string; esInsalubre: boolean;
  onDesde: (v: string) => void; onHasta: (v: string) => void;
  onInsalubre: (v: boolean) => void; onEliminar: () => void;
  prefijo: string; idx: number;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px 40px', gap: 8, alignItems: 'end', marginBottom: 8 }}>
      <div>
        <label style={S.label}>Desde</label>
        <input id={`${prefijo}-${idx}-desde`} type="date" style={S.input} value={fechaDesde}
          onChange={e => onDesde(e.target.value)} max={TODAY_ISO} />
      </div>
      <div>
        <label style={S.label}>Hasta</label>
        <input id={`${prefijo}-${idx}-hasta`} type="date" style={S.input} value={fechaHasta}
          onChange={e => onHasta(e.target.value)} max={TODAY_ISO} />
      </div>
      <div>
        <div style={S.label}>¿Insalubre?</div>
        <label style={{ ...S.chkRow, marginTop: 10 }}>
          <input type="checkbox" checked={esInsalubre} onChange={e => onInsalubre(e.target.checked)} style={S.chk} />
          <span style={{ fontSize: '0.82rem' }}>Sí</span>
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <button onClick={onEliminar} style={{ ...S.btn, background: '#450a0a', color: '#fca5a5', padding: '7px 10px', fontSize: '0.82rem' }}>✕</button>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function HerramientasPage() {
  const toast = useToast();

  const [busqueda,    setBusqueda]    = useState('');
  const [sugerencias, setSugerencias] = useState<any[]>([]);
  const [agente,      setAgente]      = useState<AgenteInfo | null>(null);
  const [buscando,    setBuscando]    = useState(false);
  const busqTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [situacion,          setSituacion]          = useState<string>('NORMAL');
  const [becaAporto,         setBecaAporto]         = useState(false);
  const [ipsAporto,          setIpsAporto]          = useState(true);
  const [esInsalubreIPS,     setEsInsalubreIPS]     = useState(false);
  const [diferencial2Pagado, setDiferencial2Pagado] = useState(false);

  const [serviciosAnses,     setServiciosAnses]    = useState<ServicioANSES[]>([]);
  const [serviciosExternos,  setServiciosExternos] = useState<ServicioExterno[]>([]);

  // Resoluciones manuales de empates: key = "IPS|ANSES_0" etc., value = id del ganador
  const [resolucionesManuales, setResolucionesManuales] = useState<Record<string, string>>({});

  const [resultado,     setResultado]     = useState<Resultado | null>(null);
  const [calculando,    setCalculando]    = useState(false);
  const [guardando,     setGuardando]     = useState(false);
  const [observaciones, setObservaciones] = useState('');
  const [historial,     setHistorial]     = useState<any[]>([]);
  const [verHistorial,  setVerHistorial]  = useState(false);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'calculadora' | 'posibles'>('calculadora');

  // ── Posibles Jubilados — estado ───────────────────────────────────────────
  const [pjBusqueda,    setPjBusqueda]    = useState('');
  const [pjSugerencias, setPjSugerencias] = useState<any[]>([]);
  const [pjBuscando,    setPjBuscando]    = useState(false);
  const pjTimer                           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pjAgente,      setPjAgente]      = useState<any | null>(null);
  const [pjMesCorte,    setPjMesCorte]    = useState('MARZO');
  const [pjLista,       setPjLista]       = useState<any[]>([]);
  const [pjCargando,    setPjCargando]    = useState(false);
  const [pjFiltro,      setPjFiltro]      = useState('');
  const [pjEditId,      setPjEditId]      = useState<number | null>(null);
  const [pjEditEstado,  setPjEditEstado]  = useState('');
  const [pjEditMesCorte,setPjEditMesCorte]= useState('');
  const [pjEditObs,     setPjEditObs]     = useState('');
  const [pjGuardando,   setPjGuardando]   = useState(false);

  // ── Búsqueda ──────────────────────────────────────────────────────────────
  const onBusquedaChange = useCallback((q: string) => {
    setBusqueda(q);
    if (busqTimer.current) clearTimeout(busqTimer.current);
    if (!q.trim()) { setSugerencias([]); return; }
    busqTimer.current = setTimeout(async () => {
      setBuscando(true);
      try { setSugerencias((await searchPersonal(q.trim())).slice(0, 8)); }
      finally { setBuscando(false); }
    }, 250);
  }, []);

  const seleccionarAgente = useCallback(async (ag: any) => {
    setSugerencias([]);
    setBusqueda(`${ag.apellido}, ${ag.nombre}`);
    setResultado(null);
    setResolucionesManuales({});
    try {
      const res = await apiFetch<any>(`/jubilacion/agente-datos/${ag.dni}`);
      const d   = res?.data;
      if (!d) { toast.error('No se encontraron datos del agente'); return; }

      setAgente(d);
      setSituacion(d.situacion_sugerida ?? 'NORMAL');
      setEsInsalubreIPS(!!d.ocupacion_es_insalubre);
      setBecaAporto(false);
      setIpsAporto(!['RESIDENTE', 'CONCURRENTE', 'ARTICULO_48'].includes(d.situacion_sugerida ?? 'NORMAL'));
      setDiferencial2Pagado(false);
      setServiciosAnses([]);
      setServiciosExternos([]);
      setObservaciones('');

      const hist = await apiFetch<any>(`/jubilacion/agente/${d.dni}`);
      setHistorial(hist?.data ?? []);
    } catch (e: any) {
      toast.error('Error cargando agente: ' + e?.message);
    }
  }, [toast]);

  const tieneBeca = !!(
    agente?.fecha_ingreso &&
    agente?.fecha_de_nombramiento &&
    new Date(agente.fecha_ingreso) < new Date(agente.fecha_de_nombramiento)
  );

  // ── ANSES ─────────────────────────────────────────────────────────────────
  const agregarAnses = () =>
    setServiciosAnses(p => [...p, { fecha_desde: '', fecha_hasta: TODAY_ISO, es_insalubre: false }]);
  const updateAnses = (i: number, f: keyof ServicioANSES, v: any) =>
    setServiciosAnses(p => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const eliminarAnses = (i: number) =>
    setServiciosAnses(p => p.filter((_, idx) => idx !== i));

  // ── Externos ──────────────────────────────────────────────────────────────
  const agregarExterno = () =>
    setServiciosExternos(p => [...p, { organismo: '', fecha_desde: '', fecha_hasta: TODAY_ISO, es_insalubre: false }]);
  const updateExterno = (i: number, f: keyof ServicioExterno, v: any) =>
    setServiciosExternos(p => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const eliminarExterno = (i: number) =>
    setServiciosExternos(p => p.filter((_, idx) => idx !== i));

  // ── Payload ───────────────────────────────────────────────────────────────
  const buildPayload = (resoluciones = resolucionesManuales) => ({
    dni:                     agente!.dni,
    situacion_revista:       situacion,
    beca_aporto:             becaAporto,
    ips_aporto:              ipsAporto,
    es_insalubre_ips:        esInsalubreIPS,
    diferencial_2pct_pagado: diferencial2Pagado,
    servicios_anses:         serviciosAnses.filter(s => s.fecha_desde && s.fecha_hasta),
    servicios_externos:      serviciosExternos.filter(s => s.organismo.trim() && s.fecha_desde && s.fecha_hasta),
    resoluciones_manuales:   resoluciones,
  });

  // ── Calcular ──────────────────────────────────────────────────────────────
  const calcular = async (resoluciones = resolucionesManuales) => {
    if (!agente) return;
    setCalculando(true);
    try {
      const res = await apiFetch<any>('/jubilacion/calcular', {
        method: 'POST',
        body: JSON.stringify(buildPayload(resoluciones)),
      });
      if (res?.ok) setResultado(res.resultado);
      else toast.error(res?.error ?? 'Error en cálculo');
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setCalculando(false); }
  };

  const resolverEmpate = (key: string, ganadorId: string) => {
    const nuevas = { ...resolucionesManuales, [key]: ganadorId };
    setResolucionesManuales(nuevas);
    calcular(nuevas);
  };

  // ── Guardar ───────────────────────────────────────────────────────────────
  const guardar = async () => {
    if (!agente || !resultado) return;
    setGuardando(true);
    try {
      const res = await apiFetch<any>('/jubilacion/guardar', {
        method: 'POST',
        body: JSON.stringify({ ...buildPayload(), observaciones }),
      });
      if (res?.ok) {
        toast.ok('Cálculo guardado');
        const hist = await apiFetch<any>(`/jubilacion/agente/${agente.dni}`);
        setHistorial(hist?.data ?? []);
      } else {
        toast.error(res?.error ?? 'Error al guardar');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setGuardando(false); }
  };

  // ── Exportar Excel ────────────────────────────────────────────────────────
  const exportarExcel = () => {
    if (!agente || !resultado) return;
    const R = resultado;
    const filas: any[] = [];

    filas.push({ Sección: '═══ DATOS DEL AGENTE ═══', Dato: '', Valor: '' });
    filas.push({ Sección: 'Agente', Dato: 'Apellido y Nombre', Valor: `${agente.apellido}, ${agente.nombre}` });
    filas.push({ Sección: 'Agente', Dato: 'DNI',               Valor: agente.dni });
    filas.push({ Sección: 'Agente', Dato: 'Fecha Nacimiento',  Valor: fmtFecha(agente.fecha_nacimiento) });
    filas.push({ Sección: 'Agente', Dato: 'Fecha Ingreso',     Valor: fmtFecha(agente.fecha_ingreso) });
    filas.push({ Sección: 'Agente', Dato: 'Fecha Nombramiento',Valor: fmtFecha(agente.fecha_de_nombramiento) });
    filas.push({ Sección: 'Agente', Dato: 'Ley',               Valor: agente.ley_nombre ?? '—' });
    filas.push({ Sección: 'Agente', Dato: 'Situación',         Valor: situacion });
    filas.push({ Sección: 'Agente', Dato: 'Edad actual',       Valor: fmtPeriodo(R.edad_actual) });

    filas.push({ Sección: '═══ SERVICIOS IPS ═══', Dato: '', Valor: '' });
    if (R.tiene_beca) filas.push({ Sección: 'IPS', Dato: 'Período de beca', Valor: fmtPeriodo(R.servicio_beca) + (R.beca_aporto ? ' (aportó)' : ' (sin aportes)') });
    filas.push({ Sección: 'IPS', Dato: 'Antigüedad nombrado',        Valor: fmtPeriodo(R.servicio_nombrado) });
    filas.push({ Sección: 'Comparación', Dato: 'IPS bruto',           Valor: fmtPeriodo(R.ips_bruto) });
    filas.push({ Sección: 'Comparación', Dato: 'ANSES bruto',         Valor: fmtPeriodo(R.anses_bruto) });
    filas.push({ Sección: 'Comparación', Dato: 'Caja jubilatoria',    Valor: R.caja_jubilatoria });
    filas.push({ Sección: 'IPS', Dato: 'Total IPS (bruto)',           Valor: fmtPeriodo(R.servicio_ips) });
    filas.push({ Sección: 'IPS', Dato: 'Total IPS neto (s/superp.)', Valor: fmtPeriodo(R.servicio_ips_ajustado) });
    filas.push({ Sección: 'IPS', Dato: 'Insalubre efectivo',         Valor: R.es_insalubre_efectivo ? 'SÍ' : 'NO' });
    filas.push({ Sección: 'IPS', Dato: 'Cargo deudor 2%',            Valor: R.cargo_deudor_2pct ? `SÍ — ${fmtPeriodo(R.cargo_deudor_periodo)}` : 'NO' });

    if (serviciosAnses.length) {
      filas.push({ Sección: '═══ ANSES ═══', Dato: '', Valor: '' });
      serviciosAnses.forEach((a, i) => {
        filas.push({ Sección: 'ANSES', Dato: `Línea ${i + 1}`, Valor: `${fmtFecha(a.fecha_desde)} → ${fmtFecha(a.fecha_hasta)} (${a.es_insalubre ? 'insalubre' : 'común'})` });
      });
      filas.push({ Sección: 'ANSES', Dato: 'Neto (s/superp.)', Valor: fmtPeriodo(R.anses_neto) });
    }

    for (const ext of serviciosExternos.filter(e => e.organismo.trim())) {
      filas.push({ Sección: 'Externo', Dato: ext.organismo, Valor: `${fmtFecha(ext.fecha_desde)} → ${fmtFecha(ext.fecha_hasta)} (${ext.es_insalubre ? 'insalubre' : 'común'})` });
    }

    if (R.superpuestos.length) {
      filas.push({ Sección: '═══ SUPERPUESTOS ═══', Dato: '', Valor: '' });
      R.superpuestos.forEach(sp => {
        filas.push({ Sección: 'Superpuesto', Dato: sp.organismo, Valor: `${fmtPeriodo(sp)} — ${sp.empate ? 'EMPATE (manual)' : `Gana: ${sp.ganador}`} (${sp.motivo})` });
      });
    }

    filas.push({ Sección: '═══ TOTALES ═══', Dato: '', Valor: '' });
    filas.push({ Sección: 'Totales', Dato: 'Total insalubre',        Valor: fmtPeriodo(R.total_insalubre) });
    filas.push({ Sección: 'Totales', Dato: 'Total común',             Valor: fmtPeriodo(R.total_comun) });
    filas.push({ Sección: 'Totales', Dato: 'Total prorateado (tabla)', Valor: fmtPeriodo(R.total_prorateado) });
    filas.push({ Sección: 'Resultado', Dato: 'Tipo jubilación', Valor: R.tipo_jubilacion ? (TIPOS_JUBILACION[R.tipo_jubilacion] ?? R.tipo_jubilacion) : 'AÚN NO ALCANZA' });
    if (!R.cumple_servicio) filas.push({ Sección: 'Falta', Dato: 'Servicio', Valor: fmtPeriodo(R.falta_servicio) });
    if (!R.cumple_edad)    filas.push({ Sección: 'Falta', Dato: 'Edad',     Valor: fmtPeriodo(R.falta_edad) });
    if (observaciones) filas.push({ Sección: 'Observaciones', Dato: '', Valor: observaciones });

    exportToExcel(`jubilacion_${agente.apellido}_${agente.nombre}_${new Date().toISOString().slice(0, 10)}`, filas);
  };

  // ── Posibles Jubilados — helpers ─────────────────────────────────────────
  const pjEstadoLabel = (e: string) => {
    const m: Record<string, string> = { IDENTIFICADO: 'Identificado', EN_TRAMITE: 'En trámite', JUBILADO: 'Jubilado', DESCARTADO: 'Descartado' };
    return m[e] ?? e;
  };
  const pjEstadoStyle = (e: string): React.CSSProperties => {
    const m: Record<string, React.CSSProperties> = {
      IDENTIFICADO: S.tagBlue,
      EN_TRAMITE:   S.tagYellow,
      JUBILADO:     S.tagGreen,
      DESCARTADO:   S.tagGray,
    };
    return m[e] ?? S.tagGray;
  };
  const pjMesCorteLabel = (mes: string | null | undefined) => {
    const m: Record<string, string> = { MARZO: 'Marzo', JUNIO: 'Junio', SEPTIEMBRE: 'Septiembre', DICIEMBRE: 'Diciembre' };
    return mes ? (m[mes] ?? mes) : 'Sin fecha';
  };

  const pjListaFiltrada = pjFiltro ? pjLista.filter((p: any) => p.estado === pjFiltro) : pjLista;

  // ── Posibles Jubilados — funciones ────────────────────────────────────────
  const onPjBusquedaChange = useCallback((q: string) => {
    setPjBusqueda(q);
    setPjAgente(null);
    if (pjTimer.current) clearTimeout(pjTimer.current);
    if (!q.trim()) { setPjSugerencias([]); return; }
    pjTimer.current = setTimeout(async () => {
      setPjBuscando(true);
      try { setPjSugerencias((await searchPersonal(q.trim())).slice(0, 8)); }
      finally { setPjBuscando(false); }
    }, 250);
  }, []);

  const seleccionarPjAgente = useCallback((ag: any) => {
    setPjSugerencias([]);
    setPjBusqueda(`${ag.apellido}, ${ag.nombre}`);
    setPjAgente(ag);
  }, []);

  const cargarPosibles = useCallback(async () => {
    setPjCargando(true);
    try {
      const res = await apiFetch<any>('/jubilacion/posibles');
      setPjLista(res?.data ?? []);
    } catch (e: any) {
      toast.error('Error cargando posibles jubilados: ' + e?.message);
    } finally { setPjCargando(false); }
  }, [toast]);

  const agregarPosible = useCallback(async () => {
    if (!pjAgente) return;
    setPjGuardando(true);
    try {
      const res = await apiFetch<any>('/jubilacion/posibles', {
        method: 'POST',
        body: JSON.stringify({ dni: pjAgente.dni, mes_corte: pjMesCorte }),
      });
      if (res?.ok) {
        toast.ok(`${pjAgente.apellido}, ${pjAgente.nombre} agregado al registro`);
        setPjBusqueda('');
        setPjAgente(null);
        await cargarPosibles();
      } else {
        toast.error(res?.error ?? 'Error al agregar');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setPjGuardando(false); }
  }, [pjAgente, cargarPosibles, toast]);

  const abrirPjEdit = useCallback((pj: any) => {
    setPjEditId(pj.id);
    setPjEditEstado(pj.estado);
    setPjEditMesCorte(pj.mes_corte ?? 'MARZO');
    setPjEditObs(pj.observaciones ?? '');
  }, []);

  const guardarPjEdit = useCallback(async (id: number) => {
    setPjGuardando(true);
    try {
      const res = await apiFetch<any>(`/jubilacion/posibles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: pjEditEstado, mes_corte: pjEditMesCorte, observaciones: pjEditObs }),
      });
      if (res?.ok) {
        toast.ok('Registro actualizado');
        setPjEditId(null);
        await cargarPosibles();
      } else {
        toast.error(res?.error ?? 'Error al actualizar');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setPjGuardando(false); }
  }, [pjEditEstado, pjEditMesCorte, pjEditObs, cargarPosibles, toast]);

  const eliminarPosible = useCallback(async (id: number) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    try {
      const res = await apiFetch<any>(`/jubilacion/posibles/${id}`, { method: 'DELETE' });
      if (res?.ok) {
        toast.ok('Registro eliminado');
        await cargarPosibles();
      } else {
        toast.error(res?.error ?? 'Error al eliminar');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    }
  }, [cargarPosibles, toast]);

  // Cargar lista al entrar al tab
  useEffect(() => {
    if (tab === 'posibles') cargarPosibles();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Herramientas">
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
        {/* ─ Tab switcher ─ */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          {(['calculadora', 'posibles'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 22px', fontSize: '0.9rem', fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#e2e8f0' : '#64748b',
              borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.15s',
            }}>
              {t === 'calculadora' ? '⚖️ Calculadora' : '📋 Posibles Jubilados'}
            </button>
          ))}
        </div>

        {tab === 'calculadora' && (<>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>⚖️ Calculadora de Jubilación IPS</h1>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
            Leyes 10471 / 10430 · Decretos 598/2015, 58/2015, 1554/2022 · Prorrateo por tabla
          </p>
        </div>

        {/* ─ 1. Buscar Agente ─ */}
        <div style={S.card}>
          <div style={S.h3}>1. Buscar Agente</div>
          <div style={{ position: 'relative' }}>
            <input
              aria-label="Buscar agente por apellido, nombre o DNI"
              style={S.input}
              placeholder="Apellido, nombre o DNI..."
              value={busqueda}
              onChange={e => onBusquedaChange(e.target.value)}
            />
            {buscando && (
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '0.75rem' }}>Buscando...</span>
            )}
            {sugerencias.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, zIndex: 100, maxHeight: 260, overflowY: 'auto' }}>
                {sugerencias.map((s, i) => (
                  <div key={i} onClick={() => seleccionarAgente(s)}
                    style={{ padding: '9px 14px', cursor: 'pointer', fontSize: '0.84rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <strong>{s.apellido}, {s.nombre}</strong>
                    <span style={{ color: '#64748b', marginLeft: 10, fontSize: '0.75rem' }}>DNI {s.dni} · {s.ley_nombre ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {agente && (
            <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                {([
                  ['Apellido y Nombre', `${agente.apellido}, ${agente.nombre}`],
                  ['DNI', String(agente.dni)],
                  ['Ley', agente.ley_nombre ?? '—'],
                  ['Fecha Nacimiento', fmtFecha(agente.fecha_nacimiento)],
                  ['Fecha Ingreso (alta)', fmtFecha(agente.fecha_ingreso)],
                  ['Fecha Nombramiento', fmtFecha(agente.fecha_de_nombramiento)],
                  ['Ocupación', agente.ocupacion_nombre ?? '—'],
                ] as [string, string][]).map(([label, val]) => (
                  <div key={label}>
                    <span style={S.label}>{label}</span>
                    <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>{val}</span>
                  </div>
                ))}
              </div>
              {tieneBeca && (
                <div style={{ marginTop: 12, ...S.tagOrange }}>
                  ⚠ Período de beca detectado: {fmtFecha(agente.fecha_ingreso)} → {fmtFecha(agente.fecha_de_nombramiento)}
                </div>
              )}
            </div>
          )}
        </div>

        <AlertaBannerAgenteConMensaje dni={agente?.dni ?? null} />

        {agente && (
          <>
            {/* ─ 2. Situación IPS ─ */}
            <div style={S.card}>
              <div style={S.h3}>2. Situación en el IPS</div>
              <div style={{ ...S.grid2, alignItems: 'start', gap: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label htmlFor="ht-situacion" style={S.label}>Situación de revista actual</label>
                    <select id="ht-situacion" style={S.select} value={situacion} onChange={e => {
                      const next = e.target.value;
                      setSituacion(next);
                      setIpsAporto(!['RESIDENTE', 'CONCURRENTE', 'ARTICULO_48'].includes(next));
                    }}>
                      {SITUACIONES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>

                  {tieneBeca && (
                    <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#fdba74', fontWeight: 700, marginBottom: 8 }}>
                        PERÍODO DE BECA ({fmtFecha(agente.fecha_ingreso)} → {fmtFecha(agente.fecha_de_nombramiento)})
                      </div>
                      <label style={S.chkRow}>
                        <input type="checkbox" checked={becaAporto} onChange={e => setBecaAporto(e.target.checked)} style={S.chk} />
                        <span style={{ fontSize: '0.84rem' }}>¿Realizó aportes durante la beca?</span>
                      </label>
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: becaAporto ? '#86efac' : '#94a3b8' }}>
                        {becaAporto ? 'El período de beca se suma al cómputo previsional.' : 'El período de beca no se contabilizará para la jubilación.'}
                      </div>
                    </div>
                  )}

                  {(['RESIDENTE', 'CONCURRENTE', 'ARTICULO_48'].includes(situacion)) && (
                    <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#93c5fd', fontWeight: 700, marginBottom: 8 }}>
                        APORTES IPS EN ESTA SITUACIÓN
                      </div>
                      <label style={S.chkRow}>
                        <input type="checkbox" checked={ipsAporto} onChange={e => setIpsAporto(e.target.checked)} style={S.chk} />
                        <span style={{ fontSize: '0.84rem' }}>¿Realizó aportes al IPS?</span>
                      </label>
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: ipsAporto ? '#86efac' : '#fca5a5' }}>
                        {ipsAporto ? 'El período IPS se computa.' : 'Sin aportes al IPS — no computa para jubilación.'}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={S.label}>Tareas insalubres / agotamiento prematuro</div>
                    {agente.ocupacion_nombre && (
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: 6 }}>
                        Ocupación: <strong style={{ color: '#e2e8f0' }}>{agente.ocupacion_nombre}</strong>
                        {agente.ocupacion_es_insalubre
                          ? <span style={{ color: '#fdba74', marginLeft: 6 }}>(insalubre según DB)</span>
                          : <span style={{ color: '#64748b', marginLeft: 6 }}>(no insalubre según DB)</span>}
                      </div>
                    )}
                    <label style={S.chkRow}>
                      <input type="checkbox" checked={esInsalubreIPS} onChange={e => {
                        setEsInsalubreIPS(e.target.checked);
                        if (!e.target.checked) setDiferencial2Pagado(false);
                      }} style={S.chk} />
                      <span style={{ fontSize: '0.84rem' }}>Profesión insalubre (Ley 10471 / Decretos 598/2015, 58/2015)</span>
                    </label>
                    {esInsalubreIPS && (
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#fdba74' }}>
                        Prorrateo por tabla aplicado. Requisito: 50 años / 25 años servicio.
                      </div>
                    )}
                    {!esInsalubreIPS && (
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#94a3b8' }}>
                        Desde Jun/2015: insalubre (16%) · Antes de Jun/2015: común (14%)
                      </div>
                    )}
                  </div>

                  {!esInsalubreIPS && agente.fecha_de_nombramiento && new Date(agente.fecha_de_nombramiento) < new Date(2015, 5, 1) && (
                    <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 8 }}>
                        DIFERENCIAL DE APORTES 2% ({fmtFecha(agente.fecha_de_nombramiento)} → Jun/2015)
                      </div>
                      <label style={S.chkRow}>
                        <input type="checkbox" checked={diferencial2Pagado} onChange={e => setDiferencial2Pagado(e.target.checked)} style={S.chk} />
                        <span style={{ fontSize: '0.84rem' }}>¿Pagó el diferencial del 2% de aportes?</span>
                      </label>
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#94a3b8' }}>
                        {diferencial2Pagado
                          ? 'El período antes de Jun/2015 se transforma en insalubre.'
                          : 'Cargo deudor — puede pagar el 2% para transformar ese período en insalubre.'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ─ 3. ANSES ─ */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={S.h3}>3. Servicios en ANSES (Nación)</div>
                <button style={{ ...S.btn, background: '#1e40af', color: '#fff', padding: '6px 14px', fontSize: '0.78rem' }}
                  onClick={agregarAnses}>+ Agregar línea ANSES</button>
              </div>

              {serviciosAnses.length === 0 && (
                <p style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'center', padding: '8px 0' }}>
                  Sin servicios ANSES cargados
                </p>
              )}

              {serviciosAnses.map((a, i) => (
                <FilaFecha key={i}
                  prefijo="anses" idx={i}
                  fechaDesde={a.fecha_desde} fechaHasta={a.fecha_hasta} esInsalubre={a.es_insalubre}
                  onDesde={v  => updateAnses(i, 'fecha_desde',  v)}
                  onHasta={v  => updateAnses(i, 'fecha_hasta',  v)}
                  onInsalubre={v => updateAnses(i, 'es_insalubre', v)}
                  onEliminar={() => eliminarAnses(i)}
                />
              ))}

              {serviciosAnses.length > 0 && (
                <div style={{ marginTop: 4, fontSize: '0.74rem', color: '#94a3b8' }}>
                  ⚠ Si las fechas coinciden con el IPS u otro servicio, se detectará superposición automáticamente.
                </div>
              )}
            </div>

            {/* ─ 4. Otros organismos ─ */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={S.h3}>4. Otros Organismos / Municipios / Ministerios</div>
                <button style={{ ...S.btn, background: '#1e40af', color: '#fff', padding: '6px 14px', fontSize: '0.78rem' }}
                  onClick={agregarExterno}>+ Agregar</button>
              </div>

              {serviciosExternos.length === 0 && (
                <p style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'center', padding: '8px 0' }}>
                  Sin servicios externos cargados
                </p>
              )}

              {serviciosExternos.map((ext, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ marginBottom: 8 }}>
                    <label style={S.label}>Organismo / Municipio / Ministerio</label>
                    <input style={S.input} placeholder="Nombre del organismo" value={ext.organismo}
                      onChange={e => updateExterno(i, 'organismo', e.target.value)} />
                  </div>
                  <FilaFecha
                    prefijo="ext" idx={i}
                    fechaDesde={ext.fecha_desde} fechaHasta={ext.fecha_hasta} esInsalubre={ext.es_insalubre}
                    onDesde={v  => updateExterno(i, 'fecha_desde',  v)}
                    onHasta={v  => updateExterno(i, 'fecha_hasta',  v)}
                    onInsalubre={v => updateExterno(i, 'es_insalubre', v)}
                    onEliminar={() => eliminarExterno(i)}
                  />
                </div>
              ))}
            </div>

            {/* ─ Botón calcular ─ */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <button style={{ ...S.btn, background: calculando ? '#374151' : '#7c3aed', color: '#fff', padding: '11px 36px', fontSize: '0.96rem' }}
                onClick={() => calcular()} disabled={calculando}>
                {calculando ? '⏳ Calculando...' : '🔢 Calcular Jubilación'}
              </button>
            </div>

            {/* ─ RESULTADO ─ */}
            {resultado && (() => {
              const R = resultado;

              // Construir ids para resolución de empates — mismo orden que backend
              const ansesValidos   = serviciosAnses.filter(s => s.fecha_desde && s.fecha_hasta);
              const externosValidos = serviciosExternos.filter(s => s.organismo.trim() && s.fecha_desde && s.fecha_hasta);
              const todosIds: { id: string; label: string }[] = [
                ...ansesValidos.map((a, i) => ({ id: `ANSES_${i}`, label: `ANSES (${fmtFecha(a.fecha_desde)} → ${fmtFecha(a.fecha_hasta)})` })),
                ...externosIds(externosValidos),
              ];
              function externosIds(exts: ServicioExterno[]) {
                return exts.map((e, i) => ({ id: `EXT_${i}`, label: e.organismo }));
              }

              const empatesSinResolver = R.superpuestos.filter(sp => sp.empate);

              return (
                <>
                  {/* Empates pendientes */}
                  {empatesSinResolver.length > 0 && (
                    <div style={{ ...S.card, border: '1px solid #92400e' }}>
                      <div style={S.h3}>⚖️ Empates — Selección manual requerida</div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 12 }}>
                        El servicio prorateado es igual en ambas cajas. Elegí cuál gana cada período superpuesto:
                      </div>
                      {empatesSinResolver.map((sp, i) => {
                        // Extraer los dos ids del organismo "A ↔ B"
                        const partes = sp.organismo.split(' ↔ ');
                        const rawA = partes[0].trim();
                        const rawB = partes[1]?.trim() ?? '';
                        // Buscar id en todosIds por label, o usar 'IPS'
                        const findId = (label: string) => {
                          if (label === 'IPS') return 'IPS';
                          return todosIds.find(x => x.label === label)?.id ?? label;
                        };
                        const idA = findId(rawA);
                        const idB = findId(rawB);
                        const key = `${idA}|${idB}`;
                        return (
                          <div key={i} style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
                            <div style={{ fontWeight: 700, color: '#fef08a', fontSize: '0.82rem', marginBottom: 6 }}>
                              {sp.organismo} — {fmtPeriodo(sp)} superpuestos
                            </div>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>¿Quién gana?</span>
                              <button
                                style={{ ...S.btn, background: resolucionesManuales[key] === idA ? '#166534' : '#1e293b', color: resolucionesManuales[key] === idA ? '#86efac' : '#e2e8f0', padding: '5px 14px', fontSize: '0.8rem' }}
                                onClick={() => resolverEmpate(key, idA)}
                              >{rawA}</button>
                              <button
                                style={{ ...S.btn, background: resolucionesManuales[key] === idB ? '#166534' : '#1e293b', color: resolucionesManuales[key] === idB ? '#86efac' : '#e2e8f0', padding: '5px 14px', fontSize: '0.8rem' }}
                                onClick={() => resolverEmpate(key, idB)}
                              >{rawB}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Veredicto */}
                  <div style={{ ...S.card, border: `1px solid ${R.tipo_jubilacion ? '#166534' : R.hay_empates ? '#92400e' : '#7c2d12'}` }}>
                    <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                      {R.corresponde_anses ? (
                        <>
                          <div style={{ fontSize: '2rem', marginBottom: 8 }}>ℹ️</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#93c5fd', marginBottom: 6 }}>CORRESPONDE ANSES</div>
                          <div style={S.tagBlue}>ANSES tiene mayor aporte bruto que IPS</div>
                          <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#94a3b8' }}>
                            IPS bruto: {fmtPeriodo(R.ips_bruto)} · ANSES bruto: {fmtPeriodo(R.anses_bruto)}
                          </div>
                        </>
                      ) : R.hay_empates ? (
                        <>
                          <div style={{ fontSize: '2rem', marginBottom: 8 }}>⚖️</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fef08a', marginBottom: 6 }}>RESOLUCIÓN PENDIENTE</div>
                          <div style={S.tagYellow}>Resolución manual requerida para calcular el resultado final</div>
                        </>
                      ) : R.tipo_jubilacion ? (
                        <>
                          <div style={{ fontSize: '2rem', marginBottom: 8 }}>✅</div>
                          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#86efac', marginBottom: 6 }}>REÚNE CONDICIONES</div>
                          <div style={S.tagGreen}>{TIPOS_JUBILACION[R.tipo_jubilacion] ?? R.tipo_jubilacion}</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏳</div>
                          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fca5a5', marginBottom: 6 }}>AÚN NO REÚNE CONDICIONES</div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                            {!R.cumple_servicio && <div style={S.tagRed}>Le faltan: {fmtPeriodo(R.falta_servicio)} de servicio</div>}
                            {!R.cumple_edad     && <div style={S.tagRed}>Le faltan: {fmtPeriodo(R.falta_edad)} de edad</div>}
                          </div>
                        </>
                      )}
                    </div>
                    {!R.hay_empates && !R.corresponde_anses && (
                      <div style={S.grid2}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
                            <span>Servicio computable</span>
                            <span style={{ fontWeight: 700, color: R.cumple_servicio ? '#86efac' : '#fca5a5' }}>{R.pct_servicio_completado}%</span>
                          </div>
                          <Barra pct={R.pct_servicio_completado} color={R.cumple_servicio ? '#16a34a' : '#b45309'} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
                            <span>Edad requerida</span>
                            <span style={{ fontWeight: 700, color: R.cumple_edad ? '#86efac' : '#fca5a5' }}>{R.pct_edad_completada}%</span>
                          </div>
                          <Barra pct={R.pct_edad_completada} color={R.cumple_edad ? '#16a34a' : '#b45309'} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Detalle de servicios */}
                  <div style={S.card}>
                    <div style={S.h3}>Detalle de Servicios Computados</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.81rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          {['Concepto', 'Años', 'Meses', 'Días', 'Tipo', 'Estado'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {([
                          {
                            concepto: `Comparación bruta — Caja: ${R.caja_jubilatoria}`,
                            p: R.caja_jubilatoria === 'ANSES' ? R.anses_bruto : R.ips_bruto,
                            tipo: R.caja_jubilatoria,
                            estado: R.corresponde_anses ? 'Corresponde ANSES' : 'Base IPS',
                          },
                          // Beca
                          R.tiene_beca && !isZero(R.servicio_beca) ? {
                            concepto: `IPS — Período beca${R.beca_aporto ? ' (aportó)' : ' (sin aportes)'}`,
                            p: R.servicio_beca,
                            tipo: R.beca_aporto ? 'Insalubre' : '—',
                            estado: R.beca_aporto ? 'Computa' : 'Sin aportes',
                          } : null,
                          // Nombrado
                          !isZero(R.servicio_nombrado) ? {
                            concepto: `IPS — Nombrado${R.tiene_beca ? '' : ' / ingreso'}`,
                            p: R.servicio_nombrado,
                            tipo: R.es_insalubre_efectivo ? 'Insalubre' : 'Mixto',
                            estado: R.sin_aportes ? 'Sin aportes' : 'Computa',
                          } : null,
                          !isZero(R.servicio_nombrado_antes_2015) ? {
                            concepto: '  └ Antes Jun/2015 (14%)',
                            p: R.servicio_nombrado_antes_2015,
                            tipo: R.es_insalubre_efectivo ? 'Insalubre' : 'Común',
                            estado: R.cargo_deudor_2pct ? '⚠ Puede pagar 2%' : 'OK',
                          } : null,
                          !isZero(R.servicio_nombrado_desde_2015) ? {
                            concepto: '  └ Desde Jun/2015 (16%)',
                            p: R.servicio_nombrado_desde_2015,
                            tipo: 'Insalubre',
                            estado: 'OK',
                          } : null,
                          // IPS neto
                          R.superpuestos.some(s => !s.empate && s.ganador !== 'IPS') && !isZero(R.servicio_ips_ajustado) ? {
                            concepto: '  ✦ IPS neto (post-superpuesto)',
                            p: R.servicio_ips_ajustado,
                            tipo: R.es_insalubre_efectivo ? 'Insalubre' : 'Mixto',
                            estado: 'Computa',
                          } : null,
                          // ANSES neto
                          !isZero(R.anses_neto) ? {
                            concepto: 'ANSES — total neto (sin superpuesto)',
                            p: R.anses_neto,
                            tipo: ansesValidos.some(a => a.es_insalubre) ? 'Mixto' : 'Común',
                            estado: 'Computa',
                          } : null,
                          // Externos
                          ...externosValidos.map(e => ({
                            concepto: e.organismo,
                            p: { anios: 0, meses: 0, dias: 0 } as Periodo,
                            tipo: e.es_insalubre ? 'Insalubre' : 'Común',
                            estado: 'Computa',
                          })),
                          // Superpuestos
                          ...R.superpuestos.map(sp => ({
                            concepto: `${sp.empate ? '⚖️' : '⚠'} SUPERP.: ${sp.organismo}`,
                            p: sp as Periodo,
                            tipo: '—',
                            estado: sp.empate ? 'Pendiente' : `Gana ${sp.ganador}`,
                          })),
                        ] as any[]).filter(Boolean).map((row: any, i: number) => (
                          <tr key={i} style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            background: row.estado?.startsWith('Gana') ? 'rgba(239,68,68,0.07)'
                              : row.estado === 'Pendiente' ? 'rgba(234,179,8,0.08)'
                              : row.estado === 'Sin aportes' ? 'rgba(100,116,139,0.06)'
                              : 'transparent',
                          }}>
                            <td style={{ padding: '7px 10px', color: '#e2e8f0' }}>{row.concepto}</td>
                            <td style={{ padding: '7px 10px', fontWeight: 700 }}>{row.p.anios}</td>
                            <td style={{ padding: '7px 10px' }}>{row.p.meses}</td>
                            <td style={{ padding: '7px 10px' }}>{row.p.dias}</td>
                            <td style={{ padding: '7px 10px' }}>
                              {row.tipo === 'Insalubre' ? <span style={S.tagOrange}>{row.tipo}</span>
                                : row.tipo === 'Común'   ? <span style={S.tagBlue}>{row.tipo}</span>
                                : row.tipo === 'Mixto'   ? <span style={S.tagGray}>Común/Ins.</span>
                                : <span style={{ color: '#64748b' }}>{row.tipo}</span>}
                            </td>
                            <td style={{ padding: '7px 10px', fontSize: '0.75rem', color:
                              row.estado?.startsWith('Gana') ? '#fca5a5'
                              : row.estado === 'Pendiente' ? '#fef08a'
                              : row.estado?.startsWith('⚠') ? '#fdba74'
                              : row.estado === 'Sin aportes' ? '#64748b'
                              : '#86efac'
                            }}>
                              {row.estado}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {R.superpuestos.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        {R.superpuestos.map((sp, i) => (
                          <div key={i} style={{ background: sp.empate ? 'rgba(234,179,8,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${sp.empate ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 8, padding: '8px 14px', marginBottom: 6, fontSize: '0.78rem' }}>
                            <strong style={{ color: sp.empate ? '#fef08a' : '#fca5a5' }}>Superposición {sp.organismo}:</strong>{' '}
                            <span style={{ color: '#94a3b8' }}>{fmtPeriodo(sp)} de aportes simultáneos. </span>
                            {sp.empate
                              ? <span style={{ color: '#fef08a' }}>Empate — selección manual requerida.</span>
                              : <><span style={{ color: '#fdba74' }}>Gana <strong>{sp.ganador}</strong> — {sp.motivo}.</span>
                                 <span style={{ color: '#94a3b8' }}> El resto de la caja perdedora continúa computando.</span></>
                            }
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Totales */}
                  <div style={{ ...S.grid3, marginBottom: 16 }}>
                    {[
                      { label: 'Total insalubre',      p: R.total_insalubre,  color: '#fb923c' },
                      { label: 'Total común',           p: R.total_comun,      color: '#60a5fa' },
                      { label: 'Total prorateado (tabla)', p: R.total_prorateado, color: '#a78bfa' },
                    ].map(({ label, p, color }) => (
                      <div key={label} style={{ ...S.card, borderColor: color + '44', marginBottom: 0 }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color }}>
                          {p.anios}<span style={{ fontSize: '0.85rem', fontWeight: 400, color: '#94a3b8', marginLeft: 2 }}>a</span>
                          {' '}{p.meses}<span style={{ fontSize: '0.85rem', fontWeight: 400, color: '#94a3b8', marginLeft: 2 }}>m</span>
                          {' '}{p.dias}<span style={{ fontSize: '0.85rem', fontWeight: 400, color: '#94a3b8', marginLeft: 2 }}>d</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Alertas */}
                  {(R.cargo_deudor_2pct || R.sin_aportes) && (
                    <div style={S.card}>
                      <div style={S.h3}>⚠️ Alertas</div>
                      {R.cargo_deudor_2pct && (
                        <InfoBox color="#fdba74">
                          <strong style={{ color: '#fdba74' }}>Diferencial de aportes 2% disponible</strong><br />
                          <span style={{ color: '#94a3b8' }}>
                            El agente tiene {fmtPeriodo(R.cargo_deudor_periodo)} de servicio antes de Jun/2015
                            computado como Común. Pagando el diferencial del 2% ese período se transforma en Insalubre.
                          </span>
                        </InfoBox>
                      )}
                      {R.sin_aportes && (
                        <InfoBox color="#fca5a5">
                          <strong style={{ color: '#fca5a5' }}>Sin aportes al IPS</strong><br />
                          <span style={{ color: '#94a3b8' }}>La situación de revista actual ({situacion}) no genera aportes al IPS.</span>
                        </InfoBox>
                      )}
                    </div>
                  )}

                  {/* Observaciones + acciones */}
                  <div style={S.card}>
                    <label htmlFor="ht-obs" style={S.h3}>Observaciones</label>
                    <textarea
                      id="ht-obs"
                      style={{ ...S.input, minHeight: 80, resize: 'vertical' as const }}
                      placeholder="Notas adicionales (opcional)..."
                      value={observaciones}
                      onChange={e => setObservaciones(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                      <button style={{ ...S.btn, background: guardando ? '#374151' : '#166534', color: '#86efac' }}
                        onClick={guardar} disabled={guardando || R.hay_empates}>
                        {guardando ? '⏳ Guardando...' : '💾 Guardar cálculo'}
                      </button>
                      <button style={{ ...S.btn, background: '#1e3a5f', color: '#93c5fd' }} onClick={exportarExcel}>
                        📊 Exportar Excel
                      </button>
                      {historial.length > 0 && (
                        <button style={{ ...S.btn, background: '#312e81', color: '#c4b5fd', fontSize: '0.8rem' }}
                          onClick={() => setVerHistorial(v => !v)}>
                          🕒 {verHistorial ? 'Ocultar' : 'Ver'} historial ({historial.length})
                        </button>
                      )}
                    </div>
                    {R.hay_empates && (
                      <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#fef08a' }}>
                        Resolvé los empates antes de guardar.
                      </div>
                    )}
                  </div>

                  {/* Historial */}
                  {verHistorial && historial.length > 0 && (
                    <div style={S.card}>
                      <div style={S.h3}>Historial de cálculos guardados</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            {['Fecha', 'Situación', 'Insalubre', 'Tipo jubilación', 'Total prorateado', 'Cargo deudor', 'Guardado por'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: '#64748b', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {historial.map((h: any) => {
                            const r: Resultado | null = h.resultado
                              ? (typeof h.resultado === 'string' ? JSON.parse(h.resultado) : h.resultado)
                              : null;
                            return (
                              <tr key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <td style={{ padding: '6px 8px' }}>{fmtFecha(h.created_at)}</td>
                                <td style={{ padding: '6px 8px' }}>{h.situacion_revista}</td>
                                <td style={{ padding: '6px 8px' }}>{h.es_insalubre_ips ? <span style={S.tagOrange}>Sí</span> : <span style={{ color: '#64748b' }}>No</span>}</td>
                                <td style={{ padding: '6px 8px' }}>
                                  {r?.tipo_jubilacion
                                    ? <span style={S.tagGreen}>{r.tipo_jubilacion}</span>
                                    : <span style={S.tagRed}>No cumple</span>}
                                </td>
                                <td style={{ padding: '6px 8px' }}>{r ? fmtPeriodo(r.total_prorateado) : '—'}</td>
                                <td style={{ padding: '6px 8px' }}>{r?.cargo_deudor_2pct ? <span style={S.tagOrange}>Sí</span> : <span style={{ color: '#64748b' }}>No</span>}</td>
                                <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{h.creado_por_nombre ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}

        {!agente && (
          <div style={{ textAlign: 'center', color: '#475569', padding: '60px 0', fontSize: '0.9rem' }}>
            Buscá un agente para comenzar el cálculo.
          </div>
        )}
        </>)}

        {/* ─ Tab: Posibles Jubilados ─ */}
        {tab === 'posibles' && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📋 Posibles Jubilados</h1>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
                Registro de agentes identificados para trámite de jubilación
              </p>
            </div>

            {/* Buscar y agregar */}
            <div style={S.card}>
              <div style={S.h3}>Agregar agente al registro</div>
              <div style={{ position: 'relative' }}>
                <input
                  aria-label="Buscar agente por apellido, nombre o DNI"
                  style={S.input}
                  placeholder="Apellido, nombre o DNI..."
                  value={pjBusqueda}
                  onChange={e => onPjBusquedaChange(e.target.value)}
                />
                {pjBuscando && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '0.75rem' }}>Buscando...</span>
                )}
                {pjSugerencias.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, zIndex: 100, maxHeight: 260, overflowY: 'auto' }}>
                    {pjSugerencias.map((s, i) => (
                      <div key={i} onClick={() => seleccionarPjAgente(s)}
                        style={{ padding: '9px 14px', cursor: 'pointer', fontSize: '0.84rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <strong>{s.apellido}, {s.nombre}</strong>
                        <span style={{ color: '#64748b', marginLeft: 10, fontSize: '0.75rem' }}>DNI {s.dni} · {s.ley_nombre ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {pjAgente && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{pjAgente.apellido}, {pjAgente.nombre}</span>
                    <span style={{ color: '#64748b', marginLeft: 10, fontSize: '0.78rem' }}>DNI {pjAgente.dni} · {pjAgente.ley_nombre ?? '—'}</span>
                  </div>
                  <div style={{ width: 150 }}>
                    <label style={S.label}>Fecha</label>
                    <select style={S.select} value={pjMesCorte} onChange={e => setPjMesCorte(e.target.value)}>
                      <option value="MARZO">Marzo</option>
                      <option value="JUNIO">Junio</option>
                      <option value="SEPTIEMBRE">Septiembre</option>
                      <option value="DICIEMBRE">Diciembre</option>
                    </select>
                  </div>
                  <button
                    style={{ ...S.btn, background: pjGuardando ? '#374151' : '#166534', color: '#86efac', padding: '7px 18px' }}
                    onClick={agregarPosible}
                    disabled={pjGuardando}
                  >
                    {pjGuardando ? '⏳ Agregando...' : '➕ Agregar al registro'}
                  </button>
                </div>
              )}
            </div>

            {/* Listado */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={S.h3}>Registro de posibles jubilados</div>
                <button onClick={cargarPosibles} style={{ ...S.btn, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', padding: '5px 12px', fontSize: '0.76rem' }}>
                  🔄 Actualizar
                </button>
              </div>

              {/* Filtros por estado */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {(['', 'IDENTIFICADO', 'EN_TRAMITE', 'JUBILADO', 'DESCARTADO'] as const).map(e => (
                  <button key={e || 'all'} onClick={() => setPjFiltro(e)}
                    style={{ ...S.btn, padding: '5px 12px', fontSize: '0.76rem',
                      background: pjFiltro === e ? '#4c1d95' : 'rgba(255,255,255,0.05)',
                      color:      pjFiltro === e ? '#c4b5fd' : '#94a3b8',
                      border:     pjFiltro === e ? '1px solid #7c3aed' : '1px solid rgba(255,255,255,0.08)',
                    }}>
                    {e === '' ? 'Todos' : pjEstadoLabel(e)}
                    {e === '' && pjLista.length > 0 && <span style={{ marginLeft: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 99, padding: '1px 7px', fontSize: '0.7rem' }}>{pjLista.length}</span>}
                    {e !== '' && pjLista.filter((p: any) => p.estado === e).length > 0 && (
                      <span style={{ marginLeft: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 99, padding: '1px 7px', fontSize: '0.7rem' }}>{pjLista.filter((p: any) => p.estado === e).length}</span>
                    )}
                  </button>
                ))}
              </div>

              {pjCargando ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '0.85rem' }}>Cargando...</div>
              ) : pjListaFiltrada.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0', fontSize: '0.85rem' }}>
                  {pjFiltro ? `Sin registros con estado "${pjEstadoLabel(pjFiltro)}"` : 'No hay posibles jubilados registrados'}
                </div>
              ) : (
                <div>
                  {pjListaFiltrada.map((pj: any) => (
                    <div key={pj.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '12px 16px', marginBottom: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
                      {pjEditId === pj.id ? (
                        /* Modo edición */
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: '0.88rem' }}>
                            {pj.apellido}, {pj.nombre}
                            <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 10, fontSize: '0.76rem' }}>DNI {pj.dni}</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 10 }}>
                            <div>
                              <label style={S.label}>Estado</label>
                              <select style={S.select} value={pjEditEstado} onChange={e => setPjEditEstado(e.target.value)}>
                                <option value="IDENTIFICADO">Identificado</option>
                                <option value="EN_TRAMITE">En trámite</option>
                                <option value="JUBILADO">Jubilado</option>
                                <option value="DESCARTADO">Descartado</option>
                              </select>
                            </div>
                            <div>
                              <label style={S.label}>Fecha</label>
                              <select style={S.select} value={pjEditMesCorte} onChange={e => setPjEditMesCorte(e.target.value)}>
                                <option value="MARZO">Marzo</option>
                                <option value="JUNIO">Junio</option>
                                <option value="SEPTIEMBRE">Septiembre</option>
                                <option value="DICIEMBRE">Diciembre</option>
                              </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                              <button style={{ ...S.btn, background: pjGuardando ? '#374151' : '#166534', color: '#86efac', flex: 1 }}
                                onClick={() => guardarPjEdit(pj.id)} disabled={pjGuardando}>
                                {pjGuardando ? '⏳' : '💾 Guardar'}
                              </button>
                              <button style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}
                                onClick={() => setPjEditId(null)}>Cancelar</button>
                            </div>
                          </div>
                          <div>
                            <label style={S.label}>Observaciones</label>
                            <textarea style={{ ...S.input, minHeight: 64, resize: 'vertical' as const }}
                              value={pjEditObs} onChange={e => setPjEditObs(e.target.value)}
                              placeholder="Observaciones opcionales..." />
                          </div>
                        </div>
                      ) : (
                        /* Modo vista */
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 4 }}>
                              {pj.apellido}, {pj.nombre}
                              <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 10, fontSize: '0.75rem' }}>DNI {pj.dni}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 3 }}>
                              <span style={pjEstadoStyle(pj.estado)}>{pjEstadoLabel(pj.estado)}</span>
                              <span style={{ ...S.tagGray, color: pj.mes_corte ? '#c4b5fd' : '#64748b' }}>Fecha: {pjMesCorteLabel(pj.mes_corte)}</span>
                              {pj.ley_nombre      && <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{pj.ley_nombre}</span>}
                              {pj.tipo_jubilacion && <span style={{ fontSize: '0.74rem', color: '#a78bfa' }}>{pj.tipo_jubilacion}</span>}
                              {pj.es_insalubre    && <span style={S.tagOrange}>Insalubre</span>}
                            </div>
                            {pj.observaciones && (
                              <div style={{ fontSize: '0.74rem', color: '#94a3b8', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                "{pj.observaciones}"
                              </div>
                            )}
                            <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 2 }}>
                              Agregado: {fmtFecha(pj.created_at)}
                              {pj.creado_por_nombre && ` · por ${pj.creado_por_nombre}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button onClick={() => abrirPjEdit(pj)}
                              style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#94a3b8', padding: '5px 12px', fontSize: '0.76rem' }}>
                              ✏️ Editar
                            </button>
                            <button onClick={() => eliminarPosible(pj.id)}
                              style={{ ...S.btn, background: '#450a0a', color: '#fca5a5', padding: '5px 10px', fontSize: '0.76rem' }}>
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
