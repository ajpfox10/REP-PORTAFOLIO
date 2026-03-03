import React, { useEffect, useState } from 'react';
import mammoth from 'mammoth';

export function GestionDocumentPreview({
  url,
  meta,
  blob,
}: {
  url: string;
  meta: { contentType: string; filename: string | null } | null;
  blob?: Blob | null;
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

  // DOCX preview (HTML)
  if (name.endsWith('.docx') || ct.includes('officedocument.wordprocessingml')) {
    return <DocxPreview blob={blob} />;
  }

  return (
    <div className="gp-doc-generic">
      <div className="badge">Sin visor embebido</div>
      <p className="muted gp-mt-10">Descargalo y abrilo con tu aplicación (Word/Excel u otro).</p>
    </div>
  );
}

function DocxPreview({ blob }: { blob?: Blob | null }) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    (async () => {
      if (!blob) return;
      const arrayBuffer = await blob.arrayBuffer();
      const res = await mammoth.convertToHtml({ arrayBuffer });
      setHtml(res.value || '');
    })();
  }, [blob]);

  if (!blob) return <div className="muted">Cargando preview…</div>;

  return (
    <div className="gp-doc-docx">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
