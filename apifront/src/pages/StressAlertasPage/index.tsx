// src/pages/StressAlertasPage/index.tsx
// Alertas de stress post-vacacional
// Muestra agentes que completaron su licencia anual (Cant. Días = 0),
// no tienen ANUAL COMPLEMENTARIA cargada y llevan >= 40 días sin ella.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout }        from '../../components/Layout';
import { apiFetch }      from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast }      from '../../ui/toast';
import { LicenciasPendientesContent } from '../LicenciasPendientesPage';

// ── Tipos ─────────────────────────────────────────────────────────────────────
type EstadoCola = 'pendiente' | 'cargado' | 'omitido' | 'error' | string;

interface StressAlerta {
  dni:                number;
  nombre:             string;
  dias_transcurridos: number | null;
  ley:                string;
  servicio:           string;
  dias_stress:        number | null;
  licencia:           string | null;
  estado:             EstadoCola;
  motivo:             string | null;
  actualizado_at:     string | null;
}

interface CargaEstado {
  ok:      boolean;
  anio:    number;
  total:   number;
  ultima:  string | null;
  conteo:  { cargado: number; error: number; omitido: number; pendiente: number };
  pendientes: { dni: number; apellido: string; dias: number; licencia: string }[];
  errores:    { dni: number; apellido: string; motivo: string }[];
  descarga:   { estado: string; motivo: string | null; filas: number | null; actualizado_at: string } | null;
}

