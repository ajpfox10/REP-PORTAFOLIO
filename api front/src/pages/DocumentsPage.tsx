import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { apiFetch, apiFetchBlob } from '../api/http';
import { useToast } from '../ui/toast';

// 🎨 CSS de esta ruta (NO global): /src/pages/styles/DocumentsPage.css
import './styles/DocumentsPage.css';

type DocRow = {
  id: number;
  nombre: string | null;
  numero: string | null;
  tipo: string | null;
  tamano: string | null;
  fecha: string | null;
  descripcion: string | null;
  fileUrl: string;
};

export function DocumentsPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DocRow[]>([]);
  const [selected, setSelected] = useState<DocRow | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/documents?page=1&limit=50&q=${encodeURIComponent(q.trim())}`);
      const data = res?.data || [];
      setItems(data);
      if (data.length && !selected) setSelected(data[0]);
    } catch (e: any) {
      toast.error('No se pudo cargar documentos', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadPdf() {
      if (!selected) {
        setPdfUrl(null);
        return;
      }
      try {
        const blob = await apiFetchBlob(selected.fileUrl);
        const url = URL.createObjectURL(blob);
        if (!alive) return;
        setPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (e: any) {
        toast.error('No se pudo abrir el archivo', e?.message || 'Error');
        setPdfUrl(null);
      }
    }
    loadPdf();
    return () => {
      alive = false;
    };
  }, [selected]);

  const meta = useMemo(() => {
    if (!selected) return null;
    return `${selected.nombre ?? 'Documento'}${selected.numero ? ` · ${selected.numero}` : ''}`;
  }, [selected]);

  return (
    <Layout title="Documentos" showBack>
      {/* Card de búsqueda (sin estilos inline) */}
      <div className="card docs-card-14">
        <div className="row docs-search-row">
          <div className="row docs-search-controls">
            <input
              className="input docs-search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, número, tipo, descripción"
            />
            <button className="btn" type="button" onClick={load} disabled={loading}>
              {loading ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          <div className="muted">{items.length} resultado(s)</div>
        </div>
      </div>

      {/* Split responsive (lista a la izquierda, visor a la derecha) */}
      <div className="split docs-split-top">
        <div className="card docs-card-12 docs-list">
          {items.map((d) => (
            <div
              key={d.id}
              className={`tile docs-doc-tile ${selected?.id === d.id ? 'is-selected' : ''}`}
              onClick={() => setSelected(d)}
            >
              <h3 className="docs-doc-title">{d.nombre ?? `Documento ${d.id}`}</h3>
              <p>
                {d.numero ? `N° ${d.numero} · ` : ''}
                {d.tipo ?? 'sin tipo'}
                {d.fecha ? ` · ${String(d.fecha).slice(0, 10)}` : ''}
              </p>
            </div>
          ))}
          {!items.length && <div className="muted">Sin resultados.</div>}
        </div>

        <div className="card docs-card-12 docs-viewer">
          <div className="row docs-viewer-head">
            <div>
              <div className="h1 docs-viewer-meta">{meta || 'Visor'}</div>
              {selected?.descripcion ? <div className="muted docs-viewer-desc">{selected.descripcion}</div> : null}
            </div>
            {pdfUrl ? (
              <div className="row">
                <a className="btn" href={pdfUrl} download>Descargar</a>
                <button className="btn" type="button" onClick={() => window.open(pdfUrl, '_blank')}>Abrir</button>
              </div>
            ) : null}
          </div>

          {pdfUrl ? (
            <iframe title="pdf" src={pdfUrl} className="docs-iframe" />
          ) : (
            <div className="muted">Seleccione un documento para ver el archivo.</div>
          )}
        </div>
      </div>
    </Layout>
  );
}
