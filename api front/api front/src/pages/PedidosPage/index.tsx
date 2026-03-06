// src/pages/PedidosPage/index.tsx
import React, { useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { searchPersonal } from '../../api/searchPersonal';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf, printTable } from '../../utils/export';

const ESTADOS_PEDIDO = ['', 'pendiente', 'hecho', 'baja'];
const COLS = ['id','dni','pedido','estado','lugar','fecha','observacion','created_at'];

export function PedidosPage() {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [apellido, setApellido] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const search = async () => {
    const cleanDni = dni.replace(/\D/g, '');
    const cleanApe = apellido.trim();
    if (!cleanDni && !cleanApe) { toast.error('Ingresá DNI o Apellido'); return; }
    setLoading(true); setRows([]); setSelectedIdx(-1); setPage(1);
    try {
      let data: any[] = [];
      if (cleanDni) {
        const q = estadoFilter ? `&estado=${estadoFilter}` : '';
        const res = await apiFetch<any>(`/pedidos?dni=${cleanDni}&limit=300&page=1${q}`);
        data = res?.data || [];
      } else {
        // Usar cache local — /personal/search tiene bug SQL en el backend
        const persons = await searchPersonal(cleanApe, 20);
        for (const p of persons.slice(0, 10)) {
          const q = estadoFilter ? `&estado=${estadoFilter}` : '';
          const res = await apiFetch<any>(`/pedidos?dni=${p.dni}&limit=100&page=1${q}`);
          data = [...data, ...(res?.data || [])];
        }
      }
      setRows(data);
      if (!data.length) toast.error('Sin pedidos', 'No se encontraron registros');
      else toast.ok(`${data.length} pedido(s)`);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  };

  const cols = rows.length ? COLS.filter(c => rows[0].hasOwnProperty(c)) : COLS;
  const total = Math.max(1, Math.ceil(rows.length / pageSize));
  const curPage = Math.min(page, total);
  const start = (curPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const selected = selectedIdx >= 0 ? rows[selectedIdx] : null;

  const estadoColor: Record<string, string> = {
    pendiente: '#f59e0b', hecho: '#22c55e', baja: '#ef4444',
  };

  return (
    <Layout title="Pedidos" showBack>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div className="card" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginBottom: 12, fontSize: '0.95rem' }}>🔍 Buscar pedidos</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 3 }}>DNI</div>
              <input className="input" placeholder="Número de DNI" value={dni}
                onChange={e => setDni(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: 2, minWidth: 180 }}>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 3 }}>APELLIDO</div>
              <input className="input" placeholder="Buscar por apellido" value={apellido}
                onChange={e => setApellido(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div style={{ minWidth: 140 }}>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 3 }}>ESTADO</div>
              <select className="input" value={estadoFilter} onChange={e => setEstadoFilter(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}>
                <option value="">Todos</option>
                {ESTADOS_PEDIDO.filter(Boolean).map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" onClick={search} disabled={loading}>
                {loading ? '⏳…' : '🔍 Buscar'}
              </button>
            </div>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="card" style={{ padding: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: '0.9rem' }}>📋 {rows.length} pedidos</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={() => printTable('Pedidos', rows)}>🖨</button>
                <button className="btn" onClick={() => exportToExcel('pedidos.xlsx', rows)}>Excel</button>
                <button className="btn" onClick={() => exportToPdf('pedidos.pdf', rows)}>PDF</button>
              </div>
            </div>
            <div className="gp-tablewrap">
              <table className="table">
                <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const ri = start + i;
                    const color = estadoColor[row.estado] || '#64748b';
                    return (
                      <tr key={ri} className={ri === selectedIdx ? 'gp-row-active' : ''}
                        style={{ cursor: 'pointer' }} onClick={() => setSelectedIdx(ri)}>
                        {cols.map(c => (
                          <td key={c} className="cell"
                            style={c === 'estado' ? { color, fontWeight: 700 } : undefined}>
                            {String(row[c] ?? '').substring(0, 100)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={curPage <= 1}>◀</button>
                <span className="badge">Pág. {curPage}/{total}</span>
                <button className="btn" onClick={() => setPage(p => Math.min(total, p+1))} disabled={curPage >= total}>▶</button>
              </div>
            )}
          </div>
        )}

        {selected && (
          <div className="card" style={{ padding: '1.2rem' }}>
            <strong style={{ fontSize: '0.9rem', marginBottom: 10, display: 'block' }}>
              📄 Detalle pedido #{selected.id}
              {selected.estado && (
                <span style={{ marginLeft: 10, color: estadoColor[selected.estado] || '#64748b',
                  fontSize: '0.82rem', fontWeight: 700 }}>{selected.estado}</span>
              )}
            </strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {Object.entries(selected).map(([k, v]) => (
                <div key={k}>
                  <div className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
                  <div style={{ fontSize: '0.88rem', wordBreak: 'break-word' }}>{String(v ?? '—')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
