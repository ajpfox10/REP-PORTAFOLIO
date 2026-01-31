// src/pages/GestionPage/components/modals/DocViewerModal.tsx
import React from 'react';

interface Props {
  open: boolean;
  data: any;
  onClose: () => void;
  previewComponent: React.ComponentType<{ url: string; meta: any }>;
}

export function DocViewerModal({ open, data, onClose, previewComponent: PreviewComponent }: Props) {
  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal gp-doc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row gp-modal-head">
          <div>
            <div className="muted gp-muted-xs">Documentos · DNI {data.dni}</div>
            <h3 className="gp-h3-0">{data.meta?.filename || 'Archivo'}</h3>
          </div>
          <div className="row gp-row-wrap">
            {data.objectUrl && (
              <>
                <a className="btn" href={data.objectUrl} download={data.meta?.filename || undefined}>
                  Descargar
                </a>
                <button className="btn" type="button" onClick={() => window.open(data.objectUrl, '_blank')}>
                  Abrir
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const w = window.open(data.objectUrl, '_blank');
                    if (!w) return;
                    const t = setInterval(() => {
                      try {
                        if (w.document?.readyState === 'complete') {
                          clearInterval(t);
                          w.focus();
                          w.print();
                        }
                      } catch {}
                    }, 250);
                  }}
                >
                  Imprimir
                </button>
              </>
            )}
            <button className="btn" type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        <div className="sep" />

        {data.loading ? (
          <div className="muted">Cargando archivo…</div>
        ) : data.error ? (
          <div>
            <div className="badge">Error</div>
            <p className="muted">{data.error}</p>
            <p className="muted">Ruta: {data.route}</p>
          </div>
        ) : data.objectUrl ? (
          <PreviewComponent url={data.objectUrl} meta={data.meta} />
        ) : (
          <div className="muted">Sin archivo.</div>
        )}
      </div>
    </div>
  );
}