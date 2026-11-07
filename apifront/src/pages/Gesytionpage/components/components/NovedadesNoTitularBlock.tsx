import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../../api/http';

// Bloque de la pestaña Info para becarios / transitorios: lo que cargó Salud Laboral
// (reconocimientos, examen anual, tareas livianas) y lo que cargó el jefe en su portal,
// del último año. Backend: GET /personal/:dni/novedades-no-titular.

interface Item {
  id: number; origen: string; etiqueta: string;
  desde?: string | null; hasta?: string | null; dias?: number | null;
  tipo?: string | null; resultado?: string | null; motivo?: string | null; estado?: string | null;
  observaciones?: string | null; jefe_nombre?: string | null;
  hora_desde?: string | null; hora_hasta?: string | null; fecha_trabajo?: string | null;
  expediente?: string | null; anio?: number | null; activo?: number | null;
  carga_siape?: string | null; carga_ministerio?: string | null;
}
interface Resp { aplica: boolean; tipo: 'BECARIO' | 'TRANSITORIO' | null; salud_laboral: Item[]; jefe: Item[]; }

const GRIS = '#64748b';
const COLOR_ORIGEN: Record<string, string> = {
  reconocimientos_medicos: '#f472b6', examen_anual: '#38bdf8', tareas_livianas: '#fbbf24',
  articulo_26: '#60a5fa', practicas_profesionales: '#a78bfa', papcolpo: '#f472b6',
  examen: '#22d3ee', prexamen: '#2dd4bf', permiso_salida: '#fb923c',
  novedad_jefe: '#facc15', francos_compensatorios: '#4ade80',
};
const COLOR_CARGA: Record<string, string> = {
  OK: '#4ade80', YA_EXISTIA: '#4ade80', PENDIENTE: '#fbbf24', ERROR: '#f87171',
  PERIODO_CERRADO: '#fb923c', BORRADO: GRIS, NO_TRABAJA_DIA: GRIS,
};

function fmt(v?: string | null) {
  if (!v) return '';
  const s = String(v);
  // la API devuelve 'YYYY-MM-DD' (sin hora): se formatea como texto, sin pasar por Date (evita correr un día)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
const hhmm = (h?: string | null) => (h ? String(h).slice(0, 5) : '');

function rango(it: Item) {
  const d = fmt(it.desde), h = fmt(it.hasta);
  if (h && h !== d) return `${d} → ${h}`;
  return d;
}

function detalle(it: Item): string {
  const p: string[] = [];
  switch (it.origen) {
    case 'reconocimientos_medicos':
      if (it.tipo) p.push(it.tipo);
      if (it.resultado) p.push(it.resultado);
      break;
    case 'examen_anual':
      if (it.anio) p.push(`Año ${it.anio}`);
      if (it.resultado) p.push(it.resultado);
      break;
    case 'tareas_livianas':
      if (it.expediente) p.push(it.expediente);
      if (it.activo === 0) p.push('inactiva');
      break;
    case 'permiso_salida':
      if (it.hora_desde || it.hora_hasta) p.push(`${hhmm(it.hora_desde)}–${hhmm(it.hora_hasta)}`);
      if (it.motivo) p.push(it.motivo);
      break;
    case 'francos_compensatorios':
      if (it.fecha_trabajo) p.push(`trabajó ${fmt(it.fecha_trabajo)}`);
      if (it.estado) p.push(it.estado);
      break;
    default:
      if (it.tipo) p.push(it.tipo);
      if (it.motivo) p.push(it.motivo);
      if (it.resultado && it.resultado !== it.tipo) p.push(it.resultado);
      if (it.estado) p.push(it.estado);
  }
  return p.join(' · ');
}

function Chip({ label, valor }: { label: string; valor: string }) {
  const c = COLOR_CARGA[valor] ?? '#fbbf24';
  return (
    <span style={{ fontSize: '0.62rem', padding: '1px 6px', borderRadius: 999, border: `1px solid ${c}55`, color: c, whiteSpace: 'nowrap' }}>
      {label}: {valor.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

/** Fila compacta (Salud Laboral). */
function FilaSL({ it }: { it: Item }) {
  const color = COLOR_ORIGEN[it.origen] ?? GRIS;
  const dias = it.dias ? `${it.dias} d` : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.76rem' }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ color, fontWeight: 600 }}>{it.etiqueta}</span>
        {detalle(it) && <span style={{ color: '#cbd5e1' }}> · {detalle(it)}</span>}
        {it.observaciones && <div style={{ color: GRIS, fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.observaciones}>{it.observaciones}</div>}
      </div>
      <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.72rem', color: '#e2e8f0', whiteSpace: 'nowrap' }}>
        {rango(it)}{dias && <div style={{ color: GRIS }}>{dias}</div>}
      </div>
    </div>
  );
}

/** Card chica por novedad (jefe). */
function CardJefe({ it }: { it: Item }) {
  const color = COLOR_ORIGEN[it.origen] ?? GRIS;
  const det = detalle(it);
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '6px 9px', background: 'rgba(15,23,42,0.45)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.76rem' }}>
        <span style={{ color, fontWeight: 600 }}>{it.etiqueta}</span>
        <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#e2e8f0', whiteSpace: 'nowrap' }}>
          {rango(it)}{it.dias && it.dias > 1 ? ` · ${it.dias} d` : ''}
        </span>
      </div>
      {det && <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: 2 }}>{det}</div>}
      {(it.jefe_nombre || it.carga_siape || it.carga_ministerio) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginTop: 4 }}>
          {it.jefe_nombre && <span style={{ fontSize: '0.64rem', color: GRIS }}>por {it.jefe_nombre}</span>}
          {it.carga_siape && <Chip label="SIAPE" valor={it.carga_siape} />}
          {it.carga_ministerio && <Chip label="Ministerio" valor={it.carga_ministerio} />}
        </div>
      )}
    </div>
  );
}

