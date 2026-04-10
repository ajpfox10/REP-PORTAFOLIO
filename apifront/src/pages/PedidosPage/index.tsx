// src/pages/PedidosPage/index.tsx
// Carga todos los pedidos pendientes al entrar.
// Filtros client-side: DNI, apellido, estado.
// Búsqueda por apellido usa el cache global de personal.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { getAllPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf, printTable } from '../../utils/export';

// ─── helpers ────────────────────────────────────────────────────────────────
function fmt(d?: string | null) {
  if (!d) return '—';
  try {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-').map(Number);
    if (!y) return String(d);
    return new Date(y, m - 1, day).toLocaleDateString('es-AR');
  } catch { return String(d); }
}

async function fetchAllPedidos(params: string): Promise<any[]> {
  const PAGE = 200;
  let page = 1;
  let all: any[] = [];
  let total = Infinity;
  while (all.length < total) {
    const sep = params ? '&' : '?';
    const res = await apiFetch<any>(`/pedidos?limit=${PAGE}&page=${page}${params ? sep + params : ''}`);
    const rows: any[] = res?.data || [];
    if (!rows.length) break;
    all = [...all, ...rows];
    if (res?.meta?.total) total = Number(res.meta.total);
    else total = all.length;
    if (rows.length < PAGE) break;
    page++;
  }
  return all;
}

const ESTADOS = ['pendiente', 'hecho', 'baja'];
const estadoColor: Record<string, string> = {
  pendiente: '#f59e0b',
  hecho:     '#22c55e',
  baja:      '#ef4444',
};

const PAGE_SIZE = 50;

