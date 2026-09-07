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

// Líneas leídas del PDF de ANSES (endpoint /jubilacion/parse-anses-pdf).
// Se muestran para revisar y recién se cargan cuando el operador confirma.
interface LineaPdfANSES {
  orden:           number;
  codigo_servicio: string | null;
  el:              string | null;
  empresa:         string | null;
  tipo:            'DEPENDENCIA' | 'AUTONOMO';
  fecha_desde:     string | null;
  fecha_hasta:     string | null;
  sugerida:        boolean;
  motivos:         string[];
  crudo:           string;
}

interface RevisionPdfANSES {
  cuil:         string | null;
  dni:          number | null;
  nombre:       string | null;
  origen:       'texto' | 'ocr';
  advertencias: string[];
  texto_crudo:  string;
  lineas:       (LineaPdfANSES & { usar: boolean })[];
}

interface ServicioExterno {
  organismo:    string;
  fecha_desde:  string;
  fecha_hasta:  string;
  es_insalubre: boolean;
  // 'IPS' = municipio / ministerio provincial (aporta a IPS).
  // 'EXTERNA' = otra provincia / caja profesional (compite en superposiciones).
  caja:         'IPS' | 'EXTERNA';
}

interface Periodo { anios: number; meses: number; dias: number }

interface Superpuesto extends Periodo {
  organismo: string;
  ganador:   string | null;
  motivo:    string;
  empate:    boolean;
  // Ids de los contendientes y clave de resolución manual (los manda el backend;
  // opcionales por compatibilidad con respuestas viejas).
  key?:     string;
  id_a?:    string; label_a?: string;
  id_b?:    string; label_b?: string;
}

// Días computables agrupados por caja de origen (post-superposición).
interface DesgloseCaja {
  caja:      string;
  label:     string;
  insalubre: Periodo;
  comun:     Periodo;
  total:     Periodo;
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
  servicio_ips_extra:           Periodo;
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
  desglose_cajas?:              DesgloseCaja[];
  fecha_calculo?:               string;
  es_fecha_hoy?:                boolean;
  total_prorateado:             Periodo;
  tipo_jubilacion:              string | null;
  cumple_servicio:              boolean;
  cumple_edad:                  boolean;
  falta_servicio:               Periodo;
  falta_servicio_comun?:        Periodo;
  falta_servicio_insalubre?:    Periodo;
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

// Las bajas del cronograma caen a fin de trimestre. Devuelve las próximas
// cuatro a partir de la fecha dada, para ofrecerlas como atajo.
const FIN_TRIMESTRE: Array<[number, number]> = [[2, 31], [5, 30], [8, 30], [11, 31]];
function proximasBajas(desdeISO: string, cuantas = 4): string[] {
  const base = new Date(desdeISO + 'T00:00:00');
  if (isNaN(base.getTime())) return [];
  const out: string[] = [];
  let anio = base.getFullYear();
  while (out.length < cuantas) {
    for (const [m, d] of FIN_TRIMESTRE) {
      const f = new Date(anio, m, d);
      if (f > base && out.length < cuantas) out.push(toISODate(f));
    }
    anio++;
  }
  return out;
}

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

// Cronograma de presentación de papeles y de cobro según la fecha de baja.
// Las bajas caen a fin de trimestre: se cobra un mes como nombrado y el siguiente
// ya como jubilado, y los papeles se presentan del 1 al 10 del mes que está tres
// meses antes de la baja. ─── Si el cronograma cambia, se edita acá. ───
const CRONOGRAMA_JUBILACION = [
  { baja: '31 de marzo',      presenta: 'Del 1 al 10 de diciembre (año anterior)', nombrado: 'Abril',              jubilado: 'Mayo'      },
  { baja: '30 de junio',      presenta: 'Del 1 al 10 de marzo',                    nombrado: 'Julio',              jubilado: 'Agosto'    },
  { baja: '30 de septiembre', presenta: 'Del 1 al 10 de junio',                    nombrado: 'Octubre',            jubilado: 'Noviembre' },
  { baja: '31 de diciembre',  presenta: 'Del 1 al 10 de septiembre',               nombrado: 'Enero (año siguiente)', jubilado: 'Febrero' },
];

// Se muestra en la calculadora y en Posibles Jubilados.
function CronogramaJubilacion() {
  return (
    <div style={S.card}>
      <div style={S.h3}>Cronograma de presentación y cobro</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 560 }}>
          <thead>
            <tr>
              {['Fecha de baja', 'Presenta los papeles', 'Cobra como nombrado', 'Cobra como jubilado'].map(h => (
                <th key={h} style={{
                  textAlign: 'left', padding: '8px 10px', color: 'rgba(255,255,255,0.45)',
                  fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em',
                  borderBottom: '1px solid rgba(255,255,255,0.12)', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CRONOGRAMA_JUBILACION.map((f, i) => (
              <tr key={i}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0', fontWeight: 700, whiteSpace: 'nowrap' }}>{f.baja}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fdba74', fontWeight: 600 }}>{f.presenta}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#94a3b8' }}>{f.nombrado}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#94a3b8' }}>{f.jubilado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: '0.74rem', color: '#64748b' }}>
        Los papeles se presentan del 1 al 10 del mes que cae tres meses antes del mes de baja.
        Fechas de referencia: si el IPS cambia el cronograma hay que actualizar esta tabla.
      </div>
    </div>
  );
}

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

// ── Historial de cálculos guardados ───────────────────────────────────────────
// Cada Guardar deja una versión nueva; desde acá se puede reponer cualquiera en
// el formulario (los inputs se guardan junto con el resultado).
function HistorialCalculos({ historial, onCargar }: { historial: any[]; onCargar: (h: any) => void }) {
  return (
    <div style={S.card}>
      <div style={S.h3}>Historial de cálculos guardados</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem', minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              {['Fecha', 'Situación', 'Insalubre', 'Tipo jubilación', 'Total prorateado', 'Cargo deudor', 'Guardado por', ''].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '5px 8px', color: '#64748b', fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</th>
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
                  <td style={{ padding: '6px 8px' }}>
                    <button style={{ ...S.btn, background: '#312e81', color: '#c4b5fd', padding: '4px 12px', fontSize: '0.76rem' }}
                      onClick={() => onCargar(h)}>Cargar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

  // Lectura del PDF de ANSES (panel de revisión previo a la carga)
  const [pdfLeyendo, setPdfLeyendo] = useState(false);
  const [pdfRuta,    setPdfRuta]    = useState('');
  const [pdfOrigen,  setPdfOrigen]  = useState('');
  const [revision,   setRevision]   = useState<RevisionPdfANSES | null>(null);
  const archivoRef                  = useRef<HTMLInputElement | null>(null);

  // Resoluciones manuales de empates: key = "IPS|ANSES_0" etc., value = id del ganador
  const [resolucionesManuales, setResolucionesManuales] = useState<Record<string, string>>({});

  const [resultado,     setResultado]     = useState<Resultado | null>(null);
  const [calculando,    setCalculando]    = useState(false);
  // Fecha a la que se para el cálculo. Arranca en hoy y se puede mover.
  const [fechaCalculo,  setFechaCalculo]  = useState(TODAY_ISO);
  const [guardando,     setGuardando]     = useState(false);
  const [observaciones, setObservaciones] = useState('');
  const [historial,     setHistorial]     = useState<any[]>([]);
  const [verHistorial,  setVerHistorial]  = useState(false);
  // Cálculo guardado que se ofrece precargar al entrar al agente (el más reciente).
  const [ofertaCarga,   setOfertaCarga]   = useState<any | null>(null);
  // Mientras esté seteado, el resultado en pantalla es el guardado, no uno recién calculado.
  const [cargadoDe,     setCargadoDe]     = useState<{ fecha: string; por: string | null } | null>(null);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'calculadora' | 'posibles' | 'citas'>('calculadora');

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
  const [pjEditFPapeles,   setPjEditFPapeles]   = useState('');
  const [pjEditFJubilacion,setPjEditFJubilacion]= useState('');
  const [pjSoloProximos,   setPjSoloProximos]   = useState(false);
  const [pjGuardando,   setPjGuardando]   = useState(false);

  // ── Agenda de citas — estado ──────────────────────────────────────────────
  const [ctBusqueda,    setCtBusqueda]    = useState('');
  const [ctSugerencias, setCtSugerencias] = useState<any[]>([]);
  const [ctBuscando,    setCtBuscando]    = useState(false);
  const ctTimer                           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ctAgente,      setCtAgente]      = useState<any | null>(null);
  const [ctFecha,       setCtFecha]       = useState(TODAY_ISO);
  const [ctHora,        setCtHora]        = useState('09:00');
  const [ctMotivo,      setCtMotivo]      = useState('');
  const [ctLista,       setCtLista]       = useState<any[]>([]);
  const [ctCargando,    setCtCargando]    = useState(false);
  const [ctRango,       setCtRango]       = useState<'HOY' | 'SEMANA' | 'PROXIMAS' | 'TODAS'>('PROXIMAS');
  const [ctFiltro,      setCtFiltro]      = useState('');
  const [ctGuardando,   setCtGuardando]   = useState(false);
  const [ctEditId,      setCtEditId]      = useState<number | null>(null);
  const [ctEditFecha,   setCtEditFecha]   = useState('');
  const [ctEditHora,    setCtEditHora]    = useState('');
  const [ctEditEstado,  setCtEditEstado]  = useState('');
  const [ctEditMotivo,  setCtEditMotivo]  = useState('');
  const [ctEditObs,     setCtEditObs]     = useState('');
  const [ctPromoverId,  setCtPromoverId]  = useState<number | null>(null);
  const [ctPromMesCorte,setCtPromMesCorte]= useState('MARZO');

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
    setOfertaCarga(null);
    setCargadoDe(null);
    setVerHistorial(false);
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
      setRevision(null);
      setPdfRuta('');
      setPdfOrigen('');

      const hist  = await apiFetch<any>(`/jubilacion/agente/${d.dni}`);
      const filas = hist?.data ?? [];
      setHistorial(filas);
      // El historial viene ordenado por created_at DESC: se ofrece el último.
      setOfertaCarga(filas.length ? filas[0] : null);
    } catch (e: any) {
      toast.error('Error cargando agente: ' + e?.message);
    }
  }, [toast]);

  const tieneBeca = !!(
    agente?.fecha_ingreso &&
    agente?.fecha_de_nombramiento &&
    new Date(agente.fecha_ingreso) < new Date(agente.fecha_de_nombramiento)
  );

  // ── ANSES: lectura del PDF ────────────────────────────────────────────────
  // El PDF de ANSES es una impresión de terminal escaneada: el backend la OCR-ea y
  // devuelve los renglones. Nunca se cargan solos — el operador revisa y confirma.
  const procesarRespuestaPdf = (data: any, origen: string) => {
    const lineas: LineaPdfANSES[] = data?.lineas ?? [];
    setRevision({
      cuil:         data?.cuil ?? null,
      dni:          data?.dni ?? null,
      nombre:       data?.nombre ?? null,
      origen:       data?.origen ?? 'ocr',
      advertencias: data?.advertencias ?? [],
      texto_crudo:  data?.texto_crudo ?? '',
      lineas:       lineas.map(l => ({ ...l, usar: l.sugerida })),
    });
    setPdfOrigen(origen);
    if (!lineas.length) toast.error('No se detectaron renglones de servicios en el PDF');
    else toast.ok(`${lineas.length} renglón/es leídos del PDF — revisalos antes de cargar`);
  };

  const leerPdfArchivo = async (file: File) => {
    setPdfLeyendo(true);
    setRevision(null);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      const res = await apiFetch<any>('/jubilacion/parse-anses-pdf', { method: 'POST', body: fd });
      procesarRespuestaPdf(res?.data, file.name);
    } catch (e: any) {
      toast.error('No se pudo leer el PDF: ' + (e?.message ?? ''));
    } finally {
      setPdfLeyendo(false);
    }
  };