function BotonVer({ abierto, total, visibles, onClick }: { abierto: boolean; total: number; visibles: number; onClick: () => void }) {
  if (total <= visibles) return null;
  return (
    <button type="button" onClick={onClick} style={{
      marginTop: 6, background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
      color: '#94a3b8', fontSize: '0.7rem', padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit',
    }}>
      {abierto ? '▲ Ver menos' : `▼ Ver todos (${total})`}
    </button>
  );
}

const MAX_SL = 3;
const MAX_JEFE = 5;

export function NovedadesNoTitularBlock({ dni }: { dni: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verSL, setVerSL] = useState(false);
  const [verJefe, setVerJefe] = useState(false);

  useEffect(() => {
    if (!dni) return;
    let vivo = true;
    setLoading(true); setError(null); setData(null); setVerSL(false); setVerJefe(false);
    apiFetch<any>(`/personal/${dni}/novedades-no-titular`)
      .then(r => { if (vivo) setData(r?.data ?? null); })
      .catch(e => { if (vivo) setError(e?.message || 'Error'); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [dni]);

  if (loading) return <div style={{ fontSize: '0.78rem', color: GRIS, marginTop: 12 }}>⏳ Cargando novedades…</div>;
  if (error) return <div style={{ fontSize: '0.78rem', color: '#f87171', marginTop: 12 }}>{error}</div>;
  if (!data?.aplica) return null;

  const sl = verSL ? data.salud_laboral : data.salud_laboral.slice(0, MAX_SL);
  const jf = verJefe ? data.jefe : data.jefe.slice(0, MAX_JEFE);
  const tag = data.tipo === 'BECARIO' ? 'becario' : 'transitorio';

  return (
    <>
      <div className="agente-servicio-block">
        <span className="agente-servicio-title">🩺 Salud Laboral · último año <span style={{ color: GRIS, fontWeight: 400, textTransform: 'none' }}>({tag})</span></span>
        {data.salud_laboral.length === 0
          ? <div style={{ fontSize: '0.76rem', color: GRIS }}>Sin cargas de Salud Laboral en el último año</div>
          : <div>{sl.map(it => <FilaSL key={`${it.origen}-${it.id}`} it={it} />)}</div>}
        <BotonVer abierto={verSL} total={data.salud_laboral.length} visibles={MAX_SL} onClick={() => setVerSL(v => !v)} />
      </div>

      <div className="agente-servicio-block">
        <span className="agente-servicio-title">🧑‍⚕️ Cargado por el jefe · último año</span>
        {data.jefe.length === 0
          ? <div style={{ fontSize: '0.76rem', color: GRIS }}>El jefe no cargó novedades en el último año</div>
          : (
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
              {jf.map(it => <CardJefe key={`${it.origen}-${it.id}`} it={it} />)}
            </div>
          )}
        <BotonVer abierto={verJefe} total={data.jefe.length} visibles={MAX_JEFE} onClick={() => setVerJefe(v => !v)} />
      </div>
    </>
  );
}
