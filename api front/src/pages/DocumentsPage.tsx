import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { apiFetch, apiFetchBlob } from '../api/http';
import { useToast } from '../ui/toast';

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
      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, número, tipo, descripción"
              style={{ minWidth: 280 }}
            />
            <button className="btn" type="button" onClick={load} disabled={loading}>
              {loading ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          <div className="muted">{items.length} resultado(s)</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }} className="split">
        <div className="card" style={{ padding: 12, overflow: 'auto', maxHeight: '72vh' }}>
          {items.map((d) => (
            <div
              key={d.id}
              className="tile"
              style={{ marginBottom: 10, cursor: 'pointer', borderColor: selected?.id === d.id ? 'rgba(34,211,238,0.55)' : undefined }}
              onClick={() => setSelected(d)}
            >
              <h3 style={{ wordBreak: 'break-word' }}>{d.nombre ?? `Documento ${d.id}`}</h3>
              <p>
                {d.numero ? `N° ${d.numero} · ` : ''}
                {d.tipo ?? 'sin tipo'}
                {d.fecha ? ` · ${String(d.fecha).slice(0, 10)}` : ''}
              </p>
            </div>
          ))}
          {!items.length && <div className="muted">Sin resultados.</div>}
        </div>

        <div className="card" style={{ padding: 12, minHeight: '72vh' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <div className="h1" style={{ fontSize: 16 }}>{meta || 'Visor'}</div>
              {selected?.descripcion ? <div className="muted" style={{ marginTop: 2 }}>{selected.descripcion}</div> : null}
            </div>
            {pdfUrl ? (
              <div className="row">
                <a className="btn" href={pdfUrl} download>Descargar</a>
                <button className="btn" type="button" onClick={() => window.open(pdfUrl, '_blank')}>Abrir</button>
              </div>
            ) : null}
          </div>

          {pdfUrl ? (
            <iframe title="pdf" src={pdfUrl} style={{ width: '100%', height: '62vh', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} />
          ) : (
            <div className="muted">Seleccione un documento para ver el archivo.</div>
          )}
        </div>
      </div>
    </Layout>
  );
}
