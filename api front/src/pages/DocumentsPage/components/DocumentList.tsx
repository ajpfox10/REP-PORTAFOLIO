// src/pages/DocumentsPage/components/DocumentList.tsx
import React from 'react';
import type { DocRow } from '../hooks/useDocumentSearch';

interface Props {
  items: DocRow[];
  selected: DocRow | null;
  loading: boolean;
  onSelect: (doc: DocRow) => void;
}

export function DocumentList({ items, selected, loading, onSelect }: Props) {
  if (loading && !items.length) {
    return <div className="muted">Cargando…</div>;
  }

  if (!loading && !items.length) {
    return <div className="muted">Sin resultados.</div>;
  }

  return (
    <div className="card docs-card-12 docs-list">
      {items.map((d) => (
        <div
          key={d.id}
          className={`tile docs-doc-tile ${selected?.id === d.id ? 'is-selected' : ''}`}
          onClick={() => onSelect(d)}
        >
          <h3 className="docs-doc-title">{d.nombre ?? `Documento ${d.id}`}</h3>
          <p>
            {d.numero ? `N° ${d.numero} · ` : ''}
            {d.tipo ?? 'sin tipo'}
            {d.fecha ? ` · ${String(d.fecha).slice(0, 10)}` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}