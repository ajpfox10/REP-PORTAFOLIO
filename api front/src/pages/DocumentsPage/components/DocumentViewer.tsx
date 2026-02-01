// src/pages/DocumentsPage/components/DocumentViewer.tsx
import React from 'react';
import type { DocRow } from '../hooks/useDocumentSearch';

interface Props {
  selected: DocRow | null;
  fileUrl: string | null;
  fileMeta: { contentType: string; filename: string | null } | null;
  loadingFile: boolean;
}

export function DocumentViewer({ selected, fileUrl, fileMeta, loadingFile }: Props) {
  const meta = selected 
    ? `${selected.nombre ?? 'Documento'}${selected.numero ? ` · ${selected.numero}` : ''}`
    : null;

  return (
    <div className="card docs-card-12 docs-viewer">
      <div className="row docs-viewer-head">
        <div>
          <div className="h1 docs-viewer-meta">{meta || 'Visor'}</div>
          {selected?.descripcion && (
            <div className="muted docs-viewer-desc">{selected.descripcion}</div>
          )}
        </div>
        
        {fileUrl && (
          <div className="row">
            <a className="btn" href={fileUrl} download={fileMeta?.filename || undefined}>
              Descargar
            </a>
            <button className="btn" type="button" onClick={() => window.open(fileUrl, '_blank')}>
              Abrir
            </button>
          </div>
        )}
      </div>

      {loadingFile ? (
        <div className="muted">Cargando archivo…</div>
      ) : fileUrl ? (
        <DocumentPreview url={fileUrl} meta={fileMeta} />
      ) : (
        <div className="muted">Seleccione un documento para ver el archivo.</div>
      )}
    </div>
  );
}

// Componente interno (igual al original)
function DocumentPreview({ url, meta }: { url: string; meta: any }) {
  const ct = (meta?.contentType || '').toLowerCase();
  const name = (meta?.filename || '').toLowerCase();

  if (ct.includes('pdf') || name.endsWith('.pdf')) {
    return <iframe title="pdf" src={url} className="docs-iframe" />;
  }

  if (ct.startsWith('image/') || name.match(/\.(png|jpe?g|webp|gif)$/)) {
    return (
      <div className="docs-imgwrap">
        <img className="docs-img" src={url} alt={meta?.filename || 'archivo'} />
      </div>
    );
  }

  if (ct.startsWith('text/') || name.match(/\.(txt|csv|log)$/)) {
    return (
      <div className="docs-generic">
        <div className="badge">Vista previa limitada</div>
        <iframe title="text" src={url} className="docs-iframe" />
      </div>
    );
  }

  return (
    <div className="docs-generic">
      <div className="badge">Sin visor embebido</div>
      <p className="muted docs-generic-text">
        Este tipo de archivo se descarga y se abre con tu aplicación.
      </p>
    </div>
  );
}