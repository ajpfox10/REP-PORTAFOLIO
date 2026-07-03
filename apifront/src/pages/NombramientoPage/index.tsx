import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { apiFetch, apiFetchBlobWithMeta } from '../../api/http';
import { useToast } from '../../ui/toast';
import './styles/NombramientoPage.css';

type NombramientoDoc = {
  id: number;
  tipo: string;
  nombre: string | null;
  numero: string | null;
  fecha: string | null;
  anio: number | null;
  descripcion_archivo: string | null;
  nombre_archivo_original: string | null;
  created_at: string | null;
  fileUrl: string;
};

type NombramientoItem = {
  value: string;
  label: string;
  presente: boolean;
  cantidad: number;
  ultimo: NombramientoDoc | null;
  documentos: NombramientoDoc[];
};

type NombramientoData = {
  agente: {
    dni: number;
    apellido: string;
    nombre: string;
    cuil?: string | null;
    legajo?: number | null;
    estado_empleo?: string | null;
    fecha_ingreso?: string | null;
    fecha_de_nombramiento?: string | null;
    servicio_nombre?: string | null;
  };
  items: NombramientoItem[];
  documents: NombramientoDoc[];
  summary: { total: number; presentes: number; faltantes: number };
};

type ViewerState = {
  title: string;
  url: string;
  filename: string | null;
  contentType: string;
};

function cleanDni(value: string) {
  return value.replace(/\D/g, '');
}

function fmtDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('es-AR');
}

function docTitle(doc: NombramientoDoc) {
  return doc.nombre || doc.nombre_archivo_original || `Documento #${doc.id}`;
}

function looksPdf(doc: NombramientoDoc) {
  const name = `${doc.nombre || ''} ${doc.nombre_archivo_original || ''}`.toLowerCase();
  return name.includes('.pdf') || !name.match(/\.(png|jpe?g|webp|gif|tiff?|docx?|xlsx?)\b/);
}