// ─── Componente principal ─────────────────────────────────────────────────────
export function PedidosPage() {
  const toast = useToast();

  // Datos
  const [todos,        setTodos]        = useState<any[]>([]);
  const [personalMap,  setPersonalMap]  = useState<Record<string, { apellido: string; nombre: string }>>({});
  const [loading,      setLoading]      = useState(true);
  const [refreshKey,   setRefreshKey]   = useState(0);
  const [savingId,     setSavingId]     = useState<number | null>(null);

  // Filtros UI
  const [filtroDni,    setFiltroDni]    = useState('');
  const [filtroNombre, setFiltroNombre] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('pendiente');

  // Tabla
  const [page,         setPage]         = useState(1);
  const [selectedId,   setSelectedId]   = useState<number | null>(null);

  // ── Cambiar estado de pedido ────────────────────────────────────────────────
  const cambiarEstado = useCallback(async (id: number, estado: string) => {
    setSavingId(id);
    try {
      await apiFetch<any>(`/pedidos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado }),
      });
      setTodos(prev => prev.map(r => r.id === id ? { ...r, estado } : r));
      toast.ok(`Pedido marcado como ${estado}`);
    } catch (e: any) {
      toast.error('Error al actualizar pedido', e?.message);
    } finally {
      setSavingId(null);
    }
  }, []); // eslint-disable-line

  // ── Carga inicial ───────────────────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [pedidos, personal] = await Promise.all([
        fetchAllPedidos('sort=-created_at'),
        getAllPersonal(),
      ]);
      setTodos(pedidos);
      const map: Record<string, { apellido: string; nombre: string }> = {};
      for (const p of personal) {
        if (p.dni != null) map[String(p.dni)] = { apellido: p.apellido || '', nombre: p.nombre || '' };
      }
      setPersonalMap(map);
    } catch (e: any) {
      toast.error('Error al cargar pedidos', e?.message);
    } finally {
      setLoading(false);
    }
  }, [refreshKey]); // eslint-disable-line

  useEffect(() => { cargar(); }, [cargar]);

  // ── Filtrado client-side ────────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    let arr = todos;

    if (filtroEstado) {
      arr = arr.filter(r => (r.estado || '').toLowerCase() === filtroEstado);
    }

    const dniQ = filtroDni.replace(/\D/g, '');
    if (dniQ) {
      arr = arr.filter(r => String(r.dni || '').includes(dniQ));
    }

    const nomQ = filtroNombre.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (nomQ) {
      arr = arr.filter(r => {
        const p = personalMap[String(r.dni)];
        const ape = (p?.apellido || r.apellido || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const nom = (p?.nombre   || r.nombre   || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return ape.includes(nomQ) || nom.includes(nomQ) || `${ape} ${nom}`.includes(nomQ);
      });
    }

    return arr;
  }, [todos, filtroEstado, filtroDni, filtroNombre, personalMap]);

  // reset page cuando cambian filtros
  useEffect(() => { setPage(1); setSelectedId(null); }, [filtroEstado, filtroDni, filtroNombre]);

  // ── Paginación ──────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const curPage    = Math.min(page, totalPages);
  const pageRows   = filtrados.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const selected   = selectedId != null ? todos.find(r => r.id === selectedId) ?? null : null;

  // ── Nombre agente ───────────────────────────────────────────────────────────
  const nombreAgente = (row: any) => {
    const p = personalMap[String(row.dni)];
    if (p?.apellido) return `${p.apellido}, ${p.nombre}`;
    return row.apellido ? `${row.apellido}, ${row.nombre}` : `DNI ${row.dni}`;
  };

  // ── Contadores para badges ──────────────────────────────────────────────────
  const cntPend = useMemo(() => todos.filter(r => r.estado === 'pendiente').length, [todos]);
  const cntHech = useMemo(() => todos.filter(r => r.estado === 'hecho').length,     [todos]);
  const cntBaja = useMemo(() => todos.filter(r => r.estado === 'baja').length,      [todos]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportRows = filtrados.map(r => ({
    id:          r.id,
    dni:         r.dni,
    agente:      nombreAgente(r),
    pedido:      r.pedido,
    estado:      r.estado,
    lugar:       r.lugar,
    fecha:       fmt(r.fecha),
    observacion: r.observacion,
    creado:      fmt(r.created_at),
  }));

  return (
    <Layout title="Pedidos" showBack>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong style={{ fontSize: '1.05rem' }}>📋 Pedidos</strong>
            <div className="muted" style={{ fontSize: '0.73rem', marginTop: 3 }}>
              {loading ? 'Cargando…' : `${todos.length} registros totales`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" style={{ fontSize: '0.75rem', background: '#16a34a', color: '#fff' }}
              onClick={() => exportToExcel('pedidos', exportRows)} disabled={loading || !filtrados.length}>📊 Excel</button>
            <button className="btn" style={{ fontSize: '0.75rem', background: '#dc2626', color: '#fff' }}
              onClick={() => exportToPdf('pedidos', exportRows)} disabled={loading || !filtrados.length}>📕 PDF</button>
            <button className="btn" style={{ fontSize: '0.75rem' }}
              onClick={() => printTable('Pedidos', exportRows)} disabled={loading || !filtrados.length}>🖨 Imprimir</button>
            <button className="btn" style={{ fontSize: '0.75rem' }}
              onClick={() => setRefreshKey(k => k + 1)} disabled={loading}>🔄 Actualizar</button>
          </div>
        </div>

        {/* ── KPIs ── */}
        {!loading && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'Pendientes', count: cntPend, color: '#f59e0b' },
              { label: 'Hechos',     count: cntHech, color: '#22c55e' },
              { label: 'Baja',       count: cntBaja, color: '#ef4444' },
            ].map(k => (
              <div key={k.label} className="card" style={{ padding: '10px 18px', flex: 1, minWidth: 100, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: k.color, borderRadius: '16px 0 0 16px' }} />
                <div style={{ paddingLeft: 8 }}>
                  <div className="muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: k.color, lineHeight: 1.2 }}>{k.count}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filtros ── */}
        <div className="card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 12, color: '#e2e8f0' }}>🔍 Buscar pedidos</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>

            <div style={{ flex: 1, minWidth: 130 }}>
              <div className="muted" style={{ fontSize: '0.7rem', marginBottom: 3 }}>DNI</div>
              <input className="input" placeholder="Número de DNI" value={filtroDni}
                onChange={e => setFiltroDni(e.target.value.replace(/\D/g, ''))}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>

            <div style={{ flex: 2, minWidth: 180 }}>
              <div className="muted" style={{ fontSize: '0.7rem', marginBottom: 3 }}>APELLIDO</div>
              <input className="input" placeholder="Buscar por apellido" value={filtroNombre}
                onChange={e => setFiltroNombre(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>

            <div style={{ minWidth: 140 }}>
              <div className="muted" style={{ fontSize: '0.7rem', marginBottom: 3 }}>ESTADO</div>
              <select className="input" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}>
                <option value="">Todos</option>
                {ESTADOS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
              </select>
            </div>

            <button className="btn"
              onClick={() => { setFiltroDni(''); setFiltroNombre(''); setFiltroEstado('pendiente'); }}
              style={{ whiteSpace: 'nowrap' }}>
              ✕ Limpiar
            </button>
          </div>
        </div>

        {/* ── Tabla ── */}
        <div className="card" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: '0.88rem', color: '#e2e8f0' }}>
              {loading ? 'Cargando…' : `${filtrados.length} pedido${filtrados.length !== 1 ? 's' : ''}${filtroEstado ? ` · ${filtroEstado}` : ''}`}
            </strong>
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={curPage <= 1}>‹</button>
                <span className="muted" style={{ fontSize: '0.78rem' }}>Pág. {curPage} / {totalPages}</span>
                <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages}>›</button>
              </div>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>🔄 Cargando pedidos…</div>
          ) : filtrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: '#475569', fontSize: '0.88rem' }}>
              Sin pedidos para los filtros seleccionados
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.81rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {['#', 'DNI', 'Agente', 'Pedido', 'Estado', 'Lugar', 'Fecha', 'Observación', 'Acciones'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#64748b', fontSize: '0.67rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row: any) => {
                    const color = estadoColor[row.estado] || '#64748b';
                    const isSelected = row.id === selectedId;
                    return (
                      <tr key={row.id}
                        onClick={() => setSelectedId(isSelected ? null : row.id)}
                        style={{
                          borderTop: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(124,58,237,0.15)' : undefined,
                        }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.74rem', color: '#475569' }}>{row.id}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{row.dni}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontWeight: 600 }}>{nombreAgente(row)}</td>
                        <td style={{ padding: '8px 10px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.pedido}>{row.pedido || '—'}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5, background: color + '28', color, fontWeight: 700 }}>
                            {row.estado || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{row.lugar || '—'}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{fmt(row.fecha || row.created_at)}</td>
                        <td style={{ padding: '8px 10px', color: '#64748b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.observacion}>{row.observacion || '—'}</td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                          {row.estado === 'pendiente' && (
                            <>
                              <button className="btn" title="Marcar Hecho" disabled={savingId === row.id}
                                style={{ fontSize: '0.68rem', padding: '2px 6px', marginRight: 4 }}
                                onClick={e => { e.stopPropagation(); cambiarEstado(row.id, 'hecho'); }}>✅</button>
                              <button className="btn" title="Dar de Baja" disabled={savingId === row.id}
                                style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                                onClick={e => { e.stopPropagation(); cambiarEstado(row.id, 'baja'); }}>🗑️</button>
                            </>
                          )}
                          {row.estado === 'hecho' && (
                            <>
                              <button className="btn" title="Restaurar" disabled={savingId === row.id}
                                style={{ fontSize: '0.68rem', padding: '2px 6px', marginRight: 4 }}
                                onClick={e => { e.stopPropagation(); cambiarEstado(row.id, 'pendiente'); }}>↩️</button>
                              <button className="btn" title="Dar de Baja" disabled={savingId === row.id}
                                style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                                onClick={e => { e.stopPropagation(); cambiarEstado(row.id, 'baja'); }}>🗑️</button>
                            </>
                          )}
                          {row.estado === 'baja' && (
                            <button className="btn" title="Restaurar" disabled={savingId === row.id}
                              style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                              onClick={e => { e.stopPropagation(); cambiarEstado(row.id, 'pendiente'); }}>↩️</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación inferior */}
          {!loading && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={curPage <= 1}>‹ Anterior</button>
              <span className="muted" style={{ fontSize: '0.78rem', alignSelf: 'center' }}>Pág. {curPage} / {totalPages}</span>
              <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages}>Siguiente ›</button>
            </div>
          )}
        </div>

        {/* ── Detalle del pedido seleccionado ── */}
        {selected && (
          <div className="card" style={{ padding: '1.2rem', borderLeft: `3px solid ${estadoColor[selected.estado] || '#64748b'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: '0.9rem', color: '#e2e8f0' }}>
                📄 Pedido #{selected.id}
                {selected.estado && (
                  <span style={{ marginLeft: 10, color: estadoColor[selected.estado] || '#64748b', fontSize: '0.8rem', fontWeight: 700 }}>
                    {selected.estado.toUpperCase()}
                  </span>
                )}
              </strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {selected.estado !== 'hecho' && (
                  <button
                    className="btn"
                    style={{ fontSize: '0.73rem', background: '#16a34a', color: '#fff' }}
                    disabled={savingId === selected.id}
                    onClick={() => cambiarEstado(selected.id, 'hecho')}
                  >✅ Marcar Hecho</button>
                )}
                {selected.estado !== 'baja' && (
                  <button
                    className="btn"
                    style={{ fontSize: '0.73rem', background: '#dc2626', color: '#fff' }}
                    disabled={savingId === selected.id}
                    onClick={() => cambiarEstado(selected.id, 'baja')}
                  >🗑️ Dar de Baja</button>
                )}
                {selected.estado !== 'pendiente' && (
                  <button
                    className="btn"
                    style={{ fontSize: '0.73rem' }}
                    disabled={savingId === selected.id}
                    onClick={() => cambiarEstado(selected.id, 'pendiente')}
                  >↩️ Restaurar</button>
                )}
                <button className="btn" style={{ fontSize: '0.72rem' }} onClick={() => setSelectedId(null)}>✕ Cerrar</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {[
                { k: 'Agente',      v: nombreAgente(selected) },
                { k: 'DNI',         v: selected.dni },
                { k: 'Pedido',      v: selected.pedido },
                { k: 'Estado',      v: selected.estado },
                { k: 'Lugar',       v: selected.lugar },
                { k: 'Fecha',       v: fmt(selected.fecha || selected.created_at) },
                { k: 'Observación', v: selected.observacion },
              ].map(({ k, v }) => (
                <div key={k}>
                  <div className="muted" style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: '0.88rem', wordBreak: 'break-word', color: '#e2e8f0' }}>{String(v ?? '—')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
