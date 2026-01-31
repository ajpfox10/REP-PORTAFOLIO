import React from 'react';

export function GestionDocumentPreview({
  url,
  meta,
}: {
  url: string;
  meta: { contentType: string; filename: string | null } | null;
}) {
  const ct = (meta?.contentType || '').toLowerCase();
  const name = (meta?.filename || '').toLowerCase();

  // PDF
  if (ct.includes('pdf') || name.endsWith('.pdf')) {
    return <iframe title="pdf" src={url} className="gp-doc-iframe" />;
  }

  // Imágenes
  if (ct.startsWith('image/') || name.match(/\.(png|jpe?g|webp|gif)$/)) {
    return (
      <div className="gp-doc-imgwrap">
        <img className="gp-doc-img" src={url} alt={meta?.filename || 'archivo'} />
      </div>
    );
  }

  // Texto
  if (ct.startsWith('text/') || name.match(/\.(txt|csv|log)$/)) {
    return <iframe title="text" src={url} className="gp-doc-iframe" />;
  }

  // Word/Excel/otros: preview limitada.
  return (
    <div className="gp-doc-generic">
      <div className="badge">Sin visor embebido</div>
      <p className="muted gp-mt-10">Descargalo y abrilo con tu aplicación (Word/Excel u otro).</p>
    </div>
  );
}
