// src/pages/HerramientasPage/index.tsx
// Calculadora de Jubilación IPS — Leyes 10471/10430 · Decretos 598/2015, 58/2015, 1554/2022

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Layout }         from '../../components/Layout';
import { apiFetch }       from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel }  from '../../utils/export';
import { useToast }                     from '../../ui/toast';
import { AlertaBannerAgenteConMensaje } from '../../components/AlertaBannerAgente';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface ServicioExterno {
  organismo:    string;
  anios:        number;
  meses:        number;
  dias:         number;
  es_insalubre: boolean;
}

interface Periodo { anios: number; meses: number; dias: number }

interface Superpuesto extends Periodo {
  organismo: string;
  ganador:   string;
  motivo:    string;
}

interface Resultado {
  edad_actual:                  Periodo | null;
  tiene_beca:                   boolean;
  beca_aporto:                  boolean;
  sin_aportes:                  boolean;
  servicio_beca:                Periodo;
  servicio_beca_antes_2015:     Periodo;
  servicio_beca_desde_2015:     Periodo;
  servicio_nombrado:            Periodo;
  servicio_nombrado_antes_2015: Periodo;
  servicio_nombrado_desde_2015: Periodo;
  servicio_ips:                 Periodo;
  servicio_ips_antes_2015:      Periodo;
  servicio_ips_desde_2015:      Periodo;
  servicio_ips_ajustado:        Periodo;
  es_insalubre_efectivo:        boolean;
  diferencial_2pct_pagado:      boolean;
  cargo_deudor_2pct:            boolean;
  cargo_deudor_periodo:         Periodo;
  anses_neto:                   Periodo;
  superpuestos:                 Superpuesto[];
  total_insalubre:              Periodo;
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

const S: Record<string, React.CSSProperties> = {
  card:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 20, marginBottom: 16 },
  label:     { fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:     { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  select:    { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  btn:       { cursor: 'pointer', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.84rem', border: 'none' },
  grid2:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  grid3:     { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
  grid4:     { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 },
  h3:        { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12, color: '#94a3b8' },
  tagGreen:  { background: '#14532d', color: '#86efac', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagRed:    { background: '#450a0a', color: '#fca5a5', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagOrange: { background: '#431407', color: '#fdba74', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagBlue:   { background: '#0c1a4a', color: '#93c5fd', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagPurple: { background: '#2e1065', color: '#d8b4fe', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  tagGray:   { background: '#1e293b', color: '#94a3b8', borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' },
  chkRow:    { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 6 },
  chk:       { width: 17, height: 17, cursor: 'pointer', flexShrink: 0 },
};

const TIPOS_JUBILACION: Record<string, string> = {
  ORDINARIA:            '✅ Jubilación Ordinaria (60 años / 35 años servicio)',
  AGOTAMIENTO_PREMATURO:'⚡ Agotamiento Prematuro (50 años / 25 años servicio)',
  PRORRATEO:            '⚖️ Prorrateo Mixto (Decreto 1554/2022)',
};

const SITUACIONES = [
  { value: 'NORMAL',      label: 'Normal (planta permanente)' },
  { value: 'BECADO',      label: 'Becado' },
  { value: 'RESIDENTE',   label: 'Residente (sin aportes IPS)' },
  { value: 'ARTICULO_48', label: 'Artículo 48 (sin aportes IPS)' },
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

// ── Componente principal ──────────────────────────────────────────────────────
export function HerramientasPage() {
  const toast = useToast();

  // búsqueda
  const [busqueda,    setBusqueda]    = useState('');
  const [sugerencias, setSugerencias] = useState<any[]>([]);
  const [agente,      setAgente]      = useState<AgenteInfo | null>(null);
  const [buscando,    setBuscando]    = useState(false);
  const busqTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // form — situación IPS
  const [situacion,          setSituacion]          = useState<string>('NORMAL');
  const [becaAporto,         setBecaAporto]         = useState(false);
  const [esInsalubreIPS,     setEsInsalubreIPS]     = useState(false);
  const [diferencial2Pagado, setDiferencial2Pagado] = useState(false);

  // ANSES
  const [ansesAnios,     setAnsesAnios]     = useState(0);
  const [ansesMeses,     setAnsesMeses]     = useState(0);
  const [ansesDias,      setAnsesDias]      = useState(0);
  const [ansesInsalubre, setAnsesInsalubre] = useState(false);

  // externos
  const [externos, setExternos] = useState<ServicioExterno[]>([]);

  // resultado
  const [resultado,     setResultado]     = useState<Resultado | null>(null);
  const [calculando,    setCalculando]    = useState(false);
  const [guardando,     setGuardando]     = useState(false);
  const [observaciones, setObservaciones] = useState('');

  // historial
  const [historial,    setHistorial]    = useState<any[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);

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
    try {
      // Usar el endpoint específico del módulo jubilación para tener todos los campos
      const res  = await apiFetch<any>(`/jubilacion/agente-datos/${ag.dni}`);
      const d    = res?.data;
      if (!d) { toast.error('No se encontraron datos del agente'); return; }

      setAgente(d);
      // Auto-sugerir situación y si es insalubre (viene de ocupaciones.es_insalubre)
      setSituacion(d.situacion_sugerida ?? 'NORMAL');
      setEsInsalubreIPS(!!d.ocupacion_es_insalubre);
      setBecaAporto(false);
      setDiferencial2Pagado(false);
      setAnsesAnios(0); setAnsesMeses(0); setAnsesDias(0);
      setAnsesInsalubre(false);
      setExternos([]);
      setObservaciones('');

      // Historial previo
      const hist = await apiFetch<any>(`/jubilacion/agente/${d.dni}`);
      setHistorial(hist?.data ?? []);
    } catch (e: any) {
      toast.error('Error cargando agente: ' + e?.message);
    }
  }, [toast]);

  // Detectar beca (fecha_ingreso anterior a fecha_de_nombramiento)
  const tieneBeca = !!(
    agente?.fecha_ingreso &&
    agente?.fecha_de_nombramiento &&
    new Date(agente.fecha_ingreso) < new Date(agente.fecha_de_nombramiento)
  );

  // ── Externos ──────────────────────────────────────────────────────────────
  const agregarExterno = () =>
    setExternos(p => [...p, { organismo: '', anios: 0, meses: 0, dias: 0, es_insalubre: false }]);
  const updateExterno = (i: number, f: keyof ServicioExterno, v: any) =>
    setExternos(p => p.map((e, idx) => idx === i ? { ...e, [f]: v } : e));
  const eliminarExterno = (i: number) =>
    setExternos(p => p.filter((_, idx) => idx !== i));

  // ── Payload helper ────────────────────────────────────────────────────────
  const buildPayload = () => ({
    dni:                     agente!.dni,
    situacion_revista:       situacion,
    beca_aporto:             becaAporto,
    es_insalubre_ips:        esInsalubreIPS,
    diferencial_2pct_pagado: diferencial2Pagado,
    anses_anios:             ansesAnios,
    anses_meses:             ansesMeses,
    anses_dias:              ansesDias,
    anses_insalubre:         ansesInsalubre,
    servicios_externos:      externos.filter(e => e.organismo.trim()),
  });

  // ── Calcular ──────────────────────────────────────────────────────────────
  const calcular = async () => {
    if (!agente) return;
    setCalculando(true);
    try {
      const res = await apiFetch<any>('/jubilacion/calcular', {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      });
      if (res?.ok) setResultado(res.resultado);
      else toast.error(res?.error ?? 'Error en cálculo');
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setCalculando(false); }
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
    filas.push({ Sección: 'Agente', Dato: 'DNI', Valor: agente.dni });
    filas.push({ Sección: 'Agente', Dato: 'Fecha de Nacimiento', Valor: fmtFecha(agente.fecha_nacimiento) });
    filas.push({ Sección: 'Agente', Dato: 'Fecha Ingreso', Valor: fmtFecha(agente.fecha_ingreso) });
    filas.push({ Sección: 'Agente', Dato: 'Fecha Nombramiento', Valor: fmtFecha(agente.fecha_de_nombramiento) });
    filas.push({ Sección: 'Agente', Dato: 'Ley', Valor: agente.ley_nombre ?? '—' });
    filas.push({ Sección: 'Agente', Dato: 'Situación de Revista', Valor: situacion });
    filas.push({ Sección: 'Agente', Dato: 'Edad actual', Valor: fmtPeriodo(R.edad_actual) });

    filas.push({ Sección: '═══ SERVICIOS IPS ═══', Dato: '', Valor: '' });
    if (R.tiene_beca) {
      filas.push({ Sección: 'IPS', Dato: 'Período de beca', Valor: fmtPeriodo(R.servicio_beca) + (R.beca_aporto ? ' (aportó)' : ' (sin aportes)') });
    }
    filas.push({ Sección: 'IPS', Dato: 'Antigüedad como nombrado', Valor: fmtPeriodo(R.servicio_nombrado) });
    filas.push({ Sección: 'IPS', Dato: 'Total IPS (bruto)', Valor: fmtPeriodo(R.servicio_ips) });
    filas.push({ Sección: 'IPS', Dato: 'Antes Jun/2015 (14%)', Valor: fmtPeriodo(R.servicio_ips_antes_2015) });
    filas.push({ Sección: 'IPS', Dato: 'Desde Jun/2015 (16%)', Valor: fmtPeriodo(R.servicio_ips_desde_2015) });
    filas.push({ Sección: 'IPS', Dato: 'Total IPS neto (sin superpuesto)', Valor: fmtPeriodo(R.servicio_ips_ajustado) });
    filas.push({ Sección: 'IPS', Dato: 'Insalubre efectivo', Valor: R.es_insalubre_efectivo ? 'SÍ' : 'NO' });
    filas.push({ Sección: 'IPS', Dato: 'Diferencial 2% pagado', Valor: R.diferencial_2pct_pagado ? 'SÍ' : 'NO' });
    filas.push({ Sección: 'IPS', Dato: 'Cargo deudor 2%', Valor: R.cargo_deudor_2pct ? `SÍ — período: ${fmtPeriodo(R.cargo_deudor_periodo)}` : 'NO' });

    if (ansesAnios + ansesMeses + ansesDias > 0) {
      filas.push({ Sección: '═══ ANSES ═══', Dato: '', Valor: '' });
      filas.push({ Sección: 'ANSES', Dato: 'Servicio cargado', Valor: fmtPeriodo({ anios: ansesAnios, meses: ansesMeses, dias: ansesDias }) });
      filas.push({ Sección: 'ANSES', Dato: 'Neto (sin superpuesto)', Valor: fmtPeriodo(R.anses_neto) });
      filas.push({ Sección: 'ANSES', Dato: 'Insalubre', Valor: ansesInsalubre ? 'SÍ' : 'NO' });
    }

    for (const ext of externos.filter(e => e.organismo.trim())) {
      filas.push({ Sección: 'Externo', Dato: ext.organismo, Valor: fmtPeriodo(ext) + (ext.es_insalubre ? ' (insalubre)' : ' (común)') });
    }

    if (R.superpuestos.length) {
      filas.push({ Sección: '═══ SUPERPUESTOS ═══', Dato: '', Valor: '' });
      for (const sp of R.superpuestos) {
        filas.push({ Sección: 'Superpuesto', Dato: sp.organismo, Valor: `${fmtPeriodo(sp)} — Gana: ${sp.ganador} (${sp.motivo})` });
      }
    }

    filas.push({ Sección: '═══ TOTALES ═══', Dato: '', Valor: '' });
    filas.push({ Sección: 'Totales', Dato: 'Total insalubre', Valor: fmtPeriodo(R.total_insalubre) });
    filas.push({ Sección: 'Totales', Dato: 'Total común', Valor: fmtPeriodo(R.total_comun) });
    filas.push({ Sección: 'Totales', Dato: 'Total prorateado (×1,4)', Valor: fmtPeriodo(R.total_prorateado) });

    filas.push({ Sección: '═══ RESULTADO ═══', Dato: '', Valor: '' });
    filas.push({ Sección: 'Resultado', Dato: 'Tipo de jubilación', Valor: R.tipo_jubilacion ? TIPOS_JUBILACION[R.tipo_jubilacion] ?? R.tipo_jubilacion : 'AÚN NO ALCANZA' });
    filas.push({ Sección: 'Resultado', Dato: 'Cumple servicio', Valor: R.cumple_servicio ? 'SÍ' : 'NO' });
    filas.push({ Sección: 'Resultado', Dato: 'Cumple edad', Valor: R.cumple_edad ? 'SÍ' : 'NO' });
    if (!R.cumple_servicio) filas.push({ Sección: 'Falta', Dato: 'Servicio', Valor: fmtPeriodo(R.falta_servicio) });
    if (!R.cumple_edad)    filas.push({ Sección: 'Falta', Dato: 'Edad', Valor: fmtPeriodo(R.falta_edad) });
    if (observaciones) filas.push({ Sección: 'Observaciones', Dato: '', Valor: observaciones });

    exportToExcel(`jubilacion_${agente.apellido}_${agente.nombre}_${new Date().toISOString().slice(0, 10)}`, filas);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Herramientas">
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>⚖️ Calculadora de Jubilación IPS</h1>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
            Leyes 10471 / 10430 · Decretos 598/2015, 58/2015, 1554/2022 · Factor prorrateo ×1,4
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
              {agente.ocupacion_es_insalubre && (
                <div style={{ marginTop: 8, ...S.tagOrange }}>
                  ⚡ Ocupación insalubre detectada automáticamente ({agente.ocupacion_nombre ?? 'sin nombre'})
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
                {/* Col izquierda */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label htmlFor="ht-situacion" style={S.label}>Situación de revista actual</label>
                    <select id="ht-situacion" name="situacion" style={S.select} value={situacion} onChange={e => setSituacion(e.target.value)}>
                      {SITUACIONES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>

                  {/* Beca: solo si hay diferencia de fechas */}
                  {tieneBeca && (
                    <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#fdba74', fontWeight: 700, marginBottom: 8 }}>
                        PERÍODO DE BECA ({fmtFecha(agente.fecha_ingreso)} → {fmtFecha(agente.fecha_de_nombramiento)})
                      </div>
                      <label style={S.chkRow}>
                        <input type="checkbox" checked={becaAporto} onChange={e => setBecaAporto(e.target.checked)} style={S.chk} />
                        <span style={{ fontSize: '0.84rem' }}>¿Realizó aportes durante la beca?</span>
                      </label>
                      {!becaAporto && (
                        <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#94a3b8' }}>
                          El período de beca no se contabilizará para la jubilación.
                        </div>
                      )}
                      {becaAporto && (
                        <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#86efac' }}>
                          El período de beca se suma al cómputo previsional.
                        </div>
                      )}
                    </div>
                  )}

                  {situacion === 'RESIDENTE' || situacion === 'ARTICULO_48' ? (
                    <div style={S.tagRed}>Sin aportes al IPS — no computa para jubilación</div>
                  ) : null}
                </div>

                {/* Col derecha: insalubre */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={S.label}>Tareas insalubres / agotamiento prematuro</div>
                    {agente.ocupacion_nombre && (
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: 6 }}>
                        Ocupación registrada: <strong style={{ color: '#e2e8f0' }}>{agente.ocupacion_nombre}</strong>
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
                      <span style={{ fontSize: '0.84rem' }}>
                        Profesión insalubre (Ley 10471 / Decretos 598/2015, 58/2015)
                      </span>
                    </label>
                    {esInsalubreIPS && (
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#fdba74', lineHeight: 1.5 }}>
                        Factor ×1,4 aplicado. Requisito: 50 años / 25 años servicio.<br />
                        Todo el servicio IPS computa como insalubre.
                      </div>
                    )}
                    {!esInsalubreIPS && (
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.5 }}>
                        Desde Jun/2015: insalubre (16%) · Antes de Jun/2015: común (14%)
                      </div>
                    )}
                  </div>

                  {/* Diferencial 2%: solo para NO insalubres con servicio antes de 2015 */}
                  {!esInsalubreIPS && agente.fecha_de_nombramiento && new Date(agente.fecha_de_nombramiento) < new Date(2015, 5, 1) && (
                    <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#a5b4fc', fontWeight: 700, marginBottom: 8 }}>
                        DIFERENCIAL DE APORTES 2% (período {fmtFecha(agente.fecha_de_nombramiento)} → Jun/2015)
                      </div>
                      <label style={S.chkRow}>
                        <input type="checkbox" checked={diferencial2Pagado} onChange={e => setDiferencial2Pagado(e.target.checked)} style={S.chk} />
                        <span style={{ fontSize: '0.84rem' }}>¿Pagó el diferencial del 2% de aportes?</span>
                      </label>
                      <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#94a3b8' }}>
                        {diferencial2Pagado
                          ? 'El período antes de Jun/2015 se transforma en insalubre.'
                          : 'Cargo deudor — puede pagar el 2% para transformar el período antes de Jun/2015 en insalubre.'}
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </div>

            {/* ─ 3. ANSES ─ */}
            <div style={S.card}>
              <div style={S.h3}>3. Servicios en ANSES (Nación)</div>
              <div style={S.grid4}>
                <div>
                  <label htmlFor="ht-anses-anios" style={S.label}>Años</label>
                  <input id="ht-anses-anios" name="ansesAnios" type="number" min={0} max={60} style={S.input} value={ansesAnios}
                    onChange={e => setAnsesAnios(Math.max(0, parseInt(e.target.value) || 0))} />
                </div>
                <div>
                  <label htmlFor="ht-anses-meses" style={S.label}>Meses</label>
                  <input id="ht-anses-meses" name="ansesMeses" type="number" min={0} max={11} style={S.input} value={ansesMeses}
                    onChange={e => setAnsesMeses(Math.min(11, Math.max(0, parseInt(e.target.value) || 0)))} />
                </div>
                <div>
                  <label htmlFor="ht-anses-dias" style={S.label}>Días</label>
                  <input id="ht-anses-dias" name="ansesDias" type="number" min={0} max={30} style={S.input} value={ansesDias}
                    onChange={e => setAnsesDias(Math.min(30, Math.max(0, parseInt(e.target.value) || 0)))} />
                </div>
                <div>
                  <div style={S.label}>¿Insalubre?</div>
                  <label style={{ ...S.chkRow, marginTop: 10 }}>
                    <input type="checkbox" checked={ansesInsalubre} onChange={e => setAnsesInsalubre(e.target.checked)} style={S.chk} />
                    <span style={{ fontSize: '0.82rem' }}>Sí</span>
                  </label>
                </div>
              </div>
              {ansesAnios + ansesMeses + ansesDias > 0 && (
                <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#94a3b8' }}>
                  ⚠ Si los años ANSES coincidieron con el IPS, se detectará superposición.
                  Se contabilizará la caja con mayor aporte; el resto continúa desde donde termina la superposición.
                </div>
              )}
            </div>

            {/* ─ 4. Otros ministerios / intendencias ─ */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={S.h3}>4. Otros Organismos / Ministerios / Intendencias</div>
                <button style={{ ...S.btn, background: '#1e40af', color: '#fff', padding: '6px 14px', fontSize: '0.78rem' }}
                  onClick={agregarExterno}>+ Agregar</button>
              </div>

              {externos.length === 0 && (
                <p style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'center', padding: '12px 0' }}>
                  Sin servicios externos cargados
                </p>
              )}

              {externos.map((ext, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, marginBottom: 8, display: 'grid', gridTemplateColumns: '2fr 80px 80px 80px 100px 40px', gap: 8, alignItems: 'end' }}>
                  <div>
                    <label htmlFor={`ht-ext-${i}-org`} style={S.label}>Organismo / Ministerio</label>
                    <input id={`ht-ext-${i}-org`} name={`ext_${i}_organismo`} style={S.input} placeholder="Nombre del organismo" value={ext.organismo}
                      onChange={e => updateExterno(i, 'organismo', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor={`ht-ext-${i}-anios`} style={S.label}>Años</label>
                    <input id={`ht-ext-${i}-anios`} name={`ext_${i}_anios`} type="number" min={0} max={60} style={S.input} value={ext.anios}
                      onChange={e => updateExterno(i, 'anios', Math.max(0, parseInt(e.target.value) || 0))} />
                  </div>
                  <div>
                    <label htmlFor={`ht-ext-${i}-meses`} style={S.label}>Meses</label>
                    <input id={`ht-ext-${i}-meses`} name={`ext_${i}_meses`} type="number" min={0} max={11} style={S.input} value={ext.meses}
                      onChange={e => updateExterno(i, 'meses', Math.min(11, Math.max(0, parseInt(e.target.value) || 0)))} />
                  </div>
                  <div>
                    <label htmlFor={`ht-ext-${i}-dias`} style={S.label}>Días</label>
                    <input id={`ht-ext-${i}-dias`} name={`ext_${i}_dias`} type="number" min={0} max={30} style={S.input} value={ext.dias}
                      onChange={e => updateExterno(i, 'dias', Math.min(30, Math.max(0, parseInt(e.target.value) || 0)))} />
                  </div>
                  <div>
                    <div style={S.label}>¿Insalubre?</div>
                    <label style={{ ...S.chkRow, marginTop: 8 }}>
                      <input type="checkbox" checked={ext.es_insalubre}
                        onChange={e => updateExterno(i, 'es_insalubre', e.target.checked)} style={S.chk} />
                      <span style={{ fontSize: '0.82rem' }}>Sí</span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button onClick={() => eliminarExterno(i)}
                      style={{ ...S.btn, background: '#450a0a', color: '#fca5a5', padding: '7px 10px', fontSize: '0.82rem' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            {/* ─ Botón calcular ─ */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <button style={{ ...S.btn, background: calculando ? '#374151' : '#7c3aed', color: '#fff', padding: '11px 36px', fontSize: '0.96rem' }}
                onClick={calcular} disabled={calculando}>
                {calculando ? '⏳ Calculando...' : '🔢 Calcular Jubilación'}
              </button>
            </div>

            {/* ─ RESULTADO ─ */}
            {resultado && (() => {
              const R = resultado;
              return (
                <>
                  {/* Veredicto */}
                  <div style={{ ...S.card, border: `1px solid ${R.tipo_jubilacion ? '#166534' : '#7c2d12'}` }}>
                    <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                      {R.tipo_jubilacion ? (
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
                          // Beca (si existe y aportó)
                          R.tiene_beca && !isZero(R.servicio_beca) ? {
                            concepto: `IPS — Período beca${R.beca_aporto ? ' (aportó)' : ' (sin aportes)'}`,
                            p: R.servicio_beca,
                            tipo: R.beca_aporto ? 'Insalubre' : '—',
                            estado: R.beca_aporto ? 'Computa' : 'Sin aportes',
                          } : null,
                          // Beca antes/desde 2015
                          R.tiene_beca && R.beca_aporto && !isZero(R.servicio_beca_antes_2015) ? {
                            concepto: '  └ Beca antes Jun/2015 (16%)',
                            p: R.servicio_beca_antes_2015, tipo: 'Insalubre',
                            estado: 'OK',
                          } : null,
                          R.tiene_beca && R.beca_aporto && !isZero(R.servicio_beca_desde_2015) ? {
                            concepto: '  └ Beca desde Jun/2015 (16%)',
                            p: R.servicio_beca_desde_2015, tipo: 'Insalubre',
                            estado: 'OK',
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
                          // IPS neto (si hubo superpuesto que afectó)
                          R.superpuestos.some(s => s.organismo.startsWith('IPS ↔')) && !isZero(R.servicio_ips_ajustado) ? {
                            concepto: '  ✦ IPS neto (post-superpuesto)',
                            p: R.servicio_ips_ajustado,
                            tipo: R.es_insalubre_efectivo ? 'Insalubre' : 'Mixto',
                            estado: 'Computa',
                          } : null,
                          // ANSES
                          !isZero(R.anses_neto) ? {
                            concepto: 'ANSES — neto (sin superpuesto)',
                            p: R.anses_neto, tipo: ansesInsalubre ? 'Insalubre' : 'Común',
                            estado: 'Computa',
                          } : null,
                          // Externos ajustados (mostramos el original, la nota de superpuesto es separada)
                          ...externos.filter(e => e.organismo.trim()).map(e => ({
                            concepto: e.organismo,
                            p: { anios: e.anios, meses: e.meses, dias: e.dias },
                            tipo: e.es_insalubre ? 'Insalubre' : 'Común',
                            estado: 'Computa',
                          })),
                          // Superpuestos
                          ...R.superpuestos.map(sp => ({
                            concepto: `⚠ SUPERPUESTO: ${sp.organismo}`,
                            p: sp as Periodo,
                            tipo: '—',
                            estado: `Gana ${sp.ganador}`,
                          })),
                        ] as any[]).filter(Boolean).map((row: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: row.estado?.startsWith('Gana') ? 'rgba(239,68,68,0.07)' : row.estado?.startsWith('⚠') ? 'rgba(251,191,36,0.06)' : row.estado === 'Sin aportes' ? 'rgba(100,116,139,0.06)' : 'transparent' }}>
                            <td style={{ padding: '7px 10px', color: '#e2e8f0' }}>{row.concepto}</td>
                            <td style={{ padding: '7px 10px', fontWeight: 700 }}>{row.p.anios}</td>
                            <td style={{ padding: '7px 10px' }}>{row.p.meses}</td>
                            <td style={{ padding: '7px 10px' }}>{row.p.dias}</td>
                            <td style={{ padding: '7px 10px' }}>
                              {row.tipo === 'Insalubre' ? <span style={S.tagOrange}>{row.tipo}</span>
                                : row.tipo === 'Común'    ? <span style={S.tagBlue}>{row.tipo}</span>
                                : row.tipo === 'Mixto'    ? <span style={S.tagGray}>Común/Ins.</span>
                                : <span style={{ color: '#64748b' }}>{row.tipo}</span>}
                            </td>
                            <td style={{ padding: '7px 10px', fontSize: '0.75rem', color: row.estado?.startsWith('Gana') ? '#fca5a5' : row.estado?.startsWith('⚠') ? '#fdba74' : row.estado === 'Sin aportes' ? '#64748b' : '#86efac' }}>
                              {row.estado}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Explicación superpuestos */}
                    {R.superpuestos.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        {R.superpuestos.map((sp, i) => (
                          <div key={i} style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 14px', marginBottom: 6, fontSize: '0.78rem' }}>
                            <strong style={{ color: '#fca5a5' }}>Superposición {sp.organismo}:</strong>{' '}
                            <span style={{ color: '#94a3b8' }}>{fmtPeriodo(sp)} de aportes simultáneos. </span>
                            <span style={{ color: '#fdba74' }}>Gana <strong>{sp.ganador}</strong> — {sp.motivo}.</span>
                            <span style={{ color: '#94a3b8' }}> El resto de la caja perdedora continúa computando.</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Totales */}
                  <div style={{ ...S.grid3, marginBottom: 16 }}>
                    {[
                      { label: 'Total insalubre', p: R.total_insalubre, color: '#fb923c' },
                      { label: 'Total común', p: R.total_comun, color: '#60a5fa' },
                      { label: 'Total prorateado (×1,4)', p: R.total_prorateado, color: '#a78bfa' },
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
                            computado como Común. Pagando el diferencial del 2% ese período se transforma en Insalubre
                            (Decretos 598/2015 y 1554/2022).
                          </span>
                        </InfoBox>
                      )}
                      {R.sin_aportes && (
                        <InfoBox color="#fca5a5">
                          <strong style={{ color: '#fca5a5' }}>Sin aportes al IPS</strong><br />
                          <span style={{ color: '#94a3b8' }}>
                            La situación de revista actual ({situacion}) no genera aportes previsionales al IPS.
                          </span>
                        </InfoBox>
                      )}
                    </div>
                  )}

                  {/* Observaciones + acciones */}
                  <div style={S.card}>
                    <label htmlFor="ht-obs" style={S.h3}>Observaciones</label>
                    <textarea
                      id="ht-obs"
                      name="observaciones"
                      style={{ ...S.input, minHeight: 80, resize: 'vertical' as const }}
                      placeholder="Notas adicionales (opcional)..."
                      value={observaciones}
                      onChange={e => setObservaciones(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                      <button style={{ ...S.btn, background: guardando ? '#374151' : '#166534', color: '#86efac' }}
                        onClick={guardar} disabled={guardando}>
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
      </div>
    </Layout>
  );
}
