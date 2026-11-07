// src/pages/ResidentesPage/ControlSiapeCard.tsx
// Control "residentes activos en SIAPE": residentes + ex residentes (hasta 1 año después de
// terminar) que están activos en la base y tienen que figurar en SIAPE.
// Fuente: GET /residentes/control-siape (HORARIOS.xlsx diario + HORARIOS_HISTORIAL mensual).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api/http';

type Estado = 'ACTIVO_SIAPE' | 'BAJA_SIAPE' | 'ALTA_PENDIENTE';

type Row = {
  dni: number;
  apellido: string;
  nombre: string;
  condicion: 'RESIDENTE' | 'EX_RESIDENTE';
  fin_residencia: string | null;
  control_hasta: string | null;
  estado_base: string;
  ocupacion: string | null;
  ley: string | null;
  servicio: string | null;
  estado: Estado;
  ultima_vez_en_siape: string | null;
  ausente_desde: string | null;
  presencia: (0 | 1 | null)[];
};

type Data = {
  foto: { fecha: string; archivo: string; filas: number; procesado_en: string } | null;
  columnas: string[];
  syncError: string | null;
  totals: { controlados: number; residentes: number; exResidentes: number; activos: number; bajaSiape: number; altaPendiente: number };
  rows: Row[];
};

const ESTADOS: Record<Estado, { label: string; color: string; bg: string }> = {
  BAJA_SIAPE: { label: 'SIAPE lo dio de baja', color: '#fca5a5', bg: 'rgba(239,68,68,0.14)' },
  ALTA_PENDIENTE: { label: 'Alta pendiente en SIAPE', color: '#fdba74', bg: 'rgba(249,115,22,0.14)' },
  ACTIVO_SIAPE: { label: 'Activo en SIAPE', color: '#86efac', bg: 'rgba(34,197,94,0.12)' },
};

function fmt(f?: string | null) {
  if (!f) return '—';
  const m = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f);
}

function colLabel(f: string) {
  const m = f.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return f;
  return m[3] === '01' ? `${m[2]}/${m[1].slice(2)}` : `${m[3]}/${m[2]}`;
}

export function ControlSiapeCard({ onSelectDni }: { onSelectDni?: (dni: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'PROBLEMAS' | 'TODOS'>('PROBLEMAS');

  const cargar = useCallback((refresh = false) => {
    setLoading(true);
    setError(null);
    apiFetch<{ ok: boolean; data: Data }>(`/residentes/control-siape${refresh ? '?refresh=1' : ''}`)
      .then((r) => setData(r.data || null))
      .catch((e: any) => setError(e?.message || 'No se pudo cargar el control SIAPE'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const rows = useMemo(() => {
    if (!data) return [];
    return filtro === 'TODOS' ? data.rows : data.rows.filter((r) => r.estado !== 'ACTIVO_SIAPE');
  }, [data, filtro]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '6px 8px', fontSize: '0.78rem', borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'top' };

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1rem' }}>Control SIAPE</div>
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
            Residentes y ex residentes (hasta 1 año después de terminar) activos en la base: tienen que figurar en SIAPE.
            {data?.foto && <> Última exportación de horarios: <strong>{fmt(data.foto.fecha)}</strong> ({data.foto.filas} agentes).</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as any)} className="input" style={{ fontSize: '0.8rem' }}>
            <option value="PROBLEMAS">Solo con problemas</option>
            <option value="TODOS">Todos</option>
          </select>
          <button className="btn" type="button" onClick={() => cargar(true)} disabled={loading}>
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: '0.84rem', marginBottom: 10 }}>{error}</div>
      )}
      {data?.syncError && (
        <div style={{ padding: 10, borderRadius: 8, background: 'rgba(249,115,22,0.1)', color: '#fdba74', fontSize: '0.8rem', marginBottom: 10 }}>
          No se pudo leer la exportación de horarios: {data.syncError}. Se muestra la última foto guardada.
        </div>
      )}

      {!data && loading && <div className="muted" style={{ padding: 18, textAlign: 'center' }}>Cargando control...</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
            {([
              ['Controlados', data.totals.controlados, '#38bdf8'],
              ['Residentes / ex', `${data.totals.residentes} / ${data.totals.exResidentes}`, '#a78bfa'],
              ['Activos en SIAPE', data.totals.activos, '#22c55e'],
              ['SIAPE los dio de baja', data.totals.bajaSiape, '#ef4444'],
              ['Alta pendiente', data.totals.altaPendiente, '#f97316'],
            ] as [string, React.ReactNode, string][]).map(([label, value, color]) => (
              <div key={label} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color }}>{value}</div>
                <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Agente</th>
                  <th style={th}>Condición</th>
                  <th style={th}>Base</th>
                  <th style={th}>Estado SIAPE</th>
                  <th style={th}>Historia en SIAPE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = ESTADOS[r.estado];
                  return (
                    <tr key={r.dni}>
                      <td style={td}>
                        <button type="button" onClick={() => onSelectDni?.(r.dni)}
                          style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: onSelectDni ? 'pointer' : 'default', textAlign: 'left', fontWeight: 700 }}>
                          {r.apellido}, {r.nombre}
                        </button>
                        <div className="muted" style={{ fontSize: '0.7rem' }}>DNI {r.dni}{r.servicio ? ` · ${r.servicio}` : ''}</div>
                      </td>
                      <td style={td}>
                        {r.condicion === 'RESIDENTE' ? 'Residente' : 'Ex residente'}
                        {r.condicion === 'EX_RESIDENTE' && (
                          <div className="muted" style={{ fontSize: '0.7rem' }}>terminó {fmt(r.fin_residencia)} · control hasta {fmt(r.control_hasta)}</div>
                        )}
                      </td>
                      <td style={td}>
                        {r.estado_base}
                        <div className="muted" style={{ fontSize: '0.7rem' }}>{[r.ocupacion, r.ley].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={td}>
                        <span style={{ padding: '2px 8px', borderRadius: 999, background: e.bg, color: e.color, fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{e.label}</span>
                        {r.estado === 'BAJA_SIAPE' && (
                          <div style={{ fontSize: '0.7rem', marginTop: 3, color: '#fca5a5' }}>
                            figuraba el {fmt(r.ultima_vez_en_siape)} · ya no el {fmt(r.ausente_desde)}
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {data.columnas.map((c, i) => {
                            const v = r.presencia[i];
                            return (
                              <span key={c} title={`${fmt(c)}: ${v === 1 ? 'figura en SIAPE' : v === 0 ? 'NO figura' : 'sin dato'}`}
                                style={{
                                  width: 12, height: 16, borderRadius: 3,
                                  background: v === 1 ? '#22c55e' : v === 0 ? '#ef4444' : 'rgba(255,255,255,0.1)',
                                  opacity: v === 0 && r.estado === 'ALTA_PENDIENTE' ? 0.45 : 1,
                                }} />
                            );
                          })}
                        </div>
                        {data.columnas.length > 0 && (
                          <div className="muted" style={{ fontSize: '0.62rem', marginTop: 2 }}>
                            {colLabel(data.columnas[0])} → {colLabel(data.columnas[data.columnas.length - 1])}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td style={{ ...td, textAlign: 'center' }} colSpan={5} className="muted">
                    {filtro === 'PROBLEMAS' ? 'Todos los controlados figuran en SIAPE.' : 'Sin residentes para controlar.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default ControlSiapeCard;
