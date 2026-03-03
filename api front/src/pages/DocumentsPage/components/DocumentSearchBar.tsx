// src/pages/DocumentsPage/components/DocumentSearchBar.tsx
import React from 'react';

interface Props {
  q: string;
  loading: boolean;
  totalResults: number;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearch: () => void;
}

export function DocumentSearchBar({ q, loading, totalResults, onSearchChange, onSearch }: Props) {
  return (
    <div className="card docs-card-14">
      <div className="row docs-search-row">
        <div className="row docs-search-controls">
          <input
            className="input docs-search-input"
            value={q}
            onChange={onSearchChange}
            placeholder="Buscar por nombre, número, tipo, descripción"
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
          <button className="btn" type="button" onClick={onSearch} disabled={loading}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        <div className="muted">{totalResults} resultado(s)</div>
      </div>
    </div>
  );
}