// src/pages/ConsultasPage/index.tsx
import React, { useState, useRef } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, exportToPdf, printTable } from '../../utils/export';

const COLS = ['id','dni','motivo_consulta','explicacion','estado','created_at'];

export function ConsultasPage() {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [apellido, setApellido] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const search = async () => {
    const cleanDni = dni.replace(/\D/g, '');
    const cleanApe = apellido.trim();
    if (!cleanDni && !cleanApe) { toast.error('Ingresá DNI o Apellido'); return; }
    setLoading(true);
    setRows([]);
    setSelectedIdx(-1);
    setPage(1);
    try {
      let data: any[] = [];
      if (cleanDni) {
        const res = await apiFetch<any>(`/consultas?dni=${cleanDni}&limit=200&page=1`);
        data = res?.data || [];
      } else {
        // buscar agentes por apellido, luego sus consultas
        const persons = await apiFetch<any>(`/personal/search?apellido=${encodeURIComponent(cleanApe)}&limit=50&page=1`);
        const dnis = (persons?.data || []).map((p: any) => p.dni);
        for (const d of dnis.slice(0, 10)) {
          const res = await apiFetch<any>(`/consultas?dni=${d}&limit=100&page=1`);
          data = [...data, ...(res?.data || [])];
        }
      }
      setRows(data);
      if (!data.length) toast.error('Sin consultas', 'No se encontraron registros');
      else toast.ok(`${data.length} consulta(s)`);
    } catch (e: any) {
      toast.error('Error', e?.message);
    } finally {
      setLoading(false);
    }
  };

  const cols = rows.length ? COLS.filter(c => rows[0].hasOwnProperty(c)) : COLS;
  const total = Math.max(1, Math.ceil(rows.length / pageSize));
  const curPage = Math.min(page, total);
  const start = (curPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const selected = selectedIdx >= 0 ? rows[selectedIdx] : null;

  return (
    <Layout title="Consultas" showBack>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Search card */}
        <div className="card" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginBottom: 12, fontSize: '0.95rem' }}>🔍 Buscar consultas</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 3 }}>DNI</div>
              <input className="input" placeholder="Número de DNI"
                value={dni} onChange={e => setDni(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: 2, minWidth: 200 }}>
              <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 3 }}>APELLIDO</div>
              <input className="input" placeholder="Buscar por apellido (Enter)"
                value={apellido} onChange={e => setApellido(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                style={{ width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" onClick={search} disabled={loading}>
                {loading ? '⏳…' : '🔍 Buscar'}
              </button>
            </div>
          </div>
        </div>

        {/* Results card */}
        {rows.length > 0 && (
          <div className="card" style={{ padding: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: '0.9rem' }}>📋 {rows.length} consultas</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={() => printTable('Consultas', rows)}>🖨 Imprimir</button>
                <button className="btn" onClick={() => exportToExcel('consultas.xlsx', rows)}>Excel</button>
                <button className="btn" onClick={() => exportToPdf('consultas.pdf', rows)}>PDF</button>
              </div>
            </div>
            <div className="gp-tablewrap">
              <table className="table">
                <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const ri = start + i;
                    return (
                      <tr key={ri} className={ri === selectedIdx ? 'gp-row-active' : ''}
                        style={{ cursor: 'pointer' }} onClick={() => setSelectedIdx(ri)}>
                        {cols.map(c => (
                          <td key={c} className="cell">
                            {String(row[c] ?? '').substring(0, 100)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Paginación */}
            {total > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={curPage <= 1}>◀</button>
                <span className="badge">Pág. {curPage}/{total}</span>
                <button className="btn" onClick={() => setPage(p => Math.min(total, p+1))} disabled={curPage >= total}>▶</button>
              </div>
            )}
          </div>
        )}

        {/* Detalle card */}
        {selected && (
          <div className="card" style={{ padding: '1.2rem' }}>
            <strong style={{ fontSize: '0.9rem', marginBottom: 10, display: 'block' }}>📄 Detalle consulta #{selected.id}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
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
