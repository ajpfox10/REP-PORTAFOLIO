// src/pages/BajasPorEstructuraPage/index.tsx
// Bajas por estructura: agentes con estado_empleo='BAJA', agrupados por servicio
// Acceso: admin + usuarios con crud:agentexdni1:read

import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';
import { apiFetch } from '../../api/http';
import { exportToExcel } from '../../utils/export';

interface Baja {
  dni: number;
  apellido: string;
  nombre: string;
  fecha_egreso: string | null;
  anio: number | null;
  servicio_nombre: string;
}

function fmt(d?: string | null) {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

export function BajasPorEstructuraPage() {
  const toast = useToast();

  const [data,       setData]       = useState<Baja[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [anios,      setAnios]      = useState<number[]>([]);
  const [filtroAnio, setFiltroAnio] = useState('');
  const [filtroServ, setFiltroServ] = useState('');
  const [busqueda,   setBusqueda]   = useState('');
  const [agrupado,   setAgrupado]   = useState(true);
  const [collapsed,  setCollapsed]  = useState<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroAnio) params.set('anio', filtroAnio);
      if (filtroServ) params.set('servicio', filtroServ);
      if (busqueda)   params.set('q', busqueda);
      const r = await apiFetch<any>(`/bajas-estructura?${params}`);
      if (r?.ok) {
        setData(r.data ?? []);
        if (r.anios?.length) setAnios(r.anios);
      }
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  }, [toast, filtroAnio, filtroServ, busqueda]);

  useEffect(() => { cargar(); }, [cargar]);

  // Agrupar por servicio
  const grupos = React.useMemo(() => {
    const map = new Map<string, Baja[]>();
    for (const b of data) {
      const key = b.servicio_nombre || 'Sin servicio asignado';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  const toggleCollapse = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const exportar = () => {
    exportToExcel('bajas_por_estructura', data.map(b => ({
      Servicio:      b.servicio_nombre,
      Apellido:      b.apellido,
      Nombre:        b.nombre,
      DNI:           b.dni,
      Año:           b.anio ?? '—',
      'Fecha de Baja': fmt(b.fecha_egreso),
    })));
  };

  // Servicios únicos para el filtro
  const serviciosUnicos = React.useMemo(() => {
    const set = new Set(data.map(b => b.servicio_nombre));
    return Array.from(set).sort();
  }, [data]);

  const sinFecha = data.filter(b => !b.fecha_egreso).length;

  return (
    <Layout title="Bajas por Estructura">

      {/* Filtros */}
      <div className="card" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input className="input" placeholder="Buscar apellido, nombre o DNI…"
          value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ width: 240 }} />

        <select className="input" value={filtroAnio} onChange={e => setFiltroAnio(e.target.value)} style={{ width: 110 }}>
          <option value="">Todos los años</option>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <select className="input" value={filtroServ} onChange={e => setFiltroServ(e.target.value)} style={{ width: 220 }}>
          <option value="">Todos los servicios</option>
          {serviciosUnicos.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <button type="button"
          className={`btn${agrupado ? ' primary' : ''}`}
          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
          onClick={() => setAgrupado(a => !a)}>
          {agrupado ? '⊞ Agrupado' : '≡ Lista'}
        </button>

        <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>
          {data.length} baja{data.length !== 1 ? 's' : ''}
          {sinFecha > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>({sinFecha} sin fecha)</span>}
        </span>
        <button className="btn" type="button" onClick={exportar} disabled={data.length === 0}
          style={{ fontSize: '0.75rem', padding: '4px 12px' }}>📥 Excel</button>
        <button className="btn" type="button" onClick={cargar} disabled={loading}
          style={{ fontSize: '0.75rem', padding: '4px 10px' }}>↻</button>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', color: '#64748b', padding: 32 }}>Cargando…</div>
      ) : data.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: '#64748b', padding: 32 }}>Sin resultados.</div>
      ) : agrupado ? (
        /* ── Vista agrupada por servicio ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grupos.map(([servicio, bajas]) => {
            const isOpen = !collapsed.has(servicio);
            return (
              <div key={servicio} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Cabecera del grupo */}
                <div
                  onClick={() => toggleCollapse(servicio)}
                  style={{
                    padding: '10px 16px', cursor: 'pointer', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(255,255,255,0.03)',
                    borderBottom: isOpen ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{servicio}</span>
                    <span style={{
                      fontSize: '0.68rem', padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                      background: 'rgba(239,68,68,0.15)', color: '#f87171',
                    }}>{bajas.length} baja{bajas.length !== 1 ? 's' : ''}</span>
                  </div>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {isOpen && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                          {['Apellido', 'Nombre', 'DNI', 'Año', 'Fecha de Baja'].map(h => (
                            <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600,
                              color: '#94a3b8', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bajas.map(b => (
                          <tr key={b.dni} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '7px 12px', fontWeight: 600 }}>{b.apellido}</td>
                            <td style={{ padding: '7px 12px' }}>{b.nombre}</td>
                            <td style={{ padding: '7px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.8rem' }}>{b.dni}</td>
                            <td style={{ padding: '7px 12px', color: '#94a3b8' }}>{b.anio ?? '—'}</td>
                            <td style={{ padding: '7px 12px', color: b.fecha_egreso ? '#fbbf24' : '#ef4444' }}>
                              {fmt(b.fecha_egreso)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Vista lista plana ── */
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Servicio', 'Apellido', 'Nombre', 'DNI', 'Año', 'Fecha de Baja'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600,
                      color: '#94a3b8', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map(b => (
                  <tr key={b.dni} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 12px', color: '#94a3b8', maxWidth: 200,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={b.servicio_nombre}>{b.servicio_nombre}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{b.apellido}</td>
                    <td style={{ padding: '8px 12px' }}>{b.nombre}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.8rem' }}>{b.dni}</td>
                    <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{b.anio ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: b.fecha_egreso ? '#fbbf24' : '#ef4444' }}>
                      {fmt(b.fecha_egreso)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
