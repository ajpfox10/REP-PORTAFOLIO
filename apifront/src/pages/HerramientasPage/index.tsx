// src/pages/HerramientasPage/index.tsx
// Calculadora de Jubilación IPS — Leyes 10471/10430 · Decretos 598/2015, 58/2015, 1554/2022

import React, { Fragment, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate }    from 'react-router-dom';
import { Layout }         from '../../components/Layout';
import { apiFetch }       from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { exportToExcel }  from '../../utils/export';
import { useToast }                     from '../../ui/toast';
import { AlertaBannerAgenteConMensaje } from '../../components/AlertaBannerAgente';
import { ITEMS_CHECKLIST, FormNumeros, camposDeItem } from './ChecklistNumeros';
import { GraficoEvolucion, SERIE_COLORES, SERIE_OTRO, type SerieEvolucion } from './GraficoEvolucion';
import { BadgeControlado, indexarControles, type ControlServicio } from './ControlServicio';
import { useAuth } from '../../auth/AuthProvider';

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

// ── Proyección por servicio ───────────────────────────────────────────────────
// Una fila por agente activo, con la fecha en la que cumple los requisitos
// jubilatorios (la calcula el backend con el mismo motor que la calculadora).
type CorteProy = 'CUMPLE' | 'HASTA_6M' | 'HASTA_12M' | 'MAS_ADELANTE' | 'NO_COMPUTA' | 'SIN_DATOS';

interface FilaProyeccion {
  dni:                number;
  apellido:           string;
  nombre:             string;
  fecha_nacimiento:   string | null;
  fecha_ingreso:      string | null;
  fecha_nombramiento?: string | null;
  tiene_beca?:        boolean;
  beca_aporto?:       boolean;
  es_jefe?:           boolean;
  tramos_anteriores?: Array<{ desde: string | null; hasta: string | null; ley: string | null }>;
  ley_id:             number | null;
  ley_nombre:         string | null;
  ocupacion_nombre:   string | null;
  servicio_id:        number | null;
  servicio_nombre:    string | null;
  reparticion_id:     number | null;
  reparticion_nombre: string | null;
  dependencia_id:     number | null;
  dependencia_nombre: string | null;
  situacion_revista:  string;
  edad:               Periodo | null;
  antiguedad_ips:     Periodo;
  total_comun:        Periodo;
  total_insalubre:    Periodo;
  total_prorateado:   Periodo;
  cumple_edad:        boolean;
  cumple_servicio:    boolean;
  falta_edad:         Periodo;
  falta_servicio:     Periodo;
  tipo_jubilacion:    string | null;
  tipo_al_cumplir:    string | null;
  caja_jubilatoria:   'IPS' | 'ANSES';
  fecha_cumple:       string | null;
  dias_para_cumplir:  number | null;
  corte:              CorteProy;
  // Escenario "si paga los aportes" (reconocimiento de servicios de beca,
  // residencia o concurrencia). Sólo viene cuando hay tiempo impago.
  pago_posible:             boolean;
  periodo_a_reconocer:      Periodo | null;
  cargo_deudor_2pct:        boolean;
  cargo_deudor_periodo:     Periodo | null;
  es_insalubre_ocupacion:   boolean;
  es_insalubre_efectivo:    boolean;
  fecha_cumple_con_pago:    string | null;
  corte_con_pago:           CorteProy | null;
  tipo_al_cumplir_con_pago: string | null;
  sin_aportes:        boolean;
  sin_datos_anses:    boolean;
  origen_datos:       'CALCULO' | 'ESTIMADO';
  datos_actualizados_en?: string | null;
  estado_posible:     string | null;
}

interface EstructuraProy {
  dependencias:  Array<{ id: number; nombre: string }>;
  reparticiones: Array<{ id: number; nombre: string; dependencia_id: number | null }>;
  servicios:     Array<{ id: number; nombre: string; reparticion_id: number | null }>;
  leyes:         Array<{ id: number; nombre: string }>;
}

const CORTE_LABEL: Record<CorteProy, string> = {
  CUMPLE:       'Ya está en condiciones',
  HASTA_6M:     'Dentro de 6 meses',
  HASTA_12M:    'Dentro de 12 meses',
  MAS_ADELANTE: 'Más adelante',
  NO_COMPUTA:   'No computa aportes',
  SIN_DATOS:    'Sin datos para proyectar',
};

const CORTE_COLOR: Record<CorteProy, { bg: string; fg: string }> = {
  CUMPLE:       { bg: '#14532d', fg: '#86efac' },
  HASTA_6M:     { bg: '#713f12', fg: '#fef08a' },
  HASTA_12M:    { bg: '#0c1a4a', fg: '#93c5fd' },
  MAS_ADELANTE: { bg: '#1e293b', fg: '#94a3b8' },
  NO_COMPUTA:   { bg: '#2e1065', fg: '#d8b4fe' },
  SIN_DATOS:    { bg: '#450a0a', fg: '#fca5a5' },
};

// Tipo corto para la tabla (el largo, con los requisitos, va en TIPOS_JUBILACION)
const TIPO_CORTO: Record<string, string> = {
  ORDINARIA:             'Ordinaria',
  AGOTAMIENTO_PREMATURO: 'Agot. prematuro',
  PRORRATEO:             'Prorrateo',
};

// Qué es lo que este agente tendría que pagar, en texto corto. Son dos deudas
// distintas: los aportes del tiempo de beca / residencia / concurrencia (que
// suma servicio nuevo) y el diferencial del 2% anterior a Jun/2015 (que no suma
// días pero pasa ese tramo de común a insalubre). Pueden darse las dos juntas.
const descPago = (f: FilaProyeccion): string => [
  f.periodo_a_reconocer ? fmtPeriodo(f.periodo_a_reconocer) : null,
  f.cargo_deudor_2pct   ? `el 2% de ${fmtPeriodo(f.cargo_deudor_periodo)}` : null,
].filter(Boolean).join(' + ');

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

// Opciones de corte que ofrece el backend (GET /jubilacion/cortes): el que
// corresponde hoy segun el cronograma y los cuatro anteriores. No hay opcion
// posterior: el corte se puede atrasar, nunca adelantar.
export interface OpcionCorte {
  mesCorte: string;
  anioBaja: number;
  fechaBaja: string;
  papelesDesde: string;
  papelesHasta: string;
  vigente: boolean;
}

const fmtISO = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return new Date(y, m - 1, d).toLocaleDateString('es-AR');
};

const MES_LABEL: Record<string, string> = {
  MARZO: 'Marzo', JUNIO: 'Junio', SEPTIEMBRE: 'Septiembre', DICIEMBRE: 'Diciembre',
};

const opcionLabel = (o: OpcionCorte) =>
  `${MES_LABEL[o.mesCorte] ?? o.mesCorte} ${o.anioBaja}${o.vigente ? ' \u2014 corresponde' : ' (atrasado)'}`;

// Selector de corte. Arranca en el vigente; los anteriores quedan disponibles
// para registrar un tramite que se esta regularizando.
function SelectorCorte({ opciones, value, onChange, label = 'Fecha (mes de corte)' }: {
  opciones: OpcionCorte[];
  value: string;
  onChange: (mesCorte: string) => void;
  label?: string;
}) {
  const elegida = opciones.find(o => o.mesCorte === value);
  const huerfana = value && !elegida; // corte guardado que ya no esta en la lista
  return (
    <div>
      <label style={S.label}>{label}</label>
      <select style={S.select} value={value} onChange={e => onChange(e.target.value)}>
        {opciones.length === 0 && <option value="">Cargando...</option>}
        {huerfana && <option value={value}>{MES_LABEL[value] ?? value} (cargado)</option>}
        {opciones.map(o => (
          <option key={`${o.mesCorte}-${o.anioBaja}`} value={o.mesCorte}>{opcionLabel(o)}</option>
        ))}
      </select>
      {elegida && (
        <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 3, lineHeight: 1.35 }}>
          Baja {fmtISO(elegida.fechaBaja)} \u00b7 papeles del {fmtISO(elegida.papelesDesde)} al {fmtISO(elegida.papelesHasta)}
        </div>
      )}
    </div>
  );
}

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

