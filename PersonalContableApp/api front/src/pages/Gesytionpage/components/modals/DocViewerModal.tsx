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

  const isLegacy = data.error && (
    data.error.includes('legacy') ||
    data.error.includes('Ruta fuera') ||
    data.error.includes('Archivo inexistente') ||
    data.error.includes('file_not_found') ||
    data.error.includes('no disponible')
  );

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal gp-doc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row gp-modal-head">
          <div>
            <div className="muted gp-muted-xs">Documentos · DNI {data.dni}</div>
            <h3 className="gp-h3-0">{data.meta?.filename || data.row?.nombre || 'Archivo'}</h3>
          </div>
          <div className="row gp-row-wrap">
            {data.objectUrl && (
              <>
                <a className="btn" href={data.objectUrl} download={data.meta?.filename || undefined}>
                  ⬇ Descargar
                </a>
                <button className="btn" type="button" onClick={() => window.open(data.objectUrl, '_blank')}>
                  🔗 Abrir
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
                  🖨 Imprimir
                </button>
              </>
            )}
            <button className="btn" type="button" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        <div className="sep" />

        {data.loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <div className="badge" style={{ animation: 'pulse 1.2s infinite' }}>⏳ Cargando archivo…</div>
          </div>
        ) : data.error ? (
          <div style={{ padding: '1.5rem' }}>
            <div className="badge" style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5', marginBottom: '0.75rem' }}>
              ⚠ {isLegacy ? 'Archivo no disponible' : 'Error'}
            </div>
            {isLegacy ? (
              <div>
                <p style={{ marginBottom: '0.5rem' }}>
                  Este documento es un registro <strong>legacy</strong> (histórico) y el archivo físico
                  no está disponible en el servidor.
                </p>
                <p className="muted" style={{ fontSize: '0.8rem' }}>
                  El documento "{data.row?.nombre || 'sin nombre'}" fue registrado en el sistema anterior.
                  Para visualizarlo, el administrador debe subir el archivo nuevamente usando la función de carga.
                </p>
              </div>
            ) : (
              <div>
                <p>{data.error}</p>
                <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Documento ID: {data.route} · Verificá que el archivo exista en el servidor
                </p>
              </div>
            )}
          </div>
        ) : data.objectUrl ? (
          <div style={{ flex: 1, minHeight: '60vh', position: 'relative' }}>
            <PreviewComponent url={data.objectUrl} meta={data.meta} />
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
            Sin archivo para mostrar.
          </div>
        )}
      </div>
    </div>
  );
}
