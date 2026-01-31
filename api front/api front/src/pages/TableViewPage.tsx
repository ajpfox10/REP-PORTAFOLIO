import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { apiFetch } from '../api/http';
import { useToast } from '../ui/toast';
import { exportToExcel, exportToPdf, exportToWord, printTable } from '../utils/export';

// 🎨 CSS de esta ruta (NO global): /src/pages/styles/TableViewPage.css
import './styles/TableViewPage.css';

type Meta = { page: number; limit: number; total: number };

export function TableViewPage() {
  const { table } = useParams();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);

  const [cellModal, setCellModal] = useState<{ col: string; value: string; rowIndex: number } | null>(null);

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

  const exportActions = (
    <div className="row tv-export-actions">
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
  );

  return (
    <Layout title={title} showBack>
      <div className="card tv-card-main">
        <div className="row tv-top-row">
          {exportActions}

          <div className="row tv-top-stats">
            <div className="badge">{loading ? 'Cargando…' : `Filas: ${rows.length}`}</div>
            <div className="badge">Página {page} / {totalPages}</div>
          </div>
        </div>

        <div className="sep" />

        <div className="row tv-controls-row">
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

        <div className="tv-tablewrap">
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
                    <td
                      key={c}
                      className="cell"
                      title="Click para ampliar"
                      onClick={() => setCellModal({ col: c, value: String(r[c] ?? ''), rowIndex: idx })}
                    >
                      {String(r[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Card de acciones debajo de los datos (pedido del usuario) */}
        <div className="sep" />
        <div className="card tv-actions-card">
          <div className="row tv-actions-row">
            <div>
              <div className="row tv-actions-head">
                <h3 className="tv-actions-title">{table === 'pedidos' ? 'Pedidos' : 'Consultas'}</h3>
                <span className="badge">Exportación</span>
              </div>
              <p className="muted tv-actions-tip">
                Tip: si un campo viene largo, hacé click en la celda y se abre un formulario emergente para leerlo completo.
              </p>
            </div>
            {exportActions}
          </div>
        </div>
      </div>

      {cellModal ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={() => setCellModal(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row tv-modal-head">
              <div>
                <div className="muted tv-muted-xs">Fila {cellModal.rowIndex + 1}</div>
                <h3 className="tv-modal-title">{cellModal.col}</h3>
              </div>
              <button className="btn" type="button" onClick={() => setCellModal(null)}>
                Cerrar
              </button>
            </div>

            <div className="sep" />

            <textarea className="textarea" readOnly value={cellModal.value} />

            <div className="row tv-modal-actions">
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(cellModal.value);
                    toast.success('Copiado', 'Se copió el contenido al portapapeles');
                  } catch {
                    toast.error('No se pudo copiar', 'El navegador no permitió copiar.');
                  }
                }}
              >
                Copiar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