// Pasos del tramite jubilatorio, en el orden en que se cargan.
// El value tiene que coincidir con el enum de posibles_jubilados_checklist.
// Cuadro de tildes de una ficha. Cada paso muestra quien lo tildo y cuando.
// Los pasos de expediente (GDEBA / IPS) no se tildan derecho: primero piden el
// numero, y recien al confirmar se manda el PUT.
function ChecklistTramite({ pj, guardando, onToggle }: {
  pj: any;
  guardando: string | null;
  onToggle: (id: number, item: string, tildado: boolean, numeros?: Record<string, string>) => void;
}) {
  const hechos: Record<string, any> = {};
  for (const t of (pj.checklist ?? [])) hechos[t.item] = t;
  const completos = ITEMS_CHECKLIST.every(i => hechos[i.value]);

  // Paso esperando que se carguen sus numeros.
  const [pidiendo, setPidiendo] = useState<string | null>(null);

  return (
    <div style={{
      marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)',
    }}>
      <div style={{ ...S.label, marginBottom: 6 }}>
        Carga del trámite
        {completos && <span style={{ color: '#86efac', marginLeft: 8 }}>✓ completa</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {ITEMS_CHECKLIST.map(item => {
          const hecho = !!hechos[item.value];
          const busy  = guardando === `${pj.id}:${item.value}`;
          return (
            <label key={item.value} style={{ ...S.chkRow, marginTop: 0, opacity: busy ? 0.5 : 1 }}>
              <input
                type="checkbox"
                style={S.chk}
                checked={hecho}
                disabled={busy}
                onChange={e => {
                  if (e.target.checked && item.campos) setPidiendo(item.value);
                  else onToggle(pj.id, item.value, e.target.checked);
                }}
              />
              <span style={{ fontSize: '0.8rem', color: hecho ? '#86efac' : '#94a3b8', fontWeight: hecho ? 700 : 400 }}>
                {item.label}
                {hecho && (item.campos ?? []).filter(c => pj[c.columna]).map(c => (
                  <span key={c.columna} style={{ color: '#7dd3fc', fontWeight: 400 }}> · {pj[c.columna]}</span>
                ))}
              </span>
              {hecho && hechos[item.value].por && (
                <span style={{ fontSize: '0.68rem', color: '#475569' }}>
                  {hechos[item.value].por}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {pidiendo && (
        <FormNumeros
          item={pidiendo}
          valores={pj}
          guardando={guardando === `${pj.id}:${pidiendo}`}
          onGuardar={numeros => { onToggle(pj.id, pidiendo, true, numeros); setPidiendo(null); }}
          onCancelar={() => setPidiendo(null)}
        />
      )}
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
  const navigate = useNavigate();

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

  // Ficha ANSES persistida del agente (jubilacion_anses): alimenta la proyección.
  const [fichaAnses,     setFichaAnses]     = useState<any | null>(null);
  const [fichaGuardando, setFichaGuardando] = useState(false);

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
  const [tab, setTab] = useState<'calculadora' | 'proyeccion' | 'percentil' | 'posibles' | 'citas'>('calculadora');

  // ── Proyección por servicio — estado ──────────────────────────────────────
  // El backend devuelve el padrón activo entero proyectado a la fecha elegida;
  // los filtros (dependencia / repartición / servicio / ley / texto) se aplican
  // acá, sobre lo ya traído, así cambiar de servicio no vuelve a calcular.
  const [pyFecha,       setPyFecha]       = useState(TODAY_ISO);
  const [pyDep,         setPyDep]         = useState('');
  const [pyRep,         setPyRep]         = useState('');
  const [pySrv,         setPySrv]         = useState('');
  const [pyLey,         setPyLey]         = useState('');
  const [pyQ,           setPyQ]           = useState('');
  const [pyCorte,       setPyCorte]       = useState<CorteProy | 'TODOS'>('TODOS');
  const [pyEstructura,  setPyEstructura]  = useState<EstructuraProy | null>(null);
  const [pyData,        setPyData]        = useState<FilaProyeccion[]>([]);
  // Servicios marcados como controlados (✔ con tooltip). Sólo admin los marca.
  const [pyControles,   setPyControles]   = useState<ControlServicio[]>([]);
  const { hasPerm } = useAuth();
  const esAdmin = hasPerm('crud:*:*');
  const [pyFechas,      setPyFechas]      = useState<{ fecha: string; fecha_6m: string; fecha_12m: string } | null>(null);
  const [pyCargando,    setPyCargando]    = useState(false);
  const [pyCorrido,     setPyCorrido]     = useState(false);
  const [pyOrden,       setPyOrden]       = useState<'FECHA' | 'APELLIDO' | 'SERVICIO' | 'EDAD'>('FECHA');
  const [pyVista,       setPyVista]       = useState<'AGENTES' | 'SERVICIOS'>('AGENTES');
  const [pyAgregando,   setPyAgregando]   = useState<number | null>(null);
  // Mira la proyección suponiendo que el agente paga los aportes del tiempo de
  // beca / residencia / concurrencia (reconocimiento de servicios).
  const [pyConPago,     setPyConPago]     = useState(false);
  // Pestaña "Percentil por servicio": a qué fecha se llega al X% del plantel
  // de cada servicio en condiciones de jubilarse (usa el mismo pyData).
  const [pyUmbral,      setPyUmbral]      = useState(90);
  const [pySrvAbierto,  setPySrvAbierto]  = useState<string | null>(null);
  // Selección múltiple de servicios, propia de la pestaña Percentil. Cada uno
  // con su ley ('' = todas): Laboratorio puede ir con Guardia y Farmacia con Planta.
  const [pySrvs,        setPySrvs]        = useState<Array<{ srv: string; ley: string }>>([]);

  // ── Posibles Jubilados — estado ───────────────────────────────────────────
  const [pjBusqueda,    setPjBusqueda]    = useState('');
  const [pjSugerencias, setPjSugerencias] = useState<any[]>([]);
  const [pjBuscando,    setPjBuscando]    = useState(false);
  const pjTimer                           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pjAgente,      setPjAgente]      = useState<any | null>(null);
  const [pjMesCorte,    setPjMesCorte]    = useState('');
  const [pjCortes,      setPjCortes]      = useState<OpcionCorte[]>([]);
  const [pjChkGuardando, setPjChkGuardando] = useState<string | null>(null);
  const [pjLista,       setPjLista]       = useState<any[]>([]);
  const [pjCargando,    setPjCargando]    = useState(false);
  const [pjFiltro,      setPjFiltro]      = useState('');
  const [pjEditId,      setPjEditId]      = useState<number | null>(null);
  const [pjEditEstado,  setPjEditEstado]  = useState('');
  const [pjEditMesCorte,setPjEditMesCorte]= useState('');
  const [pjEditObs,     setPjEditObs]     = useState('');
  const [pjEditFPapeles,   setPjEditFPapeles]   = useState('');
  const [pjEditFJubilacion,setPjEditFJubilacion]= useState('');
  const [pjEditExpteIps,  setPjEditExpteIps]   = useState('');
  const [pjEditExpteGdeba, setPjEditExpteGdeba] = useState('');
  const [pjEditIfgra1,    setPjEditIfgra1]     = useState('');
  const [pjEditIfgra2,    setPjEditIfgra2]     = useState('');
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
  const [ctPromMesCorte,setCtPromMesCorte]= useState('');

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

      // Ficha ANSES guardada del agente: se precarga para no volver a leer el
      // PDF. Si después se confirma un cálculo, ese manda sobre la ficha.
      setFichaAnses(null);
      try {
        const fi = await apiFetch<any>(`/jubilacion/anses/${d.dni}`);
        if (fi?.data) {
          setFichaAnses(fi.data);
          if ((fi.data.servicios ?? []).length) setServiciosAnses(fi.data.servicios);
        }
      } catch { /* sin ficha se carga a mano, como antes */ }

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

  // Opciones de corte: las calcula el backend desde el cronograma del IPS.
  const cargarCortes = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/jubilacion/cortes');
      const ops: OpcionCorte[] = res?.data ?? [];
      setPjCortes(ops);
      // El backend dice cual arranca elegido (normalmente el vigente).
      const def = res?.sugerido?.mesCorte ?? ops.find(o => o.vigente)?.mesCorte ?? '';
      setPjMesCorte(prev => prev || def);
      setCtPromMesCorte(prev => prev || def);
    } catch { /* el selector queda vacio y el backend igual decide el corte */ }
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
        body: JSON.stringify({
          dni: pjAgente.dni,
          // Sin valor elegido, el backend usa el corte que corresponde hoy.
          ...(pjMesCorte ? { mes_corte: pjMesCorte } : {}),
        }),
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

  // Tilda / destilda un paso del tramite. Refresca la lista para traer quien lo
  // tildo, que lo pone el backend con el usuario del token.
  const pjToggleChecklist = useCallback(async (id: number, item: string, tildado: boolean, numeros?: Record<string, string>) => {
    setPjChkGuardando(`${id}:${item}`);
    // Los pasos con numero devuelven ademas sus columnas ya guardadas.
    const campos = camposDeItem(item);
    try {
      const res = await apiFetch<any>(`/jubilacion/posibles/${id}/checklist`, {
        method: 'PUT',
        body: JSON.stringify({ item, tildado, ...(campos.length ? { numeros: numeros ?? {} } : {}) }),
      });
      if (res?.ok) {
        setPjLista((prev: any[]) => prev.map((p: any) =>
          p.id === id
            ? {
                ...p,
                checklist: res.checklist,
                items_faltantes: res.items_faltantes,
                ...Object.fromEntries(campos.map(c => [c.columna, res[c.columna] ?? null])),
              }
            : p));
      } else {
        toast.error(res?.error ?? 'No se pudo guardar el tilde');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally { setPjChkGuardando(null); }
  }, [toast]);

  const abrirPjEdit = useCallback((pj: any) => {
    setPjEditId(pj.id);
    setPjEditEstado(pj.estado);
    setPjEditMesCorte(pj.mes_corte ?? pjCortes.find(o => o.vigente)?.mesCorte ?? '');
    setPjEditObs(pj.observaciones ?? '');
    setPjEditFPapeles(toInputDate(pj.fecha_presentacion_papeles));
    setPjEditFJubilacion(toInputDate(pj.fecha_jubilacion));
    setPjEditExpteIps(pj.expediente_ips ?? '');
    setPjEditExpteGdeba(pj.expediente_gdeba ?? '');
    setPjEditIfgra1(pj.ifgra_1 ?? '');
    setPjEditIfgra2(pj.ifgra_2 ?? '');
  }, [pjCortes]);

  // Cambiar el corte en la edicion reescribe las dos fechas del cronograma:
  // son datos derivados, no se cargan a mano salvo excepcion.
  const cambiarCorteEdit = useCallback((mesCorte: string) => {
    setPjEditMesCorte(mesCorte);
    const o = pjCortes.find(x => x.mesCorte === mesCorte);
    if (o) {
      setPjEditFPapeles(o.papelesDesde);
      setPjEditFJubilacion(o.fechaBaja);
    }
  }, [pjCortes]);

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
          expediente_ips:             pjEditExpteIps.trim() || null,
          expediente_gdeba:           pjEditExpteGdeba.trim() || null,
          ifgra_1:                    pjEditIfgra1.trim() || null,
          ifgra_2:                    pjEditIfgra2.trim() || null,
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
  }, [pjEditEstado, pjEditMesCorte, pjEditObs, pjEditFPapeles, pjEditFJubilacion, pjEditExpteIps, pjEditExpteGdeba, pjEditIfgra1, pjEditIfgra2, cargarPosibles, toast]);

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

  // ── Ficha ANSES del agente ────────────────────────────────────────────────
  // Los tramos de ANSES se guardan aparte del cálculo para que la proyección
  // del padrón pueda usarlos (antes vivían sólo adentro de un cálculo guardado).
  const guardarFichaAnses = useCallback(async () => {
    if (!agente) return;
    setFichaGuardando(true);
    try {
      const validos = serviciosAnses.filter(a => a.fecha_desde && a.fecha_hasta);
      const res = await apiFetch<any>(`/jubilacion/anses/${agente.dni}`, {
        method: 'PUT',
        body: JSON.stringify({
          servicios:   validos,
          // Sin líneas, se registra que ya se revisó y no tiene aportes.
          tiene_datos: validos.length > 0,
          origen:      revision ? 'PDF' : 'MANUAL',
          ...(pdfOrigen ? { archivo_origen: pdfOrigen } : {}),
        }),
      });
      if (res?.ok) {
        toast.ok(validos.length
          ? `Ficha ANSES guardada (${validos.length} línea/s)`
          : 'Se registró que el agente no tiene aportes en ANSES');
        setFichaAnses({ servicios: validos, tiene_datos: validos.length > 0 });
      } else {
        toast.error(res?.error ?? 'No se pudo guardar la ficha ANSES');
      }
    } catch (e: any) {
      toast.error('Error al guardar la ficha ANSES: ' + e?.message);
    } finally { setFichaGuardando(false); }
  }, [agente, serviciosAnses, revision, pdfOrigen, toast]);

  // ── Proyección por servicio — funciones ───────────────────────────────────
  const cargarEstructuraProy = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/jubilacion/proyeccion/estructura');
      if (res?.data) setPyEstructura(res.data);
    } catch { /* sin catálogos los selectores quedan vacíos, la tabla igual anda */ }
  }, []);

  // El cálculo del padrón entero es caro: se corre a pedido y cuando cambia la
  // fecha de corte, nunca al tipear en los filtros.
  const correrProyeccion = useCallback(async () => {
    setPyCargando(true);
    try {
      const res = await apiFetch<any>(`/jubilacion/proyeccion?fecha=${encodeURIComponent(pyFecha)}`);
      if (!res?.ok) { toast.error(res?.error ?? 'Error al proyectar'); return; }
      setPyData(res.data ?? []);
      setPyControles(res.servicios_controlados ?? []);
      setPyFechas({ fecha: res.fecha, fecha_6m: res.fecha_6m, fecha_12m: res.fecha_12m });
      setPyCorrido(true);
    } catch (e: any) {
      toast.error('Error al proyectar: ' + e?.message);
    } finally { setPyCargando(false); }
  }, [pyFecha, toast]);

  const pyControlPorSrv = useMemo(() => indexarControles(pyControles), [pyControles]);

  // Último cálculo guardado / ficha ANSES de alguien del servicio: si es
  // posterior al control, el tooltip avisa.
  const pyUltimoCambioPorSrv = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of pyData) {
      const k = String(f.servicio_id ?? '');
      const c = f.datos_actualizados_en;
      if (k && c && (!m.has(k) || c > m.get(k)!)) m.set(k, c);
    }
    return m;
  }, [pyData]);

  const marcarControlado = useCallback(async (servicioId: number, nombre: string) => {
    const nota = window.prompt(`Marcar «${nombre}» como controlado.\nNota (opcional):`, '');
    if (nota === null) return;
    try {
      const res = await apiFetch<any>(`/jubilacion/servicios-controlados/${servicioId}`, {
        method: 'POST', body: JSON.stringify({ nota }),
      });
      if (!res?.ok) { toast.error(res?.error ?? 'No se pudo marcar'); return; }
      setPyControles(res.servicios_controlados ?? []);
      toast.ok('Servicio marcado como controlado');
    } catch (e: any) { toast.error('No se pudo marcar: ' + e?.message); }
  }, [toast]);

  const desmarcarControlado = useCallback(async (servicioId: number, nombre: string) => {
    if (!window.confirm(`¿Quitar la marca de controlado a «${nombre}»?`)) return;
    try {
      const res = await apiFetch<any>(`/jubilacion/servicios-controlados/${servicioId}`, { method: 'DELETE' });
      if (!res?.ok) { toast.error(res?.error ?? 'No se pudo desmarcar'); return; }
      setPyControles(res.servicios_controlados ?? []);
    } catch (e: any) { toast.error('No se pudo desmarcar: ' + e?.message); }
  }, [toast]);

  // Repartición y servicio se acotan a lo que cuelga de lo elegido arriba.
  const pyReparticiones = useMemo(() => {
    const todas = pyEstructura?.reparticiones ?? [];
    return pyDep ? todas.filter(r => String(r.dependencia_id ?? '') === pyDep) : todas;
  }, [pyEstructura, pyDep]);

  const pyServicios = useMemo(() => {
    const todos = pyEstructura?.servicios ?? [];
    if (pyRep) return todos.filter(s => String(s.reparticion_id ?? '') === pyRep);
    if (pyDep) {
      const ids = new Set(pyReparticiones.map(r => String(r.id)));
      return todos.filter(s => ids.has(String(s.reparticion_id ?? '')));
    }
    return todos;
  }, [pyEstructura, pyDep, pyRep, pyReparticiones]);

  // Con el escenario de pago activo, la fila se mira por su fecha y su corte
  // "si paga"; si ese agente no tiene nada que pagar, queda como está.
  const corteDe  = useCallback((f: FilaProyeccion): CorteProy =>
    (pyConPago && f.pago_posible && f.corte_con_pago ? f.corte_con_pago : f.corte), [pyConPago]);
  const fechaDe  = useCallback((f: FilaProyeccion): string | null =>
    (pyConPago && f.pago_posible ? f.fecha_cumple_con_pago : f.fecha_cumple), [pyConPago]);
  const tipoDe   = useCallback((f: FilaProyeccion): string | null =>
    (pyConPago && f.pago_posible ? f.tipo_al_cumplir_con_pago : f.tipo_al_cumplir), [pyConPago]);

  const pyFiltrada = useMemo(() => {
    const q = pyQ.trim().toLowerCase();
    const filas = pyData.filter(f => {
      if (pyDep   && String(f.dependencia_id ?? '') !== pyDep) return false;
      if (pyRep   && String(f.reparticion_id ?? '') !== pyRep) return false;
      if (pySrv   && String(f.servicio_id ?? '')    !== pySrv) return false;
      if (pyLey   && String(f.ley_id ?? '')         !== pyLey) return false;
      if (pyCorte !== 'TODOS' && corteDe(f) !== pyCorte)       return false;
      if (q) {
        const txt = `${f.apellido} ${f.nombre} ${f.dni}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
    const porFecha = (a: FilaProyeccion, b: FilaProyeccion) => {
      // Sin fecha proyectada van al fondo.
      const fa = fechaDe(a), fb = fechaDe(b);
      if (!fa && !fb) return 0;
      if (!fa) return 1;
      if (!fb) return -1;
      return fa.localeCompare(fb);
    };
    const porNombre = (a: FilaProyeccion, b: FilaProyeccion) =>
      `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`);
    const cmp = {
      FECHA:    (a: FilaProyeccion, b: FilaProyeccion) => porFecha(a, b) || porNombre(a, b),
      APELLIDO: porNombre,
      SERVICIO: (a: FilaProyeccion, b: FilaProyeccion) =>
        String(a.servicio_nombre ?? '').localeCompare(String(b.servicio_nombre ?? '')) || porFecha(a, b),
      EDAD:     (a: FilaProyeccion, b: FilaProyeccion) =>
        (b.edad?.anios ?? 0) - (a.edad?.anios ?? 0) || porNombre(a, b),
    }[pyOrden];
    return [...filas].sort(cmp);
  }, [pyData, pyDep, pyRep, pySrv, pyLey, pyQ, pyCorte, pyOrden, corteDe, fechaDe]);

  // Los totales acompañan al filtro, salvo el de corte: las tarjetas tienen que
  // seguir mostrando los cinco grupos aunque se esté mirando uno solo.
  const pyBase = useMemo(() => {
    const q = pyQ.trim().toLowerCase();
    return pyData.filter(f => {
      if (pyDep && String(f.dependencia_id ?? '') !== pyDep) return false;
      if (pyRep && String(f.reparticion_id ?? '') !== pyRep) return false;
      if (pySrv && String(f.servicio_id ?? '')    !== pySrv) return false;
      if (pyLey && String(f.ley_id ?? '')         !== pyLey) return false;
      if (q && !`${f.apellido} ${f.nombre} ${f.dni}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pyData, pyDep, pyRep, pySrv, pyLey, pyQ]);

  const pyResumen = useMemo(() => {
    const acc: Record<CorteProy, number> = {
      CUMPLE: 0, HASTA_6M: 0, HASTA_12M: 0, MAS_ADELANTE: 0, NO_COMPUTA: 0, SIN_DATOS: 0,
    };
    let sinAnses = 0;
    let conPago  = 0;
    let deudor2  = 0;
    for (const f of pyBase) {
      acc[corteDe(f)]++;
      if (f.sin_datos_anses)   sinAnses++;
      if (f.pago_posible)      conPago++;
      if (f.cargo_deudor_2pct) deudor2++;
    }
    return { ...acc, total: pyBase.length, sin_anses: sinAnses, con_pago: conPago, deudor_2pct: deudor2 };
  }, [pyBase, corteDe]);

  const pyPorServicio = useMemo(() => {
    const m = new Map<string, any>();
    for (const f of pyBase) {
      const key = String(f.servicio_id ?? 'SIN');
      if (!m.has(key)) {
        m.set(key, {
          servicio_id: f.servicio_id,
          servicio_nombre: f.servicio_nombre ?? '(sin servicio asignado)',
          dependencia_nombre: f.dependencia_nombre,
          CUMPLE: 0, HASTA_6M: 0, HASTA_12M: 0, MAS_ADELANTE: 0, NO_COMPUTA: 0, SIN_DATOS: 0, total: 0,
        });
      }
      const g = m.get(key);
      g[corteDe(f)]++; g.total++;
    }
    return Array.from(m.values()).sort(
      (a, b) => (b.CUMPLE + b.HASTA_6M) - (a.CUMPLE + a.HASTA_6M) ||
                String(a.servicio_nombre).localeCompare(String(b.servicio_nombre)),
    );
  }, [pyBase, corteDe]);

  // Fecha en la que se alcanza el X% (pyUmbral) del plantel de un servicio en
  // condiciones de jubilarse. Se excluyen del cálculo (numerador y denominador)
  // los agentes que no computan aportes o no tienen datos para proyectar:
  // el porcentaje es sobre el plantel proyectable, no sobre la nómina completa.
  // Espera `fechas` ordenadas. `alcanzan` cuenta a todos los que cumplen hasta
  // esa fecha (incluye empates), por eso el % real puede superar el umbral.
  const fechaPercentil = useCallback((fechas: string[], umbral: number) => {
    const n = fechas.length;
    if (!n) return { fecha: null as string | null, alcanzan: 0, pct: 0 };
    const idx = Math.min(n - 1, Math.max(0, Math.ceil((umbral / 100) * n) - 1));
    const fecha = fechas[idx];
    const alcanzan = fechas.filter(x => x <= fecha).length;
    return { fecha, alcanzan, pct: Math.round(alcanzan / n * 100) };
  }, []);

  // La del último cálculo, no la del input: si cambió y no se recalculó, se
  // sigue midiendo contra lo que realmente se proyectó.
  const pyFechaCorte = pyFechas?.fecha ?? pyFecha;

  const leyCorta = useCallback((id: string) =>
    (pyEstructura?.leyes.find(l => String(l.id) === id)?.nombre ?? `Ley ${id}`).replace(/^LEY\s*/i, ''),
  [pyEstructura]);

  // Cada agente con el grupo (fila) al que pertenece. Sin servicios elegidos:
  // un grupo por servicio y rige el filtro de ley general. Con servicios
  // elegidos: un grupo por par servicio+ley de la selección.
  const pctGrupos = useMemo(() => {
    const out: Array<{ f: FilaProyeccion; key: string; nombre: string }> = [];
    for (const f of pyData) {
      if (pyDep && String(f.dependencia_id ?? '') !== pyDep) continue;
      if (pyRep && String(f.reparticion_id ?? '') !== pyRep) continue;
      const srv = String(f.servicio_id ?? '');
      const ley = String(f.ley_id ?? '');
      if (!pySrvs.length) {
        if (pyLey && ley !== pyLey) continue;
        out.push({ f, key: srv || 'SIN', nombre: f.servicio_nombre ?? '(sin servicio asignado)' });
        continue;
      }
      for (const sel of pySrvs) {
        if (sel.srv !== srv || (sel.ley && sel.ley !== ley)) continue;
        out.push({
          f, key: `${sel.srv}|${sel.ley}`,
          nombre: `${f.servicio_nombre ?? ''} · ${sel.ley ? leyCorta(sel.ley) : 'todas las leyes'}`,
        });
      }
    }
    return out;
  }, [pyData, pyDep, pyRep, pyLey, pySrvs, leyCorta]);

  // Agentes únicos (un agente puede caer en dos grupos si se repite el servicio).
  const pctBase = useMemo(() => {
    const vistos = new Set<number>();
    return pctGrupos.filter(({ f }) => !vistos.has(f.dni) && !!vistos.add(f.dni)).map(({ f }) => f);
  }, [pctGrupos]);

  const pyPercentilPorServicio = useMemo(() => {
    const m = new Map<string, {
      key: string; servicio_id: number | null; servicio_nombre: string; dependencia_nombre: string | null;
      fechas: string[]; excluidos: number; total: number;
    }>();
    for (const { f, key, nombre } of pctGrupos) {
      if (!m.has(key)) {
        m.set(key, {
          key,
          servicio_id: f.servicio_id,
          servicio_nombre: nombre,
          dependencia_nombre: f.dependencia_nombre,
          fechas: [], excluidos: 0, total: 0,
        });
      }
      const g = m.get(key)!;
      g.total++;
      const corte = corteDe(f);
      const fecha = fechaDe(f);
      if (corte === 'NO_COMPUTA' || corte === 'SIN_DATOS' || !fecha) {
        g.excluidos++;
      } else {
        g.fechas.push(fecha);
      }
    }
    const filas = Array.from(m.values()).map(g => {
      g.fechas.sort();
      const p = fechaPercentil(g.fechas, pyUmbral);
      const alCorte = g.fechas.filter(x => x <= pyFechaCorte).length;
      return {
        key:                g.key,
        servicio_id:        g.servicio_id,
        servicio_nombre:    g.servicio_nombre,
        dependencia_nombre: g.dependencia_nombre,
        total:              g.total,
        proyectables:       g.fechas.length,
        excluidos:          g.excluidos,
        fecha_umbral:       p.fecha,
        alcanzan:           p.alcanzan,
        pct:                p.pct,
        al_corte:           alCorte,
        pct_corte:          g.fechas.length ? Math.round(alCorte / g.fechas.length * 100) : 0,
        fechas:             g.fechas,
      };
    });
    filas.sort((a, b) => {
      if (!a.fecha_umbral && !b.fecha_umbral) return a.servicio_nombre.localeCompare(b.servicio_nombre);
      if (!a.fecha_umbral) return 1;
      if (!b.fecha_umbral) return -1;
      return a.fecha_umbral.localeCompare(b.fecha_umbral);
    });
    return filas;
  }, [pctGrupos, corteDe, fechaDe, pyUmbral, fechaPercentil, pyFechaCorte]);

  const pyAgentesPorServicio = useMemo(() => {
    const m = new Map<string, FilaProyeccion[]>();
    for (const { f, key } of pctGrupos) {
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(f);
    }
    for (const lista of m.values()) {
      lista.sort((a, b) => {
        const fa = fechaDe(a), fb = fechaDe(b);
        if (!fa && !fb) return a.apellido.localeCompare(b.apellido);
        if (!fa) return 1;
        if (!fb) return -1;
        return fa.localeCompare(fb);
      });
    }
    return m;
  }, [pctGrupos, fechaDe]);

  const pyPercentilTotal = useMemo(() => {
    const fechas: string[] = [];
    let excluidos = 0;
    for (const f of pctBase) {
      const corte = corteDe(f);
      const fecha = fechaDe(f);
      if (corte === 'NO_COMPUTA' || corte === 'SIN_DATOS' || !fecha) excluidos++;
      else fechas.push(fecha);
    }
    fechas.sort();
    const p = fechaPercentil(fechas, pyUmbral);
    const alCorte = fechas.filter(x => x <= pyFechaCorte).length;
    return {
      total: pctBase.length,
      proyectables: fechas.length,
      excluidos,
      fecha_umbral: p.fecha,
      alcanzan: p.alcanzan,
      pct: p.pct,
      al_corte: alCorte,
      pct_corte: fechas.length ? Math.round(alCorte / fechas.length * 100) : 0,
      fechas,
    };
  }, [pctBase, corteDe, fechaDe, pyUmbral, fechaPercentil, pyFechaCorte]);

  // Año a año desde la fecha del cálculo hasta que cumple todo el plantel
  // proyectable (tope 40 años, el mismo horizonte que usa el motor).
  const pyEvolucion = useMemo(() => {
    const { fechas } = pyPercentilTotal;
    const n = fechas.length;
    if (!n) return [];
    const [y, resto] = [Number(pyFechaCorte.slice(0, 4)), pyFechaCorte.slice(4, 10)];
    const out: Array<{ fecha: string; cantidad: number; pct: number }> = [];
    for (let k = 0; k <= 40; k++) {
      const fecha = `${y + k}${resto}`;
      const cantidad = fechas.filter(x => x <= fecha).length;
      out.push({ fecha, cantidad, pct: Math.round(cantidad / n * 100) });
      if (cantidad === n) break;
    }
    return out;
  }, [pyPercentilTotal, pyFechaCorte]);

  const pyEvolSeries = useMemo((): SerieEvolucion[] => {
    const filas = pyPercentilPorServicio.filter(g => g.proyectables > 0);
    // Índice de color estable: orden de selección, o alfabético si no hay selección.
    const orden = pySrvs.length
      ? pySrvs.map(s => `${s.srv}|${s.ley}`)
      : [...filas].sort((a, b) => a.servicio_nombre.localeCompare(b.servicio_nombre)).map(g => g.key);
    return filas
      .map(g => {
        const idx = orden.indexOf(g.key);
        return {
          key: g.key,
          nombre: g.servicio_nombre,
          color: idx >= 0 && idx < SERIE_COLORES.length ? SERIE_COLORES[idx] : SERIE_OTRO,
          n: g.proyectables,
          idx,
          puntos: pyEvolucion.map(e => {
            const cant = g.fechas.filter(x => x <= e.fecha).length;
            return { fecha: e.fecha, cant, pct: Math.round(cant / g.proyectables * 100) };
          }),
        };
      })
      .sort((a, b) => a.idx - b.idx);
  }, [pyPercentilPorServicio, pyEvolucion, pySrvs]);

  const pyPercentilExportar = useCallback(() => {
    if (!pyPercentilPorServicio.length) { toast.error('No hay filas para exportar'); return; }
    exportToExcel(`percentil_${pyUmbral}_jubilacion_${pyFechas?.fecha ?? pyFecha}`, pyPercentilPorServicio.map(g => ({
      Servicio:                       g.servicio_nombre,
      Dependencia:                    g.dependencia_nombre ?? '',
      [`En condiciones al ${fmtFecha(pyFechaCorte)}`]: g.al_corte,
      [`% al ${fmtFecha(pyFechaCorte)}`]: g.proyectables ? `${g.pct_corte}%` : '',
      'Plantel total':                g.total,
      'Plantel proyectable':          g.proyectables,
      'Excluidos (no computa/sin datos)': g.excluidos,
      [`Fecha en que se alcanza el ${pyUmbral}%`]: fmtFecha(g.fecha_umbral),
      'Agentes en condiciones a esa fecha': g.alcanzan,
      '% del plantel proyectable':    g.proyectables ? `${g.pct}%` : '',
    })));
  }, [pyPercentilPorServicio, pyUmbral, pyFechas, pyFecha, pyFechaCorte, toast]);

  const pyExportar = useCallback(() => {
    if (!pyFiltrada.length) { toast.error('No hay filas para exportar'); return; }
    exportToExcel(`proyeccion_jubilacion_${pyFechas?.fecha ?? pyFecha}`, pyFiltrada.map(f => ({
      DNI:              f.dni,
      Apellido:         f.apellido,
      Nombre:           f.nombre,
      Dependencia:      f.dependencia_nombre ?? '',
      Repartición:      f.reparticion_nombre ?? '',
      Servicio:         f.servicio_nombre ?? '',
      Ley:              f.ley_nombre ?? '',
      Ocupación:        f.ocupacion_nombre ?? '',
      Nacimiento:       fmtFecha(f.fecha_nacimiento),
      Ingreso:          fmtFecha(f.fecha_ingreso),
      Edad:             fmtPeriodo(f.edad),
      'Antigüedad IPS': fmtPeriodo(f.antiguedad_ips),
      'Total prorrateado': fmtPeriodo(f.total_prorateado),
      Situación:        CORTE_LABEL[corteDe(f)],
      'Cumple el':      fmtFecha(fechaDe(f)),
      Régimen:          TIPO_CORTO[tipoDe(f) ?? ''] ?? '',
      'Tiempo impago':  f.pago_posible && f.periodo_a_reconocer ? fmtPeriodo(f.periodo_a_reconocer) : '',
      Insalubre:        f.es_insalubre_ocupacion ? 'Sí (ocupación)' : 'No',
      'Cargo deudor 2%': f.cargo_deudor_2pct ? fmtPeriodo(f.cargo_deudor_periodo) : '',
      'Cumple si paga': f.pago_posible ? fmtFecha(f.fecha_cumple_con_pago) : '',
      'Falta edad':     fmtPeriodo(f.falta_edad),
      'Falta servicio': fmtPeriodo(f.falta_servicio),
      'Datos ANSES':    f.sin_datos_anses ? 'SIN CARGAR' : 'Cargados',
      Origen:           f.origen_datos === 'CALCULO' ? 'Cálculo guardado' : 'Estimado del legajo',
      'En Posibles':    f.estado_posible ?? '',
    })));
  }, [pyFiltrada, pyFechas, pyFecha, corteDe, fechaDe, tipoDe, toast]);

  const pyAgregarPosible = useCallback(async (f: FilaProyeccion) => {
    setPyAgregando(f.dni);
    try {
      const res = await apiFetch<any>('/jubilacion/posibles', {
        method: 'POST',
        body: JSON.stringify({
          dni: f.dni,
          ...(tipoDe(f) ? { tipo_jubilacion: tipoDe(f) } : {}),
        }),
      });
      if (res?.ok) {
        toast.ok(`${f.apellido}, ${f.nombre} agregado a Posibles Jubilados`);
        setPyData(prev => prev.map(r => r.dni === f.dni ? { ...r, estado_posible: 'IDENTIFICADO' } : r));
      } else {
        toast.error(res?.error ?? 'No se pudo agregar');
      }
    } catch (e: any) {
      toast.error('Error al agregar: ' + e?.message);
    } finally { setPyAgregando(null); }
  }, [tipoDe, toast]);

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
    if (tab === 'posibles') { cargarPosibles(); cargarCortes(); }
    if (tab === 'citas')    { cargarCitas();    cargarCortes(); }
    if (tab === 'proyeccion' || tab === 'percentil') {
      if (!pyEstructura) cargarEstructuraProy();
      if (!pyCorrido)    correrProyeccion();
    }
  }, [tab, ctRango]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Herramientas">
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
        {/* ─ Tab switcher ─ */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          {(['calculadora', 'proyeccion', 'percentil', 'citas', 'posibles'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 22px', fontSize: '0.9rem', fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#e2e8f0' : '#64748b',
              borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.15s',
            }}>
              {t === 'calculadora' ? '⚖️ Calculadora'
                : t === 'proyeccion' ? '📊 Proyección por servicio'
                : t === 'percentil' ? '📈 Percentil por servicio'
                : t === 'citas' ? '🗓️ Agenda de citas'
                : '📋 Posibles Jubilados'}
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
            <button type="button" className="btn" style={{ marginTop: 12, fontSize: '0.8rem' }}
              title="Abre el módulo de escaneo con este agente y tipo ANSES Jubilación ya elegidos"
              onClick={() => navigate(`/app/escaneo-agente/${String(agente.dni).replace(/\D/g, '')}?tipo=anses_jubilacion`)}>
              📷 Escanear ANSES
            </button>
          )}

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
              <button type="button" className="btn" style={{ marginTop: 12, fontSize: '0.8rem' }}
                title="Abre el módulo de escaneo con este agente y tipo ANSES Jubilación ya elegidos"
                onClick={() => navigate(`/app/escaneo-agente/${String(agente.dni).replace(/\D/g, '')}?tipo=anses_jubilacion`)}>
                📷 Escanear ANSES
              </button>
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
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{
                    ...S.btn, background: '#166534', color: '#fff', padding: '6px 14px', fontSize: '0.78rem',
                    opacity: fichaGuardando || !agente ? 0.5 : 1,
                  }}
                    disabled={fichaGuardando || !agente}
                    title="Guarda estos tramos en la ficha del agente para que los use la proyección por servicio"
                    onClick={guardarFichaAnses}>
                    {fichaGuardando ? 'Guardando…' : '💾 Guardar ficha ANSES'}
                  </button>
                  <button style={{ ...S.btn, background: '#1e40af', color: '#fff', padding: '6px 14px', fontSize: '0.78rem' }}
                    onClick={agregarAnses}>+ Agregar línea ANSES</button>
                </div>
              </div>

              {fichaAnses && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 10 }}>
                  Ficha ANSES guardada{fichaAnses.fecha_lectura ? ` el ${fmtFecha(fichaAnses.fecha_lectura)}` : ''}
                  {fichaAnses.tiene_datos === false || fichaAnses.tiene_datos === 0
                    ? ' — registrado como «sin aportes en ANSES»'
                    : ` — ${(fichaAnses.servicios ?? []).length} línea/s`}
                </div>
              )}

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

        {/* ─ Tab: Proyección por servicio ─ */}
        {tab === 'proyeccion' && (
          <>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📊 Proyección por servicio</h1>
              <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Todo el padrón activo, proyectado con el mismo motor de la calculadora: quién está en condiciones
                hoy, a 6 meses, a 12 meses o a la fecha que elijas.
              </p>
            </div>

            {/* ─ Filtros ─ */}
            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                <div>
                  <label style={S.label}>Fecha del cálculo</label>
                  <input type="date" style={S.input} value={pyFecha}
                    onChange={e => setPyFecha(e.target.value)} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {([['Hoy', 0], ['+6 meses', 6], ['+1 año', 12]] as const).map(([lbl, m]) => (
                      <button key={lbl} style={{
                        ...S.btn, padding: '3px 10px', fontSize: '0.7rem',
                        background: 'rgba(255,255,255,0.07)', color: '#cbd5e1',
                      }} onClick={() => {
                        const base = new Date();
                        setPyFecha(toISODate(new Date(base.getFullYear(), base.getMonth() + m, base.getDate())));
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={S.label}>Dependencia</label>
                  <select style={S.select} value={pyDep}
                    onChange={e => { setPyDep(e.target.value); setPyRep(''); setPySrv(''); }}>
                    <option value="">Todas</option>
                    {(pyEstructura?.dependencias ?? []).map(d => (
                      <option key={d.id} value={String(d.id)}>{d.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Repartición</label>
                  <select style={S.select} value={pyRep}
                    onChange={e => { setPyRep(e.target.value); setPySrv(''); }}>
                    <option value="">Todas</option>
                    {pyReparticiones.map(r => (
                      <option key={r.id} value={String(r.id)}>{r.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Servicio</label>
                  <select style={S.select} value={pySrv} onChange={e => setPySrv(e.target.value)}>
                    <option value="">Todos</option>
                    {pyServicios.map(s => (
                      <option key={s.id} value={String(s.id)}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Ley</label>
                  <select style={S.select} value={pyLey} onChange={e => setPyLey(e.target.value)}>
                    <option value="">Todas</option>
                    {(pyEstructura?.leyes ?? []).map(l => (
                      <option key={l.id} value={String(l.id)}>{l.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Agente</label>
                  <input style={S.input} placeholder="Apellido, nombre o DNI"
                    value={pyQ} onChange={e => setPyQ(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <button style={{ ...S.btn, background: '#7c3aed', color: '#fff', opacity: pyCargando ? 0.6 : 1 }}
                  disabled={pyCargando} onClick={correrProyeccion}>
                  {pyCargando ? 'Calculando…' : '🔄 Recalcular a esta fecha'}
                </button>
                <button style={{ ...S.btn, background: '#166534', color: '#fff' }}
                  onClick={pyExportar} disabled={!pyFiltrada.length}>
                  📊 Exportar Excel
                </button>
                {(pyDep || pyRep || pySrv || pyLey || pyQ || pyCorte !== 'TODOS') && (
                  <button style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#cbd5e1' }}
                    onClick={() => { setPyDep(''); setPyRep(''); setPySrv(''); setPyLey(''); setPyQ(''); setPyCorte('TODOS'); }}>
                    Limpiar filtros
                  </button>
                )}
                <label style={{ ...S.chkRow, marginTop: 0, fontSize: '0.78rem', color: '#d8b4fe' }}>
                  <input type="checkbox" style={S.chk} checked={pyConPago}
                    onChange={e => setPyConPago(e.target.checked)} />
                  <span title="Reconocimiento de servicios: el agente paga lo que debe — los aportes del tiempo de beca, residencia o concurrencia, y el diferencial del 2% del período anterior a Jun/2015 en las ocupaciones no insalubres">
                    Contar beca/residencia y el 2% como aportes pagados
                  </span>
                </label>
                {pyFechas && (
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Parado al {fmtFecha(pyFechas.fecha)} · 6 meses = {fmtFecha(pyFechas.fecha_6m)} ·
                    12 meses = {fmtFecha(pyFechas.fecha_12m)}
                  </span>
                )}
              </div>
              {pyFecha !== (pyFechas?.fecha ?? '') && pyCorrido && (
                <div style={{ fontSize: '0.74rem', color: '#fdba74', marginTop: 8 }}>
                  ⚠️ La fecha cambió: apretá «Recalcular» para actualizar la proyección.
                </div>
              )}
            </div>

            {/* ─ Tarjetas de corte ─ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
              {(['CUMPLE', 'HASTA_6M', 'HASTA_12M', 'MAS_ADELANTE', 'NO_COMPUTA', 'SIN_DATOS'] as CorteProy[]).map(c => {
                const activo = pyCorte === c;
                return (
                  <button key={c} onClick={() => setPyCorte(activo ? 'TODOS' : c)} style={{
                    textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '14px 16px',
                    background: activo ? CORTE_COLOR[c].bg : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${activo ? CORTE_COLOR[c].fg : 'rgba(255,255,255,0.10)'}`,
                    color: '#e2e8f0',
                  }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: CORTE_COLOR[c].fg, lineHeight: 1.1 }}>
                      {pyResumen[c]}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 2 }}>{CORTE_LABEL[c]}</div>
                  </button>
                );
              })}
            </div>

            {pyResumen.sin_anses > 0 && (
              <div style={{
                background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#fde68a',
              }}>
                ⚠️ {pyResumen.sin_anses} de {pyResumen.total} agentes no tienen servicios de ANSES cargados.
                Para ellos la proyección sale sólo del legajo IPS: los aportes de ANSES sólo suman, así que
                la fecha real puede ser <b>anterior</b> a la proyectada, nunca posterior.
              </div>
            )}

            {pyResumen.NO_COMPUTA > 0 && (
              <div style={{
                background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#d8b4fe',
              }}>
                ℹ️ {pyResumen.NO_COMPUTA} agentes están en beca, residencia o concurrencia sin aportes al IPS:
                ese tiempo no acumula servicio, así que hoy no tienen fecha de jubilación que proyectar.
                Tildá «contar beca/residencia y el 2% como aportes pagados» para ver en qué fecha
                quedarían en condiciones si reconocen esos servicios.
              </div>
            )}

            {!pyConPago && pyResumen.deudor_2pct > 0 && (
              <div style={{
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#a5b4fc',
              }}>
                📌 {pyResumen.deudor_2pct} de {pyResumen.total} agentes tienen cargo deudor del 2%: la ocupación
                no es insalubre y tienen servicio anterior a Jun/2015, así que ese tramo computa como común.
                Pagando el diferencial pasa a insalubre y entra en el prorrateo — no suma días, pero adelanta
                la fecha. Está contemplado en el escenario «con pago de aportes».
              </div>
            )}

            {pyConPago && (
              <div style={{
                background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.30)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#d8b4fe',
              }}>
                💰 Escenario «con pago de aportes»: {pyResumen.con_pago} de {pyResumen.total} agentes tienen
                algo impago — aportes de beca/residencia, el diferencial del 2%, o las dos cosas. Para ellos las
                fechas y los cortes de abajo suponen que lo pagan; el resto se muestra igual que siempre.
              </div>
            )}

            {/* ─ Vista ─ */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {(['AGENTES', 'SERVICIOS'] as const).map(v => (
                <button key={v} onClick={() => setPyVista(v)} style={{
                  ...S.btn, padding: '5px 14px', fontSize: '0.76rem',
                  background: pyVista === v ? '#7c3aed' : 'rgba(255,255,255,0.07)',
                  color: pyVista === v ? '#fff' : '#cbd5e1',
                }}>{v === 'AGENTES' ? 'Por agente' : 'Resumen por servicio'}</button>
              ))}
              {pyVista === 'AGENTES' && (
                <>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: 8 }}>Ordenar por</span>
                  <select style={{ ...S.select, width: 'auto', padding: '4px 8px', fontSize: '0.76rem' }}
                    value={pyOrden} onChange={e => setPyOrden(e.target.value as any)}>
                    <option value="FECHA">Fecha en que cumple</option>
                    <option value="APELLIDO">Apellido</option>
                    <option value="SERVICIO">Servicio</option>
                    <option value="EDAD">Edad</option>
                  </select>
                </>
              )}
              <span style={{ fontSize: '0.74rem', color: '#64748b', marginLeft: 'auto' }}>
                {pyFiltrada.length} agente/s
              </span>
            </div>

            <div style={S.card}>
              {pyCargando && (
                <p style={{ textAlign: 'center', color: '#94a3b8', padding: '30px 0', fontSize: '0.85rem' }}>
                  Proyectando el padrón… (se calcula agente por agente, puede demorar unos segundos)
                </p>
              )}

              {!pyCargando && pyVista === 'SERVICIOS' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ padding: '8px 6px' }}>Servicio</th>
                        <th style={{ padding: '8px 6px' }}>Dependencia</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Hoy</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>6 meses</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>12 meses</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Más adelante</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Plantel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pyPorServicio.map(g => (
                        <tr key={String(g.servicio_id ?? 'SIN')} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                          <td style={{ padding: '8px 6px', fontWeight: 600 }}>{g.servicio_nombre}</td>
                          <td style={{ padding: '8px 6px', color: '#94a3b8' }}>{g.dependencia_nombre ?? '—'}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: g.CUMPLE ? '#86efac' : '#475569', fontWeight: 700 }}>{g.CUMPLE}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: g.HASTA_6M ? '#fef08a' : '#475569' }}>{g.HASTA_6M}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: g.HASTA_12M ? '#93c5fd' : '#475569' }}>{g.HASTA_12M}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: '#64748b' }}>{g.MAS_ADELANTE + g.NO_COMPUTA + g.SIN_DATOS}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: '#cbd5e1' }}>{g.total}</td>
                        </tr>
                      ))}
                      {!pyPorServicio.length && (
                        <tr><td colSpan={7} style={{ padding: '24px 0', textAlign: 'center', color: '#64748b' }}>
                          Sin datos para los filtros elegidos
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {!pyCargando && pyVista === 'AGENTES' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ padding: '8px 6px' }}>Agente</th>
                        <th style={{ padding: '8px 6px' }}>Servicio</th>
                        <th style={{ padding: '8px 6px' }}>Edad</th>
                        <th style={{ padding: '8px 6px' }}>Antigüedad</th>
                        <th style={{ padding: '8px 6px' }}>Cumple</th>
                        <th style={{ padding: '8px 6px' }}>Régimen</th>
                        <th style={{ padding: '8px 6px' }}>Falta</th>
                        <th style={{ padding: '8px 6px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pyFiltrada.map(f => {
                        const corte = corteDe(f);
                        const col   = CORTE_COLOR[corte];
                        return (
                          <tr key={f.dni} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                            <td style={{ padding: '8px 6px' }}>
                              <div style={{ fontWeight: 600 }}>{f.apellido}, {f.nombre}</div>
                              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                DNI {f.dni} · {f.ley_nombre ?? 'sin ley'}
                                {f.sin_datos_anses && <span style={{ color: '#fbbf24' }}> · sin ANSES</span>}
                                {f.origen_datos === 'CALCULO' && <span style={{ color: '#a78bfa' }}> · con cálculo</span>}
                                {f.estado_posible && <span style={{ color: '#86efac' }}> · en Posibles</span>}
                              </div>
                            </td>
                            <td style={{ padding: '8px 6px', color: '#cbd5e1' }}>
                              <div>{f.servicio_nombre ?? '—'}</div>
                              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{f.dependencia_nombre ?? ''}</div>
                            </td>
                            <td style={{ padding: '8px 6px', color: f.cumple_edad ? '#86efac' : '#cbd5e1' }}>
                              {f.edad ? `${f.edad.anios} a` : '—'}
                            </td>
                            <td style={{ padding: '8px 6px', color: f.cumple_servicio ? '#86efac' : '#cbd5e1' }}>
                              {fmtPeriodo(f.total_prorateado)}
                            </td>
                            <td style={{ padding: '8px 6px' }}>
                              <span style={{
                                background: col.bg, color: col.fg, borderRadius: 6,
                                padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
                              }}>
                                {corte === 'CUMPLE' ? 'Ya cumple'
                                  : corte === 'NO_COMPUTA' ? 'Sin aportes'
                                  : corte === 'SIN_DATOS' ? 'Sin datos'
                                  : fechaDe(f) ? fmtFecha(fechaDe(f)) : '+40 años'}
                              </span>
                              {/* Qué pasaría si paga, cuando se está mirando el escenario sin pago */}
                              {!pyConPago && f.pago_posible && (
                                <div style={{ fontSize: '0.68rem', color: '#d8b4fe', marginTop: 3 }}
                                  title="Lo que hoy no computa como debería: aportes de beca / residencia / concurrencia y/o el diferencial del 2% anterior a Jun/2015">
                                  si paga {descPago(f)}:{' '}
                                  {f.fecha_cumple_con_pago ? fmtFecha(f.fecha_cumple_con_pago) : '+40 años'}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '8px 6px', color: '#94a3b8' }}>
                              {TIPO_CORTO[tipoDe(f) ?? ''] ?? '—'}
                            </td>
                            <td style={{ padding: '8px 6px', fontSize: '0.72rem', color: '#64748b' }}>
                              {corte === 'CUMPLE' ? '—'
                               : corte === 'NO_COMPUTA' ? 'No acumula servicio'
                               : (pyConPago && f.pago_posible) ? (
                                 <span title="Lo que falta está calculado sobre la situación actual; en este escenario lo impago ya se cuenta como pagado">
                                   con {descPago(f)} pagados
                                 </span>
                               ) : (
                                <>
                                  {!f.cumple_edad && <div>Edad: {fmtPeriodo(f.falta_edad)}</div>}
                                  {!f.cumple_servicio && <div>Servicio: {fmtPeriodo(f.falta_servicio)}</div>}
                                </>
                              )}
                            </td>
                            <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                              <button style={{
                                ...S.btn, padding: '4px 10px', fontSize: '0.72rem',
                                background: 'rgba(124,58,237,0.25)', color: '#d8b4fe',
                              }} title="Abrir este agente en la calculadora"
                                onClick={() => { setTab('calculadora'); seleccionarAgente(f); }}>
                                ⚖️
                              </button>
                              {!f.estado_posible && (
                                <button style={{
                                  ...S.btn, padding: '4px 10px', fontSize: '0.72rem', marginLeft: 6,
                                  background: 'rgba(22,101,52,0.35)', color: '#86efac',
                                  opacity: pyAgregando === f.dni ? 0.5 : 1,
                                }} disabled={pyAgregando === f.dni}
                                  title="Agregar al registro de Posibles Jubilados"
                                  onClick={() => pyAgregarPosible(f)}>
                                  ➕
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!pyFiltrada.length && (
                        <tr><td colSpan={8} style={{ padding: '24px 0', textAlign: 'center', color: '#64748b' }}>
                          {pyCorrido ? 'Sin agentes para los filtros elegidos' : 'Apretá «Recalcular» para proyectar el padrón'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ─ Tab: Percentil por servicio ─ */}
        {tab === 'percentil' && (
          <>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>📈 Percentil por servicio</h1>
              <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Para cada servicio (y el total), la fecha en la que el {pyUmbral}% del plantel proyectable
                queda en condiciones de jubilarse. Usa el mismo padrón y el mismo motor que «Proyección por
                servicio» — quedan excluidos del cálculo los agentes que no computan aportes o no tienen
                datos para proyectar.
              </p>
            </div>

            {/* ─ Filtros (comparten datos con "Proyección por servicio") ─ */}
            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                <div>
                  <label style={S.label}>Fecha del cálculo</label>
                  <input type="date" style={S.input} value={pyFecha}
                    onChange={e => setPyFecha(e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>Dependencia</label>
                  <select style={S.select} value={pyDep}
                    onChange={e => { setPyDep(e.target.value); setPyRep(''); setPySrv(''); }}>
                    <option value="">Todas</option>
                    {(pyEstructura?.dependencias ?? []).map(d => (
                      <option key={d.id} value={String(d.id)}>{d.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Repartición</label>
                  <select style={S.select} value={pyRep}
                    onChange={e => { setPyRep(e.target.value); setPySrv(''); }}>
                    <option value="">Todas</option>
                    {pyReparticiones.map(r => (
                      <option key={r.id} value={String(r.id)}>{r.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Servicios</label>
                  <select style={S.select} value=""
                    onChange={e => {
                      const v = e.target.value;
                      // Entra con la ley elegida en el filtro de al lado; después se cambia en la etiqueta.
                      if (v) setPySrvs(prev => prev.some(s => s.srv === v && s.ley === pyLey) ? prev : [...prev, { srv: v, ley: pyLey }]);
                    }}>
                    <option value="">{pySrvs.length ? '+ Agregar otro servicio…' : 'Todos (agregar servicio…)'}</option>
                    {pyServicios.map(s => (
                      <option key={s.id} value={String(s.id)}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>{pySrvs.length ? 'Ley del próximo servicio' : 'Ley'}</label>
                  <select style={S.select} value={pyLey} onChange={e => setPyLey(e.target.value)}>
                    <option value="">Todas</option>
                    {(pyEstructura?.leyes ?? []).map(l => (
                      <option key={l.id} value={String(l.id)}>{l.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Umbral</label>
                  <select style={S.select} value={pyUmbral} onChange={e => setPyUmbral(Number(e.target.value))}>
                    {[25, 50, 75, 90, 95].map(p => (
                      <option key={p} value={p}>{p}% del plantel</option>
                    ))}
                  </select>
                </div>
              </div>

              {pySrvs.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                  {pySrvs.map((sel, i) => {
                    const nombre = pyEstructura?.servicios.find(s => String(s.id) === sel.srv)?.nombre ?? `Servicio ${sel.srv}`;
                    return (
                      <span key={`${sel.srv}|${sel.ley}|${i}`} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(167,139,250,0.4)',
                        color: '#ddd6fe', borderRadius: 999, padding: '3px 6px 3px 12px', fontSize: '0.76rem',
                      }}>
                        {nombre}
                        <select value={sel.ley} title="Ley de este servicio"
                          onChange={e => {
                            const ley = e.target.value;
                            setPySrvs(prev => prev.map((x, j) => j === i ? { ...x, ley } : x));
                          }}
                          style={{
                            background: 'rgba(0,0,0,0.35)', color: '#ddd6fe', border: '1px solid rgba(167,139,250,0.35)',
                            borderRadius: 999, padding: '1px 6px', fontSize: '0.72rem', cursor: 'pointer',
                          }}>
                          <option value="">Todas las leyes</option>
                          {(pyEstructura?.leyes ?? []).map(l => (
                            <option key={l.id} value={String(l.id)}>{l.nombre.replace(/^LEY\s*/i, '')}</option>
                          ))}
                        </select>
                        <button title="Quitar" onClick={() => setPySrvs(prev => prev.filter((_, j) => j !== i))} style={{
                          background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ddd6fe',
                          borderRadius: 999, width: 18, height: 18, cursor: 'pointer', lineHeight: '16px', padding: 0,
                        }}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <button style={{ ...S.btn, background: '#7c3aed', color: '#fff', opacity: pyCargando ? 0.6 : 1 }}
                  disabled={pyCargando} onClick={correrProyeccion}>
                  {pyCargando ? 'Calculando…' : '🔄 Recalcular a esta fecha'}
                </button>
                <button style={{ ...S.btn, background: '#166534', color: '#fff' }}
                  onClick={pyPercentilExportar} disabled={!pyPercentilPorServicio.length}>
                  📊 Exportar Excel
                </button>
                {(pyDep || pyRep || pySrvs.length > 0 || pyLey) && (
                  <button style={{ ...S.btn, background: 'rgba(255,255,255,0.07)', color: '#cbd5e1' }}
                    onClick={() => { setPyDep(''); setPyRep(''); setPySrvs([]); setPyLey(''); }}>
                    Limpiar filtros
                  </button>
                )}
                <label style={{ ...S.chkRow, marginTop: 0, fontSize: '0.78rem', color: '#d8b4fe' }}>
                  <input type="checkbox" style={S.chk} checked={pyConPago}
                    onChange={e => setPyConPago(e.target.checked)} />
                  <span>Contar beca/residencia y el 2% como aportes pagados</span>
                </label>
                {pyFechas && (
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Parado al {fmtFecha(pyFechas.fecha)}
                  </span>
                )}
              </div>
              {pyFecha !== (pyFechas?.fecha ?? '') && pyCorrido && (
                <div style={{ fontSize: '0.74rem', color: '#fdba74', marginTop: 8 }}>
                  ⚠️ La fecha cambió: apretá «Recalcular» para actualizar la proyección.
                </div>
              )}
            </div>

            <div style={{
              background: pyConPago ? 'rgba(168,85,247,0.10)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${pyConPago ? 'rgba(168,85,247,0.30)' : 'rgba(255,255,255,0.10)'}`,
              borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem',
              color: pyConPago ? '#d8b4fe' : '#cbd5e1', lineHeight: 1.5,
            }}>
              {pyConPago
                ? <>💰 <b>Escenario con pago:</b> se supone que cada agente paga la beca/residencia (el tiempo entre ingreso y nombramiento computa) y el 2% (lo anterior a Jun/2015 pasa a insalubre).</>
                : <>📋 <b>Escenario sin pago:</b> la beca/residencia (ingreso → nombramiento) <b>no computa</b> salvo que un cálculo guardado la marque como pagada, y lo anterior a Jun/2015 es común salvo que la ocupación sea insalubre. Desde Jun/2015 todo computa insalubre.</>}
              {' '}Hacé click en un servicio para ver agente por agente cómo se calculó.
            </div>

            {/* ─ Total ─ */}
            <div style={{
              ...S.card, marginBottom: 16, display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
            }}>
              <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    TOTAL · en condiciones al {fmtFecha(pyFechaCorte)}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#86efac' }}>
                    {pyPercentilTotal.proyectables ? `${pyPercentilTotal.pct_corte}%` : '—'}
                  </div>
                  {pyPercentilTotal.proyectables > 0 && (
                    <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: 2 }}>
                      {pyPercentilTotal.al_corte} de {pyPercentilTotal.proyectables} agentes del plantel filtrado
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    Fecha en que se llega al {pyUmbral}%
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#93c5fd' }}>
                    {fmtFecha(pyPercentilTotal.fecha_umbral)}
                  </div>
                  {pyPercentilTotal.proyectables > 0 && (
                    <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: 2 }}>
                      {pyPercentilTotal.pct}% · {pyPercentilTotal.alcanzan} de {pyPercentilTotal.proyectables} agentes
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '0.76rem', color: '#64748b', textAlign: 'right' }}>
                {pyPercentilTotal.proyectables} de {pyPercentilTotal.total} agentes proyectables
                {pyPercentilTotal.excluidos > 0 && <> · {pyPercentilTotal.excluidos} excluidos (no computa/sin datos)</>}
              </div>
            </div>

            {/* ─ Evolución por servicio ─ */}
            {pyEvolucion.length > 0 && pyPercentilPorServicio.length > 0 && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: 10 }}>
                  EVOLUCIÓN POR SERVICIO · % de cada plantel en condiciones, año a año
                </div>
                {pyEvolSeries.length > 0 && pyEvolSeries.length <= SERIE_COLORES.length && (
                  <div style={{ marginBottom: 16 }}>
                    <GraficoEvolucion series={pyEvolSeries} umbral={pyUmbral} />
                  </div>
                )}
                {pyEvolSeries.length > SERIE_COLORES.length && (
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 12 }}>
                    El gráfico compara hasta {SERIE_COLORES.length} servicios: elegí los que quieras en «Servicios».
                  </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: '100%' }}>
                    <thead>
                      <tr style={{ color: '#94a3b8' }}>
                        <th style={{
                          padding: '6px 8px', textAlign: 'left', position: 'sticky', left: 0,
                          background: '#111827', minWidth: 200,
                        }}>Servicio</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Proy.</th>
                        {pyEvolucion.map(e => (
                          <th key={e.fecha} style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {e.fecha.slice(0, 4)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pyPercentilPorServicio.map(g => (
                        <tr key={g.key} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                          <td style={{
                            padding: '6px 8px', fontWeight: 600, position: 'sticky', left: 0, background: '#111827',
                          }}>
                            {g.servicio_nombre}
                            <BadgeControlado control={pyControlPorSrv.get(String(g.servicio_id ?? ''))}
                              ultimoCambio={pyUltimoCambioPorSrv.get(String(g.servicio_id ?? ''))} />
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: '#94a3b8' }}>{g.proyectables}</td>
                          {pyEvolucion.map(e => {
                            if (!g.proyectables) {
                              return <td key={e.fecha} style={{ padding: '6px 8px', textAlign: 'right', color: '#475569' }}>—</td>;
                            }
                            const cant = g.fechas.filter(x => x <= e.fecha).length;
                            const pct  = Math.round(cant / g.proyectables * 100);
                            return (
                              <td key={e.fecha} title={`${cant} de ${g.proyectables} al ${fmtFecha(e.fecha)}`} style={{
                                padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap',
                                color: pct >= pyUmbral ? '#86efac' : pct > 0 ? '#e2e8f0' : '#475569',
                                fontWeight: pct >= pyUmbral ? 700 : 400,
                              }}>
                                {pct}%
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 8 }}>
                  Cada columna es al {fmtFecha(pyFechaCorte).split('/').slice(0, 2).join('/')} de ese año.
                  En verde, los que ya pasaron el {pyUmbral}%. Pasá el mouse para ver la cantidad.
                </div>
              </div>
            )}

            {/* ─ Evolución año a año ─ */}
            {pyEvolucion.length > 0 && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginBottom: 10 }}>
                  EVOLUCIÓN · % del plantel filtrado en condiciones, año a año
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8 }}>
                  {pyEvolucion.map((e, i) => {
                    const sube = i > 0 && e.cantidad > pyEvolucion[i - 1].cantidad;
                    return (
                      <div key={e.fecha} style={{
                        borderRadius: 10, padding: '8px 10px',
                        background: e.pct >= pyUmbral ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${e.pct >= pyUmbral ? 'rgba(134,239,172,0.35)' : 'rgba(255,255,255,0.08)'}`,
                      }}>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>al {fmtFecha(e.fecha)}</div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: sube || i === 0 ? '#86efac' : '#64748b' }}>
                          {e.pct}%
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {e.cantidad} de {pyPercentilTotal.proyectables}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={S.card}>
              {pyCargando && (
                <p style={{ textAlign: 'center', color: '#94a3b8', padding: '30px 0', fontSize: '0.85rem' }}>
                  Proyectando el padrón… (se calcula agente por agente, puede demorar unos segundos)
                </p>
              )}
              {!pyCargando && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ padding: '8px 6px' }}>Servicio</th>
                        <th style={{ padding: '8px 6px' }}>Dependencia</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Plantel</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Proyectable</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Excluidos</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Al {fmtFecha(pyFechaCorte)}</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>Llega al {pyUmbral}%</th>
                        <th style={{ padding: '8px 6px', textAlign: 'right' }}>En condiciones a esa fecha</th>
                        {esAdmin && <th style={{ padding: '8px 6px', textAlign: 'right' }}>Control</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pyPercentilPorServicio.map(g => {
                        const key = g.key;
                        const abierto = pySrvAbierto === key;
                        return (
                        <Fragment key={key}>
                        <tr onClick={() => setPySrvAbierto(abierto ? null : key)} style={{
                          borderTop: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer',
                          background: abierto ? 'rgba(124,58,237,0.12)' : undefined,
                        }}>
                          <td style={{ padding: '8px 6px', fontWeight: 600 }}>
                            <span style={{ color: '#a78bfa', marginRight: 6 }}>{abierto ? '▾' : '▸'}</span>
                            {g.servicio_nombre}
                            <BadgeControlado control={pyControlPorSrv.get(String(g.servicio_id ?? ''))}
                              ultimoCambio={pyUltimoCambioPorSrv.get(String(g.servicio_id ?? ''))} />
                          </td>
                          <td style={{ padding: '8px 6px', color: '#94a3b8' }}>{g.dependencia_nombre ?? '—'}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>{g.total}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: '#94a3b8' }}>{g.proyectables}</td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', color: g.excluidos ? '#d8b4fe' : '#475569' }}>
                            {g.excluidos}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            {g.proyectables ? (
                              <>
                                <b style={{ color: '#86efac' }}>{g.pct_corte}%</b>
                                <span style={{ color: '#94a3b8' }}> · {g.al_corte} de {g.proyectables}</span>
                              </>
                            ) : '—'}
                          </td>
                          <td style={{
                            padding: '8px 6px', textAlign: 'right', fontWeight: 700,
                            color: g.fecha_umbral ? '#93c5fd' : '#64748b',
                          }}>
                            {fmtFecha(g.fecha_umbral)}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                            {g.proyectables ? (
                              <>
                                <b style={{ color: '#86efac' }}>{g.pct}%</b>
                                <span style={{ color: '#94a3b8' }}> · {g.alcanzan} de {g.proyectables}</span>
                              </>
                            ) : '—'}
                          </td>
                          {esAdmin && (
                            <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}
                              onClick={e => e.stopPropagation()}>
                              {g.servicio_id == null ? null : pyControlPorSrv.has(String(g.servicio_id)) ? (
                                <button style={{ ...S.btn, padding: '4px 10px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.07)', color: '#cbd5e1' }}
                                  onClick={() => desmarcarControlado(g.servicio_id!, g.servicio_nombre)}>
                                  Quitar ✔
                                </button>
                              ) : (
                                <button style={{ ...S.btn, padding: '4px 10px', fontSize: '0.72rem', background: '#14532d', color: '#86efac' }}
                                  onClick={() => marcarControlado(g.servicio_id!, g.servicio_nombre)}>
                                  ✔ Marcar controlado
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                        {abierto && (
                          <tr>
                            <td colSpan={esAdmin ? 9 : 8} style={{ padding: '4px 0 14px', background: 'rgba(0,0,0,0.18)' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                                <thead>
                                  <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                                    <th style={{ padding: '6px' }}>Agente</th>
                                    <th style={{ padding: '6px' }}>Ocupación / régimen</th>
                                    <th style={{ padding: '6px' }}>Nacimiento</th>
                                    <th style={{ padding: '6px' }}>Ingreso</th>
                                    <th style={{ padding: '6px' }}>Nombramiento</th>
                                    <th style={{ padding: '6px' }}>Beca</th>
                                    <th style={{ padding: '6px' }}>Servicio computado</th>
                                    <th style={{ padding: '6px' }}>Falta</th>
                                    <th style={{ padding: '6px' }}>Cumple el</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(pyAgentesPorServicio.get(key) ?? []).map(f => {
                                    const corte = corteDe(f);
                                    const fecha = fechaDe(f);
                                    const excluido = corte === 'NO_COMPUTA' || corte === 'SIN_DATOS' || !fecha;
                                    const cuenta = !excluido && !!g.fecha_umbral && fecha! <= g.fecha_umbral;
                                    const beca = f.tiene_beca === undefined ? '—'
                                      : !f.tiene_beca ? 'No tiene'
                                      : f.beca_aporto ? 'Pagada · computa'
                                      : pyConPago ? 'Impaga · se supone pagada'
                                      : 'Impaga · NO computa';
                                    return (
                                      <tr key={f.dni} style={{
                                        borderTop: '1px solid rgba(255,255,255,0.05)',
                                        opacity: excluido ? 0.55 : 1,
                                      }}>
                                        <td style={{ padding: '6px' }}>
                                          <div style={{ fontWeight: 600 }}>
                                            {f.apellido}, {f.nombre}
                                            {f.es_jefe && (
                                              <span style={{
                                                marginLeft: 6, fontSize: '0.66rem', padding: '1px 6px', borderRadius: 6,
                                                background: 'rgba(250,204,21,0.15)', color: '#fde68a', fontWeight: 700,
                                              }}>Jefe/a</span>
                                            )}
                                          </div>
                                          <div style={{ color: '#64748b' }}>DNI {f.dni}{f.origen_datos === 'CALCULO' ? ' · cálculo guardado' : ''}</div>
                                        </td>
                                        <td style={{ padding: '6px' }}>
                                          <div>{f.ocupacion_nombre ?? '—'}</div>
                                          <div style={{ color: f.es_insalubre_ocupacion ? '#86efac' : '#fdba74' }}>
                                            {f.es_insalubre_efectivo
                                              ? (f.es_insalubre_ocupacion ? 'Insalubre (ocupación)' : 'Insalubre (cálculo guardado)')
                                              : 'Común hasta 5/2015 · insalubre desde 6/2015'}
                                          </div>
                                          {f.cargo_deudor_2pct && (
                                            <div style={{ color: '#a5b4fc' }}>
                                              2% {pyConPago ? 'se supone pagado' : 'impago'} ({fmtPeriodo(f.cargo_deudor_periodo)})
                                            </div>
                                          )}
                                        </td>
                                        <td style={{ padding: '6px' }}>
                                          {fmtFecha(f.fecha_nacimiento)}
                                          <div style={{ color: '#64748b' }}>{fmtPeriodo(f.edad)}</div>
                                        </td>
                                        <td style={{ padding: '6px' }}>
                                          {fmtFecha(f.fecha_ingreso)}
                                          {(f.tramos_anteriores ?? []).map((t, i) => (
                                            <div key={i} style={{ color: '#93c5fd', fontSize: '0.68rem' }}>
                                              + {fmtFecha(t.desde)}–{fmtFecha(t.hasta)}{t.ley ? ` (${t.ley.replace(/^LEY\s*/i, '')})` : ''}
                                            </div>
                                          ))}
                                        </td>
                                        <td style={{ padding: '6px' }}>{fmtFecha(f.fecha_nombramiento)}</td>
                                        <td style={{ padding: '6px', color: beca.startsWith('Impaga · NO') ? '#fca5a5' : '#cbd5e1' }}>
                                          {beca}
                                          {f.tiene_beca && f.periodo_a_reconocer && (
                                            <div style={{ color: '#64748b' }}>{fmtPeriodo(f.periodo_a_reconocer)}</div>
                                          )}
                                        </td>
                                        <td style={{ padding: '6px' }}>
                                          <div>Común {fmtPeriodo(f.total_comun)}</div>
                                          <div>Insalubre {fmtPeriodo(f.total_insalubre)}</div>
                                          <div style={{ color: '#94a3b8' }}>Prorrateado {fmtPeriodo(f.total_prorateado)}</div>
                                        </td>
                                        <td style={{ padding: '6px' }}>
                                          <div>Edad {f.cumple_edad ? '✓' : fmtPeriodo(f.falta_edad)}</div>
                                          <div>Servicio {f.cumple_servicio ? '✓' : fmtPeriodo(f.falta_servicio)}</div>
                                        </td>
                                        <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                                          {excluido ? (
                                            <span style={{ color: CORTE_COLOR[corte].fg }}>
                                              {corte === 'NO_COMPUTA' || corte === 'SIN_DATOS' ? CORTE_LABEL[corte] : 'Sin fecha'} · excluido
                                            </span>
                                          ) : (
                                            <>
                                              <b style={{ color: cuenta ? '#86efac' : '#e2e8f0' }}>{fmtFecha(fecha)}</b>
                                              <div style={{ color: '#64748b' }}>
                                                {TIPO_CORTO[tipoDe(f) ?? ''] ?? ''}{cuenta ? ` · entra en el ${pyUmbral}%` : ''}
                                              </div>
                                            </>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                      {!pyPercentilPorServicio.length && (
                        <tr><td colSpan={8} style={{ padding: '24px 0', textAlign: 'center', color: '#64748b' }}>
                          {pyCorrido ? 'Sin agentes para los filtros elegidos' : 'Apretá «Recalcular» para proyectar el padrón'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

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
                                  <div style={{ width: 240 }}>
                                    <SelectorCorte opciones={pjCortes} value={ctPromMesCorte} onChange={setCtPromMesCorte} />
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
                  <div style={{ width: 230 }}>
                    <SelectorCorte opciones={pjCortes} value={pjMesCorte} onChange={setPjMesCorte} label="Fecha (mes de corte)" />
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
                            <SelectorCorte opciones={pjCortes} value={pjEditMesCorte} onChange={cambiarCorteEdit} label="Fecha (mes de corte)" />
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
                            <div>
                              <label style={S.label}>Expediente IPS</label>
                              <input type="text" style={S.input} value={pjEditExpteIps} maxLength={60}
                                onChange={e => setPjEditExpteIps(e.target.value)}
                                placeholder="Nº de expediente..." />
                            </div>
                            <div>
                              <label style={S.label}>Expediente GDEBA</label>
                              <input type="text" style={S.input} value={pjEditExpteGdeba} maxLength={60}
                                onChange={e => setPjEditExpteGdeba(e.target.value)}
                                placeholder="EX-23756257-GDEBA-2026" />
                            </div>
                            <div>
                              <label style={S.label}>Informe gráfico 1</label>
                              <input type="text" style={S.input} value={pjEditIfgra1} maxLength={60}
                                onChange={e => setPjEditIfgra1(e.target.value)}
                                placeholder="IF-2026-..." />
                            </div>
                            <div>
                              <label style={S.label}>Informe gráfico 2</label>
                              <input type="text" style={S.input} value={pjEditIfgra2} maxLength={60}
                                onChange={e => setPjEditIfgra2(e.target.value)}
                                placeholder="IF-2026-..." />
                            </div>
                          </div>
                          <div style={{ marginBottom: 10 }}>
                            <span style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.35 }}>
                              Las dos fechas salen del cronograma al elegir el corte. Cada una avisa en el legajo del agente y el aviso queda hasta que la fecha pase.
                            </span>
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
                            {(pj.ifgra_1 || pj.ifgra_2) && (
                              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.74rem', color: '#a5b4fc', marginBottom: 3 }}>
                                {pj.ifgra_1 && <span>📊 Informe gráfico 1: <strong>{pj.ifgra_1}</strong></span>}
                                {pj.ifgra_2 && <span>📊 Informe gráfico 2: <strong>{pj.ifgra_2}</strong></span>}
                              </div>
                            )}
                            {(pj.expediente_gdeba || pj.expediente_ips) && (
                              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.74rem', color: '#7dd3fc', marginBottom: 3 }}>
                                {pj.expediente_gdeba && <span>📁 Expediente GDEBA: <strong>{pj.expediente_gdeba}</strong></span>}
                                {pj.expediente_ips   && <span>📁 Expediente IPS: <strong>{pj.expediente_ips}</strong></span>}
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
                      <ChecklistTramite pj={pj} guardando={pjChkGuardando} onToggle={pjToggleChecklist} />
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
