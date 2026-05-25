// src/pages/StressAlertasPage/index.tsx
// Alertas de stress post-vacacional
// Muestra agentes que completaron su licencia anual (Cant. Días = 0),
// no tienen ANUAL COMPLEMENTARIA cargada y llevan >= 40 días sin ella.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Layout }        from '../../components/Layout';
import { apiFetch }      from '../../api/http';
import { exportToExcel } from '../../utils/export';
import { useToast }      from '../../ui/toast';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface StressAlerta {
  dni:                   number;
  nombre:                string;
  ultimo_dia_vacaciones: string;
  dias_transcurridos:    number;
  ley:                   string;
  servicio:              string;
  dias_stress:           number | null;
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

// ── Componente ────────────────────────────────────────────────────────────────
export function StressAlertasPage() {
  const toast = useToast();

  const [datos,     setDatos]     = useState<StressAlerta[]>([]);
  const [cargando,  setCargando]  = useState(false);
  const [cargado,   setCargado]   = useState(false);
  const [busqueda,  setBusqueda]  = useState('');
  const [soloSinLey, setSoloSinLey] = useState(false);

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

  // Filtrado
  const filtrados = datos.filter(r => {
    if (soloSinLey && r.dias_stress !== null) return false;
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      r.nombre.toLowerCase().includes(q)  ||
      String(r.dni).includes(q)           ||
      r.ley.toLowerCase().includes(q)     ||
      r.servicio.toLowerCase().includes(q)
    );
  });

  // Exportar
  const exportar = () => {
    if (!filtrados.length) return;
    exportToExcel(
      `stress_alertas_${new Date().toISOString().slice(0, 10)}`,
      filtrados.map(r => ({
        'DNI':                   r.dni,
        'Apellido y Nombre':     r.nombre,
        'Último día vacaciones': fmtFecha(r.ultimo_dia_vacaciones),
        'Días transcurridos':    r.dias_transcurridos,
        'Ley':                   r.ley,
        'Servicio':              r.servicio,
        'Días stress a cargar':  r.dias_stress ?? 'Sin dato',
      }))
    );
  };

  const sinStress   = filtrados.filter(r => r.dias_stress === null).length;
  const conStress   = filtrados.filter(r => r.dias_stress !== null).length;
  const criticos    = filtrados.filter(r => r.dias_transcurridos >= 90).length;

  return (
    <Layout title="Herramientas">
      <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>

        {/* ─ Encabezado ─ */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 4 }}>
            🏖️ Stress Post-Vacacional
          </h1>
          <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
            Agentes que completaron su licencia anual (Cant. Días = 0), sin ANUAL COMPLEMENTARIA cargada,
            con más de 40 días desde el último día de vacaciones.
          </p>
        </div>

        {/* ─ Resumen ─ */}
        {cargado && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Total alertas',       val: filtrados.length, color: '#e2e8f0' },
              { label: 'Con stress calculado',val: conStress,  color: '#86efac' },
              { label: 'Sin ley en DB',       val: sinStress,  color: '#fdba74' },
              { label: 'Críticos (≥90 días)', val: criticos,   color: '#fca5a5' },
            ].map(({ label, val, color }) => (
              <div key={label} style={S.card}>
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

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.84rem', marginTop: 18 }}>
            <input
              type="checkbox"
              checked={soloSinLey}
              onChange={e => setSoloSinLey(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Solo sin ley en DB
          </label>

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
                    {['Apellido y Nombre', 'DNI', 'Último día vac.', 'Días transcurridos', 'Ley', 'Servicio', 'Stress a cargar'].map(h => (
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
                      <td style={{ padding: '8px 10px', color: '#e2e8f0', whiteSpace: 'nowrap' }}>
                        {fmtFecha(r.ultimo_dia_vacaciones)}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {diasTag(r.dias_transcurridos)}
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
    </Layout>
  );
}
