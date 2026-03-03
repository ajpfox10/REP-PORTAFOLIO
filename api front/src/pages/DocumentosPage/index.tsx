// src/pages/DocumentosPage/index.tsx
import React, { useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';
import { exportToExcel, printTable } from '../../utils/export';
import { GestionDocumentPreview } from '../Gesytionpage/components/components/GestionDocumentPreview';

const COLS = ['id','nombre','tipo','numero','fecha','descripcion_archivo','nombre_archivo_original'];

export function DocumentosPage() {
  const toast = useToast();
  const [dni, setDni] = useState('');
  const [apellido, setApellido] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Visor
  const [viewer, setViewer] = useState<{
    open: boolean; loading: boolean; error: string | null;
    objectUrl: string | null; meta: any; docId: string | null;
  }>({ open: false, loading: false, error: null, objectUrl: null, meta: null, docId: null });

  const search = async () => {
    const cleanDni = dni.replace(/\D/g, '');
    const cleanApe = apellido.trim();
    if (!cleanDni && !cleanApe) { toast.error('Ingresá DNI o Apellido'); return; }
    setLoading(true); setRows([]); setSelectedIdx(-1); setPage(1);
    try {
      let data: any[] = [];
      if (cleanDni) {
        const res = await apiFetch<any>(`/tblarchivos?dni=${cleanDni}&limit=300&page=1`);
        data = res?.data || [];
        if (!data.length) {
          // fallback al endpoint genérico de documentos
          const res2 = await apiFetch<any>(`/documents?q=${cleanDni}&limit=300&page=1`);
          data = res2?.data || [];
        }
      } else {
        const persons = await apiFetch<any>(`/personal/search?apellido=${encodeURIComponent(cleanApe)}&limit=20&page=1`);
        for (const p of (persons?.data || []).slice(0, 8)) {
          const res = await apiFetch<any>(`/tblarchivos?dni=${p.dni}&limit=100&page=1`);
          data = [...data, ...(res?.data || [])];
        }
      }
      setRows(data);
      if (!data.length) toast.error('Sin documentos', 'No se encontraron archivos');
      else toast.ok(`${data.length} documento(s)`);
    } catch (e: any) { toast.error('Error', e?.message); }
    finally { setLoading(false); }
  };

  const openDoc = async (docId: string, row?: any) => {
    setViewer({ open: true, loading: true, error: null, objectUrl: null, meta: null, docId });
    try {
      if (viewer.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(viewer.objectUrl);
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(`/documents/${docId}/file`);
      const url = URL.createObjectURL(blob);
      setViewer({ open: true, loading: false, error: null, objectUrl: url,
        meta: { contentType, filename: filename || row?.nombre || `doc-${docId}` }, docId });
    } catch (e: any) {
      setViewer(v => ({ ...v, loading: false, error: e?.message || 'No se pudo abrir el archivo' }));
    }
  };

  const closeViewer = () => {
    if (viewer.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(viewer.objectUrl);
    setViewer({ open: false, loading: false, error: null, objectUrl: null, meta: null, docId: null });
  };

  const cols = rows.length ? COLS.filter(c => rows[0].hasOwnProperty(c)) : COLS;
  const total = Math.max(1, Math.ceil(rows.length / pageSize));
  const curPage = Math.min(page, total);
  const start = (curPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const selected = selectedIdx >= 0 ? rows[selectedIdx] : null;

  return (
    <Layout title="Documentos" showBack>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Búsqueda */}
        <div className="card" style={{ padding: '1.2rem' }}>
          <h3 style={{ marginBottom: 12, fontSize: '0.95rem' }}>🔍 Buscar documentos</h3>
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
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" onClick={search} disabled={loading}>
                {loading ? '⏳…' : '🔍 Buscar'}
              </button>
            </div>
          </div>
        </div>

        {/* Resultados */}
        {rows.length > 0 && (
          <div className="card" style={{ padding: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: '0.9rem' }}>📂 {rows.length} documento(s)</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                {selected?.id && (
                  <button className="btn btn-primary" onClick={() => openDoc(String(selected.id), selected)}>
                    📄 Abrir seleccionado
                  </button>
                )}
                <button className="btn" onClick={() => printTable('Documentos', rows)}>🖨</button>
                <button className="btn" onClick={() => exportToExcel('documentos.xlsx', rows)}>Excel</button>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 8 }}>
              💡 Click = seleccionar · Doble click en nombre/tipo/fecha = abrir documento
            </div>
            <DocTable
              cols={cols} pageRows={pageRows} start={start}
              selectedIdx={selectedIdx}
              onSelect={setSelectedIdx}
              onOpenDoc={openDoc}
            />
            {total > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={curPage <= 1}>◀</button>
                <span className="badge">Pág. {curPage}/{total}</span>
                <button className="btn" onClick={() => setPage(p => Math.min(total, p+1))} disabled={curPage >= total}>▶</button>
              </div>
            )}
          </div>
        )}

        {/* Detalle */}
        {selected && (
          <div className="card" style={{ padding: '1.2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: '0.9rem' }}>📄 {selected.nombre || `Documento #${selected.id}`}</strong>
              <button className="btn btn-primary" onClick={() => openDoc(String(selected.id), selected)}>
                Abrir documento
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {Object.entries(selected).filter(([k]) => !['ruta','deleted_at'].includes(k)).map(([k, v]) => (
                <div key={k}>
                  <div className="muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
                  <div style={{ fontSize: '0.88rem', wordBreak: 'break-word' }}>{String(v ?? '—')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Visor modal */}
      {viewer.open && (
        <div className="modalOverlay" onMouseDown={closeViewer}>
          <div className="modal gp-doc-modal" onMouseDown={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>Documentos</div>
                <strong>{viewer.meta?.filename || `Documento #${viewer.docId}`}</strong>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {viewer.objectUrl && (
                  <>
                    <a className="btn" href={viewer.objectUrl} download={viewer.meta?.filename}>Descargar</a>
                    <button className="btn" onClick={() => window.open(viewer.objectUrl!, '_blank')}>Abrir</button>
                  </>
                )}
                <button className="btn" onClick={closeViewer}>Cerrar</button>
              </div>
            </div>
            <div className="sep" />
            {viewer.loading ? <div className="muted">⏳ Cargando…</div>
              : viewer.error ? <div style={{ color: '#ef4444' }}>❌ {viewer.error}</div>
              : viewer.objectUrl ? <GestionDocumentPreview url={viewer.objectUrl} meta={viewer.meta} />
              : <div className="muted">Sin datos</div>}
          </div>
        </div>
      )}
    </Layout>
  );
}

// Tabla con doble click inteligente (no en col id/dni)
const ID_COLS = new Set(['id','dni']);
function DocTable({ cols, pageRows, start, selectedIdx, onSelect, onOpenDoc }: {
  cols: string[]; pageRows: any[]; start: number; selectedIdx: number;
  onSelect: (i: number) => void; onOpenDoc: (id: string, row: any) => void;
}) {
  const timerRef = React.useRef<any>(null);
  const lastKeyRef = React.useRef('');

  const handleClick = (ri: number, row: any, col: string) => {
    const key = `${ri}-${col}`;
    if (lastKeyRef.current === key && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      lastKeyRef.current = '';
      if (!ID_COLS.has(col)) {
        const docId = row?.id;
        if (docId) onOpenDoc(String(docId), row);
      }
    } else {
      onSelect(ri);
      lastKeyRef.current = key;
      timerRef.current = setTimeout(() => { timerRef.current = null; lastKeyRef.current = ''; }, 320);
    }
  };

  return (
    <div className="gp-tablewrap">
      <table className="table">
        <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {pageRows.map((row, i) => {
            const ri = start + i;
            return (
              <tr key={ri} className={ri === selectedIdx ? 'gp-row-active' : ''} style={{ cursor: 'pointer' }}>
                {cols.map(c => (
                  <td key={c} className="cell" onClick={() => handleClick(ri, row, c)}>
                    {String(row[c] ?? '').substring(0, 100)}
                  </td>
                ))}
              </tr>
            );
          })}
          {!pageRows.length && (
            <tr><td colSpan={cols.length} style={{ textAlign: 'center', color: '#aaa', padding: '1rem' }}>Sin datos</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