  const leerPdfRuta = async () => {
    const ruta = pdfRuta.trim();
    if (!ruta) { toast.error('Indicá la ruta del PDF en el servidor'); return; }
    setPdfLeyendo(true);
    setRevision(null);
    try {
      const res = await apiFetch<any>('/jubilacion/parse-anses-pdf', {
        method: 'POST',
        body: JSON.stringify({ ruta }),
      });
      procesarRespuestaPdf(res?.data, ruta);
    } catch (e: any) {
      toast.error('No se pudo leer el PDF: ' + (e?.message ?? ''));
    } finally {
      setPdfLeyendo(false);
    }
  };

  const updateRevision = (i: number, campo: 'usar' | 'fecha_desde' | 'fecha_hasta', v: any) =>
    setRevision(p => p && ({ ...p, lineas: p.lineas.map((l, idx) => idx === i ? { ...l, [campo]: v } : l) }));

  const confirmarRevision = () => {
    if (!revision) return;
    const elegidas = revision.lineas.filter(l => l.usar && l.fecha_desde && l.fecha_hasta);
    if (!elegidas.length) { toast.error('No hay renglones tildados con las dos fechas completas'); return; }
    setServiciosAnses(p => [
      ...p,
      ...elegidas.map(l => ({
        fecha_desde:  l.fecha_desde as string,
        fecha_hasta:  l.fecha_hasta as string,
        // El listado de ANSES no informa insalubridad: queda a criterio del operador.
        es_insalubre: false,
      })),
    ]);
    toast.ok(`${elegidas.length} línea/s agregadas desde el PDF`);
    setRevision(null);
    setPdfOrigen('');
  };

