import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { apiFetch, apiFetchBlobWithMeta } from '../api/http';
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
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ contentType: string; filename: string | null } | null>(null);

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
    async function loadFile() {
      if (!selected) {
        setFileUrl(null);
        setFileMeta(null);
        return;
      }
      try {
        const { blob, contentType, filename } = await apiFetchBlobWithMeta(selected.fileUrl);
        const url = URL.createObjectURL(blob);
        if (!alive) return;
        setFileMeta({ contentType, filename });
        setFileUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (e: any) {
        toast.error('No se pudo abrir el archivo', e?.message || 'Error');
        setFileUrl(null);
        setFileMeta(null);
      }
    }
    loadFile();
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
            {fileUrl ? (
              <div className="row">
                <a className="btn" href={fileUrl} download={fileMeta?.filename || undefined}>Descargar</a>
                <button className="btn" type="button" onClick={() => window.open(fileUrl, '_blank')}>Abrir</button>
              </div>
            ) : null}
          </div>

          {fileUrl ? (
            <DocumentPreview url={fileUrl} meta={fileMeta} />
          ) : (
            <div className="muted">Seleccione un documento para ver el archivo.</div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function DocumentPreview({ url, meta }: { url: string; meta: { contentType: string; filename: string | null } | null }) {
  const ct = (meta?.contentType || '').toLowerCase();
  const name = (meta?.filename || '').toLowerCase();

  // PDF
  if (ct.includes('pdf') || name.endsWith('.pdf')) {
    return <iframe title="pdf" src={url} className="docs-iframe" />;
  }

  // Imágenes
  if (ct.startsWith('image/') || name.match(/\.(png|jpe?g|webp|gif)$/)) {
    return (
      <div className="docs-imgwrap">
        <img className="docs-img" src={url} alt={meta?.filename || 'archivo'} />
      </div>
    );
  }

  // Texto
  if (ct.startsWith('text/') || name.match(/\.(txt|csv|log)$/)) {
    return (
      <div className="docs-generic">
        <div className="badge">Vista previa limitada</div>
        <iframe title="text" src={url} className="docs-iframe" />
      </div>
    );
  }

  // Word/Excel/otros: mostramos aviso y dejamos descarga
  return (
    <div className="docs-generic">
      <div className="badge">Sin visor embebido</div>
      <p className="muted docs-generic-text">
        Este tipo de archivo (por ejemplo Word/Excel) se descarga y se abre con tu aplicación.
      </p>
    </div>
  );
}
