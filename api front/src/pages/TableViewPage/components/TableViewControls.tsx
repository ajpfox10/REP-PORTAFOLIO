// src/pages/TableViewPage/components/TableViewControls.tsx
import React from 'react';

interface TableViewControlsProps {
  page: number;
  totalPages: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export function TableViewControls({
  page,
  totalPages,
  limit,
  onPageChange,
  onLimitChange
}: TableViewControlsProps) {
  return (
    <div className="row tv-controls-row">
      <div className="row">
        <button 
          className="btn" 
          type="button" 
          onClick={() => onPageChange(1)} 
          disabled={page <= 1}
        >
          ⏮
        </button>
        <button 
          className="btn" 
          type="button" 
          onClick={() => onPageChange(page - 1)} 
          disabled={page <= 1}
        >
          ◀
        </button>
        <button 
          className="btn" 
          type="button" 
          onClick={() => onPageChange(page + 1)} 
          disabled={page >= totalPages}
        >
          ▶
        </button>
        <button 
          className="btn" 
          type="button" 
          onClick={() => onPageChange(totalPages)} 
          disabled={page >= totalPages}
        >
          ⏭
        </button>
      </div>
      <div className="row">
        <span className="muted">Límite</span>
        <select value={limit} onChange={(e) => onLimitChange(Number(e.target.value))}>
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
    </div>
  );
}