  // ── ANSES ─────────────────────────────────────────────────────────────────
  const agregarAnses = () =>
    setServiciosAnses(p => [...p, { fecha_desde: '', fecha_hasta: TODAY_ISO, es_insalubre: false }]);
  const updateAnses = (i: number, f: keyof ServicioANSES, v: any) =>
    setServiciosAnses(p => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const eliminarAnses = (i: number) =>
    setServiciosAnses(p => p.filter((_, idx) => idx !== i));

  // ── Externos ──────────────────────────────────────────────────────────────
  const agregarExterno = () =>
    setServiciosExternos(p => [...p, { organismo: '', fecha_desde: '', fecha_hasta: TODAY_ISO, es_insalubre: false, caja: 'IPS' }]);
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
    fecha_calculo:           fechaCalculo || null,
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

  // Mover la fecha de cálculo recalcula solo, pero recién después del primer
  // cálculo manual: antes no hay resultado que refrescar.
  const primerRenderFecha = useRef(true);
  // Al precargar un cálculo guardado la fecha cambia sola: ese cambio no debe
  // recalcular, porque lo que se muestra es el resultado tal como se guardó.
  const saltearRecalc = useRef(false);
  useEffect(() => {
    if (primerRenderFecha.current) { primerRenderFecha.current = false; return; }
    if (saltearRecalc.current) { saltearRecalc.current = false; return; }
    if (!resultado || !fechaCalculo) return;
    calcular();
  }, [fechaCalculo]);

  const resolverEmpate = (key: string, ganadorId: string) => {
    const nuevas = { ...resolucionesManuales, [key]: ganadorId };
    setResolucionesManuales(nuevas);
    calcular(nuevas);
  };

  // ── Precarga de un cálculo guardado ───────────────────────────────────────
  // Repone los inputs tal como se guardaron y muestra el resultado de esa vez.
  // No recalcula solo: el número que se ve es el que quedó registrado.
  const aplicarCalculoGuardado = useCallback((h: any) => {
    const parse = (v: any, fallback: any) => {
      if (v == null) return fallback;
      try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return fallback; }
    };
    setSituacion(h.situacion_revista ?? 'NORMAL');
    setBecaAporto(!!h.beca_aporto);
    setIpsAporto(h.ips_aporto == null ? true : !!h.ips_aporto);
    setEsInsalubreIPS(!!h.es_insalubre_ips);
    setDiferencial2Pagado(!!h.diferencial_2pct_pagado);
    setServiciosAnses(parse(h.servicios_anses, []));
    setServiciosExternos(parse(h.servicios_externos, []));
    setResolucionesManuales(parse(h.resoluciones_manuales, {}));
    setObservaciones(h.observaciones ?? '');
    const nuevaFecha = toInputDate(h.fecha_calculo) || TODAY_ISO;
    saltearRecalc.current = nuevaFecha !== fechaCalculo;
    setFechaCalculo(nuevaFecha);
    setResultado(parse(h.resultado, null));
    setCargadoDe({ fecha: h.created_at, por: h.creado_por_nombre ?? null });
    setOfertaCarga(null);
    setVerHistorial(false);
    setRevision(null);
  }, [fechaCalculo]);

  // Recalcular con los datos de hoy: deja de ser el guardado y pasa a ser un
  // cálculo nuevo, que recién queda registrado si se aprieta Guardar.
  const recalcularCargado = () => { setCargadoDe(null); calcular(); };

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
        const filas = hist?.data ?? [];
        setHistorial(filas);
        if (filas.length) setCargadoDe({ fecha: filas[0].created_at, por: filas[0].creado_por_nombre ?? null });
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

    filas.push({ Sección: 'Cálculo', Dato: 'Calculado al', Valor: fmtFecha(R.fecha_calculo ?? fechaCalculo) });
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
      const seccion = ext.caja === 'EXTERNA' ? 'Externo' : 'IPS (municipio/min. prov.)';
      filas.push({ Sección: seccion, Dato: ext.organismo, Valor: `${fmtFecha(ext.fecha_desde)} → ${fmtFecha(ext.fecha_hasta)} (${ext.es_insalubre ? 'insalubre' : 'común'})` });
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
    if (!R.cumple_servicio) {
      filas.push({ Sección: 'Falta', Dato: 'Servicio faltante (común)',    Valor: fmtPeriodo(R.falta_servicio_comun ?? R.falta_servicio) });
      if (R.falta_servicio_insalubre)
        filas.push({ Sección: 'Falta', Dato: 'Servicio faltante (insalubre)', Valor: fmtPeriodo(R.falta_servicio_insalubre) });
    }

    for (const d of R.desglose_cajas ?? []) {
      filas.push({ Sección: 'Por caja', Dato: d.label, Valor: `${fmtPeriodo(d.total)} — insalubre ${fmtPeriodo(d.insalubre)} · común ${fmtPeriodo(d.comun)}` });
    }
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