// ── Estilos (misma paleta que HerramientasPage) ───────────────────────────────
const S: Record<string, React.CSSProperties> = {
  card:     { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 20, marginBottom: 16 },
  label:    { fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 4, display: 'block' },
  input:    { background: '#1e293b', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px 10px', width: '100%', boxSizing: 'border-box' as const, fontSize: '0.85rem' },
  btn:      { cursor: 'pointer', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.84rem', border: 'none' },
  h3:       { fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 12, color: '#94a3b8' },
  tagRed:   { background: '#450a0a', color: '#fca5a5', borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, display: 'inline-block' },
  tagOrange:{ background: '#431407', color: '#fdba74', borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, display: 'inline-block' },
  tagGreen: { background: '#14532d', color: '#86efac', borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, display: 'inline-block' },
  tagBlue:  { background: '#0c1a4a', color: '#93c5fd', borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, display: 'inline-block' },
};

function fmtFecha(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}

function diasTag(dias: number) {
  if (dias >= 90) return <span style={S.tagRed}>{dias} días</span>;
  if (dias >= 60) return <span style={S.tagOrange}>{dias} días</span>;
  return <span style={S.tagGreen}>{dias} días</span>;
}

function stressTag(dias: number | null) {
  if (dias == null) return <span style={{ color: '#64748b' }}>—</span>;
  return <span style={S.tagBlue}>{dias} días</span>;
}

function estadoTag(estado: EstadoCola) {
  switch (estado) {
    case 'cargado':   return <span style={S.tagGreen}>✓ Cargado</span>;
    case 'pendiente': return <span style={S.tagOrange}>⏳ Pendiente</span>;
    case 'error':     return <span style={S.tagRed}>✕ Error</span>;
    case 'omitido':   return <span style={{ ...S.tagBlue, background: '#1e293b', color: '#94a3b8' }}>Omitido</span>;
    default:          return <span style={{ color: '#64748b' }}>{estado}</span>;
  }
}

// ── Componente ────────────────────────────────────────────────────────────────
export function StressAlertasContent() {
  const toast = useToast();

  const [datos,     setDatos]     = useState<StressAlerta[]>([]);
  const [cargando,  setCargando]  = useState(false);
  const [cargado,   setCargado]   = useState(false);
  const [busqueda,  setBusqueda]  = useState('');
  // Vista por estado. Default = "faltantes" (pendiente+error+omitido): lo que requiere acción.
  const [vista,     setVista]     = useState<'faltantes' | 'cargado' | 'todo'>('faltantes');
  const [carga,     setCarga]     = useState<CargaEstado | null>(null);

  // Estado de la carga automática en SIAPE (banner)
  useEffect(() => {
    apiFetch<any>('/stress/carga-estado')
      .then(r => { if (r?.ok) setCarga(r as CargaEstado); })
      .catch(() => {});
  }, []);

  // Cargar al montar
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch<any>('/stress/alertas');
      if (res?.ok) {
        setDatos(res.data ?? []);
        setCargado(true);
      } else {
        toast.error(res?.error ?? 'Error cargando alertas');
      }
    } catch (e: any) {
      toast.error('Error: ' + e?.message);
    } finally {
      setCargando(false);
    }
  }, [toast]);

  const cargadoRef = useRef(false);
  useEffect(() => {
    if (!cargadoRef.current) {
      cargadoRef.current = true;
      cargar();
    }
  }, [cargar]);

  // Filtrado por vista (estado) + búsqueda de texto
  const filtrados = datos.filter(r => {
    if (vista === 'faltantes' && r.estado === 'cargado') return false;
    if (vista === 'cargado'   && r.estado !== 'cargado') return false;
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      r.nombre.toLowerCase().includes(q)          ||
      String(r.dni).includes(q)                   ||
      (r.ley || '').toLowerCase().includes(q)     ||
      (r.servicio || '').toLowerCase().includes(q)||
      (r.motivo || '').toLowerCase().includes(q)
    );
  });

  // Exportar
  const exportar = () => {
    if (!filtrados.length) return;
    exportToExcel(
      `stress_alertas_${new Date().toISOString().slice(0, 10)}`,
      filtrados.map(r => ({
        'DNI':                  r.dni,
        'Apellido y Nombre':    r.nombre,
        'Días transcurridos':   r.dias_transcurridos ?? '',
        'Ley':                  r.ley,
        'Servicio':             r.servicio,
        'Licencia':             r.licencia ?? '',
        'Días stress a cargar': r.dias_stress ?? 'Sin dato',
        'Estado':               r.estado,
        'Motivo':               r.motivo ?? '',
      }))
    );
  };

  // Conteos por estado (sobre TODOS los datos de la cola, no sobre el filtro)
  const nPend    = datos.filter(r => r.estado === 'pendiente').length;
  const nError   = datos.filter(r => r.estado === 'error').length;
  const nOmit    = datos.filter(r => r.estado === 'omitido').length;
  const nCargado = datos.filter(r => r.estado === 'cargado').length;

  return (
    <>
      <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>

        {/* ─ Banner: estado de la carga automática en SIAPE ─ */}
        {carga && (
          <div style={{
            background: carga.conteo.pendiente > 0 ? 'rgba(251,146,60,0.12)' : 'rgba(34,197,94,0.12)',
            border: `1px solid ${carga.conteo.pendiente > 0 ? 'rgba(251,146,60,0.4)' : 'rgba(34,197,94,0.4)'}`,
            borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: '0.85rem',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              <strong style={{ fontSize: '0.9rem' }}>
                🤖 Carga automática SIAPE {carga.anio}
              </strong>
              <span style={S.tagGreen}>{carga.conteo.cargado} cargados</span>
              {carga.conteo.error > 0 && <span style={S.tagBlue}>{carga.conteo.error} ya existían</span>}
              {carga.conteo.pendiente > 0
                ? <span style={S.tagOrange}>{carga.conteo.pendiente} pendientes</span>
                : <span style={S.tagGreen}>0 pendientes ✓</span>}
              {carga.conteo.omitido > 0 && <span style={{ color: '#fca5a5' }}>{carga.conteo.omitido} a revisar</span>}
              <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '0.78rem' }}>
                Última corrida: {carga.ultima ? fmtFecha(carga.ultima) + ' ' + carga.ultima.slice(11, 16) : '—'}
              </span>
            </div>
            {carga.conteo.pendiente > 0 && (
              <div style={{ marginTop: 8, color: '#94a3b8', fontSize: '0.78rem' }}>
                Pendientes de cargar: {carga.pendientes.map(p => p.apellido).slice(0, 8).join(' · ')}
                {carga.pendientes.length > 8 ? ` … (+${carga.pendientes.length - 8})` : ''}
              </div>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.78rem', color: '#94a3b8', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>📥 <strong>Descarga Tiempo Acumulado:</strong></span>
              {carga.descarga
                ? (<>
                    {carga.descarga.estado === 'ok'
                      ? <span style={S.tagGreen}>OK{carga.descarga.filas != null ? ` · ${carga.descarga.filas} filas` : ''}</span>
                      : <span style={S.tagRed}>ERROR</span>}
                    <span style={{ color: '#64748b' }}>
                      {fmtFecha(carga.descarga.actualizado_at)} {carga.descarga.actualizado_at.slice(11, 16)}
                    </span>
                    {carga.descarga.estado !== 'ok' && carga.descarga.motivo && (
                      <span style={{ color: '#fca5a5' }}>{carga.descarga.motivo}</span>
                    )}
                  </>)
                : <span style={{ color: '#64748b' }}>sin datos aún</span>}
            </div>
          </div>
        )}

        {/* ─ Encabezado ─ */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>
            🏖️ Stress Post-Vacacional
          </h1>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
            Refleja la cola de carga del robot SIAPE: cada agente con su estado
            (pendiente / cargado / omitido / error) y su motivo. Misma lógica y umbral que la carga automática.
          </p>
        </div>

        {/* ─ Resumen por estado ─ */}
        {cargado && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Pendientes de cargar', val: nPend,    color: '#fdba74', vista: 'faltantes' as const },
              { label: 'Con error en SIAPE',   val: nError,   color: '#fca5a5', vista: 'faltantes' as const },
              { label: 'Omitidos (a revisar)', val: nOmit,    color: '#93c5fd', vista: 'faltantes' as const },
              { label: 'Ya cargados',          val: nCargado, color: '#86efac', vista: 'cargado'   as const },
            ].map(({ label, val, color, vista: v }) => (
              <div
                key={label}
                onClick={() => setVista(v)}
                style={{ ...S.card, cursor: 'pointer', marginBottom: 0 }}
              >
                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: '1.9rem', fontWeight: 800, color }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* ─ Controles ─ */}
        <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="stress-busqueda" style={S.label}>Buscar</label>
            <input
              id="stress-busqueda"
              name="busqueda"
              style={S.input}
              placeholder="Nombre, DNI, ley o servicio..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
          </div>

          <div style={{ marginTop: 18 }}>
            <label style={S.label}>Vista</label>
            <div style={{ display: 'flex', gap: 0, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, overflow: 'hidden' }}>
              {([
                { k: 'faltantes', t: 'Faltantes' },
                { k: 'cargado',   t: 'Cargados' },
                { k: 'todo',      t: 'Todo' },
              ] as const).map(({ k, t }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setVista(k)}
                  style={{
                    cursor: 'pointer', border: 'none', padding: '7px 14px', fontSize: '0.82rem', fontWeight: 600,
                    background: vista === k ? '#1e40af' : '#1e293b',
                    color: vista === k ? '#dbeafe' : '#94a3b8',
                  }}
                >{t}</button>
              ))}
            </div>
          </div>

          <button
            style={{ ...S.btn, background: cargando ? '#374151' : '#1e40af', color: '#93c5fd', marginTop: 18 }}
            onClick={cargar}
            disabled={cargando}
          >
            {cargando ? '⏳ Cargando...' : '🔄 Recargar'}
          </button>

          <button
            style={{ ...S.btn, background: filtrados.length ? '#166534' : '#1e293b', color: filtrados.length ? '#86efac' : '#64748b', marginTop: 18 }}
            onClick={exportar}
            disabled={!filtrados.length}
          >
            📊 Exportar Excel ({filtrados.length})
          </button>
        </div>

        {/* ─ Tabla ─ */}
        <div style={S.card}>
          <div style={S.h3}>
            {cargando ? 'Procesando archivos Excel y cruzando con la base de datos...' : `${filtrados.length} agente${filtrados.length !== 1 ? 's' : ''}`}
          </div>

          {cargando && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: '0.9rem' }}>
              ⏳ Leyendo Excel y consultando la base de datos, esto puede tardar unos segundos...
            </div>
          )}

          {!cargando && cargado && filtrados.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: '0.9rem' }}>
              ✅ No hay agentes con alertas de stress pendientes.
            </div>
          )}

          {!cargando && filtrados.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.81rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                    {['Apellido y Nombre', 'DNI', 'Estado', 'Días transcurridos', 'Ley', 'Servicio', 'Stress a cargar', 'Motivo'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '7px 10px',
                        color: '#64748b', fontWeight: 700,
                        fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((r, i) => (
                    <tr
                      key={r.dni}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                      }}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#e2e8f0' }}>
                        {r.nombre || '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#94a3b8', fontFamily: 'monospace' }}>
                        {r.dni}
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        {estadoTag(r.estado)}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {r.dias_transcurridos == null ? <span style={{ color: '#64748b' }}>—</span> : diasTag(r.dias_transcurridos)}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: '0.78rem' }}>
                        {r.ley}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#cbd5e1', fontSize: '0.78rem' }}>
                        {r.servicio}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {stressTag(r.dias_stress)}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: '0.75rem', maxWidth: 260 }}>
                        {r.motivo || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─ Referencia de colores ─ */}
        {cargado && (
          <div style={{ ...S.card, fontSize: '0.75rem', color: '#64748b' }}>
            <span style={{ marginRight: 16 }}>
              <span style={S.tagGreen}>40–59 días</span>
            </span>
            <span style={{ marginRight: 16 }}>
              <span style={S.tagOrange}>60–89 días</span>
            </span>
            <span style={{ marginRight: 16 }}>
              <span style={S.tagRed}>≥90 días</span>
            </span>
            <span style={{ color: '#475569' }}>
              · Regla: Ley 10.471 / Becas / Residentes → 12 días · Ley 10.430: proporcional por antigüedad (1–5a: 6d, 5–10a: 9d, 10–20a: 12d, +20a: 14d)
            </span>
          </div>
        )}

      </div>
    </>
  );
}

