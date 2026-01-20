import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { apiFetch } from '../api/http';
import { useToast } from '../ui/toast';
import { exportToExcel, exportToPdf, exportToWord, printTable } from '../utils/export';

type Meta = { page: number; limit: number; total: number };

export function TableViewPage() {
  const { table } = useParams();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => `Tabla: ${table || ''}`, [table]);

  async function load() {
    if (!table) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/${encodeURIComponent(table)}?page=${page}&limit=${limit}`);
      setRows(Array.isArray(res?.data) ? res.data : []);
      setMeta(res?.meta || null);
    } catch (e: any) {
      toast.error('No se pudo cargar', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, page, limit]);

  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;
  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <Layout title={title} showBack>
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => printTable(title, rows)} disabled={!rows.length}>
              Imprimir
            </button>
            <button className="btn" type="button" onClick={() => exportToExcel(`${table}.xlsx`, rows)} disabled={!rows.length}>
              Excel
            </button>
            <button className="btn" type="button" onClick={() => exportToPdf(title, rows)} disabled={!rows.length}>
              PDF
            </button>
            <button className="btn" type="button" onClick={() => exportToWord(title, rows)} disabled={!rows.length}>
              Word
            </button>
          </div>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="badge">{loading ? 'Cargando…' : `Filas: ${rows.length}`}</div>
            <div className="badge">Página {page} / {totalPages}</div>
          </div>
        </div>

        <div className="sep" />

        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="row">
            <button className="btn" type="button" onClick={() => setPage(1)} disabled={page <= 1}>⏮</button>
            <button className="btn" type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>◀</button>
            <button className="btn" type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>▶</button>
            <button className="btn" type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>⏭</button>
          </div>
          <div className="row">
            <span className="muted">Límite</span>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="sep" />

        <div style={{ overflow: 'auto', maxHeight: '65vh', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)' }}>
          <table className="table">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  {cols.map((c) => (
                    <td key={c}>{String(r[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