  // Días desde hoy hasta una fecha ISO (negativo = ya pasó)
  const diasHasta = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const [y, m, d] = String(iso).split('T')[0].split('-').map(Number);
    if (!y || !m || !d) return null;
    const hoy    = new Date(); hoy.setHours(0, 0, 0, 0);
    const objeto = new Date(y, m - 1, d);
    return Math.round((objeto.getTime() - hoy.getTime()) / 86400000);
  };
  const sufijoDias = (dias: number | null): string => {
    if (dias === null) return '';
    if (dias === 0)  return ' · hoy';
    if (dias === 1)  return ' · mañana';
    if (dias > 0)    return ` · en ${dias} días`;
    if (dias === -1) return ' · ayer';
    return ` · hace ${Math.abs(dias)} días`;
  };
  // Semáforo: vencida en rojo, dentro de 30 días en amarillo, más lejos en violeta.
  // Si el trámite ya cerró (jubilado/descartado) no urge: gris.
  const fechaChipStyle = (iso: string | null | undefined, estado: string): React.CSSProperties => {
    const dias = diasHasta(iso);
    if (dias === null || estado === 'JUBILADO' || estado === 'DESCARTADO') return S.tagGray;
    if (dias < 0)  return S.tagRed;
    if (dias <= 30) return S.tagYellow;
    return S.tagPurple;
  };
  // Fecha del trámite más próxima del registro (para ordenar y filtrar vencimientos)
  const pjFechaProxima = (p: any): number | null => {
    const ds = [diasHasta(p.fecha_presentacion_papeles), diasHasta(p.fecha_jubilacion)]
      .filter((d): d is number => d !== null);
    return ds.length ? Math.min(...ds) : null;
  };

  const pjListaFiltrada = useMemo(() => {
    let base = pjFiltro ? pjLista.filter((p: any) => p.estado === pjFiltro) : pjLista;
    if (pjSoloProximos) {
      base = base
        .filter((p: any) => {
          if (p.estado === 'JUBILADO' || p.estado === 'DESCARTADO') return false;
          const d = pjFechaProxima(p);
          return d !== null && d <= 60;
        })
        .slice()
        .sort((a: any, b: any) => (pjFechaProxima(a) ?? 0) - (pjFechaProxima(b) ?? 0));
    }
    return base;
  }, [pjLista, pjFiltro, pjSoloProximos]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setPjEditFPapeles(toInputDate(pj.fecha_presentacion_papeles));
    setPjEditFJubilacion(toInputDate(pj.fecha_jubilacion));
  }, []);

  const guardarPjEdit = useCallback(async (id: number) => {
    setPjGuardando(true);
    try {
      const res = await apiFetch<any>(`/jubilacion/posibles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          estado:                     pjEditEstado,
          mes_corte:                  pjEditMesCorte,
          observaciones:              pjEditObs,
          fecha_presentacion_papeles: pjEditFPapeles    || null,
          fecha_jubilacion:           pjEditFJubilacion || null,
        }),
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
  }, [pjEditEstado, pjEditMesCorte, pjEditObs, pjEditFPapeles, pjEditFJubilacion, cargarPosibles, toast]);

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

  // ── Agenda de citas — helpers ─────────────────────────────────────────────
  const ctEstadoLabel = (e: string) => {
    const m: Record<string, string> = {
      AGENDADA: 'Agendada', ATENDIDA: 'Atendida', AUSENTE: 'No asistió',
      REPROGRAMADA: 'Reprogramada', CANCELADA: 'Cancelada',
    };
    return m[e] ?? e;
  };
  const ctEstadoStyle = (e: string): React.CSSProperties => {
    const m: Record<string, React.CSSProperties> = {
      AGENDADA:     S.tagBlue,
      ATENDIDA:     S.tagGreen,
      AUSENTE:      S.tagRed,
      REPROGRAMADA: S.tagYellow,
      CANCELADA:    S.tagGray,
    };
    return m[e] ?? S.tagGray;
  };

  const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const ctFechaTitulo = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt   = new Date(y, m - 1, d);
    const base = `${DIAS_SEMANA[dt.getDay()]} ${d}/${m}/${y}`;
    if (iso === TODAY_ISO) return `Hoy · ${base}`;
    const manana = toISODate(new Date(Date.now() + 86400000));
    if (iso === manana) return `Mañana · ${base}`;
    return base;
  };

  const ctListaFiltrada = ctFiltro ? ctLista.filter((c: any) => c.estado === ctFiltro) : ctLista;

  // Agrupar por día para el render de la agenda
  const ctPorDia = useMemo(() => {
    const grupos: { fecha: string; citas: any[] }[] = [];
    for (const c of ctListaFiltrada) {
      const g = grupos.find(x => x.fecha === c.fecha_cita);
      if (g) g.citas.push(c);
      else grupos.push({ fecha: c.fecha_cita, citas: [c] });
    }
    return grupos;
  }, [ctListaFiltrada]);

  // ── Agenda de citas — funciones ───────────────────────────────────────────
  const onCtBusquedaChange = useCallback((q: string) => {
    setCtBusqueda(q);
    setCtAgente(null);
    if (ctTimer.current) clearTimeout(ctTimer.current);
    if (!q.trim()) { setCtSugerencias([]); return; }
    ctTimer.current = setTimeout(async () => {
      setCtBuscando(true);
      try { setCtSugerencias((await searchPersonal(q.trim())).slice(0, 8)); }
      finally { setCtBuscando(false); }
    }, 250);
  }, []);

  const seleccionarCtAgente = useCallback((ag: any) => {
    setCtSugerencias([]);
    setCtBusqueda(`${ag.apellido}, ${ag.nombre}`);
    setCtAgente(ag);
  }, []);

  const cargarCitas = useCallback(async () => {
    setCtCargando(true);
    try {
      const params = new URLSearchParams();
      if (ctRango === 'HOY') {
        params.set('desde', TODAY_ISO);
        params.set('hasta', TODAY_ISO);
      } else if (ctRango === 'SEMANA') {
        params.set('desde', TODAY_ISO);
        params.set('hasta', toISODate(new Date(Date.now() + 7 * 86400000)));
      } else if (ctRango === 'PROXIMAS') {
        params.set('desde', TODAY_ISO);
      }
      const qs  = params.toString();
      const res = await apiFetch<any>(`/jubilacion/citas${qs ? `?${qs}` : ''}`);
      setCtLista(res?.data ?? []);
    } catch (e: any) {
      toast.error('Error cargando la agenda: ' + e?.message);
    } finally { setCtCargando(false); }
  }, [ctRango, toast]);

  const agendarCita = useCallback(async () => {
    if (!ctAgente) return;
    if (!ctFecha || !ctHora) { toast.error('Indicá fecha y hora de la cita'); return; }
    setCtGuardando(true);
    try {
      const res = await apiFetch<any>('/jubilacion/citas', {
        method: 'POST',
        body: JSON.stringify({
          dni:        ctAgente.dni,
          fecha_cita: ctFecha,
          hora_cita:  ctHora,
          motivo:     ctMotivo.trim() || null,
        }),
      });
      if (res?.ok) {
        toast.ok(`Cita agendada para ${ctAgente.apellido}, ${ctAgente.nombre}`);
        setCtBusqueda('');
        setCtAgente(null);
        setCtMotivo('');
        await cargarCitas();
      } else {
        toast.error(res?.error ?? 'Error al agendar');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setCtGuardando(false); }
  }, [ctAgente, ctFecha, ctHora, ctMotivo, cargarCitas, toast]);

  const abrirCtEdit = useCallback((c: any) => {
    setCtPromoverId(null);
    setCtEditId(c.id);
    setCtEditFecha(c.fecha_cita ?? '');
    setCtEditHora(c.hora_cita ?? '');
    setCtEditEstado(c.estado ?? 'AGENDADA');
    setCtEditMotivo(c.motivo ?? '');
    setCtEditObs(c.observaciones ?? '');
  }, []);

  const patchCita = useCallback(async (id: number, cambios: Record<string, any>, msg: string) => {
    setCtGuardando(true);
    try {
      const res = await apiFetch<any>(`/jubilacion/citas/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(cambios),
      });
      if (res?.ok) {
        toast.ok(msg);
        setCtEditId(null);
        await cargarCitas();
      } else {
        toast.error(res?.error ?? 'Error al actualizar');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setCtGuardando(false); }
  }, [cargarCitas, toast]);

  const guardarCtEdit = useCallback((id: number) => patchCita(id, {
    fecha_cita:    ctEditFecha,
    hora_cita:     ctEditHora,
    estado:        ctEditEstado,
    motivo:        ctEditMotivo.trim() || null,
    observaciones: ctEditObs.trim() || null,
  }, 'Cita actualizada'), [patchCita, ctEditFecha, ctEditHora, ctEditEstado, ctEditMotivo, ctEditObs]);

  const eliminarCita = useCallback(async (id: number) => {
    if (!window.confirm('¿Eliminar esta cita?')) return;
    try {
      const res = await apiFetch<any>(`/jubilacion/citas/${id}`, { method: 'DELETE' });
      if (res?.ok) {
        toast.ok('Cita eliminada');
        await cargarCitas();
      } else {
        toast.error(res?.error ?? 'Error al eliminar');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    }
  }, [cargarCitas, toast]);

  // Cierra la cita como atendida y da de alta al agente en Posibles Jubilados
  const promoverCita = useCallback(async (id: number) => {
    setCtGuardando(true);
    try {
      const res = await apiFetch<any>(`/jubilacion/citas/${id}/promover`, {
        method: 'POST',
        body: JSON.stringify({ mes_corte: ctPromMesCorte }),
      });
      if (res?.ok) {
        toast.ok(res.ya_existia
          ? 'El agente ya estaba en el registro: la cita quedó vinculada y marcada como atendida'
          : 'Agente agregado a Posibles Jubilados y cita marcada como atendida');
        setCtPromoverId(null);
        await cargarCitas();
        await cargarPosibles();
      } else {
        toast.error(res?.error ?? 'Error al agregar al registro');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setCtGuardando(false); }
  }, [ctPromMesCorte, cargarCitas, cargarPosibles, toast]);

  // Cargar lista al entrar al tab
  useEffect(() => {
    if (tab === 'posibles') cargarPosibles();
    if (tab === 'citas')    cargarCitas();
  }, [tab, ctRango]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Herramientas">
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
        {/* ─ Tab switcher ─ */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          {(['calculadora', 'citas', 'posibles'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 22px', fontSize: '0.9rem', fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#e2e8f0' : '#64748b',
              borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.15s',
            }}>
              {t === 'calculadora' ? '⚖️ Calculadora' : t === 'citas' ? '🗓️ Agenda de citas' : '📋 Posibles Jubilados'}
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

        {/* ─ Oferta de precarga del último cálculo guardado ─ */}
        {ofertaCarga && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: 24, maxWidth: 460, width: '100%' }}>
              <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 10 }}>Este agente ya tiene un cálculo guardado</div>
              <div style={{ fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: 18 }}>
                Del <strong style={{ color: '#e2e8f0' }}>{fmtFecha(ofertaCarga.created_at)}</strong>
                {ofertaCarga.creado_por_nombre ? <> · por <strong style={{ color: '#e2e8f0' }}>{ofertaCarga.creado_por_nombre}</strong></> : null}.
                <br />¿Querés cargarlo?
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={{ ...S.btn, background: '#166534', color: '#86efac' }}
                  onClick={() => aplicarCalculoGuardado(ofertaCarga)}>
                  Sí, cargarlo
                </button>
                <button style={{ ...S.btn, background: '#1e293b', color: '#e2e8f0' }}
                  onClick={() => { setOfertaCarga(null); setVerHistorial(true); }}>
                  No, empezar de cero
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─ Historial visible sin resultado en pantalla (se eligió "empezar de cero") ─ */}
        {agente && !resultado && historial.length > 0 && verHistorial && (
          <HistorialCalculos historial={historial} onCargar={aplicarCalculoGuardado} />
        )}

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

              {/* Lectura automática del listado de ANSES */}
              <div
                onDragOver={e => { e.preventDefault(); }}
                onDrop={e => {
                  e.preventDefault();
                  const f = e.dataTransfer?.files?.[0];
                  if (f) leerPdfArchivo(f);
                }}
                style={{ background: 'rgba(59,130,246,0.06)', border: '1px dashed rgba(147,197,253,0.35)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: '#bfdbfe', fontWeight: 600 }}>
                    Cargar desde el PDF de ANSES
                  </span>
                  <input
                    ref={archivoRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) leerPdfArchivo(f);
                      e.target.value = '';   // permite volver a elegir el mismo archivo
                    }}
                  />
                  <button
                    style={{ ...S.btn, background: '#1e40af', color: '#fff', padding: '6px 14px', fontSize: '0.78rem', opacity: pdfLeyendo ? 0.6 : 1 }}
                    disabled={pdfLeyendo}
                    onClick={() => archivoRef.current?.click()}
                  >
                    📄 Elegir PDF…
                  </button>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>o arrastralo acá</span>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <input
                    style={{ ...S.input, flex: 1, fontSize: '0.78rem' }}
                    placeholder="…o pegá la ruta del PDF en el servidor (ej: D:\G\DESPAPELIZACION\APELLIDO NOMBRE.pdf)"
                    value={pdfRuta}
                    disabled={pdfLeyendo}
                    onChange={e => setPdfRuta(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') leerPdfRuta(); }}
                  />
                  <button
                    style={{ ...S.btn, background: '#334155', color: '#e2e8f0', padding: '7px 14px', fontSize: '0.78rem', opacity: pdfLeyendo ? 0.6 : 1 }}
                    disabled={pdfLeyendo}
                    onClick={leerPdfRuta}
                  >
                    Leer del servidor
                  </button>
                </div>

                {pdfLeyendo && (
                  <div style={{ fontSize: '0.76rem', color: '#93c5fd', marginTop: 8 }}>
                    Leyendo el PDF… si es un escaneo hay que pasarlo por OCR, puede tardar unos segundos.
                  </div>
                )}
              </div>

              {/* Panel de revisión: nada se carga hasta que el operador confirma */}
              {revision && (
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(147,197,253,0.25)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.8rem', color: '#e2e8f0', fontWeight: 700 }}>
                      Renglones leídos {pdfOrigen && <span style={{ color: '#64748b', fontWeight: 400 }}>· {pdfOrigen}</span>}
                    </div>
                    <span style={revision.origen === 'ocr' ? S.tagYellow : S.tagGray}>
                      {revision.origen === 'ocr' ? 'Leído por OCR — verificá las fechas' : 'Leído del texto del PDF'}
                    </span>
                  </div>

                  {/* Sólo informativo: los servicios se cargan al agente abierto en pantalla. */}
                  {(revision.nombre || revision.cuil || revision.dni) && (
                    <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginBottom: 8 }}>
                      Según el documento: {revision.nombre ?? 'sin nombre'}
                      {revision.cuil ? ` · CUIL ${revision.cuil}` : revision.dni ? ` · DNI ${revision.dni}` : ''}
                    </div>
                  )}

                  {revision.advertencias.map((a, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: '#fdba74', marginBottom: 4 }}>• {a}</div>
                  ))}

                  <div style={{ marginTop: 10 }}>
                    {revision.lineas.map((l, i) => (
                      <div key={i} style={{
                        display: 'grid', gridTemplateColumns: '28px 1fr 150px 150px', gap: 8, alignItems: 'center',
                        padding: '6px 0', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none',
                      }}>
                        <input type="checkbox" checked={l.usar} style={S.chk}
                          onChange={e => updateRevision(i, 'usar', e.target.checked)} />
                        <div>
                          <div style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
                            {l.empresa ?? '(sin empresa)'}{' '}
                            {l.tipo === 'AUTONOMO' && <span style={{ ...S.tagPurple, fontSize: '0.68rem' }}>autónomo</span>}
                          </div>
                          {!!l.motivos.length && (
                            <div style={{ fontSize: '0.72rem', color: '#fdba74' }}>{l.motivos.join(' · ')}</div>
                          )}
                        </div>
                        <input type="date" style={{ ...S.input, fontSize: '0.8rem' }} value={l.fecha_desde ?? ''}
                          onChange={e => updateRevision(i, 'fecha_desde', e.target.value)} max={TODAY_ISO} />
                        <input type="date" style={{ ...S.input, fontSize: '0.8rem' }} value={l.fecha_hasta ?? ''}
                          onChange={e => updateRevision(i, 'fecha_hasta', e.target.value)} max={TODAY_ISO} />
                      </div>
                    ))}
                  </div>

                  {/* Cada resolución arma la tabla distinto: si el parser no reconoció algún
                      renglón, acá se ve lo que leyó para cargarlo a mano. */}
                  {!!revision.texto_crudo && (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.74rem', color: '#64748b' }}>
                        Ver el texto leído del documento
                      </summary>
                      <pre style={{
                        marginTop: 6, maxHeight: 220, overflow: 'auto', background: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: 10,
                        fontSize: '0.7rem', color: '#94a3b8', whiteSpace: 'pre-wrap',
                      }}>{revision.texto_crudo}</pre>
                    </details>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button style={{ ...S.btn, background: '#166534', color: '#dcfce7' }} onClick={confirmarRevision}>
                      Agregar {revision.lineas.filter(l => l.usar && l.fecha_desde && l.fecha_hasta).length} línea/s
                    </button>
                    <button style={{ ...S.btn, background: '#334155', color: '#e2e8f0' }}
                      onClick={() => { setRevision(null); setPdfOrigen(''); }}>
                      Descartar
                    </button>
                  </div>
                </div>
              )}

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
                  <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={S.label}>Organismo / Municipio / Ministerio</label>
                      <input style={S.input} placeholder="Nombre del organismo" value={ext.organismo}
                        onChange={e => updateExterno(i, 'organismo', e.target.value)} />
                    </div>
                    <div style={{ width: 210 }}>
                      <label style={S.label}>Caja</label>
                      <select style={S.input} value={ext.caja}
                        onChange={e => updateExterno(i, 'caja', e.target.value as 'IPS' | 'EXTERNA')}>
                        <option value="IPS">IPS (municipio / min. provincial)</option>
                        <option value="EXTERNA">Externa (otra provincia / profesional)</option>
                      </select>
                    </div>
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

            <CronogramaJubilacion />

            {/* ─ Fecha de cálculo ─ */}
            <div style={S.card}>
              <div style={S.h3}>Fecha de cálculo</div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 12 }}>
                Todo se mide a esta fecha: la edad, la antigüedad y el recorte de los servicios cargados.
                Arranca en hoy; si la cambiás, el resultado se actualiza solo.
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" style={{ ...S.input, maxWidth: 190 }} value={fechaCalculo}
                  onChange={e => setFechaCalculo(e.target.value)} />
                <button
                  style={{ ...S.btn, background: fechaCalculo === TODAY_ISO ? '#166534' : '#1e293b', color: fechaCalculo === TODAY_ISO ? '#86efac' : '#e2e8f0', padding: '6px 14px', fontSize: '0.8rem' }}
                  onClick={() => setFechaCalculo(TODAY_ISO)}
                >Hoy</button>
                <span style={{ fontSize: '0.74rem', color: '#64748b' }}>Próximas bajas:</span>
                {proximasBajas(TODAY_ISO).map(iso => (
                  <button key={iso}
                    style={{ ...S.btn, background: fechaCalculo === iso ? '#166534' : '#1e293b', color: fechaCalculo === iso ? '#86efac' : '#e2e8f0', padding: '6px 14px', fontSize: '0.8rem' }}
                    onClick={() => setFechaCalculo(iso)}
                  >{fmtFecha(iso)}</button>
                ))}
              </div>
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
              // Solo caja EXTERNA compite (mismo orden/índice que el backend arma EXT_i).
              const externosReales = externosValidos.filter(s => s.caja === 'EXTERNA');
              const externosIps    = externosValidos.filter(s => s.caja !== 'EXTERNA');
              const todosIds: { id: string; label: string }[] = [
                ...ansesValidos.map((a, i) => ({ id: `ANSES_${i}`, label: `ANSES (${fmtFecha(a.fecha_desde)} → ${fmtFecha(a.fecha_hasta)})` })),
                ...externosIds(externosReales),
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
                        // Los ids vienen del backend; si faltan (respuesta vieja),
                        // se deducen del texto "A ↔ B".
                        const partes = sp.organismo.split(' ↔ ');
                        const rawA = sp.label_a ?? partes[0].trim();
                        const rawB = sp.label_b ?? (partes[1]?.trim() ?? '');
                        const findId = (label: string) => {
                          if (label === 'IPS') return 'IPS';
                          return todosIds.find(x => x.label === label)?.id ?? label;
                        };
                        const idA = sp.id_a ?? findId(rawA);
                        const idB = sp.id_b ?? findId(rawB);
                        const key = sp.key ?? `${idA}|${idB}`;
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

                  {/* Fecha a la que corresponde el resultado */}
                  {R.fecha_calculo && !R.es_fecha_hoy && (
                    <InfoBox color="#fdba74">
                      <strong style={{ color: '#fdba74' }}>Cálculo al {fmtFecha(R.fecha_calculo)}</strong>{' '}
                      <span style={{ color: '#94a3b8' }}>— no es la fecha de hoy. Los servicios posteriores a esa fecha quedaron recortados.</span>
                    </InfoBox>
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
                            {!R.cumple_servicio && (
                              <div style={S.tagRed}>
                                Le faltan: {fmtPeriodo(R.falta_servicio_comun ?? R.falta_servicio)} de servicio común
                              </div>
                            )}
                            {!R.cumple_edad     && <div style={S.tagRed}>Le faltan: {fmtPeriodo(R.falta_edad)} de edad</div>}
                          </div>
                          {/* Lo mismo, pero si sigue prestando servicios insalubres: computan 1,4 a 1. */}
                          {!R.cumple_servicio && R.falta_servicio_insalubre && (
                            <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#fdba74' }}>
                              Trabajando como <strong>insalubre</strong> le faltan{' '}
                              <strong>{fmtPeriodo(R.falta_servicio_insalubre)}</strong> de servicio
                              <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 2 }}>
                                Son días de almanaque: un día insalubre computa más que uno común según la tabla de prorrateo.
                              </div>
                            </div>
                          )}
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
                          // IPS-extra (municipio / ministerio provincial → misma caja IPS)
                          R.servicio_ips_extra && !isZero(R.servicio_ips_extra) ? {
                            concepto: `IPS — Municipio / min. provincial (${externosIps.map(e => e.organismo).join(', ')})`,
                            p: R.servicio_ips_extra,
                            tipo: externosIps.some(e => e.es_insalubre) ? 'Insalubre' : 'Común',
                            estado: 'Computa (unión IPS)',
                          } : null,
                          // ANSES neto
                          !isZero(R.anses_neto) ? {
                            concepto: 'ANSES — total neto (sin superpuesto)',
                            p: R.anses_neto,
                            tipo: ansesValidos.some(a => a.es_insalubre) ? 'Mixto' : 'Común',
                            estado: 'Computa',
                          } : null,
                          // Externos reales (otras cajas)
                          ...externosReales.map(e => ({
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

                  {/* Desglose por caja */}
                  {(R.desglose_cajas?.length ?? 0) > 0 && (
                    <div style={{ ...S.card, marginBottom: 16 }}>
                      <div style={S.h3}>Aportes por caja</div>
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: 12 }}>
                        Días que computan de cada caja, ya descontadas las superposiciones. Suman los totales de arriba.
                        El prorrateo se aplica al insalubre total, no caja por caja, por eso acá va en crudo.
                      </div>
                      <div style={S.grid3}>
                        {R.desglose_cajas!.map(d => (
                          <div key={d.caja} style={{ ...S.card, borderColor: '#33415566', marginBottom: 0 }}>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                              {d.label}
                            </div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#e2e8f0', marginBottom: 8 }}>
                              {fmtPeriodo(d.total)}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#fb923c' }}>
                              Insalubre: <strong>{fmtPeriodo(d.insalubre)}</strong>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#60a5fa' }}>
                              Común: <strong>{fmtPeriodo(d.comun)}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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
                    {cargadoDe && (
                      <div style={{ marginTop: 12, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: '#c7d2fe' }}>
                        Estás viendo el cálculo guardado del <strong>{fmtFecha(cargadoDe.fecha)}</strong>
                        {cargadoDe.por ? <> por <strong>{cargadoDe.por}</strong></> : null}.
                        <button style={{ ...S.btn, background: '#312e81', color: '#c4b5fd', padding: '5px 12px', fontSize: '0.78rem', marginLeft: 10 }}
                          onClick={recalcularCargado} disabled={calculando}>
                          {calculando ? '⏳ Recalculando...' : '🔄 Recalcular con datos actuales'}
                        </button>
                      </div>
                    )}
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
                    <HistorialCalculos historial={historial} onCargar={aplicarCalculoGuardado} />
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

        {/* ─ Tab: Agenda de citas ─ */}
        {tab === 'citas' && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>🗓️ Agenda de citas</h1>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
                Citas con agentes candidatos a jubilación. Después de la cita se los puede agregar al registro de Posibles Jubilados
              </p>
            </div>

            {/* Agendar */}
            <div style={S.card}>
              <div style={S.h3}>Agendar cita</div>
              <div style={{ position: 'relative' }}>
                <input
                  aria-label="Buscar agente por apellido, nombre o DNI"
                  style={S.input}
                  placeholder="Apellido, nombre o DNI..."
                  value={ctBusqueda}
                  onChange={e => onCtBusquedaChange(e.target.value)}
                />
                {ctBuscando && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '0.75rem' }}>Buscando...</span>
                )}
                {ctSugerencias.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, zIndex: 100, maxHeight: 260, overflowY: 'auto' }}>
                    {ctSugerencias.map((s, i) => (
                      <div key={i} onClick={() => seleccionarCtAgente(s)}
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
              {ctAgente && (
                <div style={{ marginTop: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{ctAgente.apellido}, {ctAgente.nombre}</span>
                    <span style={{ color: '#64748b', marginLeft: 10, fontSize: '0.78rem' }}>DNI {ctAgente.dni} · {ctAgente.ley_nombre ?? '—'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '150px 110px 1fr auto', gap: 12, alignItems: 'end' }}>
                    <div>
                      <label style={S.label}>Fecha</label>
                      <input type="date" style={S.input} value={ctFecha} onChange={e => setCtFecha(e.target.value)} />
                    </div>
                    <div>
                      <label style={S.label}>Hora</label>
                      <input type="time" style={S.input} value={ctHora} onChange={e => setCtHora(e.target.value)} />
                    </div>
                    <div>
                      <label style={S.label}>Motivo (opcional)</label>
                      <input style={S.input} value={ctMotivo} onChange={e => setCtMotivo(e.target.value)}
                        placeholder="Ej: entrevista inicial, entrega de documentación..." />
                    </div>
                    <button
                      style={{ ...S.btn, background: ctGuardando ? '#374151' : '#166534', color: '#86efac', padding: '8px 18px' }}
                      onClick={agendarCita}
                      disabled={ctGuardando}
                    >
                      {ctGuardando ? '⏳ Guardando...' : '🗓️ Agendar cita'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Agenda */}
            <div style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={S.h3}>Agenda</div>
                <button onClick={cargarCitas} style={{ ...S.btn, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', padding: '5px 12px', fontSize: '0.76rem' }}>
                  🔄 Actualizar
                </button>
              </div>

              {/* Rango de fechas */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {([['HOY', 'Hoy'], ['SEMANA', 'Próximos 7 días'], ['PROXIMAS', 'Próximas'], ['TODAS', 'Todas']] as const).map(([v, lbl]) => (
                  <button key={v} onClick={() => setCtRango(v)}
                    style={{ ...S.btn, padding: '5px 12px', fontSize: '0.76rem',
                      background: ctRango === v ? '#1e3a8a' : 'rgba(255,255,255,0.05)',
                      color:      ctRango === v ? '#bfdbfe' : '#94a3b8',
                      border:     ctRango === v ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.08)',
                    }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Filtros por estado */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {(['', 'AGENDADA', 'ATENDIDA', 'AUSENTE', 'REPROGRAMADA', 'CANCELADA'] as const).map(e => (
                  <button key={e || 'all'} onClick={() => setCtFiltro(e)}
                    style={{ ...S.btn, padding: '5px 12px', fontSize: '0.76rem',
                      background: ctFiltro === e ? '#4c1d95' : 'rgba(255,255,255,0.05)',
                      color:      ctFiltro === e ? '#c4b5fd' : '#94a3b8',
                      border:     ctFiltro === e ? '1px solid #7c3aed' : '1px solid rgba(255,255,255,0.08)',
                    }}>
                    {e === '' ? 'Todos' : ctEstadoLabel(e)}
                    {e === '' && ctLista.length > 0 && <span style={{ marginLeft: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 99, padding: '1px 7px', fontSize: '0.7rem' }}>{ctLista.length}</span>}
                    {e !== '' && ctLista.filter((c: any) => c.estado === e).length > 0 && (
                      <span style={{ marginLeft: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 99, padding: '1px 7px', fontSize: '0.7rem' }}>{ctLista.filter((c: any) => c.estado === e).length}</span>
                    )}
                  </button>
                ))}
              </div>

              {ctCargando ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '0.85rem' }}>Cargando...</div>
              ) : ctPorDia.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0', fontSize: '0.85rem' }}>
                  {ctFiltro ? `Sin citas con estado "${ctEstadoLabel(ctFiltro)}"` : 'No hay citas en este período'}
                </div>
              ) : (
                <div>
                  {ctPorDia.map(grupo => (
                    <div key={grupo.fecha} style={{ marginBottom: 18 }}>
                      <div style={{
                        fontSize: '0.76rem', fontWeight: 700, color: grupo.fecha === TODAY_ISO ? '#c4b5fd' : '#94a3b8',
                        textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8,
                        borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 5,
                      }}>
                        {ctFechaTitulo(grupo.fecha)}
                        <span style={{ marginLeft: 8, color: '#475569', fontWeight: 400 }}>
                          {grupo.citas.length} cita{grupo.citas.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {grupo.citas.map((c: any) => (
                        <div key={c.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '12px 16px', marginBottom: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
                          {ctEditId === c.id ? (
                            /* Modo edición / reprogramar */
                            <div>
                              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: '0.88rem' }}>
                                {c.apellido}, {c.nombre}
                                <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 10, fontSize: '0.76rem' }}>DNI {c.dni}</span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '150px 110px 1fr', gap: 12, marginBottom: 10 }}>
                                <div>
                                  <label style={S.label}>Fecha</label>
                                  <input type="date" style={S.input} value={ctEditFecha} onChange={e => setCtEditFecha(e.target.value)} />
                                </div>
                                <div>
                                  <label style={S.label}>Hora</label>
                                  <input type="time" style={S.input} value={ctEditHora} onChange={e => setCtEditHora(e.target.value)} />
                                </div>
                                <div>
                                  <label style={S.label}>Estado</label>
                                  <select style={S.select} value={ctEditEstado} onChange={e => setCtEditEstado(e.target.value)}>
                                    <option value="AGENDADA">Agendada</option>
                                    <option value="ATENDIDA">Atendida</option>
                                    <option value="AUSENTE">No asistió</option>
                                    <option value="REPROGRAMADA">Reprogramada</option>
                                    <option value="CANCELADA">Cancelada</option>
                                  </select>
                                </div>
                              </div>
                              <div style={{ marginBottom: 10 }}>
                                <label style={S.label}>Motivo</label>
                                <input style={S.input} value={ctEditMotivo} onChange={e => setCtEditMotivo(e.target.value)}
                                  placeholder="Motivo de la cita..." />
                              </div>
                              <div style={{ marginBottom: 10 }}>
                                <label style={S.label}>Observaciones</label>
                                <textarea style={{ ...S.input, minHeight: 64, resize: 'vertical' as const }}
                                  value={ctEditObs} onChange={e => setCtEditObs(e.target.value)}
                                  placeholder="Qué se habló en la cita, documentación pendiente..." />
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button style={{ ...S.btn, background: ctGuardando ? '#374151' : '#166534', color: '#86efac' }}
                                  onClick={() => guardarCtEdit(c.id)} disabled={ctGuardando}>
                                  {ctGuardando ? '⏳' : '💾 Guardar'}
                                </button>
                                <button style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}
                                  onClick={() => setCtEditId(null)}>Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            /* Modo vista */
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                <div style={{
                                  fontSize: '1rem', fontWeight: 800, color: '#e2e8f0', minWidth: 52,
                                  background: 'rgba(124,58,237,0.18)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' as const,
                                }}>
                                  {c.hora_cita}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 4 }}>
                                    {c.apellido}, {c.nombre}
                                    <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 10, fontSize: '0.75rem' }}>DNI {c.dni}</span>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 3 }}>
                                    <span style={ctEstadoStyle(c.estado)}>{ctEstadoLabel(c.estado)}</span>
                                    {c.registro_id && <span style={S.tagGreen}>✓ En el registro</span>}
                                    {c.motivo     && <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{c.motivo}</span>}
                                    {c.ley_nombre && <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{c.ley_nombre}</span>}
                                  </div>
                                  {c.observaciones && (
                                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      "{c.observaciones}"
                                    </div>
                                  )}
                                  <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 2 }}>
                                    Agendada: {fmtFecha(c.created_at)}
                                    {c.creado_por_nombre && ` · por ${c.creado_por_nombre}`}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  {c.estado !== 'ATENDIDA' && (
                                    <button onClick={() => patchCita(c.id, { estado: 'ATENDIDA' }, 'Cita marcada como atendida')}
                                      disabled={ctGuardando}
                                      style={{ ...S.btn, background: '#14532d', color: '#86efac', padding: '5px 10px', fontSize: '0.76rem' }}>
                                      ✅ Atendida
                                    </button>
                                  )}
                                  {c.estado !== 'AUSENTE' && c.estado !== 'ATENDIDA' && (
                                    <button onClick={() => patchCita(c.id, { estado: 'AUSENTE' }, 'Cita marcada como no asistió')}
                                      disabled={ctGuardando}
                                      style={{ ...S.btn, background: '#450a0a', color: '#fca5a5', padding: '5px 10px', fontSize: '0.76rem' }}>
                                      🚫 No asistió
                                    </button>
                                  )}
                                  {!c.registro_id && (
                                    <button onClick={() => { setCtEditId(null); setCtPromoverId(ctPromoverId === c.id ? null : c.id); }}
                                      style={{ ...S.btn, background: '#4c1d95', color: '#ddd6fe', padding: '5px 10px', fontSize: '0.76rem' }}>
                                      ➕ A Posibles Jubilados
                                    </button>
                                  )}
                                  <button onClick={() => abrirCtEdit(c)}
                                    style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#94a3b8', padding: '5px 12px', fontSize: '0.76rem' }}>
                                    ✏️ Editar
                                  </button>
                                  <button onClick={() => eliminarCita(c.id)}
                                    style={{ ...S.btn, background: '#450a0a', color: '#fca5a5', padding: '5px 10px', fontSize: '0.76rem' }}>
                                    ✕
                                  </button>
                                </div>
                              </div>

                              {ctPromoverId === c.id && (
                                <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12, display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
                                  <div style={{ width: 170 }}>
                                    <label style={S.label}>Fecha (mes de corte)</label>
                                    <select style={S.select} value={ctPromMesCorte} onChange={e => setCtPromMesCorte(e.target.value)}>
                                      <option value="MARZO">Marzo</option>
                                      <option value="JUNIO">Junio</option>
                                      <option value="SEPTIEMBRE">Septiembre</option>
                                      <option value="DICIEMBRE">Diciembre</option>
                                    </select>
                                  </div>
                                  <button style={{ ...S.btn, background: ctGuardando ? '#374151' : '#166534', color: '#86efac' }}
                                    onClick={() => promoverCita(c.id)} disabled={ctGuardando}>
                                    {ctGuardando ? '⏳ Agregando...' : '➕ Agregar al registro'}
                                  </button>
                                  <button style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}
                                    onClick={() => setCtPromoverId(null)}>Cancelar</button>
                                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                    Se agrega el agente a Posibles Jubilados y la cita queda marcada como atendida.
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <CronogramaJubilacion />
          </div>
        )}

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

                {/* Vencimientos del trámite: papeles o jubilación dentro de 60 días (o ya vencidos) */}
                <button onClick={() => setPjSoloProximos(v => !v)}
                  style={{ ...S.btn, padding: '5px 12px', fontSize: '0.76rem', marginLeft: 8,
                    background: pjSoloProximos ? '#7f1d1d' : 'rgba(255,255,255,0.05)',
                    color:      pjSoloProximos ? '#fecaca' : '#94a3b8',
                    border:     pjSoloProximos ? '1px solid #dc2626' : '1px solid rgba(255,255,255,0.08)',
                  }}>
                  ⏰ Fechas próximas
                </button>
              </div>

              {pjCargando ? (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '0.85rem' }}>Cargando...</div>
              ) : pjListaFiltrada.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0', fontSize: '0.85rem' }}>
                  {pjSoloProximos
                    ? 'Sin fechas de papeles o jubilación en los próximos 60 días'
                    : pjFiltro ? `Sin registros con estado "${pjEstadoLabel(pjFiltro)}"` : 'No hay posibles jubilados registrados'}
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
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 10 }}>
                            <div>
                              <label style={S.label}>Presentación de papeles</label>
                              <input type="date" style={S.input} value={pjEditFPapeles}
                                onChange={e => setPjEditFPapeles(e.target.value)} />
                            </div>
                            <div>
                              <label style={S.label}>Fecha de jubilación</label>
                              <input type="date" style={S.input} value={pjEditFJubilacion}
                                onChange={e => setPjEditFJubilacion(e.target.value)} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                              <span style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.35 }}>
                                Cada fecha cargada avisa en el legajo del agente y el aviso queda hasta que la fecha pase.
                              </span>
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
                            {(pj.fecha_presentacion_papeles || pj.fecha_jubilacion) && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 3 }}>
                                {pj.fecha_presentacion_papeles && (
                                  <span style={fechaChipStyle(pj.fecha_presentacion_papeles, pj.estado)}>
                                    📄 Papeles: {fmtFecha(pj.fecha_presentacion_papeles)}{sufijoDias(diasHasta(pj.fecha_presentacion_papeles))}
                                  </span>
                                )}
                                {pj.fecha_jubilacion && (
                                  <span style={fechaChipStyle(pj.fecha_jubilacion, pj.estado)}>
                                    🏁 Jubilación: {fmtFecha(pj.fecha_jubilacion)}{sufijoDias(diasHasta(pj.fecha_jubilacion))}
                                  </span>
                                )}
                              </div>
                            )}
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
            <CronogramaJubilacion />
          </div>
        )}
      </div>
    </Layout>
  );
}