type StressSection = 'stress' | 'licencias';

export function StressAlertasPage({ initialSection = 'stress' }: { initialSection?: StressSection } = {}) {
  const [pageTab, setPageTab] = useState<StressSection>(initialSection);

  return (
    <Layout title="Herramientas">
      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            className={`btn${pageTab === 'stress' ? ' active' : ''}`}
            onClick={() => setPageTab('stress')}
            type="button"
            style={{
              borderRadius: 0,
              border: 0,
              borderRight: '1px solid rgba(255,255,255,0.08)',
              padding: '12px 18px',
              fontWeight: 700,
              background: pageTab === 'stress' ? 'rgba(14,165,233,0.22)' : 'transparent',
            }}
          >
            Stress post-vacacional
          </button>
          <button
            className={`btn${pageTab === 'licencias' ? ' active' : ''}`}
            onClick={() => setPageTab('licencias')}
            type="button"
            style={{
              borderRadius: 0,
              border: 0,
              padding: '12px 18px',
              fontWeight: 700,
              background: pageTab === 'licencias' ? 'rgba(14,165,233,0.22)' : 'transparent',
            }}
          >
            Licencias pendientes
          </button>
        </div>
        <div style={{ padding: '10px 16px', color: '#94a3b8', fontSize: '0.82rem' }}>
          {pageTab === 'stress'
            ? 'Alertas de anual complementaria pendiente y dias de stress a cargar.'
            : 'Dias pendientes de licencia por agente y servicio.'}
        </div>
      </div>

      {pageTab === 'licencias' ? <LicenciasPendientesContent /> : <StressAlertasContent />}
    </Layout>
  );
}