export function NombramientoPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const initialDni = cleanDni(params.get('dni') || '');
  const [dni, setDni] = useState(initialDni);
  const [data, setData] = useState<NombramientoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  const presentDocs = useMemo(() => data?.documents || [], [data]);

  function revokeViewerUrl() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  useEffect(() => {
    return () => revokeViewerUrl();
  }, []);

  async function loadByDni(nextDni = dni) {
    const clean = cleanDni(nextDni);
    if (!clean) {
      toast.warning('Falta DNI', 'Ingresá un DNI para buscar.');
      return;
    }

    setLoading(true);
    setData(null);
    setViewer(null);
    revokeViewerUrl();
    try {
      const res = await apiFetch<{ ok: boolean; data: NombramientoData }>(`/nombramiento/${clean}`);
      setData(res.data);
      setParams({ dni: clean });
      const ids = (res.data.documents || []).filter(looksPdf).map((doc) => doc.id);
      setSelectedIds(ids);
      if (ids.length) {
        const first = res.data.documents.find((doc) => doc.id === ids[0]);
        if (first) await openDocument(first);
      }
    } catch (e: any) {
      toast.error('No se pudo cargar nombramiento', e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function openBlob(path: string, title: string) {
    setLoadingViewer(true);
    try {
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(path);
      revokeViewerUrl();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setViewer({ title, url, filename, contentType });
    } catch (e: any) {
      toast.error('No se pudo abrir el archivo', e?.message || 'Error');
    } finally {
      setLoadingViewer(false);
    }
  }

  async function openDocument(doc: NombramientoDoc) {
    await openBlob(doc.fileUrl, docTitle(doc));
  }

  async function openCombined() {
    if (!data?.agente?.dni) return;
    if (!selectedIds.length) {
      toast.warning('Sin seleccion', 'Seleccioná al menos un PDF para combinar.');
      return;
    }

    const qs = selectedIds.length ? `?ids=${selectedIds.join(',')}` : '';
    await openBlob(`/nombramiento/${data.agente.dni}/combinado.pdf${qs}`, 'PDF combinado de nombramiento');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    loadByDni();
  }

  function toggleDoc(id: number) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <Layout title="Nombramiento" showBack>
      <form className="nom-card nom-search" onSubmit={submit}>
        <div className="nom-search-field">
          <label className="label" htmlFor="nom-dni">DNI</label>
          <input
            id="nom-dni"
            className="input"
            value={dni}
            onChange={(e) => setDni(cleanDni(e.target.value))}
            placeholder="Buscar por DNI"
            inputMode="numeric"
          />
        </div>
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
        {data?.agente?.dni ? (
          <Link className="btn" to={`/app/escaneo-agente/${data.agente.dni}`}>
            Escanear
          </Link>
        ) : null}
      </form>

      {data ? (
        <>
          <section className="nom-card nom-head">
            <div>
              <div className="nom-eyebrow">Agente</div>
              <h2>{data.agente.apellido}, {data.agente.nombre}</h2>
              <div className="nom-meta">
                <span>DNI {data.agente.dni}</span>
                <span>Legajo {data.agente.legajo || '-'}</span>
                <span>{data.agente.estado_empleo || '-'}</span>
                <span>{data.agente.servicio_nombre || 'Sin servicio vigente'}</span>
              </div>
            </div>
            <div className="nom-stats">
              <div>
                <strong>{data.summary.presentes}</strong>
                <span>presentes</span>
              </div>
              <div>
                <strong>{data.summary.faltantes}</strong>
                <span>faltantes</span>
              </div>
            </div>
          </section>

          <div className="nom-layout">
            <section className="nom-card nom-list">
              <div className="nom-actions">
                <div>
                  <div className="h2">Documentos de nombramiento</div>
                  <div className="muted">Seleccionados: {selectedIds.length}</div>
                </div>
                <button className="btn primary" type="button" onClick={openCombined} disabled={!selectedIds.length || loadingViewer}>
                  Combinar PDFs
                </button>
              </div>

              <div className="nom-items">
                {data.items.map((item) => (
                  <div key={item.value} className={`nom-item ${item.presente ? 'ok' : 'missing'}`}>
                    <div className="nom-item-main">
                      <div className="nom-status">{item.presente ? 'OK' : 'Falta'}</div>
                      <div>
                        <div className="nom-item-title">{item.label}</div>
                        <div className="muted">
                          {item.presente ? `${item.cantidad} archivo(s)` : 'Sin archivo cargado'}
                        </div>
                      </div>
                    </div>

                    {item.documentos.length ? (
                      <div className="nom-docs">
                        {item.documentos.map((doc) => (
                          <label key={doc.id} className="nom-doc-row">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(doc.id)}
                              onChange={() => toggleDoc(doc.id)}
                            />
                            <button type="button" onClick={() => openDocument(doc)}>
                              <span>{docTitle(doc)}</span>
                              <small>{fmtDate(doc.fecha || doc.created_at)}</small>
                            </button>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="nom-card nom-viewer">
              <div className="nom-viewer-head">
                <div>
                  <div className="h2">{viewer?.title || 'Visor'}</div>
                  <div className="muted">{viewer?.filename || 'Seleccioná un documento'}</div>
                </div>
                {viewer ? (
                  <div className="row">
                    <a className="btn" href={viewer.url} download={viewer.filename || undefined}>Descargar</a>
                    <button className="btn" type="button" onClick={() => window.open(viewer.url, '_blank')}>Abrir</button>
                  </div>
                ) : null}
              </div>

              {loadingViewer ? (
                <div className="nom-empty">Cargando archivo...</div>
              ) : viewer ? (
                viewer.contentType.includes('pdf') || (viewer.filename || '').toLowerCase().endsWith('.pdf') ? (
                  <iframe title="visor-nombramiento" src={viewer.url} className="nom-iframe" />
                ) : (
                  <div className="nom-empty">Vista previa no disponible para este tipo de archivo.</div>
                )
              ) : presentDocs.length ? (
                <div className="nom-empty">Elegí un documento para verlo.</div>
              ) : (
                <div className="nom-empty">No hay documentos de nombramiento cargados para este DNI.</div>
              )}
            </section>
          </div>
        </>
      ) : (
        <section className="nom-card nom-empty">
          Buscá un agente para ver su carpeta de nombramiento.
        </section>
      )}
    </Layout>
  );
}
